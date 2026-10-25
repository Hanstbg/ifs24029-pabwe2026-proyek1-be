// Aturan demerit: 3 peringatan -> 1 kuning, 2 kuning -> 1 merah, fatal -> langsung merah, kuning -> langsung kuning.
const db = require('./db');

function catatPelanggaran({ userId, deskripsi, jenis, pembinaId, poin }) {
  const tx = db.transaction(() => {
    // Tentukan default poin bila tidak diinput spesifik
    let nilaiPoin = poin !== undefined ? -Math.abs(Number(poin)) : -10;
    if (jenis === 'kuning') nilaiPoin = poin !== undefined ? -Math.abs(Number(poin)) : -20;
    if (jenis === 'fatal') nilaiPoin = poin !== undefined ? -Math.abs(Number(poin)) : -50;

    const dipakai = 0;
    const info = db.prepare(
      `INSERT INTO pelanggaran (user_id, deskripsi, jenis, dipakai, dicatat_oleh, poin) VALUES (?,?,?,?,?,?)`
    ).run(userId, deskripsi, jenis, dipakai, pembinaId, nilaiPoin);
    const hasil = { pelanggaranId: info.lastInsertRowid, demeritBaru: [] };

    const buatDemerit = (j, alasan, pDemerit) => {
      const p = pDemerit !== undefined ? -Math.abs(Number(pDemerit)) : (j === 'merah' ? -50 : -20);
      const r = db.prepare(
        `INSERT INTO demerit (user_id, jenis, alasan, poin_awal, poin_sekarang) VALUES (?,?,?,?,?)`
      ).run(userId, j, alasan, p, p);
      hasil.demeritBaru.push({ id: r.lastInsertRowid, jenis: j, alasan, poin_awal: p, poin_sekarang: p });
    };

    if (jenis === 'fatal') {
      db.prepare(`UPDATE pelanggaran SET dipakai = 1 WHERE id = ?`).run(info.lastInsertRowid);
      buatDemerit('merah', `Pelanggaran fatal: ${deskripsi}`, nilaiPoin);
      return hasil;
    }

    if (jenis === 'kuning') {
      db.prepare(`UPDATE pelanggaran SET dipakai = 1 WHERE id = ?`).run(info.lastInsertRowid);
      buatDemerit('kuning', `Kartu kuning: ${deskripsi}`, nilaiPoin);

      const kuning = db.prepare(
        `SELECT id FROM demerit WHERE user_id = ? AND jenis = 'kuning' AND status = 'aktif' ORDER BY id LIMIT 2`
      ).all(userId);
      if (kuning.length === 2) {
        const konv = db.prepare(`UPDATE demerit SET status = 'dikonversi' WHERE id = ?`);
        kuning.forEach(k => konv.run(k.id));
        buatDemerit('merah', 'Akumulasi 2 demerit kuning', -50);
      }
      return hasil;
    }

    const peringatan = db.prepare(
      `SELECT id FROM pelanggaran WHERE user_id = ? AND jenis = 'peringatan' AND dipakai = 0 ORDER BY id LIMIT 3`
    ).all(userId);
    if (peringatan.length === 3) {
      const mark = db.prepare(`UPDATE pelanggaran SET dipakai = 1 WHERE id = ?`);
      peringatan.forEach(p => mark.run(p.id));
      buatDemerit('kuning', 'Akumulasi 3 peringatan', -20);

      const kuning = db.prepare(
        `SELECT id FROM demerit WHERE user_id = ? AND jenis = 'kuning' AND status = 'aktif' ORDER BY id LIMIT 2`
      ).all(userId);
      if (kuning.length === 2) {
        const konv = db.prepare(`UPDATE demerit SET status = 'dikonversi' WHERE id = ?`);
        kuning.forEach(k => konv.run(k.id));
        buatDemerit('merah', 'Akumulasi 2 demerit kuning', -50);
      }
    }
    return hasil;
  });
  return tx();
}

function ringkasan(userId) {
  const sisaPeringatan = db.prepare(
    `SELECT COUNT(*) c FROM pelanggaran WHERE user_id = ? AND jenis='peringatan' AND dipakai = 0`
  ).get(userId).c;
  const hitung = (j) => db.prepare(
    `SELECT COUNT(*) c FROM demerit WHERE user_id = ? AND jenis = ? AND status = 'aktif'`
  ).get(userId, j).c;
  const totalPoin = db.prepare(
    `SELECT COALESCE(SUM(poin_sekarang), 0) s FROM demerit WHERE user_id = ? AND status = 'aktif'`
  ).get(userId).s;
  return {
    peringatan_berjalan: sisaPeringatan,
    kuning_aktif: hitung('kuning'),
    merah_aktif: hitung('merah'),
    total_poin_demerit: totalPoin,
  };
}

module.exports = { catatPelanggaran, ringkasan };
