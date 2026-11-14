# NEXUS AU — Owner Smoke Test Checklist

Status: prepared for the release candidate. These checks require the owner's real devices and desktop sessions; CI cannot perform them.

## Safety before testing

- Use a disposable test folder and non-sensitive sample documents.
- Do not paste provider API keys into ChatGPT, GitHub issues, logs, screenshots, or this checklist.
- Keep the first provider test local. A normal Ollama loopback endpoint does not require an API key unless the owner has explicitly configured authentication.
- Use a limited-scope cloud key only after local tests pass, and enter it only through the native NEXUS credential settings.

## iPhone Safari preview

Open the hosted preview with `?demo=1` appended to the URL.

- [ ] No horizontal scrolling at common iPhone widths.
- [ ] Top and bottom controls do not overlap the notch, home indicator, or Safari safe areas.
- [ ] Chat, Projects, Memory, Knowledge, and More navigation work.
- [ ] Search fields, buttons, notices, and empty states behave correctly.
- [ ] The preview clearly states that its sample chat is not connected to a live model.
- [ ] Reduced Motion is respected when enabled in iOS accessibility settings.

## Native desktop shell

- [ ] App launches and closes normally on each supported desktop OS.
- [ ] Window resizing, keyboard navigation, dialogs, and command palette remain usable.
- [ ] No secrets appear in application logs, traces, localStorage, or exported backups.

## Providers and credentials

- [ ] Configure a running Ollama-compatible loopback endpoint and discover an installed model.
- [ ] Send a short test prompt, verify streaming, then verify cancellation.
- [ ] Configure a compatible HTTPS cloud endpoint only after local checks; store the key through the native credential UI.
- [ ] Confirm the credential status changes correctly after save and delete.
- [ ] Confirm a deleted key cannot be used and no plaintext fallback is created.
- [ ] Confirm the selected model comes from the provider's actual discovery response.
- [ ] Confirm the UI does not claim that a loopback gateway guarantees upstream-local processing.

## File System

Use a disposable approved folder.

- [ ] Grant access to exactly the intended folder; deny access to an unrelated folder.
- [ ] Browse, search by name, and search file contents within the approved root.
- [ ] Preview a supported raster image and reject a disguised/oversized image.
- [ ] Create a new file without overwriting an existing destination.
- [ ] Edit a file, modify it externally, and confirm the stale draft is preserved rather than overwriting the newer file.
- [ ] Rename/move files and test destination conflicts.
- [ ] Test batch rename/move rollback behavior with disposable files.
- [ ] Confirm audit history records actions without storing private paths.

## Memory, Knowledge, Agents, and Training Lab

- [ ] Create, revise, search, and delete a test memory.
- [ ] Import a sample document and confirm source/page provenance in retrieval.
- [ ] Batch-import mixed TXT/Markdown, CSV, JSON/JSONL, YAML/XML, source/configuration, PDF, and DOCX files; confirm per-file failures are reported without discarding successful imports.
- [ ] Confirm project-scoped knowledge does not leak into another project.
- [ ] Run an agent task with a harmless read-only tool; approve one call and deny another.
- [ ] Pause, resume, and cancel a run; inspect its audit trail.
- [ ] For an ambiguous external result, use manual reconciliation and confirm NEXUS does not blindly rerun the side effect.
- [ ] Import a synthetic Training Lab dataset, validate splits, and run a small evaluation.
- [ ] Confirm private dataset transfer prompts appear before remote evaluation and expected outputs stay local.

## Backup, recovery, and sign-off

- [ ] Export a workspace backup and import it into a disposable profile.
- [ ] Try an invalid backup and confirm the existing workspace remains unchanged.
- [ ] Verify cancellation and recovery after a simulated interrupted workflow.
- [ ] Record OS version, NEXUS commit SHA, test date, and pass/fail notes for each platform.
- [ ] Complete independent security review before enabling broader remote MCP or desktop automation capabilities.
