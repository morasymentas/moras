// Qué hace el bot con cada mensaje que entra.
import { registrarEntrante, leerChat, leerConfig, cambiarEstadoChat, registrarSaliente, mensajesDe, eventoProgramado, consultaWebDe, getChatRef } from './datos.js';
import { enviarTexto, leidoYEscribiendo, descargarMedia } from './wa.js';
import { avisarAdmin, respuestaAdmin } from './avisos.js';
import { responder } from './agente.js';
import { admins, ESPERA_AGRUPAR_MS, HISTORIAL_MAX, REAVISO_MS } from './config.js';
import { ahora } from './db.js';

let _espera = ms => new Promise(r => setTimeout(r, ms));
export function setEspera(f){ _espera = f; }   // las pruebas no esperan de verdad

const IGNORAR = new Set(['reaction', 'unsupported', 'system', 'ephemeral', 'request_welcome']);
const NO_SE_LEE = new Set(['audio', 'video', 'document']);

// Deriva el chat a Chinguer: el cliente no recibe nada, Chinguer recibe el aviso
export async function derivar(waId, nombre, motivo, resumen){
  const ts = ahora();
  await cambiarEstadoChat(waId, 'derivado', {motivo, resumen: resumen || null, derivadoEn: ts, avisadoEn: ts});
  return avisarAdmin({waId, nombre, motivo, resumen});
}

