// Firestore en memoria con lo justo que usa el bot (para las pruebas).
const clon = v => v == null ? v : JSON.parse(JSON.stringify(v));

export class FakeFirestore {
  constructor(){ this.docs = new Map(); this.n = 0; }
  collection(path){ return new Col(this, path); }
  dump(prefix = ''){ return [...this.docs.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => ({path: k, ...v})); }
}

class Snap {
  constructor(id, data){ this.id = id; this.exists = data !== undefined; this._d = data; }
  data(){ return clon(this._d); }
}

class Doc {
  constructor(db, path){ this.db = db; this.path = path; this.id = path.split('/').pop(); }
  collection(name){ return new Col(this.db, this.path + '/' + name); }
  async get(){ return new Snap(this.id, clon(this.db.docs.get(this.path))); }
  async set(data, opts){
    const prev = this.db.docs.get(this.path);
    this.db.docs.set(this.path, opts && opts.merge && prev ? {...prev, ...clon(data)} : clon(data));
  }
  async create(data){
    if (this.db.docs.has(this.path)){ const e = new Error('6 ALREADY_EXISTS: Document already exists'); e.code = 6; throw e; }
    this.db.docs.set(this.path, clon(data));
  }
  async update(data){
    if (!this.db.docs.has(this.path)){ const e = new Error('5 NOT_FOUND'); e.code = 5; throw e; }
    this.db.docs.set(this.path, {...this.db.docs.get(this.path), ...clon(data)});
  }
  async delete(){ this.db.docs.delete(this.path); }
}

class Col {
  constructor(db, path, filtros = [], orden = null, lim = null){ this.db = db; this.path = path; this.f = filtros; this.o = orden; this.l = lim; }
  doc(id){ return new Doc(this.db, this.path + '/' + (id || 'auto' + (++this.db.n))); }
  where(campo, op, valor){ return new Col(this.db, this.path, [...this.f, [campo, op, valor]], this.o, this.l); }
  orderBy(campo, dir = 'asc'){ return new Col(this.db, this.path, this.f, [campo, dir], this.l); }
  limit(n){ return new Col(this.db, this.path, this.f, this.o, n); }
  async get(){
    const pre = this.path + '/';
    let filas = [...this.db.docs.entries()].filter(([k]) => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map(([k, v]) => ({id: k.slice(pre.length), d: v}));
    for (const [c, op, v] of this.f){
      filas = filas.filter(({d}) => op === '==' ? d[c] === v : op === 'in' ? v.includes(d[c]) : true);
    }
    if (this.o){
      const [c, dir] = this.o;
      filas = filas.filter(({d}) => d[c] != null).sort((a, b) => String(a.d[c]).localeCompare(String(b.d[c])) * (dir === 'desc' ? -1 : 1));
    }
    if (this.l) filas = filas.slice(0, this.l);
    return {docs: filas.map(({id, d}) => new Snap(id, clon(d)))};
  }
}
