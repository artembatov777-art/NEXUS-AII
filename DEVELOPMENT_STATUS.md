# NEXUS AU Development Status

Updated: 2026-11-14

## Repository state

- Repository: `artembatov777-art/NEXUS-AII`
- Active branch: `feat/nexus-core-architecture`
- Latest source implementation commit with completed frontend/mobile CI: `55741684a3992dc31e2ad61bb127ca988678a341`
- Latest workflow configuration commit: `92aafe70ffc9f8165a5e658bc866e9ca6e6337e7`
- `main` has not been modified. Pull Request #2 remains open and unmerged.
- OmniRoute is intentionally excluded. No OmniRoute connection is configured.
- Ollama integration is prepared through a loopback-compatible endpoint, but NEXUS does not start or connect to an Ollama service automatically.
- No provider API keys are committed or requested during this development pass.

## Verified automation evidence

- Frontend Quality passed on `55741684a3992dc31e2ad61bb127ca988678a341`: 69 test files, 481 tests, TypeScript/Vite production build, and `npm audit --audit-level=high` with 0 reported vulnerabilities.
- Fresh Frontend Quality passed on `f06625cdc9c3165e3ea4ca93f21ae69354135c0d`: 69 test files, 485 tests, TypeScript/Vite production build, and `npm audit --audit-level=high` with 0 reported vulnerabilities. The native cross-platform workflow for this source revision has not yet reported a completed result.
- Mobile Interface Preview build and deployment passed on the same source commit.
- Native Windows/macOS/Linux Rust tests and installer packaging are still being verified. The current matrix has reached package creation on Windows, macOS, and Linux after adding a square Linux AppImage icon; the full matrix and artifact uploads are not yet confirmed. Do not treat a queued or partial matrix as a pass.
- Native filesystem permission snapshots now use unique create-new temporary files, restrictive Unix permissions, and a regression test proving a pre-existing temporary symlink is not followed.
- Rust dependency review still tracks two known advisories: unmaintained `proc-macro-error` and the unsound iterator implementation in `glib 0.18.5`, which requires a compatible GTK/WebKit dependency-stack upgrade.

## Phase I — Complete interface

The desktop workspace, restrained JARVIS-inspired visual system, responsive layouts, chat/history, command palette, global search, projects, memory, knowledge, agents, tools/MCP, file system, Training Lab, and provider settings are implemented. Heavy modules are lazy-loaded. Mobile preview is isolated behind `?demo=1` and does not contact a model or native filesystem.

Automated UI tests cover navigation, preview disclosures, chat behavior, keyboard shortcuts, dialogs, and key module interactions. The latest preview still requires an owner-side iPhone Safari check.

## Phase II — AI Core

The provider-neutral model router supports direct OpenAI-compatible endpoints, model discovery, generation health checks, streaming, usage events, bounded retries, normalized errors, and cancellation. Provider profiles store secrets in OS credential-vault entries; no-key mode is restricted to loopback endpoints. Model IDs must come from actual provider discovery.

Live provider verification is intentionally deferred. It requires a running owner-controlled local model service and/or owner-supplied cloud credentials. NEXUS does not install or start Ollama. OmniRoute is not required by the core and remains excluded.

## Phase III — Memory & Knowledge

Inspectable memory create/revise/search/delete, hybrid keyword/semantic retrieval in chat and the Memory panel, project-scoped knowledge ingestion and retrieval, source/page provenance, local semantic embeddings, vector reconciliation, index repair, and encrypted workspace export/import are implemented. Knowledge import supports text/Markdown, CSV, JSON/JSONL, YAML, XML, source/configuration files, PDF, and DOCX, with bounded multi-file import and recursive scans of explicitly approved workspace roots. Sensitive directories and credential-like files are excluded. Chat uses persistent hybrid keyword/semantic memory retrieval with scope and project isolation. Memory and knowledge context is marked as untrusted reference data. Cancellation propagates through retrieval and background semantic-index reconciliation.

The first semantic memory use may download the local embedding model. If that model cannot load, keyword retrieval remains available. Owner-side multi-session persistence and real imported-document workflows remain part of final acceptance.
- Legacy project migration is serialized across repositories sharing the same browser storage, and native project save/delete waits for migration completion. Knowledge append operations now use incremental ID-based SQLite upserts rather than rewriting a previously read full snapshot, avoiding stale writes that could restore deleted chunks. Regression tests were added; current CI evidence is still required.

