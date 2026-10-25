# KARMA Backend - Kartu Asrama Mahasiswa

API untuk sistem manajemen demerit asrama (peringatan, kartu kuning, kartu merah) dan pembersihannya lewat Sanksos.

Front-end ada di repo terpisah: **karma-frontend**.

## Aturan
- 3 peringatan -> 1 demerit kuning
- 2 demerit kuning -> 1 demerit merah
- Pelanggaran fatal -> langsung demerit merah
- Demerit dibersihkan lewat Sanksos: mahasiswa mengajukan, Bapak Asrama memberi tugas, mahasiswa mengerjakan, Bapak Asrama memverifikasi

## Teknologi
Express.js + SQLite (`node:sqlite` bawaan Node, **butuh Node 22.13 atau lebih baru**), autentikasi JWT.

## Menjalankan
```bash
npm install
cp .env.example .env   # lalu sesuaikan (lihat catatan di bawah)
npm run seed           # membuat akun contoh
npm start              # API di http://localhost:3000
npm run dev            # mode watch
npm test               # tes API (node:test)
```

> Aplikasi membaca `process.env` langsung (tidak memuat file `.env` otomatis).
> Jalankan dengan `node --env-file=.env src/index.js`, atau set variabelnya di terminal / platform hosting.

## Akun contoh (hasil seed)
| Peran | NIM / username | Password |
|---|---|---|
| Bapak Asrama | `pembina` | `pembina123` |
| Mahasiswa | `1001` | `mhs123` |
| Mahasiswa | `1002` | `mhs123` |

Ganti password ini dan set `JWT_SECRET` di server produksi.

## Environment variable
| Variabel | Fungsi | Default |
|---|---|---|
| `PORT` | Port server | 3000 |
| `JWT_SECRET` | Kunci token login | `ganti-di-produksi` |
| `DB_FILE` | Lokasi file SQLite | `./demerit.db` |
| `CORS_ORIGIN` | Origin front-end yang diizinkan (pisah koma) | semua origin |

## Endpoint API
| Method | Path | Akses |
|---|---|---|
| GET | /api/health | publik |
| POST | /api/auth/login | publik |
| GET | /api/auth/me | semua peran |
| GET/POST | /api/mahasiswa | Bapak Asrama |
| GET/POST | /api/pelanggaran | GET: semua peran, POST: Bapak Asrama |
| GET | /api/demerit | semua peran (mahasiswa hanya miliknya) |
| GET | /api/ringkasan | mahasiswa |
| GET/POST | /api/sanksos | POST: mahasiswa |
| PATCH | /api/sanksos/:id | setujui, tolak, selesai (Bapak Asrama); dikerjakan (mahasiswa) |
