# OPERIS v6.3.63 Progress UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PowerShell 5.1-compatible progress/log UI around the existing OPERIS installer/uninstaller without changing engine semantics.

**Architecture:** `operation-host.ps1` is the engine adapter and evidence source; `progress-ui.ps1` is WinForms presentation only. Inno Setup routes install/update/repair/refresh/uninstall through the UI while preserving real child exit codes. Silent CI uses the same host with no window.

**Tech Stack:** Inno Setup 6, Windows PowerShell 5.1, WinForms, GitHub Actions windows-2022.

**Spec:** `docs/superpowers/specs/2026-09-16-operis-progress-ui-design.md`

## Global Constraints

- Do not change `main`.
- Preserve baseline engine behavior from `e88226ab09ec2e694e90c20d4d2cd1940d99f100`.
- No product code before RED tests.
- No runtime PASS from static checks.
- Never log raw secrets.
- Keep real child exit codes through host/UI/Setup EXE.
- Interactive failure must remain visible; silent automation must not hang.
- Production cutover is out of scope.

---

### Task 1: RED contracts and runtime test harness

**Files:**
- Create: `tests/windows/progress-ui-contract.ps1`
- Create: `tests/windows/progress-ui-runtime.ps1`
- Modify: `.github/workflows/operis-ci.yml`
- Modify later in GREEN: `.github/workflows/operis-release-finalization.yml`

**Interfaces:**
- Consumes: baseline Inno/PowerShell installer files.
- Produces: failing contract requiring `windows/operation-host.ps1` and `windows/progress-ui.ps1`.

- [ ] Add contract assertions for host/UI/Inno integration and secret masking.
- [ ] Add process-level runtime matrix for success, failure, cancellation, masking, monotonic progress, session correlation and WinForms controls.
- [ ] Wire tests into Final CI.
- [ ] Verify Progress UI job fails because production files are missing.

### Task 2: GREEN operation host

**Files:**
- Create: `windows/operation-host.ps1`

**Interfaces:**
- Consumes: `setup-launch.ps1` or `uninstall-enterprise.ps1` as child engine.
- Produces: JSONL events, masked session log, cancellation checkpoint, exact child exit code.

- [ ] Implement operation/session initialization and AUTO operation display resolution.
- [ ] Implement secret-redaction pipeline including URL credentials and private-key blocks.
- [ ] Launch child with redirected stdout/stderr and poll both files while running.
- [ ] Map known engine step messages to deterministic monotonic progress.
- [ ] Publish rollback/error/final result events.
- [ ] Delete raw temporary stdout/stderr in `finally`.
- [ ] Exit with exact child code; use 1223 only for safe pre-engine cancellation.

### Task 3: GREEN PowerShell 5.1 WinForms UI

**Files:**
- Create: `windows/progress-ui.ps1`

**Interfaces:**
- Consumes: operation-host JSONL/session log.
- Produces: interactive progress form or silent passthrough; process exit equals operation-host exit.

- [ ] Build WinForms controls for operation/current-target version/step/progress/elapsed/result.
- [ ] Add read-only multiline selectable log with shortcuts enabled.
- [ ] Add Copy All, Open Log Folder, Show/Hide Details, Cancel, Open Application and Finish/Close controls.
- [ ] Disable Cancel once events report `cancelSafe=false`.
- [ ] Keep failure form open; silent mode exits immediately.
- [ ] Implement `-ProbeOnly` STA runtime probe for control/copy/button verification.

### Task 4: Route Inno install and uninstall through UI

**Files:**
- Modify: `installer/OPERIS.iss`

**Interfaces:**
- Consumes: `windows/progress-ui.ps1`.
- Produces: interactive UI for INSTALL/UPDATE/REPAIR/REFRESH/UNINSTALL and silent automation compatibility.

- [ ] Replace direct setup-launch execution with progress-ui invocation.
- [ ] Pass payload root, explicit maintenance action and silent state.
- [ ] Route uninstaller engine through progress-ui.
- [ ] Add custom `/OPERISPROGRESSUI` handoff so interactive maintenance UNINSTALL remains visible even though child uninstaller itself is very-silent.
- [ ] Preserve `InstallerExitCode` and `GetCustomSetupExitCode` semantics.

### Task 5: GREEN tests and release evidence

**Files:**
- Modify: `.github/workflows/operis-release-finalization.yml`
- Modify tests/workflows only if a verified failure requires a minimum fix.

**Interfaces:**
- Consumes: production implementation from Tasks 2-4.
- Produces: `progress-ui-evidence.json` and all-green Progress UI contracts.

- [ ] Run `progress-ui-contract.ps1` on Windows PowerShell 5.1.
- [ ] Run `progress-ui-runtime.ps1` in STA mode and write evidence JSON.
- [ ] Build real `OPERIS_Setup_v6.3.63.exe`.
- [ ] Run existing lifecycle maintenance/persistence/forced rollback against real EXE.
- [ ] Package EXE, SHA256, lifecycle JSON and progress UI evidence JSON.

### Task 6: Full same-HEAD regression gate

**Files:** none unless a real failing step proves a minimum fix is required.

**Interfaces:**
- Consumes: new candidate HEAD.
- Produces: final release decision.

- [ ] Verify Final CI SUCCESS.
- [ ] Verify PostgreSQL Candidate Validation SUCCESS.
- [ ] Verify Windows PostgreSQL Rehearsal Safety SUCCESS.
- [ ] Verify PostgreSQL Backup Restore Validation SUCCESS.
- [ ] Verify WTD46 Cloud Validation SUCCESS.
- [ ] Verify Release Finalization SUCCESS.
- [ ] Verify final artifact file, size, SHA256, manifest match, lifecycle JSON and progress UI evidence.
- [ ] Report any manual/real-previous-EXE/reboot/self-hosted items as NOT_RUN rather than PASS.
