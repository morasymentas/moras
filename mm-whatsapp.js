// Sección WhatsApp del panel: chats que atiende el bot, los que te deriva, y respuesta desde acá.
// Habla con la función panelWhatsapp (Cloud Functions). Si el bot todavía no está instalado, solo muestra un aviso.
import { app } from './mm-datos.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';

const llamar = httpsCallable(getFunctions(app, 'us-central1'), 'panelWhatsapp', {timeout: 40000});
const api = async (accion, extra = {}) => (await llamar({accion, ...extra})).data;
const $ = id => document.getElementById(id);
const avisar = (t, mal) => { if (typeof window.toast === 'function') window.toast(t, mal); };

function h(tag, attrs, ...kids){
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})){
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()){ if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(c)); }
  return e;
}

const ESTADO = {
  derivado: {n: 'Para atender', k: 'derivado'},
  humano: {n: 'Lo atendés vos', k: 'humano'},
  bot: {n: 'Bot', k: 'bot'},
  pausado: {n: 'Bot pausado', k: 'pausado'}
};
const QUIEN = {bot: 'Bot', humano: 'Vos', app: 'Vos (app)'};
const TICKS = {enviado: '✓', sent: '✓', delivered: '✓✓', read: '✓✓ leído', failed: 'No se entregó'};

let datos = null, filtro = 'atender', abierto = null, chatAbierto = null, iniciado = false, timerLista = null, timerChat = null, infoCargada = false;

