require('dotenv').config();

if (!process.env.GOOGLE_MAPS_API_KEY) {
  console.error('ERROR: GOOGLE_MAPS_API_KEY is not set. Exiting.');
  process.exit(1);
}
if (!process.env.MAPBOX_TOKEN) {
  console.warn('WARN: MAPBOX_TOKEN is not set. Map will not render.');
}

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Expose Mapbox token to frontend (never expose Google key)
app.get('/api/config', (req, res) => {
  res.json({ mapboxToken: process.env.MAPBOX_TOKEN || '' });
});

// API routes
app.use('/api/route', require('./routes/route'));

// Serve Vite-built frontend
const frontendDist = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`UberMaps backend listening on http://localhost:${PORT}`);
});
