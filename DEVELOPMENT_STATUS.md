# NEXUS AU Development Status

Updated: 2026-11-14

## Working branch

- Repository: `artembatov777-art/NEXUS-AII`
- Branch: `feat/nexus-core-architecture`
- Last recorded verified code baseline: `daedf7126fc006a75f83ad515b9ce27e80cec8c5`
- Later branch commits: provider documentation alignment `e1c9201`, filesystem roadmap evidence `e467932`, provider-profile deletion guard and unsaved-change protection `9ab2189` / `aaa0b86`, profile regression tests `286579b`, private-dataset transfer policy and regression test `1260917` / `eb2f55a` / `e343792`, and security/threat-model documentation updates.
- Latest implementation commit before this status refresh: `ec04a0b90ffc270dfb1bf0361162d6061f805b1c`.
- Draft tracking PR: [#2](https://github.com/artembatov777-art/NEXUS-AII/pull/2); it is open and must not be merged without owner approval.
- Do not work on `main` and do not merge a pull request without owner approval.

## Verified CI

For code baseline `daedf7126fc006a75f83ad515b9ce27e80cec8c5`:

- Frontend quality: passed.
- Vitest: 56 test files, 336 tests passed.
- TypeScript/Vite production build: passed.
- npm audit: 0 vulnerabilities.
- Mobile interface preview build/deploy: passed.
- Native desktop Windows/macOS/Linux matrix: was still running when this status was written. Do not claim native build or Rust tests passed until that run finishes successfully.

The later commits include documentation and provider-profile UX/test changes. CI status for the current branch head has not been independently retrieved in this session. Do not treat the older baseline's passing tests as verification of these later commits.

## Implemented in the latest development increment

### Provider architecture

- Core development no longer depends on OmniRoute. The gateway-specific profile builder and setup control have been removed; current runtime paths are direct compatible cloud endpoints and Ollama.
- The default endpoint is an Ollama-compatible loopback URL, with no model preselected and no API key required for the no-key local profile.
- Model discovery shows only IDs actually returned by the configured endpoint. Configured but undiscovered IDs are not injected into the catalog.
- The first discovered model is selected only after a successful catalog response.
- Provider discovery no longer clears its own successful state when it updates the selected model.
- Direct compatible local and cloud endpoints remain available. OmniRoute is reserved for final integration as an optional adapter behind the provider-neutral contract.
- Provider location remains owner-declared; the application cannot verify upstream routing from a URL alone.

### Training Lab

- Dataset manifests can include real sample records, not just IDs.
- JSON array and JSONL/NDJSON import are supported through explicit file selection.
- JSONL export is supported for saved sample records.
- Train/validation/test split IDs and sample assignments are validated in TypeScript and Rust.
- Imported sample content is bounded and persisted with immutable dataset versions in the native SQLite repository.
- Held-out test-split evaluation sends only sample inputs to the configured model; expected outputs remain local for scoring.
- Evaluation records exact-match, expected-output containment, per-case completion, and latency metrics.
- Remote evaluation of owner-approved private datasets requires an explicit confirmation.
- A single dataset evaluation is bounded to 1,000 test cases and can be cancelled.
- Training Lab model comparison now preserves successful model outputs when one provider fails; cancellation remains global.
- Actual model-weight training, LoRA execution, and checkpoint/artifact management are not implemented yet.
- Provider profiles support multiple saved endpoint configurations without storing API keys; the UI confirms profile deletion and protects unsaved changes when switching profiles. Regression tests were added, but these latest tests have not yet been confirmed by CI.
- The File System panel supports bounded raster-image previews, batch file moves, and batch file renaming with prefix/suffix patterns, extension preservation, same-directory scope, no-overwrite preflight, per-file audit events, and rollback attempts. Component and Rust regression tests cover the new batch-rename paths; current-head CI must confirm them.
- Owner-approved private Training Lab datasets now require explicit transfer confirmation regardless of the declared provider route. The warning explains that a local/loopback endpoint may still forward requests remotely; expected outputs remain local. A core policy regression test was added, but current-head CI has not yet been verified.

### Voice

- Voice controls are integrated into the chat composer.
- Speech recognition transcripts are inserted into the draft.
- Speech synthesis can read the latest assistant response.
- Unsupported host speech APIs are reported instead of pretending to work.
- Voice component tests cover unsupported recognition and transcript delivery.
- Recognition and synthesis availability depends on the WebView/browser speech implementation; native offline speech is not guaranteed.

## Phase status

The seven-phase sequence below matches `docs/ROADMAP.md`. No phase is formally closed until its full exit criteria are verified.

1. Complete interface: IN PROGRESS; current-head CI and owner-side iPhone visual acceptance remain to be reconfirmed.
2. AI Core: IN PROGRESS; provider-neutral runtime is implemented, while live local/cloud verification and final capability/lifecycle boundaries remain.
3. Memory & Knowledge: IMPLEMENTED BASELINE; integrated acceptance remains tied to the complete application.
4. Agents & Tools: PARTIAL; automatic input-bound result replay and final integration/smoke tests remain.
5. NEXUS File System: IN PROGRESS; scoped operations, previews, batch moves, and batch rename are implemented; broader recovery remains.
6. Security & Integration: PARTIAL; integrated permission, credential-vault, platform-boundary, and threat-model acceptance remain.
7. Testing & Release 1.0: NOT RELEASE-READY; full end-to-end, owner-side smoke tests, packaging, and release evidence remain.

## Known incomplete work

- Image attachments and image-to-model processing are not integrated into chat.
- Audio-file ingestion/transcription is not implemented. Current voice support is browser/WebView speech input/output.
- Saved provider profiles can store multiple endpoint configurations, but only one profile is active at a time. A complete provider-specific capability registry remains to be completed.
- Local runtime lifecycle management (install/download models, load/unload, resource reporting) is not implemented. Ollama must already be installed and running externally.
- Direct cloud support currently targets compatible OpenAI-style endpoints; non-compatible vendor APIs need dedicated adapters.
- OmniRoute must be added and tested as an optional provider adapter during final integration, without removing direct local/cloud providers.
- Fine-tuning/training runtime, model-weight updates, checkpoint and artifact management remain incomplete.
- Manual Windows desktop smoke testing, owner-side provider credentials, and actual local-runtime testing require the owner's device and environment.
- The latest verified baseline `2b9795102cf4de0af73cc6b51b0c11c22c396fe9` passed frontend Quality, npm audit, Vitest, TypeScript/Vite production build, and native Windows/macOS/Linux check/test/build jobs. Subsequent interface, speech-privacy, and batch-rename commits are not yet verified by a completed CI run; the first native run was cancelled by newer branch pushes.

## Next implementation order

1. Retrieve and inspect frontend Quality, Mobile Interface Preview, and native CI for the current branch head; fix failures before relying on older test evidence.
2. Complete the remaining interface acceptance checks, including the latest hosted mobile preview on a real iPhone Safari session.
3. Finish AI Core provider capability metadata, provider-profile integration, runtime lifecycle/status boundaries, and live local/cloud verification on the owner's device.
4. Continue the remaining filesystem conflict/recovery and bulk-organization work.
5. Complete the integrated security review, including credential-vault, audit, CSP, Tauri capability, and dependency boundaries.
6. Expand multimodal chat with validated image attachments, provider content-part transport, and audio-file handling.
7. Complete Training Lab artifact/runtime boundaries without claiming model-weight training that is not implemented.
8. Run end-to-end user journeys, security tests, Windows packaging, and owner-side manual smoke tests.
9. Integrate OmniRoute only as an optional adapter during final integration, if the owner chooses to proceed.

Do not report NEXUS AU as complete until every required module and end-to-end acceptance criterion is implemented and tested.
