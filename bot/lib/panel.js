// Acciones de la sección WhatsApp del panel. Solo para usuarios con rol de administrador.
import { getDb } from './db.js';
import { leerConfig, guardarConfig, listarChats, leerChat, mensajesDe, marcarLeido, cambiarEstadoChat, registrarSaliente, ESTADOS_CHAT } from './datos.js';
import { enviarTexto, infoNumero, appsSuscriptas, suscribirApp, registrarNumero } from './wa.js';
import { INFO_INICIAL } from './conocimiento.js';
import { MOTIVOS } from './avisos.js';
import { admins, VENTANA_MS, WA_PHONE_NUMBER_ID, WA_WABA_ID, val } from './config.js';

export class ErrorPanel extends Error { constructor(code, msg){ super(msg); this.code = code; } }

export async function esAdmin(uid){
  if (!uid) return false;
  const s = await getDb().collection('usuarios').doc(uid).get();
  return s.exists && s.data().rol === 'admin';
}

export const ventanaAbierta = chat => !!(chat && chat.ultimaEntrada && Date.now() - Date.parse(chat.ultimaEntrada) < VENTANA_MS);

// Manda un mensaje escrito por Chinguer (panel o conector MCP). El bot se corre de ese chat.
export async function responderComoHumano(waId, texto){
  const t = String(texto || '').trim();
  if (!t) throw new ErrorPanel('invalid-argument', 'El mensaje está vacío.');
  const chat = await leerChat(waId);
  if (!chat) throw new ErrorPanel('not-found', 'No existe ese chat.');
  if (!ventanaAbierta(chat)) throw new ErrorPanel('failed-precondition', 'Pasaron más de 24 horas desde el último mensaje del cliente: WhatsApp no deja escribirle texto libre hasta que vuelva a escribir. Llamalo o esperá que responda.');
  let id;
  try { id = await enviarTexto(waId, t); }
  catch (e) { throw new ErrorPanel('unavailable', 'WhatsApp no aceptó el mensaje: ' + e.message); }
  await registrarSaliente({waId, id, texto: t, autor: 'humano'});
  if (chat.estado !== 'pausado') await cambiarEstadoChat(waId, 'humano', {noLeidos: 0});
  return {ok: true, id};
}

const resumenChat = c => ({
  waId: c.waId, nombre: c.nombre || '', telefono: c.telefono || c.waId, estado: c.estado || 'bot',
  motivo: c.motivo ? (MOTIVOS[c.motivo] || c.motivo) : '', resumen: c.resumen || '',
  ultimoTexto: c.ultimoTexto || '', ultimoDe: c.ultimoDe || '', actualizado: c.actualizado || '',
  noLeidos: c.noLeidos || 0, ventana: ventanaAbierta(c), consultaId: c.consultaId || null, derivadoEn: c.derivadoEn || null
});

export async function accionPanel(data, uid){
  if (!(await esAdmin(uid))) throw new ErrorPanel('permission-denied', 'Solo el administrador puede usar esta sección.');
  const d = data || {};
  switch (d.accion){
    case 'resumen': {
      const config = await leerConfig();
      const adm = admins();
      const chats = (await listarChats(150)).filter(c => !adm.includes(c.waId)).map(resumenChat);
      return {config: {activo: config.activo !== false, modelo: config.modelo, info: config.info}, chats, estados: ESTADOS_CHAT, numeroConfigurado: !!val(WA_PHONE_NUMBER_ID)};
    }
    case 'chat': {
      const chat = await leerChat(String(d.waId || ''));
      if (!chat) throw new ErrorPanel('not-found', 'No existe ese chat.');
      const mensajes = (await mensajesDe(chat.waId, 120)).map(m => ({id: m.id, dir: m.dir, autor: m.autor, tipo: m.tipo, texto: m.texto, ts: m.ts, estado: m.estado || null, error: m.error || null}));
      await marcarLeido(chat.waId);
      return {chat: resumenChat(chat), mensajes};
    }
    case 'responder': return responderComoHumano(String(d.waId || ''), d.texto);
    case 'estado': {
      if (!ESTADOS_CHAT[d.estado]) throw new ErrorPanel('invalid-argument', 'Estado inválido.');
      await cambiarEstadoChat(String(d.waId || ''), d.estado, d.estado === 'bot' ? {noLeidos: 0} : {});
      return {ok: true};
    }
    case 'config': {
      const c = await guardarConfig({activo: d.activo, info: d.info, modelo: d.modelo});
      return {config: {activo: c.activo !== false, modelo: c.modelo, info: c.info}};
    }
    case 'info_inicial': return {info: INFO_INICIAL};
    case 'diagnostico': {
      const r = {numeroId: val(WA_PHONE_NUMBER_ID), wabaId: val(WA_WABA_ID), avisosA: admins()};
      try { r.numero = await infoNumero(); } catch (e) { r.errorNumero = e.message; }
      try { r.suscripta = (await appsSuscriptas()).length > 0; } catch (e) { r.errorSuscripcion = e.message; }
      return r;
    }
    case 'suscribir': {
      try { await suscribirApp(); return {ok: true}; }
      catch (e) { throw new ErrorPanel('unavailable', 'Meta no aceptó la suscripción: ' + e.message); }
    }
    case 'registrar': {
      if (!/^\d{6}$/.test(String(d.pin || ''))) throw new ErrorPanel('invalid-argument', 'El PIN tiene que tener 6 números.');
      try { await registrarNumero(d.pin); return {ok: true}; }
      catch (e) { throw new ErrorPanel('unavailable', 'Meta no activó el número: ' + e.message); }
    }
    default: throw new ErrorPanel('invalid-argument', 'Acción desconocida.');
  }
}
