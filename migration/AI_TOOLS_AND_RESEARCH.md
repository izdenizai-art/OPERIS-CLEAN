# OPERİS PostgreSQL geçişinde AI ve otomasyon araçları — WTD54

## Projenin gerçek sürüm kısıtı
OPERİS server şu anda Prisma 6.x kullanıyor. Prisma'nın güncel Agent Skills paketleri ağırlıklı olarak Prisma 7/8 içindir.
Bu yüzden Prisma Skills'i körlemesine projeye uygulatmak doğru değildir. WTD54'te:
- Prisma 6 CLI/dokümantasyonu migration komutları için kaynak kabul edilir.
- Prisma MCP'nin `search_prisma_documentation` gibi güncel doküman arama yetenekleri yararlı olabilir.
- Prisma 7/8 upgrade ayrı proje olmalıdır; PostgreSQL provider geçişiyle aynı anda yapılmamalıdır.

## Yararlı araçlar

### 1. GitHub Actions + PostgreSQL service container
Birincil dış doğrulama ortamıdır.
WTD54 workflow'u gerçek PostgreSQL 16 service container ile:
- Prisma validate,
- Prisma Client generate,
- initial migration SQL üretimi,
- migration SQL'in ikinci boş PostgreSQL DB'ye uygulanması,
- runtime DB oluşturma,
- backend/frontend build,
- OPERİS startup ve database-aware health,
- SQLite -> PostgreSQL pgloader smoke,
- satır sayısı,
- primary-key setleri,
- FK constraint validation
yapar.

### 2. Prisma Migrate / migrate diff
Prisma provider migration history provider'a özgüdür.
SQLite migration geçmişi PostgreSQL'e doğrudan taşınmaz.
WTD54 initial PostgreSQL migration SQL'i `migrate diff --from-empty --to-schema ... --script` ile üretip artifact olarak saklar.

### 3. pgloader
Yalnız staging veri taşıma provasının aracıdır.
Target schema Prisma tarafından önceden hazırlanır.
`create no tables` + `quote identifiers` kullanılır.
`disable triggers` kaldırıldı; production DB'de gereksiz superuser bağımlılığı oluşturulmuyor.
Migration sonrasında row-count, PK-set ve FK validation zorunludur.

### 4. pg_dump / pg_restore
PostgreSQL backup/restore standardıdır.
WTD54 custom-format `pg_dump` kullanır.
Password command line URL içinde geçirilmez; `PGPASSWORD` geçici environment variable ile aktarılır.
Backup SHA256 doğrulanmadan restore edilmez.

### 5. Prisma MCP Server
ChatGPT, Codex, Cursor, Claude ve diğer MCP istemcilerine bağlanabilir.
Prisma workspace yönetimi ve resmi doküman araması için yararlıdır.
OPERİS self-hosted PostgreSQL cutover'ının otomatik doğruluk kaynağı değildir.
Production credentials verilmeden staging/review amaçlı kullanılmalıdır.

### 6. Neon Migration Assistant / Upgrade Assessment
Hosted PostgreSQL seçilirse yardımcıdır.
WTD54 self-hosted PostgreSQL tasarımının zorunlu parçası değildir.

## Yapılmayacaklar
- PostgreSQL provider değişimi ile Prisma major upgrade aynı anda yapılmayacak.
- Canlı SQLite backup alınmadan cutover yok.
- pgloader sonucu yalnız "komut başarılı" diye kabul edilmeyecek.
- Tek kullanıcı ile 100 VU gerçek 100 kullanıcı diye kabul edilmeyecek.
- AI aracı production DB'ye gözetimsiz write/cutover yapmayacak.
