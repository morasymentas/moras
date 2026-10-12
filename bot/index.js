// Bot de WhatsApp de Moras & Mentas (Cloud Functions de Firebase, proyecto morasymentas-bac78).
//   whatsapp        webhook oficial de Meta: recibe los mensajes y responde con el agente
//   panelWhatsapp   lo usa la sección WhatsApp de panel.html (solo administrador)
//   mcp             conector MCP para manejar el WhatsApp desde Claude
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { setDb } from './lib/db.js';
import { manejarWebhook } from './lib/webhook.js';
import { accionPanel, ErrorPanel } from './lib/panel.js';
import { manejarMcp } from './lib/mcp.js';
import { WA_TOKEN, WA_APP_SECRET, WA_VERIFY_TOKEN, ANTHROPIC_API_KEY, MCP_KEY } from './lib/config.js';

initializeApp();
const db = getFirestore();
db.settings({ignoreUndefinedProperties: true});
setDb(db);

const REGION = 'us-central1';

export const whatsapp = onRequest({
  region: REGION, timeoutSeconds: 120, memory: '512MiB', maxInstances: 10,
  secrets: [WA_TOKEN, WA_APP_SECRET, WA_VERIFY_TOKEN, ANTHROPIC_API_KEY]
}, manejarWebhook);

export const panelWhatsapp = onCall({
  region: REGION, timeoutSeconds: 30, memory: '256MiB', maxInstances: 5, cors: true,
  secrets: [WA_TOKEN]
}, async request => {
  try { return await accionPanel(request.data, request.auth && request.auth.uid); }
  catch (e) {
    if (e instanceof ErrorPanel) throw new HttpsError(e.code, e.message);
    console.error('panelWhatsapp', e);
    throw new HttpsError('internal', 'Algo falló en el servidor del bot.');
  }
});

export const mcp = onRequest({
  region: REGION, timeoutSeconds: 60, memory: '256MiB', maxInstances: 3,
  secrets: [WA_TOKEN, MCP_KEY]
}, manejarMcp);
