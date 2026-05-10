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

function LocationInput({ id, label, placeholder, token, onSelect, defaultValue }) {
  const [text, setText] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [confirmed, setConfirmed] = useState(null)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef(null)
  const wrapperRef = useRef(null)

  useEffect(() => {
    if (defaultValue) {
      setText(defaultValue.label)
      setConfirmed(defaultValue)
      onSelect({ lat: defaultValue.lat, lng: defaultValue.lng, label: defaultValue.label })
    }
  }, [defaultValue])

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
    onSelect({ lat: s.lat, lng: s.lng, label: s.label })
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
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [showSteps, setShowSteps] = useState(false)
  const [tokenReady, setTokenReady] = useState(false)
  const [defaultOrigin, setDefaultOrigin] = useState(null)

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(cfg => {
        mapboxToken.current = cfg.mapboxToken
        mapboxgl.accessToken = cfg.mapboxToken
        setTokenReady(true)
        map.current = new mapboxgl.Map({
          container: mapContainer.current,
          style: 'mapbox://styles/mapbox/dark-v11',
          center: [-79.38, 43.65],
          zoom: 11,
        })
        map.current.addControl(new mapboxgl.NavigationControl(), 'bottom-right')

        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(async pos => {
            const { latitude, longitude } = pos.coords
            map.current.setCenter([longitude, latitude])
            const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${cfg.mapboxToken}&limit=1`
            const res = await fetch(url)
            const data = await res.json()
            const label = data.features?.[0]?.place_name
            if (label) setDefaultOrigin({ lat: latitude, lng: longitude, label })
          })
        }
      })
      .catch(() => setError('Failed to load map configuration'))
  }, [])

  const activeLayerIds = useRef([])

  function clearRoutes() {
    if (!map.current) return
    activeLayerIds.current.forEach(id => {
      if (map.current.getLayer(id)) map.current.removeLayer(id)
      if (map.current.getSource(id)) map.current.removeSource(id)
    })
    activeLayerIds.current = []
    if (handoffMarker.current) {
      handoffMarker.current.remove()
      handoffMarker.current = null
    }
  }

  function addLine(id, coords, color, dashed = false, width = 5) {
    const m = map.current
    m.addSource(id, {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } },
    })
    const paint = { 'line-color': color, 'line-width': width, 'line-opacity': 0.9 }
    if (dashed) paint['line-dasharray'] = [2, 1.5]
    m.addLayer({ id, type: 'line', source: id, paint })
    activeLayerIds.current.push(id)
  }

  function renderHybridRoutes(data) {
    clearRoutes()
    const m = map.current
    if (!m) return

    const allCoords = []

    // Draw each transit step individually: transit legs solid blue, walking legs dashed gray
    if (data.transitSteps) {
      data.transitSteps.forEach((step, i) => {
        if (!step.encodedPolyline) return
        const coords = decodePolyline(step.encodedPolyline)
        if (!coords.length) return
        const id = `transit-step-${i}`
        if (step.mode === 'TRANSIT') {
          addLine(id, coords, '#1a73e8', false, 5)
        } else {
          addLine(id, coords, '#888888', true, 3)
        }
        allCoords.push(...coords)
      })
    } else {
      // Fallback to overview polyline if steps have no per-step polylines
      const coords = decodePolyline(data.transitEncodedPolyline)
      addLine('transit-route', coords, '#1a73e8')
      allCoords.push(...coords)
    }

    addLine('uber-route', data.uberPolylineGeojson.coordinates, '#16a34a', true)
    allCoords.push(...data.uberPolylineGeojson.coordinates)

    const popup = new mapboxgl.Popup({ offset: 12 }).setText(`Call Uber here: ${data.handoffStop.fullAddress || data.handoffStop.name}`)
    const el = document.createElement('div')
    el.className = 'handoff-pulse'
    el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#f4511e;border:3px solid #0d0d0d;cursor:pointer;'
    handoffMarker.current = new mapboxgl.Marker({ element: el })
      .setLngLat([data.handoffStop.lng, data.handoffStop.lat])
      .setPopup(popup)
      .addTo(m)

    if (allCoords.length > 0) {
      const bounds = allCoords.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(allCoords[0], allCoords[0]))
      m.fitBounds(bounds, { padding: 60, maxZoom: 14 })
    }
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
      const handoffAddr = data.handoffStop?.fullAddress || data.handoffStop?.name || ''
      data.appleMapsLink = `maps://?saddr=${encodeURIComponent(origin.label)}&daddr=${encodeURIComponent(handoffAddr)}&dirflg=r`
      data.googleMapsLink = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin.label)}&destination=${encodeURIComponent(handoffAddr)}&travelmode=transit`
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
                defaultValue={defaultOrigin}
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

        {loading && (
          <div className="panel-skeleton">
            <div className="skeleton-line" style={{ width: '55%' }} />
            <div className="skeleton-line" style={{ width: '100%', height: '80px' }} />
            <div className="skeleton-line" style={{ width: '100%', height: '120px' }} />
            <div className="skeleton-line" style={{ width: '40%' }} />
          </div>
        )}

        {!loading && result?.transitFaster && (
          <div className="results">
            <div className="transit-faster-banner">
              <div className="transit-faster-icon">🚌</div>
              <div>
                <div className="transit-faster-title">Transit is already faster</div>
                <div className="transit-faster-body">
                  The full transit route takes <strong>{result.fullTransitDurationMinutes} min</strong> — the best
                  transit + Uber hybrid takes ({result.hybridTotalMinutes} min). No Uber needed.
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

        {!loading && result && !result.transitFaster && (
          <div className="results">
            <div className="handoff-banner">
              <span className="handoff-dot" />
              <div style={{ flex: 1 }}>
                <div className="handoff-label">Call Uber Here</div>
                <div className="handoff-name">{result.handoffStop.fullAddress || result.handoffStop.name}</div>
                <div className="handoff-maps-row">
                  <a
                    className="open-maps-btn"
                    href={result.appleMapsLink}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Apple Maps
                  </a>
                  <a
                    className="open-maps-btn"
                    href={result.googleMapsLink}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Google Maps
                  </a>
                </div>
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
              <div className="stat-card hybrid-arrival stat-card--wide">
                <div className="hybrid-arrival-inner">
                  <div>
                    <div className="stat-value">{result.hybridArrivalTime}</div>
                    <div className="stat-label">Hybrid arrives</div>
                  </div>
                  {result.minutesEarlier > 0 && (
                    <div className="stat-faster-badge">
                      {result.minutesEarlier} min earlier
                    </div>
                  )}
                </div>
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

          </div>
        )}
      </div>

    </div>
  )
}
