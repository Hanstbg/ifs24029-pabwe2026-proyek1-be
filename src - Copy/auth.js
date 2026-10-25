const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'ganti-di-produksi';

const buatToken = (u) => jwt.sign({ id: u.id, role: u.role, nama: u.nama }, SECRET, { expiresIn: '8h' });

function wajibLogin(req, res, next) {
  const h = req.headers.authorization || '';
  try {
    req.user = jwt.verify(h.replace('Bearer ', ''), SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Belum login atau token tidak valid' });
  }
}
const wajibRole = (role) => (req, res, next) =>
  req.user.role === role ? next() : res.status(403).json({ error: `Hanya untuk ${role}` });

module.exports = { buatToken, wajibLogin, wajibRole };
