# NEXUS AU desktop installation and first launch

## Build artifacts

The `Native desktop quality` workflow builds platform-specific installer packages on the active development branch:

- **Windows:** NSIS installer and MSI package.
- **macOS:** DMG disk image.
- **Linux:** AppImage and DEB package.

After a successful workflow run, open the run in GitHub Actions and download the artifact named `nexus-au-installers-<OS>-<commit-sha>`. Artifacts are retained for 14 days. A missing artifact means that platform's packaging job did not complete; do not use an older artifact as evidence for the latest source.

These are development artifacts, not signed public releases. Windows SmartScreen and macOS Gatekeeper may warn or block installation. Do not bypass those warnings on a device unless you trust the exact source commit and have reviewed the build provenance. Linux packages may require system WebKitGTK dependencies.

## Build from source

Requirements:

- Node.js 22 and npm.
- Stable Rust toolchain.
- Platform dependencies required by Tauri 2 and WebKitGTK on Linux.

From the repository root:

```sh
npm ci --legacy-peer-deps
npm run test
npm run build
# Windows
npm run tauri build -- --bundles nsis,msi

# macOS
npm run tauri build -- --bundles dmg

# Linux
npm run tauri build -- --bundles appimage,deb
```

Run only the command for the current operating system. For Linux, install the Tauri 2 WebKitGTK development packages before building. See the Tauri 2 prerequisites for the current distribution-specific package names.

## First launch

1. Launch NEXUS AU and let the local workspace initialize.
2. The default provider profile is a loopback/no-key configuration. It does not start Ollama or connect to any service automatically.
3. Create a project before importing project knowledge.
4. Grant the File System module access only to a disposable test folder at first.
5. Use synthetic or public test data for the initial Memory, Knowledge, Agents, MCP, and Training Lab checks.
6. Export a workspace backup before testing restore or destructive operations. Exports are AES-256-GCM encrypted with a passphrase you choose. Keep both the file and passphrase private; NEXUS cannot recover a lost passphrase.

## Provider setup

NEXUS AU supports directly configured OpenAI-compatible endpoints. OmniRoute is not configured or connected in this build. The Ollama profile can be prepared locally, but a running Ollama service and model must be installed and started separately on an owner-controlled computer. Cloud credentials are entered only in the native provider settings and stored in the operating system credential vault.

Do not paste API keys into chat, issue trackers, screenshots, logs, or exported workspace backups. A loopback URL does not prove that an upstream gateway keeps inference local.

## Release status

A successful build or installer package is not a signed release and does not replace interactive platform smoke tests. Before treating an installation as production-ready, complete the owner checklist in `docs/OWNER_SMOKE_TESTS.md` and `docs/PLATFORM_SMOKE_TESTS.md`, including credential-vault behavior, filesystem scope, backup/restore, cancellation, and real provider verification.
