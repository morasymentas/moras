// Todo lo que el bot lee y guarda en la base:
//   whatsapp/{numero}                chat con un cliente (estado, último mensaje, si está derivado…)
//   whatsapp/{numero}/mensajes/{id}  cada mensaje, entrante o saliente
//   config/bot                       encendido, modelo e información que usa el bot
//   disponibilidad/chacra            fechas reservadas de la chacra (las carga el panel)
//   consultas                        las mismas consultas del panel; el bot suma las que llegan por WhatsApp
import { getDb, ahora, hoyUY, sumarDias, diaSemana, fechaLarga, esIso, isoADate, ultimos8, telLocal } from './db.js';
import { INFO_INICIAL } from './conocimiento.js';
import { MODELO_POR_DEFECTO, VUELVE_AL_BOT_DIAS } from './config.js';

export const ESTADOS_CHAT = {
  bot: 'Lo atiende el bot',
  derivado: 'Para atender',
  humano: 'Lo atendés vos',
  pausado: 'Bot pausado en este chat'
};

const chatRef = waId => getDb().collection('whatsapp').doc(waId);
const mensajesCol = waId => chatRef(waId).collection('mensajes');
export const getChatRef = chatRef;

/* ---------- configuración ---------- */
export async function leerConfig(){
  const ref = getDb().collection('config').doc('bot');
  const s = await ref.get();
  if (s.exists) return {activo: true, modelo: MODELO_POR_DEFECTO, info: INFO_INICIAL, ...s.data()};
  const base = {activo: true, modelo: MODELO_POR_DEFECTO, info: INFO_INICIAL, creado: ahora()};
  try { await ref.create(base); } catch {}
  return base;
}
export async function guardarConfig(cambios){
  const ok = {};
  if (typeof cambios.activo === 'boolean') ok.activo = cambios.activo;
  if (typeof cambios.info === 'string' && cambios.info.trim().length > 50) ok.info = cambios.info.trim().slice(0, 20000);
  if (typeof cambios.modelo === 'string' && /^claude-[a-z0-9.-]+$/.test(cambios.modelo)) ok.modelo = cambios.modelo;
  if (!Object.keys(ok).length) return leerConfig();
  ok.actualizado = ahora();
  await getDb().collection('config').doc('bot').set(ok, {merge: true});
  return leerConfig();
}

/* ---------- fechas de la chacra ---------- */
export async function fechasReservadas(){
  const s = await getDb().collection('disponibilidad').doc('chacra').get();
  const d = s.exists ? s.data() : {};
  const hoy = hoyUY();
  return [...new Set([...(d.ocupadoAdmin || []), ...(d.ocupadoProveedor || [])])].filter(x => esIso(x) && x >= hoy).sort();
}

// Dice si una fecha está libre; si no, propone el mismo día del fin de semana anterior o siguiente que esté libre
export async function consultarFecha(fecha){
  if (!esIso(fecha)) return {error: 'Fecha inválida. Usá el formato AAAA-MM-DD.'};
  const hoy = hoyUY();
  if (fecha < hoy) return {fecha, dia: fechaLarga(fecha), estado: 'pasada', nota: 'Esa fecha ya pasó.'};
  if (fecha > sumarDias(hoy, 3 * 366)) return {fecha, dia: fechaLarga(fecha), estado: 'muy_lejana', nota: 'Todavía no hay agenda cargada para esa fecha; Chinguer lo confirma.'};
  const ocupadas = new Set(await fechasReservadas());
  if (!ocupadas.has(fecha)) return {fecha, dia: fechaLarga(fecha), estado: 'libre'};
  const alternativas = [];
  for (const semanas of [-1, 1, -2, 2, 3]){
    const f = sumarDias(fecha, semanas * 7);
    if (f >= hoy && !ocupadas.has(f)) alternativas.push({fecha: f, dia: fechaLarga(f), cuando: semanas < 0 ? `${-semanas} semana(s) antes` : `${semanas} semana(s) después`});
    if (alternativas.length >= 2) break;
  }
  return {fecha, dia: fechaLarga(fecha), estado: 'reservada', alternativas_libres: alternativas};
}

