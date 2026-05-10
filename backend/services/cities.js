const CITIES = {
  toronto: {
    label: 'Toronto',
    center: [-79.38, 43.65],
    zoom: 11,
    timezone: 'America/Toronto',
    placeholder: 'e.g. CN Tower, Toronto',
    fare: { base: 3.50, perKm: 1.75, perMin: 0.35 },
  },
  vaughan: {
    label: 'Vaughan',
    center: [-79.54, 43.84],
    zoom: 12,
    timezone: 'America/Toronto',
    placeholder: 'e.g. Vaughan Mills, Vaughan',
    fare: { base: 3.50, perKm: 1.75, perMin: 0.35 },
  },
  sf: {
    label: 'San Francisco',
    center: [-122.4194, 37.7749],
    zoom: 12,
    timezone: 'America/Los_Angeles',
    placeholder: 'e.g. Golden Gate Bridge, SF',
    fare: { base: 3.85, perKm: 2.10, perMin: 0.45 },
  },
  nyc: {
    label: 'New York City',
    center: [-74.006, 40.7128],
    zoom: 12,
    timezone: 'America/New_York',
    placeholder: 'e.g. Times Square, NYC',
    fare: { base: 4.00, perKm: 2.25, perMin: 0.40 },
  },
  la: {
    label: 'Los Angeles',
    center: [-118.2437, 34.0522],
    zoom: 11,
    timezone: 'America/Los_Angeles',
    placeholder: 'e.g. Hollywood Sign, LA',
    fare: { base: 3.75, perKm: 1.95, perMin: 0.38 },
  },
};

const DEFAULT_CITY = 'toronto';

module.exports = { CITIES, DEFAULT_CITY };
