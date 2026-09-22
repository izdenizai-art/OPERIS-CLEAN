# OPERIS Codebase Map ve Degisiklik Kontrol Sozlesmesi

> Bu dosya OPERIS icin GitHub tabanli kalici codebase haritasidir.
> Her kaynak degisikliginden ONCE bu dosya ve hedef branch'in guncel HEAD'i kontrol edilir.
> Kanitlanmamis is PASS/TAMAMLANDI olarak raporlanmaz.

## 1. Kaynak-of-truth

- Repository: `izdenizai-art/OPERIS-CLEAN`
- Varsayilan branch: `main`
- Aktif candidate/release calisma branch'i: `postgresql-candidate-validation`
- Haritalanan kaynak baseline HEAD: `1a991332adca23b940f5499d05c6a51391b63a72`
- Urun surumu: `6.3.63`
- Uretim hedefi: Windows Server / Windows tabanli kurulum ve calisma modeli.
- GitHub candidate branch kaynak kodu, degisiklik icin birinci kaynaktir.
- TESTSERVER yalniz canli calisma, entegrasyon ve kurulum kaniti icin kullanilir.
- Eski sohbet, handoff veya onceki PASS bilgisi tek basina guncel kanit sayilmaz.

## 2. Kanit durumlari

Her kontrol yalniz asagidaki durumlardan biriyle raporlanir:

- `PASS`: Ilgili komut/test gercekten calisti, beklenen sonuc alindi ve gerekli exit/status kaniti var.
- `FAIL`: Test/komut calisti ve basarisiz oldu.
- `BLOCKED`: Testin calismasi dis baglanti, cihaz, secret, runner veya baska bir engel nedeniyle mumkun olmadi.
- `NOT_RUN`: Henuz calistirilmadi.
- `UNVERIFIED`: Bir iddia/sonuc var ancak bu HEAD veya bu ortam icin yeniden kanitlanmadi.

`PASS`, `tamamlandi`, `duzeldi`, `bitti` ifadeleri gercek kanit olmadan kullanilmaz.

## 3. Uygulama mimarisi

### Frontend

- `src/main.tsx`: React bootstrap, service-worker baslatma, splash ve tema baslangici.
- `src/App.tsx`: Ana uygulama shell'i; ekranlar lazy-load edilir.
- `src/lib/api.ts`: Frontend API istemcisi ve API tipleri.
- `src/lib/types.ts`: Frontend domain/type sozlesmeleri.
- `src/components/SettingsPanel.tsx`: Ayarlar; SMTP, Graph, backup, domain, audit, session ve performans yuzeyleri.
- `src/components/HelpDeskPanel.tsx`: Help Desk kullanici/ticket/admin arayuzu.
- `src/components/AssetManagement.tsx`: Demirbas, satis, etiket, zimmet, transfer, sayim, MSSQL entegrasyonlari.
- `src/components/NetworkMonitorPanel.tsx`: Network/SNMP/topoloji arayuzu.
- `vite.config.ts`: Frontend build ciktisi `server/public`; dev `/api` proxy -> `localhost:3001`.

Frontend build zinciri:
`src/* -> vite build -> server/public/*`

### Backend

- `server/src/index.ts`: Express uygulama girisi, API route wiring, scheduler baslatmalari, health ve release bilgisi.
- `server/src/db.ts`: Prisma singleton; yalniz PostgreSQL URL kabul eder.
- `server/prisma/schema.prisma`: Ana veri modeli ve PostgreSQL datasource.
- `server/src/auth.ts`: JWT/session/public-user ve yetki baglantilari.
- `server/src/login-security.ts`: Login block/strike/IP-MAC guvenlik akisi.
- `server/src/permissions.ts`: Section ve asset permission modeli.
- `server/src/branch-access.ts`: Sube bazli erisim ve permission context.
- `server/src/branch-routes.ts`: Sube yonetim endpointleri.
- `server/src/helpdesk.ts`: Help Desk backend, ticket ve attachment akisi.
- `server/src/routes/assets.ts`: Demirbas ve dis MSSQL baglantilari API rotalari.
- `server/src/external-mssql.ts`: MSSQL connection pool ve read/test islemleri.
- `server/src/tbldemirmas-sync.ts`: Demirbas MSSQL senkron akisi.
- `server/src/domain-sync.ts`: AD/DC LDAP baglanti, kullanici senkronu ve login-time AD kontrolu.
- `server/src/services/windows-query.ts`: Windows/AD/network tanilama sorgulari.
- `server/src/mailer.ts`: SMTP ayar/test/gonderim.
- `server/src/graph-mailer.ts`: Microsoft Graph mail ayar/token/gonderim.
- `server/src/network-monitor.ts`: Ping/service/SNMP network izleme.
- `server/src/reminders.ts`: E-posta reminder scheduler.
- `server/src/crypto.ts`: AES-256-GCM uygulama secret sifreleme.
- `server/src/license.ts`: Lisans ve trusted-time kontrolu.
- `server/src/system-performance.ts`: API/runtime performans olcumleri.

