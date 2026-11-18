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

        # Stop the real host so this operation stays in flight until cancellation.
        children = subprocess.check_output(["pgrep", "-P", str(cli.pid)], text=True).split()
        host, = map(int, children)
        os.kill(host, signal.SIGSTOP)
        cli.sendline("/read note.txt")
        cli.expect("Type yes to allow:")
        cli.sendline("yes")
        cli.sendcontrol("c")
        cli.expect(pexpect.EOF)
        assert not Path(f"/proc/{host}").exists()
    finally:
        cli.close(force=True)
