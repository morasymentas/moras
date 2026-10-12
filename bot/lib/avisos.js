// Aviso a Chinguer cuando un chat le queda para atender. El cliente no recibe nada.
// Si Chinguer le escribió al número del bot en las últimas 24 h, el aviso va como texto (gratis);
// si no, va con la plantilla aprobada. Además el chat queda marcado en el panel.
import { enviarTexto, enviarPlantilla } from './wa.js';
import { leerChat, registrarSaliente, listarChats } from './datos.js';
import { admins, AVISO_PLANTILLA, val, VENTANA_MS, PANEL } from './config.js';
import { telLocal } from './db.js';

export const MOTIVOS = {
  visita: 'Quiere coordinar una visita',
  reserva: 'Quiere reservar o señar',
  descuento: 'Pide descuento o negocia el precio',
  persona: 'Pide hablar con una persona',
  lluvia: 'Pregunta por lluvia o el clima',
  evento_programado: 'Tiene un evento programado',
  consulta_web: 'Mandó la consulta del Servicio Premium desde el sitio',
  no_sabe: 'El bot no sabe la respuesta',
  queja: 'Queja o tema delicado',
  audio: 'Mandó un audio, video o archivo',
  sigue_escribiendo: 'Volvió a escribir',
  otro: 'Otro motivo'
};

export async function avisarAdmin({waId, nombre, motivo, resumen}){
  const quien = `${nombre || 'Cliente'} (${telLocal(waId)})`;
  const porQue = MOTIVOS[motivo] || motivo || 'Para atender';
  const texto = `Chat para atender: ${quien}\n${porQue}${resumen ? '. ' + resumen : ''}\n\nRespondé desde la app o desde el panel: ${PANEL}`;
  const resultado = [];
  for (const adm of admins()){
    try {
      const chat = await leerChat(adm);
      const ventanaAbierta = chat && chat.ultimaEntrada && (Date.now() - Date.parse(chat.ultimaEntrada)) < VENTANA_MS - 60000;
      let id;
      if (ventanaAbierta) id = await enviarTexto(adm, texto);
      else id = await enviarPlantilla(adm, val(AVISO_PLANTILLA, 'aviso_derivacion'), [quien, `${porQue}${resumen ? '. ' + resumen : ''}`]);
      await registrarSaliente({waId: adm, id, texto, autor: 'bot', extra: {aviso: true}});
      resultado.push({adm, ok: true, via: ventanaAbierta ? 'texto' : 'plantilla'});
    } catch (e) {
      console.error('No se pudo avisar a', adm, e.message, e.detalle || '');
      resultado.push({adm, ok: false, error: e.message});
    }
  }
  return resultado;
}

// Respuesta cuando Chinguer le escribe al número del bot: la lista de chats para atender
export async function respuestaAdmin(){
  const chats = (await listarChats(200)).filter(c => !admins().includes(c.waId) && (c.estado === 'derivado' || (c.estado === 'humano' && c.noLeidos > 0)));
  if (!chats.length) return `No hay chats para atender. El bot está al día.\n\nPanel: ${PANEL}`;
  const lineas = chats.slice(0, 15).map(c => `- ${c.nombre || 'Sin nombre'} (${c.telefono || c.waId}): ${MOTIVOS[c.motivo] || (c.estado === 'humano' ? 'Te escribió' : 'Para atender')}${c.resumen ? '. ' + c.resumen : ''}`);
  return `Chats para atender (${chats.length}):\n${lineas.join('\n')}\n\nPanel: ${PANEL}`;
}
