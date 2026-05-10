const { maxRadiusKm, estimateFare } = require('./fareEstimate');
const { fetchStops } = require('./overpass');
const { getRoadDistanceAndDuration, getOsrmPolyline } = require('./osrm');
const { getTransitTime, getFullTransitRoute } = require('./google');

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

  // Step 3: Fare filter — parallel OSRM calls
  const fareResults = await Promise.allSettled(
    stops.map(async (stop) => {
      const { distanceKm, durationMin } = await getRoadDistanceAndDuration(
        stop.lat, stop.lng, destination.lat, destination.lng
      );
      const fare = estimateFare(distanceKm, durationMin, departureTime);
      if (fare > budget) return null;
      return { ...stop, estimatedFare: fare, uberDurationMin: durationMin };
    })
  );

  const survivingStops = fareResults
    .filter((r) => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value);

  if (survivingStops.length === 0) {
    throw new Error('No stops found within budget after fare calculation');
  }
  const stopsAfterFareFilter = survivingStops.length;

  // Step 4: Transit validation — parallel Google Directions calls
  const transitResults = await Promise.allSettled(
    survivingStops.map(async (stop) => {
      const { durationMin, departureTime: depTime, arrivalTime: arrTime, arrivalUnix, encodedPolyline, steps } = await getTransitTime(
        origin.lat, origin.lng, stop.lat, stop.lng, departureTime
      );
      return { ...stop, transitDurationMin: durationMin, transitDepartureTime: depTime, transitArrivalTime: arrTime, transitArrivalUnix: arrivalUnix, encodedPolyline, steps };
    })
  );

  const validatedStops = transitResults
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);

  if (validatedStops.length === 0) {
    throw new Error('Google Directions returned no valid transit routes to any candidate stop');
  }

  // Step 5: Pick winner — earliest arrival at destination (transit arrival + uber drive time)
  validatedStops.sort((a, b) =>
    (a.transitArrivalUnix + Math.ceil(a.uberDurationMin) * 60) -
    (b.transitArrivalUnix + Math.ceil(b.uberDurationMin) * 60)
  );
  const winner = validatedStops[0];

  const uberDurationMinutes = Math.ceil(winner.uberDurationMin);
  const hybridTotal = winner.transitDurationMin + uberDurationMinutes;

  // Hybrid arrival = when transit drops you at handoff stop + uber drive time
  const hybridArrivalUnix = winner.transitArrivalUnix + uberDurationMinutes * 60;
  const hybridArrivalTime = new Date(hybridArrivalUnix * 1000).toLocaleTimeString('en-CA', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Toronto',
  });

  // Compare arrival times using Unix timestamps (not durations)
  const baselineArrivalUnix = baselineTransit?.arrivalUnix ?? null;
  if (baselineArrivalUnix && baselineArrivalUnix <= hybridArrivalUnix) {
    return {
      transitFaster: true,
      fullTransitDurationMinutes: baselineTransit.durationMin,
      fullTransitDepartureTime: baselineTransit.departureTime,
      fullTransitArrivalTime: baselineTransit.arrivalTime,
      fullTransitSteps: baselineTransit.steps,
      fullTransitEncodedPolyline: baselineTransit.encodedPolyline,
      hybridTotalMinutes: hybridTotal,
    };
  }

  // Step 6: Get Uber leg polyline, assemble hybrid result
  const uberPolylineGeojson = await getOsrmPolyline(
    winner.lat, winner.lng, destination.lat, destination.lng
  );

  return {
    transitFaster: false,
    handoffStop: { name: winner.name, lat: winner.lat, lng: winner.lng },
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
