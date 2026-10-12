// Configuración del bot. Las claves secretas viven en Secret Manager de Google (nunca en este repositorio).
import { defineSecret, defineString } from 'firebase-functions/params';

// Secretos: el deploy los pide la primera vez y los guarda en Secret Manager
export const WA_TOKEN = defineSecret('WA_TOKEN');                 // token permanente del usuario del sistema de Meta
export const WA_APP_SECRET = defineSecret('WA_APP_SECRET');       // "Clave secreta de la app" de Meta: valida que los avisos vienen de Meta
export const WA_VERIFY_TOKEN = defineSecret('WA_VERIFY_TOKEN');   // palabra inventada, la misma que se pone al configurar el webhook en Meta
export const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
export const MCP_KEY = defineSecret('MCP_KEY');                   // palabra inventada que va al final del link del conector MCP

// Datos no secretos: el deploy los pregunta y los guarda en bot/.env.<proyecto> (ese archivo no se sube a GitHub)
export const WA_PHONE_NUMBER_ID = defineString('WA_PHONE_NUMBER_ID', {description: 'Identificador del número de teléfono (Meta > WhatsApp > Configuración de la API)'});
export const WA_WABA_ID = defineString('WA_WABA_ID', {description: 'Identificador de la cuenta de WhatsApp Business (Meta > WhatsApp > Configuración de la API)'});
export const ADMIN_WA = defineString('ADMIN_WA', {description: 'Tu WhatsApp personal para recibir avisos, formato 5989XXXXXXX (si son varios, separados por coma)'});
export const AVISO_PLANTILLA = defineString('AVISO_PLANTILLA', {default: 'aviso_derivacion', description: 'Nombre de la plantilla aprobada para avisarte cuando un chat te queda para atender'});

export const GRAPH = 'https://graph.facebook.com/v23.0';
export const SITIO = 'https://morasymentas.github.io/moras/';
export const PANEL = 'https://morasymentas.github.io/moras/panel.html#whatsapp';
export const INSTAGRAM = 'https://www.instagram.com/moras_y_mentas/';

export const MODELO_POR_DEFECTO = 'claude-haiku-5-5';
export const ESPERA_AGRUPAR_MS = 5000;        // espera para juntar varios mensajes seguidos del cliente en una sola respuesta
export const HISTORIAL_MAX = 40;              // mensajes del chat que ve el agente
export const VENTANA_MS = 24 * 3600 * 1000;   // ventana de atención de WhatsApp: se puede escribir texto libre hasta 24 h después del último mensaje del cliente
export const REAVISO_MS = 2 * 3600 * 1000;    // si un chat derivado vuelve a escribir, se avisa de nuevo como máximo cada 2 h
export const VUELVE_AL_BOT_DIAS = 30;         // un chat derivado o atendido por vos vuelve al bot si pasan 30 días sin movimiento

// Valor de un parámetro sin romper si falta (en pruebas o antes del primer deploy)
export function val(p, def = ''){ try { const v = p.value(); return v == null || v === '' ? def : v; } catch { return def; } }
export const admins = () => val(ADMIN_WA).split(',').map(s => s.replace(/\D/g, '')).filter(Boolean);
