# NEXUS AU Development Status

Updated: 2026-11-14

## Repository state

- Repository: `artembatov777-art/NEXUS-AII`
- Active branch: `feat/nexus-core-architecture`
- Latest source implementation commit: `f9ce7808e4affa547a777b2cca204f809b5180b5`.
- Latest completed frontend Quality commit: `da4a19b8f624c32c8266b45db97bd538a88dec9b`
- `main` has not been modified. Pull Request #2 remains open and unmerged.
- OmniRoute is intentionally excluded. No OmniRoute connection is configured.
- Ollama integration is prepared through a loopback-compatible endpoint, but NEXUS does not start or connect to an Ollama service automatically.
- No provider API keys are committed or requested during this development pass.

## Verified automation evidence

- Frontend Quality passed on `b6405a98f4694c7ece67d95ec2c1009aef6cc08d`: Vitest suite, TypeScript/Vite production build, and `npm audit --audit-level=high` completed successfully. Mobile Interface Preview build and deployment passed on `b6405a98f4694c7ece67d95ec2c1009aef6cc08d`.
- Native Windows/macOS/Linux Rust checks, platform-applicable Rust tests, application packaging, and artifact uploads passed on `9a6f10a999c3a59f2171cad94b2219979714d201`. Native verification for the latest source changes is still pending; the last confirmed cross-platform native pass remains `9a6f10a999c3a59f2171cad94b2219979714d201`. Do not treat native packaging as passed for the latest source changes until all three platform jobs finish.
- Frontend Quality passed on `da4a19b8f624c32c8266b45db97bd538a88dec9b` (73 test files / 517 tests, TypeScript/Vite production build, and npm audit with 0 vulnerabilities; run `43627930950`). Mobile Interface Preview passed on the same commit (run `43627931063`). Native cross-platform verification for the latest source/test changes is pending; the corrected filesystem test fixtures now persist canonical roots. The current native matrix is queued behind active package jobs.
- Mobile Interface Preview build and deployment passed on the earlier UI-identical implementation baseline; the latest iPhone Safari acceptance remains owner-side.
- Native filesystem permission snapshots use unique create-new temporary files, restrictive Unix permissions, and a regression test proving a pre-existing temporary symlink is not followed.
- A prior Windows/macOS native run exposed test fixtures persisting non-canonical temporary roots. Both filesystem fixture helpers now persist canonical roots, matching the production grant contract; the corrected cross-platform run is pending.
- Workspace permission settings load only through a no-follow regular-file handle, reject hard-linked/symlinked settings files, cap input at 1 MiB and 32 roots, and discard non-canonical or retargeted roots. Regression tests cover symlink substitution, oversized settings, and excessive root lists.
- ToolGateway validates AbortSignal shape before audit lookup or permission checks; missing or malformed cancellation signals fail closed. Audit history must be readable before a tool can execute, and malformed actor/run/trace identifiers are rejected before side effects.
- Batch file rename and bulk file move write a durable SQLite operation journal before the first mutation, attempt reverse-order rollback after interrupted startup, refuse to overwrite conflicting paths, and expose unresolved recovery status with an explicit retry action in the File System panel.
- Rust dependency review still tracks two known advisories: unmaintained `proc-macro-error` and the unsound iterator implementation in `glib 0.18.5`, which requires a compatible GTK/WebKit dependency-stack upgrade.
## Phase I — Complete interface

The desktop workspace, restrained JARVIS-inspired visual system, responsive layouts, chat/history, command palette, global search, projects, memory, knowledge, agents, tools/MCP, file system, Training Lab, and provider settings are implemented. Heavy modules are lazy-loaded. Mobile preview is isolated behind `?demo=1` and does not contact a model or native filesystem.

Automated UI tests cover navigation, preview disclosures, chat behavior, keyboard shortcuts, dialogs, and key module interactions. The latest preview still requires an owner-side iPhone Safari check.

- Fixed the mobile navigation stacking defect: the open sidebar now sits above the blurred dismissal scrim, so its text remains sharp and its controls receive pointer input. The scrim remains below the drawer and continues to dismiss navigation when tapped outside it. Fresh frontend/mobile CI and real-device Safari verification are required before calling the fix fully verified.

## Phase II — AI Core

The provider-neutral model router supports direct OpenAI-compatible endpoints, model discovery, generation health checks, streaming, usage events, bounded retries, normalized errors, and cancellation. Provider profiles store secrets in OS credential-vault entries; no-key mode is restricted to loopback endpoints. Model IDs must come from actual provider discovery.

Live provider verification is intentionally deferred. It requires a running owner-controlled local model service and/or owner-supplied cloud credentials. NEXUS does not install or start Ollama. OmniRoute is not required by the core and remains excluded.