/* ---------- chats y mensajes ---------- */
export async function leerChat(waId){
  const s = await chatRef(waId).get();
  return s.exists ? {waId, ...s.data()} : null;
}

// Guarda un mensaje del cliente. Devuelve false si ya estaba (Meta a veces manda el mismo aviso dos veces).
// marcaUltimo=false para reacciones y similares: se guardan pero no cuentan como mensaje nuevo a responder
export async function registrarEntrante({waId, nombre, mensaje, marcaUltimo = true}){
  const ts = ahora();
  try {
    await mensajesCol(waId).doc(mensaje.id).create({id: mensaje.id, dir: 'in', autor: 'cliente', tipo: mensaje.tipo, texto: mensaje.texto || '', media: mensaje.media || null, ts, tsMeta: mensaje.tsMeta || null});
  } catch (e) {
    if (e && (e.code === 6 || e.code === 'already-exists' || /ALREADY_EXISTS|already exists/i.test(String(e.message)))) return false;
    throw e;
  }
  const prev = await leerChat(waId);
  const base = prev || {creado: ts, estado: 'bot', noLeidos: 0};
  // Si pasó mucho tiempo sin movimiento, el chat vuelve al bot
  let estado = base.estado || 'bot';
  if (estado !== 'bot' && estado !== 'pausado' && base.actualizado && (Date.now() - Date.parse(base.actualizado)) > VUELVE_AL_BOT_DIAS * 864e5) estado = 'bot';
  await chatRef(waId).set({
    ...(prev ? {} : {creado: ts}),
    waId, telefono: telLocal(waId),
    nombre: nombre || base.nombre || '',
    estado,
    ultimaEntrada: ts,
    ...(marcaUltimo ? {ultimoEntranteId: mensaje.id, ultimoTexto: resumenMensaje(mensaje), ultimoDe: 'cliente', noLeidos: (base.noLeidos || 0) + 1} : {}),
    actualizado: ts
  }, {merge: true});
  return true;
}

