const express = require('express');
const { runPipeline } = require('../services/pipeline');
const { CITIES } = require('../services/cities');

const router = express.Router();

const USER_FACING_PHRASES = ['Budget is below', 'No transit stops', 'No stops found', 'minimum fare', 'Overpass timeout', 'rate limit'];

router.post('/', async (req, res) => {
  const { origin, destination, budget, departureTime, city } = req.body;

  // Input validation
  if (!origin || !destination || budget == null || !departureTime) {
    return res.status(400).json({ error: 'Missing required fields: origin, destination, budget, departureTime' });
  }
  if (typeof origin.lat !== 'number' || typeof origin.lng !== 'number' ||
      typeof destination.lat !== 'number' || typeof destination.lng !== 'number') {
    return res.status(400).json({ error: 'origin and destination must have numeric lat and lng' });
  }
  if (typeof budget !== 'number' || budget <= 0) {
    return res.status(400).json({ error: 'budget must be a positive number' });
  }
  if (isNaN(Date.parse(departureTime))) {
    return res.status(400).json({ error: 'departureTime must be a valid ISO date string' });
  }
  if (
    origin.lat < -90 || origin.lat > 90 || origin.lng < -180 || origin.lng > 180 ||
    destination.lat < -90 || destination.lat > 90 || destination.lng < -180 || destination.lng > 180
  ) {
    return res.status(400).json({ error: 'Coordinates out of valid range (lat -90..90, lng -180..180)' });
  }
  if (budget > 200) {
    return res.status(400).json({ error: 'budget must be $200 or less' });
  }
  if (city != null && !CITIES[city]) {
    return res.status(400).json({ error: `city must be one of: ${Object.keys(CITIES).join(', ')}` });
  }

  try {
    const result = await runPipeline({ origin, destination, budget, departureTime, city });
    res.json(result);
  } catch (err) {
    const isUserError = USER_FACING_PHRASES.some((p) => err.message.includes(p));
    console.error(`[route] ${isUserError ? 'user error' : 'pipeline error'}:`, err.message);
    res.status(isUserError ? 400 : 502).json({ error: err.message });
  }
});

module.exports = router;
