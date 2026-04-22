'use client'
import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabase'
import { useRouter } from 'next/navigation'

const STATUS_LABEL = { pending:'Pendiente', assigned:'Asignado', picked_up:'Recogido', in_transit:'En tránsito', delivered:'Entregado' }
const STATUS_COLOR = { pending:'#FAEEDA', assigned:'#E1F5EE', picked_up:'#E1F5EE', in_transit:'#E6F1FB', delivered:'#EAF3DE' }
const STATUS_TEXT = { pending:'#854F0B', assigned:'#0F6E56', picked_up:'#0F6E56', in_transit:'#185FA5', delivered:'#3B6D11' }

// Transiciones permitidas para el repartidor
const ALLOWED_TRANSITIONS = {
  assigned:   [{ value:'picked_up',  label:'Confirmar recolección', code:'PUP' },
               { value:'in_transit', label:'En tránsito',           code:'INT' }],
  picked_up:  [{ value:'in_transit', label:'En tránsito',           code:'INT' },
               { value:'delivered',  label:'Entregado',             code:'DLV' }],
  in_transit: [{ value:'delivered',  label:'Entregado',             code:'DLV' }],
}

const fmtDate = (d) => d ? new Date(d).toLocaleString('es-MX', { dateStyle:'short', timeStyle:'short' }) : ''

