# NEXUS AU

A modular, local-first AI desktop workspace. Current development milestone: **0.1 Foundation**.

## Implemented in the foundation branch

- React + TypeScript + Vite application shell.
- Tauri 2 + Rust desktop backend.
- Chat workspace and locally persisted conversation history.
- Configurable OpenAI-compatible provider URL and model.
- Native Rust command for chat completion requests.
- API key is session-only in the UI and is not written to local storage.
- Responsive dark interface and provider settings.

## Technology

- React 18, TypeScript, Vite
- Tauri 2, Rust
- Reqwest with Rustls for HTTPS provider requests
- LocalStorage for the first conversation persistence layer

## Requirements

- Node.js 20.19+ or 22.12+
- npm
- Rust stable toolchain
- Tauri system prerequisites for your operating system

For Windows, install the Microsoft C++ Build Tools and WebView2 runtime as described in the official Tauri prerequisites.

## Development

```bash
npm install
npm run dev
```

Run as a desktop application:

```bash
npm run tauri dev
```

Create a production frontend build:

```bash
npm run build
```

## Configure an AI provider

Open **Models & providers** in the app and enter:

1. Base URL for an OpenAI-compatible API, for example `https://api.openai.com/v1`.
2. A model name supported by that endpoint.
3. An API key.

The key remains in memory for the current application session and is passed to the Rust backend only when a request is submitted. It is not persisted. A future milestone should integrate the operating system credential store.

The provider endpoint must support the OpenAI-compatible `POST /chat/completions` contract. Provider-specific authentication or request formats may require a dedicated adapter.

## Current limitations

- Chat completion is non-streaming in this milestone.
- Conversation history uses app-local browser storage; SQLite migration is planned.
- API keys are session-only, not stored in an OS credential vault.
- No agents, MCP tools, voice, or automation are implemented yet.
- A successful frontend build does not by itself prove a native Windows package has been produced.

## Project documentation

See [docs](docs/) for product vision, architecture, roadmap, security, agents, and contribution workflow.
