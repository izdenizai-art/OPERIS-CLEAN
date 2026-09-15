# OPERIS v6.3.63 Progress UI Design

## Goal

Add a visible, copyable and failure-transparent progress UI to INSTALL, UPDATE, REPAIR, REFRESH/REINSTALL and UNINSTALL without changing the existing installer engine semantics or the regression-locked PostgreSQL/data/network/rollback behavior.

## Baseline

- Repository: `izdenizai-art/OPERIS-CLEAN`
- Branch: `postgresql-candidate-validation`
- Baseline source SHA before this feature: `e88226ab09ec2e694e90c20d4d2cd1940d99f100`
- Baseline six required workflows: SUCCESS on that SHA.
- Baseline evidence is historical only. Any source change requires the six gates to rerun on the new HEAD.

## Architecture

The existing `windows/install-enterprise.ps1`, PostgreSQL provisioning, rollback, backup, network-binding and uninstall semantics remain authoritative. A new `windows/operation-host.ps1` acts as an orchestration adapter around the existing engine. It launches the real engine as a child process, captures stdout/stderr, masks sensitive values, writes a per-operation log and JSONL progress events, preserves the real child exit code and exposes cancellation only before the unsafe engine phase starts.

A new `windows/progress-ui.ps1` is presentation-only. It starts `operation-host.ps1`, tails the JSONL events and session log, renders the operation/version/step/progress/elapsed/result fields, and offers selectable details plus Copy All, Open Log Folder, Show/Hide Details and safe Cancel controls. In silent automation it renders no window but still uses the same operation host, logging, masking and exit-code path.

`installer/OPERIS.iss` invokes the progress UI instead of directly invoking `setup-launch.ps1`. The real setup engine remains `setup-launch.ps1 -> install-enterprise.ps1`. Uninstall is routed through the same UI/operation-host layer while `uninstall-enterprise.ps1` remains the actual uninstall engine.

## Session and evidence contract

Each operation has one GUID session ID. Files live under `%ProgramData%\Operis\Logs`:

- `Operation-<session>.log`
- `Operation-<session>.events.jsonl`
- `Operation-<session>.cancel`

Each JSONL event includes at least:

- `timestamp`
- `sessionId`
- `operationType`
- `currentVersion`
- `targetVersion`
- `step`
- `progress`
- `lastSuccessfulStep`
- `status`
- `message`
- `exitCode`
- `rollbackStatus`
- `rollbackHealth`
- `cancelSafe`
- `logPath`

Progress is deterministic and monotonic. It never decreases. Success finishes at 100. Failure keeps the last known progress and records the real child exit code.

## Operation type resolution

Explicit REPAIR, REFRESH and UNINSTALL values win. AUTO mode resolves from `%ProgramData%\Operis\VERSION.txt` and install state:

- no existing install -> INSTALL
- installed version lower than target -> UPDATE
- installed version equal to target -> REPAIR
- install root exists without a usable version -> REPAIR

The adapter does not override the engine's own install-mode decision; it only determines display metadata.

## Secret masking

The operation host redacts before writing either UI/session log or structured message fields. It masks passwords, tokens, client secrets, credentials embedded in `DATABASE_URL` or PostgreSQL URLs, SMTP password, Graph secret, MSSQL password, SNMP secret/community, `credentials.dpapi` payload lines, and private-key blocks.

The raw redirected stdout/stderr files remain only in the session temp directory during processing and are deleted in `finally`.

## Failure and rollback visibility

The adapter recognizes rollback-related engine output and publishes visible rollback events. A non-zero child code remains non-zero through operation host, progress UI and outer Setup EXE. UI failure never turns the result into success.

Interactive failure UI remains open and shows step, error, exit code, rollback status/health and log path. Silent automation exits immediately with the same non-zero code.

## Cancellation

Cancellation is enabled only during the adapter preflight checkpoint before the child engine starts. Once the real engine is launched, `cancelSafe=false` and the UI disables Cancel. A pre-existing or UI-created cancel request during the safe checkpoint exits with Windows cancellation code 1223 and does not launch the engine.

## Testing

`tests/windows/progress-ui-contract.ps1` validates integration and non-regression contracts. `tests/windows/progress-ui-runtime.ps1` runs under Windows PowerShell 5.1 and uses fake child engines to validate real process/session/event/log/exit/masking behavior. It also runs the WinForms UI probe in STA mode to validate actual control construction, selectable log configuration, copy action and button wiring without requiring manual desktop interaction.

The existing real EXE lifecycle then validates that the new wrapper does not break clean install, same-version repair/refresh, update path, rollback, concurrency, PostgreSQL reuse, IP/config/backup survival, uninstall/reinstall, DB survival, startup task, scheduled backup and backup/restore.

## Release gate

After production implementation, the same new HEAD must pass:

1. OPERIS Final CI
2. OPERIS PostgreSQL Candidate Validation
3. OPERIS Windows PostgreSQL Rehearsal Safety
4. OPERIS PostgreSQL Backup Restore Validation
5. OPERIS WTD46 Cloud Validation
6. OPERIS Release Finalization

The final artifact must contain the real EXE, SHA256 manifest, lifecycle JSON and Progress UI runtime evidence JSON.
