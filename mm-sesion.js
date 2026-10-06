// Inicio de sesión con mail y contraseña para el panel y las agendas.
import { app, db } from './mm-datos.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

const auth = getAuth(app);
const $ = id => document.getElementById(id);
const ERR = {
  'auth/invalid-credential': 'El mail o la contraseña no coinciden.',
  'auth/wrong-password': 'El mail o la contraseña no coinciden.',
  'auth/user-not-found': 'El mail o la contraseña no coinciden.',
  'auth/invalid-email': 'Ese mail no es válido.',
  'auth/user-disabled': 'Este usuario está desactivado.',
  'auth/too-many-requests': 'Demasiados intentos. Esperá unos minutos y probá de nuevo.',
  'auth/network-request-failed': 'No hay conexión. Revisá internet y probá de nuevo.'
};

export const salir = () => signOut(auth);

// Lee (o crea) la ficha del usuario: {email, rol: 'admin' | 'proveedor' | 'pendiente', proveedor}
export async function fichaDe(user){
  const ref = db.doc('usuarios/' + user.uid);
  let d = null;
  try { d = await ref.get(); } catch (e) { return {rol: 'pendiente', error: true}; }
  if (d.exists && d.data().rol === 'admin') return d.data();
  // El administrador principal está definido en las reglas de la base: solo a él le deja tomar este rol.
  try { await ref.set({email: user.email || '', rol: 'admin', creado: (d.exists && d.data().creado) || new Date().toISOString()}, {merge: true}); return {email: user.email, rol: 'admin'}; } catch (e) {}
  if (d.exists) return d.data();
  const nueva = {email: user.email || '', rol: 'pendiente', creado: new Date().toISOString()};
  try { await ref.set(nueva); } catch (e) {}
  return nueva;
}

// Maneja la pantalla de ingreso (#login) y la aplicación (#app). onEntrar(user, ficha) arranca la página.
export function sesion({onEntrar}){
  const login = $('login'), appEl = $('app'), form = $('login-form'), msg = $('login-msg'), btn = $('login-btn');
  let arrancada = false;
  form.addEventListener('submit', async e => {
    e.preventDefault(); msg.textContent = ''; msg.classList.remove('ok'); btn.disabled = true;
    try { await signInWithEmailAndPassword(auth, $('login-mail').value.trim(), $('login-pass').value); }
    catch (err){ msg.textContent = ERR[err.code] || 'No se pudo entrar. Probá de nuevo.'; }
    btn.disabled = false;
  });
  $('login-olvide').addEventListener('click', async () => {
    const mail = $('login-mail').value.trim(); msg.classList.remove('ok');
    if (!mail){ msg.textContent = 'Escribí tu mail arriba y volvé a tocar este botón.'; $('login-mail').focus(); return; }
    try { await sendPasswordResetEmail(auth, mail); msg.classList.add('ok'); msg.textContent = 'Si ese mail tiene usuario, te llega un correo para cambiar la contraseña.'; }
    catch (err){ msg.textContent = ERR[err.code] || 'No se pudo enviar el correo. Probá de nuevo.'; }
  });
  const sal = $('salir'); if (sal) sal.addEventListener('click', () => salir());
  onAuthStateChanged(auth, async user => {
    if (!user){
      if (arrancada){ location.reload(); return; }      // al salir se limpia todo lo que había en pantalla
      $('login-cargando').hidden = true; form.hidden = false; login.hidden = false; appEl.hidden = true; return;
    }
    form.hidden = true; $('login-cargando').hidden = false; $('login-cargando').textContent = 'Entrando…';
    const ficha = await fichaDe(user);
    const chip = $('usuario'); if (chip) chip.textContent = user.email || '';
    arrancada = true;
    const ok = await onEntrar(user, ficha);
    if (ok === false){ $('login-cargando').hidden = true; return; }   // la página mostró su propio aviso en #login
    login.hidden = true; appEl.hidden = false;
  });
}
