const app = require('./app');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`KARMA API jalan di http://localhost:${PORT}`));
