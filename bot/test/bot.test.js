// Pruebas del bot con WhatsApp, Claude y la base simulados.  Correr: cd bot && npm test
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import http from 'node:http';

process.env.WA_TOKEN = 'token-prueba';
process.env.WA_APP_SECRET = 'secreto-app';
process.env.WA_VERIFY_TOKEN = 'verificar-123';
process.env.MCP_KEY = 'clave-mcp-123';
process.env.WA_PHONE_NUMBER_ID = '111222333';
process.env.ADMIN_WA = '59899000000';

const { FakeFirestore } = await import('./fake-firestore.js');
const { setDb, hoyUY, sumarDias } = await import('../lib/db.js');
const { setFetch } = await import('../lib/wa.js');
const { setClaude } = await import('../lib/agente.js');
const { setEspera } = await import('../lib/procesar.js');
const { manejarWebhook } = await import('../lib/webhook.js');
const { accionPanel } = await import('../lib/panel.js');
const { manejarMcp } = await import('../lib/mcp.js');

const CLIENTE = '59891234567', ADMIN = '59899000000';
let db, enviados, llamadasClaude, guionClaude, nMsg = 0;
const RESERVADA = sumarDias(hoyUY(), 30);

/* ---------- WhatsApp falso ---------- */
function fakeFetch(url, opts = {}){
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (url.includes('/messages')){
    enviados.push(body);
    if (body.status === 'read') return resp({success: true});
    return resp({messages: [{id: 'wamid.OUT' + (++nMsg)}]});
  }
  if (url.includes('/media-1')) return resp({url: 'https://lookaside.fbsbx.com/foto', mime_type: 'image/jpeg'});
  if (url.includes('lookaside')) return Promise.resolve(new Response(Buffer.from('fotofalsa'), {status: 200, headers: {'content-type': 'image/jpeg'}}));
  return resp({error: {message: 'ruta desconocida ' + url}}, 400);
}
const resp = (j, status = 200) => Promise.resolve(new Response(JSON.stringify(j), {status}));
const alCliente = (to = CLIENTE) => enviados.filter(e => e.to === to && e.type);

/* ---------- Claude falso: decide según el último texto del cliente ---------- */
function fakeClaude(){
  return {messages: {create: async params => {
    llamadasClaude.push(params);
    if (guionClaude) return guionClaude(params);
    const ult = params.messages[params.messages.length - 1];
    const bloques = Array.isArray(ult.content) ? ult.content : [{type: 'text', text: ult.content}];
    const res = bloques.find(b => b.type === 'tool_result');
    if (res){
      const r = JSON.parse(res.content);
      if (r.estado === 'reservada') return txt(`Esa fecha ya está reservada. Tengo libre el ${r.alternativas_libres[0].dia}, ¿te sirve?`);
      if (r.estado === 'libre') return txt(`¡Buenísimo! El ${r.dia} está libre.`);
      return txt('Listo.');
    }
    const t = bloques.filter(b => b.type === 'text').map(b => b.text).join(' ').toLowerCase();
    if (t.includes('visita')) return uso('derivar_a_chinguer', {motivo: 'visita', resumen: 'Quiere visitar el jueves. 15 años, 120 invitados.'});
    const f = t.match(/\d{4}-\d{2}-\d{2}/);
    if (f) return uso('consultar_fecha', {fecha: f[0]});
    if (t.includes('me llamo')) return uso('registrar_datos', {nombre: 'Lucía', tipo_evento: '15 años', invitados: 120});
    return txt('¡Hola! Gracias por escribir a **Moras & Mentas**. ¿Qué evento estás organizando?');
  }}};
}
const txt = t => ({stop_reason: 'end_turn', content: [{type: 'text', text: t}]});
const uso = (name, input) => ({stop_reason: 'tool_use', content: [{type: 'tool_use', id: 'tu' + Math.random(), name, input}]});