## Phase III — Memory & Knowledge

Inspectable memory create/revise/search/delete, hybrid keyword/semantic retrieval in chat and the Memory panel, project-scoped knowledge ingestion and retrieval, source/page provenance, local semantic embeddings, vector reconciliation, index repair, and encrypted workspace export/import are implemented. Knowledge import supports text/Markdown, CSV, JSON/JSONL, YAML, XML, source/configuration files, PDF, and DOCX, with bounded multi-file import and recursive scans of explicitly approved workspace roots. Sensitive directories and credential-like files are excluded. Chat uses persistent hybrid keyword/semantic memory retrieval with scope and project isolation. Memory and knowledge context is marked as untrusted reference data. Cancellation propagates through retrieval and background semantic-index reconciliation.

The first semantic memory use may download the local embedding model. If that model cannot load, keyword retrieval remains available. Owner-side multi-session persistence and real imported-document workflows remain part of final acceptance.
- Legacy project migration is serialized across repositories sharing the same browser storage, and native project save/delete waits for migration completion. Knowledge append operations now use incremental ID-based SQLite upserts rather than rewriting a previously read full snapshot, avoiding stale writes that could restore deleted chunks. Regression tests were added; current CI evidence is still required.

## Phase IV — Agents & Tools

The bounded agent runtime, model-driven planning, SQLite checkpoints, pause/resume/cancellation, one-time approvals, audit history, Tool Gateway, and MCP HTTP transport are implemented. ToolGateway now fails closed when its audit sink cannot verify prior execution history, and rejects malformed actor/run/trace identifiers or malformed cancellation signals before permission checks or side effects. Regression tests cover missing audit readers, control characters, and malformed/missing AbortSignal objects. Planned runs can include relevant profile memories, selected-project memories, and source-grounded project knowledge as untrusted reference context; cancellation propagates through memory and knowledge retrieval. MCP requests and responses are bounded, JSON-RPC responses are correlated to request IDs, transport-owned session headers cannot be overridden, and ambiguous external outcomes require owner-confirmed reconciliation.

Automatic persisted input-bound result replay is intentionally not implemented: storing arbitrary tool outputs for replay could duplicate private data or unsafe side effects. Duplicate run/step execution is blocked instead. OAuth/bearer authentication and adversarial live-server tests remain open.

## Phase V — NEXUS File System

Owner-approved roots, scoped browsing/search, guarded text reads, create/edit, rename/move, image previews, batch rename, no-overwrite destination semantics, conflict detection, secure permission snapshots, and audit events are implemented. Platform-specific atomic no-replace operations prevent a destination created after preflight from being overwritten. Renaming a file preserves the active image preview state.

Residual work: hostile parent-directory TOCTOU protection, in-app conflict resolution for journal records that remain ambiguous after the new retry action, and owner-side desktop filesystem smoke tests. Batch rename and bulk move now have durable startup recovery; real device behavior remains unverified.
- Move, rename, and batch-rename now canonicalize the approved parent directory while preserving the final source component unresolved; regression tests reject final-component symlinks without touching their targets.

## Phase VI — Security & Integration
- Tool execution timeouts are now explicitly non-retryable because an executor may ignore cancellation and finish an external side effect after the caller times out; the durable `started`/`failed` audit trail keeps the step available for owner reconciliation. Regression coverage exercises an executor that ignores its abort signal.
- Filesystem recovery journal payloads are limited to 1 MiB when written and before JSON deserialization. Recovery and inspection SQL checks the BLOB byte length before transferring payload text into Rust, so oversized records are not loaded for parsing. Oversized or malformed records remain preserved for manual review, block recovery/mutations, and are surfaced as invalid in recovery details. Regression tests cover oversized persisted records, multibyte UTF-8 sizing, and rejection of oversized serialized writes.
- Persisted approved workspace roots are revalidated against their stored canonical path at startup. If the root or an ancestor was replaced by a symlink/reparse point while NEXUS was closed, the stale grant is discarded instead of silently following the new target; Unix regression tests cover both root and ancestor symlink substitution.
- Agent planning now validates the runtime types of model-generated step IDs, tool IDs, purpose strings, and dependency IDs before processing them. Malformed fields return validation errors rather than throwing; adversarial tests also verify that untrusted reference text cannot authorize unavailable tools or replace the owner-supplied task goal.
- Tauri security contract tests inspect the actual CSP and default capability manifest, enforcing same-origin scripts, the WebAssembly-only compilation exception, explicit connect destinations, and the narrow permission list.
- New conversation titles are normalized for whitespace and Unicode-safe truncation before persistence; unit tests cover existing titles, blank messages, whitespace, and emoji.
- Agent, Memory, and Knowledge panels now explicitly select browser-backed repositories in web preview and native SQLite repositories in the desktop shell, keeping the preview functional without invoking unavailable native commands.
- Native macOS tests exposed non-canonical temporary roots in filesystem test fixtures; both filesystem fixture helpers now persist canonical roots, matching the production permission-grant contract. The corrected cross-platform native run is pending.

