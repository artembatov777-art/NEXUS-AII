"""Linux integration smoke. Requires pexpect and built CLI + workspace host."""
import json
import os
import signal
import shutil
import sys
import subprocess
import tempfile
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
        cli.expect_exact('Matches the proposed replacement: "note.txt"')
        cli.expect_exact('Matches the original revision: "second.txt"')
        cli.expect("❯")
        journal = Path(temp) / ".nexus-au" / "workspace-audit" / (batch_id + ".edit.json.steps")
        phases = [json.loads(line)["phase"] for line in journal.read_text().splitlines()]
        intent = journal.with_suffix("")
        assert intent.stat().st_mode & 0o777 == 0o600
        assert json.loads(intent.read_text())["files"][0]["original"] == "workspace fixture"
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
        cli.expect_exact('Matches the proposed replacement: "note.txt"')
        cli.expect_exact('Matches the proposed replacement: "second.txt"')
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
        confirm_batch(prepare_batch())
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
        cli.expect_exact('Matches the proposed replacement: "second.txt"')
        cli.expect_exact('Matches the original revision: "note.txt"')
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
        confirm_batch(prepare_rollback(source_id, 2, 1, 'Skipped "note.txt": conflict with the confirmed write revision'))
        apply_draft("yes", "Rollback applied")
        assert note.read_text() == "workspace updated"
        assert second.read_text() == "second fixture"
    finally:
        cli.close(force=True)
