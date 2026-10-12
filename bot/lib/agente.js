// El agente: arma la conversación, le pregunta a Claude y ejecuta sus herramientas.
// Devuelve {accion: 'responder', texto} o {accion: 'derivar', motivo, resumen}.
import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_API_KEY, MODELO_POR_DEFECTO, val } from './config.js';
import { REGLAS } from './conocimiento.js';
import { consultarFecha, registrarDatos } from './datos.js';
import { hoyUY, horaUY, fechaLarga, telLocal } from './db.js';
import { MOTIVOS } from './avisos.js';

let _claude = null;
export function setClaude(c){ _claude = c; }   // las pruebas usan un Claude falso
const claude = () => _claude || (_claude = new Anthropic({apiKey: val(ANTHROPIC_API_KEY), timeout: 45000, maxRetries: 1}));

const MOTIVOS_AGENTE = ['visita', 'reserva', 'descuento', 'persona', 'lluvia', 'evento_programado', 'queja', 'no_sabe', 'otro'];

export const HERRAMIENTAS = [
  {
    name: 'consultar_fecha',
    description: 'Dice si la chacra está libre o reservada en una fecha. Si está reservada, devuelve alternativas libres (mismo día, una o dos semanas antes o después). Usala siempre antes de hablar de disponibilidad.',
    input_schema: {type: 'object', properties: {fecha: {type: 'string', description: 'Fecha del evento en formato AAAA-MM-DD'}}, required: ['fecha']}
  },
  {
    name: 'registrar_datos',
    description: 'Guarda en la ficha del cliente los datos del evento que fue contando. Llamala cada vez que el cliente dé un dato nuevo. No le digas al cliente que guardaste nada.',
    input_schema: {type: 'object', properties: {
      nombre: {type: 'string', description: 'Nombre del cliente'},
      tipo_evento: {type: 'string', description: 'Ej: 15 años, boda, cumpleaños, empresarial'},
      fecha: {type: 'string', description: 'Fecha del evento AAAA-MM-DD'},
      invitados: {type: 'integer', description: 'Cantidad de invitados'},
      espacio: {type: 'string', description: 'Casa, salón o ambos, si lo sabe'},
      notas: {type: 'string', description: 'Otro dato útil, en pocas palabras'}
    }}
  },
  {
    name: 'derivar_a_chinguer',
    description: 'Pasa el chat a Chinguer para que responda él. Al usarla NO se le manda nada al cliente. Usala en los casos de la sección CUÁNDO DERIVAR.',
    input_schema: {type: 'object', properties: {
      motivo: {type: 'string', enum: MOTIVOS_AGENTE, description: 'Por qué se deriva'},
      resumen: {type: 'string', description: 'Una o dos frases para Chinguer: qué quiere el cliente y los datos que ya dio (evento, fecha, invitados). Sin saludos.'}
    }, required: ['motivo', 'resumen']}
  }
];

// Convierte el historial guardado en mensajes para Claude
export function armarMensajes(historial, imagenes = {}){
  const msgs = [];
  const push = (role, bloques) => {
    if (!bloques.length) return;
    const ult = msgs[msgs.length - 1];
    if (ult && ult.role === role) ult.content.push(...bloques);
    else msgs.push({role, content: [...bloques]});
  };
  for (const m of historial){
    if (m.aviso) continue;
    if (m.dir === 'in'){
      const b = [];
      if (m.tipo === 'image' && imagenes[m.id]){
        b.push({type: 'image', source: {type: 'base64', media_type: imagenes[m.id].mime, data: imagenes[m.id].base64}});
        b.push({type: 'text', text: m.texto ? m.texto : '(El cliente mandó esta foto.)'});
      } else if (m.tipo === 'image') b.push({type: 'text', text: m.texto ? `[Foto] ${m.texto}` : '[El cliente mandó una foto]'});
      else if (m.tipo === 'text' || m.texto) b.push({type: 'text', text: m.texto || '(mensaje vacío)'});
      else b.push({type: 'text', text: `[El cliente mandó: ${m.tipo}]`});
      push('user', b);
    } else {
      if (m.texto) push('assistant', [{type: 'text', text: m.texto}]);
    }
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

// WhatsApp no muestra markdown: lo pasamos a su formato
export function limpiarTexto(t){
  return String(t || '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '_$1_')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1: $2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function crear(params, modelos){
  let ultimoError;
  for (const model of modelos){
    try { return await claude().messages.create({...params, model}); }
    catch (e) {
      ultimoError = e;
      if (e && (e.status === 404 || /not_found|model/i.test(String(e.message)))) continue;   // modelo mal escrito o retirado: probamos el siguiente
      throw e;
    }
  }
  throw ultimoError;
}

export async function responder({waId, nombre, historial, imagenes, config}){
  const sistema = [
    {type: 'text', text: `${REGLAS}\n\nINFORMACIÓN DE MORAS & MENTAS\n${config.info}`, cache_control: {type: 'ephemeral'}},
    {type: 'text', text: `Hoy es ${fechaLarga(hoyUY())} (${hoyUY()}), son las ${horaUY()} en Uruguay. Cliente: ${nombre || 'sin nombre en el perfil'} (${telLocal(waId)}). Los mensajes del asistente en el historial pueden haberlos escrito Chinguer o el equipo; seguí la conversación con coherencia.`}
  ];
  const mensajes = armarMensajes(historial, imagenes);
  if (!mensajes.length) return {accion: 'nada'};
  const modelos = [...new Set([config.modelo || MODELO_POR_DEFECTO, MODELO_POR_DEFECTO, 'claude-sonnet-5-5'])];
  const usadas = [];

  for (let vuelta = 0; vuelta < 6; vuelta++){
    const r = await crear({max_tokens: 900, system: sistema, tools: HERRAMIENTAS, messages: mensajes}, modelos);
    const usos = r.content.filter(b => b.type === 'tool_use');
    if (!usos.length){
      const texto = limpiarTexto(r.content.filter(b => b.type === 'text').map(b => b.text).join('\n'));
      if (!texto) return {accion: 'derivar', motivo: 'no_sabe', resumen: 'El bot no encontró qué responder.', herramientas: usadas};
      return {accion: 'responder', texto, herramientas: usadas};
    }
    mensajes.push({role: 'assistant', content: r.content});
    const resultados = [];
    for (const u of usos){
      usadas.push(u.name);
      if (u.name === 'derivar_a_chinguer'){
        const motivo = MOTIVOS_AGENTE.includes(u.input.motivo) ? u.input.motivo : 'otro';
        return {accion: 'derivar', motivo, resumen: String(u.input.resumen || MOTIVOS[motivo] || '').slice(0, 400), herramientas: usadas};
      }
      let out;
      try {
        if (u.name === 'consultar_fecha') out = await consultarFecha(String(u.input.fecha || ''));
        else if (u.name === 'registrar_datos') out = await registrarDatos(waId, u.input || {});
        else out = {error: 'Herramienta desconocida'};
      } catch (e) { out = {error: 'No se pudo consultar: ' + e.message}; }
      resultados.push({type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out)});
    }
    mensajes.push({role: 'user', content: resultados});
  }
  return {accion: 'derivar', motivo: 'no_sabe', resumen: 'El bot no llegó a una respuesta.', herramientas: usadas};
}
