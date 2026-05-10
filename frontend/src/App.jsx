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

async function fetchSuggestions(query, token, userLocation) {
  if (!query || query.length < 2) return []
  const params = new URLSearchParams({
    q: query,
    access_token: token,
    limit: 5,
    language: 'en',
    types: 'address,poi,place,neighborhood',
  })
  if (userLocation) {
    params.set('proximity', `${userLocation.lng},${userLocation.lat}`)
    if (userLocation.country) params.set('country', userLocation.country)
  }
  const sessionToken = crypto.randomUUID()
  const res = await fetch(
    `https://api.mapbox.com/search/searchbox/v1/suggest?${params}&session_token=${sessionToken}`
  )
  const data = await res.json()
  const suggestions = data.suggestions || []

  // Retrieve full coordinates for each suggestion
  const results = await Promise.all(
    suggestions.map(async s => {
      const r = await fetch(
        `https://api.mapbox.com/search/searchbox/v1/retrieve/${s.mapbox_id}?access_token=${token}&session_token=${sessionToken}`
      )
      const d = await r.json()
      const feature = d.features?.[0]
      if (!feature) return null
      const [lng, lat] = feature.geometry.coordinates
      return {
        id: s.mapbox_id,
        label: [s.name, s.place_formatted].filter(Boolean).join(', '),
        lat,
        lng,
      }
    })
  )
  return results.filter(Boolean)
}

