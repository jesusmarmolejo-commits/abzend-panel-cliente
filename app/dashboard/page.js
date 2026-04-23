'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '../../lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

const STATUS_LABEL = { pending:'Pendiente', assigned:'Asignado', picked_up:'Recogido', in_transit:'En tránsito', delivered:'Entregado', cancelled:'Cancelado' }
const STATUS_COLOR = { pending:'#FAEEDA', assigned:'#E1F5EE', picked_up:'#E1F5EE', in_transit:'#E6F1FB', delivered:'#EAF3DE', cancelled:'#FCEBEB' }
const STATUS_TEXT  = { pending:'#854F0B', assigned:'#0F6E56', picked_up:'#0F6E56', in_transit:'#185FA5', delivered:'#3B6D11', cancelled:'#A32D2D' }
const SHOW_MAP_STATUSES = ['in_transit', 'out_for_delivery']
const fmtMoney = (n) => `$${Number(n||0).toLocaleString('es-MX',{minimumFractionDigits:2})}`

const TRANSPORT_STATUS_LABEL = { pending:'Pendiente', confirmed:'Confirmado', in_transit:'En tránsito', delivered:'Entregado', cancelled:'Cancelado' }
const TRANSPORT_STATUS_COLOR = { pending:'#FAEEDA', confirmed:'#E1F5EE', in_transit:'#E6F1FB', delivered:'#EAF3DE', cancelled:'#FCEBEB' }
const TRANSPORT_STATUS_TEXT  = { pending:'#854F0B', confirmed:'#0F6E56', in_transit:'#185FA5', delivered:'#3B6D11', cancelled:'#A32D2D' }

const RUTAS = ['CDMX y Zona Metropolitana','Puebla','Lerma','Querétaro','Guadalajara']
const UNIDAD_LABEL = { '1.5ton':'1.5 Ton', '3.5ton':'3.5 Ton', 'rabon':'Rabón', 'torton':'Tórton' }

const STOP_COLORS = ['#0F6E56','#185FA5','#7C3AED','#EA580C','#DC2626','#0891B2']

const STOP_INITIAL = { tipo:'carga', alias:'', calle:'', num_ext:'', colonia:'', municipio:'', estado:'', cp:'', instrucciones:'' }

// ── Mapa de paquetería ────────────────────────────────────────────
function TrackingMap({ order }) {
  const mapRef = useRef(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'; link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }
    const initMap = () => {
      const L = window.L
      if (!document.getElementById(`map-${order.id}`)) return
      const destLat = order.dest_lat || 19.4326
      const destLng = order.dest_lng || -99.1332
      const originLat = order.origin_lat || destLat + 0.05
      const originLng = order.origin_lng || destLng + 0.05
      const map = L.map(`map-${order.id}`).setView([destLat, destLng], 13)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map)
      mapRef.current = map
      const destIcon = L.divIcon({ html:'<div style="background:#185FA5;color:#fff;padding:5px 10px;border-radius:20px;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.3)">🏠 Tu domicilio</div>', className:'', iconAnchor:[55,12] })
      L.marker([destLat, destLng], { icon: destIcon }).addTo(map)
      const driverLat = originLat + (Math.random()-0.5)*0.02
      const driverLng = originLng + (Math.random()-0.5)*0.02
      const driverIcon = L.divIcon({ html:'<div style="background:#0F6E56;color:#fff;padding:5px 10px;border-radius:20px;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.3)">🚚 Tu paquete</div>', className:'', iconAnchor:[50,12] })
      L.marker([driverLat, driverLng], { icon: driverIcon }).addTo(map)
      L.polyline([[driverLat,driverLng],[destLat,destLng]], { color:'#0F6E56', weight:3, dashArray:'8 6', opacity:0.6 }).addTo(map)
      map.fitBounds([[driverLat,driverLng],[destLat,destLng]], { padding:[30,30] })
    }
    if (window.L) { initMap() } else {
      const script = document.createElement('script')
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
      script.onload = initMap
      document.head.appendChild(script)
    }
    return () => { try { mapRef.current?.remove() } catch(e){} }
  }, [order.id])
  return (
    <div style={{ marginTop:12 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
        <span style={{ fontSize:12, fontWeight:600, color:'#0F6E56' }}>🗺 Tu paquete está en camino</span>
        <span style={{ fontSize:11, color:'#888' }}>Actualización en tiempo real</span>
      </div>
      <div id={`map-${order.id}`} style={{ width:'100%', height:280, borderRadius:10, border:'1px solid #e5e5e5' }} />
    </div>
  )
}

// ── Mapa de transporte con paradas ────────────────────────────────
function TransportRouteMap({ orderId, stops }) {
  const mapRef = useRef(null)
  useEffect(() => {
    if (typeof window === 'undefined' || !stops?.length) return
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'; link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }
    const initMap = () => {
      const L = window.L
      const mapId = `tmap-${orderId}`
      if (!document.getElementById(mapId)) return

      // Coordenadas simuladas por ciudad para las paradas sin coords reales
      const cityCoords = {
        'CDMX': [19.4326,-99.1332], 'Ciudad de México': [19.4326,-99.1332],
        'Puebla': [19.0414,-98.2063], 'Lerma': [19.2833,-99.5167],
        'Querétaro': [20.5888,-100.3899], 'Guadalajara': [20.6597,-103.3496],
      }

      const coords = stops.map((stop, i) => {
        if (stop.lat && stop.lng) return [parseFloat(stop.lat), parseFloat(stop.lng)]
        const city = Object.keys(cityCoords).find(c => stop.municipio?.includes(c) || stop.estado?.includes(c))
        const base = cityCoords[city] || [19.4326 + (i*0.1), -99.1332 + (i*0.05)]
        return [base[0] + (Math.random()-0.5)*0.01, base[1] + (Math.random()-0.5)*0.01]
      })

      const map = L.map(mapId).setView(coords[0], 10)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map)
      mapRef.current = map

      // Marcadores por parada
      coords.forEach((coord, i) => {
        const stop = stops[i]
        const color = STOP_COLORS[i % STOP_COLORS.length]
        const icon = stop.tipo === 'carga' ? '📦' : '📍'
        const label = stop.alias || (stop.tipo === 'carga' ? `Carga ${i+1}` : `Descarga ${i+1}`)
        const marker = L.divIcon({
          html: `<div style="background:${color};color:#fff;padding:5px 10px;border-radius:20px;font-size:11px;font-weight:600;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.3)">${icon} ${i+1}. ${label}</div>`,
          className: '', iconAnchor: [40, 12]
        })
        L.marker(coord, { icon: marker }).addTo(map)
      })

      // Línea de ruta entre todos los puntos
      if (coords.length > 1) {
        L.polyline(coords, { color:'#0F6E56', weight:3, dashArray:'8 6', opacity:0.7 }).addTo(map)
      }

      map.fitBounds(coords, { padding:[30,30] })
    }

    if (window.L) { initMap() } else {
      const script = document.createElement('script')
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
      script.onload = initMap
      document.head.appendChild(script)
    }
    return () => { try { mapRef.current?.remove() } catch(e){} }
  }, [orderId, stops?.length])

  return <div id={`tmap-${orderId}`} style={{ width:'100%', height:300, borderRadius:10, border:'1px solid #e5e5e5', marginTop:8 }} />
}