Backend build zinciri:
`server/src/*.ts -> tsc -> server/dist/*.js -> node server/dist/index.js`

### Veritabani

- Provider: PostgreSQL.
- Prisma schema: `server/prisma/schema.prisma`.
- Runtime guard: `server/src/db.ts` PostgreSQL disi `DATABASE_URL` degerini reddeder.
- Kullanici, session, ayarlar, Help Desk, demirbas, network, audit ve sube verileri Prisma modellerindedir.
- SMTP/Graph/AD secret alanlari DB'de encrypted alanlarda tutulur; plaintext secret repoya/loga yazilmaz.

## 4. Dis entegrasyonlar

### AD / Domain Controller

- Ana kod: `server/src/domain-sync.ts`
- Yardimci Windows sorgulari: `server/src/services/windows-query.ts`
- Ayarlar: Prisma `AppSettings` domain alanlari.
- PowerShell 5.1 child stdout, Node tarafinda UTF-8 okunmadan once explicit UTF-8 output encoding'e zorlanir.
- Tek-kullanici LDAP sorgusu ve toplu sync ayri akislar olarak kontrol edilmelidir.
- AD degisikliginde en az: connection test + sync sonucu + bozuk Unicode taramasi kontrol edilir.

### SMTP

- Kod: `server/src/mailer.ts`
- Ayarlar: `AppSettings.smtp*`
- Degisiklikte mevcut calisan ayarlar korunur; secret degeri rapora/loga yazilmaz.

### Microsoft Graph

- Kod: `server/src/graph-mailer.ts`
- Ayarlar: `AppSettings.graph*`
- Client secret encrypted saklanir.

### MSSQL

- Kod: `server/src/external-mssql.ts`, `server/src/routes/assets.ts`, `server/src/tbldemirmas-sync.ts`
- Baglanti tanimlari: Prisma `AssetExternalConnection`
- MSSQL degisikliginde TCP acikligi tek basina PASS sayilmaz; uygulama seviyesinde read/test kaniti gerekir.

### SNMP / Network

- Kod: `server/src/network-monitor.ts`
- Frontend: `src/components/NetworkMonitorPanel.tsx`
- SNMP secret/community degerleri loglarda acik edilmez.

## 5. Windows installer ve runtime

- `installer/OPERIS.iss`: Inno Setup ana EXE paketi; product `OPERIS Enterprise`, version `6.3.63`.
- `windows/progress-ui.ps1`: Interaktif kurulum/repair/update/uninstall progress UI.
- `windows/operation-host.ps1`: INSTALL/UPDATE/REPAIR/REFRESH/UNINSTALL orchestration ve event/log kontrolu.
- `windows/setup-launch.ps1`: Setup launch katmani.
- `windows/install-enterprise.ps1`: Ana Windows enterprise kurulum motoru.
- `windows/uninstall-enterprise.ps1`: Kaldirma ve veri koruma akisi.
- `windows/postgresql-provision.ps1`: Windows PostgreSQL provisioning.
- `windows/postgresql-backup.ps1`: pg_dump + SHA256 manifest backup.
- `windows/postgresql-restore.ps1` / restore-test scriptleri: restore/validation akislarinin kaynagi.
- Installer bundled PostgreSQL kaynagi `vendor/postgresql/` altindan paketlenir.

Not: TESTSERVER kurulu payload'da `windows/server-runner.ps1` goruldu, ancak candidate branch GitHub fetch kontrolunde bu yol `NOT_FOUND` dondu. Bu dosya GitHub codebase parcasi kabul edilmez; kaynak/installer tarafinda ayrica kanitlanmadan uzerinde degisiklik yapilmaz.

## 6. Test ve CI haritasi

GitHub'da dogrulanan staging workflow'lari:

- `.github/workflows/operis-integration-smoke.yml`
  - self-hosted Windows `operis-staging`
  - AD/DC, SMTP, Graph, MSSQL, SNMP secilebilir smoke.
- `.github/workflows/operis-load-test.yml`
  - k6 capacity ladder.
  - modlar: `normal`, `helpdesk`, `mixed`.
  - 75/100/150/300/500/750 active user secenekleri.
- `.github/workflows/operis-staging-sqlite-postgresql-rehearsal.yml`
  - gercek SQLite kopyasi -> izole staging PostgreSQL rehearsal.
  - source hash ve staging safety gate icerir.

Test kaynaklari:

- `tests/integration/operis-integration-smoke.ps1`
- `tests/load/operis-capacity.js`

Bir workflow'un dosyada bulunmasi veya gecmiste PASS olmasi, yeni HEAD icin otomatik PASS anlamina gelmez.

## 7. Degisiklik etki matrisi

