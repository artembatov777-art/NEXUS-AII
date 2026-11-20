# NEXUS AU Development Status

Updated: 2026-11-16

## Current continuation audit (2026-11-16)

This section supersedes older head/CI claims below; the remaining entries are historical implementation notes, not current release acceptance.

- Inspected clean branch `feat/nexus-core-architecture` at `40e72de70c9a14af9cf43adf82499f747af66ad4`, README, active roadmap, implementation plan, architecture/contracts, runtime, voice controls, native filesystem implementation, tests and workflows. No `Instuchion` file exists in the checked-out Git tree; do not invent its contents.
- The seven-phase sequence in `docs/ROADMAP.md` is authoritative. Phase I is the first formally unfinished phase: fresh owner-side iPhone Safari acceptance is outstanding. Do not mark it complete from jsdom tests. Continue independent Phase II engineering while manual acceptance is pending, as the existing roadmap already permits.

| Area / phase | Implemented and covered by automation | Partial, absent, or unverified |
| --- | --- | --- |
| I: Interface | Desktop shell, module panels, responsive/mobile demo, navigation and dialog contracts | Latest real iPhone Safari acceptance remains open |
| II: AI Core | Provider-neutral router, profiles, discovery, streaming/cancellation/retry/failover, OpenAI-compatible and Anthropic adapters; generated-image storage/editing; host speech controls | No live provider verification in this session; native/offline STT/TTS absent; real WebView voice permission/interruption acceptance open |
| III: Memory / RAG | Inspect/edit/delete, project-scoped ingestion, source provenance, hybrid retrieval, index repair, browser/native repositories | Real desktop multi-session acceptance and embedding-model availability remain unverified here |
| IV: Agents / tools | Bounded runtime, checkpoint persistence, approvals, Tool Gateway, audit replay blocking, model planning, MCP HTTP | Durable whole-plan coordinator recovery, automatic input-bound result replay, MCP authentication/OAuth and specialist teams absent |
| V: Filesystem | Approved roots, bounded reads/search/writes, no-overwrite rename/move, recovery journal; handle-relative hardening and race tests already exist | Windows branch-head compilation failed; complete hostile parent-directory race acceptance and real Windows smoke tests remain open |
| VI: Security / integration | Default deny, OS vault adapters, redaction, encrypted backup, transactional recovery, CSP/capability checks | Interactive vault verification, upstream Rust advisories and filesystem residual risks remain release gates |
| Training Lab | Governed versioned datasets, JSON/JSONL import/export, evaluations/comparison, immutable experiment metadata | No model-weight training, LoRA runner, model artifact registry or hardware scheduling |
| VII: Release | Quality/native workflows and package artifact upload definitions exist | No verified release candidate, signed release, full desktop smoke record or completed release acceptance |

### Baseline evidence and blockers

