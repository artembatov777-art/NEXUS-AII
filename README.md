# NEXUS AU

**NEXUS AU** is a planned modular, local-first AI desktop environment that brings multiple AI providers, user-controlled memory, specialized agents, tools, voice interaction, and workflow automation into one workspace.

> Project status: early foundation and documentation stage. The roadmap describes intended capabilities; features should only be marked complete after implementation and testing.

## Product direction

- Multi-provider AI chat and model routing.
- Local conversation and project persistence.
- Inspectable, editable, user-controlled memory.
- Bounded specialized AI agents.
- MCP and external tool integrations with scoped permissions.
- Voice input and text-to-speech.
- Workspace for projects, notes, files, and tasks.
- Observable and cancellable workflow automation.

## Planned technology

- React + TypeScript + Vite
- Tauri 2
- Rust
- SQLite
- Configurable OmniRoute-compatible provider adapter
- MCP integrations

Provider endpoints and authentication formats must be verified against the configured provider. No real API keys or tokens belong in this repository.

## Documentation

- [Product vision](docs/VISION.md)
- [System architecture](docs/ARCHITECTURE.md)
- [Development roadmap](docs/ROADMAP.md)
- [Security principles](docs/SECURITY.md)
- [Agent system](docs/AGENTS.md)
- [Contribution workflow](docs/CONTRIBUTING.md)

## Development status

The repository is at the planning/foundation stage. The next milestone is to audit and preserve the existing code, establish project checks and CI, and then implement the desktop foundation and a verified working AI chat flow.

## Security

Never commit API keys, personal access tokens, passwords, recovery codes, or private user data. See [SECURITY.md](docs/SECURITY.md) for the project's security principles.
