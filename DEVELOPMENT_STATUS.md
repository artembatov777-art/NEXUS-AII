# NEXUS AU Development Status

Updated: 2026-11-14

## Working branch

- Repository: `artembatov777-art/NEXUS-AII`
- Branch: `feat/nexus-core-architecture`
- Current code baseline: `daedf7126fc006a75f83ad515b9ce27e80cec8c5`
- Documentation alignment commit: `e1c920140fb4fd098ced5a521cbf61de049cbecd`
- Do not work on `main` and do not merge a pull request without owner approval.

## Verified CI

For code baseline `daedf7126fc006a75f83ad515b9ce27e80cec8c5`:

- Frontend quality: passed.
- Vitest: 56 test files, 336 tests passed.
- TypeScript/Vite production build: passed.
- npm audit: 0 vulnerabilities.
- Mobile interface preview build/deploy: passed.
- Native desktop Windows/macOS/Linux matrix: was still running when this status was written. Do not claim native build or Rust tests passed until that run finishes successfully.

The later `e1c9201` commit only aligns documentation with the provider strategy. Its quality run was in progress at the time of this status update.

## Implemented in the latest development increment

### Provider architecture

- Core development no longer depends on OmniRoute.
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

### Voice

- Voice controls are integrated into the chat composer.
- Speech recognition transcripts are inserted into the draft.
- Speech synthesis can read the latest assistant response.
- Unsupported host speech APIs are reported instead of pretending to work.
- Voice component tests cover unsupported recognition and transcript delivery.
- Recognition and synthesis availability depends on the WebView/browser speech implementation; native offline speech is not guaranteed.

## Phase status

All phases remain open until their complete acceptance criteria are verified.

1. Foundation & Infrastructure: PARTIAL.
2. Workspace & Interface: PARTIAL.
3. Memory, Agents & Tools: PARTIAL.
4. Desktop, Security & Stability: PARTIAL.
5. AI Core & Provider Router: PARTIAL.
6. Training Lab: PARTIAL.
7. Multimodality & Voice: PARTIAL.

## Known incomplete work

- Image attachments and image-to-model processing are not integrated into chat.
- Audio-file ingestion/transcription is not implemented. Current voice support is browser/WebView speech input/output.
- Provider settings expose one active endpoint profile; a complete multi-provider profile manager and provider-specific capability registry remain to be completed.
- Local runtime lifecycle management (install/download models, load/unload, resource reporting) is not implemented. Ollama must already be installed and running externally.
- Direct cloud support currently targets compatible OpenAI-style endpoints; non-compatible vendor APIs need dedicated adapters.
- OmniRoute must be added and tested as an optional provider adapter during final integration, without removing direct local/cloud providers.
- Fine-tuning/training runtime, model-weight updates, checkpoint and artifact management remain incomplete.
- Manual Windows desktop smoke testing, owner-side provider credentials, and actual local-runtime testing require the owner's device and environment.
- Re-run the complete native CI matrix after the latest changes and resolve any failures before release claims.

## Next implementation order

1. Finish and inspect native CI for the current branch head.
2. Continue multimodal chat support: validated image attachments, provider content-part transport, and audio-file handling.
3. Complete provider profile management and capability-aware model registry.
4. Add runtime lifecycle/status features where the host supports them.
5. Complete Training Lab runtime/artifact boundaries and report unsupported hardware honestly.
6. Integrate OmniRoute only in the final phase as an optional adapter.
7. Run end-to-end user journeys, security tests, Windows packaging, and manual smoke tests.
8. Update this file after each substantial verified milestone.

Do not report NEXUS AU as complete until every required module and end-to-end acceptance criterion is implemented and tested.
