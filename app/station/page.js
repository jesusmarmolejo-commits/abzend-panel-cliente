'use client'
import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabase'
import { useRouter } from 'next/navigation'

const STATION_CODES = ['RSC','SRT','CNT','SEA','DPO','INT','ATH','DTH','DTS','AEC','HEC','REC','IXT','ADC','HIC','CPI','DPP','RIC','RLC','LSR','ASC','LDV','STO','RLB','OFD','PLS','AWD','E-01','E-02','E-03','E-04','E-05','E-06','E-07','E-08','E-09','E-10','RTO','CAN','EXP']

const STATUS_LABEL = { pending:'Pendiente', assigned:'Asignado', picked_up:'Recogido', in_transit:'En tránsito', delivered:'Entregado', cancelled:'Cancelado' }
const STATUS_COLOR = { pending:'#FAEEDA', assigned:'#E1F5EE', picked_up:'#E1F5EE', in_transit:'#E6F1FB', delivered:'#EAF3DE', cancelled:'#FCEBEB' }
const STATUS_TEXT = { pending:'#854F0B', assigned:'#0F6E56', picked_up:'#0F6E56', in_transit:'#185FA5', delivered:'#3B6D11', cancelled:'#A32D2D' }

const fmtDate = (d) => d ? new Date(d).toLocaleString('es-MX', { dateStyle:'short', timeStyle:'short' }) : ''

