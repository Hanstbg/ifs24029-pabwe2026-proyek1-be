const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { buatToken, wajibLogin, wajibRole } = require('./auth');
const { catatPelanggaran, ringkasan } = require('./logic');
const { DAFTAR_ASRAMA } = require('./constants');

const normKamar = (k) => String(k || '').trim().toUpperCase();

const app = express();
// CORS_ORIGIN: alamat front-end, pisahkan dengan koma bila lebih dari satu
// (mis. https://karma.example.com,http://localhost:5173). Kosong = izinkan semua origin.
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : true;
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- Auth
app.post('/api/auth/login', (req, res) => {
  const { nim, password } = req.body || {};
  const u = db.prepare(`SELECT * FROM users WHERE nim = ?`).get(nim);
  if (!u || !bcrypt.compareSync(password || '', u.password))
    return res.status(401).json({ error: 'NIM atau password salah' });
  res.json({
    token: buatToken(u),
    user: { id: u.id, nama: u.nama, nim: u.nim, role: u.role, asrama: u.asrama, kamar: u.kamar, foto: u.foto, bio: u.bio },
  });
});

app.post('/api/auth/register', (req, res) => {
  const { nama, nim, password, asrama, foto } = req.body || {};
  const kamar = normKamar(req.body?.kamar);
  if (!nama || !nim || !password || !asrama || !kamar) {
    return res.status(400).json({ error: 'Nama, NIM, kata sandi, asrama, dan kamar wajib diisi' });
  }
  if (!DAFTAR_ASRAMA.includes(asrama)) {
    return res.status(400).json({ error: 'Asrama tidak valid. Pilih dari 7 asrama resmi.' });
  }
  try {
    const hashed = bcrypt.hashSync(password, 10);
    const r = db.prepare(
      `INSERT INTO users (nama, nim, password, role, asrama, kamar, foto) VALUES (?,?,?, 'mahasiswa', ?, ?, ?)`
    ).run(nama, nim, hashed, asrama, kamar, foto || null);
    const newUser = { id: r.lastInsertRowid, nama, nim, role: 'mahasiswa', asrama, kamar, foto: foto || null, bio: null };
    res.status(201).json({ token: buatToken(newUser), user: newUser });
  } catch {
    res.status(409).json({ error: 'NIM sudah terdaftar' });
  }
});

app.get('/api/auth/me', wajibLogin, (req, res) => {
  const u = db.prepare(`SELECT id, nama, nim, role, asrama, kamar, foto, bio FROM users WHERE id = ?`).get(req.user.id);
  if (!u) return res.status(401).json({ error: 'Akun tidak ditemukan' });
  res.json({ user: u });
});

// ---- Profil (semua peran): ubah nama, bio, foto; mahasiswa juga boleh pindah asrama / kamar
app.put('/api/profil', wajibLogin, (req, res) => {
  const u = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user.id);
  if (!u) return res.status(401).json({ error: 'Akun tidak ditemukan' });
  const body = req.body || {};

  const nama = body.nama !== undefined ? String(body.nama).trim() : u.nama;
  if (!nama) return res.status(400).json({ error: 'Nama tidak boleh kosong' });
  const bio = body.bio !== undefined ? (String(body.bio).trim().slice(0, 300) || null) : u.bio;
  const foto = 'foto' in body ? (body.foto || null) : u.foto;

  let asrama = u.asrama;
  let kamar = u.kamar;
  if (u.role === 'mahasiswa') {
    if (body.asrama !== undefined) {
      if (!DAFTAR_ASRAMA.includes(body.asrama))
        return res.status(400).json({ error: 'Asrama tidak valid. Pilih dari 7 asrama resmi.' });
      asrama = body.asrama;
    }
    if (body.kamar !== undefined) {
      kamar = normKamar(body.kamar);
      if (!kamar) return res.status(400).json({ error: 'Nomor kamar wajib diisi' });
    }
  }

  db.prepare(`UPDATE users SET nama = ?, bio = ?, foto = ?, asrama = ?, kamar = ? WHERE id = ?`)
    .run(nama, bio, foto, asrama, kamar, u.id);
  res.json({ user: { id: u.id, nama, nim: u.nim, role: u.role, asrama, kamar, foto, bio } });
});

// ---- Mahasiswa (pembina)
app.get('/api/mahasiswa', wajibLogin, wajibRole('pembina'), (req, res) => {
  const rows = db.prepare(`SELECT id, nama, nim, asrama, kamar, foto FROM users WHERE role='mahasiswa' ORDER BY nama`).all();
  res.json(rows.map(r => ({ ...r, ...ringkasan(r.id) })));
});
app.post('/api/mahasiswa', wajibLogin, wajibRole('pembina'), (req, res) => {
  const { nama, nim, password, asrama, foto } = req.body || {};
  const kamar = normKamar(req.body?.kamar) || null;
  if (!nama || !nim || !password) return res.status(400).json({ error: 'nama, nim, password wajib diisi' });
  try {
    const r = db.prepare(`INSERT INTO users (nama, nim, password, role, asrama, kamar, foto) VALUES (?,?,?, 'mahasiswa', ?, ?, ?)`)
      .run(nama, nim, bcrypt.hashSync(password, 10), asrama || null, kamar, foto || null);
    res.status(201).json({ id: r.lastInsertRowid, nama, nim, asrama: asrama || null, kamar, foto: foto || null });
  } catch {
    res.status(409).json({ error: 'NIM sudah terdaftar' });
  }
});