/* ---------- avisos de Meta firmados ---------- */
function req(payload, {firma = true, method = 'POST', query} = {}){
  const raw = Buffer.from(JSON.stringify(payload || {}));
  const sig = 'sha256=' + createHmac('sha256', 'secreto-app').update(raw).digest('hex');
  const headers = firma ? {'x-hub-signature-256': sig} : {};
  return {method, query: query || {}, body: payload, rawBody: raw, headers, get: h => headers[h.toLowerCase()]};
}
function res(){
  const r = {code: null, out: null, headersSent: false, status(c){ this.code = c; return this; }, send(x){ this.out = x; this.headersSent = true; return this; }, json(x){ this.out = x; this.headersSent = true; return this; }, set(){ return this; }, on(){}};
  return r;
}
let nIn = 0;
function msgTexto(texto, de = CLIENTE, id){
  return {object: 'whatsapp_business_account', entry: [{id: 'waba', changes: [{field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: {phone_number_id: '111222333'},
    contacts: [{wa_id: de, profile: {name: 'Lucía Pérez'}}],
    messages: [{from: de, id: id || ('wamid.IN' + (++nIn)), timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: {body: texto}}]
  }}]}]};
}
function msgTipo(tipo, extra, de = CLIENTE){
  return {object: 'whatsapp_business_account', entry: [{changes: [{field: 'messages', value: {contacts: [{wa_id: de, profile: {name: 'Lucía Pérez'}}],
    messages: [{from: de, id: 'wamid.IN' + (++nIn), timestamp: '1700000000', type: tipo, [tipo]: extra}]}}]}]};
}
async function enviar(payload){ const r = res(); const out = await manejarWebhook(req(payload), r); return {r, out}; }
const chat = async (w = CLIENTE) => (await db.collection('whatsapp').doc(w).get()).data();

before(() => { setFetch(fakeFetch); setClaude(fakeClaude()); setEspera(ms => new Promise(r => setTimeout(r, Math.min(ms, 40)))); });
beforeEach(async () => {
  db = new FakeFirestore(); setDb(db);
  enviados = []; llamadasClaude = []; guionClaude = null;
  await db.collection('usuarios').doc('uid-admin').set({rol: 'admin', email: 'a@a.com'});
  await db.collection('usuarios').doc('uid-prov').set({rol: 'proveedor'});
  await db.collection('disponibilidad').doc('chacra').set({ocupadoAdmin: [RESERVADA, sumarDias(RESERVADA, 7)]});
});

/* ---------- pruebas ---------- */
test('verificación del webhook: acepta el token correcto y rechaza otro', async () => {
  let r = res(); await manejarWebhook(req(null, {method: 'GET', query: {'hub.mode': 'subscribe', 'hub.verify_token': 'verificar-123', 'hub.challenge': '42'}}), r);
  assert.equal(r.code, 200); assert.equal(r.out, '42');
  r = res(); await manejarWebhook(req(null, {method: 'GET', query: {'hub.mode': 'subscribe', 'hub.verify_token': 'otro', 'hub.challenge': '42'}}), r);
  assert.equal(r.code, 403);
});

test('descarta avisos sin la firma de Meta', async () => {
  const r = res(); await manejarWebhook(req(msgTexto('hola'), {firma: false}), r);
  assert.equal(r.code, 401);
  assert.equal(db.dump('whatsapp').length, 0);
});

test('responde un saludo, marca leído y guarda la conversación', async () => {
  const {r, out} = await enviar(msgTexto('Hola, quería info'));
  assert.equal(r.code, 200);
  assert.equal(out[0].resultado, 'respondido');
  assert.ok(enviados.some(e => e.status === 'read' && e.typing_indicator), 'manda tildes azules + escribiendo');
  const a = alCliente(); assert.equal(a.length, 1);
  assert.match(a[0].text.body, /\*Moras & Mentas\*/, 'convierte **negrita** al formato de WhatsApp');
  const c = await chat(); assert.equal(c.estado, 'bot'); assert.equal(c.nombre, 'Lucía Pérez'); assert.equal(c.telefono, '091 234 567');
  assert.equal(db.dump('whatsapp/' + CLIENTE + '/mensajes').length, 2);
  const p = llamadasClaude[0];
  assert.match(p.system[0].text, /CUÁNDO DERIVAR/); assert.match(p.system[0].text, /Ruta 3 km 82.500/);
  assert.ok(p.system[0].cache_control, 'reglas e información con caché de prompt');
  assert.match(p.system[1].text, /Lucía Pérez/);
});

