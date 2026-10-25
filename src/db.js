// SQLite bawaan Node.js (node:sqlite) - tidak perlu kompilasi / library native.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const file = process.env.DB_FILE || path.join(__dirname, '..', 'demerit.db');
const db = new DatabaseSync(file);
db.exec('PRAGMA foreign_keys = ON');

// Pembungkus transaksi sederhana: BEGIN ... COMMIT, ROLLBACK jika error.
db.transaction = (fn) => () => {
  db.exec('BEGIN');
  try {
    const hasil = fn();
    db.exec('COMMIT');
    return hasil;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nama TEXT NOT NULL,
  nim TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('pembina','mahasiswa')),
  asrama TEXT,
  kamar TEXT,
  foto TEXT,
  bio TEXT
);
CREATE TABLE IF NOT EXISTS pelanggaran (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  deskripsi TEXT NOT NULL,
  jenis TEXT NOT NULL CHECK (jenis IN ('peringatan','kuning','fatal')),
  dipakai INTEGER NOT NULL DEFAULT 0,
  tanggal TEXT NOT NULL DEFAULT (datetime('now')),
  dicatat_oleh INTEGER NOT NULL REFERENCES users(id),
  poin INTEGER DEFAULT -10
);
CREATE TABLE IF NOT EXISTS demerit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  jenis TEXT NOT NULL CHECK (jenis IN ('kuning','merah')),
  alasan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','bersih','dikonversi')),
  tanggal TEXT NOT NULL DEFAULT (datetime('now')),
  poin_awal INTEGER DEFAULT -20,
  poin_sekarang INTEGER DEFAULT -20
);
CREATE TABLE IF NOT EXISTS sanksos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  demerit_id INTEGER NOT NULL REFERENCES demerit(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'diajukan'
    CHECK (status IN ('diajukan','disetujui','dikerjakan','selesai','ditolak')),
  catatan TEXT,
  tugas TEXT,
  tanggal TEXT NOT NULL DEFAULT (datetime('now')),
  poin_diberikan INTEGER DEFAULT 0,
  bukti_foto TEXT,
  bukti_selesai TEXT
);
`);

// Migrasi skema untuk database yang sudah dibuat sebelumnya
function addColumnIfNotExists(table, column, def) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some(c => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    }
  } catch {
    // abaikan jika tabel belum ada atau sudah ada kolomnya
  }
}

addColumnIfNotExists('users', 'asrama', 'TEXT');
addColumnIfNotExists('users', 'foto', 'TEXT');
addColumnIfNotExists('users', 'kamar', 'TEXT');
addColumnIfNotExists('users', 'bio', 'TEXT');
addColumnIfNotExists('sanksos', 'bukti_selesai', 'TEXT');
addColumnIfNotExists('pelanggaran', 'poin', 'INTEGER DEFAULT -10');
addColumnIfNotExists('demerit', 'poin_awal', 'INTEGER DEFAULT -20');
addColumnIfNotExists('demerit', 'poin_sekarang', 'INTEGER DEFAULT -20');
addColumnIfNotExists('sanksos', 'poin_diberikan', 'INTEGER DEFAULT 0');
addColumnIfNotExists('sanksos', 'bukti_foto', 'TEXT');

// Pastikan check constraint pada pelanggaran mendukung 'kuning'
try {
  const pelDef = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='pelanggaran'`).get();
  if (pelDef && pelDef.sql && !pelDef.sql.includes("'kuning'")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE pelanggaran_migrasi (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        deskripsi TEXT NOT NULL,
        jenis TEXT NOT NULL CHECK (jenis IN ('peringatan','kuning','fatal')),
        dipakai INTEGER NOT NULL DEFAULT 0,
        tanggal TEXT NOT NULL DEFAULT (datetime('now')),
        dicatat_oleh INTEGER NOT NULL REFERENCES users(id),
        poin INTEGER DEFAULT -10
      );
      INSERT INTO pelanggaran_migrasi (id, user_id, deskripsi, jenis, dipakai, tanggal, dicatat_oleh)
        SELECT id, user_id, deskripsi, jenis, dipakai, tanggal, dicatat_oleh FROM pelanggaran;
      DROP TABLE pelanggaran;
      ALTER TABLE pelanggaran_migrasi RENAME TO pelanggaran;
      PRAGMA foreign_keys = ON;
    `);
  }
} catch {
  // abaikan jika terjadi error migrasi
}

module.exports = db;