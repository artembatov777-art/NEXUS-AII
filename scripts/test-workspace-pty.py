"""Linux integration smoke. Requires pexpect and built CLI + workspace host."""
import json
import os
import signal
import shutil
import sys
import subprocess
import tempfile
import uuid
from pathlib import Path
import pexpect

with tempfile.TemporaryDirectory() as temp:
    project = Path(temp) / "project"
    project.mkdir()
    (project / "note.txt").write_text("workspace fixture")
    outside = Path(temp) / "outside.txt"
    outside.write_text("outside fixture")
    (project / "link.txt").symlink_to(outside)
    def start_cli():
        return pexpect.spawn("node", ["build-cli/nexus.js", "--test-model"], encoding="utf-8",
                             env={**os.environ, "HOME": temp}, timeout=5)

    cli = start_cli()
    try:
        cli.expect("❯")
        cli.sendline("/project " + str(project))
        cli.expect("Selected")
        cli.expect("❯")
        for command, answer, expected in [
            ("/files", "yes", "note.txt"),
            ("/read note.txt", "yes", "workspace fixture"),
            ("/search fixture", "yes", "note.txt"),
            ("/read note.txt", "no", "denied"),
            ("/agent read note.txt", "yes", "workspace fixture"),
            ("/agent read note.txt", "no", "denied"),
        ]:
            cli.sendline(command)
            cli.expect("Type yes to allow:")
            cli.sendline(answer)
            cli.expect_exact(expected)
            cli.expect("❯")
        cli.sendline("/agent read ../outside.txt")
        cli.expect("relative path is invalid")
        cli.expect("❯")
        cli.sendline("/agent read link.txt")
        cli.expect("Type yes to allow:")
        cli.sendline("yes")
        cli.expect("Agent stopped:")
        cli.expect("❯")

        read_runs = []
        for audit in (Path(temp) / ".nexus-au" / "workspace-audit").glob("*.jsonl"):
            events = [json.loads(line) for line in audit.read_text().splitlines()]
            if any(event["traceId"].endswith(":1") for event in events):
                assert all(event["toolId"] == "cli.workspace.read" for event in events)
                read_runs.append([event["status"] for event in events])
        assert sorted(read_runs) == sorted([
            ["started", "completed"], ["denied"], ["started", "failed"],
        ])
        for command, expected in [("/agent list", "note.txt"), ("/agent search fixture", "note.txt")]:
            cli.sendline(command)
            cli.expect("Type yes to allow:")
            cli.sendline("yes")
            cli.expect_exact(expected)
            cli.expect("❯")

        def prepare_draft():
            cli.sendline('/draft {"path":"note.txt","from":"fixture","to":"updated"}')
            cli.expect("Type yes to allow:")
            cli.sendline("yes")
            cli.expect_exact('- "fixture"')
            cli.expect_exact('+ "updated"')
            cli.expect("❯")
            assert (project / "note.txt").read_text() == "workspace fixture"

        def approve_draft(write_answer, expected):
            cli.sendline("/approve")
            cli.expect("filesystem:read:selected")
            cli.expect("Type yes to allow:")
            cli.sendline("yes")
            cli.expect("filesystem:write:selected")
            cli.expect("Type yes to allow:")
            cli.sendline(write_answer)
            cli.expect_exact(expected)
            cli.expect("❯")

        prepare_draft()
        approve_draft("no", "denied")
        approve_draft("yes", "Draft approved in memory")
        assert (project / "note.txt").read_text() == "workspace fixture"
        cli.sendline("/discard")
        cli.expect("Draft discarded")
        cli.expect("❯")
        cli.sendline("/approve")
        cli.expect("Prepare an unapproved draft first")
        cli.expect("❯")

        prepare_draft()
        (project / "note.txt").write_text("changed externally")
        approve_draft("yes", "File changed or is unavailable")
        assert (project / "note.txt").read_text() == "changed externally"

        cli.sendline('/draft {"path":"../outside.txt","from":"fixture","to":"updated"}')
        cli.expect("relative path is invalid")
        cli.expect("❯")
        cli.sendline('/draft {"path":"link.txt","from":"fixture","to":"updated"}')
        cli.expect("Type yes to allow:")
        cli.sendline("yes")
        cli.expect("File unavailable")
        cli.expect("❯")
        assert outside.read_text() == "outside fixture"

        approvals = []
        for audit in (Path(temp) / ".nexus-au" / "workspace-audit").glob("*.jsonl"):
            events = [json.loads(line) for line in audit.read_text().splitlines()]
            if events[0]["toolId"] == "cli.workspace.approve-draft":
                approvals.append([event["status"] for event in events])
        assert sorted(approvals) == sorted([
            ["denied"], ["started", "completed"], ["started", "failed"],
        ])

        def apply_draft(answer, expected):
            cli.sendline("/apply")
            cli.expect("filesystem:write:selected")
            cli.expect("Type yes to allow:")
            cli.sendline(answer)
            cli.expect_exact(expected)
            cli.expect("❯")

        note = project / "note.txt"
        note.write_text("workspace fixture")
        prepare_draft()
        approve_draft("yes", "Draft approved in memory")
        apply_draft("no", "denied")
        assert note.read_text() == "workspace fixture"
        cli.sendline("/apply")
        cli.expect("Prepare and approve a new draft first")
        cli.expect("❯")

        prepare_draft()
        approve_draft("yes", "Draft approved in memory")
        prepare_draft()
        cli.sendline("/apply")
        cli.expect("Prepare and approve a new draft first")
        cli.expect("❯")
        approve_draft("yes", "Draft approved in memory")
        replacement = project / "replacement.txt"
        replacement.write_text("workspace fixture")
        replacement.replace(note)
        apply_draft("yes", "No writes were dispatched.")
        assert note.read_text() == "workspace fixture"

        prepare_draft()
        approve_draft("yes", "Draft approved in memory")
        note.unlink()
        note.symlink_to(outside)
        apply_draft("yes", "No writes were dispatched.")
        assert outside.read_text() == "outside fixture"
        note.unlink()
        note.write_text("workspace fixture")

        prepare_draft()
        approve_draft("yes", "Draft approved in memory")
        apply_draft("yes", "Draft applied")
        assert note.read_text() == "workspace updated"
        cli.sendline("/apply")
        cli.expect("Prepare and approve a new draft first")
        cli.expect("❯")

        apply_runs = []
        for audit in (Path(temp) / ".nexus-au" / "workspace-audit").glob("*.jsonl"):
            events = [json.loads(line) for line in audit.read_text().splitlines()]
            if events[0]["toolId"] == "cli.workspace.apply-draft":
                apply_runs.append([event["status"] for event in events])
        assert sorted(apply_runs) == sorted([
            ["denied"], ["started", "failed"], ["started", "failed"], ["started", "completed"],
        ])

        second = project / "second.txt"
        second.write_text("second fixture")

        def prepare_batch():
            cli.sendline("/draft " + json.dumps([
                {"path": "note.txt", "from": "fixture", "to": "updated"},
                {"path": "second.txt", "from": "fixture", "to": "updated"},
            ]))
            for _ in range(2):
                cli.expect("Type yes to allow:")
                cli.sendline("yes")
            cli.expect(r"Plan ([a-f0-9]{64}) \(2 file\(s\)\)")
            plan = cli.match.group(1)
            cli.expect_exact('Draft for "note.txt"')
            cli.expect_exact('Draft for "second.txt"')
            cli.expect("❯")
            return plan

        def prepare_agent_plan(review=True):
            cli.sendline("/agent plan " + json.dumps({
                "goal": "Update both fixture labels", "query": "fixture", "changes": [
                    {"path": "note.txt", "from": "fixture", "to": "updated"},
                    {"path": "second.txt", "from": "fixture", "to": "updated"},
                ],
            }))
            for path in [None, None, "note.txt", "second.txt"]:
                cli.expect("filesystem:read:selected")
                if path:
                    cli.expect_exact(path)
                cli.expect("Type yes to allow:")
                cli.sendline("yes")
            cli.expect(r"Agent plan ([0-9a-f-]{36}) \(hash ([a-f0-9]{64})\)")
            plan_id, plan = cli.match.groups()
            cli.expect_exact('Entries:')
            cli.expect_exact('Candidates for "fixture":')
            cli.expect_exact('Proposed actions: 2')
            cli.expect_exact('"revision":')
            cli.expect_exact('"expectedContentHash":')
            cli.expect('Use /agent diff to review')
            cli.expect("❯")
            if review:
                review_agent_diff(plan)
            return plan_id, plan

        def review_agent_diff(plan):
            cli.sendline("/agent diff")
            cli.expect("Diff for agent plan " + plan)
            cli.expect_exact('Draft for "note.txt"')
            cli.expect_exact('- "fixture"')
            cli.expect_exact('+ "updated"')
            cli.expect_exact('Draft for "second.txt"')
            cli.expect_exact('- "fixture"')
            cli.expect_exact('+ "updated"')
            cli.expect("❯")

        def confirm_batch(plan, answer="yes"):
            cli.sendline("/approve")
            cli.expect("filesystem:read:selected")
            cli.expect(plan)
            cli.expect("Type yes to allow:")
            cli.sendline("yes")
            cli.expect("filesystem:write:selected")
            cli.expect(plan)
            cli.expect("Type yes to allow:")
            cli.sendline(answer)
            cli.expect("Draft approved in memory" if answer == "yes" else "denied")
            cli.expect("❯")

        def prepare_rollback(source_id, reads, expected_count, skipped=None):
            cli.sendline("/rollback " + source_id)
            for _ in range(reads):
                cli.expect("Type yes to allow:")
                cli.sendline("yes")
            plan = None
            if expected_count:
                cli.expect(r"Rollback plan ([a-f0-9]{64}) \(" + str(expected_count) + r" file\(s\)\)")
                plan = cli.match.group(1)
                cli.expect("Rollback for")
            if skipped:
                cli.expect_exact(skipped)
            cli.expect("Use /approve for this rollback" if plan else "No files eligible for rollback")
            cli.expect("❯")
            return plan

        note.write_text("workspace fixture")
        confirm_batch(prepare_batch(), "no")
        cli.sendline("/apply")
        cli.expect("Prepare and approve a new draft first")
        cli.expect("❯")
        confirm_batch(prepare_batch())
        cli.sendline("/approve")
        cli.expect("Prepare an unapproved draft first")
        cli.expect("❯")
        second.write_text("second changed")
        apply_draft("yes", "No writes were dispatched.")
        assert note.read_text() == "workspace fixture"
        assert second.read_text() == "second changed"

        # The second file can be safely read but native policy refuses to
        # replace it. The already committed first edit remains in place.
        second.write_text("second fixture")
        second.chmod(0o666)
        confirm_batch(prepare_batch())
        cli.sendline("/apply")
        cli.expect("Type yes to allow:")
        cli.sendline("yes")
        cli.expect(r"Apply attempt ([0-9a-f-]{36})")
        batch_id = cli.match.group(1)
        cli.expect_exact("1/2 file(s) confirmed")
        cli.expect("❯")
        assert note.read_text() == "workspace updated"
        assert second.read_text() == "second fixture"
        cli.sendline("/apply")
        cli.expect("Prepare and approve a new draft first")
        cli.expect("❯")

        cli.sendline("/recover " + batch_id)
        for _ in range(2):
            cli.expect("Type yes to allow:")
            cli.sendline("yes")
        cli.expect_exact('Matches the proposed replacement: "note.txt" (journal: confirmed revision)')
        cli.expect_exact('Matches the original revision: "second.txt" (journal: dispatch recorded; outcome unconfirmed)')
        cli.expect("❯")
        journal = Path(temp) / ".nexus-au" / "workspace-audit" / (batch_id + ".edit.json.steps")
        phases = [json.loads(line)["phase"] for line in journal.read_text().splitlines()]
        intent = journal.with_suffix("")
        assert intent.stat().st_mode & 0o777 == 0o600
        metadata = json.loads(intent.read_text())
        assert metadata["version"] == 4
        assert "workspace fixture" not in intent.read_text()
        snapshots = intent.parent.with_name("workspace-recovery") / (batch_id + ".json")
        assert snapshots.stat().st_mode & 0o777 == 0o600
        assert snapshots.parent.stat().st_mode & 0o777 == 0o700
        saved_snapshots = snapshots.read_text()
        assert json.loads(saved_snapshots)["originals"][0] == "workspace fixture"
        snapshots.write_text(saved_snapshots + " ")
        cli.sendline("/rollback " + batch_id)
        cli.expect("Recovery data is missing or failed integrity verification")
        cli.expect("❯")
        assert note.read_text() == "workspace updated"
        cli.sendline("/recover " + batch_id)
        for _ in range(2):
            cli.expect("Type yes to allow:")
            cli.sendline("yes")
        cli.expect_exact('Matches the proposed replacement: "note.txt"')
        cli.expect("❯")
        snapshots.write_text(saved_snapshots)
        # A v3 operation still rolls back from the original audit layout.
        legacy_id = str(uuid.uuid4())
        legacy_intent = {key: metadata[key] for key in ("root", "plan", "files")}
        legacy_intent["version"] = 3
        for file, original in zip(legacy_intent["files"], json.loads(saved_snapshots)["originals"]):
            file["original"] = original
        legacy_file = intent.with_name(legacy_id + ".edit.json")
        with legacy_file.open("x") as handle:
            handle.write(json.dumps(legacy_intent))
        legacy_file.chmod(0o600)

        original_steps = journal.read_text()
        journal.write_text(original_steps.replace('"phase":"applied"', '"phase":"altered"'))
        cli.sendline("/rollback " + batch_id)
        cli.expect("No readable rollback journal")
        cli.expect("❯")
        journal.write_bytes(original_steps.encode() + b'{"path":"\xe2\x82')
        prepare_rollback(batch_id, 1, 1)
        cli.sendline("/discard")
        cli.expect("Draft discarded")
        cli.expect("❯")
        journal.write_text(original_steps)
        legacy_steps = legacy_file.with_name(legacy_file.name + ".steps")
        legacy_steps.write_text(original_steps)
        legacy_steps.chmod(0o600)
        prepare_rollback(legacy_id, 1, 1)
        cli.sendline("/discard")
        cli.expect("Draft discarded")
        cli.expect("❯")
        assert phases == ["preflight-started", "preflight-passed", "dispatch-intent",
                          "applied", "dispatch-intent", "not-confirmed"]
        # Denying the reverse plan leaves both files unchanged. Reopening it
        # requires fresh authorization and applies only the confirmed write.
        rollback = prepare_rollback(batch_id, 1, 1, 'Skipped "second.txt": no confirmed write revision')
        confirm_batch(rollback, "no")
        assert note.read_text() == "workspace updated"
        cli.sendline("/apply")
        cli.expect("Prepare and approve a new draft first")
        cli.expect("❯")
        confirm_batch(prepare_rollback(batch_id, 1, 1))
        apply_draft("yes", "Rollback applied")
        assert note.read_text() == "workspace fixture"
        assert second.read_text() == "second fixture"
        prepare_rollback(batch_id, 1, 0, 'Skipped "note.txt": original content is already present')
        second.chmod(0o644)
        note.write_text("workspace fixture")
        confirm_batch(prepare_batch())
        apply_draft("yes", "Draft applied")
        assert note.read_text() == "workspace updated"
        assert second.read_text() == "second updated"

        note.write_text("workspace fixture")
        prepare_draft()
        approve_draft("yes", "Draft approved in memory")
        audit_dir = Path(temp) / ".nexus-au" / "workspace-audit"
        saved_audit = audit_dir.with_name("workspace-audit.saved")
        audit_dir.rename(saved_audit)
        audit_dir.write_text("not a directory")
        cli.sendline("/apply")
        cli.expect("audit history could not be verified")
        cli.expect("❯")
        assert note.read_text() == "workspace fixture"
        audit_dir.unlink()
        saved_audit.rename(audit_dir)

        prepare_draft()
        approve_draft("yes", "Draft approved in memory")
        second.write_text("second fixture")
        confirm_batch(prepare_batch())
        # Pause the real host so Ctrl-C cancels an in-flight apply before rename.
        children = subprocess.check_output(["pgrep", "-P", str(cli.pid)], text=True).split()
        host, = map(int, children)
        os.kill(host, signal.SIGSTOP)
        cli.sendline("/apply")
        cli.expect("Type yes to allow:")
        cli.sendline("yes")
        cli.expect(r"Apply attempt ([0-9a-f-]{36})")
        recovery_id = cli.match.group(1)
        cli.sendcontrol("c")
        cli.expect(pexpect.EOF)
        assert not Path(f"/proc/{host}").exists()
        assert note.read_text() == "workspace fixture"

        # A fresh process recovers from the persisted intent, not memory or a
        # retry. It needs a new project grant and a read approval.
        cli.close()
        cli = start_cli()
        cli.expect("❯")
        cli.sendline("/project " + str(project))
        cli.expect("Selected")
        cli.expect("❯")
        cli.sendline("/recover " + recovery_id)
        for _ in range(2):
            cli.expect("Type yes to allow:")
            cli.sendline("no")
        cli.expect("Recovery could not inspect the file")
        cli.expect("❯")
        for contents, expected in [
            (None, "Matches the original revision"),
            ("workspace updated", "Matches the proposed replacement"),
            ("external edit", "Does not match the original revision or proposed replacement"),
        ]:
            if contents is not None:
                note.write_text(contents)
            cli.sendline("/recover " + recovery_id)
            for _ in range(2):
                cli.expect("Type yes to allow:")
                cli.sendline("yes")
            cli.expect_exact(expected)
            cli.expect("❯")
        cli.sendline("/apply")
        cli.expect("Prepare and approve a new draft first")
        cli.expect("❯")
        assert note.read_text() == "external edit"

        note.write_text("workspace fixture")
        prepare_draft()
        approve_draft("yes", "Draft approved in memory")
        host, = map(int, subprocess.check_output(["pgrep", "-P", str(cli.pid)], text=True).split())
        os.kill(host, signal.SIGSTOP)
        cli.sendline("/apply")
        cli.expect("Type yes to allow:")
        cli.sendline("yes")
        cli.expect(r"Apply attempt ([0-9a-f-]{36})")
        recovery_id = cli.match.group(1)
        os.kill(host, signal.SIGKILL)
        cli.expect_exact("Preflight interrupted; no writes were dispatched.")
        cli.expect("❯")
        cli.sendline("/project " + str(project))
        cli.expect("Selected")
        cli.expect("❯")
        cli.sendline("/recover " + recovery_id)
        cli.expect("Type yes to allow:")
        cli.sendline("yes")
        cli.expect("Matches the original revision")
        cli.expect("❯")
        assert note.read_text() == "workspace fixture"
    finally:
        cli.close(force=True)

    # Relay real host replies, then lose the reply after the second committed
    # edit. The CLI may only report the first edit as confirmed until recovery.
    isolated = Path(temp) / "cli-with-fault"
    isolated_bin = isolated / "bin"
    isolated_bin.mkdir(parents=True)
    shutil.copy("build-cli/nexus.js", isolated / "nexus.mjs")
    shutil.copy("build-cli/bin/nexus-workspace", isolated_bin / "real-host")
    proxy = isolated_bin / "nexus-workspace"
    proxy.write_text(f"#!{sys.executable}\n" + """
import json
import os
from pathlib import Path
import subprocess
import sys
with subprocess.Popen([Path(__file__).with_name("real-host"), *sys.argv[1:]],
                      stdin=subprocess.PIPE, stdout=subprocess.PIPE) as host:
    def forward(reply):
        sys.stdout.buffer.write(reply)
        sys.stdout.buffer.flush()
    forward(host.stdout.readline())
    for line in sys.stdin.buffer:
        host.stdin.write(line)
        host.stdin.flush()
        reply = host.stdout.readline()
        request = json.loads(line)
        if (request["operation"] == "edit" and request["path"] == "second.txt"
                and request["content"] == os.getenv("NEXUS_TEST_DROP_CONTENT", "second updated")):
            assert json.loads(reply)["value"]["applied"] is True
            host.stdin.close()
            break
        forward(reply)
""")
    proxy.chmod(0o700)
    note.write_text("workspace fixture")
    second.write_text("second fixture")
    cli = pexpect.spawn("node", [str(isolated / "nexus.mjs"), "--test-model"],
                        encoding="utf-8", env={**os.environ, "HOME": temp}, timeout=5)
    try:
        cli.expect("❯")
        cli.sendline("/project " + str(project))
        cli.expect("Selected")
        cli.expect("❯")
        confirm_batch(prepare_batch())
        cli.sendline("/apply")
        cli.expect("Type yes to allow:")
        cli.sendline("yes")
        cli.expect(r"Apply attempt ([0-9a-f-]{36})")
        lost_id = cli.match.group(1)
        cli.expect_exact("The edit outcome is unknown. 1/2 file(s) confirmed.")
        cli.expect("❯")
        assert note.read_text() == "workspace updated"
        assert second.read_text() == "second updated"
        cli.sendline("/project " + str(project))
        cli.expect("Selected")
        cli.expect("❯")
        cli.sendline("/recover " + lost_id)
        for _ in range(2):
            cli.expect("Type yes to allow:")
            cli.sendline("yes")
        cli.expect_exact('Matches the proposed replacement: "note.txt" (journal: confirmed revision)')
        cli.expect_exact('Matches the proposed replacement: "second.txt" (journal: dispatch recorded; outcome unconfirmed)')
        cli.expect("❯")
        prepare_rollback(lost_id, 1, 1, 'Skipped "second.txt": no confirmed write revision')
        cli.sendline("/discard")
        cli.expect("Draft discarded")
        cli.expect("❯")
    finally:
        cli.close(force=True)

    # Lose the reply during rollback after the last original file was restored.
    # Recovery reads the actual result, and retry restores only what remains.
    note.write_text("workspace fixture")
    second.write_text("second fixture")
    cli = pexpect.spawn("node", [str(isolated / "nexus.mjs"), "--test-model"],
                        encoding="utf-8", env={**os.environ, "HOME": temp,
                        "NEXUS_TEST_DROP_CONTENT": "second fixture"}, timeout=5)
    try:
        cli.expect("❯")
        cli.sendline("/project " + str(project))
        cli.expect("Selected")
        cli.expect("❯")
        confirm_batch(prepare_agent_plan()[1])
        cli.sendline("/apply")
        cli.expect("Type yes to allow:")
        cli.sendline("yes")
        cli.expect(r"Apply attempt ([0-9a-f-]{36})")
        source_id = cli.match.group(1)
        cli.expect("Draft applied")
        cli.expect("❯")
        confirm_batch(prepare_rollback(source_id, 2, 2))
        cli.sendline("/apply")
        cli.expect("Type yes to allow:")
        cli.sendline("yes")
        cli.expect(r"Rollback attempt ([0-9a-f-]{36})")
        rollback_id = cli.match.group(1)
        cli.expect_exact("The edit outcome is unknown. 0/2 file(s) confirmed.")
        cli.expect("❯")
        cli.sendline("/agent status")
        cli.expect(rollback_id)
        cli.expect("incomplete")
        cli.expect("❯")
        assert note.read_text() == "workspace updated"
        assert second.read_text() == "second fixture"
        assert json.loads((audit_dir / (rollback_id + ".edit.json")).read_text())["rollbackOf"] == source_id

        cli.close()
        cli = start_cli()
        cli.expect("❯")
        cli.sendline("/project " + str(project))
        cli.expect("Selected")
        cli.expect("❯")
        cli.sendline("/recover " + rollback_id)
        for _ in range(2):
            cli.expect("Type yes to allow:")
            cli.sendline("yes")
        cli.expect_exact('Matches the proposed replacement: "second.txt" (journal: dispatch recorded; outcome unconfirmed)')
        cli.expect_exact('Matches the original revision: "note.txt" (journal: no dispatch recorded)')
        cli.expect("❯")

        # The prior approval cannot survive re-preparing the reverse plan.
        confirm_batch(prepare_rollback(source_id, 2, 1, 'Skipped "second.txt": original content is already present'))
        prepare_rollback(source_id, 2, 1)
        cli.sendline("/apply")
        cli.expect("Prepare and approve a new draft first")
        cli.expect("❯")

        confirm_batch(prepare_rollback(source_id, 2, 1))
        apply_draft("yes", "Rollback applied")
        assert note.read_text() == "workspace fixture"
        assert second.read_text() == "second fixture"

        confirm_batch(prepare_batch())
        cli.sendline("/apply")
        cli.expect("Type yes to allow:")
        cli.sendline("yes")
        cli.expect(r"Apply attempt ([0-9a-f-]{36})")
        source_id = cli.match.group(1)
        cli.expect("Draft applied")
        cli.expect("❯")

        # Replacing a file with byte-for-byte identical content changes its
        # revision. Make the external replacement after rollback approval.
        confirm_batch(prepare_rollback(source_id, 2, 2))
        replacement.write_text("workspace updated")
        replacement.replace(note)
        apply_draft("yes", "No writes were dispatched.")
        cli.sendline("/recover " + source_id)
        for _ in range(2):
            cli.expect("Type yes to allow:")
            cli.sendline("yes")
        cli.expect_exact('Matches the proposed replacement: "note.txt" (journal: confirmed revision has since changed)')
        cli.expect_exact('Matches the proposed replacement: "second.txt" (journal: confirmed revision)')
        cli.expect("❯")
        confirm_batch(prepare_rollback(source_id, 2, 1, 'Skipped "note.txt": conflict with the confirmed write revision'))
        apply_draft("yes", "Rollback applied")
        assert note.read_text() == "workspace updated"
        assert second.read_text() == "second fixture"
    finally:
        cli.close(force=True)

    # Exercise the complete planner in the normal interactive CLI with no model.
    # The preload advances only the CLI clock for the approval-expiration case.
    clock_flag = Path(temp) / "clock-expired"
    preload = Path(temp) / "clock.mjs"
    preload.write_text(
        "import { existsSync } from 'node:fs';\n"
        "const original = performance.now.bind(performance);\n"
        "Object.defineProperty(performance, 'now', {value: () => original() + "
        "(existsSync(process.env.NEXUS_PTY_CLOCK_FLAG) ? 360_000 : 0)});\n"
    )
    cli = pexpect.spawn("node", ["--import", str(preload), "build-cli/nexus.js"], encoding="utf-8",
                        env={**os.environ, "HOME": temp, "NEXUS_PTY_CLOCK_FLAG": str(clock_flag)}, timeout=5)
    try:
        note.write_text("workspace fixture")
        second.write_text("second fixture")
        cli.expect("❯")
        cli.sendline("/project " + str(project))
        cli.expect("Selected")
        cli.expect("❯")
        cli.sendline("/agent plan fixture")
        cli.expect("Type yes to allow:")
        cli.sendline("yes")
        cli.expect("Type yes to allow:")
        cli.sendline("yes")
        cli.expect("Deterministic workspace planner")
        cli.expect_exact('Candidates for "fixture":')
        cli.expect("Proposed actions: 0")
        cli.expect("Read-only plan")
        cli.expect("❯")
        cli.sendline("/agent diff")
        cli.expect("No pending agent changes")
        cli.expect("❯")

        source_dir = project / "src"
        source_dir.mkdir()
        (source_dir / "entry.txt").write_text("scoped needle")
        cli.sendline('/agent plan {"goal":"Find scoped matches","directory":"src","query":"needle"}')
        for _ in range(2):
            cli.expect_exact(str(source_dir))
            cli.expect("Type yes to allow:")
            cli.sendline("yes")
        cli.expect_exact('Analyzed directory: "src"')
        cli.expect_exact('Candidates for "needle": ["entry.txt"]')
        cli.expect("Read-only plan")
        cli.expect("❯")
        cli.sendline('/agent plan {"goal":"Invalid action","tool":"shell"}')
        cli.expect("Planning stopped")
        cli.expect("❯")

        plan_id, plan = prepare_agent_plan(review=False)
        cli.sendline("/agent inspect")
        cli.expect(plan_id)
        cli.expect(plan)
        cli.expect("❯")
        cli.sendline("/approve")
        cli.expect("View the complete plan diff")
        cli.expect("❯")
        review_agent_diff(plan)
        confirm_batch(plan, "no")
        cli.sendline("/agent status")
        cli.expect("Awaiting approval")
        cli.expect("❯")
        assert note.read_text() == "workspace fixture"
        confirm_batch(plan)
        clock_flag.touch()
        cli.sendline("/agent status")
        cli.expect("Approval expired")
        cli.expect("❯")
        cli.sendline("/apply")
        cli.expect("Prepare and approve a new draft first")
        cli.expect("❯")
        clock_flag.unlink()
        cli.sendline("/apply")
        cli.expect("Prepare and approve a new draft first")
        cli.expect("❯")

        # The current path checks apply equally to changes proposed by the planner.
        hardlink = project / "hard.txt"
        hardlink.hardlink_to(outside)
        for path, permission, expected in [
            ("../outside.txt", False, "relative path is invalid"),
            ("link.txt", True, "File unavailable"),
            ("hard.txt", True, "hard-linked file"),
        ]:
            cli.sendline("/agent plan " + json.dumps({
                "goal": "Try a prohibited path",
                "changes": [{"path": path, "from": "fixture", "to": "updated"}],
            }))
            for _ in range(1 + int(permission)):
                cli.expect("Type yes to allow:")
                cli.sendline("yes")
            cli.expect("Planning stopped")
            cli.expect(expected)
            cli.expect("❯")
        assert outside.read_text() == "outside fixture"

        confirm_batch(prepare_agent_plan()[1])
        replacement.write_text("second fixture")
        replacement.replace(second)
        apply_draft("yes", "No writes were dispatched.")
        assert note.read_text() == "workspace fixture"

        confirm_batch(prepare_agent_plan()[1])
        recovery_dir = Path(temp) / ".nexus-au" / "workspace-recovery"
        moved_recovery_dir = recovery_dir.with_name("workspace-recovery.saved")
        recovery_dir.rename(moved_recovery_dir)
        recovery_dir.write_text("not a directory")
        apply_draft("yes", "Cannot persist edit intent. No edit was dispatched.")
        assert note.read_text() == "workspace fixture"
        assert second.read_text() == "second fixture"
        recovery_dir.unlink()
        moved_recovery_dir.rename(recovery_dir)

        plan_id, plan = prepare_agent_plan()
        confirm_batch(plan)
        cli.sendline("/apply")
        cli.expect("Type yes to allow:")
        cli.sendline("yes")
        cli.expect(r"Apply attempt ([0-9a-f-]{36})")
        operation = cli.match.group(1)
        cli.expect("Draft applied")
        cli.expect("❯")
        accepted = json.loads((audit_dir / (operation + ".edit.json")).read_text())
        assert accepted["plan"] == plan
        assert accepted["planId"] == plan_id
        assert note.read_text() == "workspace updated"
        assert second.read_text() == "second updated"
        cli.sendline("/agent status")
        cli.expect(plan_id)
        cli.expect(operation)
        cli.expect("completed")
        cli.expect("❯")
        confirm_batch(prepare_rollback(operation, 2, 2))
        apply_draft("yes", "Rollback applied")
        assert note.read_text() == "workspace fixture"
        assert second.read_text() == "second fixture"
        prepare_rollback(operation, 2, 0)
    finally:
        cli.close(force=True)
