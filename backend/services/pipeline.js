const { maxRadiusKm, estimateFare } = require('./fareEstimate');
const { fetchStops } = require('./overpass');
const { getRoadDistanceAndDuration, getOsrmPolyline } = require('./osrm');
const { getTransitTime, getFullTransitRoute } = require('./google');

const MIN_UBER_DISTANCE_KM = 1.5;  // stops closer than this are walkable — skip
const MIN_TIME_SAVING_SEC = 5 * 60; // hybrid must arrive at least 5 min earlier than full transit
const MAX_CANDIDATES = 30; // cap on Google Directions calls after OSRM filter

async function runPipeline({ origin, destination, budget, departureTime }) {
  // Step 1: Radius calculation
  const radiusKm = maxRadiusKm(budget);
  if (radiusKm <= 0) throw new Error('Budget is below minimum fare ($3.50)');
  const radiusMeters = radiusKm * 1000;

  // Steps 2 + baseline run in parallel — baseline doesn't block stop discovery
  const [stops, baselineTransit] = await Promise.all([
    fetchStops(destination.lat, destination.lng, radiusMeters),
    getFullTransitRoute(origin.lat, origin.lng, destination.lat, destination.lng, departureTime),
  ]);

  if (stops.length === 0) throw new Error('No transit stops found near destination within budget radius');
  const stopsConsidered = stops.length;

  const baselineArrivalUnix = baselineTransit?.arrivalUnix ?? null;

  // Step 3: Fare filter — parallel OSRM calls
  const fareResults = await Promise.allSettled(
    stops.map(async (stop) => {
      const { distanceKm, durationMin } = await getRoadDistanceAndDuration(
        stop.lat, stop.lng, destination.lat, destination.lng
      );
      const fare = estimateFare(distanceKm, durationMin, departureTime);
      if (fare > budget) return null;
      // Skip stops too close to destination — walkable distance, no point calling an Uber
      if (distanceKm < MIN_UBER_DISTANCE_KM) return null;
      return { ...stop, estimatedFare: fare, uberDurationMin: durationMin };
    })
  );

  fareResults.filter(r => r.status === 'rejected').forEach(r => console.error('[pipeline] fare filter rejected:', r.reason?.message));
  const survivingStops = fareResults
    .filter((r) => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value);

  if (survivingStops.length === 0) {
    throw new Error('No stops found within budget after fare calculation');
  }
  const stopsAfterFareFilter = survivingStops.length;

  // Sort by uber_duration_min descending — stops with a longer Uber leg are farther from the
  // destination, meaning more of the journey is covered by Uber (faster than transit).
  // Cap at MAX_CANDIDATES before the expensive Google Directions calls.
  const candidates = survivingStops
    .sort((a, b) => b.uberDurationMin - a.uberDurationMin)
    .slice(0, MAX_CANDIDATES);

  // Step 4: Transit validation — parallel Google Directions calls
  const transitResults = await Promise.allSettled(
    candidates.map(async (stop) => {
      const { durationMin, departureTime: depTime, arrivalTime: arrTime, arrivalUnix, encodedPolyline, steps } = await getTransitTime(
        origin.lat, origin.lng, stop.lat, stop.lng, departureTime
      );
      return { ...stop, transitDurationMin: durationMin, transitDepartureTime: depTime, transitArrivalTime: arrTime, transitArrivalUnix: arrivalUnix, encodedPolyline, steps };
    })
  );

  transitResults.filter(r => r.status === 'rejected').forEach(r => console.error('[pipeline] transit validation rejected:', r.reason?.message));
  const validatedStops = transitResults
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);

  if (validatedStops.length === 0) {
    throw new Error('Google Directions returned no valid transit routes to any candidate stop');
  }

  // Step 5: Pick winner — earliest arrival at destination (transit arrival + uber drive time)
  // Also require the hybrid to arrive meaningfully earlier than full transit baseline
  validatedStops.sort((a, b) =>
    (a.transitArrivalUnix + Math.ceil(a.uberDurationMin) * 60) -
    (b.transitArrivalUnix + Math.ceil(b.uberDurationMin) * 60)
  );

  const worthwhileStops = baselineArrivalUnix
    ? validatedStops.filter(s =>
        baselineArrivalUnix - (s.transitArrivalUnix + Math.ceil(s.uberDurationMin) * 60) >= MIN_TIME_SAVING_SEC
      )
    : validatedStops;

  // If no stop clears the savings threshold, full transit wins
  if (worthwhileStops.length === 0) {
    const depUnix = Math.floor(new Date(departureTime).getTime() / 1000);
    const bestHybridMinutes = baselineArrivalUnix && validatedStops.length > 0
      ? Math.round((Math.min(...validatedStops.map(s => s.transitArrivalUnix + Math.ceil(s.uberDurationMin) * 60)) - depUnix) / 60)
      : null;
    return {
      transitFaster: true,
      fullTransitDurationMinutes: baselineTransit.durationMin,
      fullTransitDepartureTime: baselineTransit.departureTime,
      fullTransitArrivalTime: baselineTransit.arrivalTime,
      fullTransitSteps: baselineTransit.steps,
      fullTransitEncodedPolyline: baselineTransit.encodedPolyline,
      hybridTotalMinutes: bestHybridMinutes,
    };
  }

  const winner = worthwhileStops[0];
  const uberDurationMinutes = Math.ceil(winner.uberDurationMin);
  const hybridTotal = winner.transitDurationMin + uberDurationMinutes;

  // Hybrid arrival = when transit drops you at handoff stop + uber drive time
  const hybridArrivalUnix = winner.transitArrivalUnix + uberDurationMinutes * 60;
  const hybridArrivalTime = new Date(hybridArrivalUnix * 1000).toLocaleTimeString('en-CA', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Toronto',
  });

  // Compare arrival times using Unix timestamps (not durations)
  if (baselineArrivalUnix && baselineArrivalUnix <= hybridArrivalUnix) {
    const depUnix = Math.floor(new Date(departureTime).getTime() / 1000);
    return {
      transitFaster: true,
      fullTransitDurationMinutes: baselineTransit.durationMin,
      fullTransitDepartureTime: baselineTransit.departureTime,
      fullTransitArrivalTime: baselineTransit.arrivalTime,
      fullTransitSteps: baselineTransit.steps,
      fullTransitEncodedPolyline: baselineTransit.encodedPolyline,
      hybridTotalMinutes: Math.round((hybridArrivalUnix - depUnix) / 60),
    };
  }

  // Step 6: Get Uber leg polyline, assemble hybrid result
  const uberPolylineGeojson = await getOsrmPolyline(
    winner.lat, winner.lng, destination.lat, destination.lng
  );

  // Use the last transit step's arrivalStop as the full intersection address
  const lastTransitStep = winner.steps?.slice().reverse().find(s => s.mode === 'TRANSIT');
  const fullAddress = lastTransitStep?.arrivalStop || winner.name;

  return {
    transitFaster: false,
    handoffStop: { name: winner.name, fullAddress, lat: winner.lat, lng: winner.lng },
    estimatedUberCost: Math.round(winner.estimatedFare * 100) / 100,
    transitDurationMinutes: winner.transitDurationMin,
    uberDurationMinutes,
    transitDepartureTime: winner.transitDepartureTime,
    transitArrivalTime: winner.transitArrivalTime,
    hybridArrivalTime,
    totalDurationMinutes: hybridTotal,
    stopsConsidered,
    stopsAfterFareFilter,
    transitSteps: winner.steps,
    transitEncodedPolyline: winner.encodedPolyline,
    uberPolylineGeojson,
    fullTransitDurationMinutes: baselineTransit?.durationMin ?? null,
    fullTransitArrivalTime: baselineTransit?.arrivalTime ?? null,
    minutesEarlier: baselineArrivalUnix
      ? Math.round((baselineArrivalUnix - hybridArrivalUnix) / 60)
      : null,
  };
}

module.exports = { runPipeline };
