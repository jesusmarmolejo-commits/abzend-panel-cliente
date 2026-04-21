'use client'
import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabase'
import { useRouter } from 'next/navigation'

// ── Helpers ──────────────────────────────────────────────
const STATUS_LABEL = { pending:'Pendiente', assigned:'Asignado', picked_up:'Recogido', in_transit:'En tránsito', delivered:'Entregado', cancelled:'Cancelado' }
const STATUS_COLOR = { pending:'#FAEEDA', assigned:'#E1F5EE', picked_up:'#E1F5EE', in_transit:'#EFF6FF', delivered:'#DCFCE7', cancelled:'#FEE2E2' }
const STATUS_TEXT  = { pending:'#92400E', assigned:'#065F46', picked_up:'#065F46', in_transit:'#1E40AF', delivered:'#166534', cancelled:'#991B1B' }
const fmtDate = (d) => d ? new Date(d).toLocaleString('es-MX',{dateStyle:'short',timeStyle:'short'}) : '—'
const fmtMoney = (n) => `$${Number(n||0).toLocaleString('es-MX',{minimumFractionDigits:2})}`

export default function AdminPanel() {
  const [section, setSection]   = useState('dashboard')
  const [user, setUser]         = useState(null)
  const [dark, setDark]         = useState(false)
  const [loading, setLoading]   = useState(true)
  // data
  const [orders, setOrders]     = useState([])
  const [clients, setClients]   = useState([])
  const [drivers, setDrivers]   = useState([])
  const [statuses, setStatuses] = useState([])
  // orders UI
  const [search, setSearch]     = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [showOrderMenu, setShowOrderMenu] = useState(false)
  // assign modal
  const [assignOrder, setAssignOrder]   = useState(null)
  const [assignDriver, setAssignDriver] = useState('')
  const [assignCode, setAssignCode]     = useState('ASC')
  const [processing, setProcessing]     = useState(false)
  // status modal
  const [statusOrder, setStatusOrder]   = useState(null)
  const [newStatus, setNewStatus]       = useState('')
  const [statusCode, setStatusCode]     = useState('')
  // quote
  const [quoteDist, setQuoteDist] = useState('')
  const [quoteWeight, setQuoteWeight] = useState('')
  const [quoteResult, setQuoteResult] = useState(null)
  // msg
  const [msg, setMsg] = useState('')
  const router = useRouter()

  useEffect(() => {
    const init = async () => {
      const sb = createClient()
      const { data: { session } } = await sb.auth.getSession()
      if (!session) { router.push('/login'); return }
      setUser(session.user)
      const { data: ud } = await sb.from('users').select('role').eq('auth_id', session.user.id).single()
      if (!ud || ud.role !== 'admin') { router.push('/dashboard'); return }
      const { data: st } = await sb.from('shipment_statuses').select('*').order('id')
      setStatuses(st || [])
      if (st?.length) setAssignCode(st.find(s=>s.codigo==='ASC')?.codigo || st[0].codigo)
      await loadAll(sb)
      setLoading(false)
    }
    init()
  }, [])

  const loadAll = async (sb) => {
    const [{ data: ord }, { data: cli }, { data: drv }] = await Promise.all([
      sb.from('orders').select('*, client:client_id(full_name,email), driver:driver_id(id,user:user_id(full_name)), events:order_events(status,status_code,created_at)').order('created_at',{ascending:false}),
      sb.from('users').select('*').eq('role','client').order('created_at',{ascending:false}),
      sb.from('drivers').select('*,user:user_id(full_name,email,phone)').order('created_at',{ascending:false}),
    ])
    setOrders(ord || [])
    setClients(cli || [])
    setDrivers(drv || [])
  }

  const logout = async () => { const sb=createClient(); await sb.auth.signOut(); router.push('/login') }
  const showMsg = (m) => { setMsg(m); setTimeout(()=>setMsg(''),3500) }

  // ── ASSIGN ───────────────────────────────────────────────
  const doAssign = async () => {
    if (!assignDriver) { showMsg('Selecciona un repartidor'); return }
    setProcessing(true)
    try {
      const sb = createClient(); const now = new Date().toISOString()
      const { error } = await sb.from('orders').update({ driver_id: assignDriver, status:'assigned', status_updated_at: now }).eq('id', assignOrder.id)
      if (error) throw error
      await sb.from('order_events').insert({ order_id: assignOrder.id, status:'assigned', status_code: assignCode, note:'Asignado por administrador', created_at: now })
      showMsg(`Orden ${assignOrder.tracking_code} asignada`); setAssignOrder(null)
      await loadAll(sb)
    } catch(e){ showMsg('Error: '+e.message) } finally { setProcessing(false) }
  }

  // ── STATUS ───────────────────────────────────────────────
  const doStatus = async () => {
    if (!newStatus) return
    setProcessing(true)
    try {
      const sb = createClient(); const now = new Date().toISOString()
      const extra = newStatus==='delivered' ? {delivered_at:now} : {}
      await sb.from('orders').update({status:newStatus, status_updated_at:now, ...extra}).eq('id',statusOrder.id)
      await sb.from('order_events').insert({order_id:statusOrder.id,status:newStatus,status_code:statusCode||null,note:'Actualizado por admin'})
      showMsg(`Orden ${statusOrder.tracking_code}: ${STATUS_LABEL[newStatus]}`); setStatusOrder(null)
      await loadAll(sb)
    } catch(e){ showMsg('Error: '+e.message) } finally { setProcessing(false) }
  }

  // ── QUOTE ────────────────────────────────────────────────
  const calcQuote = () => {
    const d = parseFloat(quoteDist), w = parseFloat(quoteWeight)
    if (!d||!w) { showMsg('Ingresa distancia y peso'); return }
    const base = 50, perKm = 2.5, perKg = 8
    const subtotal = base + (d * perKm) + (w * perKg)
    const tax = subtotal * 0.16
    setQuoteResult({ subtotal: subtotal.toFixed(2), tax: tax.toFixed(2), total: (subtotal+tax).toFixed(2), standard: subtotal.toFixed(2), express: (subtotal*1.4).toFixed(2), same_day: (subtotal*1.9).toFixed(2) })
  }

  // ── TOGGLE DRIVER ────────────────────────────────────────
  const toggleDriver = async (driverId, currentStatus) => {
    const sb = createClient()
    const ns = currentStatus === 'online' ? 'offline' : 'online'
    await sb.from('drivers').update({status:ns}).eq('id',driverId)
    await loadAll(sb)
  }

  // ── DELETE CLIENT ─────────────────────────────────────────
  const deleteClient = async (clientId) => {
    if (!confirm('¿Eliminar este cliente?')) return
    const sb = createClient()
    await sb.from('users').delete().eq('id', clientId)
    await loadAll(sb)
    showMsg('Cliente eliminado')
  }

  // ── STATS ─────────────────────────────────────────────────
  const stats = {
    total: orders.length,
    completed: orders.filter(o=>o.status==='delivered').length,
    activeDrivers: drivers.filter(d=>d.status==='online').length,
    revenue: orders.filter(o=>o.status==='delivered').reduce((s,o)=>s+parseFloat(o.total||0),0)
  }

  // ── FILTERED ORDERS ───────────────────────────────────────
  const filteredOrders = orders.filter(o => {
    const matchSearch = !search || o.tracking_code?.toLowerCase().includes(search.toLowerCase()) || o.client?.email?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus==='all' || o.status===filterStatus
    return matchSearch && matchStatus
  })

  // ── BAR CHART (last 7 days) ────────────────────────────────
  const last7 = Array.from({length:7},(_,i)=>{
    const d = new Date(); d.setDate(d.getDate()-6+i)
    const key = d.toISOString().slice(0,10)
    const label = d.toLocaleDateString('es-MX',{weekday:'short'})
    const count = orders.filter(o=>o.created_at?.slice(0,10)===key).length
    return { label, count }
  })
  const maxBar = Math.max(...last7.map(d=>d.count), 1)

  // ── THEME ─────────────────────────────────────────────────
  const bg   = dark ? '#111827' : '#F9FAFB'
  const card = dark ? '#1F2937' : '#FFFFFF'
  const text = dark ? '#F9FAFB' : '#111827'
  const sub  = dark ? '#9CA3AF' : '#6B7280'
  const bdr  = dark ? '#374151' : '#E5E7EB'
  const sbg  = dark ? '#111827' : '#FFFFFF'
  const sact = dark ? '#FFFFFF' : '#000000'
  const sinact = dark ? '#6B7280' : '#6B7280'

  if (loading) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh',background:'#0F6E56'}}>
      <div style={{background:'#fff',borderRadius:16,padding:'2rem',textAlign:'center'}}><p style={{color:'#0F6E56',fontWeight:600}}>Cargando...</p></div>
    </div>
  )

  // ── NAV ───────────────────────────────────────────────────
  const navItems = [
    {id:'dashboard', label:'Dashboard', icon:'▦'},
    {id:'orders',    label:'Órdenes',   icon:'📦'},
    {id:'quote',     label:'Cotización',icon:'🧮'},
    {id:'clients',   label:'Clientes',  icon:'👤'},
    {id:'drivers',   label:'Repartidores', icon:'🚚'},
    {id:'tracking',  label:'Rastreo',   icon:'🗺'},
    {id:'reports',   label:'Reportes',  icon:'📊'},
  ]

  return (
    <div style={{display:'flex',minHeight:'100vh',background:bg,fontFamily:'system-ui,sans-serif',color:text}}>

      {/* SIDEBAR */}
      <div style={{width:220,background:sbg,borderRight:`1px solid ${bdr}`,display:'flex',flexDirection:'column',padding:'1.25rem 0',flexShrink:0}}>
        <div style={{padding:'0 1.25rem 1.5rem',fontWeight:700,fontSize:18,color:sact}}>LogiAdmin</div>
        {navItems.map(n=>(
          <div key={n.id} onClick={()=>setSection(n.id)}
            style={{display:'flex',alignItems:'center',gap:10,padding:'10px 1.25rem',cursor:'pointer',fontSize:14,borderRadius:6,margin:'1px 8px',
              background:section===n.id?(dark?'#374151':'#000'):' transparent',
              color:section===n.id?'#fff':sinact,fontWeight:section===n.id?600:400}}>
            <span style={{fontSize:16}}>{n.icon}</span>{n.label}
          </div>
        ))}
        <div style={{marginTop:'auto',padding:'1rem 1.25rem',borderTop:`1px solid ${bdr}`}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.75rem'}}>
            <span style={{fontSize:13,color:sub}}>Tema oscuro</span>
            <button onClick={()=>setDark(!dark)} style={{background:'none',border:'none',cursor:'pointer',fontSize:20}}>🌙</button>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:32,height:32,borderRadius:'50%',background:'#374151',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:13,fontWeight:700}}>A</div>
            <div><div style={{fontSize:13,fontWeight:600,color:text}}>Admin</div><div style={{fontSize:11,color:sub}}>{user?.email}</div></div>
          </div>
          <button onClick={logout} style={{display:'flex',alignItems:'center',gap:6,marginTop:'0.75rem',background:'none',border:'none',cursor:'pointer',color:'#EF4444',fontSize:13}}>
            ↩ Cerrar Sesión
          </button>
        </div>
      </div>

      {/* MAIN */}
      <div style={{flex:1,padding:'2rem',overflow:'auto'}}>
        {msg && <div style={{position:'fixed',top:16,right:16,background:'#0F6E56',color:'#fff',padding:'10px 18px',borderRadius:8,fontSize:13,zIndex:300}}>{msg}</div>}

        {/* ── DASHBOARD ── */}
        {section==='dashboard' && (
          <div>
            <h1 style={{fontSize:24,fontWeight:700,marginBottom:4}}>Dashboard</h1>
            <p style={{color:sub,marginBottom:'1.5rem',fontSize:14}}>Resumen de la plataforma logística.</p>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:'1.5rem'}}>
              {[
                {label:'Órdenes Totales', value:stats.total, icon:'📦'},
                {label:'Envíos Completados', value:stats.completed, icon:'✅'},
                {label:'Repartidores Activos', value:stats.activeDrivers, icon:'🚚'},
                {label:'Ingresos (Completados)', value:fmtMoney(stats.revenue), icon:'$'},
              ].map((k,i)=>(
                <div key={i} style={{background:card,border:`1px solid ${bdr}`,borderRadius:10,padding:'1rem'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                    <span style={{fontSize:13,color:sub}}>{k.label}</span>
                    <span style={{fontSize:18}}>{k.icon}</span>
                  </div>
                  <div style={{fontSize:26,fontWeight:700,color:text}}>{k.value}</div>
                </div>
              ))}
            </div>
            <div style={{background:card,border:`1px solid ${bdr}`,borderRadius:10,padding:'1.25rem'}}>
              <div style={{fontWeight:600,marginBottom:'1rem',fontSize:15}}>Órdenes por Día (Última Semana)</div>
              <div style={{display:'flex',alignItems:'flex-end',gap:10,height:140}}>
                {last7.map((d,i)=>(
                  <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
                    <div style={{width:'100%',background:dark?'#374151':'#E5E7EB',borderRadius:'4px 4px 0 0',height:120,display:'flex',alignItems:'flex-end'}}>
                      <div style={{width:'100%',background:dark?'#F9FAFB':'#111827',borderRadius:'4px 4px 0 0',height:`${(d.count/maxBar)*100}%`,minHeight:d.count?4:0,transition:'height .3s'}}/>
                    </div>
                    <span style={{fontSize:11,color:sub}}>{d.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── ÓRDENES ── */}
        {section==='orders' && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'1.5rem'}}>
              <div><h1 style={{fontSize:24,fontWeight:700,marginBottom:4}}>Órdenes</h1><p style={{color:sub,fontSize:14}}>Gestiona los envíos de la plataforma.</p></div>
              <button onClick={()=>router.push('/orders/new')} style={{padding:'10px 18px',background:'#111827',color:'#fff',border:'none',borderRadius:8,cursor:'pointer',fontSize:14,fontWeight:600}}>Nueva Orden</button>
            </div>
            <div style={{background:card,border:`1px solid ${bdr}`,borderRadius:10,padding:'1rem',marginBottom:'1rem'}}>
              <div style={{display:'flex',gap:10,marginBottom:'1rem',position:'relative'}}>
                <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por tracking..." style={{flex:1,padding:'8px 12px',border:`1px solid ${bdr}`,borderRadius:8,fontSize:14,background:bg,color:text}} />
                <div style={{position:'relative'}}>
                  <button onClick={()=>setShowOrderMenu(!showOrderMenu)} style={{padding:'8px 14px',border:`1px solid ${bdr}`,borderRadius:8,background:bg,color:text,cursor:'pointer',fontSize:14}}>
                    {filterStatus==='all'?'Todos los estados':STATUS_LABEL[filterStatus]} ▾
                  </button>
                  {showOrderMenu && (
                    <div style={{position:'absolute',top:'100%',right:0,background:card,border:`1px solid ${bdr}`,borderRadius:8,zIndex:50,minWidth:180,boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}}>
                      {['all','pending','in_transit','delivered','cancelled'].map(s=>(
                        <div key={s} onClick={()=>{setFilterStatus(s);setShowOrderMenu(false)}}
                          style={{padding:'9px 14px',cursor:'pointer',fontSize:14,display:'flex',justifyContent:'space-between',color:text}}>
                          {s==='all'?'Todos los estados':STATUS_LABEL[s]}{filterStatus===s&&' ✓'}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:`1px solid ${bdr}`}}>
                    {['Tracking','Cliente','Repartidor','Destino','Precio','Estado','Acciones'].map(h=>(
                      <th key={h} style={{textAlign:'left',padding:'8px 6px',color:sub,fontWeight:500,fontSize:12}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.length===0 && <tr><td colSpan={7} style={{padding:'2rem',textAlign:'center',color:sub}}>No hay órdenes</td></tr>}
                  {filteredOrders.map(o=>(
                    <tr key={o.id} style={{borderBottom:`1px solid ${bdr}`}}>
                      <td style={{padding:'10px 6px',fontWeight:600,fontSize:12}}>{o.tracking_code}</td>
                      <td style={{padding:'10px 6px',color:sub,fontSize:12}}>{o.client?.full_name||o.client?.email||'—'}</td>
                      <td style={{padding:'10px 6px',color:sub,fontSize:12}}>{o.driver?.user?.full_name||'Sin asignar'}</td>
                      <td style={{padding:'10px 6px',color:sub,fontSize:12,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o.dest_address}</td>
                      <td style={{padding:'10px 6px',fontWeight:600,fontSize:12}}>{fmtMoney(o.total)}</td>
                      <td style={{padding:'10px 6px'}}>
                        <span style={{background:STATUS_COLOR[o.status],color:STATUS_TEXT[o.status],fontSize:11,padding:'3px 8px',borderRadius:20,fontWeight:600,whiteSpace:'nowrap'}}>{STATUS_LABEL[o.status]}</span>
                      </td>
                      <td style={{padding:'10px 6px'}}>
                        <div style={{display:'flex',gap:4}}>
                          {o.status==='pending'&&<button onClick={()=>{setAssignOrder(o);setAssignDriver('')}} style={{padding:'4px 8px',background:'#0F6E56',color:'#fff',border:'none',borderRadius:5,cursor:'pointer',fontSize:11}}>Asignar</button>}
                          <button onClick={()=>{setStatusOrder(o);setNewStatus(o.status);setStatusCode('')}} style={{padding:'4px 8px',background:'#185FA5',color:'#fff',border:'none',borderRadius:5,cursor:'pointer',fontSize:11}}>Estado</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── COTIZACIÓN ── */}
        {section==='quote' && (
          <div>
            <h1 style={{fontSize:24,fontWeight:700,marginBottom:4}}>Cotización</h1>
            <p style={{color:sub,marginBottom:'1.5rem',fontSize:14}}>Calculadora de tarifas en tiempo real.</p>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
              <div style={{background:card,border:`1px solid ${bdr}`,borderRadius:10,padding:'1.5rem'}}>
                <div style={{fontWeight:600,marginBottom:'1rem'}}>Calculadora de Envíos</div>
                <p style={{fontSize:13,color:sub,marginBottom:'1.5rem'}}>Ingresa los detalles para obtener una tarifa aproximada.</p>
                <div style={{marginBottom:'1rem'}}>
                  <label style={{fontSize:13,color:sub,display:'block',marginBottom:6}}>Distancia estimada (km)</label>
                  <input value={quoteDist} onChange={e=>setQuoteDist(e.target.value)} type="number" placeholder="Ej. 15.5"
                    style={{width:'100%',padding:'9px 12px',border:`1px solid ${bdr}`,borderRadius:8,fontSize:14,background:bg,color:text,boxSizing:'border-box'}} />
                </div>
                <div style={{marginBottom:'1.5rem'}}>
                  <label style={{fontSize:13,color:sub,display:'block',marginBottom:6}}>Peso del paquete (kg)</label>
                  <input value={quoteWeight} onChange={e=>setQuoteWeight(e.target.value)} type="number" placeholder="Ej. 2.5"
                    style={{width:'100%',padding:'9px 12px',border:`1px solid ${bdr}`,borderRadius:8,fontSize:14,background:bg,color:text,boxSizing:'border-box'}} />
                </div>
                <button onClick={calcQuote} style={{width:'100%',padding:'11px',background:dark?'#F9FAFB':'#111827',color:dark?'#111827':'#fff',border:'none',borderRadius:8,cursor:'pointer',fontSize:14,fontWeight:600}}>
                  🧮 Calcular Tarifa
                </button>
              </div>
              <div style={{background:card,border:`1px solid ${bdr}`,borderRadius:10,padding:'1.5rem'}}>
                {!quoteResult ? (
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',color:sub,gap:12}}>
                    <span style={{fontSize:40}}>🧮</span>
                    <p style={{fontSize:13,textAlign:'center'}}>Ingresa la distancia y el peso para ver la tarifa.</p>
                  </div>
                ) : (
                  <div>
                    <div style={{fontWeight:600,marginBottom:'1rem'}}>Resultado de Cotización</div>
                    {[
                      {label:'Estándar (3-5 días)', value:quoteResult.standard, color:'#0F6E56'},
                      {label:'Express (1-2 días)', value:quoteResult.express, color:'#185FA5'},
                      {label:'Mismo día', value:quoteResult.same_day, color:'#7C3AED'},
                    ].map((r,i)=>(
                      <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:`1px solid ${bdr}`}}>
                        <span style={{fontSize:13,color:sub}}>{r.label}</span>
                        <span style={{fontWeight:700,color:r.color,fontSize:15}}>{fmtMoney(r.value)}</span>
                      </div>
                    ))}
                    <div style={{marginTop:'1rem',padding:'10px',background:dark?'#374151':'#F9FAFB',borderRadius:8,fontSize:12,color:sub}}>
                      Subtotal: {fmtMoney(quoteResult.subtotal)} · IVA (16%): {fmtMoney(quoteResult.tax)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── CLIENTES ── */}
        {section==='clients' && (
          <div>
            <h1 style={{fontSize:24,fontWeight:700,marginBottom:4}}>Clientes</h1>
            <p style={{color:sub,marginBottom:'1.5rem',fontSize:14}}>Gestiona los usuarios de tipo cliente.</p>
            <div style={{background:card,border:`1px solid ${bdr}`,borderRadius:10,overflow:'hidden'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:`1px solid ${bdr}`}}>
                    {['Nombre','Email','Teléfono','Estado','Acciones'].map(h=>(
                      <th key={h} style={{textAlign:'left',padding:'12px 16px',color:sub,fontWeight:500,fontSize:12}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {clients.length===0&&<tr><td colSpan={5} style={{padding:'2rem',textAlign:'center',color:sub}}>No hay clientes registrados</td></tr>}
                  {clients.map(c=>(
                    <tr key={c.id} style={{borderBottom:`1px solid ${bdr}`}}>
                      <td style={{padding:'12px 16px',fontWeight:600}}>{c.full_name||'Sin nombre'}</td>
                      <td style={{padding:'12px 16px',color:sub}}>{c.email}</td>
                      <td style={{padding:'12px 16px',color:sub}}>{c.phone||'N/A'}</td>
                      <td style={{padding:'12px 16px'}}>
                        <span style={{background:'#DCFCE7',color:'#166534',fontSize:11,padding:'3px 10px',borderRadius:20,fontWeight:600}}>Activo</span>
                      </td>
                      <td style={{padding:'12px 16px'}}>
                        <button onClick={()=>deleteClient(c.id)} style={{background:'none',border:'none',cursor:'pointer',color:'#EF4444',fontSize:16}}>🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── REPARTIDORES ── */}
        {section==='drivers' && (
          <div>
            <h1 style={{fontSize:24,fontWeight:700,marginBottom:4}}>Repartidores</h1>
            <p style={{color:sub,marginBottom:'1.5rem',fontSize:14}}>Gestiona la flota de repartidores.</p>
            <div style={{background:card,border:`1px solid ${bdr}`,borderRadius:10,overflow:'hidden'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:`1px solid ${bdr}`}}>
                    {['Nombre','Email','Teléfono','Estado Activo','Acciones'].map(h=>(
                      <th key={h} style={{textAlign:'left',padding:'12px 16px',color:sub,fontWeight:500,fontSize:12}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {drivers.length===0&&<tr><td colSpan={5} style={{padding:'2rem',textAlign:'center',color:sub}}>No hay repartidores registrados</td></tr>}
                  {drivers.map(d=>(
                    <tr key={d.id} style={{borderBottom:`1px solid ${bdr}`}}>
                      <td style={{padding:'12px 16px',fontWeight:600}}>{d.user?.full_name||'Sin nombre'}</td>
                      <td style={{padding:'12px 16px',color:sub}}>{d.user?.email||'—'}</td>
                      <td style={{padding:'12px 16px',color:sub}}>{d.user?.phone||'N/A'}</td>
                      <td style={{padding:'12px 16px'}}>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <div onClick={()=>toggleDriver(d.id,d.status)}
                            style={{width:42,height:24,borderRadius:12,background:d.status==='online'?'#111827':'#D1D5DB',cursor:'pointer',position:'relative',transition:'background .2s'}}>
                            <div style={{position:'absolute',top:2,left:d.status==='online'?18:2,width:20,height:20,borderRadius:'50%',background:'#fff',transition:'left .2s'}}/>
                          </div>
                          <span style={{fontSize:13,color:d.status==='online'?text:sub}}>{d.status==='online'?'Activo':'Inactivo'}</span>
                        </div>
                      </td>
                      <td style={{padding:'12px 16px'}}>
                        <button style={{background:'none',border:'none',cursor:'pointer',color:'#EF4444',fontSize:16}}>🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── RASTREO ── */}
        {section==='tracking' && (
          <div>
            <h1 style={{fontSize:24,fontWeight:700,marginBottom:4}}>Rastreo en Tiempo Real</h1>
            <p style={{color:sub,marginBottom:'1.5rem',fontSize:14}}>Ubicación actual de los repartidores activos.</p>
            <div style={{background:card,border:`1px solid ${bdr}`,borderRadius:10,overflow:'hidden',height:480}}>
              <TrackingMap drivers={drivers} dark={dark} />
            </div>
          </div>
        )}

        {/* ── REPORTES ── */}
        {section==='reports' && (
          <div>
            <h1 style={{fontSize:24,fontWeight:700,marginBottom:4}}>Reportes y Analíticas</h1>
            <p style={{color:sub,marginBottom:'1.5rem',fontSize:14}}>Métricas de desempeño de la plataforma.</p>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
              {/* Ingresos últimos 7 días */}
              <div style={{background:card,border:`1px solid ${bdr}`,borderRadius:10,padding:'1.25rem'}}>
                <div style={{fontWeight:600,marginBottom:'1rem'}}>Ingresos Últimos 7 Días</div>
                <div style={{height:180,display:'flex',alignItems:'flex-end',gap:8,padding:'0 8px'}}>
                  {last7.map((d,i)=>{
                    const rev = orders.filter(o=>o.status==='delivered'&&o.created_at?.slice(0,10)===Array.from({length:7},(_,j)=>{const dt=new Date();dt.setDate(dt.getDate()-6+j);return dt.toISOString().slice(0,10)})[i]).reduce((s,o)=>s+parseFloat(o.total||0),0)
                    const maxRev = 1000
                    return (
                      <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
                        <span style={{fontSize:10,color:sub}}>{rev>0?fmtMoney(rev):''}</span>
                        <div style={{width:'100%',background:dark?'#374151':'#E5E7EB',borderRadius:'4px 4px 0 0',height:140,display:'flex',alignItems:'flex-end'}}>
                          <div style={{width:'100%',background:'#0F6E56',borderRadius:'4px 4px 0 0',height:`${Math.max((rev/maxRev)*100,rev>0?4:0)}%`,transition:'height .3s'}}/>
                        </div>
                        <span style={{fontSize:10,color:sub}}>{d.label}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
              {/* Distribución de estados */}
              <div style={{background:card,border:`1px solid ${bdr}`,borderRadius:10,padding:'1.25rem'}}>
                <div style={{fontWeight:600,marginBottom:'1rem'}}>Distribución de Estados</div>
                <DonutChart orders={orders} dark={dark} sub={sub} />
              </div>
            </div>
            {/* Stats resumen */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16,marginTop:20}}>
              {[
                {label:'Total órdenes', value:stats.total},
                {label:'Tasa de entrega', value:stats.total>0?`${Math.round((stats.completed/stats.total)*100)}%`:'0%'},
                {label:'Ingresos totales', value:fmtMoney(stats.revenue)},
              ].map((k,i)=>(
                <div key={i} style={{background:card,border:`1px solid ${bdr}`,borderRadius:10,padding:'1rem',textAlign:'center'}}>
                  <div style={{fontSize:22,fontWeight:700,color:text,marginBottom:4}}>{k.value}</div>
                  <div style={{fontSize:12,color:sub}}>{k.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── MODAL ASIGNAR ── */}
        {assignOrder && (
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200}}>
            <div style={{background:card,borderRadius:14,padding:'1.5rem',width:'100%',maxWidth:420,margin:'1rem',border:`1px solid ${bdr}`}}>
              <h3 style={{fontWeight:600,marginBottom:6,color:text}}>Asignar #{assignOrder.tracking_code}</h3>
              <p style={{fontSize:13,color:sub,marginBottom:'1rem'}}>{assignOrder.dest_address}</p>
              <div style={{marginBottom:'1rem'}}>
                <label style={{fontSize:13,color:sub,display:'block',marginBottom:5}}>Repartidor</label>
                <select value={assignDriver} onChange={e=>setAssignDriver(e.target.value)} style={{width:'100%',padding:'9px',border:`1px solid ${bdr}`,borderRadius:8,fontSize:14,background:bg,color:text}}>
                  <option value=''>-- Seleccionar --</option>
                  {drivers.map(d=><option key={d.id} value={d.id}>{d.user?.full_name||d.user?.email}</option>)}
                </select>
              </div>
              <div style={{marginBottom:'1rem'}}>
                <label style={{fontSize:13,color:sub,display:'block',marginBottom:5}}>Evento</label>
                <select value={assignCode} onChange={e=>setAssignCode(e.target.value)} style={{width:'100%',padding:'9px',border:`1px solid ${bdr}`,borderRadius:8,fontSize:14,background:bg,color:text}}>
                  {statuses.map(s=><option key={s.codigo} value={s.codigo}>[{s.codigo}] {s.estado_es}</option>)}
                </select>
              </div>
              <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
                <button onClick={()=>setAssignOrder(null)} style={{padding:'8px 16px',border:`1px solid ${bdr}`,borderRadius:8,background:'none',cursor:'pointer',color:text,fontSize:13}}>Cancelar</button>
                <button onClick={doAssign} disabled={processing} style={{padding:'8px 18px',background:'#0F6E56',color:'#fff',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600,opacity:processing?.6:1}}>
                  {processing?'Asignando...':'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── MODAL STATUS ── */}
        {statusOrder && (
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200}}>
            <div style={{background:card,borderRadius:14,padding:'1.5rem',width:'100%',maxWidth:420,margin:'1rem',border:`1px solid ${bdr}`}}>
              <h3 style={{fontWeight:600,marginBottom:6,color:text}}>Cambiar estado #{statusOrder.tracking_code}</h3>
              <div style={{marginBottom:'1rem'}}>
                <label style={{fontSize:13,color:sub,display:'block',marginBottom:5}}>Nuevo estado</label>
                <select value={newStatus} onChange={e=>setNewStatus(e.target.value)} style={{width:'100%',padding:'9px',border:`1px solid ${bdr}`,borderRadius:8,fontSize:14,background:bg,color:text}}>
                  {Object.entries(STATUS_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div style={{marginBottom:'1rem'}}>
                <label style={{fontSize:13,color:sub,display:'block',marginBottom:5}}>Evento de tracking (opcional)</label>
                <select value={statusCode} onChange={e=>setStatusCode(e.target.value)} style={{width:'100%',padding:'9px',border:`1px solid ${bdr}`,borderRadius:8,fontSize:14,background:bg,color:text}}>
                  <option value=''>-- Sin evento --</option>
                  {statuses.map(s=><option key={s.codigo} value={s.codigo}>[{s.codigo}] {s.estado_es}</option>)}
                </select>
              </div>
              <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
                <button onClick={()=>setStatusOrder(null)} style={{padding:'8px 16px',border:`1px solid ${bdr}`,borderRadius:8,background:'none',cursor:'pointer',color:text,fontSize:13}}>Cancelar</button>
                <button onClick={doStatus} disabled={processing} style={{padding:'8px 18px',background:'#185FA5',color:'#fff',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600,opacity:processing?.6:1}}>
                  {processing?'Actualizando...':'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── TRACKING MAP COMPONENT ─────────────────────────────────
function TrackingMap({ drivers, dark }) {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const existing = document.getElementById('leaflet-css')
    if (!existing) {
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
      const existing = document.getElementById('admin-map')?._leaflet_id
      if (existing) return
      const map = L.map('admin-map').setView([19.4326, -99.1332], 12)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map)
      // Pines simulados para repartidores activos
      const active = drivers.filter(d => d.status === 'online')
      const baseCoords = [[19.4326, -99.1332], [19.4426, -99.1432], [19.4226, -99.1232]]
      active.forEach((d, i) => {
        const [lat, lng] = baseCoords[i % baseCoords.length]
        const icon = L.divIcon({
          html: `<div style="background:#0F6E56;color:#fff;padding:4px 8px;border-radius:20px;font-size:11px;white-space:nowrap;font-weight:600;box-shadow:0 2px 6px rgba(0,0,0,0.3)">🚚 ${d.user?.full_name?.split(' ')[0]||'Driver'}</div>`,
          className: '', iconAnchor: [40, 12]
        })
        L.marker([lat + (Math.random()-0.5)*0.02, lng + (Math.random()-0.5)*0.02], { icon }).addTo(map)
      })
    }
    document.head.appendChild(script)
    return () => { try { window.L?.map('admin-map')?.remove() } catch(e){} }
  }, [drivers])

  return <div id="admin-map" style={{width:'100%',height:'100%'}} />
}

// ── DONUT CHART ───────────────────────────────────────────
function DonutChart({ orders, dark, sub }) {
  const counts = {}
  orders.forEach(o => { counts[o.status] = (counts[o.status]||0)+1 })
  const total = orders.length || 1
  const slices = Object.entries(counts).map(([status, count]) => ({
    status, count, pct: count/total,
    color: {pending:'#F59E0B',assigned:'#0F6E56',picked_up:'#1D9E75',in_transit:'#185FA5',delivered:'#10B981',cancelled:'#EF4444'}[status]||'#9CA3AF',
    label: {pending:'Pendiente',assigned:'Asignado',picked_up:'Recogido',in_transit:'En tránsito',delivered:'Completado',cancelled:'Cancelado'}[status]||status
  }))

  if (slices.length === 0) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:160,color:sub,fontSize:13}}>Sin datos</div>

  let offset = 0
  const r = 60, cx = 80, cy = 80, stroke = 28
  const circumference = 2 * Math.PI * r

  return (
    <div style={{display:'flex',alignItems:'center',gap:20}}>
      <svg width={160} height={160} viewBox="0 0 160 160">
        {slices.map((s, i) => {
          const dashArray = s.pct * circumference
          const dashOffset = -offset * circumference
          offset += s.pct
          return (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={stroke}
              strokeDasharray={`${dashArray} ${circumference}`} strokeDashoffset={dashOffset}
              style={{transform:'rotate(-90deg)',transformOrigin:'80px 80px'}} />
          )
        })}
      </svg>
      <div style={{display:'flex',flexDirection:'column',gap:6}}>
        {slices.map((s,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:10,height:10,borderRadius:'50%',background:s.color,flexShrink:0}}/>
            <span style={{fontSize:12,color:sub}}>{s.label} {Math.round(s.pct*100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
