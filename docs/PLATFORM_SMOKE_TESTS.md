# NEXUS AU desktop release smoke tests

These checks require a real interactive desktop session. A successful compile or headless CI test does not substitute for them.

## Run on each supported operating system

Target matrix:
- Windows 10/11 with WebView2 and Windows Credential Manager.
- macOS on a supported release with Keychain enabled.
- Linux desktop session with WebKitGTK and an unlocked Secret Service-compatible keyring.

Record the OS version, NEXUS AU commit SHA, app build identifier, and result for every step. Do not put API keys or backup contents in the report.

## 1. First launch and local workspace

1. Install or launch the native Tauri build.
2. Confirm the app opens without a blank webview, CSP errors, or missing native commands.
3. Create a conversation, a project, a memory, and a knowledge document.
4. Restart the app and confirm the records remain.\n5. Open a file, perform a content search, and create/edit/rename/move a test file inside the approved root.\n6. Open Agent Control Center and verify the recent tool audit shows the filesystem action types without exposing full private paths.
7. Delete the test project and confirm project-scoped knowledge and semantic vectors are no longer returned in search.

Expected: local workspace data persists in the native SQLite database. The browser preview is a separate localStorage/IndexedDB environment.

## 2. Credential vault lifecycle

1. Open Settings with no provider key configured. Expected status: missing.
2. Save a test provider key. Expected status: available; the UI must not display the saved secret after saving.
3. Restart the app. Expected status remains available.
4. Make one provider request to a trusted HTTPS endpoint configured by the tester.
5. Delete the key. Expected status: missing; provider requests must be disabled.
6. Lock/disable the OS keyring if practical, then reopen Settings. Expected status: unavailable; the app must not fall back to localStorage, SQLite, or plaintext files.
7. Restore/unlock the OS keyring and verify status recovers.

Platform notes:
- Windows: inspect the entry in Windows Credential Manager.
- macOS: inspect the entry in Keychain Access and note any OS consent prompt.
- Linux: verify with the desktop Secret Service keyring unlocked. Headless CI commonly has no usable keyring and should report unavailable.

Use a disposable test key. Never use a personal production credential for this check.

## 3. Provider and agent safety

1. Configure a trusted HTTPS provider endpoint and a test key.
2. Submit a simple chat request and verify the UI receives the response.
3. Submit a task in Agent Control Center. Confirm the explicit confirmation appears before model planning.
4. Confirm the Control Center planner receives only the built-in workspace.preview tool.
5. Confirm external MCP tools, filesystem actions, shell commands, and other host actions are not exposed by this workflow.
6. Cancel a running task and verify it reaches a terminal cancelled state.
7. Inspect the audit view/storage and confirm no provider key or raw secret appears.

## 4. MCP lifecycle\n\n1. Configure an unauthenticated test MCP server over HTTPS or loopback HTTP.\n2. Save and connect it from Tools & MCP. Confirm initialize, protocol negotiation, session headers, and tools/list discovery.\n3. Open Agent Control Center and confirm discovered tools are imported only into the approved agent tool scope.\n4. Execute a harmless read-only test tool. Confirm the per-call approval shows the tool name and input preview.\n5. Reject a second call and confirm the remote tool is not invoked.\n6. Disconnect or remove the server. Confirm its imported tools are unregistered and the session is closed where supported.\n7. Restart NEXUS and confirm the saved endpoint reconnects without storing any authentication secret in localStorage.\n\n## 5. Backup and restore

1. Export a workspace backup containing a test conversation, project, memory, and knowledge document.
2. Confirm provider credentials are not present in the exported JSON.
3. Change or delete test workspace records.
4. Import the backup and confirm the confirmation prompt appears.
5. Confirm all expected records are restored and semantic search is reconciled.
6. Attempt to import a malformed backup and confirm the existing workspace remains unchanged.

Treat exported JSON backups as sensitive plaintext files.

## 6. Voice and permissions

1. Test microphone permission granted and denied.
2. Test speech recognition unsupported/unavailable.
3. Start recognition, stop it, and navigate away while recognition is active.
4. Confirm listeners and speech activity are cleaned up and the UI returns to a stable state.
5. Verify speech service privacy and network behavior for the target WebView/OS. Do not assume offline speech.

## 7. Results

For each OS, record:
- [ ] Native app launches.
- [ ] SQLite workspace survives restart.
- [ ] Credential save/restart/use/delete succeeds.
- [ ] Keyring-unavailable state fails closed.
- [ ] Agent confirmation, workspace allowlist, and per-call MCP approval are enforced.
- [ ] Cancellation and audit checks succeed.
- [ ] Backup export/import and malformed-backup recovery succeed.
- [ ] Voice permission/error/cleanup checks succeed.

A release is not cross-platform verified until a human tester has completed this matrix on all three OS families. CI build/test results must be recorded separately.
