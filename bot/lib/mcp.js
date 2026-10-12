// Conector MCP: le da a Claude (claude.ai, la app o Claude Code) herramientas para manejar el WhatsApp de la chacra.
// Se agrega en claude.ai > Configuración > Conectores > Agregar conector personalizado, con el link
//   https://us-central1-morasymentas-bac78.cloudfunctions.net/mcp/<MCP_KEY>
import { timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { listarChats, buscarChat, mensajesDe, cambiarEstadoChat, fechasReservadas, consultarFecha, leerConfig, guardarConfig, marcarLeido, ESTADOS_CHAT } from './datos.js';
import { responderComoHumano, ventanaAbierta } from './panel.js';
import { MOTIVOS } from './avisos.js';
import { admins, MCP_KEY, val } from './config.js';
import { fechaLarga } from './db.js';

const texto = t => ({content: [{type: 'text', text: t}]});
const error = t => ({content: [{type: 'text', text: t}], isError: true});
const hora = iso => iso ? new Date(iso).toLocaleString('es-UY', {timeZone: 'America/Montevideo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : '';
const linea = c => `- ${c.nombre || 'Sin nombre'} · ${c.telefono || c.waId} · ${ESTADOS_CHAT[c.estado] || c.estado}${c.motivo ? ' · ' + (MOTIVOS[c.motivo] || c.motivo) : ''}${c.resumen ? ' · ' + c.resumen : ''}${c.noLeidos ? ` · ${c.noLeidos} sin leer` : ''} · último: "${(c.ultimoTexto || '').slice(0, 80)}" (${hora(c.actualizado)})`;
const autor = m => m.dir === 'in' ? 'Cliente' : ({bot: 'Bot', humano: 'Chinguer (panel)', app: 'Chinguer (app)'})[m.autor] || 'Moras & Mentas';

async function chatDe(ref){
  const c = await buscarChat(ref);
  if (!c) throw new Error(`No encontré un chat para "${ref}". Probá con el número o con otro nombre.`);
  return c;
}

export function crearServidor(){
  const s = new McpServer({name: 'moras-y-mentas-whatsapp', version: '1.0.0'});
  const leer = {readOnlyHint: true, openWorldHint: false};

  s.registerTool('chats_para_atender', {
    title: 'Chats para atender',
    description: 'Lista los chats de WhatsApp que el bot derivó a Chinguer (visitas, reservas, descuentos, dudas que no sabe) y los que él atiende y tienen mensajes sin leer.',
    inputSchema: {}, annotations: leer
  }, async () => {
    const adm = admins();
    const chats = (await listarChats(200)).filter(c => !adm.includes(c.waId) && (c.estado === 'derivado' || (c.estado === 'humano' && c.noLeidos > 0)));
    return texto(chats.length ? `Chats para atender (${chats.length}):\n${chats.map(linea).join('\n')}` : 'No hay chats para atender: el bot está al día.');
  });

  s.registerTool('chats_recientes', {
    title: 'Chats recientes',
    description: 'Lista los últimos chats de WhatsApp de la chacra, con su estado (bot, para atender, atendido por Chinguer, pausado).',
    inputSchema: {cantidad: z.number().int().min(1).max(100).optional().describe('Cuántos chats (por defecto 20)')}, annotations: leer
  }, async ({cantidad}) => {
    const adm = admins();
    const chats = (await listarChats(cantidad || 20)).filter(c => !adm.includes(c.waId));
    return texto(chats.length ? chats.map(linea).join('\n') : 'Todavía no hay chats.');
  });

  s.registerTool('leer_chat', {
    title: 'Leer un chat',
    description: 'Muestra la conversación de WhatsApp con un cliente. Se busca por número de teléfono o por nombre.',
    inputSchema: {chat: z.string().describe('Número (ej. 098361104 o 59898361104) o nombre del cliente'), cantidad: z.number().int().min(1).max(200).optional()},
    annotations: leer
  }, async ({chat, cantidad}) => {
    try {
      const c = await chatDe(chat);
      const msgs = await mensajesDe(c.waId, cantidad || 40);
      await marcarLeido(c.waId);
      const cab = `${c.nombre || 'Sin nombre'} · ${c.telefono || c.waId} · ${ESTADOS_CHAT[c.estado] || c.estado}${c.motivo ? ' · ' + (MOTIVOS[c.motivo] || c.motivo) : ''}${c.resumen ? '\nResumen: ' + c.resumen : ''}\n${ventanaAbierta(c) ? 'Se le puede responder (ventana de 24 h abierta).' : 'Pasaron más de 24 h desde su último mensaje: no se le puede escribir texto libre hasta que vuelva a escribir.'}`;
      return texto(`${cab}\n\n${msgs.map(m => `[${hora(m.ts)}] ${autor(m)}: ${m.texto || '[' + m.tipo + ']'}`).join('\n')}`);
    } catch (e) { return error(e.message); }
  });

  s.registerTool('responder_whatsapp', {
    title: 'Responder por WhatsApp',
    description: 'Le manda un mensaje al cliente desde el WhatsApp de Moras & Mentas, en nombre de Chinguer. El bot deja de responder en ese chat hasta que se lo devuelva. Antes de mandar, mostrale el texto al usuario y pedile confirmación.',
    inputSchema: {chat: z.string().describe('Número o nombre del cliente'), texto: z.string().min(1).max(4000).describe('Mensaje a enviar, tal cual')},
    annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: true}
  }, async ({chat, texto: t}) => {
    try {
      const c = await chatDe(chat);
      await responderComoHumano(c.waId, t);
      return texto(`Enviado a ${c.nombre || c.telefono || c.waId}. El bot queda en pausa en ese chat; usá devolver_al_bot cuando quieras que vuelva a atenderlo.`);
    } catch (e) { return error(e.message); }
  });

  s.registerTool('cambiar_estado_chat', {
    title: 'Devolver al bot o pausarlo en un chat',
    description: 'Cambia quién atiende un chat: "bot" (el bot vuelve a responder), "humano" (lo atiende Chinguer, el bot no responde) o "pausado" (el bot no responde nunca en ese chat, por ejemplo un proveedor o un conocido).',
    inputSchema: {chat: z.string().describe('Número o nombre'), estado: z.enum(['bot', 'humano', 'pausado'])},
    annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true}
  }, async ({chat, estado}) => {
    try { const c = await chatDe(chat); await cambiarEstadoChat(c.waId, estado, estado === 'bot' ? {noLeidos: 0} : {}); return texto(`${c.nombre || c.waId}: ${ESTADOS_CHAT[estado]}.`); }
    catch (e) { return error(e.message); }
  });

  s.registerTool('fechas_reservadas', {
    title: 'Fechas reservadas de la chacra',
    description: 'Lista las próximas fechas en que la chacra ya está reservada (las que se marcan en el panel).',
    inputSchema: {}, annotations: leer
  }, async () => {
    const f = await fechasReservadas();
    return texto(f.length ? f.map(x => '- ' + fechaLarga(x)).join('\n') : 'No hay fechas reservadas cargadas en el panel.');
  });

  s.registerTool('consultar_fecha', {
    title: 'Consultar una fecha',
    description: 'Dice si la chacra está libre en una fecha y, si está reservada, qué fechas cercanas están libres.',
    inputSchema: {fecha: z.string().describe('AAAA-MM-DD')}, annotations: leer
  }, async ({fecha}) => texto(JSON.stringify(await consultarFecha(fecha), null, 1)));

  s.registerTool('estado_del_bot', {
    title: 'Encender o apagar el bot',
    description: 'Sin parámetros dice si el bot está respondiendo. Con activo=true/false lo enciende o lo apaga para todos los chats.',
    inputSchema: {activo: z.boolean().optional()},
    annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true}
  }, async ({activo}) => {
    const c = typeof activo === 'boolean' ? await guardarConfig({activo}) : await leerConfig();
    return texto(c.activo !== false ? 'El bot está encendido y responde los chats nuevos.' : 'El bot está apagado: no responde a nadie.');
  });

  return s;
}

function claveValida(k){
  const real = val(MCP_KEY);
  if (!real || !k) return false;
  const a = Buffer.from(String(k)), b = Buffer.from(real);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function manejarMcp(req, res){
  // La llave va al final del link: /mcp/<MCP_KEY> (según la URL, la ruta puede llegar con o sin el nombre de la función)
  const partes = String(req.path || req.url || '').split('?')[0].split('/').filter(Boolean);
  if (!partes.some(claveValida) && !claveValida(req.query && req.query.key)) return res.status(401).json({error: 'No autorizado'});
  if (req.method !== 'POST') return res.status(405).set('Allow', 'POST').json({jsonrpc: '2.0', error: {code: -32000, message: 'Método no permitido'}, id: null});
  const servidor = crearServidor();
  const transporte = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
  res.on('close', () => { transporte.close(); servidor.close(); });
  try {
    await servidor.connect(transporte);
    await transporte.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('MCP', e);
    if (!res.headersSent) res.status(500).json({jsonrpc: '2.0', error: {code: -32603, message: 'Error interno'}, id: null});
  }
}
