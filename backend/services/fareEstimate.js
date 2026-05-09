// Toronto Uber fare rates
const BASE_FARE = 3.50;
const PER_KM_RATE = 1.75;
const PER_MIN_RATE = 0.35;
// Road distance is ~1.4x straight-line; invert to get straight-line from road km
const ROAD_TO_STRAIGHT_LINE_FACTOR = 1.4;

function getSurgeMultiplier(departureTimeISO) {
  const d = new Date(departureTimeISO);
  const day = d.getDay();   // 0=Sun, 1=Mon ... 6=Sat
  const hour = d.getHours();

  // Weekday rush hours: Mon-Fri 7-9am and 4-7pm
  if (day >= 1 && day <= 5) {
    if ((hour >= 7 && hour < 9) || (hour >= 16 && hour < 19)) return 1.4;
  }

  // Fri 10pm-midnight (Fri night starts)
  if (day === 5 && hour >= 22) return 2.0;
  // Sat 0am-3am (carryover from Fri night)
  if (day === 6 && hour < 3) return 2.0;
  // Sat 10pm-midnight (Sat night starts)
  if (day === 6 && hour >= 22) return 2.0;
  // Sun 0am-3am (carryover from Sat night)
  if (day === 0 && hour < 3) return 2.0;

  return 1.0;
}

function estimateFare(roadKm, durationMin, departureTimeISO) {
  const surge = getSurgeMultiplier(departureTimeISO);
  const raw = BASE_FARE + (roadKm * PER_KM_RATE) + (durationMin * PER_MIN_RATE);
  return raw * surge;
}

function maxRadiusKm(budget) {
  if (budget < BASE_FARE) return 0;
  const maxRoadKm = (budget - BASE_FARE) / PER_KM_RATE;
  return maxRoadKm / ROAD_TO_STRAIGHT_LINE_FACTOR;
}

module.exports = { estimateFare, maxRadiusKm, getSurgeMultiplier };