| Degisiklik | Oncelikle kontrol edilecek kaynaklar | Asgari dogrulama |
| --- | --- | --- |
| UI / metin / ekran | `src/App.tsx`, ilgili `src/components/*`, `src/lib/api.ts`, `src/lib/types.ts` | frontend build/typecheck + ilgili canli ekran |
| Auth / kullanici | `server/src/auth.ts`, `login-security.ts`, schema | server build + login/session davranisi |
| AD/DC | `domain-sync.ts`, `windows-query.ts`, User/AppSettings schema | server build + DC test + sync + Unicode veri kontrolu |
| SMTP | `mailer.ts`, SettingsPanel, AppSettings | server build + SMTP verify/test mail |
| Graph | `graph-mailer.ts`, SettingsPanel, AppSettings | server build + Graph test |
| Help Desk | `HelpDeskPanel.tsx`, `helpdesk.ts`, branch/permission kodu | build + ilgili Help Desk fonksiyon testi |
| MSSQL / demirbas | `AssetManagement.tsx`, `routes/assets.ts`, `external-mssql.ts`, sync modulleri | build + read-only MSSQL test + sync sonucu |
| Network / SNMP | `NetworkMonitorPanel.tsx`, `network-monitor.ts` | build + secilen ping/service/SNMP testi |
| Prisma/schema | `schema.prisma`, kullanan server modulleri | backup + prisma generate/migrate plan + build + health/data-survival |
| Installer | `installer/OPERIS.iss`, `windows/*.ps1` | build EXE + SHA256 + hedef lifecycle testi + health + DB survival |
| PostgreSQL | `db.ts`, schema, `windows/postgresql-*.ps1` | backup/restore kaniti + health + provider=postgresql |
| CI/test | ilgili `.github/workflows/*`, `tests/*` | YAML/script syntax + gercek workflow sonucu |

## 8. Zorunlu degisiklik protokolu

Her OPERIS degisikliginde sira degistirilmez:

1. GitHub repo ve `postgresql-candidate-validation` branch'i yeniden acilir.
2. Guncel HEAD gercekten okunur; onceki sohbetten SHA varsayilmaz.
3. Bu `OPERIS_CODEBASE_MAP.md` dosyasi okunur.
4. Degisecek dosyalar current HEAD'den fetch edilir; mevcut blob SHA kaydedilir.
5. Etkilenen modul ve bagimliliklar etki matrisinden belirlenir.
6. TESTSERVER ile GitHub kaynak farki varsa fark acikca raporlanir; sessizce birlestirilmez.
7. Veri/DB riski varsa degisiklikten once backup alinir ve backup SHA256 kanitlanir.
8. Minimum gerekli source degisikligi yapilir. Ilgisiz refactor yapilmaz.
9. Commit/push sonrasi branch HEAD tekrar dogrulanir.
10. Source degistiyse eski workflow sonucu yeni HEAD icin PASS sayilmaz.
11. Yalniz etkilenmis testler + ortak katman degismisse gerekli regression calistirilir.
12. Installer degismisse gercek EXE yeniden uretilmeden eski EXE yeni source'u temsil ediyor denmez.
13. Canli test gerekiyorsa TESTSERVER sonuc, exit code, health ve veri-survival kaniti okunur.
14. Kanit yoksa durum `NOT_RUN`, `BLOCKED` veya `UNVERIFIED` olarak birakilir.
15. Mimari, dosya yolu veya sorumluluk degistiyse bu harita ayni degisiklik zincirinde guncellenir.

## 9. Yasaklar / guvenlik kurallari

- Yapilmayan isi yapilmis gibi raporlama.
- Tahmine dayali PASS verme.
- Eski HEAD testini yeni HEAD sonucu gibi kullanma.
- Secret/parola/token/community degerini loglama veya raporlama.
- Canli DB'de backup kaniti olmadan riskli schema/data islemi yapma.
- Installer source degisikken eski `.exe` dosyasini final artifact olarak sunma.
- Sadece TCP port acik diye AD/MSSQL/SMTP/SNMP uygulama entegrasyonunu PASS sayma.
- TESTSERVER'daki kurulu dosyayi GitHub source ile ayni varsayma.
- Hata veya blocker varken onu gizleyip genel sonucu PASS yapma.

## 10. Degisiklik rapor formati

Her kaynak degisikligi sonunda en az su kanit yazilir:

- Pre-change HEAD:
- Post-change HEAD:
- Degisen dosyalar:
- Neden:
- Calistirilan test/komut:
- Exit/status:
- Health:
- DB provider/connectivity:
- Veri backup/survival (uygunsa):
- CI/workflow sonucu (uygunsa):
- Artifact + SHA256 (installer/release ise):
- Acik kalan: `NONE` veya gercek blocker listesi.

Bu alanlardan calistirilmayanlar `NOT_RUN` yazilir; bos birakilip varsayilmaz.
