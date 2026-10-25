process.env.DB_FILE = ':memory:';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const db = require('../src/db');
const app = require('../src/app');

let server, base, tokP, tokM, mid;
const BUKTI = 'data:image/png;base64,bukti';
const call = async (path, { method = 'GET', token, body } = {}) => {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
};

before(async () => {
  const ins = db.prepare(`INSERT INTO users (nama, nim, password, role) VALUES (?,?,?,?)`);
  ins.run('Pembina', 'pembina', bcrypt.hashSync('p', 4), 'pembina');
  mid = ins.run('Mhs', '1001', bcrypt.hashSync('m', 4), 'mahasiswa').lastInsertRowid;
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  tokP = (await call('/api/auth/login', { method: 'POST', body: { nim: 'pembina', password: 'p' } })).data.token;
  tokM = (await call('/api/auth/login', { method: 'POST', body: { nim: '1001', password: 'm' } })).data.token;
});
after(() => server.close());

const peringatan = () => call('/api/pelanggaran', { method: 'POST', token: tokP,
  body: { user_id: mid, deskripsi: 'Terlambat apel', jenis: 'peringatan' } });

test('login salah ditolak', async () => {
  const r = await call('/api/auth/login', { method: 'POST', body: { nim: '1001', password: 'x' } });
  assert.strictEqual(r.status, 401);
});

test('GET /api/auth/me mengembalikan data pengguna yang login', async () => {
  const r = await call('/api/auth/me', { token: tokM });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.user.nim, '1001');
  assert.strictEqual(r.data.user.role, 'mahasiswa');
  assert.strictEqual(r.data.user.password, undefined);
  const tanpaToken = await call('/api/auth/me');
  assert.strictEqual(tanpaToken.status, 401);
});

test('mahasiswa tidak boleh mencatat pelanggaran', async () => {
  const r = await call('/api/pelanggaran', { method: 'POST', token: tokM,
    body: { user_id: mid, deskripsi: 'x', jenis: 'peringatan' } });
  assert.strictEqual(r.status, 403);
});

test('3 peringatan -> 1 kuning', async () => {
  assert.strictEqual((await peringatan()).data.demeritBaru.length, 0);
  assert.strictEqual((await peringatan()).data.demeritBaru.length, 0);
  const r = await peringatan();
  assert.strictEqual(r.data.demeritBaru[0].jenis, 'kuning');
});

test('2 kuning -> 1 merah', async () => {
  await peringatan(); await peringatan();
  const r = await peringatan();
  const jenis = r.data.demeritBaru.map(d => d.jenis);
  assert.deepStrictEqual(jenis, ['kuning', 'merah']);
  const s = (await call('/api/ringkasan', { token: tokM })).data;
  assert.strictEqual(s.kuning_aktif, 0);
  assert.strictEqual(s.merah_aktif, 1);
});

test('pelanggaran fatal -> langsung merah', async () => {
  const r = await call('/api/pelanggaran', { method: 'POST', token: tokP,
    body: { user_id: mid, deskripsi: 'Membawa miras', jenis: 'fatal' } });
  assert.strictEqual(r.data.demeritBaru[0].jenis, 'merah');
});

test('alur Sanksos membersihkan demerit', async () => {
  const demerit = (await call('/api/demerit', { token: tokM })).data.find(d => d.status === 'aktif');
  const req = await call('/api/sanksos', { method: 'POST', token: tokM, body: { demerit_id: demerit.id } });
  assert.strictEqual(req.status, 201);
  const dup = await call('/api/sanksos', { method: 'POST', token: tokM, body: { demerit_id: demerit.id } });
  assert.strictEqual(dup.status, 409);
  const sid = req.data.id;
  const patch = (aksi, token, extra = {}) =>
    call(`/api/sanksos/${sid}`, { method: 'PATCH', token, body: { aksi, ...extra } });

  assert.strictEqual((await patch('selesai', tokP)).status, 400);      // belum dikerjakan
  assert.strictEqual((await patch('setujui', tokP)).status, 400);      // tugas wajib
  assert.strictEqual((await patch('setujui', tokP, { tugas: 'Bersihkan selasar' })).status, 200);
  assert.strictEqual((await patch('dikerjakan', tokM)).status, 400);   // bukti wajib diupload
  assert.strictEqual((await patch('dikerjakan', tokM, { bukti_selesai: 'bukan-data-url' })).status, 400);
  assert.strictEqual((await patch('dikerjakan', tokM, { bukti_selesai: BUKTI })).status, 200);
  assert.strictEqual((await patch('dikerjakan', tokM, { bukti_selesai: BUKTI })).status, 400); // bukti tidak boleh ditimpa
  assert.strictEqual((await patch('selesai', tokP)).status, 200);

  const after = (await call('/api/demerit', { token: tokM })).data.find(d => d.id === demerit.id);
  assert.strictEqual(after.status, 'bersih');
});

