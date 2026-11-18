# Contributing to NEXUS AU

## Collaboration roles

- Project Owner: product direction, priorities, and approval of major decisions.
- Claude: primary implementation contributor and repository maintenance.
- ChatGPT: architecture support, technical specifications, and independent code review.

All contributors are expected to inspect current repository state before editing.

## Workflow

1. Read the relevant documentation and inspect existing implementation.
2. For the current continuation, work only in `feat/nexus-core-architecture`. Do not modify `main`, create a replacement development branch, or merge a PR without the owner's permission.
3. Make a small, coherent change.
4. Add or update tests and documentation.
5. Run the checks relevant to the change.
6. Review the diff for unrelated edits, secrets, and generated files.
7. Open a pull request with a clear summary and test results.
8. Merge only after review and successful checks.

## Branch naming

Use descriptive names such as:

- `feat/chat-streaming`
- `feat/sqlite-memory`
- `fix/provider-timeout`
- `docs/architecture-update`

## Commit messages

Prefer concise conventional prefixes:

- `feat:` new functionality
- `fix:` bug fix
- `docs:` documentation
- `refactor:` code restructuring
- `test:` tests
- `chore:` tooling and maintenance

## Quality rules

- Do not overwrite existing work without inspecting it.
- Do not commit credentials or personal data.
- Do not add placeholder features presented as complete.
- Keep modules small and interfaces explicit.
- Add tests for behavior and failure cases.
- Document assumptions, limitations, and unverified provider behavior.

## Pull request checklist

- [ ] Scope is focused and explained.
- [ ] Existing behavior was considered.
- [ ] Tests were added or updated.
- [ ] Relevant checks pass.
- [ ] Documentation is updated.
- [ ] No secrets or private user data are included.
- [ ] Security and permission implications are described.

## Continuation rules

- Read README, `docs/ROADMAP.md`, `DEVELOPMENT_STATUS.md`, relevant contracts and any available owner instruction file before editing. `docs/AGENTS.md` documents the product runtime; it is not a substitute for owner instructions.
- Use the seven-phase roadmap rather than historical milestone checkboxes. Keep implemented code, automated evidence and manual acceptance separate; identify the exact source SHA for CI claims.
- Inspect and preserve working implementations and serialized contracts. Never replace them with demos or stubs to satisfy a check.
- Do not connect OmniRoute, Ollama or real provider keys during core development; live integration is deferred to the owner's final integration stage.
- Native filesystem lookups must retain pinned-directory, no-follow and no-overwrite behavior. Windows capability options require the extension traits from `cap-fs-ext` and `cap-std`, rather than the standard-library options trait.
- Browser speech stop/abort events may arrive late. Invalidate a stopped session before calling the host and reject callbacks from inactive sessions.
- Run the full frontend test/build checks and inspect current GitHub Actions; run native checks when platform prerequisites are available. Record an unavailable check or failed job explicitly, never as passed.
- Update existing status/contracts with important decisions and remaining acceptance gates. Avoid redundant session report files.
