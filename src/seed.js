const bcrypt = require('bcryptjs');
const db = require('./db');

const ada = db.prepare(`SELECT COUNT(*) c FROM users`).get().c;
if (ada > 0) { console.log('Data sudah ada, seed dilewati.'); process.exit(0); }

const ins = db.prepare(`INSERT INTO users (nama, nim, password, role, asrama) VALUES (?,?,?,?,?)`);
const h = (p) => bcrypt.hashSync(p, 10);
ins.run('Bapak Asrama', 'pembina', h('pembina123'), 'pembina', null);
ins.run('Mahasiswa Contoh 1', '1001', h('mhs123'), 'mahasiswa', 'Asrama Simon Love Place');
ins.run('Mahasiswa Contoh 2', '1002', h('mhs123'), 'mahasiswa', 'Asrama Ada Love Place');
console.log('Seed selesai. Login pembina: pembina / pembina123 | mahasiswa: 1001 / mhs123');