## Phase IV — Agents & Tools

The bounded agent runtime, model-driven planning, SQLite checkpoints, pause/resume/cancellation, one-time approvals, audit history, Tool Gateway, and MCP HTTP transport are implemented. Planned runs can include relevant profile memories, selected-project memories, and source-grounded project knowledge as untrusted reference context; cancellation propagates through memory and knowledge retrieval. MCP requests and responses are bounded, JSON-RPC responses are correlated to request IDs, transport-owned session headers cannot be overridden, and ambiguous external outcomes require owner-confirmed reconciliation.

Automatic persisted input-bound result replay is intentionally not implemented: storing arbitrary tool outputs for replay could duplicate private data or unsafe side effects. Duplicate run/step execution is blocked instead. OAuth/bearer authentication and adversarial live-server tests remain open.

## Phase V — NEXUS File System

Owner-approved roots, scoped browsing/search, guarded text reads, create/edit, rename/move, image previews, batch rename, no-overwrite destination semantics, conflict detection, secure permission snapshots, and audit events are implemented. Platform-specific atomic no-replace operations prevent a destination created after preflight from being overwritten. Renaming a file preserves the active image preview state.

Residual work: hostile parent-directory TOCTOU protection and durable recovery of interrupted multi-file operations. Real desktop permission and filesystem behavior must be verified by the owner.
- Move, rename, and batch-rename now canonicalize the approved parent directory while preserving the final source component unresolved; regression tests reject final-component symlinks without touching their targets.

## Phase VI — Security & Integration

Additional source hardening is now present on the working branch, with fresh CI verification pending:
- Encrypted backup exports use authenticated envelope schema v2; schema v1 remains importable for backward compatibility. Envelope algorithm/KDF metadata is authenticated as AES-GCM additional data.
- Provider API keys are redacted from successful non-streaming output and streamed text, including when a key is split across SSE deltas.
- File move/rename source paths resolve the approved parent directory without canonicalizing the final component, preventing symlink-target substitution during source resolution.
- Regression tests were added for metadata tampering, legacy backup import, split-delta secret redaction, and final-component symlink rejection. These changes must not be called verified until the latest frontend and native workflows finish.

OS credential-vault storage, default-deny runtime policy, per-action approval, bounded provider/MCP transports, redacted audit/trace records, transactional workspace backup/restore, CSP, and narrow Tauri capabilities are implemented. Exported backups use AES-256-GCM with PBKDF2-SHA256 passphrase derivation (600,000 iterations for new exports); passphrases are held only in UI memory and never persisted. Legacy plaintext backups remain importable after an explicit warning.

SQLite, browser stores, and checkpoints are not application-level encrypted. Remaining work includes integrated adversarial testing, owner-side credential-vault lifecycle checks, broader cross-module recovery, and independent security testing.

## Phase VII — Testing & Release 1.0

Frontend Quality and mobile preview passed on the latest source implementation commit. Native Rust tests and package generation still need a successful cross-platform CI result. No signed public release has been produced.

Release acceptance still requires:
- Successful current Windows/macOS/Linux Rust tests and native package builds.
- Interactive desktop launch and filesystem smoke tests on supported platforms.
- Credential-vault save/status/use/delete checks on Windows, macOS, and Linux.
- Real provider verification when the owner chooses to supply credentials and run a local model service.
- Backup/restore, cancellation, interrupted-operation, and crash-recovery acceptance.
- Signed/reproducible artifacts, release notes, and a known-limitations list.
- Fresh iPhone Safari acceptance for the latest mobile preview.

## Owner-side blockers

These steps cannot be honestly completed by source-code changes or headless CI alone:

1. Open the current hosted mobile preview on a real iPhone and verify the refreshed layout and interactions.
2. Launch the native desktop build on the owner's desktop OS and verify the actual OS credential vault and approved-folder permissions.
3. Run a local Ollama service and model, or provide a cloud provider key through NEXUS settings, only when live inference verification is authorized.
4. Provide signing credentials/certificates only if signed distributable installers are required.

Do not mark the project complete until all seven phase exit criteria and owner-side release gates have evidence. A successful frontend build is not a completed desktop release.