// Ubah kamar mahasiswa (untuk data lama yang belum punya kamar)
app.patch('/api/mahasiswa/:id', wajibLogin, wajibRole('pembina'), (req, res) => {
  const kamar = normKamar(req.body?.kamar);
  const r = db.prepare(`UPDATE users SET kamar = ? WHERE id = ? AND role = 'mahasiswa'`)
    .run(kamar || null, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Mahasiswa tidak ditemukan' });
  res.json({ id: Number(req.params.id), kamar: kamar || null });
});

// ---- Asrama (pembina)
app.get('/api/asrama', wajibLogin, wajibRole('pembina'), (req, res) => {
  const rows = db.prepare(
    `SELECT id, nama, nim, asrama, kamar, foto FROM users WHERE role='mahasiswa' ORDER BY nama`
  ).all().map(r => ({ ...r, ...ringkasan(r.id) }));

  res.json(DAFTAR_ASRAMA.map(nama => {
    const anggota = rows.filter(r => r.asrama === nama);
    return { nama, jumlah_mahasiswa: anggota.length, mahasiswa: anggota };
  }));
});

// ---- Pelanggaran
app.post('/api/pelanggaran', wajibLogin, wajibRole('pembina'), (req, res) => {
  const { user_id, deskripsi, jenis, poin, asrama } = req.body || {};
  const kamar = normKamar(req.body?.kamar);
  if (!deskripsi || !['peringatan', 'kuning', 'fatal'].includes(jenis))
    return res.status(400).json({ error: 'deskripsi dan jenis (peringatan/kuning/fatal) wajib diisi' });

  // Mode satu kamar: pelanggaran dicatat untuk SEMUA penghuni kamar tersebut
  if (kamar) {
    const penghuni = asrama
      ? db.prepare(`SELECT id, nama FROM users WHERE role='mahasiswa' AND kamar = ? AND asrama = ?`).all(kamar, asrama)
      : db.prepare(`SELECT id, nama FROM users WHERE role='mahasiswa' AND kamar = ?`).all(kamar);
    if (!penghuni.length) return res.status(404).json({ error: 'Tidak ada penghuni di kamar tersebut' });
    const hasil = penghuni.map((m) => ({
      user_id: m.id,
      nama: m.nama,
      ...catatPelanggaran({ userId: m.id, deskripsi, jenis, pembinaId: req.user.id, poin }),
    }));
    return res.status(201).json({
      kamar,
      jumlah: hasil.length,
      hasil,
      demeritBaru: hasil.flatMap((h) => h.demeritBaru),
    });
  }

  if (!user_id) return res.status(400).json({ error: 'user_id atau kamar wajib diisi' });
  const m = db.prepare(`SELECT id FROM users WHERE id = ? AND role='mahasiswa'`).get(user_id);
  if (!m) return res.status(404).json({ error: 'Mahasiswa tidak ditemukan' });
  res.status(201).json(catatPelanggaran({ userId: user_id, deskripsi, jenis, pembinaId: req.user.id, poin }));
});
app.get('/api/pelanggaran', wajibLogin, (req, res) => {
  const sql = `SELECT p.*, u.nama FROM pelanggaran p JOIN users u ON u.id = p.user_id`;
  const rows = req.user.role === 'pembina'
    ? db.prepare(`${sql} ORDER BY p.id DESC`).all()
    : db.prepare(`${sql} WHERE p.user_id = ? ORDER BY p.id DESC`).all(req.user.id);
  res.json(rows);
});

// ---- Demerit
app.get('/api/demerit', wajibLogin, (req, res) => {
  const sql = `SELECT d.*, u.nama FROM demerit d JOIN users u ON u.id = d.user_id`;
  const rows = req.user.role === 'pembina'
    ? db.prepare(`${sql} ORDER BY d.id DESC`).all()
    : db.prepare(`${sql} WHERE d.user_id = ? ORDER BY d.id DESC`).all(req.user.id);
  res.json(rows);
});
app.get('/api/ringkasan', wajibLogin, wajibRole('mahasiswa'), (req, res) =>
  res.json(ringkasan(req.user.id)));

// ---- Sanksos
app.get('/api/sanksos', wajibLogin, (req, res) => {
  const sql = `SELECT s.*, u.nama, d.jenis AS jenis_demerit, d.alasan, d.poin_awal, d.poin_sekarang FROM sanksos s
    JOIN users u ON u.id = s.user_id JOIN demerit d ON d.id = s.demerit_id`;
  const rows = req.user.role === 'pembina'
    ? db.prepare(`${sql} ORDER BY s.id DESC`).all()
    : db.prepare(`${sql} WHERE s.user_id = ? ORDER BY s.id DESC`).all(req.user.id);
  res.json(rows);
});
app.post('/api/sanksos', wajibLogin, wajibRole('mahasiswa'), (req, res) => {
  const { demerit_id, catatan, bukti_foto } = req.body || {};
  const d = db.prepare(`SELECT * FROM demerit WHERE id = ? AND user_id = ?`).get(demerit_id, req.user.id);
  if (!d) return res.status(404).json({ error: 'Demerit tidak ditemukan' });
  if (d.status !== 'aktif') return res.status(400).json({ error: 'Demerit ini sudah tidak aktif' });
  const buka = db.prepare(
    `SELECT id FROM sanksos WHERE demerit_id = ? AND status IN ('diajukan','disetujui','dikerjakan')`
  ).get(demerit_id);
  if (buka) return res.status(409).json({ error: 'Sudah ada request Sanksos untuk demerit ini' });
  const r = db.prepare(`INSERT INTO sanksos (demerit_id, user_id, catatan, bukti_foto) VALUES (?,?,?,?)`)
    .run(demerit_id, req.user.id, catatan || null, bukti_foto || null);
  res.status(201).json({ id: r.lastInsertRowid, status: 'diajukan' });
});
// aksi: setujui(+tugas) | tolak | dikerjakan (mahasiswa) | selesai (pembina)
app.patch('/api/sanksos/:id', wajibLogin, (req, res) => {
  const s = db.prepare(`SELECT * FROM sanksos WHERE id = ?`).get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Sanksos tidak ditemukan' });
  const { aksi, tugas, poin, bukti_selesai } = req.body || {};
  const set = (status, extra = {}) => {
    db.prepare(`UPDATE sanksos SET status = ?, tugas = COALESCE(?, tugas), bukti_foto = COALESCE(?, bukti_foto) WHERE id = ?`)
      .run(status, extra.tugas ?? null, extra.bukti_foto ?? null, s.id);
    return res.json({ id: s.id, status });
  };
  const salah = (m) => res.status(400).json({ error: m });

  if (req.user.role === 'pembina') {
    if (aksi === 'setujui') {
      if (s.status !== 'diajukan') return salah('Hanya request berstatus diajukan yang bisa disetujui');
      if (!tugas) return salah('tugas wajib diisi');
      return set('disetujui', { tugas });
    }
    if (aksi === 'tolak') {
      if (s.status !== 'diajukan') return salah('Hanya request berstatus diajukan yang bisa ditolak');
      return set('ditolak');
    }
    if (aksi === 'selesai') {
      if (s.status !== 'dikerjakan') return salah('Tugas belum ditandai dikerjakan oleh mahasiswa');
      const d = db.prepare(`SELECT * FROM demerit WHERE id = ?`).get(s.demerit_id);
      const poinTambah = poin !== undefined ? Number(poin) : Math.abs(d?.poin_sekarang ?? 20);
      const poinBaru = Math.min(0, (d?.poin_sekarang ?? -20) + poinTambah);
      const statusDemerit = poinBaru >= 0 ? 'bersih' : 'aktif';

      db.prepare(`UPDATE sanksos SET status = 'selesai', poin_diberikan = ? WHERE id = ?`)
        .run(poinTambah, s.id);
      db.prepare(`UPDATE demerit SET poin_sekarang = ?, status = ? WHERE id = ?`)
        .run(poinBaru, statusDemerit, s.demerit_id);

      return res.json({
        id: s.id,
        status: 'selesai',
        poin_diberikan: poinTambah,
        poin_sekarang: poinBaru,
        demerit_status: statusDemerit,
      });
    }
  } else if (aksi === 'dikerjakan' && s.user_id === req.user.id) {
    // Boleh dari 'disetujui' (tandai selesai dikerjakan) atau 'dikerjakan' (melengkapi bukti yang belum ada)
    if (!['disetujui', 'dikerjakan'].includes(s.status)) return salah('Tugas belum disetujui');
    // Kalau sudah dikerjakan dan buktinya sudah ada, tidak boleh ditimpa lagi
    if (s.status === 'dikerjakan' && s.bukti_selesai) return salah('Bukti pengerjaan sudah dikirim');
    if (typeof bukti_selesai !== 'string' || !bukti_selesai.startsWith('data:'))
      return salah('Foto / file bukti pengerjaan wajib diupload');
    // Bukti pengerjaan disimpan di kolom terpisah agar lampiran awal tidak tertimpa
    db.prepare(`UPDATE sanksos SET status = 'dikerjakan', bukti_selesai = ? WHERE id = ?`)
      .run(bukti_selesai, s.id);
    return res.json({ id: s.id, status: 'dikerjakan' });
  }
  res.status(400).json({ error: 'Aksi tidak valid' });
});

module.exports = app;