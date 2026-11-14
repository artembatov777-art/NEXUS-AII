# NEXUS AU Development Status

Updated: 2026-11-14

## Working branch and delivery rules

- Repository: `artembatov777-art/NEXUS-AII`
- Active branch: `feat/nexus-core-architecture`
- Latest filesystem hardening implementation: `c2308ca2cd7a0fe9aa51d39f2290a6cf0e333219`.
- Automated Rust lockfile refresh: `05629d2d08a276f55af5f842618e1e47808c894e`.
- Follow-up conversation-history UX refinement: `7c7c57f01eed1a3558a2d15fdf7c338f65305a76`.
- Follow-up agent audit-history bound fix: `9dd7cb8c052b69631e20ae58e548d38619ccadb0`.
- Follow-up filesystem hard-link read protection: `9c9e70764bce403a84a3cffaf90cdaeaf73addb1`.
- Follow-up embedding-model version reconciliation: `804daa4aefb4b015848a4e79b590638079b9ca61` (latest increment CI is pending).
- Draft PR [#2](https://github.com/artembatov777-art/NEXUS-AII/pull/2) remains open and unmerged. Never merge it without owner approval.
- `main` has not been changed.
- Current provider paths are direct compatible cloud endpoints and Ollama. OmniRoute is intentionally deferred until final integration and only if the owner chooses it.

## Verified automation evidence

For implementation commit `c2308ca2cd7a0fe9aa51d39f2290a6cf0e333219` and lockfile refresh `05629d2d08a276f55af5f842618e1e47808c894e`:

- Frontend Quality passed.
- Vitest: 61 test files, 416 tests passed.
- TypeScript and Vite production build passed.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- Native Windows, macOS, and Linux jobs all passed `cargo check`, Rust library tests, native application builds, and artifact uploads.
- Rust library tests: 67 passed on Linux, 67 on macOS, and 63 on Windows (platform-gated tests account for the count difference).
- Rust dependency audit (`cargo audit`) completed successfully with two allowed warnings: `RUSTSEC-2024-0370` (`proc-macro-error` is unmaintained, with no fixed upgrade) and `RUSTSEC-2024-0429` (`glib 0.18.5` iterator unsoundness; a fix requires a compatible GTK/WebKit dependency stack).
- Native workflow uploaded Windows, macOS, and Linux build artifacts for manual smoke tests.
- Mobile Interface Preview build and Pages deployment passed for UI-identical frontend commit `64f8d5d0b2d045d5326aac76a462518ed56a7e73`.
- These are CI/build results, not proof of interactive credential-vault behavior, provider connectivity, or a fresh iPhone Safari acceptance on the latest visual revision.

## Implemented baseline

### Phase I — Complete interface

- Restrained JARVIS-inspired desktop workspace with responsive layout, dynamic NEXUS core, command center, chat, conversation history, focus mode, command palette, global search, and module navigation.
- Projects, Memory, Knowledge, Agents, Tools & MCP, File System, Training Lab, and provider settings are reachable from the workspace.
- Mobile preview is isolated behind `?demo=1`; it uses local sample data and never contacts providers or native filesystem APIs.
- Visible controls use real UI behavior or clearly disclose preview/unsupported states.
- Keyboard focus, reduced-motion preferences, modal focus handling, and mobile navigation behavior have automated coverage.
- Mobile preview interactions cover navigation, secondary modules, demo chat, project and knowledge search, agent disclosures, tool details, notices, and voice disclosure.
- Remaining acceptance: recheck the latest hosted preview and the main responsive workspace in a real iPhone Safari session after the visual refresh.

### Phase II — AI Core

- Provider-neutral model router and registry, model discovery, status/health checks, normalized errors, streaming, usage, cancellation, bounded retry/backoff, and request cleanup are implemented.
- Direct compatible cloud endpoints and Ollama OpenAI-compatible `/v1` endpoint are the active routes.
- Provider profiles save endpoint/model/declared route/credential handle; secrets are held in OS credential-vault entries, not browser storage or backups.
- No-key profile is restricted by the native host to loopback endpoints.
- Local/remote route is explicitly owner-declared; a loopback gateway does not prove inference stays local.
- Live provider verification remains pending: Ollama must be running on an owner-controlled computer, and cloud credentials must be supplied and stored through the native settings UI.
- OmniRoute UI, setup, and connection are excluded from active development by the current project decision.

### Phase III — Memory & Knowledge

- Inspectable memory create/revise/search/delete, project-scoped document ingestion and retrieval, source/page/section provenance, semantic indexing, reconciliation, rebuild, cancellation, and recovery are implemented.
- Approved profile/project context can be supplied to chat and bounded agent planning as untrusted reference data.
- Integrated application acceptance remains part of the full release journey.

### Phase IV — Agents & Tools

- Bounded agent runtime, model-driven planning, durable SQLite checkpoints, pause/resume/cancellation, one-time approvals, audit trail, and duplicate-step replay protection are implemented. Ambiguous-step reconciliation scans the full bounded 5,000-event audit history. Knowledge vector rows record their embedding model ID and are rebuilt when the configured embedding model changes.
- MCP HTTP transport, discovery/import, schema/output bounds, per-call approval, and owner-confirmed reconciliation for ambiguous outcomes are implemented.
- Automatic persisted input-bound result replay for eligible deterministic operations remains open; external side effects must not be replayed blindly.
- Broader OAuth/authentication, adversarial live-server tests, and end-to-end owner smoke tests remain open.

### Phase V — NEXUS File System

- Owner-approved folder roots, scoped browsing/search, text reads, guarded analysis drafts, regular-file create/edit, individual rename/move, raster image previews, batch moves, and batch rename are implemented.
- Batch operations have no-overwrite checks, per-file audit events, and rollback attempts.
- Final-component symlink/reparse-point following is refused for regular-file reads, content search, and image previews. The shared native file-open guard rejects hard-linked regular files for reads and writes. Existing-file writes use checked no-follow handles; create-new writes refuse to truncate existing destinations.
- Residual risks remain: hostile parent-directory TOCTOU races, atomic no-replace semantics for every move/rename case, and broader interrupted multi-file operation recovery require further work and adversarial tests.

### Phase VI — Security & Integration

- Provider secrets use platform credential-vault adapters; logs/traces are bounded and redacted; workspace backups exclude credentials and approved folder permissions.
- Default-deny permissions, per-action confirmations, MCP trust boundaries, bounded transport, and audit-led side-effect controls are implemented.
- Remaining: integrated cross-module acceptance, user-side credential-vault lifecycle checks, Tauri capability/CSP review, parent-path race tests, prompt-injection/tool-output adversarial tests, and end-to-end recovery verification. RustSec warnings for the GTK/WebKit dependency stack remain tracked.
- Application data, browser stores, agent checkpoints, and exported backups are not application-level encrypted; OS account/disk protection remains necessary.

### Phase VII — Testing & Release 1.0

- Automated frontend and native CI evidence is recorded above.
- Remaining: interactive desktop smoke tests, live provider tests, backup/restore and crash-recovery acceptance, full end-to-end/security coverage, packaging/signing, installation instructions, and release notes.
- The project is not release-ready and no phase is marked complete solely because code compiles.

## Owner-side release gates

1. Verify hosted mobile preview and main responsive workspace in iPhone Safari.
2. On desktop, verify credential save/status/use/delete in Windows Credential Manager, macOS Keychain, and Linux Secret Service.
3. Verify folder selection, approved-root boundaries, file read/write/rename/move, conflict behavior, and audit history on real desktop sessions.
4. Verify a running local Ollama service and one compatible cloud provider; never paste API keys into chat or issue trackers.
5. Verify backup export/import, interrupted-operation recovery, and cancellation behavior.
6. Review release artifacts and installation flow on supported platforms.

## Next implementation order

1. Continue Phase I visual and interaction refinement, preserving the restrained JARVIS direction and mobile/desktop parity.
2. Close AI Core runtime edge cases and provider capability/lifecycle metadata without integrating OmniRoute prematurely.
3. Complete agent result-replay design only for deterministic, input-bound, side-effect-safe operations.
4. Expand filesystem conflict/recovery handling and adversarial path tests.
5. Finish integrated security review and cross-module permissions/error recovery.
6. Expand multimodal chat and Training Lab only where real provider/runtime behavior can be verified; do not label evaluation tooling as model-weight training.
7. Complete end-to-end journeys, desktop smoke tests, packaging, and release evidence.
8. Consider optional OmniRoute integration only during final integration and only with owner approval.

Do not report NEXUS AU as complete until all seven phases meet their exit criteria and the owner-side release gates have evidence.
