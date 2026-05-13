import { useState, useEffect, useRef, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE || ''

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

const CITIES = {
  toronto: { label: 'Toronto', center: [-79.38, 43.65], zoom: 11, placeholder: 'e.g. CN Tower, Toronto' },
  vaughan: { label: 'Vaughan', center: [-79.54, 43.84], zoom: 12, placeholder: 'e.g. Vaughan Mills, Vaughan' },
  sf:      { label: 'San Francisco', center: [-122.4194, 37.7749], zoom: 12, placeholder: 'e.g. Golden Gate Bridge, SF' },
  nyc:     { label: 'New York City', center: [-74.006, 40.7128], zoom: 12, placeholder: 'e.g. Times Square, NYC' },
  la:      { label: 'Los Angeles', center: [-118.2437, 34.0522], zoom: 11, placeholder: 'e.g. Hollywood Sign, LA' },
}

function nearestCity(lat, lng) {
  let best = 'toronto', bestDist = Infinity
  for (const [key, city] of Object.entries(CITIES)) {
    const [cLng, cLat] = city.center
    const d = Math.hypot(lat - cLat, lng - cLng)
    if (d < bestDist) { bestDist = d; best = key }
  }
  return best
}

const suggestCache = new Map() // key -> { results, ts }
const SUGGEST_CACHE_TTL = 60_000

async function fetchSuggestions(query, token, userLocation, _sessionToken, signal) {
  if (!query || query.length < 2) return []
  const proximity = userLocation ? `${userLocation.lng},${userLocation.lat}` : null
  const cacheKey = `${query}|${proximity}`
  const cached = suggestCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < SUGGEST_CACHE_TTL) return cached.results

  const params = new URLSearchParams({
    access_token: token,
    autocomplete: true,
    limit: 5,
    language: 'en',
    types: 'address,poi,place,neighborhood',
  })
  if (userLocation) {
    params.set('proximity', proximity)
    if (userLocation.country) params.set('country', userLocation.country)
  }
  const res = await fetch(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params}`,
    { signal }
  )
  const data = await res.json()
  const features = data.features || []
  const results = features.map(f => {
    const [lng, lat] = f.geometry.coordinates
    return {
      id: f.id,
      label: f.place_name,
      lat,
      lng,
    }
  })
  suggestCache.set(cacheKey, { results, ts: Date.now() })
  if (suggestCache.size > 200) suggestCache.delete(suggestCache.keys().next().value)
  return results
}

function LocationInput({ id, label, placeholder, token, onSelect, defaultValue, userLocation, mapRef, isDestination }) {
  const [text, setText] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [confirmed, setConfirmed] = useState(null)
  const [resolvedAddress, setResolvedAddress] = useState(null)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef(null)
  const abortRef = useRef(null)
  const wrapperRef = useRef(null)
  const markerRef = useRef(null)

  function removeMarker() {
    if (markerRef.current) { markerRef.current.remove(); markerRef.current = null }
  }

  function placeMarker(lat, lng) {
    if (!mapRef?.current) return
    removeMarker()
    const el = document.createElement('div')
    el.className = 'location-pin-marker'
    const pinColor = isDestination ? '#e8341a' : '#1a73e8'
    el.innerHTML = `<svg width="24" height="28" viewBox="0 0 24 28" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C7.58 0 4 3.58 4 8c0 6 8 20 8 20s8-14 8-20c0-4.42-3.58-8-8-8zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" fill="${pinColor}"/><path d="M12 0C7.58 0 4 3.58 4 8c0 6 8 20 8 20s8-14 8-20c0-4.42-3.58-8-8-8zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="0.5"/></svg>`

    markerRef.current = new mapboxgl.Marker({ element: el, draggable: true, anchor: 'bottom' })
      .setLngLat([lng, lat])
      .addTo(mapRef.current)

    markerRef.current.on('dragend', async () => {
      const { lng: newLng, lat: newLat } = markerRef.current.getLngLat()
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${newLng},${newLat}.json?access_token=${token}&limit=1`
      try {
        const res = await fetch(url)
        const data = await res.json()
        const newLabel = data.features?.[0]?.place_name ?? `${newLat.toFixed(5)}, ${newLng.toFixed(5)}`
        setText(newLabel)
        setResolvedAddress(newLabel)
        onSelect({ lat: newLat, lng: newLng, label: newLabel })
      } catch {
        const fallback = `${newLat.toFixed(5)}, ${newLng.toFixed(5)}`
        setText(fallback)
        onSelect({ lat: newLat, lng: newLng, label: fallback })
      }
    })
  }

  useEffect(() => {
    if (defaultValue) {
      setText('Your Location')
      setConfirmed(defaultValue)
      setResolvedAddress(null) // GPS location doesn't need a confirmation chip
      onSelect({ lat: defaultValue.lat, lng: defaultValue.lng, label: defaultValue.label })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValue?.label])

  // Remove marker when this input is cleared
  useEffect(() => {
    if (!confirmed) { removeMarker(); setResolvedAddress(null) }
  }, [confirmed])

  useEffect(() => () => removeMarker(), [])

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

    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()
    const signal = abortRef.current.signal

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await fetchSuggestions(val, token, userLocation, null, signal)
        setSuggestions(results)
      } catch (err) {
        if (err.name !== 'AbortError') console.error('fetchSuggestions error:', err)
      }
    }, 500)
  }

  function handlePick(s) {
    setText(s.isUserLocation ? 'Your Location' : s.label)
    setConfirmed(s)
    setResolvedAddress(s.isUserLocation ? null : s.label)
    onSelect({ lat: s.lat, lng: s.lng, label: s.label })
    setSuggestions([])
    setOpen(false)
    if (!s.isUserLocation) placeMarker(s.lat, s.lng)
  }

  function handleFocus() {
    if (suggestions.length > 0) setOpen(true)
    else if (!text) setOpen(true)
  }

  const showYourLocation = open && !text && userLocation
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
          onFocus={handleFocus}
          autoComplete="off"
          className={confirmed ? 'input-confirmed' : ''}
          required
        />

        {showYourLocation && (
          <ul className="suggestions">
            <li onMouseDown={() => handlePick({ ...userLocation, label: userLocation.label ?? 'Your Location', isUserLocation: true })}>
              <span className="suggestion-pin">
                <svg width="12" height="14" viewBox="0 0 12 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M6 0C3.24 0 1 2.24 1 5c0 3.75 5 9 5 9s5-5.25 5-9c0-2.76-2.24-5-5-5zm0 6.5c-.83 0-1.5-.67-1.5-1.5S5.17 3.5 6 3.5 7.5 4.17 7.5 5 6.83 6.5 6 6.5z" fill="currentColor"/>
                </svg>
              </span>
              <span className="suggestion-label">Your Location</span>
            </li>
          </ul>
        )}

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
      {resolvedAddress && (
        <div className="resolved-address">
          <svg width="10" height="12" viewBox="0 0 10 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 0C2.24 0 0 2.24 0 5c0 3.75 5 7 5 7s5-3.25 5-7c0-2.76-2.24-5-5-5zm0 6.5c-.83 0-1.5-.67-1.5-1.5S4.17 3.5 5 3.5 6.5 4.17 6.5 5 5.83 6.5 5 6.5z" fill="currentColor"/>
          </svg>
          <span>{resolvedAddress}</span>
          <span className="resolved-drag-hint">drag pin to adjust</span>
        </div>
      )}
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

