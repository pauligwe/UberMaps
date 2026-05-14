# UberMaps

Find the optimal point along your journey where you switch from public transit to Uber, staying within your budget.

## How it works

1. **Radius calculation** — converts your Uber budget to a max straight-line distance using city-specific fare rates
2. **Stop discovery + baseline** — queries Google Places API for transit stops within that radius; simultaneously fetches a full-transit baseline route to compare against
3. **Fare filter** — uses Haversine math (no network calls) to drop stops that would exceed budget or are walkable distance from the destination (<0.5 km)
4. **Candidate ranking** — sorts surviving stops by detour ratio (how far off the direct path they are), breaking ties by longest Uber leg; top 30 advance
5. **Transit validation** — calls Google Directions (transit mode) for up to 30 surviving candidates
6. **Winner selection** — picks the hybrid route with the earliest arrival that beats full transit by ≥5 minutes
7. **Result** — returns the handoff stop, Uber cost estimate, hybrid vs. full-transit comparison, and routes for the map

If no hybrid beats full transit, the app shows the full-transit route with a note that public transit is faster.

## Supported cities

| City | Fare rates |
|------|-----------|
| Toronto / Vaughan | $3.50 base + $1.75/km + $0.35/min |
| New York City | $4.00 base + $2.25/km + $0.40/min |
| San Francisco | $3.85 base + $2.10/km + $0.45/min |
| Los Angeles | $3.75 base + $1.95/km + $0.38/min |

The city selector auto-detects based on your location. Surge multipliers apply in all cities.

## Surge pricing

```
normal               = 1.0×
weekday rush         = 1.4×  (Mon–Fri 7–9am, 4–7pm, local time)
Fri/Sat late night   = 2.0×  (Fri 10pm–Sat 3am, Sat 10pm–Sun 3am)
```

## Prerequisites

- Node.js 20+
- A Google Maps API key with **Directions API** and **Places API** enabled
- A Mapbox token (public token, scoped to your domain)

## Setup

```bash
# 1. Clone and enter the repo
cd UberMaps

# 2. Configure backend
cp backend/.env.example backend/.env
# Edit backend/.env — fill in GOOGLE_MAPS_API_KEY and MAPBOX_TOKEN

# 3. Install dependencies
cd backend && npm install
cd ../frontend && npm install

# 4. Build the frontend
npm run build

# 5. Start the backend (also serves the built frontend)
cd ../backend && npm start
```

Open http://localhost:3001



## Test case

- **From**: CN Tower, Toronto (43.6426, −79.3871)
- **To**: York University (43.7735, −79.5019)
- **Budget**: $20
- **Departure**: Tuesday 10am (no surge)

Expected: a handoff stop reachable by Uber for under $20, selected for earliest hybrid arrival.

## Project structure

```
ubermaps/
├── backend/
│   ├── index.js              # Express server, security middleware, static serving
│   ├── routes/route.js       # POST /api/route — input validation, pipeline dispatch
│   ├── services/
│   │   ├── cities.js         # City configs: center, timezone, fare rates
│   │   ├── fareEstimate.js   # Fare formula + surge + radius math + Haversine (per-city)
│   │   ├── places.js         # Transit stop discovery via Google Places API
│   │   ├── osrm.js           # Polyline via OSRM (road-distance fare filter removed)
│   │   ├── google.js         # Transit time + full route via Google Directions
│   │   └── pipeline.js       # Orchestrates the full algorithm (30s timeout)
│   └── .env.example
└── frontend/
    └── src/
        ├── App.jsx            # Map, city selector, location inputs, draggable pin, cold-start warning
        └── App.css            # Styles
```
