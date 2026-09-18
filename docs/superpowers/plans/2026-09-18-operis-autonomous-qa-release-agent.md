# OPERIS Autonomous QA / Release Agent Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OPERIS için açık hataları kanıtla yakalayan, minimum düzeltme sonrası aynı testi yeniden çalıştıran, kanıt üretmeden PASS vermeyen kalıcı QA/release agent altyapısı kurmak.

**Architecture:** Mevcut GitHub Actions, Windows PowerShell testleri, Playwright ve AI handoff mekanizması korunur. Yeni agent orchestrator cloud-safe gate'leri deterministik olarak çalıştırır, JSON/Markdown kanıt üretir ve başarısızlıkta mevcut `generate-ai-handoff.cjs` çıktısını zenginleştirir; gerçek Windows/staging maddeleri yalnız self-hosted/authorized runner varsa çalışır, aksi halde BLOCKED olarak kaydedilir.

**Tech Stack:** Node.js 24.21.0, PowerShell 5.1/7, GitHub Actions, Playwright, Prisma/PostgreSQL, existing OPERIS Windows installer tests.

## Global Constraints

- Production target Windows Server 2022+.
- PASS yalnız gerçek test/evidence ile verilir; erişilemeyen gerçek ortam testleri BLOCKED/PENDING kalır.
- Aynı HEAD üzerindeki uygulanabilir PASS testleri gereksiz tekrarlanmaz.
- Source değişirse yalnız etkilenen gate seti yeniden çalıştırılır.
- PostgreSQL production verisine unsafe db push uygulanmaz.
- Firewall/idempotency, backup/restore, UI/static artifacts, installer rollback ve user data protection zorunlu gate'lerdir.
- Agent hata bulduğunda önce kesin FAIL'i üretir, kök nedeni kanıtlar, minimum düzeltmeyi uygular ve aynı hedef testi GREEN olmadan sonraki hataya geçmez.
- Gerçek TESTSERVER/staging/AD/SMTP/Graph/MSSQL/SNMP kontrolleri yetki/runner yoksa sahte PASS yapılmaz.

---

### Task 1: Runtime stop / repair yarışını kapat

**Files:**
- Modify: `windows/install-enterprise.ps1`
- Modify: `tests/windows/installer-runtime-ownership.ps1`
- Test: `tests/windows/install-contract-smoke.ps1`

**Interfaces:**
- Consumes: `Stop-OperisRuntime`, scheduled task `OperisEnterpriseServer`, configured TCP port.
- Produces: bounded runtime shutdown; foreign listeners are never killed; managed task is removed only after port release is verified.

- [ ] **Step 1: Add focused failing coverage**
  - Foreign listener varsa managed task state korunmalı.
  - Owned listener durdurulduktan sonra port release bounded wait ile doğrulanmalı.
  - Port kapanmazsa task silinmeden FAIL dönmeli.

