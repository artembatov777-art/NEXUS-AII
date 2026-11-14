# NEXUS AU — Owner Smoke-Test Record

This checklist is for real-device acceptance after the automated build. CI compilation is not a substitute for testing a signed-in desktop session, an unlocked credential vault, a live model endpoint, or mobile Safari.

## 1. iPhone Safari interface

- Open the hosted interface preview: https://artembatov777-art.github.io/NEXUS-AII/?demo=1
- Check portrait and landscape layouts, scrolling, safe-area spacing, keyboard visibility, and touch-target usability.
- Navigate Chat, Projects, Memory, Knowledge, Agents, File System, Tools & MCP, Training Lab, and Settings.
- Confirm preview notices clearly state that demo messages are not sent to an AI model and demo actions do not touch device files.
- Open the main responsive workspace without `?demo=1` and verify it does not imply native desktop integrations are active.
- Record device model, iOS version, browser version, date, and any layout defects. Do not include private chat contents or credentials in the record.

## 2. Desktop provider credential vault

Run separately on each supported desktop OS:

- Save a test provider key through NEXUS settings.
- Confirm the UI reports the vault entry as available.
- Restart NEXUS and confirm the saved key remains available without being displayed in the UI.
- Run endpoint discovery and a short generation test.
- Delete the saved key and confirm the UI reports it missing.
- Confirm no provider key appears in localStorage, SQLite workspace backup, logs, trace attributes, or exported files.
- On Linux, verify the signed-in desktop session exposes an unlocked Secret Service-compatible keyring. Headless CI does not establish this.

Never send API keys in chat messages, issue reports, screenshots, or smoke-test notes.

## 3. Local Ollama route

- On a desktop where Ollama is installed and running, configure its OpenAI-compatible `/v1` endpoint.
- Discover model IDs from the endpoint; verify NEXUS does not invent unavailable model names.
- Run a generation test, then a normal chat request.
- Verify the configured route disclosure is accurate. A loopback endpoint alone does not prove the model is not forwarding requests elsewhere.
- Confirm cancellation and timeout behavior.

NEXUS does not install Ollama, download model weights, or manage Ollama lifecycle in this release baseline.

## 4. Compatible cloud endpoint

- Configure a compatible HTTPS endpoint.
- Store its key in the OS credential vault through the native UI.
- Discover models, run a generation test, stream a chat response, and cancel a second request.
- Confirm remote processing is disclosed and provider errors do not expose the key.
- Confirm switching provider profiles does not silently start a network request.

## 5. Approved-folder filesystem

- Grant access to a dedicated test folder, not a personal documents root.
- Verify browsing and search stay inside that approved root.
- Read a text file, create a new file, edit it, and verify external-edit conflicts preserve the unsaved draft.
- Verify create-new refuses to overwrite an existing file.
- Test rename/move/batch operations with one deliberate name conflict and verify no unrelated file is overwritten.
- Inspect audit history and confirm private absolute paths are not stored in event details.
- Verify browser preview cannot access the host filesystem.

## 6. Memory, knowledge, agents, and tools

- Create, revise, search, and delete a test memory.
- Import a small non-sensitive document and verify source/page/section provenance in retrieval.
- Run an agent task that only reads approved test data.
- Verify each file write and MCP tool call requires its own explicit approval.
- Simulate an ambiguous tool outcome and use manual reconciliation; confirm the tool is not executed again.
- Confirm untrusted document/tool content cannot expand permissions or override the system policy.

## 7. Backup and recovery

- Export a workspace backup and inspect that credentials and approved folder permissions are absent.
- Import into a disposable workspace and verify projects, conversations, memories, knowledge, agent checkpoints, Training Lab records, and sanitized audit/trace history.
- Test a legacy backup and confirm its data-loss warning is accurate.
- Verify interrupted batch operations report incomplete rollback and leave a recoverable manual-review state.

## Result log

For each section, record: platform/device, app build, date, pass/fail, concise reproduction steps, and non-sensitive evidence. Do not mark a section passed based only on CI.
