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
const helmet = require('helmet');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "blob:"],
      workerSrc: ["'self'", "blob:"],
      imgSrc: ["'self'", "data:", "blob:", "*.mapbox.com"],
      connectSrc: ["'self'", "*.mapbox.com", "events.mapbox.com"],
      styleSrc: ["'self'", "https:", "'unsafe-inline'"],
      fontSrc: ["'self'", "https:", "data:"],
    },
  },
}));
app.use(express.json());
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`));
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()) });
});

// Rate limit config endpoint — 60 req/IP/15 min
const configLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many config requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Expose Mapbox token to frontend (never expose Google key)
app.get('/api/config', configLimit, (req, res) => {
  res.json({ mapboxToken: process.env.MAPBOX_TOKEN || '' });
});

// Rate limit route searches: 20 per IP per 10 minutes
const routeLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: { error: 'Too many route requests, please wait a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// API routes
app.use('/api/route', routeLimit, require('./routes/route'));

// Serve Vite-built frontend
const frontendDist = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// Global error handler — must have exactly 4 params for Express to recognize it
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[unhandled express error]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`UberMaps backend listening on http://localhost:${PORT}`);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});
