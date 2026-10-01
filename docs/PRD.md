## Identitas produk

- **Koleksi aplikasi:** NiftyDock
- **Aplikasi dalam draf ini:** Notepad
- **Nama tampilan:** NiftyDock Notepad

NiftyDock adalah koleksi aplikasi praktis untuk berbagai kebutuhan. Notepad adalah aplikasi pertama dalam koleksi tersebut. NiftyDock nantinya dapat mencakup tools di luar dokumen, seperti Downloader. Aplikasi lain belum termasuk dalam ruang lingkup PRD ini.

## Ringkasan

NiftyDock Notepad adalah tempat membuat catatan Markdown yang bisa dibuka dan diedit lewat URL sederhana, misalnya `/infoloker`. Tidak perlu akun. Siapa pun yang memiliki URL dapat mengedit catatan, dan perubahan langsung tersinkron ke perangkat lain.

## Masalah

Berbagi teks antarperangkat seharusnya sesederhana membuka satu link. Pengguna membutuhkan catatan yang cepat, bisa diedit bersama, dan mendukung Markdown tanpa harus selalu mengetik sintaks mentah.

## Pengguna utama

Orang yang ingin memindahkan atau berbagi teks dengan cepat melalui URL—misalnya catatan kerja, daftar, instruksi, atau potongan teks.

## Tujuan produk

- Membuat dan membuka catatan dari perangkat mana pun lewat URL.
- Mengedit Markdown dengan tampilan yang mudah dibaca.
- Menampilkan perubahan terbaru tanpa perlu memuat ulang halaman.
- Mengunci catatan dengan password opsional.
- Memperkenalkan Notepad sebagai bagian pertama dari koleksi NiftyDock.

## Ruang lingkup MVP

### 1. Catatan berbasis URL

- Pengguna dapat membuat catatan tanpa akun.
- Setiap catatan memiliki URL unik dan dapat menggunakan slug pilihan, misalnya `/infoloker`.
- Jika slug sudah digunakan, sistem memberi tahu pengguna dan tidak menimpa catatan lama.
- Catatan tanpa password tidak ditampilkan dalam direktori atau pencarian publik.
- Notepad memiliki identitas visual NiftyDock, tetapi belum perlu membuat portal atau launcher untuk aplikasi NiftyDock lainnya.

### 2. Akses dan password

- Siapa pun yang memiliki URL dapat membaca dan mengedit catatan.
- Password bersifat opsional dan berlaku untuk akses ke isi catatan.
- Catatan berpassword meminta password sebelum dapat dibaca atau diedit.
- Siapa pun yang sudah memiliki akses dapat mengedit isi dan mengelola password catatan.
- Tidak ada pemulihan password berbasis akun. Jika password hilang, akses tidak dapat dipulihkan melalui identitas pengguna.

### 3. Editor Markdown

Catatan memiliki dua mode:

- **Editor:** teks tampak terformat saat ditulis, seperti Live Preview di Obsidian. Sintaks Markdown mentah tidak ditampilkan sebagai tampilan utama. Toolbar membantu menyisipkan format.
- **Preview:** menampilkan hasil akhir catatan tanpa kontrol pengeditan.

Format awal mencakup heading, tebal, miring, daftar, tautan, kutipan, blok kode, tabel, dan checklist.

### 4. Simpan otomatis dan sinkronisasi langsung

- Perubahan disimpan otomatis.
- Catatan yang terbuka di perangkat lain menerima perubahan tanpa refresh.
- Jika beberapa orang mengedit bersamaan, perubahan tidak boleh hilang karena editan lain tersimpan lebih dulu.
- Antarmuka menunjukkan status penyimpanan dan memberi tahu jika perubahan belum tersimpan karena koneksi terputus.

### 5. Pengalaman lintas perangkat

- Editor berfungsi di desktop dan ponsel.
- URL dan kontrol editor mudah digunakan di layar kecil.
- Pengguna dapat menyalin URL catatan dengan mudah.

## Kriteria penerimaan

1. Pengguna dapat membuat catatan tanpa mendaftar atau masuk.
2. Catatan dapat dibuka melalui slug pilihan jika slug tersebut tersedia.
3. Pengguna dengan URL dapat membaca dan mengedit catatan tanpa password jika catatan tidak dikunci.
4. Setelah password dipasang, password benar diperlukan untuk membaca dan mengedit catatan.
5. Perubahan di satu perangkat muncul di perangkat lain tanpa refresh.
6. Editor menampilkan teks terformat saat pengguna mengedit; Preview menampilkan hasil akhir saja.
7. Slug yang sudah digunakan tidak dapat menimpa isi catatan yang ada.
8. Identitas produk menampilkan NiftyDock dan Notepad dengan jelas.

## Bukan bagian MVP

- Akun dan profil pengguna.
- Aplikasi NiftyDock lainnya, termasuk Downloader.
- Portal untuk meluncurkan atau mengelola seluruh aplikasi NiftyDock.
- Izin berbeda untuk setiap kolaborator.
- Daftar atau pencarian catatan publik.
- Lampiran file dan unggahan gambar.
- Riwayat versi lengkap.
- Pengeditan offline.

## Asumsi untuk ditinjau

- Catatan tidak kedaluwarsa otomatis.
- Siapa pun yang memiliki URL tanpa password memiliki hak yang sama untuk mengedit.
- Siapa pun yang memiliki akses ke catatan dapat mengubah password-nya.
- Catatan tidak memiliki pemilik khusus karena MVP tidak menggunakan akun.
- Penghapusan catatan dan kebijakan penyimpanan perlu diputuskan sebelum implementasi.
- Notepad menjadi aplikasi pertama di NiftyDock, tetapi aplikasi lain belum perlu dibuat atau diintegrasikan dalam MVP.