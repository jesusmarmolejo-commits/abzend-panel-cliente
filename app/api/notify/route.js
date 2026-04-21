import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const STATUS_LABEL = {
  pending: 'Pendiente',
  assigned: 'Asignado a repartidor',
  picked_up: 'Paquete recogido',
  in_transit: 'En tránsito',
  out_for_delivery: 'En ruta de entrega',
  delivered: 'Entregado',
  cancelled: 'Cancelado'
}

const STATUS_COLOR = {
  pending: '#F59E0B',
  assigned: '#0F6E56',
  picked_up: '#0F6E56',
  in_transit: '#185FA5',
  out_for_delivery: '#7C3AED',
  delivered: '#10B981',
  cancelled: '#EF4444'
}

const STATUS_ICON = {
  pending: '📦',
  assigned: '🚚',
  picked_up: '📬',
  in_transit: '🛣️',
  out_for_delivery: '🏃',
  delivered: '✅',
  cancelled: '❌'
}

function buildEmailHtml({ tracking_code, status, dest_address, origin_address, note, event_code }) {
  const color = STATUS_COLOR[status] || '#0F6E56'
  const label = STATUS_LABEL[status] || status
  const icon = STATUS_ICON[status] || '📦'
  const year = new Date().getFullYear()

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="background:#0F6E56;border-radius:12px 12px 0 0;padding:28px 36px;text-align:center;">
          <div style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:3px;">ABZEND</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.75);margin-top:4px;">Plataforma de envíos</div>
        </td></tr>
        <tr><td style="background:#ffffff;padding:32px 36px 20px;text-align:center;">
          <div style="display:inline-block;background:${color};color:#ffffff;font-size:15px;font-weight:700;padding:10px 24px;border-radius:30px;margin-bottom:16px;">
            ${icon} ${label}
          </div>
          <h2 style="font-size:20px;font-weight:700;color:#111827;margin:0 0 8px;">Tu envío fue actualizado</h2>
          <p style="font-size:14px;color:#6B7280;margin:0;">Aquí tienes los detalles más recientes de tu paquete.</p>
        </td></tr>
        <tr><td style="background:#ffffff;padding:0 36px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border-radius:10px;border:1px solid #E5E7EB;">
            <tr><td style="padding:20px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="padding:8px 0;border-bottom:1px solid #E5E7EB;">
                  <span style="font-size:12px;color:#9CA3AF;display:block;margin-bottom:3px;">Número de guía</span>
                  <span style="font-size:15px;font-weight:700;color:#111827;letter-spacing:1px;">${tracking_code}</span>
                  ${event_code ? `<span style="margin-left:10px;background:#E1F5EE;color:#0F6E56;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;">[${event_code}]</span>` : ''}
                </td></tr>
                <tr><td style="padding:10px 0;border-bottom:1px solid #E5E7EB;">
                  <span style="font-size:12px;color:#9CA3AF;display:block;margin-bottom:3px;">Estado actual</span>
                  <span style="font-size:14px;font-weight:600;color:${color};">${icon} ${label}</span>
                </td></tr>
                <tr><td style="padding:10px 0;border-bottom:1px solid #E5E7EB;">
                  <span style="font-size:12px;color:#9CA3AF;display:block;margin-bottom:3px;">Origen</span>
                  <span style="font-size:13px;color:#374151;">${origin_address || '—'}</span>
                </td></tr>
                <tr><td style="padding:10px 0;">
                  <span style="font-size:12px;color:#9CA3AF;display:block;margin-bottom:3px;">Destino</span>
                  <span style="font-size:13px;color:#374151;">${dest_address || '—'}</span>
                </td></tr>
                ${note ? `<tr><td style="padding:10px 0 0;border-top:1px solid #E5E7EB;">
                  <span style="font-size:12px;color:#9CA3AF;display:block;margin-bottom:3px;">Nota</span>
                  <span style="font-size:13px;color:#374151;font-style:italic;">${note}</span>
                </td></tr>` : ''}
              </table>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="background:#ffffff;padding:0 36px 32px;text-align:center;">
          <p style="font-size:13px;color:#6B7280;margin:0 0 16px;">Puedes rastrear tu envío en tiempo real desde tu panel de cliente.</p>
          <a href="https://abzend-panel-cliente.vercel.app/dashboard"
            style="display:inline-block;background:#0F6E56;color:#ffffff;font-size:14px;font-weight:700;padding:13px 32px;border-radius:8px;text-decoration:none;">
            Ver mi envío
          </a>
        </td></tr>
        <tr><td style="background:#F9FAFB;border-radius:0 0 12px 12px;padding:20px 36px;text-align:center;border-top:1px solid #E5E7EB;">
          <p style="font-size:12px;color:#9CA3AF;margin:0;">
            Este correo fue enviado automáticamente por ABZEND.<br>
            © ${year} ABZEND. Todos los derechos reservados.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export async function POST(request) {
  try {
    const body = await request.json()
    console.log('Webhook payload:', JSON.stringify(body))

    // Supabase webhook payload tiene { type, table, record, old_record }
    const record = body.record || body

    const order_id = record.order_id
    const status = record.status
    const status_code = record.status_code
    const note = record.note

    if (!order_id) {
      // Llamada directa desde el panel (no webhook)
      const { to, tracking_code, dest_address, origin_address } = body
      if (!to || !tracking_code) {
        return NextResponse.json({ error: 'Faltan campos' }, { status: 400 })
      }
      const html = buildEmailHtml({ tracking_code, status, dest_address, origin_address, note, event_code: status_code })
      const label = STATUS_LABEL[status] || status
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'ABZEND <onboarding@resend.dev>', to: [to], subject: `${STATUS_ICON[status] || '📦'} Tu envío — ${label}`, html })
      })
      const data = await res.json()
      return NextResponse.json({ success: res.ok, id: data.id })
    }

    // Buscar la orden y el correo del cliente
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('tracking_code, origin_address, dest_address, client:client_id(email, full_name)')
      .eq('id', order_id)
      .single()

    if (orderError || !order) {
      console.error('Order not found:', orderError)
      return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 })
    }

    const clientEmail = order.client?.email
    if (!clientEmail) {
      console.log('No client email found for order:', order_id)
      return NextResponse.json({ skipped: true, reason: 'no email' })
    }

    const html = buildEmailHtml({
      tracking_code: order.tracking_code,
      status,
      dest_address: order.dest_address,
      origin_address: order.origin_address,
      note,
      event_code: status_code
    })

    const label = STATUS_LABEL[status] || status
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'ABZEND <onboarding@resend.dev>',
        to: [clientEmail],
        subject: `${STATUS_ICON[status] || '📦'} Tu envío ${order.tracking_code} — ${label}`,
        html
      })
    })

    const data = await res.json()
    console.log('Email sent:', data)
    return NextResponse.json({ success: res.ok, id: data.id, to: clientEmail })

  } catch(e) {
    console.error('Notify error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
