# NEXUS AU platform limitations and native test coverage

**Last reviewed:** 2026-11-09

## Native CI matrix

The native.yml workflow runs on:

| Platform runner | Native build | Rust native tests | Desktop UI runtime |
|---|---|---|---|
| Windows | Tauri build without installer bundling | Yes | Compiled, not launched in CI |
| macOS | Tauri build without installer bundling | Yes | Compiled, not launched in CI |
| Ubuntu Linux | Tauri build without installer bundling | Yes | Compiled, not launched in CI |

The workflow installs Linux WebKitGTK and desktop build dependencies, then runs frontend build, cargo check, cargo test --lib, and npm run tauri build -- --no-bundle on each OS. Native tests exercise SQLite migrations, transactional backup/restore, project cleanup, knowledge document replacement/deletion, checkpoint compare-and-swap, and audit/trace persistence.

This is native build and backend integration coverage, **not GUI end-to-end automation**. The CI runners do not launch an interactive Tauri window or a real user session. GUI automation remains a release follow-up.

## Platform-specific behavior

### Windows
- Webview: WebView2.
- Credential store: Windows Credential Manager through the keyring crate.
- A functioning WebView2 runtime is required on the target machine.
- Voice support depends on WebView2 and Windows speech services.

### macOS
- Webview: WKWebView.
- Credential store: macOS Keychain through the keyring crate.
- Keychain access may trigger OS consent prompts depending on device policy.
- Voice support depends on WKWebView and macOS speech services.

### Linux
- Webview: WebKitGTK.
- Credential store: Secret Service-compatible desktop keyring.
- A headless session or missing/unlocked keyring service can make the vault unavailable. NEXUS reports this state and does not write credentials to plaintext storage.
- Native builds require WebKitGTK and the desktop development libraries listed in the CI workflow.
- Voice support depends on WebKitGTK and the installed speech service.

## Runtime constraints shared by platforms

- Provider calls use the native Rust command and return one complete response. Token streaming and mid-request cancellation are not implemented.
- Semantic embeddings and vector search run in the webview using IndexedDB; the native SQLite database remains authoritative for text knowledge.
- Speech recognition and speech synthesis use browser/WebView APIs, not a guaranteed offline native engine.
- Clipboard integration is limited to the implemented native clipboard commands.
- Shell, arbitrary filesystem automation, OS notifications, and broad desktop control are not implemented.
- Workspace backups are plaintext JSON and must be stored securely by the user.

## Release validation still required

1. Launch the built application under a real user session on Windows, macOS, and Linux.
2. Save a provider key, restart the app, verify vault status and a provider request, then delete the key.
3. Import/export a workspace backup and verify project, conversation, memory, and document integrity.
4. Verify voice permissions and speech behavior on each target WebView.
5. Run GUI automation and dependency scanning before a public production release.
