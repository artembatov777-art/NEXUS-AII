# NEXUS AU desktop release smoke tests

These checks require a real interactive desktop session. A successful compile or headless CI test does not substitute for them.

## Run on each supported operating system

Target matrix:
- Windows 10/11 with WebView2 and Windows Credential Manager.
- macOS on a supported release with Keychain enabled.
- Linux desktop session with WebKitGTK and an unlocked Secret Service-compatible keyring.

Record the OS version, NEXUS AU commit SHA, app build identifier, and result for every step. Do not put API keys, private file contents, or backup contents in the report.

## 1. First launch and local workspace

1. Install or launch the native Tauri build.
2. Confirm the app opens without a blank webview, CSP errors, or missing native commands.
3. Create a conversation, a project, a memory, and a knowledge document.
4. Restart the app and confirm the records remain.
5. Grant one dedicated test folder. Confirm NEXUS cannot browse outside approved roots.
6. Open a text file, perform a content search, and create/edit/rename/move a test file inside the approved root.
7. Confirm the agent write-approval dialog displays the target path and a bounded, escaped content preview, including a truncation marker for long content.
8. Open Agent Control Center and verify the recent tool audit shows filesystem action types without exposing full private paths or file contents.
9. Delete the test project and confirm project-scoped knowledge and semantic vectors are no longer returned in search.

Expected: local workspace data persists in the native SQLite database. The browser preview is a separate localStorage/IndexedDB environment and has no host filesystem access.

## 2. Credential vault lifecycle

1. Open Settings with the default OmniRoute profile and no key configured. Expected status: missing.
2. Save a disposable OmniRoute key in the `default` profile and a separate disposable Ollama key in the `ollama` profile. Expected status: both entries are available independently; the UI must not display either saved secret after saving.
3. Switch between the two profiles and confirm each status remains isolated. Restart the app and verify both entries persist.
4. Make a provider request to a trusted HTTPS OmniRoute endpoint and a loopback Ollama `/v1` endpoint.
5. Delete each key independently. Expected status: only the selected profile becomes missing; the other remains available.
6. Select the no-key profile. Expected status: NOT REQUIRED, and only a localhost/loopback endpoint is accepted.
7. Lock/disable the OS keyring if practical, then reopen Settings. Expected status: unavailable; the app must not fall back to localStorage, SQLite, or plaintext files.
8. Restore/unlock the OS keyring and verify status recovers.

Platform notes:
- Windows: inspect the entry in Windows Credential Manager.
- macOS: inspect the entry in Keychain Access and note any OS consent prompt.
- Linux: verify with the desktop Secret Service keyring unlocked. Headless CI commonly has no usable keyring and should report unavailable.

Use disposable test keys. Never use a personal production credential for this check.

## 3. Provider and agent safety

1. Configure a trusted HTTPS provider endpoint and a disposable test key.
2. Submit a simple chat request and verify the UI receives the response.
3. Submit a task in Agent Control Center. Confirm the disclosure appears before planning and states that saved profile memory and selected project knowledge may be sent to the configured provider.
4. Confirm the planner receives only the approved workspace tool set and tools from MCP servers explicitly configured by the owner. Relevant profile memory and selected project knowledge are passed as bounded, untrusted reference context.
5. Confirm each workspace file read/write and each MCP tool call requires a separate approval. The workspace write dialog must show the target path and content preview. Shell execution and arbitrary host APIs must remain unavailable.
6. Cancel a running task and verify it reaches a terminal cancelled state.
7. Verify an already-started or terminal tool step with the same run/step identity is not replayed automatically.
8. Inspect audit history and confirm no provider key, raw file content, or full private path appears.

## 4. MCP lifecycle

1. Configure an unauthenticated test MCP server over HTTPS or loopback HTTP. OAuth and bearer-token authentication are not implemented in this build. For remote endpoints, allow the NEXUS webview origin through the server's CORS policy.
2. Save and connect it from Tools & MCP. Confirm initialize, protocol negotiation, session headers, and tools/list discovery.
3. Confirm the UI displays the discovered tool names and connection status.
4. Open Agent Control Center and confirm discovered tools are imported only into the approved agent tool scope.
5. Execute a harmless test tool. Confirm the per-call approval shows the server/tool identity and a bounded input preview.
6. Reject a second call and confirm the remote tool is not invoked.
7. Simulate an unavailable or stalled server. Confirm the request times out or can be cancelled without leaving the UI stuck.
8. Disconnect or remove the server. Confirm its imported tools are unregistered and the session is closed where supported.
9. Restart NEXUS and confirm the saved endpoint reconnects without storing authentication secrets in localStorage.

## 5. Training Lab and privacy

1. Open Training Lab and confirm the UI explains that live evaluation prompts are sent to the configured provider.
2. Use a synthetic or public test prompt for a live model test.
3. Compare two test models and confirm only the evaluation prompt is sent to the selected provider endpoints.
4. Confirm dataset sample IDs and experiment metadata persist, while raw private conversations, memories, and source documents are not imported automatically.
5. Confirm the UI does not claim to fine-tune model weights; fine-tuning is out of scope for this release.

## 6. Backup and restore

1. Export a workspace backup containing a test conversation, project, memory, knowledge document, agent checkpoint, and Training Lab record.
2. Confirm provider credentials, approved folder permissions, and original source file bytes are not present in the exported JSON. Indexed knowledge text and metadata are included.
3. Change or delete test workspace records.
4. Import the backup and confirm the replacement warning appears.
5. Confirm expected records are restored and the semantic index is reconciled or a clear lexical-search fallback warning is shown.
6. Attempt to import a malformed backup and confirm the existing workspace remains unchanged.
7. Confirm files larger than 50 MB are rejected before import.

Treat exported JSON backups as sensitive plaintext files.

## 7. Release scope exclusions

- Voice capture, speech recognition, and voice output are out of scope for this release; no microphone permission should be requested.
- General shell execution, unrestricted desktop automation, filesystem access outside approved roots, and arbitrary host APIs are not implemented.
- MCP endpoints requiring authentication are not supported in this build.

## 8. Results

For each OS, record:
- [ ] Native app launches without CSP/native-command errors.
- [ ] SQLite workspace survives restart.
- [ ] Approved-root filesystem operations and content search succeed.
- [ ] File write previews and audit entries are correct.
- [ ] Credential save/restart/use/delete succeeds.
- [ ] Keyring-unavailable state fails closed; no-key profile reports NOT REQUIRED.
- [ ] Agent context disclosure, per-call approvals, and replay protection are enforced.
- [ ] MCP connection, discovery, timeout/cancellation, approval, and disconnect succeed.
- [ ] Training Lab provider disclosure is visible and live evaluation succeeds with disposable test data.
- [ ] Backup export/import and malformed-backup recovery succeed.

A release is not cross-platform verified until a human tester has completed this matrix on all three OS families. CI build/test results must be recorded separately.
