import { useState, useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import './App.css'

function decodePolyline(encoded) {
  const coords = []
  let index = 0, lat = 0, lng = 0
  while (index < encoded.length) {
    let b, shift = 0, result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    lat += (result & 1) ? ~(result >> 1) : (result >> 1)
    shift = 0; result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    lng += (result & 1) ? ~(result >> 1) : (result >> 1)
    coords.push([lng / 1e5, lat / 1e5])
  }
  return coords
}

async function geocode(query, token) {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&country=CA&proximity=-79.38,43.65`
  const res = await fetch(url)
  const data = await res.json()
  if (!data.features?.length) throw new Error(`Could not find: "${query}"`)
  const [lng, lat] = data.features[0].center
  return { lat, lng }
}

function StepList({ steps }) {
  if (!steps?.length) return null
  return (
    <div className="step-list">
      {steps.map((step, i) => (
        <div key={i} className={`step-item step-${step.mode.toLowerCase()}`}>
          {step.mode === 'TRANSIT' ? (
            <>
              <div className="step-icon transit-icon">
                {step.vehicle === 'Subway' ? '🚇' : step.vehicle === 'Bus' ? '🚌' : step.vehicle === 'Tram' ? '🚋' : '🚆'}
              </div>
              <div className="step-body">
                <div className="step-main">
                  Take <strong>{step.vehicle} {step.line}</strong> from <strong>{step.departureStop}</strong>
                </div>
                <div className="step-detail">
                  Get off at <strong>{step.arrivalStop}</strong> · {step.numStops} stop{step.numStops !== 1 ? 's' : ''} · {step.duration}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="step-icon walk-icon">🚶</div>
              <div className="step-body">
                <div className="step-main">{step.instruction}</div>
                <div className="step-detail">{step.distance} · {step.duration}</div>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

export default function App() {
  const mapContainer = useRef(null)
  const map = useRef(null)
  const handoffMarker = useRef(null)
  const mapboxToken = useRef('')

  const [originText, setOriginText] = useState('')
  const [destText, setDestText] = useState('')
  const [budget, setBudget] = useState('20')
  const [departureTime, setDepartureTime] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 2)
    d.setHours(10, 0, 0, 0)
    return d.toISOString().slice(0, 16)
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [showSteps, setShowSteps] = useState(false)

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(cfg => {
        mapboxToken.current = cfg.mapboxToken
        mapboxgl.accessToken = cfg.mapboxToken
        map.current = new mapboxgl.Map({
          container: mapContainer.current,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: [-79.38, 43.65],
          zoom: 11,
        })
        map.current.addControl(new mapboxgl.NavigationControl(), 'bottom-right')
      })
      .catch(() => setError('Failed to load map configuration'))
  }, [])

  function clearRoutes() {
    if (!map.current) return
    ;['transit-route', 'uber-route', 'baseline-route'].forEach(id => {
      if (map.current.getSource(id)) {
        map.current.removeLayer(id)
        map.current.removeSource(id)
      }
    })
    if (handoffMarker.current) {
      handoffMarker.current.remove()
      handoffMarker.current = null
    }
  }

  function addLine(id, coords, color, dashed = false) {
    const m = map.current
    m.addSource(id, {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } },
    })
    const paint = { 'line-color': color, 'line-width': 5, 'line-opacity': 0.9 }
    if (dashed) paint['line-dasharray'] = [2, 1.5]
    m.addLayer({ id, type: 'line', source: id, paint })
  }

  function renderHybridRoutes(data) {
    clearRoutes()
    const m = map.current
    if (!m) return

    const transitCoords = decodePolyline(data.transitEncodedPolyline)
    addLine('transit-route', transitCoords, '#1a73e8')
    addLine('uber-route', data.uberPolylineGeojson.coordinates, '#00b300', true)

    const popup = new mapboxgl.Popup({ offset: 12 }).setText(`Handoff: ${data.handoffStop.name}`)
    handoffMarker.current = new mapboxgl.Marker({ color: '#f4511e' })
      .setLngLat([data.handoffStop.lng, data.handoffStop.lat])
      .setPopup(popup)
      .addTo(m)

    const allCoords = [...transitCoords, ...data.uberPolylineGeojson.coordinates]
    const bounds = allCoords.reduce(
      (b, c) => b.extend(c),
      new mapboxgl.LngLatBounds(allCoords[0], allCoords[0])
    )
    m.fitBounds(bounds, { padding: 60, maxZoom: 14 })
  }

  function renderBaselineRoute(data) {
    clearRoutes()
    const m = map.current
    if (!m) return

    const coords = decodePolyline(data.fullTransitEncodedPolyline)
    addLine('baseline-route', coords, '#1a73e8')

    const bounds = coords.reduce(
      (b, c) => b.extend(c),
      new mapboxgl.LngLatBounds(coords[0], coords[0])
    )
    m.fitBounds(bounds, { padding: 60, maxZoom: 14 })
  }

  function doRender(data) {
    if (data.transitFaster) {
      renderBaselineRoute(data)
    } else {
      renderHybridRoutes(data)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)
    setShowSteps(false)
    clearRoutes()

    try {
      const token = mapboxToken.current
      const [origin, destination] = await Promise.all([
        geocode(originText, token),
        geocode(destText, token),
      ])

      const res = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin,
          destination,
          budget: parseFloat(budget),
          departureTime,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Route calculation failed')

      setResult(data)
      if (map.current.isStyleLoaded()) {
        doRender(data)
      } else {
        map.current.once('load', () => doRender(data))
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const steps = result?.transitFaster ? result.fullTransitSteps : result?.transitSteps

  return (
    <div className="app">
      <div ref={mapContainer} className="map-container" />

      <div className="panel">
        <div className="panel-header">
          <h1 className="logo">UberMaps</h1>
          <p className="tagline">Transit to the handoff, Uber the rest.</p>
        </div>

        <form className="route-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="origin">From</label>
            <input
              id="origin"
              type="text"
              placeholder="e.g. CN Tower, Toronto"
              value={originText}
              onChange={e => setOriginText(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="destination">To</label>
            <input
              id="destination"
              type="text"
              placeholder="e.g. York University"
              value={destText}
              onChange={e => setDestText(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="budget">Uber Budget</label>
            <div className="input-prefix">
              <span>$</span>
              <input
                id="budget"
                type="number"
                min="3.50"
                step="0.50"
                value={budget}
                onChange={e => setBudget(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="departureTime">Departure</label>
            <input
              id="departureTime"
              type="datetime-local"
              value={departureTime}
              onChange={e => setDepartureTime(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? <span className="spinner" /> : 'Find Route'}
          </button>
        </form>

        {error && (
          <div className="error-box">
            <strong>Error:</strong> {error}
          </div>
        )}

        {result?.transitFaster && (
          <div className="results">
            <div className="transit-faster-banner">
              <div className="transit-faster-icon">🚌</div>
              <div>
                <div className="transit-faster-title">Transit is already faster</div>
                <div className="transit-faster-body">
                  The full transit route takes <strong>{result.fullTransitDurationMinutes} min</strong> — faster than the best
                  transit + Uber hybrid ({result.hybridTotalMinutes} min). No Uber needed.
                </div>
              </div>
            </div>

            <div className="gmaps-nudge">
              Open Google Maps and search for this route — look for the <strong>{result.fullTransitDurationMinutes}-minute</strong> transit option.
            </div>

            <button className="steps-toggle" onClick={() => setShowSteps(v => !v)}>
              {showSteps ? 'Hide' : 'Show'} turn-by-turn directions
            </button>
            {showSteps && <StepList steps={result.fullTransitSteps} />}
          </div>
        )}

        {result && !result.transitFaster && (
          <div className="results">
            <div className="handoff-banner">
              <span className="handoff-dot" />
              <div>
                <div className="handoff-label">Handoff Stop</div>
                <div className="handoff-name">{result.handoffStop.name}</div>
              </div>
            </div>

            <div className="stat-grid">
              <div className="stat-card transit">
                <div className="stat-value">{result.transitDurationMinutes} min</div>
                <div className="stat-label">Transit leg</div>
              </div>
              <div className="stat-card uber">
                <div className="stat-value">${result.estimatedUberCost.toFixed(2)}</div>
                <div className="stat-label">Uber est.</div>
              </div>
              <div className="stat-card total">
                <div className="stat-value">{result.totalDurationMinutes} min</div>
                <div className="stat-label">Total time</div>
              </div>
              {result.fullTransitDurationMinutes && (
                <div className="stat-card saved">
                  <div className="stat-value">{result.fullTransitDurationMinutes - result.totalDurationMinutes} min</div>
                  <div className="stat-label">Time saved</div>
                </div>
              )}
            </div>

            <button className="steps-toggle" onClick={() => setShowSteps(v => !v)}>
              {showSteps ? 'Hide' : 'Show'} transit directions
            </button>
            {showSteps && <StepList steps={steps} />}

            <div className="legend">
              <div className="legend-item">
                <span className="legend-line transit-line" />
                Transit to handoff
              </div>
              <div className="legend-item">
                <span className="legend-line uber-line" />
                Uber to destination
              </div>
              <div className="legend-item">
                <span className="legend-dot" />
                Handoff stop
              </div>
            </div>
          </div>
        )}
      </div>

      {loading && (
        <div className="loading-overlay">
          <div className="loading-card">
            <div className="spinner large" />
            <p>Finding optimal route…</p>
            <small>Checking stops near destination</small>
          </div>
        </div>
      )}
    </div>
  )
}