test('no responde dos veces si Meta repite el mismo aviso', async () => {
  await enviar(msgTexto('hola', CLIENTE, 'wamid.REPETIDO'));
  const {out} = await enviar(msgTexto('hola', CLIENTE, 'wamid.REPETIDO'));
  assert.equal(out[0].resultado, 'duplicado');
  assert.equal(alCliente().length, 1);
});

test('fecha reservada: lo dice y ofrece una semana antes o después', async () => {
  const {out} = await enviar(msgTexto(`¿Tienen libre el ${RESERVADA}?`));
  assert.equal(out[0].resultado, 'respondido');
  assert.deepEqual(out[0].herramientas, ['consultar_fecha']);
  assert.match(alCliente()[0].text.body, /reservada/);
  assert.match(alCliente()[0].text.body, new RegExp(String(+sumarDias(RESERVADA, -7).slice(8))));
});

test('fecha libre', async () => {
  const libre = sumarDias(RESERVADA, 1);
  await enviar(msgTexto(`¿y el ${libre}?`));
  assert.match(alCliente()[0].text.body, /está libre/);
});

test('pide visita: deriva sin escribirle al cliente y avisa a Chinguer con la plantilla', async () => {
  const {out} = await enviar(msgTexto('Quiero ir a hacer una visita el jueves'));
  assert.equal(out[0].resultado, 'derivado');
  assert.equal(alCliente().length, 0, 'el cliente no recibe nada');
  const aviso = enviados.find(e => e.to === ADMIN);
  assert.equal(aviso.type, 'template'); assert.equal(aviso.template.name, 'aviso_derivacion');
  assert.match(aviso.template.components[0].parameters[0].text, /Lucía Pérez \(091 234 567\)/);
  const c = await chat(); assert.equal(c.estado, 'derivado'); assert.equal(c.motivo, 'visita');

  // el cliente sigue escribiendo: el bot no responde y no repite el aviso enseguida
  enviados = [];
  const s = await enviar(msgTexto('¿Me confirmás?'));
  assert.equal(s.out[0].resultado, 'lo_atiende_chinguer');
  assert.equal(enviados.length, 0);
});

test('cuando Chinguer le escribe al bot recibe la lista, y los avisos siguientes van como texto', async () => {
  await enviar(msgTexto('Quiero coordinar una visita'));
  enviados = [];
  const {out} = await enviar(msgTexto('pendientes', ADMIN));
  assert.equal(out[0].resultado, 'admin');
  assert.match(enviados.find(e => e.to === ADMIN && e.type === 'text').text.body, /Chats para atender \(1\)/);
  enviados = [];
  await enviar(msgTexto('Hola, ¿hacen visitas el viernes?', '59892222222'));
  const aviso = enviados.find(e => e.to === ADMIN);
  assert.equal(aviso.type, 'text', 'con la ventana abierta el aviso es texto (gratis)');
  assert.match(aviso.text.body, /Quiere coordinar una visita/);
});

test('cliente con evento señado: va directo a Chinguer sin pasar por la IA', async () => {
  await db.collection('consultas').doc('c1').set({nombre: 'Familia Gómez', telefono: '091 234 567', estado: 'senada', fecha: sumarDias(hoyUY(), 40), tipo: '15 años'});
  const {out} = await enviar(msgTexto('Hola, ¿a qué hora podemos ir a armar?'));
  assert.equal(out[0].motivo, 'evento_programado');
  assert.equal(llamadasClaude.length, 0); assert.equal(alCliente().length, 0);
});

test('audio: lo deriva (el bot no escucha audios)', async () => {
  const {out} = await enviar(msgTipo('audio', {id: 'media-audio', mime_type: 'audio/ogg'}));
  assert.equal(out[0].motivo, 'audio'); assert.equal(alCliente().length, 0);
});

test('foto: el bot la ve', async () => {
  await enviar(msgTipo('image', {id: 'media-1', mime_type: 'image/jpeg', caption: 'así quiero la deco'}));
  const img = llamadasClaude[0].messages[0].content.find(b => b.type === 'image');
  assert.ok(img); assert.equal(Buffer.from(img.source.data, 'base64').toString(), 'fotofalsa');
});

