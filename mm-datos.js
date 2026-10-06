// Conexión a la base de datos (Firebase) compartida por todas las páginas del sitio.
// Esta configuración es pública por diseño: los datos los protegen las reglas de acceso de la base.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getFirestore, collection, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

export const firebaseConfig = {
  apiKey: "AIzaSyAdEFQVY3bRGvQeMcR0E3ySLtFANkxGtQM",
  authDomain: "morasymentas-bac78.firebaseapp.com",
  projectId: "morasymentas-bac78",
  storageBucket: "morasymentas-bac78.firebasestorage.app",
  messagingSenderId: "587785366572",
  appId: "1:587785366572:web:4c3a29ab14b945cef0f589"
};
export const app = initializeApp(firebaseConfig);
const fs = getFirestore(app);

// Proveedores del sitio. La clave (servicio-proveedor) es la misma en clientes, panel y agendas.
export const PROVEEDORES = [
  {id:'discoteca-balzani', n:'Balzani Music Group', s:'Discoteca'},
  {id:'fotografia-mali', n:'Mali Foto & Video', s:'Fotografía'},
  {id:'catering-menu', n:'Catering', s:'Menú completo'},
  {id:'barra-blackvip', n:'Black Vip Barras Móviles', s:'Barra de tragos'},
  {id:'decoracion-personalizada', n:'Decoración', s:'Decoración personalizada'}
];

// Errores con códigos simples para que las páginas muestren un mensaje claro
const simple = e => {
  const c = String((e && e.code) || '').replace('firestore/', '');
  return {code: c === 'permission-denied' || c === 'unauthenticated' ? 'sin_permiso' : c === 'unavailable' || c === 'deadline-exceeded' ? 'unavailable' : c === 'resource-exhausted' ? 'quota_exceeded' : 'error', message: (e && e.message) || ''};
};
const seguro = p => p.catch(e => { throw simple(e); });
const foto = s => ({id: s.id, exists: s.exists(), data: () => s.data()});

function docRef(path, id){
  const r = doc(fs, path, id);
  return {
    id, path: path + '/' + id,
    get: () => seguro(getDoc(r)).then(foto),
    set: (data, opts) => seguro(opts ? setDoc(r, data, opts) : setDoc(r, data)),
    update: data => seguro(updateDoc(r, data)),
    delete: () => seguro(deleteDoc(r)),
    onSnapshot: (next, err) => onSnapshot(r, s => next(foto(s)), e => err && err(simple(e)))
  };
}
export const db = {
  collection: path => ({
    path,
    doc: id => docRef(path, id || doc(collection(fs, path)).id),
    onSnapshot: (next, err) => onSnapshot(collection(fs, path), s => next({docs: s.docs.map(foto)}), e => err && err(simple(e)))
  }),
  doc: full => { const i = full.lastIndexOf('/'); return docRef(full.slice(0, i), full.slice(i + 1)); }
};
