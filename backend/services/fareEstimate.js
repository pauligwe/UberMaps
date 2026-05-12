const { CITIES, DEFAULT_CITY } = require('./cities.js');

// Road distance is ~1.4x straight-line; invert to get straight-line from road km
const ROAD_TO_STRAIGHT_LINE_FACTOR = 1.4;

function getSurgeMultiplier(departureTimeISO, timezone = 'America/Toronto') {
  const d = new Date(departureTimeISO);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    weekday: 'short',
    hour12: false,
  }).formatToParts(d);
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const weekday = parts.find(p => p.type === 'weekday').value; // Mon, Tue, ... Sun

  const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);
  const isFri = weekday === 'Fri';
  const isSat = weekday === 'Sat';
  const isSun = weekday === 'Sun';

  // Weekday rush hours: Mon-Fri 7-9am and 4-7pm
  if (isWeekday && ((hour >= 7 && hour < 9) || (hour >= 16 && hour < 19))) return 1.4;

  // Fri/Sat late night
  if ((isFri && hour >= 22) || (isSat && hour < 3) || (isSat && hour >= 22) || (isSun && hour < 3)) return 2.0;

  return 1.0;
}

function estimateFare(roadKm, durationMin, departureTimeISO, city = DEFAULT_CITY) {
  const cityConfig = CITIES[city] ?? CITIES[DEFAULT_CITY];
  const { fare } = cityConfig;
  const surge = getSurgeMultiplier(departureTimeISO, cityConfig.timezone);
  const raw = fare.base + (roadKm * fare.perKm) + (durationMin * fare.perMin);
  return raw * surge;
}

function maxRadiusKm(budget, city = DEFAULT_CITY) {
  const { fare } = CITIES[city] ?? CITIES[DEFAULT_CITY];
  if (budget < fare.base) return 0;
  const maxRoadKm = (budget - fare.base) / fare.perKm;
  return maxRoadKm / ROAD_TO_STRAIGHT_LINE_FACTOR;
}

module.exports = { estimateFare, maxRadiusKm, getSurgeMultiplier };
