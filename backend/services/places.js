const axios = require('axios');

const NEARBY_URL = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';

async function fetchStops(lat, lng, radiusMeters) {
  const stops = [];
  let pagetoken = undefined;

  // Up to 3 pages of 20 results each (60 total)
  for (let page = 0; page < 3; page++) {
    const params = {
      location: `${lat},${lng}`,
      radius: Math.min(radiusMeters, 50000), // Places API max radius is 50km
      type: 'transit_station',
      key: process.env.GOOGLE_MAPS_API_KEY,
    };
    if (pagetoken) {
      params.pagetoken = pagetoken;
      // Google requires a short delay before using a page token
      await new Promise(r => setTimeout(r, 2000));
    }

    let data;
    try {
      const res = await axios.get(NEARBY_URL, { params, timeout: 10000 });
      data = res.data;
    } catch (err) {
      throw new Error('Google Places unavailable');
    }

    if (data.status === 'REQUEST_DENIED') throw new Error('Google API key is invalid or missing Places API scope');
    if (data.status === 'OVER_QUERY_LIMIT') throw new Error('Google Places quota exceeded');
    if (data.status === 'ZERO_RESULTS') break;
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') throw new Error(`Google Places error: ${data.status}`);

    for (const place of data.results ?? []) {
      const { lat: pLat, lng: pLng } = place.geometry.location;
      stops.push({
        id: place.place_id,
        name: place.name,
        lat: pLat,
        lng: pLng,
      });
    }

    pagetoken = data.next_page_token;
    if (!pagetoken) break;
  }

  return clusterStops(stops, 250);
}

function clusterStops(stops, clusterRadiusM) {
  const R = 6371000;
  const assigned = new Set();
  const clusters = [];

  for (const stop of stops) {
    if (assigned.has(stop.id)) continue;
    const cluster = [stop];
    assigned.add(stop.id);

    for (const other of stops) {
      if (assigned.has(other.id)) continue;
      const dLat = (other.lat - stop.lat) * Math.PI / 180;
      const dLng = (other.lng - stop.lng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(stop.lat * Math.PI / 180) * Math.cos(other.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      const distM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      if (distM <= clusterRadiusM) {
        cluster.push(other);
        assigned.add(other.id);
      }
    }

    const rep = cluster.find(s => s.name !== 'Unnamed Stop') ?? cluster[0];
    clusters.push(rep);
  }

  return clusters;
}

module.exports = { fetchStops };