test('registrasi mahasiswa baru dengan asrama, kamar, dan foto', async () => {
  const daftar = (body) => call('/api/auth/register', { method: 'POST', body });
  const dasar = { nama: 'Regi Mahasiswa', nim: '9999', password: 'secret', asrama: 'Asrama Simon Love Place', kamar: 'a-101' };

  // asrama tidak valid ditolak (kamar sudah diisi, jadi yang dites memang asramanya)
  const asramaSalah = await daftar({ ...dasar, asrama: 'Asrama Tidak Ada' });
  assert.strictEqual(asramaSalah.status, 400);
  assert.match(asramaSalah.data.error, /Asrama tidak valid/);

  // kamar wajib diisi
  const tanpaKamar = await daftar({ ...dasar, kamar: undefined });
  assert.strictEqual(tanpaKamar.status, 400);
  const kamarKosong = await daftar({ ...dasar, kamar: '   ' });
  assert.strictEqual(kamarKosong.status, 400);

  const reg = await daftar({ ...dasar, foto: 'data:image/png;base64,sample' });
  assert.strictEqual(reg.status, 201);
  assert.strictEqual(reg.data.user.asrama, 'Asrama Simon Love Place');
  assert.strictEqual(reg.data.user.kamar, 'A-101');   // dinormalisasi ke huruf besar
  assert.strictEqual(reg.data.user.foto, 'data:image/png;base64,sample');
  assert.ok(reg.data.token);

  // NIM yang sama tidak boleh didaftarkan dua kali
  const dup = await daftar(dasar);
  assert.strictEqual(dup.status, 409);
});

test('pencatatan pelanggaran jenis kuning langsung dan pengurangan poin sanksos bertahap', async () => {
  // Buat akun mahasiswa baru
  const reg = await call('/api/auth/register', {
    method: 'POST',
    body: { nama: 'Budi Santoso', nim: '8888', password: 'pass', asrama: 'Asrama Louis Pasteur', kamar: 'B-202' },
  });
  const newMId = reg.data.user.id;
  const newTokM = reg.data.token;

  // Catat kartu kuning langsung dengan poin -20
  const pel = await call('/api/pelanggaran', {
    method: 'POST',
    token: tokP,
    body: { user_id: newMId, deskripsi: 'Terlambat jam malam', jenis: 'kuning', poin: -20 },
  });
  assert.strictEqual(pel.status, 201);
  assert.strictEqual(pel.data.demeritBaru[0].jenis, 'kuning');

  const demerit = (await call('/api/demerit', { token: newTokM })).data[0];
  assert.strictEqual(demerit.poin_sekarang, -20);
  assert.strictEqual(demerit.status, 'aktif');

  // Request sanksos 1
  const req1 = await call('/api/sanksos', {
    method: 'POST',
    token: newTokM,
    body: { demerit_id: demerit.id, catatan: 'Siap bersihkan lab' },
  });
  assert.strictEqual(req1.status, 201);
  const sid1 = req1.data.id;

  await call(`/api/sanksos/${sid1}`, {
    method: 'PATCH',
    token: tokP,
    body: { aksi: 'setujui', tugas: 'Bersihkan lab komputer' },
  });
  await call(`/api/sanksos/${sid1}`, {
    method: 'PATCH',
    token: newTokM,
    body: { aksi: 'dikerjakan', bukti_selesai: BUKTI },
  });

  // Pembina verifikasi dengan memberi +10 poin saja
  const sel1 = await call(`/api/sanksos/${sid1}`, {
    method: 'PATCH',
    token: tokP,
    body: { aksi: 'selesai', poin: 10 },
  });
  assert.strictEqual(sel1.status, 200);
  assert.strictEqual(sel1.data.poin_sekarang, -10);
  assert.strictEqual(sel1.data.demerit_status, 'aktif');

  // Demerit belum bersih karena baru mencapai -10
  const after1 = (await call('/api/demerit', { token: newTokM })).data[0];
  assert.strictEqual(after1.status, 'aktif');
  assert.strictEqual(after1.poin_sekarang, -10);

  // Mahasiswa bisa request sanksos ke-2 untuk melunasi sisa poin
  const req2 = await call('/api/sanksos', {
    method: 'POST',
    token: newTokM,
    body: { demerit_id: demerit.id, catatan: 'Sanksos tahap 2' },
  });
  assert.strictEqual(req2.status, 201);
  const sid2 = req2.data.id;

  await call(`/api/sanksos/${sid2}`, {
    method: 'PATCH',
    token: tokP,
    body: { aksi: 'setujui', tugas: 'Bersihkan lorong lantai 2' },
  });
  await call(`/api/sanksos/${sid2}`, {
    method: 'PATCH',
    token: newTokM,
    body: { aksi: 'dikerjakan', bukti_selesai: BUKTI },
  });

  // Pembina verifikasi dengan +10 poin lagi -> total mencapai 0 -> demerit bersih!
  const sel2 = await call(`/api/sanksos/${sid2}`, {
    method: 'PATCH',
    token: tokP,
    body: { aksi: 'selesai', poin: 10 },
  });
  assert.strictEqual(sel2.status, 200);
  assert.strictEqual(sel2.data.poin_sekarang, 0);
  assert.strictEqual(sel2.data.demerit_status, 'bersih');

  const after2 = (await call('/api/demerit', { token: newTokM })).data[0];
  assert.strictEqual(after2.status, 'bersih');
  assert.strictEqual(after2.poin_sekarang, 0);
});

