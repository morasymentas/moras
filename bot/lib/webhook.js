// Webhook oficial de WhatsApp: Meta avisa acá cada mensaje que entra y cada cambio de estado (enviado, entregado, leído).
import { firmaValida } from './wa.js';
import { procesarEntrante, procesarEco, derivar } from './procesar.js';
import { marcarEstadoMensaje } from './datos.js';
import { WA_APP_SECRET, WA_VERIFY_TOKEN, val } from './config.js';

// Pasa el mensaje de Meta a un formato simple
export function normalizar(m){
  const base = {id: m.id, tipo: m.type, tsMeta: m.timestamp ? new Date(+m.timestamp * 1000).toISOString() : null};
  switch (m.type){
    case 'text': return {...base, texto: m.text && m.text.body};
    case 'image': return {...base, texto: (m.image && m.image.caption) || '', media: {id: m.image && m.image.id, mime: m.image && m.image.mime_type}};
    case 'video': return {...base, texto: (m.video && m.video.caption) || '', media: {id: m.video && m.video.id}};
    case 'document': return {...base, texto: (m.document && (m.document.caption || m.document.filename)) || '', media: {id: m.document && m.document.id}};
    case 'audio': case 'voice': return {...base, tipo: 'audio', media: {id: (m.audio || m.voice || {}).id}};
    case 'sticker': return {...base, tipo: 'sticker', texto: '[Sticker]'};
    case 'location': { const l = m.location || {}; return {...base, texto: `[Ubicación] ${[l.name, l.address].filter(Boolean).join(', ') || ''} ${l.latitude || ''},${l.longitude || ''}`.trim()}; }
    case 'contacts': return {...base, texto: '[Contacto] ' + ((m.contacts || []).map(c => c.name && c.name.formatted_name).filter(Boolean).join(', '))};
    case 'button': return {...base, tipo: 'text', texto: m.button && m.button.text};
    case 'interactive': { const i = m.interactive || {}; return {...base, tipo: 'text', texto: (i.button_reply && i.button_reply.title) || (i.list_reply && i.list_reply.title) || ''}; }
    case 'reaction': return {...base, texto: (m.reaction && m.reaction.emoji) || ''};
    default: return {...base, texto: ''};
  }
}

export async function manejarWebhook(req, res){
  // 1) Verificación inicial que hace Meta al configurar el webhook
  if (req.method === 'GET'){
    let q = req.query || {};
    if (!q['hub.mode'] && req.url && req.url.includes('?')) q = Object.fromEntries(new URLSearchParams(req.url.split('?')[1]));
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] && q['hub.verify_token'] === val(WA_VERIFY_TOKEN)) return res.status(200).send(String(q['hub.challenge'] || ''));
    return res.status(403).send('Token de verificación incorrecto');
  }
  if (req.method !== 'POST') return res.status(405).send('');

  // 2) Solo aceptamos avisos firmados por Meta
  const firma = (req.get && req.get('x-hub-signature-256')) || (req.headers && req.headers['x-hub-signature-256']);
  if (!firmaValida(req.rawBody, firma, val(WA_APP_SECRET))){
    console.warn('Aviso con firma inválida: se descarta');
    return res.status(401).send('Firma inválida');
  }

  const body = req.body || {};
  const resultados = [];
  if (body.object === 'whatsapp_business_account'){
    for (const entry of body.entry || []){
      for (const ch of entry.changes || []){
        const v = ch.value || {};
        try {
          if (ch.field === 'messages'){
            const nombres = Object.fromEntries((v.contacts || []).map(c => [c.wa_id, c.profile && c.profile.name]));
            for (const st of v.statuses || []){
              await marcarEstadoMensaje(st.recipient_id, st.id, st.status, st.errors && st.errors[0] ? {code: st.errors[0].code, title: st.errors[0].title || st.errors[0].message || ''} : null).catch(e => console.warn('estado', e.message));
            }
            for (const m of v.messages || []){
              const waId = m.from;
              const mensaje = normalizar(m);
              try { resultados.push(await procesarEntrante({waId, nombre: nombres[waId] || '', mensaje})); }
              catch (e) {
                // Si algo falla después de guardar el mensaje, que no quede sin atender
                console.error('Error procesando', mensaje.id, e);
                try { await derivar(waId, nombres[waId] || '', 'no_sabe', 'Error interno del bot: ' + e.message); } catch (e2) { console.error('Tampoco se pudo derivar', e2.message); }
              }
            }
          } else if (ch.field === 'smb_message_echoes'){
            for (const m of v.message_echoes || []){
              await procesarEco({waId: m.to, id: m.id, tipo: m.type, texto: (m.text && m.text.body) || (m.type ? `[${m.type}]` : '')});
            }
          }
        } catch (e) { console.error('Error en el aviso de Meta', ch.field, e); }
      }
    }
  }
  // Siempre 200 una vez validada la firma: si no, Meta reintenta y el mensaje ya quedó guardado
  res.status(200).send('ok');
  return resultados;
}
