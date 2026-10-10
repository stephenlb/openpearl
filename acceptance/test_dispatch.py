"""Exercise the workflow client with a fake GitHub CLI, without network access."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


CLIENT = Path(__file__).parents[1] / ".github/workflows/scripts/acceptance-dispatch.sh"
SHA = "a" * 40
FAKE_GH = '''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
with open(os.environ["TRACE"], "a") as trace:
    trace.write(json.dumps(args) + "\\n")
if args[:2] == ["workflow", "run"]:
    sys.exit(0)
if args[:2] == ["run", "list"]:
    print("123")
elif args[:2] == ["run", "view"]:
    print("completed" if args[-1] == ".status" else os.environ["CONCLUSION"])
elif args[:2] == ["run", "download"]:
    if os.environ.get("MISSING") == "1":
        sys.exit(1)
    out = pathlib.Path(args[args.index("--dir") + 1])
    (out / "result.json").write_text(os.environ["RESULT"])
    (out / "feedback.md").write_text("Custom feedback")
else:
    sys.exit(2)
'''


class DispatchTests(unittest.TestCase):
    def execute(self, result, conclusion="success", missing=False):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cli = root / "gh"
            cli.write_text(FAKE_GH)
            cli.chmod(0o755)
            trace = root / "trace.jsonl"
            env = dict(os.environ, PATH=f"{root}:{os.environ['PATH']}", BASE="main",
                       RESULT=result, CONCLUSION=conclusion, TRACE=str(trace),
                       MISSING="1" if missing else "0")
            process = subprocess.run(["bash", str(CLIENT), SHA, "request-1", str(root / "out")],
                                     env=env, capture_output=True, text=True, timeout=5)
            calls = [json.loads(line) for line in trace.read_text().splitlines()]
            self.assertEqual(calls[0], ["workflow", "run", "acceptance.yml", "--ref", "main",
                                       "-f", f"sha={SHA}", "-f", "request_id=request-1"])
            download = next(call for call in calls if call[:2] == ["run", "download"])
            self.assertEqual(download[download.index("--name") + 1], "acceptance-result")
            return process.returncode

    def test_success_matches_commit(self):
        self.assertEqual(self.execute(json.dumps({"status": "pass", "sha": SHA})), 0)

    def test_test_failure(self):
        self.assertNotEqual(self.execute(json.dumps({"status": "fail", "sha": SHA}), "failure"), 0)

    def test_workflow_failure_cannot_pass(self):
        self.assertNotEqual(self.execute(json.dumps({"status": "pass", "sha": SHA}), "failure"), 0)

    def test_wrong_commit_cannot_pass(self):
        self.assertNotEqual(self.execute(json.dumps({"status": "pass", "sha": "b" * 40})), 0)

    def test_malformed_result_cannot_pass(self):
        self.assertNotEqual(self.execute("not JSON"), 0)

    def test_missing_artifact_cannot_pass(self):
        self.assertNotEqual(self.execute("{}", missing=True), 0)


if __name__ == "__main__":
    unittest.main()