- [ ] **Step 2: Verify relevant failure**
  - Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/windows/installer-runtime-ownership.ps1`
  - Expected before fix: shutdown-order/release assertion FAIL or real repair `Runtime durdurulamadı` evidence.

- [ ] **Step 3: Implement minimum behavior**
  - Listener ownership preflight before task mutation.
  - Stop managed tasks, terminate only owned listeners.
  - Poll configured port for bounded timeout.
  - Unregister managed tasks only after port is empty.
  - On failure preserve task registration and emit exact owner/PID diagnostics.

- [ ] **Step 4: Verify focused pass**
  - Expected: foreign preservation + owned stop + port release assertions PASS.

- [ ] **Step 5: Run affected integration**
  - Run install contract + real canonical TESTSERVER REPAIR when new EXE is available.
  - Expected: exit 0, health 6.3.63, PostgreSQL connected, listener=1, task present, data hashes preserved.

### Task 2: Deterministic QA agent orchestrator ve evidence ledger

**Files:**
- Create: `scripts/qa/operis-qa-agent.cjs`
- Create: `tests/ci/operis-qa-agent-contract.cjs`
- Modify: `tests/ci/generate-ai-handoff.cjs`

**Interfaces:**
- Consumes: repository commands, environment variables, existing tests/workflows.
- Produces: `operis-qa-agent.json`, `operis-qa-agent.md`, per-stage stdout/stderr, terminal status PASS/FAIL/BLOCKED.

- [ ] **Step 1: Add failing contract test**
  - Required stages: source, build, frontend-artifact, settings/static, Windows contracts, security audit, AI handoff.
  - Status enum must be PASS/FAIL/BLOCKED/NOT_APPLICABLE.
  - First FAIL stops later mutation-capable stages but still writes evidence.

- [ ] **Step 2: Verify relevant failure**
  - Run: `node tests/ci/operis-qa-agent-contract.cjs`
  - Expected: orchestrator/evidence schema missing.

- [ ] **Step 3: Implement orchestrator**
  - Execute cloud-safe stages sequentially.
  - Capture command, exit code, start/end timestamps, stdout/stderr tail.
  - Generate checkpoint-compatible JSON + Markdown.
  - On FAIL call existing AI handoff generator and include failing stage/evidence path.

- [ ] **Step 4: Verify focused pass**
  - Run contract test and dry-run mode.
  - Expected: deterministic PASS/BLOCKED report with no invented results.

### Task 3: GitHub autonomous QA workflow

**Files:**
- Create: `.github/workflows/operis-autonomous-qa-agent.yml`
- Modify: `.github/workflows/operis-wtd46-ci.yml` only if needed to consume shared evidence.

**Interfaces:**
- Consumes: `scripts/qa/operis-qa-agent.cjs`.
- Produces: GitHub artifact `operis-qa-agent-evidence-<sha>`; optional self-hosted real-Windows job only when explicitly enabled.

- [ ] **Step 1: Add workflow contract test**
  - Node 24.21.0.
  - Windows 2022 cloud-safe agent job.
  - Always upload evidence.
  - Optional real Windows job gated by workflow input; no implicit production cutover.

- [ ] **Step 2: Verify contract failure before workflow exists**
  - Run a structural Node contract test.

- [ ] **Step 3: Implement workflow**
  - push/manual triggers on candidate branch.
  - no production cutover.
  - failure still uploads diagnostics/evidence.
  - optional `self-hosted, windows, operis-staging` job is disabled by default.

- [ ] **Step 4: Verify workflow**
  - Parse YAML structurally via contract checks and observe GitHub run result on new HEAD.

### Task 4: Release gate summary and persistent continuation checkpoint

**Files:**
- Create: `tests/ci/build-final-release-gate.cjs`
- Test: `tests/ci/final-release-gate-contract.cjs`

**Interfaces:**
- Consumes: agent evidence plus known real-environment evidence files.
- Produces: single `FINAL_RELEASE_GATE.json` with mandatory item status/reason/evidence.

- [ ] **Step 1: Add failing contract**
  - Mandatory items cannot default to PASS.
  - Missing evidence => PENDING/BLOCKED.
  - Production cutover is NOT_APPLICABLE unless explicitly requested.

- [ ] **Step 2: Implement gate builder**
  - Merge deterministic CI evidence, installer lifecycle evidence and real-environment evidence.
  - Preserve prior applicable PASS by source SHA/evidence identity.
  - Output exactly one consolidated gate.

- [ ] **Step 3: Verify**
  - Current expected state must not be overall PASS while reboot, real SQLite staging or external integrations lack evidence.

## Unresolved externally observable decisions

- Real self-hosted Windows runner labels are not currently proven. Default workflow therefore leaves the real-environment job disabled and reports BLOCKED until a matching runner is configured.
- Authenticode signing is currently `NotSigned`; no existing mandatory signing requirement was found in the current release workflow, so the agent records it without converting it into a release FAIL.
