# UberMaps

Find the optimal point along your journey where you switch from public transit to Uber, staying within your budget.

## How it works

1. **Radius calculation** — converts your Uber budget to a max straight-line distance using the fare formula
2. **Stop discovery** — queries Overpass API for all transit stops within that radius around the destination
3. **Fare filter** — runs OSRM road-distance calculations in parallel to drop stops that exceed budget
4. **Transit validation** — calls Google Directions (transit mode) for each surviving stop
5. **Winner selection** — picks the stop with the fastest transit time from origin
6. **Result** — returns the handoff stop, estimated Uber cost, and full route for the map

## Prerequisites

- Node.js 20+ (backend uses Node --watch; frontend requires Node ≥ 18)
- A Google Maps API key with Directions API enabled
- A Mapbox token (public token, scoped to your domain)

## Setup

```bash
# 1. Clone and enter the repo
cd UberMaps

# 2. Configure backend
cp backend/.env.example backend/.env
# Edit backend/.env and fill in GOOGLE_MAPS_API_KEY and MAPBOX_TOKEN

# 3. Install backend dependencies
cd backend && npm install

# 4. Install frontend dependencies
cd ../frontend && npm install

# 5. Build the frontend
npm run build

# 6. Start the backend (serves the built frontend)
cd ../backend && npm run dev
```

Open http://localhost:3001

## Development (hot reload)

Run both servers in separate terminals:

```bash
# Terminal 1 — backend
cd backend && npm run dev

# Terminal 2 — frontend dev server (proxies /api to :3001)
cd frontend && npm run dev
```

Frontend dev server: http://localhost:5173

## Test case

- **From**: CN Tower, Toronto (43.6426, -79.3871)
- **To**: York University (43.7735, -79.5019)
- **Budget**: $20
- **Departure**: Tuesday 10am (no surge)

Expected: a stop near York University reachable by Uber for under $20, selected for fastest transit time.

## Fare formula

```
surge    = 1.0 (normal) | 1.4 (weekday rush) | 2.0 (Fri/Sat night)
raw_fare = $3.50 base + ($1.75 × road_km) + ($0.35 × duration_min)
fare     = raw_fare × surge
```

Rates are hardcoded for Toronto. Surge applies on:
- Weekdays 7–9am and 4–7pm: 1.4×
- Friday 10pm – Saturday 3am: 2.0×
- Saturday 10pm – Sunday 3am: 2.0×

## Project structure

```
ubermaps/
├── backend/
│   ├── index.js              # Express server, /api/config, static file serving
│   ├── routes/route.js       # POST /api/route
│   ├── services/
│   │   ├── fareEstimate.js   # Fare formula + surge + radius math
│   │   ├── overpass.js       # Transit stop discovery
│   │   ├── osrm.js           # Road distance, duration, polyline
│   │   ├── google.js         # Transit time via Google Directions
│   │   └── pipeline.js       # Orchestrates the 6-step algorithm
│   └── .env.example
└── frontend/
    └── src/
        ├── App.jsx            # Map, form, results panel
        └── App.css            # Styles
```
