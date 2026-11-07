# NEXUS AU — Security Principles

## Core rule

The user remains in control of data, credentials, tools, and actions. Security requirements are part of the architecture, not a later polish task.

## Secrets

- Never commit API keys, access tokens, passwords, recovery codes, or private certificates.
- Do not place secrets in frontend bundles, logs, crash reports, screenshots, or test fixtures.
- Prefer the operating system credential store for provider credentials.
- Provide a clear way to replace and remove stored credentials.
- Use environment files only for local development; keep real secret files out of version control.

## Permissions

- Apply least privilege to every tool and agent.
- Separate read, write, execute, and network capabilities.
- Show the user which tool is requesting access and why.
- Require confirmation for destructive, external, financial, or irreversible actions.
- Provide cancellation and a visible execution history.
- Do not expose unrestricted shell execution as a general-purpose agent tool.

## Untrusted content

Treat web pages, files, emails, tool output, and retrieved documents as untrusted data, not as instructions that can override system or user policy.

Do not allow instructions embedded in external content to silently grant permissions, reveal secrets, or trigger privileged actions.

## Local data

- Minimize collected data.
- Keep local data local by default where practical.
- Make memory inspectable, editable, and deletable.
- Document what leaves the device when external providers are used.
- Avoid logging full prompts or private documents unless explicitly enabled for debugging.

## Agent safety

- Enforce step, time, and token/cost budgets.
- Enforce per-agent tool allowlists.
- Require approval for permission escalation.
- Prevent unbounded recursive delegation.
- Record tool calls and outcomes without exposing secrets.

## Development hygiene

- Review dependencies and pin versions where appropriate.
- Run tests, linting, type checks, and Rust formatting.
- Review permission changes in Tauri configuration.
- Keep security limitations documented.
- Report vulnerabilities responsibly; never claim a security audit has passed unless one was actually performed.