export default function DriverPanel() {
  const [user, setUser] = useState(null)
  const [driverId, setDriverId] = useState(null)
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [selectedTransition, setSelectedTransition] = useState('')
  const [processing, setProcessing] = useState(false)
  const [msg, setMsg] = useState('')
  const [qrInput, setQrInput] = useState('')
  const router = useRouter()

  useEffect(() => {
    const init = async () => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      setUser(session.user)

      // Obtener perfil del repartidor
      const { data: userData } = await supabase
        .from('users').select('id, role').eq('auth_id', session.user.id).single()

      if (!userData || userData.role !== 'driver') {
        router.push('/dashboard'); return
      }

      const { data: driverData } = await supabase
        .from('drivers').select('id').eq('user_id', userData.id).single()

      if (!driverData) { router.push('/dashboard'); return }
      setDriverId(driverData.id)
      await loadOrders(supabase, driverData.id)
      setLoading(false)
    }
    init()
  }, [])

  const loadOrders = async (supabase, dId) => {
    // SOLO órdenes asignadas al repartidor (no mostrar pendientes)
    const { data: assigned } = await supabase
      .from('orders')
      .select('*, client:client_id(full_name, phone)')
      .eq('driver_id', dId)
      .in('status', ['assigned','picked_up','in_transit'])
      .order('created_at', { ascending: false })

    setOrders(assigned || [])
  }

  const openModal = (order) => {
    setSelectedOrder(order)
    const transitions = ALLOWED_TRANSITIONS[order.status] || []
    setSelectedTransition(transitions[0]?.value || '')
  }

  const updateStatus = async () => {
    if (!selectedTransition) return
    setProcessing(true)
    try {
      const supabase = createClient()
      const now = new Date().toISOString()
      const transition = ALLOWED_TRANSITIONS[selectedOrder.status]?.find(t => t.value === selectedTransition)
      const extra = {}
      if (selectedTransition === 'assigned') extra.driver_id = driverId
      if (selectedTransition === 'delivered') extra.delivered_at = now

      const { error } = await supabase.from('orders')
        .update({ status: selectedTransition, status_updated_at: now, ...extra })
        .eq('id', selectedOrder.id)
      if (error) throw error

      // Obtener ubicación del repartidor
      let lat = null, lng = null
      if (navigator.geolocation && selectedTransition === 'in_transit') {
        try {
          const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
          })
          lat = pos.coords.latitude
          lng = pos.coords.longitude
        } catch(geoErr) {
          console.warn('No se pudo obtener ubicación GPS:', geoErr)
        }
      }

      await supabase.from('order_events').insert({
        order_id: selectedOrder.id,
        status: selectedTransition,
        status_code: transition?.code || null,
        note: `Actualizado por repartidor`,
        lat,
        lng
      })

      setMsg(`Orden ${selectedOrder.tracking_code}: ${STATUS_LABEL[selectedTransition]}`)
      setSelectedOrder(null)
      await loadOrders(supabase, driverId)
    } catch(e) {
      setMsg('Error: ' + e.message)
    } finally {
      setProcessing(false)
    }
  }

  const scanQR = async () => {
    if (!qrInput.trim()) return
    setProcessing(true)
    try {
      const supabase = createClient()
      const code = qrInput.trim().replace('ABZEND-', '').split('-').slice(0,3).join('-')
      
      // Buscar orden por tracking_code o qr_code
      const { data, error } = await supabase
        .from('orders')
        .select('*, client:client_id(full_name, phone)')
        .or(`tracking_code.eq.${code},qr_code.eq.${qrInput.trim()}`)
        .single()
      
      if (error || !data) { 
        setMsg('❌ Código QR no encontrado')
        setProcessing(false)
        return 
      }

      // Verificar que la orden esté pendiente
      if (data.status !== 'pending') {
        setMsg('⚠️ Esta orden ya fue asignada a otro repartidor')
        setProcessing(false)
        return
      }

      // AUTO-ASIGNAR la orden al repartidor
      const now = new Date().toISOString()
      const { error: updateError } = await supabase
        .from('orders')
        .update({ 
          driver_id: driverId, 
          status: 'assigned',
          status_updated_at: now
        })
        .eq('id', data.id)

      if (updateError) throw updateError

      // Registrar evento
      await supabase.from('order_events').insert({
        order_id: data.id,
        status: 'assigned',
        status_code: 'ASC',
        note: 'Orden asignada por escaneo QR del repartidor'
      })

      setMsg(`✅ Orden #${data.tracking_code} asignada exitosamente`)
      setQrInput('')
      
      // Recargar órdenes para mostrar la nueva
      await loadOrders(supabase, driverId)
    } catch(e) {
      setMsg('❌ Error: ' + e.message)
    } finally {
      setProcessing(false)
    }
  }

  const logout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
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
        <div style={s.logo}>ABZEND <span style={s.tag}>Repartidor</span></div>
        <div style={s.userRow}>
          <span style={s.userName}>{user?.user_metadata?.full_name || user?.email}</span>
          <button onClick={logout} style={s.logoutBtn}>Salir</button>
        </div>
      </div>

      <div style={s.main}>
        {msg && <div style={s.msgBox} onClick={() => setMsg('')}>{msg} ✕</div>}

        {/* Escáner QR */}
        <div style={s.card}>
          <div style={s.cardTitle}>Escanear código QR de la orden</div>
          <div style={s.qrRow}>
            <input
              style={s.qrInput}
              placeholder="Ingresa código de guía o escanea QR..."
              value={qrInput}
              onChange={e => setQrInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && scanQR()}
              disabled={processing}
            />
            <button 
              style={{...s.qrBtn, opacity: processing ? 0.6 : 1}} 
              onClick={scanQR}
              disabled={processing}
            >
              {processing ? 'Procesando...' : 'Escanear'}
            </button>
          </div>
          <p style={{fontSize:12, color:'#888', marginTop:8}}>
            📱 Escanea el código QR del paquete para asignarte la orden automáticamente
          </p>
        </div>

        {/* Modal cambio de estado */}
        {selectedOrder && (
          <div style={s.modalOverlay}>
            <div style={s.modal}>
              <h3 style={s.modalTitle}>#{selectedOrder.tracking_code}</h3>
              <p style={s.modalSub}>{selectedOrder.origin_address} → {selectedOrder.dest_address}</p>
              <p style={s.modalSub}>Cliente: {selectedOrder.client?.full_name || 'N/A'}</p>
              <div style={s.modalStatus}>
                Estado actual: <span style={{...s.badge, background: STATUS_COLOR[selectedOrder.status], color: STATUS_TEXT[selectedOrder.status]}}>
                  {STATUS_LABEL[selectedOrder.status]}
                </span>
              </div>
              {ALLOWED_TRANSITIONS[selectedOrder.status]?.length > 0 ? (
                <>
                  <div style={s.field}>
                    <label style={s.label}>Cambiar a</label>
                    <select style={s.input} value={selectedTransition} onChange={e => setSelectedTransition(e.target.value)}>
                      {ALLOWED_TRANSITIONS[selectedOrder.status].map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div style={s.modalBtns}>
                    <button style={s.cancelBtn} onClick={() => setSelectedOrder(null)}>Cancelar</button>
                    <button style={{...s.confirmBtn, opacity: processing ? 0.6:1}} onClick={updateStatus} disabled={processing}>
                      {processing ? 'Procesando...' : 'Confirmar'}
                    </button>
                  </div>
                </>
              ) : (
                <div style={s.noTransitions}>
                  <p>No hay acciones disponibles para este estado.</p>
                  <button style={s.cancelBtn} onClick={() => setSelectedOrder(null)}>Cerrar</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Mis órdenes activas */}
        <div style={s.sectionHeader}>
          <h2 style={s.sectionTitle}>Mis órdenes activas</h2>
          <span style={s.count}>{orders.length}</span>
        </div>
        
        {orders.length === 0 && (
          <div style={s.empty}>
            <p style={s.emptyIcon}>📦</p>
            <p style={s.emptyText}>No tienes órdenes asignadas</p>
            <p style={s.emptyHint}>Escanea el código QR de un paquete para comenzar</p>
          </div>
        )}
        
        <div style={s.ordersList}>
          {orders.map(order => (
            <div key={order.id} style={s.orderCard}>
              <div style={s.orderRow}>
                <div style={s.orderLeft}>
                  <div style={s.orderCode}>#{order.tracking_code}</div>
                  <div style={s.orderRoute}>{order.origin_address} → {order.dest_address}</div>
                  <div style={s.orderMeta}>{fmtDate(order.created_at)}</div>
                </div>
                <div style={s.orderRight}>
                  <span style={{...s.badge, background: STATUS_COLOR[order.status], color: STATUS_TEXT[order.status]}}>
                    {STATUS_LABEL[order.status]}
                  </span>
                  {ALLOWED_TRANSITIONS[order.status]?.length > 0 && (
                    <button style={s.actionBtn} onClick={() => openModal(order)}>Actualizar</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const s = {
  container: { minHeight:'100vh', background:'#f5f5f5', fontFamily:'sans-serif' },
  topbar: { background:'#0F6E56', padding:'1rem 1.5rem', display:'flex', justifyContent:'space-between', alignItems:'center' },
  logo: { fontSize:20, fontWeight:700, color:'#fff', letterSpacing:2, display:'flex', alignItems:'center', gap:10 },
  tag: { background:'rgba(255,255,255,0.2)', fontSize:11, padding:'2px 8px', borderRadius:20, fontWeight:400, letterSpacing:0 },
  userRow: { display:'flex', alignItems:'center', gap:12 },
  userName: { color:'rgba(255,255,255,0.8)', fontSize:14 },
  logoutBtn: { padding:'6px 14px', background:'rgba(255,255,255,0.15)', color:'#fff', border:'1px solid rgba(255,255,255,0.3)', borderRadius:8, cursor:'pointer', fontSize:13 },
  main: { maxWidth:700, margin:'0 auto', padding:'1.5rem' },
  msgBox: { background:'#E1F5EE', border:'1px solid #9FE1CB', borderRadius:8, padding:'10px 14px', color:'#0F6E56', marginBottom:'1rem', fontSize:14, cursor:'pointer' },
  card: { background:'#fff', border:'1px solid #eee', borderRadius:10, padding:'1rem', marginBottom:'1rem' },
  cardTitle: { fontSize:14, fontWeight:600, color:'#222', marginBottom:'0.75rem' },
  qrRow: { display:'flex', gap:8 },
  qrInput: { flex:1, padding:'9px 11px', border:'1px solid #ddd', borderRadius:8, fontSize:14, color:'#222' },
  qrBtn: { padding:'9px 18px', background:'#0F6E56', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:14, fontWeight:500 },
  sectionHeader: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem' },
  sectionTitle: { fontSize:15, fontWeight:600, color:'#222' },
  count: { background:'#0F6E56', color:'#fff', fontSize:12, padding:'2px 10px', borderRadius:20 },
  ordersList: { display:'flex', flexDirection:'column', gap:8 },
  orderCard: { background:'#fff', border:'1px solid #eee', borderRadius:10, padding:'1rem' },
  orderRow: { display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 },
  orderLeft: { flex:1 },
  orderCode: { fontSize:14, fontWeight:600, color:'#222', marginBottom:3 },
  orderRoute: { fontSize:12, color:'#888', marginBottom:2 },
  orderMeta: { fontSize:11, color:'#bbb' },
  orderRight: { display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6 },
  badge: { fontSize:11, padding:'3px 10px', borderRadius:20, fontWeight:500, whiteSpace:'nowrap' },
  actionBtn: { padding:'5px 12px', background:'#185FA5', color:'#fff', border:'none', borderRadius:6, cursor:'pointer', fontSize:11, fontWeight:500 },
  empty: { textAlign:'center', padding:'3rem 2rem', background:'#fff', borderRadius:10, border:'1px solid #eee', marginBottom:'1rem' },
  emptyIcon: { fontSize:48, marginBottom:8 },
  emptyText: { color:'#666', fontSize:14, marginBottom:4, fontWeight:500 },
  emptyHint: { color:'#999', fontSize:12 },
  modalOverlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 },
  modal: { background:'#fff', borderRadius:14, padding:'1.5rem', width:'100%', maxWidth:400, margin:'1rem' },
  modalTitle: { fontSize:16, fontWeight:600, color:'#222', marginBottom:4 },
  modalSub: { fontSize:13, color:'#888', marginBottom:4 },
  modalStatus: { display:'flex', alignItems:'center', gap:8, marginBottom:'1rem', fontSize:13 },
  field: { display:'flex', flexDirection:'column', gap:5, marginBottom:'1rem' },
  label: { fontSize:13, color:'#666' },
  input: { padding:'9px 11px', border:'1px solid #ddd', borderRadius:8, fontSize:14, color:'#222' },
  modalBtns: { display:'flex', gap:10, justifyContent:'flex-end' },
  cancelBtn: { padding:'8px 16px', background:'none', border:'1px solid #ddd', borderRadius:8, cursor:'pointer', fontSize:13 },
  confirmBtn: { padding:'8px 18px', background:'#0F6E56', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 },
  noTransitions: { textAlign:'center', padding:'1rem' },
}
