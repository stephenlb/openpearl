"""Behavior tests for script results, feedback separation, and fail-closed handling."""

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "acceptance_runner", Path(__file__).parents[1] / ".github/workflows/scripts/acceptance.py"
)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class AcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = self.root / "project"
        self.project.mkdir()
        self.suite = self.root / "suite"
        self.suite.mkdir()
        self.output = self.root / "results"

    def execute(self, tests):
        manifest = self.suite / "suite.json"
        manifest.write_text(json.dumps({"version": 1, "tests": tests}))
        code = runner.run(manifest, self.project, self.output, "a" * 40)
        result = json.loads((self.output / "result.json").read_text())
        feedback = (self.output / "feedback.md").read_text()
        return code, result, feedback

    def test_custom_feedback_separate_from_logs_and_all_tests_run(self):
        (self.suite / "fail.sh").write_text(
            'echo "private workload details"\necho "stderr detail" >&2\n'
            'printf "Improve concurrency handling" > "$OPENPEARL_FEEDBACK_FILE"\nexit 7\n'
        )
        (self.suite / "pass.sh").write_text(
            'test "$PWD" = "$OPENPEARL_PROJECT_DIR"\n'
            'test -z "${ACCEPTANCE_TOKEN:-}"\necho completed > ran.txt\n'
        )
        tests = [{"name": name, "script": f"{name}.sh", "feedback": "Fallback"}
                 for name in ("fail", "pass")]
        with patch.dict(os.environ, {"ACCEPTANCE_TOKEN": "must-not-leak"}):
            code, result, feedback = self.execute(tests)
        self.assertEqual(code, 1)
        self.assertEqual(result["sha"], "a" * 40)
        self.assertEqual([r["status"] for r in result["tests"]], ["fail", "pass"])
        self.assertEqual(result["tests"][0]["exit_code"], 7)
        self.assertIn("Improve concurrency handling", feedback)
        self.assertNotIn("Fallback", feedback)
        self.assertNotIn("private workload", feedback)
        log = (self.output / "test-1.log").read_text()
        self.assertIn("private workload details", log)
        self.assertIn("stderr detail", log)
        self.assertTrue((self.project / "ran.txt").is_file())

    def test_fallback_and_pipefail(self):
        (self.suite / "check.sh").write_text("false | true\n")
        code, result, feedback = self.execute([
            {"name": "check", "script": "check.sh", "feedback": "Budget not met"}
        ])
        self.assertEqual(code, 1)
        self.assertEqual(result["status"], "fail")
        self.assertIn("Budget not met", feedback)

    def test_timeout(self):
        (self.suite / "check.sh").write_text("sleep 60 &\nwait\n")
        code, result, feedback = self.execute([
            {"name": "check", "script": "check.sh", "feedback": "Too slow", "timeout_seconds": 1}
        ])
        self.assertEqual(code, 1)
        self.assertIn("Timed out after 1 seconds", feedback)

    def test_empty_suite_fails_closed(self):
        code, result, _ = self.execute([])
        self.assertEqual(code, 1)
        self.assertEqual(result["tests"][0]["status"], "error")

    def test_validation_precedes_execution(self):
        (self.suite / "check.sh").write_text("touch should-not-run\n")
        code, result, _ = self.execute([
            {"name": "valid", "script": "check.sh", "feedback": "Failure"},
            {"name": "invalid", "script": "../outside.sh", "feedback": "Failure"},
        ])
        self.assertEqual(code, 1)
        self.assertFalse((self.project / "should-not-run").exists())

    def test_success(self):
        (self.suite / "check.sh").write_text("true\n")
        code, result, _ = self.execute([
            {"name": "check", "script": "check.sh", "feedback": "Failure"}
        ])
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "pass")


if __name__ == "__main__":
    unittest.main()