function LocationInput({ id, label, placeholder, token, onSelect, defaultValue, userLocation }) {
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
      const results = await fetchSuggestions(val, token, userLocation)
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
                <span className="suggestion-pin">
                  <svg width="12" height="14" viewBox="0 0 12 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6 0C3.24 0 1 2.24 1 5c0 3.75 5 9 5 9s5-5.25 5-9c0-2.76-2.24-5-5-5zm0 6.5c-.83 0-1.5-.67-1.5-1.5S5.17 3.5 6 3.5 7.5 4.17 7.5 5 6.83 6.5 6 6.5z" fill="currentColor"/>
                  </svg>
                </span>
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
  if (vehicle === 'Subway') return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="2" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="2"/>
      <path d="M3 12h18" stroke="currentColor" strokeWidth="2"/>
      <circle cx="7.5" cy="16.5" r="1.5" fill="currentColor"/>
      <circle cx="16.5" cy="16.5" r="1.5" fill="currentColor"/>
      <path d="M7 22l2-4M17 22l-2-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M8 7h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
  if (vehicle === 'Tram' || vehicle === 'Light rail') return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="3" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="2"/>
      <path d="M4 11h16" stroke="currentColor" strokeWidth="2"/>
      <circle cx="8" cy="20" r="2" stroke="currentColor" strokeWidth="2"/>
      <circle cx="16" cy="20" r="2" stroke="currentColor" strokeWidth="2"/>
      <path d="M8 17v1M16 17v1" stroke="currentColor" strokeWidth="2"/>
      <path d="M8 3V1M16 3V1" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
  if (vehicle === 'Train' || vehicle === 'Commuter train') return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 15V6a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v9" stroke="currentColor" strokeWidth="2"/>
      <path d="M2 15h20" stroke="currentColor" strokeWidth="2"/>
      <circle cx="7" cy="19" r="2" stroke="currentColor" strokeWidth="2"/>
      <circle cx="17" cy="19" r="2" stroke="currentColor" strokeWidth="2"/>
      <path d="M9 19h6" stroke="currentColor" strokeWidth="2"/>
      <path d="M8 6h8M8 10h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2v6h16V5H4zm0 8v3h16v-3H4zM7 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM6 9V6h4v3H6zm6 0V6h4v3h-4z"/>
    </svg>
  )
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
                  <strong>{step.departureTime}</strong> · Board {step.vehicle} <strong>{step.line}</strong> at <strong>{step.departureStop}</strong>
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
              <div className="step-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <path d="M13.5 5.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7z"/>
                </svg>
              </div>
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
  const [userLocation, setUserLocation] = useState(null)

  // Mobile bottom sheet
  const sheetRef = useRef(null)
  const [sheetSnap, setSheetSnap] = useState('peek') // 'peek' | 'mid' | 'full'
  const dragState = useRef(null)

  function onSheetTouchStart(e) {
    dragState.current = { startY: e.touches[0].clientY, snap: sheetSnap }
  }

  function onSheetTouchEnd(e) {
    if (!dragState.current) return
    const dy = dragState.current.startY - e.changedTouches[0].clientY
    if (dy > 60) {
      setSheetSnap(s => s === 'peek' ? 'mid' : 'full')
    } else if (dy < -60) {
      setSheetSnap(s => s === 'full' ? 'mid' : 'peek')
    }
    dragState.current = null
  }

  function onHandleTap() {
    setSheetSnap(s => s === 'peek' ? 'mid' : s === 'mid' ? 'full' : 'peek')
  }

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
          attributionControl: false,
        })
        map.current.addControl(new mapboxgl.NavigationControl(), 'bottom-right')

        // IP-based location fallback, used for search bias until GPS resolves
        fetch('https://ipapi.co/json/')
          .then(r => r.json())
          .then(ip => {
            if (ip.latitude && ip.longitude) {
              setUserLocation(loc => loc ?? { lat: ip.latitude, lng: ip.longitude, country: ip.country_code?.toLowerCase() })
            }
          })
          .catch(() => {})

        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(async pos => {
            const { latitude, longitude } = pos.coords
            map.current.setCenter([longitude, latitude])
            // GPS is more accurate — always override IP location
            setUserLocation({ lat: latitude, lng: longitude })
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

    // Uber-style: dark casing layer underneath, solid white line on top
    addLine('uber-route-casing', data.uberPolylineGeojson.coordinates, '#000000', false, 9)
    addLine('uber-route', data.uberPolylineGeojson.coordinates, '#ffffff', false, 5)
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
    if (e?.preventDefault) e.preventDefault()
    if (!origin || !destination) {
      setError('Please select a location from the dropdown for both fields.')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    setShowSteps(false)
    setSheetSnap('mid')
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
      setSheetSnap('mid')
      if (map.current.isStyleLoaded()) doRender(data)
      else map.current.once('load', () => doRender(data))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const steps = result?.transitFaster ? result.fullTransitSteps : result?.transitSteps

  const resultsBlock = (
    <>
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
            <div className="transit-faster-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2v6h16V5H4zm0 8v3h16v-3H4zM7 20a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM6 9V6h4v3H6zm6 0V6h4v3h-4z"/>
              </svg>
            </div>
            <div>
              <div className="transit-faster-title">Transit is already faster</div>
              <div className="transit-faster-body">
                The full transit route takes <strong>{result.fullTransitDurationMinutes} min</strong>. The best
                transit + Uber hybrid takes ({result.hybridTotalMinutes} min). No Uber needed.
              </div>
            </div>
          </div>
          <div className="gmaps-nudge">
            Open Google Maps and search for this route, look for the <strong>{result.fullTransitDurationMinutes} minute</strong> option.
          </div>
          <button className="steps-toggle" onClick={() => setShowSteps(v => !v)}>
            {showSteps ? 'Hide' : 'Show'} directions
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
                <a className="open-maps-btn" href={result.appleMapsLink} target="_blank" rel="noopener noreferrer">
                  Apple Maps
                </a>
                <a className="open-maps-btn" href={result.googleMapsLink} target="_blank" rel="noopener noreferrer">
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
              <span className="tooltip-wrap">
                <span className="tooltip-icon">?</span>
                <span className="tooltip-text">All costs are estimates based on typical Uber pricing and may not reflect actual fares.</span>
              </span>
              <div className="stat-value">${Math.ceil(result.estimatedUberCost)}</div>
              <div className="stat-label">Cost estimate</div>
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
    </>
  )

  return (
    <div className="app">
      <div ref={mapContainer} className="map-container" />

      {/* ── Mobile top bar (inputs only, no header) ── */}
      <div className="mobile-top-bar">
        {tokenReady && (
          <>
            <LocationInput
              id="origin-m"
              label="From"
              placeholder="e.g. CN Tower, Toronto"
              token={mapboxToken.current}
              onSelect={setOrigin}
              defaultValue={defaultOrigin}
              userLocation={userLocation}
            />
            <LocationInput
              id="destination-m"
              label="To"
              placeholder="e.g. York University"
              token={mapboxToken.current}
              onSelect={setDestination}
              userLocation={userLocation}
            />
          </>
        )}
        <div className="mobile-row">
          <div className="form-group" style={{ flex: '0 0 110px' }}>
            <label htmlFor="budget-m">Budget</label>
            <div className="input-prefix">
              <span>$</span>
              <input
                id="budget-m"
                type="number"
                min="3.50"
                step="0.50"
                value={budget}
                onChange={e => setBudget(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 0 }}>
            <label htmlFor="departure-m">Departure</label>
            <input
              id="departure-m"
              type="datetime-local"
              value={departureTime}
              onChange={e => setDepartureTime(e.target.value)}
              required
            />
          </div>
        </div>
      </div>

      {/* ── Mobile bottom sheet (button + results) ── */}
      <div
        ref={sheetRef}
        className={`panel sheet-${sheetSnap}`}
        onTouchStart={onSheetTouchStart}
        onTouchEnd={onSheetTouchEnd}
      >
        <div className="sheet-handle" onClick={onHandleTap} />
        <div className="mobile-sheet-btn">
          <button className="submit-btn" disabled={loading} onClick={handleSubmit}>
            {loading ? <span className="spinner" /> : 'Find Route'}
          </button>
        </div>
        <div className="mobile-results">
          {resultsBlock}
        </div>
      </div>

      {/* ── Desktop panel (unchanged layout) ── */}
      <div className="panel desktop-panel">
        <div className="panel-header">
          <div className="logo-row">
            <img src="/logo.png" alt="" className="logo-img" />
            <h1 className="logo">UberMaps</h1>
          </div>
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
                userLocation={userLocation}
              />
              <LocationInput
                id="destination"
                label="To"
                placeholder="e.g. York University"
                token={mapboxToken.current}
                onSelect={setDestination}
                userLocation={userLocation}
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

        {resultsBlock}
      </div>
    </div>
  )
}