- Exact-head [Quality run 43821829166](https://github.com/artembatov777-art/NEXUS-AII/actions/runs/43821829166) passed. [Mobile preview run 43821823370](https://github.com/artembatov777-art/NEXUS-AII/actions/runs/43821823370) passed.
- Exact-head [native run 43821829036](https://github.com/artembatov777-art/NEXUS-AII/actions/runs/43821829036) **failed on Windows** at `cargo check`: E0624 (`maybe_dir` private) and E0599 (`access_mode` not found), `workspace_fs.rs:333/339`. macOS and Linux jobs passed checks, Rust tests, packaging and artifact upload. Rust security audit was skipped by the failed dependency; it is not a fresh clean audit.
- Baseline local verification: 86 Vitest files / 637 tests and 6 Node server tests passed; TypeScript/Vite production build and workflow pin checks passed; npm audit reported 0 vulnerabilities. Vite reports the existing large-chunk warning for the lazy transformer runtime.
- This workspace initially lacked Rust. A minimal stable toolchain was installed for verification. Full Linux checking needs unavailable GTK/WebKit development packages; Windows cross-checking needs the absent MinGW C compiler. Package installation is unavailable to this unprivileged environment. A separate Windows-target compile of the actual problematic directory-open block with pinned `cap-std` / `cap-fs-ext` 4.0.3 passes after the trait imports; this is a focused API check, **not** a full application build or Windows runtime test.

### Changes in this continuation

- Restored the missing Windows-only `OpenOptionsMaybeDirExt` and `cap_std::fs::OpenOptionsExt` imports. Preserve no-follow and pinned-parent semantics; do not replace them with ambient path operations merely to make compilation pass. Existing file/directory move and no-overwrite tests remain the behavioral acceptance tests.
- Reproduced three voice lifecycle races with deferred browser callbacks: final text after explicit stop, an old session ending during a new session, and an old permission error during a new session. All three tests failed before the fix. Explicit stop now invalidates the old instance before calling the host; both recognition paths ignore stale error/end callbacks, as they already did for result callbacks.
- Added speech interruption/resume and unavailable-synthesis coverage. These are simulated host-boundary tests, not evidence of actual Safari/WebView speech support. Final local suite: 86 Vitest files / 642 tests and 6 Node server tests passed; the voice component has 14 passing tests.
- No provider, OmniRoute, Ollama service, real credential, main-branch change or PR merge was used.

### Next work

1. Verify the Windows native job for the corrected imports, then inspect any remaining Rust/test/packaging failure before broadening implementation.
2. Keep Phase I open until the latest iPhone Safari acceptance is recorded.
3. Continue Phase II voice host integration/permission/interruption verification; resolve the roadmap's native/offline voice scope conflict before choosing a runtime (it is both an unchecked Phase II item and listed as post-release work).
4. Keep live provider/Ollama/OmniRoute integration deferred until the owner-authorized final integration. Existing prepared adapters and tests must remain functional.

## Repository state

- Repository: `artembatov777-art/NEXUS-AII`
- Active branch: `feat/nexus-core-architecture`
- Latest source implementation includes generated-image conversation persistence, bounded browser image storage, and voice lifecycle regression coverage. Current branch head at this status refresh: `f2a482f40954cf2c5d53efa894594570c8f0510c`.
- Latest completed frontend Quality commit: `da4a19b8f624c32c8266b45db97bd538a88dec9b`
- `main` has not been modified. Pull Request #2 remains open and unmerged.
- OmniRoute is intentionally excluded. No OmniRoute connection is configured.
- Ollama integration is prepared through a loopback-compatible endpoint, but NEXUS does not start or connect to an Ollama service automatically.
- No provider API keys are committed or requested during this development pass.

## Verified automation evidence

- Frontend Quality passed on `b6405a98f4694c7ece67d95ec2c1009aef6cc08d`: Vitest suite, TypeScript/Vite production build, and `npm audit --audit-level=high` completed successfully. Mobile Interface Preview build and deployment passed on `b6405a98f4694c7ece67d95ec2c1009aef6cc08d`.
- Native Windows/macOS/Linux Rust checks, platform-applicable Rust tests, application packaging, and artifact uploads passed on `9a6f10a999c3a59f2171cad94b2219979714d201`. Native verification for the latest source changes is still pending; the last confirmed cross-platform native pass remains `9a6f10a999c3a59f2171cad94b2219979714d201`. Do not treat native packaging as passed for the latest source changes until all three platform jobs finish.
- Frontend Quality passed on `e9869a1968d471e24d9694abeecd26056f9959e9` (73 test files / 517 tests, TypeScript/Vite production build, and npm audit with 0 vulnerabilities). Mobile Interface Preview passed on the same commit. The mobile sidebar stacking fix is included; real iPhone Safari acceptance remains owner-side. Native Windows/macOS/Linux packaging and tests for the latest branch head remain pending behind active native package jobs.
- Mobile Interface Preview build and deployment passed on the earlier UI-identical implementation baseline; the latest iPhone Safari acceptance remains owner-side.
- Native filesystem permission snapshots use unique create-new temporary files, restrictive Unix permissions, and a regression test proving a pre-existing temporary symlink is not followed.
- A prior Windows/macOS native run exposed test fixtures persisting non-canonical temporary roots. Both filesystem fixture helpers now persist canonical roots, matching the production grant contract; the corrected cross-platform run is pending.
- Workspace permission settings load only through a no-follow regular-file handle, reject hard-linked/symlinked settings files, cap input at 1 MiB and 32 roots, and discard non-canonical or retargeted roots. Regression tests cover symlink substitution, oversized settings, and excessive root lists.
- ToolGateway validates AbortSignal shape before audit lookup or permission checks; missing or malformed cancellation signals fail closed. Audit history must be readable before a tool can execute, and malformed actor/run/trace identifiers are rejected before side effects.
- Batch file rename and bulk file move write a durable SQLite operation journal before the first mutation, attempt reverse-order rollback after interrupted startup, refuse to overwrite conflicting paths, and expose unresolved recovery status with an explicit retry action in the File System panel.
- Rust dependency review still tracks two known advisories: unmaintained `proc-macro-error` and the unsound iterator implementation in `glib 0.18.5`, which requires a compatible GTK/WebKit dependency-stack upgrade.
## Current working-session changes (2026-11-15)

- Fixed long-prompt memory retrieval: the hybrid retriever now bounds its search query to 500 characters instead of failing context assembly when a chat message is longer. A regression test covers the bounded query.
- Added an explicit execution-evidence boundary to ordinary chat requests. The text-only chat path must not claim to have run code, accessed a filesystem, created files, browsed the web, or completed external actions without a real host tool result. This addresses the earlier browser-chat behavior that described filesystem operations without verifiable tool execution.
- Added a provider-neutral image-generation router with explicit capability declarations and output validation, plus a Gemini 3.1 Flash Image adapter and chat-composer dialog. The secured server endpoint requires explicit per-request remote-processing consent, keeps the Google API key server-side, restricts model/options, checks image signatures, bounds the response size, cancels upstream generation on client disconnect, and supports preview/download. Generated images are not yet persisted in conversation history; the control is enabled only for the hosted Gemini proxy profile with a NEXUS access token.
- Added a browser/WebView voice-conversation mode that submits recognized speech through the ordinary chat path, speaks completed answers, supports interruption, returns to listening, and blocks duplicate final-transcript submissions. One-shot voice input remains available. This relies on host speech APIs and is not offline/native STT/TTS.
- Frontend Quality on commit `e9d0c5f9463453e02fed37178990036c9a1283bf` ran 76 test files / 539 tests: 537 passed and 2 failed (an outdated voice callback assertion and an image-proxy test missing the required consent field). Those test defects were corrected in later commits.
- A subsequent Quality run on commit `09007f7dd2ccb7682d55083a5d31da5d52dee209` ran 78 test files / 549 tests: 548 passed and 1 failed because the provider-generation test still expected the pre-boundary user-only message list. The assertion was updated in commit `80a548f916e3e6031bc304b182588b8fd5e72fb3`. A post-fix Quality run has not yet been observed for the latest branch head. The Vercel status for the last inspected source commit was pending; no deployment success is claimed.
- The last confirmed successful frontend Quality baseline remains `da4a19b8f624c32c8266b45db97bd538a88dec9b`; it predates the current working-session source changes. Do not treat that result as verification of the current head.

## Additional work in the current continuation

- Generated images are now persisted as assistant-message attachments in conversation history, rendered inline in the chat, and round-tripped through browser storage and native SQLite. Native schema migration v10 adds the attachment column; encrypted workspace backup export/import also carries the attachment and validates its MIME type, canonical base64 padding/decoded byte length, metadata bounds, and 3.2 MB decoded payload ceiling. Rust validation tests cover malformed padding and invalid sizes. Browser history has an aggregate 4.4 MB image-data budget with an explicit save error instead of silently exhausting local storage. TypeScript storage/repository and Rust SQLite validation tests were added. Iterative image editing is not implemented.
- Voice regression coverage now includes duplicate final-transcript suppression, explicit microphone permission denial, ending a voice conversation, and aborting active recognition on unmount. Real browser/WebView compatibility, interruption behavior, and offline/native STT/TTS remain unverified.
- Additional image and voice changes are committed on `feat/nexus-core-architecture`. No CI result for the latest continuation commits has been observed; the previous Quality failure was an outdated AI generation-check expectation and the test assertion was updated afterward. Do not claim the latest branch head passes CI until a fresh run completes.
- Vercel status for the latest inspected PR head is `failure`, with the status URL identifying a Vercel build-rate-limit/upgrade page. This is an infrastructure limit, not a passing deployment. No hosted deployment success is claimed.

## Phase I — Complete interface

The desktop workspace, restrained JARVIS-inspired visual system, responsive layouts, chat/history, command palette, global search, projects, memory, knowledge, agents, tools/MCP, file system, Training Lab, and provider settings are implemented. Heavy modules are lazy-loaded. Mobile preview is isolated behind `?demo=1` and does not contact a model or native filesystem.

Automated UI tests cover navigation, preview disclosures, chat behavior, keyboard shortcuts, dialogs, and key module interactions. The latest preview still requires an owner-side iPhone Safari check.

- Fixed the mobile navigation stacking defect in the final-loaded stylesheet: the open sidebar now has z-index 80 above the blurred dismissal scrim at z-index 79 (the previous responsive rule had been overridden by a later stylesheet). The drawer remains interactive while taps outside it still reach the dismiss scrim. Fresh frontend/mobile CI and real-device Safari verification are required before calling the fix fully verified.

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

Frontend Quality passed on `e9869a1968d471e24d9694abeecd26056f9959e9` (73 test files / 517 tests, production build, npm audit with 0 vulnerabilities). Mobile Interface Preview passed on the same commit. Native Windows/macOS/Linux tests and package generation for the current branch head remain pending. No signed public release has been produced.

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
- Latest source implementation commit: `e9869a1968d471e24d9694abeecd26056f9959e9`; subsequent documentation-only commits may follow without changing that source baseline.

## Owner-side blockers

These steps cannot be honestly completed by source-code changes or headless CI alone:

1. Open the current hosted mobile preview on a real iPhone and verify the refreshed layout and interactions.
2. Launch the native desktop build on the owner's desktop OS and verify the actual OS credential vault and approved-folder permissions.
3. Run a local Ollama service and model, or provide a cloud provider key through NEXUS settings, only when live inference verification is authorized.
4. Provide signing credentials/certificates only if signed distributable installers are required.

Do not mark the project complete until all seven phase exit criteria and owner-side release gates have evidence. A successful frontend build is not a completed desktop release.


## Hosted Gemini proxy hardening

- Added Vitest coverage for the serverless Gemini proxy: method and bearer-token rejection, message validation, server-side API-key forwarding, normalized upstream errors, output usage mapping, and message-size limits.
- Fixed request parsing for Vercel's Node runtime: use its pre-parsed `req.body` when present, enforce the same 64 KiB limit, and retain bounded raw-stream parsing for runtimes that do not pre-parse JSON.
- Corrected the deployment guide's example model so it matches the endpoint allowlist.
- The isolated mobile demo remains disconnected from AI providers. The regular hosted browser chat now exposes image generation only when the configured provider is the same-origin `/api/gemini` proxy and a NEXUS access token is present in UI memory; the token is never embedded in the Vite bundle. The image route and UI require fresh Quality CI and deployed endpoint verification before being called complete.


## Verified continuation update

- Current working branch includes a handle-relative Windows rename attempt that requests `DELETE` access during the initial no-follow capability open; this replaces the earlier `ReOpenFile` approach that failed Windows sharing checks. The earlier Windows run still reports the old implementation's 10 failures; the new revision's native matrix is queued and must pass before this change is accepted.
- Frontend Quality passed on `434452fd5ceda0a92771cf33f513639b8c1abac2`: 86 test files, TypeScript/Vite production build, and npm audit with 0 vulnerabilities. Mobile Interface Preview build/deployment also passed on the same commit. Native Windows/macOS/Linux verification for this revision is still pending.
- Iterative image editing now supports both generated images and owner-selected PNG/JPEG/WebP source images, with client-side MIME/signature validation and a 3.2 MB source bound. The server independently validates image signatures and request limits. Live Gemini account verification remains an owner-side gate.

## Terminal transition — initial shell

The terminal transition has started on `feat/nexus-core-architecture`. `npm run cli` provides an early interactive shell with help and exit commands; it explicitly reports that no model is configured. It does not yet invoke the AI Core, read or change workspace files, execute commands, persist conversations, or replace the desktop application. The migration plan and outstanding tasks are in `tasks/plan.md` and `tasks/todo.md`. Existing browser/Tauri adapters must be replaced or isolated before the corresponding core features can run from Node. Live provider integration remains deferred under the continuation rules.

The CLI transition also has a provider-neutral `TerminalSession` built against the existing `ModelRouter`. Its automated tests cover streaming, conversation context, cancellation, incomplete streams and output size limits. The executable now routes interactive prompts through this session; no provider is registered yet and no live model connection is claimed.

The terminal agent has a tested, sequential adapter over `AgentPlanner`, `ToolRegistry`, and `GatewayAgentToolExecutor`, plus an explicit, fail-closed terminal permission adapter. The `/agent` command is wired into the executable; it has no registered provider or filesystem tools, and tool execution fails closed without durable audit storage. The existing native filesystem requires pinned directory handles and no-follow behavior; Rust was installed for verification; The native lockfile has been regenerated to include the pinned capability dependencies, and locked Cargo metadata succeeds. A native build in a temporary copy failed because the host lacks glib-2.0 development files. Native checks remain unverified. No live provider was connected.

## NEXUS AU 2.0 owner direction (2026-11-17)

The owner’s master plan supersedes the previous desktop-first and CLI-only directions: CLI and Tauri Desktop will share one local Agent Engine. Existing data and features remain subject to migration and verification. Live provider integration remains deferred. PR #2 is open, draft and unmerged. Baseline GitHub Actions for `ee4e88ed563c5f9d45bf5d24442b51b1b4094f76`: Quality passed; Native desktop quality failed on the Windows Rust library test step, while Linux and macOS passed; security audit was skipped. These results predate uncommitted CLI and lockfile changes.

## Shared engine continuation (2026-11-17)

The sequential plan executor previously located in the CLI is now in `src/core/planExecutor.ts`, with its tests in the core. The CLI uses a compatibility re-export. It can be composed by either host, but the existing Desktop still uses its resumable multi-agent coordinator: the two interfaces have not yet been unified and the shared-engine phase is not complete. Exact-head `b31f069ec6cf97d0f7dfe00543c6121c89872d60` GitHub Actions: Quality passed; native desktop failed on the Windows Rust library tests; Linux and macOS native jobs passed; Rust audit was skipped. The failure cannot be treated as a Windows pass.

The Desktop workflow composition has been moved from `src/lib/nexusRuntime.ts` to the host-neutral `src/core/agentWorkflow.ts`, preserving the existing planner, allowlist, checkpointed coordinator and same-instance resume semantics. Existing Desktop workflow tests and a core allowlist test cover the extraction. CLI still uses the separate sequential executor; shared runtime and durable whole-plan recovery remain unfinished.

## Checkpointed agent recovery and audit review (2026-11-20)

Source on `feat/nexus-core-architecture` now rechecks agent permissions when explicitly continuing a checkpoint after a restart. Denied permissions stop the run; renewed approval persists a waiting checkpoint, and multiple approvals retain the completed-step count. The approval grant must match the registered permission at the saved index. Browser and Rust/SQLite validators reject waiting snapshots with missing, null, or unrecognized approval metadata.

Agent Control Center now exposes ambiguous tool audit evidence from interrupted, non-active running checkpoints as **inspection-only**. Marking an outcome as manually reconciled remains restricted to stopped failed or cancelled runs. Manual reconciliation never retries the external action.

A narrowly scoped **Continue local preview** action is available for the built-in non-destructive, no-model demo only when the saved checkpoint has no completed steps and the bounded audit contains no executed or uncertain tool records. The action re-reads the checkpoint and audit immediately before requesting explicit owner confirmation, then invokes the checkpoint runtime, which reauthorizes permissions. Unknown or oversized audit histories block this action. General tool-backed agents are intentionally not automatically resumed.

Verification: RED/green regression tests cover changed permission decisions, multi-step approval preservation, forged approval indices, native validator cases, read-only audit inspection, and the UI resume permission handoff. Web/API Quality and Mobile Interface Preview succeeded for source `92d34ae14ccfd1021f875b3b4b070a3d8c7e2c2f`; the newer full interactive continuation test on `93fe2a2455e8e368159821796c59fc12ef7dda29` awaits the final workflow gate at the time this note was written. Native matrix completion must be checked against the **latest** source SHA, not older successful or cancelled jobs.

**Still blocked for general recovery:** durable execution ownership across processes, exactly-once side-effect safety, post-crash conflict reconciliation, owner-side native smoke tests, and the authorized final provider integration. The present manual local preview action is not evidence that arbitrary external tool execution can resume safely.

## CLI history browsing and audit inspection (2026-11-20)

- The offline fixture CLI now supports read-only `/history`, `/history last N` and `/history find TEXT`. It displays complete local conversation turns with bounded terminal-escaped previews and makes no model request for history inspection. The CLI history file loader now uses bounded no-follow reads, file-identity verification, strict UTF-8 decoding and complete-turn validation before atomic saves. History remains plaintext and is not a Desktop session migration.
- The CLI Tool Gateway's per-run file audit was extracted to `cli/workspaceAudit.ts`. The repository checks ownership/permissions on Unix, file identity, no-follow paths, record structure, append completeness and size limits; unsafe or corrupt history fails closed. The standalone commands `/audit recent` and `/audit <run-id> [last N]` inspect runs without executing tools. An integration test verifies that a malformed journal blocks Tool Gateway execution before the tool is called.
- TDD regression tests and CLI subprocess tests cover multi-process history inspection, output escaping, symlinks, invalid encoding, malformed audit events, interrupted journal writes, recent-run discovery and the absent-provider path.
- Quality (Web/API tests, CLI checks, build and npm audits) passed on source `cfa69640369657295a46e4f8b20af50f1f8c9eba`. The final documentation-only commit needs its own CI run. Native desktop verification for the latest source remains pending and must be tied to its exact SHA.

**Unresolved:** Windows ACL review for the CLI audit directory, native installation and real-user smoke tests, cross-process audit-writer serialization, durable recovery after external side effects, unified Desktop/CLI conversations and agent sessions, and the owner's final model-provider integration. A local audit file is not tamper-proof and must not be treated as proof of exactly-once effects.

## CLI cross-process safety and native CI repair (2026-11-20)

- **Native CLI smoke test repair:** the previous history viewer subprocess assertion incorrectly rejected saved `[TEST MODEL]` text as though it were a newly issued model call. The test now verifies that `/history` and `/audit` commands never become newly echoed model prompts, while separately asserting the history file is unchanged. The full native workflow on source `305289cc561e89bbb9caa58193134b3295d8240a` passed, including Windows/Linux CLI smoke tests, native Windows/macOS/Linux jobs, Windows installer validation and the Rust security audit. This is **not** a claim of full native matrix completion for later commits.
- **Cross-process audit execution claims:** CLI workspace audit writers now acquire an exclusive, private, run-scoped `.lock` file and validate the complete existing journal before appending. When a tool step has a previous non-denied record with the same run ID, tool ID and trace ID, a new `started` write is rejected even if two Tool Gateway instances both observed an empty history earlier. An abandoned lock is not automatically stolen or removed. Test-first regression tests reproduced two simultaneous claims, two gateway instances triggering the same action, corrupt prior records and stale locks; the implementation now denies unsafe duplicates. Previously denied permission attempts can still be reauthorized, subject to the existing permission workflow.
- **CLI conversation durability:** `saveHistory` now serializes cooperating writers with a private per-history lock and checks whether all currently persisted complete turns are an unchanged prefix of the incoming snapshot. A stale session, corrupt persisted history, or abandoned lock blocks persistence instead of erasing another session's conversation. The file remains plaintext and distinct from Desktop SQLite. Integration coverage verifies that a stale `TerminalSession` cannot overwrite a newer session's completed turn.
- **Safe lock diagnosis:** `/audit locks` lists run-scoped writer lock metadata without changing or releasing locks, letting the owner identify an active or interrupted run even if it has no readable audit journal. Invalid/symlinked lock metadata fails closed. Inspection does not establish whether a lock is abandoned and never authorizes a tool retry.
- **Verified source baseline:** Quality succeeded on `8abf3354bd3ec8df4e0e405f4f4b4fa64e853cdb` with **118 Vitest files / 793 passing tests**, CLI subprocess smoke, production frontend build and npm audits. Later documentation-only commits require their own exact-head checks.
- **Documentation priority reconciled:** the owner's 12-phase NEXUS AU 2.0 plan in root `AGENTS.md` and `tasks/todo.md` supersedes the older seven-phase Desktop roadmap and CLI-only proposal. The older milestones remain historical evidence and existing Desktop functionality must be preserved.

**Still unverified:** complete Windows/macOS/Linux native installer matrix for the newest head, Windows ACL review for private CLI journals and history, automatic reconciliation of abandoned locks, concurrent non-cooperative filesystem modifications, native owner-side smoke tests, safe retry after uncertain external effects, and full shared Desktop/CLI Agent Engine and model/provider integration. Locks protect **cooperating CLI processes**, not arbitrary external tools or crashes after an external side effect. Never equate the new claim check with universal exactly-once execution.

## Shared CLI/Desktop Agent Engine execution policy (2026-11-20)

A new provider-neutral `src/core/agentExecutionPolicy.ts` validates bounded, structurally sound plans and copies the validated JSON before dispatch. Runtime checks confirm that every tool is still registered, step dependencies are unique and ordered, inputs are safe JSON, and the plan respects the 12-step execution bound. A `mcp.*` allowance remains scoped to registered MCP tools.

Desktop `createAgentWorkflow` now applies the allowed-tool policy **at run time**, not only when planning; `MultiAgentCoordinator` retains a dynamic tool guard through approval waits and checks it before each delegated step, including after resume. A forged plan, tool removal after planning, or tool revocation after an approval wait fails closed without delegation. The CLI `PlanExecutor` uses the same policy before execution and rechecks registration on every step. Each plan now binds tools to ephemeral registration tokens: removing and re-registering a tool under the same ID and version invalidates a paused or partially executed plan in both hosts. Desktop also intersects its original owner tool allowance with the current allowed-ID list at planning, dispatch and every resumed/subsequent step: removing an ID revokes already-paused work, while later additions never expand the admitted grant.

The CLI sequential executor also returns typed errors for unexpected planner exceptions, tool adapter exceptions, completion after cancellation, and a reporting callback throwing after a side effect. Such results never advertise safe automatic retry; tool outcome must be inspected in the audit.

Test-first regression coverage includes forged high-risk tool plans, revoked, unregistered and same-ID re-registered tools (before execution, between steps and after approval), invalid/cyclic JSON and unsafe keys, detached plan snapshots, and CLI cancellation and adapter failure boundaries. CI **Quality and Mobile Interface Preview succeeded** for implementation SHA `97677cec2602fc51a83018671edb17d5055083e7`, including the full test suite and production build. Native desktop matrix verification must be checked independently for that exact source revision or a later head.

**Remaining shared-engine work:** Desktop and CLI still use different execution schedulers and persistence backends. Unified durable run identities, checkpoint ownership/leases, shared conversation and agent histories, cross-host approval authority, crash reconciliation, a real interactive coding-agent loop, owner-side native smoke tests and live model integration remain unfinished. A safe plan dispatch policy does not prove arbitrary tool idempotency or full system completion.

## Offline workspace integration and shared audit diagnostics (2026-11-20)

- **Native Windows CLI regression diagnosed:** the stricter shared plan validator exposed a real incompatibility in the deterministic workspace planner: `workspaceStep()` included `query: undefined` in read/list tool input. This is not valid plain JSON and caused the Windows native workflow's **Exercise Windows CLI recovery and the write gate** step to fail on source `2f7ff06982ab9c014864e8883b4c79d3c9e80356`. New test-first `cli/workspacePlanner.test.ts` reproduces three read/list failures and verifies complete offline plan previews with and without a literal search. The planner now omits `query` entirely unless provided, preserving strict JSON validation rather than weakening it.
- **One CLI sequential execution boundary:** `src/core/planExecutor.ts` now exports `executeSequentialPlan()`, which requires a valid registered, bounded and detached plan, preserves run-bound tool audits, checks exact tool registration identities and propagates cancellation or uncertain execution results. The model-backed `PlanExecutor.run()` delegates to this function; deterministic `WorkspacePlanner.runInspection()` and `WorkspacePlanner.plan()` also use it directly instead of constructing a fake planner/model adapter. Tests cover actual offline execution, forged direct plans and permission/audit routing.
- **Shared ambiguous tool diagnostics:** `findAmbiguous()` in `src/core/toolReconciliation.ts` is now reused by both Desktop manual reconciliation and the CLI read-only `/audit status <run-id>` command. The command examines the complete bounded run journal (up to 5,000 validated receipts), reports steps with uncertain external outcomes and never retries or reconciles an action automatically. Errors in the journal remain visible as unsafe/unreadable, not as proof of no pending work.
- **Verified implementation baseline:** Quality CI passed on `3317ea840eef2e44359037201e7a4928743dac2a`, including 120 Vitest files / 826 passing tests, terminal CLI subprocess smoke, production frontend build and npm audits. Additional documentation commits require their own exact-SHA verification. The latest native Windows smoke remains a separate release gate and must be checked against a source containing the workspace-step fix.

**Not complete:** CLI still lacks the full interactive coding-agent loop and model-driven filesystem writing. Desktop and CLI do not yet share one checkpointed execution scheduler, durable plan state, chat history or cross-host approvals. A journal summary does not prove external side effects did or did not occur, and it is not a permission to retry. Live model providers, owner-side Windows ACL review, native device acceptance and cross-platform installer verification remain pending.

## Shared CLI/Desktop plan checkpoints and recovery inspection (2026-11-20)

- **Native CLI checkpoint storage:** `cli/fileAgentCheckpoints.ts` implements the versioned `AgentCheckpointRepository` contract with owner-private JSON, bounded file reads, checked file identity on Unix, no-follow handling, exclusive per-run writer locks, compare-and-swap sequence checks and atomic replacement. Corruption, symlinks, hardlinks, insecure Unix directory permissions, concurrent writers and abandoned locks fail closed. `delete()` is intentionally denied until owner-approved retention exists. Windows ACLs require separate native review.
- **Host-neutral dispatch lifecycle:** `src/core/planRunCheckpoints.ts` persists metadata-only step identities, next-step index, active/in-flight step, approval pauses and terminal status. Neither prompts, workspace paths, inputs nor tool results are persisted in these plan snapshots. `executeSequentialPlan()` writes a dispatch-intent checkpoint before invoking a tool and confirms its completion before moving to another step; a failed write blocks execution or returns an explicitly uncertain outcome. Never automatically replay an incomplete run.
- **Real CLI integration:** `WorkspacePlanner` and the native `workspaceSession()` now enable checkpoint-backed inspection and deterministic plan discovery in `~/.nexus-au/agent-checkpoints/`. The terminal's read-only `/checkpoints [N]` and `/checkpoint <run-id>` commands inspect saved plans locally without invoking tools or models, and point to `/audit status <run-id>` for separate external effect evidence. CLI subprocess tests exercise inspection after restart.
- **Real Desktop integration:** `createNexusRuntime().createAgentWorkflow()` uses the same checkpoint lifecycle through the Desktop's existing `AgentCheckpointService` (native SQLite in Tauri, localStorage in preview). The checkpointed coordinator persists pause/resume boundaries, dispatch intent and step results. The parent coordinator record uses a `coord_` namespace to prevent collisions with child `ResumableAgentRuntime` IDs in the same repository; both parent and delegated agent checkpoints remain independently visible.
- **Verification scope:** test-first cases cover concurrent checkpoint writers, interrupted/corrupt file state, stale locks, post-dispatch persistence failure, owner approval pauses, duplicate run IDs, and read-only inspection. Final-head Quality, native desktop matrix and actual owner-machine acceptance must be checked separately before claiming full coverage.

**Still not implemented:** automatic crash recovery or cross-process resumption of a saved plan, shared *physical* Desktop SQLite/CLI file storage, migration of existing sessions, native Windows ACL isolation proof, cross-host approval handoff, exactly-once external effects, full coding-agent loop and final live model integration. An active-step checkpoint is only evidence of attempted dispatch, not proof a side effect happened or did not happen.

## Single-writer coordinator and local Git inspection (2026-11-20)

- **Coordination run identity:** `MultiAgentCoordinator` now claims a validated run ID before its first yield and reserves it for the whole coordinator lifetime. Concurrent runs, duplicates after completion/failure and competing approval continuations are rejected before delegation. A bounded lifetime budget fails closed rather than evicting old IDs and allowing replay. A run that waits for owner approval keeps its identity reserved.
- **Live permission boundary:** Owner tool approval is rechecked after asynchronous delegation authorization and again directly after yielding `agent_started` for checkpoint persistence, immediately before the agent executor. Revoked or replaced tools cannot slip through a pause between those stages.
- **Read-only Git for selected projects:** CLI supports `/git status`, `/git diff`, `/git diff staged` and `/git log`. Calls are fixed-argument, shell-free, local-only, bounded to 64 KB output and 12-second execution, with inherited Git overrides removed and external diff/line conversion disabled. Selected root and its `.git` directory must not be symlinks or a parent repository. **All four commands are registered Tool Gateway capabilities**, with `filesystem:read:selected` authorization, the live selected-root rechecked after approval, cancellation, and persistent tool audit for each invocation. Inspection does not stage, commit, push, reset, fetch, call a model or authorize arbitrary commands.
- **Regression coverage:** New `multiAgentCoordinator.lifecycle.test.ts` exercises parallel run/resume races, post-completion reuse, permission revocation after asynchronous approval and after checkpoint-intent event. New `gitInspection.test.ts` uses actual temporary Git repositories to cover staged/unstaged diffs, status, recent history, wrong roots, symlinked metadata, path and environment injection, cancellation and bounded output. CLI router/subprocess tests assert that Git commands are never silently routed to the echo model.
- **Acceptance scope:** Web/API Quality and npm audit successes do not replace the native matrix. Windows/macOS/Linux native CI on the final implementation SHA and installed owner-device testing must be checked separately. Git write operations and full autonomous coding-agent loop remain incomplete.

## Audit history integrity and cross-run isolation (2026-11-20)

- **Complete audit before dispatch:** `ToolGateway` now validates that every receipt returned for a run belongs to that run, has supported status and bounded identifiers/timestamps, and that the bounded query is not suspiciously full (which could hide earlier receipts). Failed, malformed or potentially truncated history blocks permission checks and tool delegation.
- **Reconciliation isolation:** `ToolReconciliationService.listAmbiguous()` applies the same fail-closed per-run journal validation and checks checkpoint identity. `findAmbiguous()` now keys by `(runId, toolId, traceId)` so a successful or reconciled event from another run cannot clear an in-flight operation.
- **Local preview storage no longer evicts receipts:** `LocalStorageToolAuditSink` previously dropped oldest entries when the global 5,000-event buffer was full. It now refuses further writes and rejects full-buffer reads as unsuitable evidence for automatic replay. Previously truncated legacy preview journals cannot be reconstructed; owner-side inspection remains necessary. The native SQLite audit and CLI private file journal have independent persistence guarantees and need platform-specific verification.
- **Tests:** Fake audit sinks exercise mixed run IDs, invalid timestamps/status, malformed containers and exactly-at-limit histories; tests verify no user permission request, no tool execution and no deletion of stored receipts on failure.

**Remaining:** Native cross-platform confirmation on the final SHA, installed Windows ACL review and manual recovery of old/truncated audit data. A valid receipt is not a guarantee of exactly-once external effects.