Additional source hardening is now present on the working branch. Frontend Quality passed on `da4a19b8f624c32c8266b45db97bd538a88dec9b`; Mobile Interface Preview passed and native cross-platform verification remains pending:
- Encrypted backup exports use authenticated envelope schema v2; schema v1 remains importable for backward compatibility. Envelope algorithm/KDF metadata is authenticated as AES-GCM additional data.
- Provider API keys are redacted from successful non-streaming output and streamed text, including when a key is split across SSE deltas.
- File move/rename source paths resolve the approved parent directory without canonicalizing the final component, preventing symlink-target substitution during source resolution.
- Regression tests were added for metadata tampering, legacy backup import, split-delta secret redaction, and final-component symlink rejection. These changes must not be called verified until the latest frontend and native workflows finish.

OS credential-vault storage, default-deny runtime policy, per-action approval, bounded provider/MCP transports, redacted audit/trace records, transactional workspace backup/restore, CSP, and narrow Tauri capabilities are implemented. Exported backups use AES-256-GCM with PBKDF2-SHA256 passphrase derivation (600,000 iterations for new exports); passphrases are held only in UI memory and never persisted. Legacy plaintext backups remain importable after an explicit warning.

SQLite, browser stores, and checkpoints are not application-level encrypted. Remaining work includes integrated adversarial testing, owner-side credential-vault lifecycle checks, broader cross-module recovery, and independent security testing.

## Phase VII — Testing & Release 1.0

Frontend Quality passed on `da4a19b8f624c32c8266b45db97bd538a88dec9b` (73 test files / 517 tests, production build, npm audit with 0 vulnerabilities). Mobile Interface Preview passed on the same commit. Native Windows/macOS/Linux tests and package generation for the current source changes remain pending. No signed public release has been produced.

Release acceptance still requires:
- Successful current Windows/macOS/Linux Rust tests and native package builds.
- Interactive desktop launch and filesystem smoke tests on supported platforms.
- Credential-vault save/status/use/delete checks on Windows, macOS, and Linux.
- Real provider verification when the owner chooses to supply credentials and run a local model service.
- Backup/restore, cancellation, interrupted-operation, and crash-recovery acceptance.
- Signed/reproducible artifacts, release notes, and a known-limitations list.
- Fresh iPhone Safari acceptance for the latest mobile preview.

## Resume point

- Active phase: **Phase V — NEXUS File System**. Phase VI engineering criteria are recorded complete in `docs/ROADMAP.md`; return to Phase V residuals before proceeding to Phase VII, preserving the approved phase order.
- Latest completed engineering block: ambiguous tool timeouts and failed model-generation streams are non-retryable; partial assistant output is persisted when a stream fails or is cancelled. Regression tests cover both paths.
- Frontend Quality passed on `da4a19b8f624c32c8266b45db97bd538a88dec9b` (73 test files / 517 tests). Mobile Interface Preview is in progress and native cross-platform verification remains pending.
- Completed engineering block: the production desktop chat path now routes through `NexusApplication` and a serialized browser/SQLite conversation repository. Prepared bounded memory/project context is sent to the model, project ownership and source/page citations persist with the conversation, streaming usage/deltas remain visible, and partial output remains recoverable after failure/cancellation. Integration tests cover prepared context, project scope, citation persistence, concurrent conversation upserts, and deletion.
- Next engineering block: finish Phase V parent-directory TOCTOU hardening and close the in-app recovery-conflict workflow. The File System panel supports path review, retry, and explicit manual-reconciliation acknowledgment; the owner must resolve conflicting paths without overwrite. Then proceed to Phase VII release acceptance.
- Latest source implementation commit: `f9ce7808e4affa547a777b2cca204f809b5180b5`; subsequent test/documentation commits may follow without changing that source baseline.

## Owner-side blockers

These steps cannot be honestly completed by source-code changes or headless CI alone:

1. Open the current hosted mobile preview on a real iPhone and verify the refreshed layout and interactions.
2. Launch the native desktop build on the owner's desktop OS and verify the actual OS credential vault and approved-folder permissions.
3. Run a local Ollama service and model, or provide a cloud provider key through NEXUS settings, only when live inference verification is authorized.
4. Provide signing credentials/certificates only if signed distributable installers are required.

Do not mark the project complete until all seven phase exit criteria and owner-side release gates have evidence. A successful frontend build is not a completed desktop release.
