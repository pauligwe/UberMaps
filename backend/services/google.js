// Coordinate order: lat,lng (Google uses lat,lng)
const axios = require('axios');

const DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';

async function getTransitTime(originLat, originLng, stopLat, stopLng, departureTimeISO) {
  const departureUnix = Math.floor(new Date(departureTimeISO).getTime() / 1000);

  let response;
  try {
    response = await axios.get(DIRECTIONS_URL, {
      params: {
        origin: `${originLat},${originLng}`,
        destination: `${stopLat},${stopLng}`,
        mode: 'transit',
        departure_time: departureUnix,
        key: process.env.GOOGLE_MAPS_API_KEY,
      },
      timeout: 15000,
    });
  } catch (err) {
    throw new Error(`Google Directions request failed: ${err.message}`);
  }

  const { status, routes } = response.data;

  if (status === 'ZERO_RESULTS') throw new Error('ZERO_RESULTS');
  if (status === 'REQUEST_DENIED') throw new Error('Google API key is invalid or missing');
  if (status === 'OVER_DAILY_LIMIT' || status === 'OVER_QUERY_LIMIT') throw new Error('Google API quota exceeded');
  if (status !== 'OK') throw new Error(`Google Directions error: ${status}`);

  const leg = routes[0].legs[0];

  // Extract human-readable step-by-step directions from the leg
  const steps = leg.steps.map(step => {
    if (step.travel_mode === 'TRANSIT') {
      const t = step.transit_details;
      return {
        mode: 'TRANSIT',
        line: t.line.short_name || t.line.name,
        vehicle: t.line.vehicle.name,
        departureStop: t.departure_stop.name,
        arrivalStop: t.arrival_stop.name,
        numStops: t.num_stops,
        duration: step.duration.text,
      };
    }
    // WALKING step — strip HTML tags from instructions
    return {
      mode: 'WALKING',
      instruction: step.html_instructions.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      duration: step.duration.text,
      distance: step.distance.text,
    };
  });

  return {
    durationMin: Math.ceil(leg.duration.value / 60),
    encodedPolyline: routes[0].overview_polyline.points,
    steps,
  };
}

// Full origin→destination transit route (for baseline comparison)
async function getFullTransitRoute(originLat, originLng, destLat, destLng, departureTimeISO) {
  const departureUnix = Math.floor(new Date(departureTimeISO).getTime() / 1000);

  let response;
  try {
    response = await axios.get(DIRECTIONS_URL, {
      params: {
        origin: `${originLat},${originLng}`,
        destination: `${destLat},${destLng}`,
        mode: 'transit',
        departure_time: departureUnix,
        key: process.env.GOOGLE_MAPS_API_KEY,
      },
      timeout: 15000,
    });
  } catch (err) {
    throw new Error(`Google Directions request failed: ${err.message}`);
  }

  const { status, routes } = response.data;
  if (status === 'ZERO_RESULTS') return null;
  if (status !== 'OK') throw new Error(`Google Directions error: ${status}`);

  const leg = routes[0].legs[0];
  const steps = leg.steps.map(step => {
    if (step.travel_mode === 'TRANSIT') {
      const t = step.transit_details;
      return {
        mode: 'TRANSIT',
        line: t.line.short_name || t.line.name,
        vehicle: t.line.vehicle.name,
        departureStop: t.departure_stop.name,
        arrivalStop: t.arrival_stop.name,
        numStops: t.num_stops,
        duration: step.duration.text,
      };
    }
    return {
      mode: 'WALKING',
      instruction: step.html_instructions.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      duration: step.duration.text,
      distance: step.distance.text,
    };
  });

  return {
    durationMin: Math.ceil(leg.duration.value / 60),
    encodedPolyline: routes[0].overview_polyline.points,
    steps,
  };
}

module.exports = { getTransitTime, getFullTransitRoute };