export async function registrarSaliente({waId, id, texto, autor, tipo = 'text', extra = {}}){
  const ts = ahora();
  const docId = id || ('local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
  await mensajesCol(waId).doc(docId).set({id: docId, dir: 'out', autor, tipo, texto: texto || '', ts, estado: id ? 'enviado' : 'sin_id', ...extra});
  await chatRef(waId).set({waId, telefono: telLocal(waId), ultimaSalida: ts, ultimoTexto: texto ? String(texto).slice(0, 160) : '', ultimoDe: autor, actualizado: ts}, {merge: true});
  return docId;
}

export async function mensajesDe(waId, n = 40){
  const s = await mensajesCol(waId).orderBy('ts', 'desc').limit(n).get();
  return s.docs.map(d => d.data()).reverse();
}

export async function marcarEstadoMensaje(waId, id, estado, error){
  const ref = mensajesCol(waId).doc(id);
  const s = await ref.get();
  if (!s.exists) return;
  const orden = {enviado: 1, sent: 1, delivered: 2, read: 3, failed: 9};
  const actual = s.data().estado;
  if (estado !== 'failed' && (orden[actual] || 0) > (orden[estado] || 0)) return;   // los avisos pueden llegar desordenados
  await ref.set({estado, ...(error ? {error} : {})}, {merge: true});
}

export async function cambiarEstadoChat(waId, estado, extra = {}){
  if (!ESTADOS_CHAT[estado]) throw new Error('Estado de chat inválido');
  const cambios = {estado, actualizado: ahora(), ...extra};
  if (estado === 'bot') Object.assign(cambios, {motivo: null, resumen: null});
  await chatRef(waId).set(cambios, {merge: true});
}

export async function marcarLeido(waId){ await chatRef(waId).set({noLeidos: 0}, {merge: true}); }

export async function listarChats(n = 80){
  const s = await getDb().collection('whatsapp').orderBy('actualizado', 'desc').limit(n).get();
  return s.docs.map(d => ({waId: d.id, ...d.data()}));
}

// Busca un chat por número (completo o los últimos dígitos) o por nombre
export async function buscarChat(texto){
  const t = String(texto || '').trim(); if (!t) return null;
  const dig = t.replace(/\D/g, '');
  if (dig.length >= 8){
    const directo = await leerChat(dig); if (directo) return directo;
  }
  const todos = await listarChats(300);
  const tl = t.toLowerCase();
  return todos.find(c => dig.length >= 6 && ultimos8(c.waId).endsWith(dig.slice(-8)))
    || todos.find(c => (c.nombre || '').toLowerCase().includes(tl))
    || null;
}

export function resumenMensaje(m){
  if (m.texto) return String(m.texto).slice(0, 160);
  return ({image: '[Foto]', audio: '[Audio]', video: '[Video]', document: '[Documento]', sticker: '[Sticker]', location: '[Ubicación]', contacts: '[Contacto]', reaction: '[Reacción]'})[m.tipo] || '[Mensaje]';
}

/* ---------- consultas del panel ---------- */
// ¿Este número tiene un evento señado o confirmado? Entonces lo atiende Chinguer.
export async function eventoProgramado(waId){
  const s = await getDb().collection('consultas').where('estado', 'in', ['senada', 'confirmada']).get();
  const hoy = hoyUY(), u = ultimos8(waId);
  const c = s.docs.map(d => ({id: d.id, ...d.data()})).find(c => c.telefono && ultimos8(c.telefono) === u && (!c.fecha || c.fecha >= hoy));
  return c || null;
}

// Consulta que el cliente mandó desde el sitio (para vincularla al chat)
export async function consultaWebDe(waId){
  const s = await getDb().collection('consultas').where('origen', '==', 'web').get();
  const u = ultimos8(waId);
  const c = s.docs.map(d => ({id: d.id, ...d.data()})).filter(c => c.telefono && ultimos8(c.telefono) === u).sort((a, b) => String(b.creado || '').localeCompare(String(a.creado || '')))[0];
  return c || null;
}

// El bot va completando una consulta con lo que cuenta el cliente; aparece en la lista del panel
export async function registrarDatos(waId, datos){
  const chat = await leerChat(waId) || {};
  const cambios = {};
  if (datos.nombre) cambios.nombre = String(datos.nombre).trim().slice(0, 80);
  if (datos.tipo_evento) cambios.tipo = String(datos.tipo_evento).trim().slice(0, 60);
  if (esIso(datos.fecha)) cambios.fecha = datos.fecha;
  if (Number.isFinite(+datos.invitados) && +datos.invitados > 0) cambios.invitados = Math.round(+datos.invitados);
  const notas = [datos.espacio ? 'Espacio: ' + datos.espacio : '', datos.notas || ''].filter(Boolean).join(' · ').slice(0, 400);
  if (!Object.keys(cambios).length && !notas) return {ok: false, motivo: 'sin datos'};
  const col = getDb().collection('consultas');
  let id = chat.consultaId;
  if (id){
    const s = await col.doc(id).get();
    if (!s.exists) id = null;
    else {
      const prev = s.data();
      await col.doc(id).set({...cambios, ...(notas ? {notas: [prev.notas, notas].filter(Boolean).join('\n').slice(-1500)} : {})}, {merge: true});
    }
  }
  if (!id){
    const ref = col.doc();
    id = ref.id;
    await ref.set({
      nombre: cambios.nombre || chat.nombre || '', fecha: cambios.fecha || '', tipo: cambios.tipo || '', invitados: cambios.invitados || 0,
      telefono: telLocal(waId), pesos: 0, usd: 0, pendientes: '', servicios: [], mobiliario: [], extras: [],
      mensaje: 'Consulta que llegó por WhatsApp (la va completando el bot).', estado: 'nueva', origen: 'whatsapp',
      notas, visitas: [], creado: ahora()
    });
    await chatRef(waId).set({consultaId: id}, {merge: true});
  }
  return {ok: true, consultaId: id};
}

export const esFechaFutura = f => esIso(f) && isoADate(f) >= isoADate(hoyUY());
export { diaSemana };
