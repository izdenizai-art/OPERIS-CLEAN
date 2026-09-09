# OPERİS PostgreSQL Kontrollü Geçiş Kapıları

Bu dosya WTD53 PostgreSQL adayının güvenli geçiş sırasıdır. Hiçbir kapı atlanmaz.

## Gate 0 — Kaynak korunması
- Canlı OPERİS yazmaları geçiş anında durdurulur veya bakım moduna alınır.
- `backup-sqlite-before-postgresql.mjs` çalıştırılır.
- SQLite `PRAGMA integrity_check = ok` olmalıdır.
- Yedek DB SHA256 ve tablo satır sayıları manifestte saklanır.
- Uygulama kaynak kodu ayrıca ZIP snapshot olarak saklanır.
- SQLite rollback şeması `schema.sqlite.prisma` korunur.

## Gate 1 — PostgreSQL boş şema
- Yalnız `schema.postgresql.prisma` kullanılarak boş staging DB hazırlanır.
- `prisma validate`, `prisma generate`, `prisma db push` başarılı olmalıdır.
- Backend TypeScript build başarılı olmalıdır.
- Uygulama PostgreSQL ile `/api/health` yanıtı vermelidir.

## Gate 2 — Veri taşıma provası
- Üretim kopyası üzerinde, üretim olmayan PostgreSQL staging DB'ye pgloader ile veri taşınır.
- pgloader `quote identifiers` kullanır; Prisma tablo/kolon casing'i korunur.
- Kaynak ve hedef tüm tablo satır sayıları eşit olmalıdır.
- FK/unique/index kontrolleri yapılır.
- Balamir, kullanıcılar, şubeler, Help Desk, mesajlar, audit, Demirbaş ayarları örneklemle doğrulanır.

## Gate 3 — Uygulama regresyonu
- Login ve Balamir korumaları.
- Şube ve şube bazlı yetki izolasyonu.
- Help Desk açma/yanıtlama/atama/kapatma.
- Mesaj ve duyuru.
- Demirbaş MSSQL entegrasyonu.
- AD/DC senkronizasyonu ve offline kullanıcı cache davranışı.
- Backup/restore sağlayıcı davranışı.
- Windows + Linux CI.

## Gate 4 — 100 kullanıcı
- En az 100 benzersiz test hesabı.
- normal / helpdesk / mixed ayrı koşular.
- HTTP 5xx < %1.
- Functional failure < %1.
- p95/p99 eşikleri geçmeli.
- PostgreSQL deadlock/pool/timeout logları incelenmeli.

## Gate 5 — Cutover
- Yeni final SQLite yedeği alınır.
- Final SQLite ve staging PostgreSQL satır sayıları kaydedilir.
- PostgreSQL production DB hazırlanır.
- Veri final kez taşınır.
- Satır sayıları ve kritik örnek kayıtlar yeniden doğrulanır.
- `DATABASE_URL` yalnız bundan sonra PostgreSQL'e çevrilir.
- Servis başlatılır ve sağlık/login/regresyon smoke yapılır.

## Gate 6 — Rollback
Aşağıdakilerden biri olursa cutover geri alınır:
- veri sayısı uyuşmazlığı,
- login başarısızlığı,
- kritik modül 5xx,
- migration constraint hatası,
- beklenmeyen veri kaybı,
- performans kabul kriterinin ciddi ihlali.

Rollback:
1. OPERİS servisi durdurulur.
2. PostgreSQL URL kaldırılır.
3. `schema.sqlite.prisma` aktif şema yapılır.
4. doğrulanmış SQLite backup geri yüklenir.
5. Prisma client SQLite için yeniden üretilir.
6. uygulama başlatılır.
7. `/api/health`, login, tablo sayıları ve kritik modüller doğrulanır.
