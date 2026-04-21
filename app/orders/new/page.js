'use client'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '../../../lib/supabase'
import { useRouter } from 'next/navigation'

const prices = { standard: 95, express: 180, same_day: 280 }

// Buscar dirección en Nominatim (OpenStreetMap)
const searchAddress = async (query) => {
  if (!query || query.length < 4) return []
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&countrycodes=mx&addressdetails=1`
  try {
    const res = await fetch(url, { headers: { 'Accept-Language': 'es' } })
    const data = await res.json()
    return data.map(r => ({
      label: r.display_name,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon)
    }))
  } catch { return [] }
}

function AddressInput({ label, value, onChange, onSelect, placeholder }) {
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [timer, setTimer] = useState(null)
  const ref = useRef()

  const handleChange = (e) => {
    const val = e.target.value
    onChange(val)
    clearTimeout(timer)
    if (val.length >= 4) {
      setTimer(setTimeout(async () => {
        const res = await searchAddress(val)
        setResults(res)
        setOpen(res.length > 0)
      }, 500))
    } else {
      setResults([])
      setOpen(false)
    }
  }

  const handleSelect = (r) => {
    onChange(r.label)
    onSelect(r)
    setOpen(false)
    setResults([])
  }

  useEffect(() => {
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <label style={s.label}>{label}</label>
      <input
        style={s.input}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && (
        <div style={s.dropdown}>
          {results.map((r, i) => (
            <div key={i} onClick={() => handleSelect(r)} style={s.dropdownItem}
              onMouseEnter={e => e.target.style.background = '#F3F4F6'}
              onMouseLeave={e => e.target.style.background = '#fff'}>
              📍 {r.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function NewOrder() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mapLoaded, setMapLoaded] = useState(false)
  const mapRef = useRef(null)
  const markersRef = useRef([])

  const [form, setForm] = useState({
    sender_name: '', sender_phone: '', origin_address: '', origin_lat: null, origin_lng: null,
    recipient_name: '', recipient_phone: '', dest_address: '', dest_lat: null, dest_lng: null,
    package_type: 'general', weight_kg: '', service: 'standard', instructions: ''
  })

  // Cargar Leaflet
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => {
      const L = window.L
      const map = L.map('new-order-map').setView([19.4326, -99.1332], 11)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map)
      mapRef.current = map
      setMapLoaded(true)
    }
    document.head.appendChild(script)
  }, [])

  // Actualizar marcadores en el mapa
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return
    const L = window.L
    const map = mapRef.current

    // Limpiar marcadores anteriores
    markersRef.current.forEach(m => map.removeLayer(m))
    markersRef.current = []

    const points = []

    if (form.origin_lat && form.origin_lng) {
      const icon = L.divIcon({ html: '<div style="background:#0F6E56;color:#fff;padding:4px 8px;border-radius:20px;font-size:11px;font-weight:600;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.3)">📦 Origen</div>', className: '', iconAnchor: [30, 12] })
      const m = L.marker([form.origin_lat, form.origin_lng], { icon }).addTo(map)
      markersRef.current.push(m)
      points.push([form.origin_lat, form.origin_lng])
    }

    if (form.dest_lat && form.dest_lng) {
      const icon = L.divIcon({ html: '<div style="background:#185FA5;color:#fff;padding:4px 8px;border-radius:20px;font-size:11px;font-weight:600;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.3)">🏠 Destino</div>', className: '', iconAnchor: [35, 12] })
      const m = L.marker([form.dest_lat, form.dest_lng], { icon }).addTo(map)
      markersRef.current.push(m)
      points.push([form.dest_lat, form.dest_lng])
    }

    if (points.length === 2) {
      // Línea entre origen y destino
      const line = L.polyline(points, { color: '#0F6E56', weight: 3, dashArray: '8 6', opacity: 0.7 }).addTo(map)
      markersRef.current.push(line)
      map.fitBounds(points, { padding: [40, 40] })
    } else if (points.length === 1) {
      map.setView(points[0], 14)
    }
  }, [form.origin_lat, form.origin_lng, form.dest_lat, form.dest_lng, mapLoaded])

  const handleSubmit = async () => {
    if (!form.sender_name || !form.origin_address || !form.recipient_name || !form.dest_address) {
      setError('Completa los campos obligatorios'); return
    }
    setLoading(true); setError('')
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }

      let { data: userData } = await supabase.from('users').select('id').eq('auth_id', session.user.id).single()
      if (!userData) {
        const { data: newUser } = await supabase.from('users').insert({
          auth_id: session.user.id, email: session.user.email,
          full_name: session.user.user_metadata?.full_name || session.user.email, role: 'client'
        }).select('id').single()
        userData = newUser
      }

      const subtotal = prices[form.service]
      const tax = Math.round(subtotal * 0.16 * 100) / 100
      const total = subtotal + tax

      const { data, error: insertError } = await supabase.from('orders').insert({
        client_id: userData.id,
        sender_name: form.sender_name, sender_phone: form.sender_phone,
        origin_address: form.origin_address,
        origin_lat: form.origin_lat, origin_lng: form.origin_lng,
        recipient_name: form.recipient_name, recipient_phone: form.recipient_phone,
        dest_address: form.dest_address,
        dest_lat: form.dest_lat, dest_lng: form.dest_lng,
        package_type: form.package_type, weight_kg: parseFloat(form.weight_kg) || 1,
        service: form.service, instructions: form.instructions,
        subtotal, tax, total, status: 'pending', payment_status: 'pending'
      }).select().single()

      if (insertError) throw insertError
      router.push(`/dashboard?order=${data.tracking_code}`)
    } catch(e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const subtotal = prices[form.service] || 95
  const total = Math.round(subtotal * 1.16 * 100) / 100

  return (
    <div style={s.page}>
      <div style={s.container}>
        <div style={s.header}>
          <button onClick={() => router.push('/dashboard')} style={s.back}>← Volver</button>
          <h1 style={s.title}>Nuevo envío</h1>
        </div>
        {error && <div style={s.error}>{error}</div>}

        <div style={s.grid2}>
          {/* Columna izquierda — formulario */}
          <div>
            <div style={s.card}>
              <h2 style={s.section}>Remitente</h2>
              <div style={s.grid}>
                <div style={s.field}><label style={s.label}>Nombre *</label><input style={s.input} value={form.sender_name} onChange={e=>setForm({...form,sender_name:e.target.value})} placeholder="Tu nombre completo" /></div>
                <div style={s.field}><label style={s.label}>Teléfono</label><input style={s.input} value={form.sender_phone} onChange={e=>setForm({...form,sender_phone:e.target.value})} placeholder="+52 55 0000 0000" /></div>
                <div style={{...s.field,gridColumn:'1/-1'}}>
                  <AddressInput
                    label="Dirección de origen *"
                    value={form.origin_address}
                    onChange={v => setForm({...form, origin_address: v})}
                    onSelect={r => setForm({...form, origin_address: r.label, origin_lat: r.lat, origin_lng: r.lng})}
                    placeholder="Busca la dirección de origen..."
                  />
                </div>
              </div>
            </div>

            <div style={s.card}>
              <h2 style={s.section}>Destinatario</h2>
              <div style={s.grid}>
                <div style={s.field}><label style={s.label}>Nombre *</label><input style={s.input} value={form.recipient_name} onChange={e=>setForm({...form,recipient_name:e.target.value})} placeholder="Nombre del destinatario" /></div>
                <div style={s.field}><label style={s.label}>Teléfono</label><input style={s.input} value={form.recipient_phone} onChange={e=>setForm({...form,recipient_phone:e.target.value})} placeholder="+52 33 0000 0000" /></div>
                <div style={{...s.field,gridColumn:'1/-1'}}>
                  <AddressInput
                    label="Dirección de destino *"
                    value={form.dest_address}
                    onChange={v => setForm({...form, dest_address: v})}
                    onSelect={r => setForm({...form, dest_address: r.label, dest_lat: r.lat, dest_lng: r.lng})}
                    placeholder="Busca la dirección de destino..."
                  />
                </div>
              </div>
            </div>

            <div style={s.card}>
              <h2 style={s.section}>Paquete</h2>
              <div style={s.grid}>
                <div style={s.field}>
                  <label style={s.label}>Tipo</label>
                  <select style={s.input} value={form.package_type} onChange={e=>setForm({...form,package_type:e.target.value})}>
                    <option value="general">Paquetería general</option>
                    <option value="document">Documento / sobre</option>
                    <option value="fragile">Frágil</option>
                    <option value="perishable">Perecedero</option>
                  </select>
                </div>
                <div style={s.field}><label style={s.label}>Peso (kg)</label><input style={s.input} type="number" value={form.weight_kg} onChange={e=>setForm({...form,weight_kg:e.target.value})} placeholder="2.5" /></div>
                <div style={s.field}>
                  <label style={s.label}>Servicio</label>
                  <select style={s.input} value={form.service} onChange={e=>setForm({...form,service:e.target.value})}>
                    <option value="standard">Estándar (3-5 días) — $95</option>
                    <option value="express">Express (1-2 días) — $180</option>
                    <option value="same_day">Mismo día — $280</option>
                  </select>
                </div>
                <div style={{...s.field,gridColumn:'1/-1'}}><label style={s.label}>Instrucciones especiales</label><textarea style={{...s.input,height:70,resize:'vertical'}} value={form.instructions} onChange={e=>setForm({...form,instructions:e.target.value})} placeholder="Ej. Frágil, no voltear..." /></div>
              </div>
            </div>

            <div style={s.summary}>
              <div style={s.summaryRow}><span>Subtotal</span><span>${subtotal}.00</span></div>
              <div style={s.summaryRow}><span>IVA (16%)</span><span>${(subtotal*0.16).toFixed(2)}</span></div>
              <div style={{...s.summaryRow,fontWeight:700,fontSize:16}}><span>Total</span><span>${total} MXN</span></div>
            </div>

            <button style={{...s.btn,opacity:loading?.6:1}} onClick={handleSubmit} disabled={loading}>
              {loading ? 'Creando orden...' : `Crear orden — $${total} MXN`}
            </button>
          </div>

          {/* Columna derecha — mapa */}
          <div style={s.mapCol}>
            <div style={s.mapCard}>
              <div style={{fontWeight:600,fontSize:14,marginBottom:8,color:'#222'}}>
                Vista previa del recorrido
              </div>
              <div style={{fontSize:12,color:'#888',marginBottom:12}}>
                {form.origin_lat && form.dest_lat ? '📍 Origen y destino marcados en el mapa' :
                 form.origin_lat ? '📦 Origen marcado — agrega el destino' :
                 'Busca las direcciones para visualizarlas en el mapa'}
              </div>
              <div id="new-order-map" style={{width:'100%',height:420,borderRadius:8,border:'1px solid #e5e5e5'}} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const s = {
  page: { minHeight:'100vh', background:'#f5f5f5', fontFamily:'sans-serif' },
  container: { maxWidth:1100, margin:'0 auto', padding:'1.5rem' },
  header: { display:'flex', alignItems:'center', gap:12, marginBottom:'1.5rem' },
  back: { background:'none', border:'none', color:'#0F6E56', cursor:'pointer', fontSize:14 },
  title: { fontSize:22, fontWeight:700, color:'#0F6E56' },
  error: { background:'#FCEBEB', color:'#A32D2D', borderRadius:8, padding:'10px 14px', marginBottom:'1rem', fontSize:14 },
  grid2: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, alignItems:'start' },
  card: { background:'#fff', border:'1px solid #e5e5e5', borderRadius:12, padding:'1.25rem', marginBottom:'1rem' },
  section: { fontSize:15, fontWeight:600, color:'#222', marginBottom:'1rem' },
  grid: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 },
  field: { display:'flex', flexDirection:'column', gap:5 },
  label: { fontSize:13, color:'#666' },
  input: { padding:'9px 11px', border:'1px solid #ddd', borderRadius:8, fontSize:14, color:'#222', outline:'none', width:'100%', boxSizing:'border-box' },
  dropdown: { position:'absolute', top:'100%', left:0, right:0, background:'#fff', border:'1px solid #ddd', borderRadius:8, zIndex:100, maxHeight:220, overflowY:'auto', boxShadow:'0 4px 12px rgba(0,0,0,0.1)' },
  dropdownItem: { padding:'9px 12px', cursor:'pointer', fontSize:13, color:'#333', borderBottom:'1px solid #f0f0f0', background:'#fff' },
  summary: { background:'#f9f9f9', border:'1px solid #e5e5e5', borderRadius:12, padding:'1rem', marginBottom:'1rem' },
  summaryRow: { display:'flex', justifyContent:'space-between', fontSize:14, padding:'5px 0', borderBottom:'1px solid #eee' },
  btn: { width:'100%', padding:14, background:'#0F6E56', color:'#fff', border:'none', borderRadius:10, fontSize:16, fontWeight:600, cursor:'pointer' },
  mapCol: { position:'sticky', top:24 },
  mapCard: { background:'#fff', border:'1px solid #e5e5e5', borderRadius:12, padding:'1.25rem' },
}