function cuando(iso){
  if (!iso) return '';
  const d = new Date(iso), seg = (Date.now() - d) / 1000;
  if (seg < 60) return 'recién';
  if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`;
  const hh = d.toLocaleTimeString('es-UY', {hour: '2-digit', minute: '2-digit', hour12: false});
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  if (d >= hoy) return hh;
  if (d >= new Date(hoy - 864e5)) return 'ayer ' + hh;
  return d.toLocaleDateString('es-UY', {day: '2-digit', month: '2-digit'}) + ' ' + hh;
}
const diaDe = iso => new Date(iso).toLocaleDateString('es-UY', {weekday: 'long', day: 'numeric', month: 'long'});

function nota(texto, mal){ return h('div', {class: 'wa-note' + (mal ? ' bad' : ''), text: texto}); }

function sinConexion(e){
  const code = String((e && e.code) || '').replace('functions/', '');
  if (code === 'permission-denied' || code === 'unauthenticated') return 'Tu usuario no tiene acceso a los chats de WhatsApp.';
  if (code === 'not-found' || code === 'internal' || code === 'unavailable' || code === 'deadline-exceeded') return 'El bot de WhatsApp todavía no está conectado. Cuando termines la puesta en marcha, acá vas a ver los chats que atiende el bot y los que te deja para atender vos.';
  return 'No se pudieron cargar los chats de WhatsApp. Probá recargar la página.';
}

/* ---------- lista ---------- */
const paraAtender = c => c.estado === 'derivado' || (c.estado === 'humano' && c.noLeidos > 0);

function pintarLista(){
  const body = $('wa-main'); if (!body || abierto) return;
  const chats = datos.chats || [];
  const pend = chats.filter(paraAtender);
  $('wa-cuenta').textContent = pend.length ? String(pend.length) : '';
  $('wa-cuenta').hidden = !pend.length;
  const tabs = h('div', {class: 'tabs', role: 'tablist'},
    [['atender', `Para atender`, pend.length], ['todos', 'Todos los chats', chats.length]].map(([id, n, k]) =>
      h('button', {type: 'button', class: 'tab' + (filtro === id ? ' on' : ''), role: 'tab', 'aria-selected': String(filtro === id), onclick: () => { filtro = id; pintarLista(); }}, n, h('em', {text: String(k)}))));
  const vis = filtro === 'atender' ? pend : chats;
  const lista = h('div', {class: 'wa-list'});
  if (!vis.length) lista.append(nota(filtro === 'atender' ? 'No hay chats para atender. El bot está al día.' : 'Todavía no hay chats. Cuando un cliente le escriba al número del bot, aparece acá.'));
  vis.forEach(c => {
    const e = ESTADO[c.estado] || ESTADO.bot;
    lista.append(h('button', {type: 'button', class: 'wa-row k-' + e.k, onclick: () => abrir(c.waId)},
      h('div', {class: 't'},
        h('div', {class: 'n'}, c.nombre || 'Sin nombre', h('small', {text: c.telefono})),
        c.estado === 'derivado' && (c.motivo || c.resumen) ? h('div', {class: 'm', text: [c.motivo, c.resumen].filter(Boolean).join(' · ')}) : null,
        h('div', {class: 'u', text: (c.ultimoDe === 'cliente' ? '' : (QUIEN[c.ultimoDe] || 'Bot') + ': ') + (c.ultimoTexto || '')})),
      h('div', {class: 's'},
        h('span', {class: 'wa-badge', text: e.n}),
        h('span', {class: 'h', text: cuando(c.actualizado)}),
        c.noLeidos ? h('span', {class: 'wa-unread', text: String(c.noLeidos), 'aria-label': c.noLeidos + ' sin leer'}) : null)));
  });
  body.replaceChildren(tabs, lista);
}

/* ---------- información que usa el bot ---------- */
let infoEl = null;
function infoBot(){
  if (infoEl) return infoEl;
  const ta = h('textarea', {id: 'wa-info-txt', 'aria-label': 'Información que usa el bot', spellcheck: 'true'});
  const guardar = h('button', {type: 'button', class: 'btn', text: 'Guardar información'});
  const estado = h('span', {class: 'need', text: 'El bot responde solo con lo que figura acá. Precios, horarios, qué incluye: si cambia algo, editalo y guardá.'});
  guardar.addEventListener('click', async () => {
    guardar.disabled = true;
    try { const r = await api('config', {info: ta.value}); datos.config = r.config; ta.value = r.config.info; avisar('Información del bot guardada'); }
    catch (e) { avisar('No se pudo guardar: ' + (e.message || ''), true); }
    guardar.disabled = false;
  });
  const restaurar = h('button', {type: 'button', class: 'link muted', text: 'Volver al texto original'});
  restaurar.addEventListener('click', async () => {
    try { const r = await api('info_inicial'); ta.value = r.info; avisar('Texto original cargado. Tocá "Guardar información" para usarlo.'); } catch (e) { avisar('No se pudo cargar', true); }
  });
  infoEl = h('details', {class: 'wa-info'},
    h('summary', {text: 'Información que usa el bot'}),
    ta,
    h('div', {class: 'save-row'}, guardar, restaurar, estado));
  infoEl.addEventListener('toggle', () => { if (infoEl.open && !infoCargada){ ta.value = (datos.config && datos.config.info) || ''; infoCargada = true; } });
  return infoEl;
}

/* ---------- conexión con WhatsApp (diagnóstico) ---------- */
let conexEl = null;
function conexion(){
  if (conexEl) return conexEl;
  const out = h('div', {class: 'wa-list'});
  const revisar = h('button', {type: 'button', class: 'btn ghost', text: 'Revisar conexión'});
  const fila = (ok, texto, extra) => h('div', {class: 'wa-note' + (ok === false ? ' bad' : '')}, (ok === true ? '✓ ' : ok === false ? '✗ ' : '') + texto, extra || null);
  const correr = async () => {
    revisar.disabled = true; out.replaceChildren(nota('Revisando…'));
    try {
      const r = await api('diagnostico');
      const n = r.numero || {};
      const items = [];
      items.push(r.errorNumero ? fila(false, 'Meta no reconoce el número configurado: ' + r.errorNumero)
        : fila(true, `Número ${n.display_phone_number || r.numeroId} · ${n.verified_name || 'sin nombre'}${n.status ? ' · ' + n.status : ''}${n.platform_type ? ' · ' + n.platform_type : ''}${n.quality_rating ? ' · calidad ' + n.quality_rating : ''}`));
      if (r.errorSuscripcion) items.push(fila(false, 'No se pudo revisar la suscripción: ' + r.errorSuscripcion));
      else if (r.suscripta) items.push(fila(true, 'La app recibe los mensajes del número (suscripta a la cuenta de WhatsApp).'));
      else {
        const b = h('button', {type: 'button', class: 'btn', text: 'Suscribir ahora', style: 'margin-top:8px;display:block'});
        b.addEventListener('click', async () => { b.disabled = true; try { await api('suscribir'); avisar('Listo: la app quedó suscripta'); correr(); } catch (e) { avisar(e.message || 'No se pudo', true); b.disabled = false; } });
        items.push(fila(false, 'La app no está suscripta a la cuenta de WhatsApp: los mensajes de clientes no llegan al bot.', b));
      }
      items.push(fila(null, 'Avisos de chats para atender a: ' + ((r.avisosA || []).join(', ') || 'nadie (falta ADMIN_WA)')));
      const pin = h('input', {type: 'text', inputmode: 'numeric', maxlength: '6', placeholder: 'PIN de 6 números', 'aria-label': 'PIN', style: 'max-width:180px'});
      const act = h('button', {type: 'button', class: 'btn ghost', text: 'Activar número'});
      act.addEventListener('click', async () => { act.disabled = true; try { await api('registrar', {pin: pin.value.trim()}); avisar('Número activado en la API'); pin.value = ''; correr(); } catch (e) { avisar(e.message || 'No se pudo', true); } act.disabled = false; });
      items.push(h('div', {class: 'wa-note'}, 'Solo si Meta dice que el número no está registrado (error 133010): elegí un PIN de 6 números, anotalo y activá. Queda como verificación en dos pasos del número.',
        h('div', {class: 'wa-send', style: 'margin-top:8px'}, pin, act)));
      out.replaceChildren(...items);
    } catch (e) { out.replaceChildren(fila(false, e.message || 'No se pudo revisar')); }
    revisar.disabled = false;
  };
  revisar.addEventListener('click', correr);
  conexEl = h('details', {class: 'wa-info'}, h('summary', {text: 'Conexión con WhatsApp'}), h('div', {style: 'display:flex;flex-direction:column;gap:10px;margin-top:10px'}, h('div', {}, revisar), out));
  return conexEl;
}

/* ---------- un chat ---------- */
let chatEls = null;
function vistaChat(){
  const volver = h('button', {type: 'button', class: 'btn ghost', text: '← Todos los chats', onclick: cerrar});
  const cab = h('div', {class: 'wa-chat-h'});
  const res = h('div', {class: 'wa-res', hidden: true});
  const acts = h('div', {class: 'wa-acts'});
  const msgs = h('div', {class: 'wa-msgs', 'aria-live': 'polite'});
  const ta = h('textarea', {placeholder: 'Escribí tu respuesta…', 'aria-label': 'Respuesta'});
  const enviar = h('button', {type: 'button', class: 'btn', text: 'Enviar'});
  const aviso = h('div', {class: 'need'});
  const mandar = async () => {
    const t = ta.value.trim(); if (!t || !abierto) return;
    enviar.disabled = true;
    try { await api('responder', {waId: abierto, texto: t}); ta.value = ''; avisar('Enviado. El bot queda en pausa en este chat.'); await cargarChat(true); }
    catch (e) { avisar(e.message || 'No se pudo enviar', true); }
    enviar.disabled = false;
  };
  enviar.addEventListener('click', mandar);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); mandar(); } });
  chatEls = {cab, res, acts, msgs, ta, enviar, aviso};
  return h('div', {class: 'wa-chat'}, h('div', {}, volver), cab, res, acts, msgs, h('div', {class: 'wa-send'}, ta, enviar), aviso);
}

function pintarChat(){
  if (!chatEls || !chatAbierto) return;
  const {chat, mensajes} = chatAbierto;
  const e = ESTADO[chat.estado] || ESTADO.bot;
  chatEls.cab.replaceChildren(
    h('div', {class: 't'}, h('div', {class: 'n', text: chat.nombre || 'Sin nombre'}), h('div', {class: 'sub', text: chat.telefono})),
    h('span', {class: 'wa-badge k-' + e.k, text: e.n}));
  chatEls.res.hidden = !(chat.motivo || chat.resumen);
  chatEls.res.textContent = [chat.motivo, chat.resumen].filter(Boolean).join(' · ');
  const btn = (estado, texto, ayuda) => h('button', {type: 'button', class: 'btn ghost' + (chat.estado === estado ? ' on' : ''), title: ayuda, disabled: chat.estado === estado,
    onclick: async () => { try { await api('estado', {waId: chat.waId, estado}); avisar(ayuda); await cargarChat(true); refrescarLista(); } catch (err) { avisar('No se pudo cambiar', true); } }}, texto);
  chatEls.acts.replaceChildren(
    btn('bot', 'Devolver al bot', 'El bot vuelve a responder en este chat'),
    btn('humano', 'Lo atiendo yo', 'El bot no responde en este chat'),
    btn('pausado', 'Pausar el bot siempre', 'El bot no responde nunca en este chat (proveedores, conocidos)'),
    chat.consultaId ? h('button', {type: 'button', class: 'link', text: 'Ver su consulta', onclick: () => { const c = document.getElementById('c-' + chat.consultaId); if (c) c.scrollIntoView({behavior: 'smooth', block: 'start'}); else avisar('La consulta no está en la lista con el filtro actual'); }}) : null);
  const abajo = chatEls.msgs.scrollHeight - chatEls.msgs.scrollTop - chatEls.msgs.clientHeight < 60;
  const items = []; let dia = '';
  mensajes.forEach(m => {
    const d = diaDe(m.ts); if (d !== dia){ dia = d; items.push(h('div', {class: 'wa-day', text: d})); }
    const out = m.dir === 'out';
    const err = m.estado === 'failed';
    const errTxt = err ? (m.error && m.error.code === 131047 ? 'No se entregó: pasaron más de 24 h desde su último mensaje' : 'No se entregó' + (m.error && m.error.title ? ': ' + m.error.title : '')) : '';
    items.push(h('div', {class: 'wa-b' + (out ? ' out' : '') + (out && m.autor === 'bot' ? ' bot' : '')},
      m.texto || `[${({image: 'Foto', audio: 'Audio', video: 'Video', document: 'Documento', sticker: 'Sticker', location: 'Ubicación'})[m.tipo] || m.tipo}]`,
      h('span', {class: 'meta' + (err ? ' err' : ''), text: [out ? (QUIEN[m.autor] || 'Bot') : '', new Date(m.ts).toLocaleTimeString('es-UY', {hour: '2-digit', minute: '2-digit', hour12: false}), out ? (err ? errTxt : TICKS[m.estado] || '') : ''].filter(Boolean).join(' · ')})));
  });
  chatEls.msgs.replaceChildren(...items);
  if (abajo || !chatEls.msgs.dataset.listo){ chatEls.msgs.scrollTop = chatEls.msgs.scrollHeight; chatEls.msgs.dataset.listo = '1'; }
  const ok = chat.ventana;
  chatEls.ta.disabled = !ok; chatEls.enviar.disabled = !ok;
  chatEls.aviso.textContent = ok
    ? [({bot: 'Si respondés vos, el bot se corre de este chat hasta que lo devuelvas.', derivado: 'El bot no le escribió nada: el cliente espera tu respuesta.'})[chat.estado] || '', matchMedia('(pointer: fine)').matches ? 'Ctrl + Enter también envía.' : ''].filter(Boolean).join(' ')
    : 'Pasaron más de 24 horas desde el último mensaje del cliente: WhatsApp no deja escribirle hasta que vuelva a escribir. Podés llamarlo al ' + chat.telefono + '.';
}

async function cargarChat(silencioso){
  if (!abierto) return;
  const pedido = abierto;
  try { const r = await api('chat', {waId: pedido}); if (abierto === pedido){ chatAbierto = r; pintarChat(); } }
  catch (e) { if (!silencioso) avisar('No se pudo abrir el chat', true); }
}
async function abrir(waId){
  abierto = waId; chatAbierto = null;
  $('wa-main').replaceChildren(vistaChat());
  chatEls.msgs.replaceChildren(nota('Cargando la conversación…'));
  await cargarChat();
  clearInterval(timerChat); timerChat = setInterval(() => { if (document.visibilityState === 'visible') cargarChat(true); }, 8000);
  $('whatsapp').scrollIntoView({behavior: 'smooth', block: 'start'});
}
function cerrar(){ abierto = null; chatAbierto = null; chatEls = null; clearInterval(timerChat); refrescarLista(); pintarLista(); }

/* ---------- arranque ---------- */
async function refrescarLista(){
  try {
    datos = await api('resumen');
    const sw = $('wa-activo'); sw.checked = !!datos.config.activo; $('wa-sw').hidden = false;
    if (!infoEl) $('wa-body').append(infoBot(), conexion());
    pintarLista();
  } catch (e) {
    if (!datos){ $('wa-main').replaceChildren(nota(sinConexion(e))); clearInterval(timerLista); timerLista = null; }
  }
}

async function iniciar(){
  if (iniciado || !$('whatsapp')) return; iniciado = true;
  $('wa-body').replaceChildren(h('div', {id: 'wa-main', class: 'wa-list'}, nota('Cargando los chats…')));
  $('wa-activo').addEventListener('change', async e => {
    const activo = e.target.checked; e.target.disabled = true;
    try { await api('config', {activo}); avisar(activo ? 'Bot encendido: responde los chats nuevos' : 'Bot apagado: no responde a nadie'); }
    catch (err) { e.target.checked = !activo; avisar('No se pudo cambiar', true); }
    e.target.disabled = false;
  });
  await refrescarLista();
  if (datos) timerLista = setInterval(() => { if (document.visibilityState === 'visible' && !abierto) refrescarLista(); }, 15000);
  if (location.hash === '#whatsapp') $('whatsapp').scrollIntoView({block: 'start'});
}

if (window.mmAdmin) iniciar(); else window.addEventListener('mm-admin', iniciar, {once: true});