export async function procesarEntrante({waId, nombre, mensaje}){
  const ignorable = IGNORAR.has(mensaje.tipo);
  const nuevo = await registrarEntrante({waId, nombre, mensaje, marcaUltimo: !ignorable});
  if (!nuevo) return {resultado: 'duplicado'};
  if (ignorable) return {resultado: 'ignorado'};

  // Chinguer le escribe al número del bot: le contesta con los chats para atender (y queda abierta la ventana de avisos gratis)
  if (admins().includes(waId)){
    const texto = await respuestaAdmin();
    const id = await enviarTexto(waId, texto);
    await registrarSaliente({waId, id, texto, autor: 'bot', extra: {aviso: true}});
    return {resultado: 'admin'};
  }

  let chat = await leerChat(waId);
  const config = await leerConfig();

  if (chat.estado === 'pausado') return {resultado: 'pausado'};
  if (chat.estado === 'derivado' || chat.estado === 'humano'){
    // Ya lo atiende Chinguer: si el cliente sigue escribiendo, se le recuerda (como máximo cada 2 h)
    if (!chat.avisadoEn || Date.now() - Date.parse(chat.avisadoEn) > REAVISO_MS){
      await cambiarEstadoChat(waId, chat.estado, {avisadoEn: ahora()});
      await avisarAdmin({waId, nombre: chat.nombre, motivo: 'sigue_escribiendo', resumen: chat.resumen || ''});
    }
    return {resultado: 'lo_atiende_chinguer'};
  }
  if (!config.activo) return {resultado: 'bot_apagado'};

  // Casos que van directo a Chinguer, sin pasar por la IA
  const texto = mensaje.texto || '';
  if (/CONSULTA SERVICIO PREMIUM/i.test(texto)){
    const c = await consultaWebDe(waId);
    if (c) await getChatRef(waId).set({consultaId: c.id}, {merge: true});
    const datos = [texto.match(/Tipo de evento:\s*(.+)/i)?.[1], texto.match(/Fecha:\s*(.+)/i)?.[1], texto.match(/Invitados:\s*(\d+)/i)?.[1] && texto.match(/Invitados:\s*(\d+)/i)[1] + ' invitados'].filter(Boolean).map(s => s.replace(/\*/g, '').trim()).join(', ');
    await derivar(waId, chat.nombre, 'consulta_web', datos ? 'Pide presupuesto: ' + datos : 'Pide presupuesto del Servicio Premium');
    return {resultado: 'derivado', motivo: 'consulta_web'};
  }
  const programado = await eventoProgramado(waId);
  if (programado){
    await derivar(waId, chat.nombre, 'evento_programado', `${programado.nombre || 'Cliente'}: ${programado.tipo || 'evento'} del ${programado.fecha || 'fecha a confirmar'}`);
    return {resultado: 'derivado', motivo: 'evento_programado'};
  }

  // Tildes azules y "escribiendo…", después espera unos segundos por si manda varios mensajes seguidos
  await leidoYEscribiendo(mensaje.id);
  await _espera(ESPERA_AGRUPAR_MS);
  chat = await leerChat(waId);
  if (chat.ultimoEntranteId !== mensaje.id) return {resultado: 'agrupado'};   // llegó otro después: responde ese, con todo junto
  if (chat.estado !== 'bot') return {resultado: 'cambio_estado'};

  // Si otro mensaje de este chat se está respondiendo, espera a que termine
  for (let i = 0; i < 20 && chat.procesandoHasta && Date.parse(chat.procesandoHasta) > Date.now(); i++){
    await _espera(1500);
    chat = await leerChat(waId);
  }
  await getChatRef(waId).set({procesandoHasta: new Date(Date.now() + 45000).toISOString()}, {merge: true});

  try {
    const historial = await mensajesDe(waId, HISTORIAL_MAX);
    let i = historial.length; while (i > 0 && historial[i - 1].dir === 'in') i--;
    const pendientes = historial.slice(i);
    if (!pendientes.length) return {resultado: 'nada'};

    if (pendientes.some(m => NO_SE_LEE.has(m.tipo))){
      const conTexto = pendientes.map(m => m.texto).filter(Boolean).join(' ').slice(0, 200);
      await derivar(waId, chat.nombre, 'audio', conTexto ? 'Además escribió: ' + conTexto : '');
      return {resultado: 'derivado', motivo: 'audio'};
    }

    // Fotos que mandó el cliente: el bot las puede ver
    const imagenes = {};
    for (const m of pendientes.filter(m => m.tipo === 'image' && m.media && m.media.id).slice(-3)){
      try { const img = await descargarMedia(m.media.id); if (img.bytes < 4.5e6) imagenes[m.id] = img; } catch (e) { console.warn('Foto no descargada', e.message); }
    }

    let r;
    try { r = await responder({waId, nombre: chat.nombre, historial, imagenes, config}); }
    catch (e) {
      console.error('Error del agente', e.status || '', e.message);
      r = {accion: 'derivar', motivo: 'no_sabe', resumen: 'El bot no pudo responder (error de la IA). Último mensaje: ' + (pendientes.map(m => m.texto).filter(Boolean).join(' ').slice(0, 160) || '[sin texto]')};
    }

    // Si mientras pensaba Chinguer tomó el chat, no responde
    const ahoraChat = await leerChat(waId);
    if (ahoraChat.estado !== 'bot') return {resultado: 'cambio_estado'};

    if (r.accion === 'responder'){
      const id = await enviarTexto(waId, r.texto);
      await registrarSaliente({waId, id, texto: r.texto, autor: 'bot'});
      return {resultado: 'respondido', texto: r.texto, herramientas: r.herramientas};
    }
    if (r.accion === 'derivar'){
      await derivar(waId, chat.nombre, r.motivo, r.resumen);
      return {resultado: 'derivado', motivo: r.motivo, resumen: r.resumen, herramientas: r.herramientas};
    }
    return {resultado: 'nada'};
  } finally {
    await getChatRef(waId).set({procesandoHasta: null}, {merge: true});
  }
}

// Mensaje que Chinguer mandó desde la app de WhatsApp Business (con coexistencia): el bot se corre
export async function procesarEco({waId, id, texto, tipo}){
  await registrarSaliente({waId, id, texto, autor: 'app', tipo});
  const chat = await leerChat(waId);
  if (chat && chat.estado !== 'pausado') await cambiarEstadoChat(waId, 'humano', {noLeidos: 0});
}
