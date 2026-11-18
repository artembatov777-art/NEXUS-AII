"""Linux integration smoke. Requires pexpect and built CLI + workspace host."""
import json
import os
import signal
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
    cli = pexpect.spawn("node", ["build-cli/nexus.js", "--test-model"], encoding="utf-8",
                        env={**os.environ, "HOME": temp}, timeout=5)
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
        apply_draft("yes", "File changed; prepare a new draft")
        assert note.read_text() == "workspace fixture"

        prepare_draft()
        approve_draft("yes", "Draft approved in memory")
        note.unlink()
        note.symlink_to(outside)
        apply_draft("yes", "File unavailable")
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
        # Pause the real host so Ctrl-C cancels an in-flight apply before rename.
        children = subprocess.check_output(["pgrep", "-P", str(cli.pid)], text=True).split()
        host, = map(int, children)
        os.kill(host, signal.SIGSTOP)
        cli.sendline("/apply")
        cli.expect("Type yes to allow:")
        cli.sendline("yes")
        cli.sendcontrol("c")
        cli.expect(pexpect.EOF)
        assert not Path(f"/proc/{host}").exists()
        assert note.read_text() == "workspace fixture"
    finally:
        cli.close(force=True)