test('varios mensajes seguidos: una sola respuesta que tiene en cuenta todos', async () => {
  const [a, b] = await Promise.all([enviar(msgTexto('Hola')), (async () => { await new Promise(r => setTimeout(r, 5)); return enviar(msgTexto('somos 120 personas')); })()]);
  const resultados = [a.out[0].resultado, b.out[0].resultado].sort();
  assert.deepEqual(resultados, ['agrupado', 'respondido']);
  assert.equal(alCliente().length, 1);
  const textos = llamadasClaude[0].messages[0].content.map(b => b.text).join(' | ');
  assert.match(textos, /Hola/); assert.match(textos, /120 personas/);
});

test('registrar_datos crea la consulta en el panel con origen WhatsApp', async () => {
  await enviar(msgTexto('Me llamo Lucía, es para mis 15'));
  const cs = db.dump('consultas/');
  assert.equal(cs.length, 1);
  assert.equal(cs[0].origen, 'whatsapp'); assert.equal(cs[0].nombre, 'Lucía'); assert.equal(cs[0].invitados, 120); assert.equal(cs[0].estado, 'nueva');
  assert.equal((await chat()).consultaId, cs[0].path.split('/')[1]);
});

test('la consulta del sitio (Servicio Premium) va directo a Chinguer', async () => {
  const {out} = await enviar(msgTexto('*CONSULTA SERVICIO PREMIUM*\nNombre: Ana\nFecha: 14/11/2026\nTipo de evento: Boda\nInvitados: 150'));
  assert.equal(out[0].motivo, 'consulta_web');
  assert.match((await chat()).resumen, /Boda, 14\/11\/2026, 150 invitados/);
});

test('si la IA falla, el chat se deriva en vez de quedar sin respuesta', async () => {
  guionClaude = () => { const e = new Error('overloaded'); e.status = 529; throw e; };
  const {out} = await enviar(msgTexto('hola'));
  assert.equal(out[0].resultado, 'derivado'); assert.equal(out[0].motivo, 'no_sabe');
  assert.equal(alCliente().length, 0);
});

test('si el modelo configurado no existe, usa el de respaldo', async () => {
  await db.collection('config').doc('bot').set({activo: true, modelo: 'claude-que-no-existe', info: 'x'.repeat(60)});
  guionClaude = p => { if (p.model === 'claude-que-no-existe'){ const e = new Error('model: not_found'); e.status = 404; throw e; } return txt('Hola desde ' + p.model); };
  await enviar(msgTexto('hola'));
  assert.match(alCliente()[0].text.body, /claude-haiku-5-5/);
});

test('bot apagado: no responde', async () => {
  await db.collection('config').doc('bot').set({activo: false, info: 'x'.repeat(60)});
  const {out} = await enviar(msgTexto('hola'));
  assert.equal(out[0].resultado, 'bot_apagado'); assert.equal(alCliente().length, 0);
});

test('estados de entrega (enviado, entregado, leído, error) quedan en el mensaje', async () => {
  await enviar(msgTexto('hola'));
  const salida = db.dump('whatsapp/' + CLIENTE + '/mensajes').find(m => m.dir === 'out');
  const st = s => ({object: 'whatsapp_business_account', entry: [{changes: [{field: 'messages', value: {statuses: [{id: salida.id, recipient_id: CLIENTE, status: s}]}}]}]});
  await enviar(st('read')); await enviar(st('delivered'));
  const m = (await db.collection('whatsapp').doc(CLIENTE).collection('mensajes').doc(salida.id).get()).data();
  assert.equal(m.estado, 'read', 'un "entregado" que llega tarde no pisa el "leído"');
});

test('si Chinguer responde desde la app (coexistencia), el bot se corre', async () => {
  await enviar(msgTexto('hola'));
  await enviar({object: 'whatsapp_business_account', entry: [{changes: [{field: 'smb_message_echoes', value: {message_echoes: [{from: '59898361104', to: CLIENTE, id: 'wamid.ECO1', type: 'text', text: {body: 'Hola Lucía, soy Chinguer'}}]}}]}]});
  assert.equal((await chat()).estado, 'humano');
  enviados = [];
  const {out} = await enviar(msgTexto('¡Hola Chinguer!'));
  assert.equal(out[0].resultado, 'lo_atiende_chinguer'); assert.equal(alCliente().length, 0);
});

