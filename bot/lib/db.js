// Acceso a la base (Firestore). En producción usa firebase-admin; las pruebas inyectan una base falsa.
let _db = null;

export function getDb(){
  if (!_db) throw new Error('La base no está inicializada');
  return _db;
}
export function setDb(db){ _db = db; }

export const ahora = () => new Date().toISOString();

// Fecha de hoy en Uruguay (YYYY-MM-DD) y día de la semana
const ZONA = 'America/Montevideo';
export function hoyUY(d = new Date()){
  const p = new Intl.DateTimeFormat('en-CA', {timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit'}).format(d);
  return p; // en-CA da YYYY-MM-DD
}
export function horaUY(d = new Date()){
  return new Intl.DateTimeFormat('es-UY', {timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false}).format(d);
}
export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

// Fechas ISO (YYYY-MM-DD) tratadas como día calendario, sin zona horaria
export function isoADate(iso){ const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
export function dateAIso(d){ return d.toISOString().slice(0, 10); }
export function sumarDias(iso, n){ const d = isoADate(iso); d.setUTCDate(d.getUTCDate() + n); return dateAIso(d); }
export function diaSemana(iso){ return DIAS[isoADate(iso).getUTCDay()]; }
export function fechaLarga(iso){ const d = isoADate(iso); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`; }
export const esIso = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// Teléfonos: WhatsApp manda "59898361104"; el panel guarda "098 361 104"
export const soloDigitos = t => String(t || '').replace(/\D/g, '');
export const ultimos8 = t => soloDigitos(t).slice(-8);
export function telLocal(waId){
  const d = soloDigitos(waId);
  if (d.startsWith('598') && d.length === 11) return '0' + d.slice(3, 5) + ' ' + d.slice(5, 8) + ' ' + d.slice(8);
  return '+' + d;
}