export default function StationPanel() {
  const [user, setUser] = useState(null)
  const [orders, setOrders] = useState([])
  const [statuses, setStatuses] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [selectedCode, setSelectedCode] = useState('')
  const [note, setNote] = useState('')
  const [processing, setProcessing] = useState(false)
  const [msg, setMsg] = useState('')
  const [search, setSearch] = useState('')
  const [searchResult, setSearchResult] = useState(null)
  const router = useRouter()

  useEffect(() => {
    const init = async () => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      setUser(session.user)

      const { data: userData } = await supabase
        .from('users').select('role').eq('auth_id', session.user.id).single()
      if (!userData || userData.role !== 'station') { router.push('/dashboard'); return }

      // Cargar catálogo de estados permitidos para estación
      const { data: statusData } = await supabase
        .from('shipment_statuses')
        .select('*')
        .in('codigo', STATION_CODES)
        .order('id')
      setStatuses(statusData || [])
      if (statusData?.length > 0) setSelectedCode(statusData[0].codigo)

      await loadOrders(supabase)
      setLoading(false)
    }
    init()
  }, [])

  const loadOrders = async (supabase) => {
    const { data } = await supabase
      .from('orders')
      .select('*, client:client_id(full_name), events:order_events(status_code, created_at)')
      .not('status', 'in', '(delivered,cancelled)')
      .order('created_at', { ascending: false })
      .limit(50)
    setOrders(data || [])
  }

  const searchOrder = async () => {
    if (!search.trim()) return
    const supabase = createClient()
    const { data } = await supabase
      .from('orders')
      .select('*, client:client_id(full_name), events:order_events(status_code, note, created_at)')
      .or(`tracking_code.eq.${search.trim()},qr_code.eq.${search.trim()}`)
      .single()
    if (!data) { setMsg('Guía no encontrada'); return }
    setSearchResult(data)
    setSearch('')
  }

  const registerEvent = async (order) => {
    if (!selectedCode) return
    setProcessing(true)
    try {
      const supabase = createClient()
      const now = new Date().toISOString()

      // Determinar nuevo status interno según código
      let newStatus = order.status
      if (['INT','ATH','DTH','DTS','IXT'].includes(selectedCode)) newStatus = 'in_transit'
      if (['CAN','EXP','RTO'].includes(selectedCode)) newStatus = 'cancelled'

      await supabase.from('orders')
        .update({ status: newStatus, status_updated_at: now })
        .eq('id', order.id)

      await supabase.from('order_events').insert({
        order_id: order.id,
        status: newStatus,
        status_code: selectedCode,
        note: note || `Registrado por estación de transferencia`
      })

      setMsg(`Evento [${selectedCode}] registrado en ${order.tracking_code}`)
      setSelectedOrder(null)
      setSearchResult(null)
      setNote('')
      await loadOrders(supabase)
    } catch(e) {
      setMsg('Error: ' + e.message)
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

  const activeOrder = searchResult || selectedOrder

  return (
    <div style={s.container}>
      <div style={s.topbar}>
        <div style={s.logo}>ABZEND <span style={s.tag}>Estación</span></div>
        <div style={s.userRow}>
          <span style={s.userName}>{user?.user_metadata?.full_name || user?.email}</span>
          <button onClick={logout} style={s.logoutBtn}>Salir</button>
        </div>
      </div>

      <div style={s.main}>
        {msg && <div style={s.msgBox} onClick={() => setMsg('')}>{msg} ✕</div>}

        {/* Búsqueda de guía */}
        <div style={s.card}>
          <div style={s.cardTitle}>Escanear / Buscar guía</div>
          <div style={s.qrRow}>
            <input
              style={s.qrInput}
              placeholder="Código de guía o QR..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchOrder()}
            />
            <button style={s.qrBtn} onClick={searchOrder}>Buscar</button>
          </div>
        </div>

        {/* Modal registro de evento */}
        {activeOrder && (
          <div style={s.modalOverlay}>
            <div style={s.modal}>
              <h3 style={s.modalTitle}>#{activeOrder.tracking_code}</h3>
              <p style={s.modalSub}>{activeOrder.origin_address} → {activeOrder.dest_address}</p>
              <p style={s.modalSub}>Cliente: {activeOrder.client?.full_name || 'N/A'}</p>
              <div style={s.modalStatus}>
                Estado: <span style={{...s.badge, background: STATUS_COLOR[activeOrder.status], color: STATUS_TEXT[activeOrder.status]}}>
                  {STATUS_LABEL[activeOrder.status]}
                </span>
              </div>

              {/* Historial de eventos */}
              {activeOrder.events?.length > 0 && (
                <div style={s.eventsBox}>
                  <div style={s.eventsTitle}>Últimos eventos</div>
                  {activeOrder.events.slice(-3).reverse().map((e, i) => (
                    <div key={i} style={s.eventRow}>
                      <span style={s.eventCode}>[{e.status_code || '—'}]</span>
                      <span style={s.eventDate}>{fmtDate(e.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={s.field}>
                <label style={s.label}>Evento de tracking</label>
                <select style={s.input} value={selectedCode} onChange={e => setSelectedCode(e.target.value)}>
                  {statuses.map(st => (
                    <option key={st.codigo} value={st.codigo}>[{st.codigo}] {st.estado_es}</option>
                  ))}
                </select>
              </div>
              <div style={s.field}>
                <label style={s.label}>Nota (opcional)</label>
                <input style={s.input} value={note} onChange={e => setNote(e.target.value)} placeholder="Observaciones..." />
              </div>
              <div style={s.modalBtns}>
                <button style={s.cancelBtn} onClick={() => { setSelectedOrder(null); setSearchResult(null); setNote('') }}>Cancelar</button>
                <button style={{...s.confirmBtn, opacity: processing ? 0.6:1}} onClick={() => registerEvent(activeOrder)} disabled={processing}>
                  {processing ? 'Registrando...' : 'Registrar evento'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Lista de órdenes activas */}
        <div style={s.sectionHeader}>
          <h2 style={s.sectionTitle}>Órdenes activas</h2>
          <span style={s.count}>{orders.length}</span>
        </div>

        <div style={s.ordersList}>
          {orders.map(order => (
            <div key={order.id} style={s.orderCard} onClick={() => setSelectedOrder(order)}>
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
                  {order.events?.length > 0 && (
                    <span style={s.lastEvent}>[{order.events[order.events.length-1]?.status_code || '—'}]</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {orders.length === 0 && (
          <div style={s.empty}><p style={s.emptyText}>No hay órdenes activas</p></div>
        )}
      </div>
    </div>
  )
}

const s = {
  container: { minHeight:'100vh', background:'#f5f5f5', fontFamily:'sans-serif' },
  topbar: { background:'#085041', padding:'1rem 1.5rem', display:'flex', justifyContent:'space-between', alignItems:'center' },
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
  qrBtn: { padding:'9px 18px', background:'#085041', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:14, fontWeight:500 },
  sectionHeader: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem' },
  sectionTitle: { fontSize:15, fontWeight:600, color:'#222' },
  count: { background:'#085041', color:'#fff', fontSize:12, padding:'2px 10px', borderRadius:20 },
  ordersList: { display:'flex', flexDirection:'column', gap:8 },
  orderCard: { background:'#fff', border:'1px solid #eee', borderRadius:10, padding:'1rem', cursor:'pointer' },
  orderRow: { display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 },
  orderLeft: { flex:1 },
  orderCode: { fontSize:14, fontWeight:600, color:'#222', marginBottom:3 },
  orderRoute: { fontSize:12, color:'#888', marginBottom:2 },
  orderMeta: { fontSize:11, color:'#bbb' },
  orderRight: { display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 },
  badge: { fontSize:11, padding:'3px 10px', borderRadius:20, fontWeight:500, whiteSpace:'nowrap' },
  lastEvent: { fontSize:11, color:'#085041', fontWeight:600 },
  empty: { textAlign:'center', padding:'2rem', background:'#fff', borderRadius:10, border:'1px solid #eee' },
  emptyText: { color:'#aaa', fontSize:13 },
  modalOverlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 },
  modal: { background:'#fff', borderRadius:14, padding:'1.5rem', width:'100%', maxWidth:420, margin:'1rem' },
  modalTitle: { fontSize:16, fontWeight:600, color:'#222', marginBottom:4 },
  modalSub: { fontSize:13, color:'#888', marginBottom:4 },
  modalStatus: { display:'flex', alignItems:'center', gap:8, marginBottom:'1rem', fontSize:13 },
  eventsBox: { background:'#f9f9f9', borderRadius:8, padding:'0.75rem', marginBottom:'1rem' },
  eventsTitle: { fontSize:12, color:'#888', marginBottom:6 },
  eventRow: { display:'flex', justifyContent:'space-between', fontSize:12, padding:'2px 0' },
  eventCode: { fontWeight:600, color:'#085041' },
  eventDate: { color:'#aaa' },
  field: { display:'flex', flexDirection:'column', gap:5, marginBottom:'1rem' },
  label: { fontSize:13, color:'#666' },
  input: { padding:'9px 11px', border:'1px solid #ddd', borderRadius:8, fontSize:14, color:'#222' },
  modalBtns: { display:'flex', gap:10, justifyContent:'flex-end' },
  cancelBtn: { padding:'8px 16px', background:'none', border:'1px solid #ddd', borderRadius:8, cursor:'pointer', fontSize:13 },
  confirmBtn: { padding:'8px 18px', background:'#085041', color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 },
}