test('panel: solo el administrador; responder pausa el bot; fuera de 24 h no deja', async () => {
  await enviar(msgTexto('Quiero coordinar una visita'));
  await assert.rejects(accionPanel({accion: 'resumen'}, 'uid-prov'), /administrador/);
  await assert.rejects(accionPanel({accion: 'resumen'}, null), /administrador/);
  const r = await accionPanel({accion: 'resumen'}, 'uid-admin');
  assert.equal(r.chats.length, 1); assert.equal(r.chats[0].estado, 'derivado'); assert.equal(r.chats[0].motivo, 'Quiere coordinar una visita'); assert.ok(r.chats[0].ventana);
  assert.match(r.config.info, /MORAS & MENTAS/);
  enviados = [];
  await accionPanel({accion: 'responder', waId: CLIENTE, texto: 'Hola Lucía, ¿te queda bien el jueves 17 hs?'}, 'uid-admin');
  assert.equal(alCliente()[0].text.body, 'Hola Lucía, ¿te queda bien el jueves 17 hs?');
  const ch = await accionPanel({accion: 'chat', waId: CLIENTE}, 'uid-admin');
  assert.equal(ch.chat.estado, 'humano'); assert.equal(ch.mensajes.at(-1).autor, 'humano');
  await accionPanel({accion: 'estado', waId: CLIENTE, estado: 'bot'}, 'uid-admin');
  assert.equal((await chat()).estado, 'bot');
  await db.collection('whatsapp').doc(CLIENTE).set({ultimaEntrada: new Date(Date.now() - 25 * 3600e3).toISOString()}, {merge: true});
  await assert.rejects(accionPanel({accion: 'responder', waId: CLIENTE, texto: 'hola'}, 'uid-admin'), /24 horas/);
  const cfg = await accionPanel({accion: 'config', activo: false}, 'uid-admin');
  assert.equal(cfg.config.activo, false);
});

test('conector MCP: protocolo real, clave obligatoria y herramientas', async () => {
  await enviar(msgTexto('Quiero coordinar una visita'));
  // servidor HTTP mínimo que imita a Cloud Functions
  const srv = http.createServer(async (rq, rs) => {
    let raw = ''; for await (const ch of rq) raw += ch;
    const u = new URL(rq.url, 'http://x');
    rq.path = u.pathname; rq.query = Object.fromEntries(u.searchParams); rq.body = raw ? JSON.parse(raw) : undefined;
    rs.status = c => { rs.statusCode = c; return rs; };
    rs.json = j => { rs.setHeader('content-type', 'application/json'); rs.end(JSON.stringify(j)); return rs; };
    rs.set = (k, v) => { rs.setHeader(k, v); return rs; };
    await manejarMcp(rq, rs);
  });
  await new Promise(r => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const sinClave = await fetch(base + '/otra', {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'});
    assert.equal(sinClave.status, 401);
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const cli = new Client({name: 'prueba', version: '1'});
    await cli.connect(new StreamableHTTPClientTransport(new URL(base + '/clave-mcp-123')));
    const {tools} = await cli.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), ['cambiar_estado_chat', 'chats_para_atender', 'chats_recientes', 'consultar_fecha', 'estado_del_bot', 'fechas_reservadas', 'leer_chat', 'responder_whatsapp']);
    const pend = await cli.callTool({name: 'chats_para_atender', arguments: {}});
    assert.match(pend.content[0].text, /Lucía Pérez.*Quiere coordinar una visita/);
    const leido = await cli.callTool({name: 'leer_chat', arguments: {chat: 'Lucía'}});
    assert.match(leido.content[0].text, /Cliente: Quiero coordinar una visita/);
    enviados = [];
    const env = await cli.callTool({name: 'responder_whatsapp', arguments: {chat: '091234567', texto: 'Te espero el jueves a las 17'}});
    assert.match(env.content[0].text, /Enviado/); assert.equal(alCliente()[0].text.body, 'Te espero el jueves a las 17');
    const fechas = await cli.callTool({name: 'fechas_reservadas', arguments: {}});
    assert.equal(fechas.content[0].text.split('\n').length, 2);
    await cli.close();
  } finally { srv.close(); }
});