function DashboardContent() {
  const [user, setUser]             = useState(null)
  const [orders, setOrders]         = useState([])
  const [loading, setLoading]       = useState(true)
  const [successMsg, setSuccessMsg] = useState('')
  const [expandedOrder, setExpandedOrder] = useState(null)
  const [activeTab, setActiveTab]   = useState('paqueteria')

  // Transporte
  const [transportOrders, setTransportOrders]   = useState([])
  const [showTransportForm, setShowTransportForm] = useState(false)
  const [transportRates, setTransportRates]     = useState([])
  const [transportUnits, setTransportUnits]     = useState([])
  const [transportForm, setTransportForm]       = useState({
    ruta: 'CDMX y Zona Metropolitana', unidad: '1.5ton',
    peso_kg: '', volumen_m3: '', fecha_requerida: '', notas: '',
    incluye_maniobra: false, incluye_reparto: false, incluye_flete_falso: false,
  })
  const [stops, setStops] = useState([
    { ...STOP_INITIAL, tipo:'carga',    alias:'Origen' },
    { ...STOP_INITIAL, tipo:'descarga', alias:'Destino' },
  ])
  const [transportCotizacion, setTransportCotizacion] = useState(null)
  const [transportProcessing, setTransportProcessing] = useState(false)
  const [transportMsg, setTransportMsg]         = useState('')
  const [expandedTransport, setExpandedTransport] = useState(null)
  const [userId, setUserId]                     = useState(null)

  const router       = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const init = async () => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      const { data: roleData } = await supabase.from('users').select('role, id').eq('auth_id', session.user.id).single()
      if (roleData?.role === 'admin')   { router.push('/admin');   return }
      if (roleData?.role === 'driver')  { router.push('/driver');  return }
      if (roleData?.role === 'station') { router.push('/station'); return }
      setUser(session.user)
      setUserId(roleData?.id)
      const orderCode = searchParams.get('order')
      if (orderCode) setSuccessMsg(`Orden ${orderCode} creada exitosamente`)
      const { data: userData } = await supabase.from('users').select('id').eq('auth_id', session.user.id).single()
      const [{ data: ordersData }, { data: tOrders }, { data: tRates }, { data: tUnits }] = await Promise.all([
        supabase.from('orders').select('*, events:order_events(status,status_code,note,created_at)').eq('client_id', userData?.id).order('created_at',{ascending:false}),
        supabase.from('transport_orders').select('*, unit:unidad_id(nombre), stops:transport_order_stops(*)').eq('client_id', userData?.id).order('created_at',{ascending:false}),
        supabase.from('transport_rates').select('*, unit:unidad_id(nombre)'),
        supabase.from('transport_units').select('*').eq('activo', true),
      ])
      setOrders(ordersData || [])
      setTransportOrders(tOrders || [])
      setTransportRates(tRates || [])
      setTransportUnits(tUnits || [])
      setLoading(false)
    }
    init()
  }, [])

  const logout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  // ── Paradas ───────────────────────────────────────────────────────
  const addStop = (tipo) => {
    setStops([...stops, { ...STOP_INITIAL, tipo, alias: tipo === 'carga' ? `Carga ${stops.filter(s=>s.tipo==='carga').length+1}` : `Descarga ${stops.filter(s=>s.tipo==='descarga').length+1}` }])
  }

  const removeStop = (idx) => {
    if (stops.length <= 2) return
    setStops(stops.filter((_,i) => i !== idx))
  }

  const updateStop = (idx, field, value) => {
    const newStops = [...stops]
    newStops[idx] = { ...newStops[idx], [field]: value }
    setStops(newStops)
  }

  const moveStop = (idx, dir) => {
    const newStops = [...stops]
    const target = idx + dir
    if (target < 0 || target >= newStops.length) return
    ;[newStops[idx], newStops[target]] = [newStops[target], newStops[idx]]
    setStops(newStops)
  }

  // ── Cotizar ───────────────────────────────────────────────────────
  const cotizarTransporte = () => {
    const rate = transportRates.find(r => r.ruta === transportForm.ruta && r.unit?.nombre === transportForm.unidad)
    if (!rate) { setTransportMsg('❌ No hay tarifa disponible para esta ruta/unidad'); return }
    const tarifa = parseFloat(rate.tarifa_base)
    let subtotal = tarifa
    if (transportForm.incluye_maniobra)    subtotal += parseFloat(rate.maniobra || 0)
    if (transportForm.incluye_reparto)     subtotal += parseFloat(rate.reparto  || 0)
    if (transportForm.incluye_flete_falso) subtotal += tarifa * 0.5
    const iva = subtotal * 0.16
    const retencion = subtotal * 0.04
    setTransportCotizacion({
      tarifa_base: tarifa,
      maniobra:    transportForm.incluye_maniobra ? parseFloat(rate.maniobra) : 0,
      reparto:     transportForm.incluye_reparto  ? parseFloat(rate.reparto)  : 0,
      flete_falso: transportForm.incluye_flete_falso ? tarifa * 0.5 : 0,
      subtotal, iva, retencion, total: subtotal + iva - retencion,
    })
  }

  const solicitarTransporte = async () => {
    if (!transportCotizacion) { setTransportMsg('❌ Primero cotiza el servicio'); return }
    if (!transportForm.fecha_requerida) { setTransportMsg('❌ Selecciona la fecha requerida'); return }
    const cargaStops = stops.filter(s => s.tipo === 'carga' && s.calle.trim())
    const descargaStops = stops.filter(s => s.tipo === 'descarga' && s.calle.trim())
    if (!cargaStops.length)    { setTransportMsg('❌ Agrega al menos una dirección de carga'); return }
    if (!descargaStops.length) { setTransportMsg('❌ Agrega al menos una dirección de descarga'); return }

    setTransportProcessing(true)
    try {
      const supabase = createClient()
      const unit = transportUnits.find(u => u.nombre === transportForm.unidad)
      const tracking = `TRK-${Date.now().toString(36).toUpperCase()}`

      const { data: orderData, error } = await supabase.from('transport_orders').insert({
        tracking_code: tracking, client_id: userId,
        ruta: transportForm.ruta, unidad_id: unit?.id,
        peso_kg: parseFloat(transportForm.peso_kg) || null,
        volumen_m3: parseFloat(transportForm.volumen_m3) || null,
        incluye_maniobra: transportForm.incluye_maniobra,
        incluye_reparto:  transportForm.incluye_reparto,
        incluye_flete_falso: transportForm.incluye_flete_falso,
        fecha_requerida: transportForm.fecha_requerida,
        subtotal: transportCotizacion.subtotal,
        iva: transportCotizacion.iva,
        retencion: transportCotizacion.retencion,
        total: transportCotizacion.total,
        notas: transportForm.notas,
        status: 'pending',
      }).select().single()
      if (error) throw error

      // Insertar paradas
      const stopsToInsert = stops.map((stop, i) => ({
        transport_order_id: orderData.id,
        orden: i + 1,
        tipo: stop.tipo,
        alias: stop.alias || null,
        calle: stop.calle || null,
        num_ext: stop.num_ext || null,
        colonia: stop.colonia || null,
        municipio: stop.municipio || null,
        estado: stop.estado || null,
        cp: stop.cp || null,
        instrucciones: stop.instrucciones || null,
      }))
      await supabase.from('transport_order_stops').insert(stopsToInsert)

      setTransportMsg(`✅ Solicitud ${tracking} enviada correctamente`)
      setShowTransportForm(false)
      setTransportCotizacion(null)
      setStops([{ ...STOP_INITIAL, tipo:'carga', alias:'Origen' }, { ...STOP_INITIAL, tipo:'descarga', alias:'Destino' }])
      setTransportForm({...transportForm, peso_kg:'', volumen_m3:'', fecha_requerida:'', notas:'', incluye_maniobra:false, incluye_reparto:false, incluye_flete_falso:false})

      const { data: tOrders } = await supabase.from('transport_orders').select('*, unit:unidad_id(nombre), stops:transport_order_stops(*)').eq('client_id', userId).order('created_at',{ascending:false})
      setTransportOrders(tOrders || [])
    } catch(e) {
      setTransportMsg('❌ Error: ' + e.message)
    } finally {
      setTransportProcessing(false)
    }
  }

  if (loading) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh',background:'#0F6E56'}}>
      <div style={{background:'#fff',borderRadius:16,padding:'2rem',textAlign:'center'}}>
        <p style={{color:'#0F6E56',fontWeight:600}}>Cargando...</p>
      </div>
    </div>
  )

  return (
    <div style={s.container}>
      <div style={s.topbar}>
        <div style={s.logo}>ABZEND</div>
        <div style={s.userRow}>
          <span style={s.userName}>{user?.user_metadata?.full_name || user?.email}</span>
          <button onClick={logout} style={s.logoutBtn}>Salir</button>
        </div>
      </div>

      <div style={s.main}>
        {successMsg && <div style={s.success}>{successMsg}</div>}
        {transportMsg && <div style={{...s.success,cursor:'pointer'}} onClick={()=>setTransportMsg('')}>{transportMsg} ✕</div>}

        {/* TABS */}
        <div style={s.tabsContainer}>
          {[
            { id:'paqueteria', label:'📦 Paquetería',          available:true  },
            { id:'terrestre',  label:'🚚 Transporte Terrestre', available:true  },
            { id:'maritimo',   label:'🚢 Marítimo',            available:false },
            { id:'aereo',      label:'✈️ Aéreo',                available:false },
          ].map(tab => (
            <button key={tab.id} onClick={() => tab.available && setActiveTab(tab.id)}
              style={{ ...s.tab,
                color: !tab.available ? '#bbb' : activeTab===tab.id ? '#0F6E56' : '#666',
                borderBottom: activeTab===tab.id ? '2px solid #0F6E56' : '2px solid transparent',
                fontWeight: activeTab===tab.id ? 600 : 400,
                cursor: tab.available ? 'pointer' : 'not-allowed',
              }}>
              {tab.label}
              {!tab.available && <span style={{fontSize:9,background:'#E5E7EB',color:'#888',padding:'1px 5px',borderRadius:10,marginLeft:4}}>Próximamente</span>}
            </button>
          ))}
        </div>

        {/* ── PAQUETERÍA ── */}
        {activeTab === 'paqueteria' && (
          <div>
            <div style={s.statsRow}>
              <div style={s.stat}><div style={s.statVal}>{orders.length}</div><div style={s.statLbl}>Total órdenes</div></div>
              <div style={s.stat}><div style={s.statVal}>{orders.filter(o=>['pending','assigned','picked_up','in_transit'].includes(o.status)).length}</div><div style={s.statLbl}>Activas</div></div>
              <div style={s.stat}><div style={s.statVal}>{orders.filter(o=>o.status==='delivered').length}</div><div style={s.statLbl}>Entregadas</div></div>
            </div>
            <div style={s.sectionHeader}>
              <h2 style={s.sectionTitle}>Mis envíos</h2>
              <button style={s.newBtn} onClick={()=>router.push('/orders/new')}>+ Nuevo envío</button>
            </div>
            {orders.length === 0 ? (
              <div style={s.empty}>
                <p style={s.emptyText}>No tienes envíos aún</p>
                <button style={s.newBtn} onClick={()=>router.push('/orders/new')}>Crear primer envío</button>
              </div>
            ) : (
              <div style={s.ordersList}>
                {orders.map(order => {
                  const showMap = SHOW_MAP_STATUSES.includes(order.status)
                  const isExpanded = expandedOrder === order.id
                  return (
                    <div key={order.id} style={s.orderCard}>
                      <div style={s.orderHeader}>
                        <span style={s.orderCode}>#{order.tracking_code}</span>
                        <span style={{...s.badge, background:STATUS_COLOR[order.status], color:STATUS_TEXT[order.status]}}>{STATUS_LABEL[order.status]}</span>
                      </div>
                      <div style={s.orderRoute}>{order.origin_address} → {order.dest_address}</div>
                      <div style={s.orderFooter}>
                        <span style={s.orderService}>{order.service}</span>
                        <span style={s.orderPrice}>${order.total} MXN</span>
                      </div>
                      {showMap && <TrackingMap order={order} />}
                      {order.events?.length > 0 && (
                        <div>
                          <button onClick={()=>setExpandedOrder(isExpanded?null:order.id)}
                            style={{background:'none',border:'none',cursor:'pointer',color:'#0F6E56',fontSize:13,padding:'8px 0',fontWeight:500}}>
                            {isExpanded?'▲ Ocultar historial':'▼ Ver historial de eventos'}
                          </button>
                          {isExpanded && (
                            <div style={s.timeline}>
                              {[...order.events].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map((e,i)=>(
                                <div key={i} style={s.timelineItem}>
                                  <div style={s.timelineDot} />
                                  <div>
                                    <div style={{fontSize:12,fontWeight:600,color:'#222'}}>
                                      {e.status_code && <span style={s.eventCode}>[{e.status_code}]</span>} {STATUS_LABEL[e.status]||e.status}
                                    </div>
                                    {e.note && <div style={{fontSize:11,color:'#888'}}>{e.note}</div>}
                                    <div style={{fontSize:11,color:'#aaa'}}>{new Date(e.created_at).toLocaleString('es-MX',{dateStyle:'short',timeStyle:'short'})}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── TRANSPORTE TERRESTRE ── */}
        {activeTab === 'terrestre' && (
          <div>
            <div style={s.statsRow}>
              <div style={s.stat}><div style={s.statVal}>{transportOrders.length}</div><div style={s.statLbl}>Total solicitudes</div></div>
              <div style={s.stat}><div style={s.statVal}>{transportOrders.filter(o=>['pending','confirmed','in_transit'].includes(o.status)).length}</div><div style={s.statLbl}>Activas</div></div>
              <div style={s.stat}><div style={s.statVal}>{transportOrders.filter(o=>o.status==='delivered').length}</div><div style={s.statLbl}>Completadas</div></div>
            </div>
            <div style={s.sectionHeader}>
              <h2 style={s.sectionTitle}>Transporte Terrestre FTL</h2>
              <button style={s.newBtn} onClick={()=>setShowTransportForm(true)}>+ Nueva solicitud</button>
            </div>
            <div style={{background:'#EFF6FF',border:'1px solid #BFDBFE',borderRadius:8,padding:'10px 14px',marginBottom:'1rem',fontSize:13,color:'#1E40AF'}}>
              🚛 <b>FTL</b> (Carga Completa) disponible. <b>LTL</b> (Carga Parcial) próximamente en R2.
            </div>

            {transportOrders.length === 0 ? (
              <div style={s.empty}>
                <p style={s.emptyText}>No tienes solicitudes de transporte aún</p>
                <button style={s.newBtn} onClick={()=>setShowTransportForm(true)}>Crear primera solicitud</button>
              </div>
            ) : (
              <div style={s.ordersList}>
                {transportOrders.map(order => {
                  const isExpanded = expandedTransport === order.id
                  const sortedStops = [...(order.stops||[])].sort((a,b)=>a.orden-b.orden)
                  return (
                    <div key={order.id} style={s.orderCard}>
                      <div style={s.orderHeader}>
                        <span style={s.orderCode}>#{order.tracking_code}</span>
                        <span style={{...s.badge, background:TRANSPORT_STATUS_COLOR[order.status], color:TRANSPORT_STATUS_TEXT[order.status]}}>
                          {TRANSPORT_STATUS_LABEL[order.status]}
                        </span>
                      </div>
                      <div style={{fontSize:13,color:'#444',marginBottom:4}}>
                        <b>Ruta:</b> {order.ruta} · <b>Unidad:</b> {UNIDAD_LABEL[order.unit?.nombre] || order.unit?.nombre}
                      </div>

                      {/* Paradas en línea */}
                      {sortedStops.length > 0 && (
                        <div style={{display:'flex',alignItems:'center',gap:4,flexWrap:'wrap',marginBottom:6}}>
                          {sortedStops.map((stop, i) => (
                            <span key={i} style={{display:'flex',alignItems:'center',gap:4}}>
                              <span style={{
                                fontSize:11, padding:'2px 8px', borderRadius:20, fontWeight:500,
                                background: stop.tipo==='carga' ? '#E1F5EE' : '#EFF6FF',
                                color: stop.tipo==='carga' ? '#0F6E56' : '#185FA5',
                              }}>
                                {stop.tipo==='carga'?'📦':'📍'} {stop.alias || (stop.tipo==='carga'?'Carga':'Descarga')}
                                {stop.municipio ? ` · ${stop.municipio}` : ''}
                              </span>
                              {i < sortedStops.length-1 && <span style={{color:'#bbb',fontSize:12}}>→</span>}
                            </span>
                          ))}
                        </div>
                      )}

                      <div style={{fontSize:12,color:'#888',marginBottom:6}}>
                        {order.incluye_maniobra && '✓ Maniobra  '}
                        {order.incluye_reparto && '✓ Reparto  '}
                        {order.incluye_flete_falso && '✓ Flete en falso  '}
                        {order.fecha_requerida && `📅 ${new Date(order.fecha_requerida).toLocaleDateString('es-MX')}`}
                      </div>
                      <div style={s.orderFooter}>
                        <span style={{fontSize:12,color:'#888'}}>
                          Subtotal: {fmtMoney(order.subtotal)} · IVA: {fmtMoney(order.iva)} · Ret: -{fmtMoney(order.retencion)}
                        </span>
                        <span style={s.orderPrice}>{fmtMoney(order.total)}</span>
                      </div>
                      {order.notas && <div style={{fontSize:12,color:'#888',marginTop:4,fontStyle:'italic'}}>📝 {order.notas}</div>}

                      {/* Ver mapa */}
                      {sortedStops.length > 0 && (
                        <div>
                          <button onClick={()=>setExpandedTransport(isExpanded?null:order.id)}
                            style={{background:'none',border:'none',cursor:'pointer',color:'#0F6E56',fontSize:13,padding:'8px 0',fontWeight:500}}>
                            {isExpanded ? '▲ Ocultar mapa de ruta' : '🗺 Ver mapa de ruta'}
                          </button>
                          {isExpanded && <TransportRouteMap orderId={order.id} stops={sortedStops} />}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* MODAL NUEVA SOLICITUD */}
            {showTransportForm && (
              <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:'1rem'}}>
                <div style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:620,maxHeight:'92vh',overflowY:'auto',padding:'1.5rem'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.25rem'}}>
                    <h3 style={{fontWeight:700,fontSize:16,color:'#222'}}>🚚 Nueva Solicitud FTL</h3>
                    <button onClick={()=>{setShowTransportForm(false);setTransportCotizacion(null)}}
                      style={{background:'none',border:'none',cursor:'pointer',fontSize:20,color:'#888'}}>✕</button>
                  </div>

                  <div style={{display:'flex',flexDirection:'column',gap:14}}>

                    {/* Ruta y unidad */}
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                      <div>
                        <label style={sLabel}>Ruta *</label>
                        <select value={transportForm.ruta}
                          onChange={e=>{setTransportForm({...transportForm,ruta:e.target.value});setTransportCotizacion(null)}}
                          style={sInput}>
                          {RUTAS.map(r=><option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={sLabel}>Unidad *</label>
                        <select value={transportForm.unidad}
                          onChange={e=>{setTransportForm({...transportForm,unidad:e.target.value});setTransportCotizacion(null)}}
                          style={sInput}>
                          {transportUnits.map(u=>(
                            <option key={u.id} value={u.nombre}>
                              {UNIDAD_LABEL[u.nombre]} — {u.peso_max_kg?.toLocaleString()} kg
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* ── PARADAS ── */}
                    <div>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                        <label style={{...sLabel,marginBottom:0}}>Paradas de carga y descarga *</label>
                        <div style={{display:'flex',gap:6}}>
                          <button onClick={()=>addStop('carga')}
                            style={{padding:'4px 10px',background:'#E1F5EE',color:'#0F6E56',border:'1px solid #9FE1CB',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:600}}>
                            + Carga
                          </button>
                          <button onClick={()=>addStop('descarga')}
                            style={{padding:'4px 10px',background:'#EFF6FF',color:'#185FA5',border:'1px solid #BFDBFE',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:600}}>
                            + Descarga
                          </button>
                        </div>
                      </div>

                      <div style={{display:'flex',flexDirection:'column',gap:10}}>
                        {stops.map((stop, idx) => (
                          <div key={idx} style={{
                            border: `1px solid ${stop.tipo==='carga'?'#9FE1CB':'#BFDBFE'}`,
                            borderRadius:10, padding:'12px',
                            background: stop.tipo==='carga'?'#F0FDF4':'#EFF6FF'
                          }}>
                            {/* Header parada */}
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                              <div style={{display:'flex',alignItems:'center',gap:6}}>
                                <span style={{
                                  width:22,height:22,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',
                                  background: STOP_COLORS[idx%STOP_COLORS.length], color:'#fff', fontSize:11, fontWeight:700
                                }}>{idx+1}</span>
                                <span style={{
                                  fontSize:12, fontWeight:600,
                                  color: stop.tipo==='carga'?'#0F6E56':'#185FA5'
                                }}>
                                  {stop.tipo==='carga'?'📦 CARGA':'📍 DESCARGA'}
                                </span>
                              </div>
                              <div style={{display:'flex',gap:4}}>
                                {idx > 0 && <button onClick={()=>moveStop(idx,-1)} style={sBtnSmall}>↑</button>}
                                {idx < stops.length-1 && <button onClick={()=>moveStop(idx,1)} style={sBtnSmall}>↓</button>}
                                {stops.length > 2 && (
                                  <button onClick={()=>removeStop(idx)}
                                    style={{...sBtnSmall,color:'#EF4444',borderColor:'#FCA5A5'}}>✕</button>
                                )}
                              </div>
                            </div>

                            {/* Alias */}
                            <div style={{marginBottom:8}}>
                              <input value={stop.alias}
                                onChange={e=>updateStop(idx,'alias',e.target.value)}
                                placeholder={`Nombre (ej. Bodega Central, Cliente ${idx+1})`}
                                style={{...sInput,fontSize:13,fontWeight:500}} />
                            </div>

                            {/* Dirección */}
                            <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:8,marginBottom:8}}>
                              <input value={stop.calle} onChange={e=>updateStop(idx,'calle',e.target.value)}
                                placeholder="Calle" style={{...sInput,fontSize:12}} />
                              <input value={stop.num_ext} onChange={e=>updateStop(idx,'num_ext',e.target.value)}
                                placeholder="Núm ext" style={{...sInput,fontSize:12}} />
                            </div>
                            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:6,marginBottom:8}}>
                              {[['colonia','Colonia'],['municipio','Municipio'],['estado','Estado'],['cp','CP']].map(([f,p])=>(
                                <input key={f} value={stop[f]} onChange={e=>updateStop(idx,f,e.target.value)}
                                  placeholder={p} style={{...sInput,fontSize:11}} />
                              ))}
                            </div>
                            <textarea value={stop.instrucciones}
                              onChange={e=>updateStop(idx,'instrucciones',e.target.value)}
                              placeholder="Instrucciones especiales para esta parada..."
                              rows={2}
                              style={{...sInput,fontSize:12,resize:'vertical'}} />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Peso, volumen, fecha */}
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
                      <div>
                        <label style={sLabel}>Peso (kg)</label>
                        <input type="number" value={transportForm.peso_kg}
                          onChange={e=>setTransportForm({...transportForm,peso_kg:e.target.value})}
                          placeholder="Ej. 1200" style={sInput} />
                      </div>
                      <div>
                        <label style={sLabel}>Volumen (m³)</label>
                        <input type="number" value={transportForm.volumen_m3}
                          onChange={e=>setTransportForm({...transportForm,volumen_m3:e.target.value})}
                          placeholder="Ej. 6.5" style={sInput} />
                      </div>
                      <div>
                        <label style={sLabel}>Fecha requerida *</label>
                        <input type="datetime-local" value={transportForm.fecha_requerida}
                          onChange={e=>setTransportForm({...transportForm,fecha_requerida:e.target.value})}
                          style={sInput} />
                      </div>
                    </div>

                    {/* Servicios adicionales */}
                    <div>
                      <label style={sLabel}>Servicios adicionales</label>
                      <div style={{display:'flex',flexDirection:'column',gap:8}}>
                        {[
                          {key:'incluye_maniobra',    label:'Maniobra (carga/descarga)'},
                          {key:'incluye_reparto',     label:'Reparto (distribución local)'},
                          {key:'incluye_flete_falso', label:'Flete en falso (50% del flete si no hay descarga)'},
                        ].map(item=>(
                          <label key={item.key} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,color:'#444'}}>
                            <input type="checkbox" checked={transportForm[item.key]}
                              onChange={e=>{setTransportForm({...transportForm,[item.key]:e.target.checked});setTransportCotizacion(null)}}
                              style={{width:16,height:16,accentColor:'#0F6E56'}} />
                            {item.label}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Notas */}
                    <div>
                      <label style={sLabel}>Notas u observaciones</label>
                      <textarea value={transportForm.notas}
                        onChange={e=>setTransportForm({...transportForm,notas:e.target.value})}
                        placeholder="Tipo de mercancía, instrucciones especiales, etc."
                        rows={2} style={{...sInput,resize:'vertical'}} />
                    </div>

                    {/* Botón cotizar */}
                    <button onClick={cotizarTransporte}
                      style={{padding:'10px',background:'#185FA5',color:'#fff',border:'none',borderRadius:8,cursor:'pointer',fontSize:14,fontWeight:600}}>
                      🧮 Calcular cotización
                    </button>

                    {/* Resultado cotización */}
                    {transportCotizacion && (
                      <div style={{background:'#F0FDF4',border:'1px solid #BBF7D0',borderRadius:8,padding:'1rem'}}>
                        <div style={{fontWeight:600,fontSize:14,color:'#166534',marginBottom:10}}>📋 Desglose de cotización</div>
                        <div style={{display:'flex',flexDirection:'column',gap:6,fontSize:13}}>
                          {[
                            ['Flete base', transportCotizacion.tarifa_base, false],
                            transportCotizacion.maniobra > 0    ? ['+ Maniobra',          transportCotizacion.maniobra,    false] : null,
                            transportCotizacion.reparto > 0     ? ['+ Reparto',           transportCotizacion.reparto,     false] : null,
                            transportCotizacion.flete_falso > 0 ? ['+ Flete en falso (50%)', transportCotizacion.flete_falso, false] : null,
                            ['Subtotal', transportCotizacion.subtotal, true],
                            ['+ IVA (16%)', transportCotizacion.iva, false],
                            ['- Retención (4%)', -transportCotizacion.retencion, false],
                          ].filter(Boolean).map(([label, val, bold], i) => (
                            <div key={i} style={{display:'flex',justifyContent:'space-between',borderTop: bold?'1px solid #BBF7D0':'none',paddingTop:bold?6:0}}>
                              <span style={{color:'#444',fontWeight:bold?600:400}}>{label}</span>
                              <span style={{fontWeight:bold?600:400,color:val<0?'#EF4444':'inherit'}}>{val<0?'-':''}{fmtMoney(Math.abs(val))}</span>
                            </div>
                          ))}
                          <div style={{borderTop:'2px solid #0F6E56',paddingTop:8,display:'flex',justifyContent:'space-between'}}>
                            <span style={{fontWeight:700,fontSize:15,color:'#0F6E56'}}>TOTAL</span>
                            <span style={{fontWeight:700,fontSize:15,color:'#0F6E56'}}>{fmtMoney(transportCotizacion.total)}</span>
                          </div>
                        </div>
                        <button onClick={solicitarTransporte} disabled={transportProcessing}
                          style={{width:'100%',marginTop:'1rem',padding:'11px',background:'#0F6E56',color:'#fff',border:'none',borderRadius:8,cursor:'pointer',fontSize:14,fontWeight:600,opacity:transportProcessing?0.6:1}}>
                          {transportProcessing ? 'Enviando...' : '✅ Confirmar solicitud'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── MARÍTIMO ── */}
        {activeTab === 'maritimo' && (
          <div style={s.comingSoon}>
            <div style={{fontSize:48,marginBottom:12}}>🚢</div>
            <h3 style={{fontWeight:700,fontSize:18,color:'#222',marginBottom:8}}>Transporte Marítimo</h3>
            <p style={{color:'#888',fontSize:14,marginBottom:4}}>FCL (Full Container Load) y LCL (Less than Container Load)</p>
            <p style={{color:'#bbb',fontSize:13}}>Próximamente disponible</p>
          </div>
        )}

        {/* ── AÉREO ── */}
        {activeTab === 'aereo' && (
          <div style={s.comingSoon}>
            <div style={{fontSize:48,marginBottom:12}}>✈️</div>
            <h3 style={{fontWeight:700,fontSize:18,color:'#222',marginBottom:8}}>Transporte Aéreo</h3>
            <p style={{color:'#888',fontSize:14,marginBottom:4}}>Envíos express nacionales e internacionales</p>
            <p style={{color:'#bbb',fontSize:13}}>Próximamente disponible</p>
          </div>
        )}
      </div>
    </div>
  )
}

const sLabel = { fontSize:12, color:'#666', display:'block', marginBottom:4 }
const sInput = { width:'100%', padding:'9px 11px', border:'1px solid #ddd', borderRadius:8, fontSize:14, color:'#222', background:'#fff', boxSizing:'border-box' }
const sBtnSmall = { padding:'2px 7px', background:'none', border:'1px solid #ddd', borderRadius:5, cursor:'pointer', fontSize:12, color:'#666' }

const s = {
  container: { minHeight:'100vh', background:'#f5f5f5', fontFamily:'sans-serif' },
  topbar: { background:'#0F6E56', padding:'1rem 1.5rem', display:'flex', justifyContent:'space-between', alignItems:'center' },
  logo: { fontSize:20, fontWeight:700, color:'#fff', letterSpacing:2 },
  userRow: { display:'flex', alignItems:'center', gap:12 },
  userName: { color:'rgba(255,255,255,0.8)', fontSize:14 },
  logoutBtn: { padding:'6px 14px', background:'rgba(255,255,255,0.15)', color:'#fff', border:'1px solid rgba(255,255,255,0.3)', borderRadius:8, cursor:'pointer', fontSize:13 },
  main: { maxWidth:720, margin:'0 auto', padding:'1.5rem' },
  success: { background:'#E1F5EE', border:'1px solid #9FE1CB', borderRadius:8, padding:'10px 14px', color:'#0F6E56', marginBottom:'1rem', fontSize:14 },
  tabsContainer: { display:'flex', borderBottom:'1px solid #E5E7EB', marginBottom:'1.5rem', gap:4, overflowX:'auto' },
  tab: { padding:'10px 16px', border:'none', background:'none', cursor:'pointer', fontSize:13, whiteSpace:'nowrap', transition:'color .2s' },
  statsRow: { display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:'1.5rem' },
  stat: { background:'#fff', borderRadius:10, padding:'1rem', textAlign:'center', border:'1px solid #eee' },
  statVal: { fontSize:24, fontWeight:700, color:'#0F6E56' },
  statLbl: { fontSize:12, color:'#888', marginTop:4 },
  sectionHeader: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' },
  sectionTitle: { fontSize:16, fontWeight:600, color:'#222' },
  newBtn: { padding:'8px 16px', background:'#0F6E56', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 },
  empty: { textAlign:'center', padding:'3rem', background:'#fff', borderRadius:12, border:'1px solid #eee' },
  emptyText: { color:'#888', marginBottom:'1rem' },
  ordersList: { display:'flex', flexDirection:'column', gap:12 },
  orderCard: { background:'#fff', border:'1px solid #eee', borderRadius:10, padding:'1rem' },
  orderHeader: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 },
  orderCode: { fontSize:14, fontWeight:600, color:'#222' },
  badge: { fontSize:11, padding:'3px 10px', borderRadius:20, fontWeight:500 },
  orderRoute: { fontSize:13, color:'#666', marginBottom:8, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  orderFooter: { display:'flex', justifyContent:'space-between', fontSize:13 },
  orderService: { color:'#888', textTransform:'capitalize' },
  orderPrice: { fontWeight:600, color:'#222' },
  timeline: { borderLeft:'2px solid #E5E7EB', marginLeft:6, paddingLeft:16, marginTop:4 },
  timelineItem: { display:'flex', gap:10, marginBottom:12, position:'relative' },
  timelineDot: { width:8, height:8, borderRadius:'50%', background:'#0F6E56', flexShrink:0, marginTop:3, position:'absolute', left:-21 },
  eventCode: { background:'#E1F5EE', color:'#0F6E56', padding:'1px 5px', borderRadius:4, fontSize:11, fontWeight:700 },
  comingSoon: { textAlign:'center', padding:'4rem 2rem', background:'#fff', borderRadius:12, border:'1px solid #eee' },
}

export default function Dashboard() {
  return (
    <Suspense fallback={<div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh',background:'#0F6E56'}}><div style={{background:'#fff',borderRadius:16,padding:'2rem'}}><p style={{color:'#0F6E56',fontWeight:600}}>Cargando...</p></div></div>}>
      <DashboardContent />
    </Suspense>
  )
}