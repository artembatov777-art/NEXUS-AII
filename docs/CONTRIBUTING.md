# Contributing to NEXUS AU

## Collaboration roles

- Project Owner: product direction, priorities, and approval of major decisions.
- Claude: primary implementation contributor and repository maintenance.
- ChatGPT: architecture support, technical specifications, and independent code review.

All contributors are expected to inspect current repository state before editing.

## Workflow

1. Read the relevant documentation and inspect existing implementation.
2. Create a focused feature branch from the latest `main`.
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
