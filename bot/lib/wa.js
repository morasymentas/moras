// Cliente de la API oficial de WhatsApp (Cloud API de Meta).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { GRAPH, WA_TOKEN, WA_PHONE_NUMBER_ID, WA_WABA_ID, val } from './config.js';

let _fetch = (...a) => globalThis.fetch(...a);
export function setFetch(f){ _fetch = f; }   // las pruebas cambian la conexión por una falsa

export class ErrorWA extends Error {
  constructor(msg, code, detalle){ super(msg); this.code = code; this.detalle = detalle; }
}

async function graph(path, {method = 'GET', body} = {}){
  const r = await _fetch(GRAPH + path, {
    method,
    headers: {Authorization: 'Bearer ' + val(WA_TOKEN), ...(body ? {'Content-Type': 'application/json'} : {})},
    body: body ? JSON.stringify(body) : undefined
  });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch {}
  if (!r.ok){
    const e = (j && j.error) || {};
    throw new ErrorWA(e.message || ('WhatsApp respondió ' + r.status), e.code || r.status, e.error_data || txt.slice(0, 300));
  }
  return j;
}

const numero = () => val(WA_PHONE_NUMBER_ID);

// Texto libre: solo dentro de las 24 h desde el último mensaje del cliente
export async function enviarTexto(to, texto){
  const j = await graph(`/${numero()}/messages`, {method: 'POST', body: {
    messaging_product: 'whatsapp', recipient_type: 'individual', to,
    type: 'text', text: {body: String(texto).slice(0, 4096), preview_url: true}
  }});
  return j && j.messages && j.messages[0] && j.messages[0].id;
}

// Plantilla aprobada (sirve fuera de la ventana de 24 h)
export async function enviarPlantilla(to, nombre, parametros = [], idioma = 'es'){
  const limpio = s => String(s || '-').replace(/[\n\t]+/g, ' ').replace(/ {4,}/g, '   ').slice(0, 900) || '-';
  const j = await graph(`/${numero()}/messages`, {method: 'POST', body: {
    messaging_product: 'whatsapp', to, type: 'template',
    template: {name: nombre, language: {code: idioma}, components: parametros.length ? [{type: 'body', parameters: parametros.map(p => ({type: 'text', text: limpio(p)}))}] : []}
  }});
  return j && j.messages && j.messages[0] && j.messages[0].id;
}

// Marca el mensaje como leído (tildes azules) y muestra "escribiendo…" mientras el bot arma la respuesta
export async function leidoYEscribiendo(messageId){
  try {
    await graph(`/${numero()}/messages`, {method: 'POST', body: {messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: {type: 'text'}}});
  } catch {}
}

// Descarga una foto que mandó el cliente (para que el bot la pueda ver)
export async function descargarMedia(mediaId){
  const info = await graph(`/${mediaId}`);
  const r = await _fetch(info.url, {headers: {Authorization: 'Bearer ' + val(WA_TOKEN)}});
  if (!r.ok) throw new ErrorWA('No se pudo descargar la imagen', r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  return {base64: buf.toString('base64'), mime: info.mime_type || r.headers.get('content-type') || 'image/jpeg', bytes: buf.length};
}

// Valida que el aviso viene de Meta: firma HMAC-SHA256 del cuerpo con la clave secreta de la app
export function firmaValida(rawBody, cabecera, secreto){
  if (!rawBody || !cabecera || !secreto) return false;
  const esperado = 'sha256=' + createHmac('sha256', secreto).update(rawBody).digest('hex');
  const a = Buffer.from(esperado), b = Buffer.from(String(cabecera));
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ---------- diagnóstico y activación (los usa el panel) ---------- */
export async function infoNumero(){
  try { return await graph(`/${numero()}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,status`); }
  catch (e) { if (e.code === 100) return graph(`/${numero()}?fields=display_phone_number,verified_name`); throw e; }
}
export async function appsSuscriptas(){
  const j = await graph(`/${val(WA_WABA_ID)}/subscribed_apps`);
  return (j && j.data) || [];
}
// Sin esto Meta no manda los mensajes del número real al webhook (solo los del número de prueba)
export const suscribirApp = () => graph(`/${val(WA_WABA_ID)}/subscribed_apps`, {method: 'POST'});
// Activa el número en la API con un PIN de 6 dígitos (queda como verificación en dos pasos)
export const registrarNumero = pin => graph(`/${numero()}/register`, {method: 'POST', body: {messaging_product: 'whatsapp', pin: String(pin)}});