function nowDatetimeLocal() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function App() {
  const mapContainer = useRef(null)
  const map = useRef(null)
  const handoffMarker = useRef(null)
  const mapboxToken = useRef('')

  const [selectedCity, setSelectedCity] = useState('toronto')
  const [origin, setOrigin] = useState(null)       // { lat, lng } once confirmed
  const [destination, setDestination] = useState(null)

  useEffect(() => {
    if (!map.current) return
    if (origin && destination) {
      const bounds = new mapboxgl.LngLatBounds(
        [origin.lng, origin.lat],
        [destination.lng, destination.lat]
      )
      map.current.fitBounds(bounds, { padding: 100, maxZoom: 14 })
    } else if (origin) {
      map.current.flyTo({ center: [origin.lng, origin.lat], zoom: 14 })
    } else if (destination) {
      map.current.flyTo({ center: [destination.lng, destination.lat], zoom: 14 })
    }
  }, [origin, destination])
  const [budget, setBudget] = useState('20')
  const [departureTime, setDepartureTime] = useState('now')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [showSteps, setShowSteps] = useState(false)
  const [tokenReady, setTokenReady] = useState(false)
  const [defaultOrigin, setDefaultOrigin] = useState(null)
  const [userLocation, setUserLocation] = useState(null)

  useEffect(() => {
    if (!userLocation) return
    const city = nearestCity(userLocation.lat, userLocation.lng)
    setSelectedCity(city)
    if (map.current) map.current.flyTo({ center: CITIES[city].center, zoom: CITIES[city].zoom })
  }, [userLocation])

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
    fetch(`${API_BASE}/api/config`)
      .then(r => r.json())
      .then(cfg => {
        mapboxToken.current = cfg.mapboxToken
        mapboxgl.accessToken = cfg.mapboxToken
        setTokenReady(true)
        if (!mapboxgl.supported()) {
          setError('Your browser does not support WebGL, which is required for the map. Try enabling hardware acceleration in your browser settings.')
          return
        }
        map.current = new mapboxgl.Map({
          container: mapContainer.current,
          style: 'mapbox://styles/mapbox/dark-v11',
          center: [-79.38, 43.65],
          zoom: 11,
          attributionControl: false,
          failIfMajorPerformanceCaveat: false,
        })
        map.current.addControl(new mapboxgl.NavigationControl(), 'bottom-right')

        // IP-based location fallback, used for search bias until GPS resolves
        fetch('https://ipapi.co/json/')
          .then(r => r.json())
          .then(ip => {
            const lat = parseFloat(ip?.latitude)
            const lng = parseFloat(ip?.longitude)
            if (isFinite(lat) && isFinite(lng)) {
              setUserLocation(loc => loc ?? { lat, lng, country: typeof ip.country_code === 'string' ? ip.country_code.toLowerCase() : undefined })
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
      const res = await fetch(`${API_BASE}/api/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination, budget: parseFloat(budget), departureTime: departureTime === 'now' ? new Date().toISOString() : departureTime, city: selectedCity }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Route calculation failed')
      const handoffAddr = data.handoffStop?.fullAddress || data.handoffStop?.name || ''
      data.appleMapsLink = `maps://?saddr=${encodeURIComponent(origin.label)}&daddr=${encodeURIComponent(handoffAddr)}&dirflg=r`
      data.googleMapsLink = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin.label)}&destination=${encodeURIComponent(handoffAddr)}&travelmode=transit`
      data.fullTransitAppleMapsLink = `maps://?saddr=${encodeURIComponent(origin.label)}&daddr=${encodeURIComponent(destination.label)}&dirflg=r`
      data.fullTransitGoogleMapsLink = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin.label)}&destination=${encodeURIComponent(destination.label)}&travelmode=transit`
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
                The full transit route takes <strong>{result.fullTransitDurationMinutes} min</strong>.{' '}
                {result.hybridTotalMinutes != null && result.hybridTotalMinutes < result.fullTransitDurationMinutes
                  ? <>The best transit + Uber hybrid takes <strong>{result.hybridTotalMinutes} min</strong> but doesn't save enough time to be worthwhile.</>
                  : <>Adding an Uber would be slower or no better. No Uber needed.</>
                }
              </div>
            </div>
          </div>
          <div className="handoff-maps-row">
            <a className="open-maps-btn" href={result.fullTransitAppleMapsLink} target="_blank" rel="noopener noreferrer">
              Apple Maps
            </a>
            <a className="open-maps-btn" href={result.fullTransitGoogleMapsLink} target="_blank" rel="noopener noreferrer">
              Google Maps
            </a>
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
              <div className="stat-value">${result.estimatedUberCost.toFixed(2)}</div>
              <div className="stat-label">Cost estimate</div>
            </div>
            {result.fullTransitArrivalTime && (
              <div className="stat-card full-transit-arrival">
                <div className="stat-value">{result.fullTransitArrivalTime}</div>
                <div className="stat-label">BY TRANSIT ONLY</div>
              </div>
            )}
            <div className="stat-card hybrid-arrival stat-card--wide">
              <div className="hybrid-arrival-inner">
                <div>
                  <div className="stat-value">{result.hybridArrivalTime}</div>
                  <div className="stat-label">WITH UBERMAPS</div>
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
              placeholder={CITIES[selectedCity].placeholder}
              token={mapboxToken.current}
              onSelect={setOrigin}
              defaultValue={defaultOrigin}
              userLocation={userLocation}
              mapRef={map}
            />
            <LocationInput
              id="destination-m"
              label="To"
              placeholder="e.g. destination"
              token={mapboxToken.current}
              onSelect={setDestination}
              userLocation={userLocation}
              mapRef={map}
              isDestination
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
            {departureTime === 'now' ? (
              <input
                type="text"
                readOnly
                value="Now"
                onClick={() => {
                  setDepartureTime(nowDatetimeLocal())
                }}
                style={{ cursor: 'pointer' }}
              />
            ) : (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  id="departure-m"
                  type="datetime-local"
                  value={departureTime}
                  onChange={e => setDepartureTime(e.target.value)}
                  required
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button type="button" onClick={() => setDepartureTime('now')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem', whiteSpace: 'nowrap', padding: '0 2px' }}>Now</button>
              </div>
            )}
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
                placeholder={CITIES[selectedCity].placeholder}
                token={mapboxToken.current}
                onSelect={setOrigin}
                defaultValue={defaultOrigin}
                userLocation={userLocation}
                mapRef={map}
              />
              <LocationInput
                id="destination"
                label="To"
                placeholder="e.g. destination"
                token={mapboxToken.current}
                onSelect={setDestination}
                userLocation={userLocation}
                mapRef={map}
                isDestination
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
            {departureTime === 'now' ? (
              <input
                type="text"
                readOnly
                value="Now"
                onClick={() => {
                  setDepartureTime(nowDatetimeLocal())
                }}
                style={{ cursor: 'pointer' }}
              />
            ) : (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  id="departureTime"
                  type="datetime-local"
                  value={departureTime}
                  onChange={e => setDepartureTime(e.target.value)}
                  required
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button type="button" onClick={() => setDepartureTime('now')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem', whiteSpace: 'nowrap', padding: '0 2px' }}>Now</button>
              </div>
            )}
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
