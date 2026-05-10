import { useState, useEffect, useRef, useCallback } from 'react'
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

async function fetchSuggestions(query, token) {
  if (!query || query.length < 2) return []
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&country=CA&proximity=-79.38,43.65&limit=5`
  const res = await fetch(url)
  const data = await res.json()
  return (data.features || []).map(f => ({
    id: f.id,
    label: f.place_name,
    lat: f.center[1],
    lng: f.center[0],
  }))
}

function LocationInput({ id, label, placeholder, token, onSelect }) {
  const [text, setText] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [confirmed, setConfirmed] = useState(null) // { label, lat, lng }
  const [open, setOpen] = useState(false)
  const debounceRef = useRef(null)
  const wrapperRef = useRef(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handle(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  function handleChange(e) {
    const val = e.target.value
    setText(val)
    setConfirmed(null)
    onSelect(null)
    setOpen(true)

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const results = await fetchSuggestions(val, token)
      setSuggestions(results)
    }, 300)
  }

  function handlePick(s) {
    setText(s.label)
    setConfirmed(s)
    onSelect({ lat: s.lat, lng: s.lng })
    setSuggestions([])
    setOpen(false)
  }

  const showDropdown = open && suggestions.length > 0

  return (
    <div className="form-group" ref={wrapperRef}>
      <label htmlFor={id}>{label}</label>
      <div className="autocomplete-wrap">
        <input
          id={id}
          type="text"
          placeholder={placeholder}
          value={text}
          onChange={handleChange}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          autoComplete="off"
          className={confirmed ? 'input-confirmed' : ''}
          required
        />
        {confirmed && <span className="confirmed-check">✓</span>}
        {showDropdown && (
          <ul className="suggestions">
            {suggestions.map(s => (
              <li key={s.id} onMouseDown={() => handlePick(s)}>
                <span className="suggestion-pin">📍</span>
                <span className="suggestion-label">{s.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function vehicleIcon(vehicle) {
  if (vehicle === 'Subway') return '🚇'
  if (vehicle === 'Bus') return '🚌'
  if (vehicle === 'Tram' || vehicle === 'Light rail') return '🚋'
  if (vehicle === 'Train' || vehicle === 'Commuter train') return '🚆'
  return '🚌'
}

function StepList({ steps, departureTime, arrivalTime }) {
  if (!steps?.length) return null
  return (
    <div className="step-list">
      {(departureTime || arrivalTime) && (
        <div className="step-times-header">
          {departureTime && <span>Departs <strong>{departureTime}</strong></span>}
          {departureTime && arrivalTime && <span className="step-times-sep">→</span>}
          {arrivalTime && <span>Arrives <strong>{arrivalTime}</strong></span>}
        </div>
      )}
      {steps.map((step, i) => (
        <div key={i} className={`step-item step-${step.mode.toLowerCase()}`}>
          {step.mode === 'TRANSIT' ? (
            <>
              <div className="step-icon">{vehicleIcon(step.vehicle)}</div>
              <div className="step-body">
                <div className="step-main">
                  <strong>{step.departureTime}</strong> — Board {step.vehicle} <strong>{step.line}</strong> at <strong>{step.departureStop}</strong>
                </div>
                <div className="step-main step-headsign">
                  Direction: {step.headsign}
                </div>
                <div className="step-detail">
                  Get off at <strong>{step.arrivalStop}</strong> ({step.arrivalTime}) · {step.numStops} stop{step.numStops !== 1 ? 's' : ''} · {step.duration}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="step-icon">🚶</div>
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

  const [origin, setOrigin] = useState(null)       // { lat, lng } once confirmed
  const [destination, setDestination] = useState(null)
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
  const [tokenReady, setTokenReady] = useState(false)

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(cfg => {
        mapboxToken.current = cfg.mapboxToken
        mapboxgl.accessToken = cfg.mapboxToken
        setTokenReady(true)
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
    const bounds = allCoords.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(allCoords[0], allCoords[0]))
    m.fitBounds(bounds, { padding: 60, maxZoom: 14 })
  }

  function renderBaselineRoute(data) {
    clearRoutes()
    const m = map.current
    if (!m) return
    const coords = decodePolyline(data.fullTransitEncodedPolyline)
    addLine('baseline-route', coords, '#1a73e8')
    const bounds = coords.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(coords[0], coords[0]))
    m.fitBounds(bounds, { padding: 60, maxZoom: 14 })
  }

  function doRender(data) {
    if (data.transitFaster) renderBaselineRoute(data)
    else renderHybridRoutes(data)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!origin || !destination) {
      setError('Please select a location from the dropdown for both fields.')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    setShowSteps(false)
    clearRoutes()

    try {
      const res = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination, budget: parseFloat(budget), departureTime }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Route calculation failed')
      setResult(data)
      if (map.current.isStyleLoaded()) doRender(data)
      else map.current.once('load', () => doRender(data))
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
          {tokenReady && (
            <>
              <LocationInput
                id="origin"
                label="From"
                placeholder="e.g. CN Tower, Toronto"
                token={mapboxToken.current}
                onSelect={setOrigin}
              />
              <LocationInput
                id="destination"
                label="To"
                placeholder="e.g. York University"
                token={mapboxToken.current}
                onSelect={setDestination}
              />
            </>
          )}

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
            {showSteps && (
              <StepList
                steps={result.fullTransitSteps}
                departureTime={result.fullTransitDepartureTime}
                arrivalTime={result.fullTransitArrivalTime}
              />
            )}
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
                <div className="stat-label">Transit time</div>
              </div>
              <div className="stat-card uber-time">
                <div className="stat-value">{result.uberDurationMinutes} min</div>
                <div className="stat-label">Uber time</div>
              </div>
              <div className="stat-card uber-cost">
                <div className="stat-value">${result.estimatedUberCost.toFixed(2)}</div>
                <div className="stat-label">Uber cost</div>
              </div>
              {result.fullTransitArrivalTime && (
                <div className="stat-card full-transit-arrival">
                  <div className="stat-value">{result.fullTransitArrivalTime}</div>
                  <div className="stat-label">Transit arrives</div>
                </div>
              )}
              <div className="stat-card hybrid-arrival">
                {result.minutesEarlier > 0 && (
                  <div className="stat-faster-badge">
                    {result.minutesEarlier} min earlier
                  </div>
                )}
                <div className="stat-value">{result.hybridArrivalTime}</div>
                <div className="stat-label">Hybrid arrives</div>
              </div>
            </div>

            <button className="steps-toggle" onClick={() => setShowSteps(v => !v)}>
              {showSteps ? 'Hide' : 'Show'} transit directions
            </button>
            {showSteps && (
              <StepList
                steps={steps}
                departureTime={result.transitDepartureTime}
                arrivalTime={result.transitArrivalTime}
              />
            )}

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
