#!/usr/bin/env python3
"""Run trusted Bash acceptance scripts against a candidate checkout."""

import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile


def run(manifest, project, output, sha=None):
    output.mkdir(parents=True, exist_ok=True)
    results = []
    try:
        suite = json.loads(manifest.read_text())
        if not isinstance(suite, dict) or set(suite) != {"version", "tests"} or type(suite["version"]) is not int or suite["version"] != 1:
            raise ValueError("Expected version 1 and a tests array")
        if not isinstance(suite["tests"], list) or not suite["tests"]:
            raise ValueError("Suite must contain at least one test")
        tests = []
        names = set()
        for test in suite["tests"]:
            if not isinstance(test, dict) or set(test) - {"name", "script", "timeout_seconds", "feedback"}:
                raise ValueError("Unknown test fields")
            for key in ("name", "script", "feedback"):
                if not isinstance(test.get(key), str) or not test[key].strip():
                    raise ValueError(f"Each test needs a nonempty {key}")
            if test["name"] in names:
                raise ValueError("Test names must be unique")
            names.add(test["name"])
            timeout = test.get("timeout_seconds", 300)
            if type(timeout) is not int or not 1 <= timeout <= 3600:
                raise ValueError("timeout_seconds must be an integer from 1 to 3600")
            script = (manifest.parent / test["script"]).resolve()
            if not script.is_relative_to(manifest.parent.resolve()) or not script.is_file():
                raise ValueError("Scripts must be files inside the suite directory")
            tests.append((test, script, timeout))

        for index, (test, script, timeout) in enumerate(tests, 1):
            log = output / f"test-{index}.log"
            # The writable feedback file is separate from the retained stdout/stderr log.
            with tempfile.TemporaryDirectory(prefix="acceptance-feedback-") as temp:
                feedback = Path(temp) / "feedback.txt"
                env = {
                    "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
                    "HOME": os.environ.get("HOME", temp),
                    "CI": "true",
                    "OPENPEARL_PROJECT_DIR": str(project),
                    "OPENPEARL_SUITE_DIR": str(manifest.parent.resolve()),
                    "OPENPEARL_FEEDBACK_FILE": str(feedback),
                }
                timed_out = False
                with log.open("w") as stream:
                    process = subprocess.Popen(
                        ["bash", "-e", "-o", "pipefail", str(script)],
                        cwd=project, env=env, stdout=stream,
                        stderr=subprocess.STDOUT, start_new_session=True,
                    )
                    try:
                        code = process.wait(timeout=timeout)
                    except subprocess.TimeoutExpired:
                        timed_out = True
                        code = -1
                    finally:
                        # Also stop background servers left behind by a completed script.
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        process.wait()
                message = ""
                if code != 0:
                    message = test["feedback"]
                    if feedback.is_file():
                        custom = feedback.read_text(errors="replace").strip()
                        if custom:
                            message = custom[:12000]
                    if timed_out:
                        message = f"Timed out after {timeout} seconds. {message}"
                results.append({"name": test["name"], "status": "pass" if code == 0 else "fail",
                                "feedback": message, "exit_code": code, "log": log.name})
    except (ValueError, OSError, TypeError) as error:
        results.append({"name": "Acceptance infrastructure", "status": "error",
                        "feedback": f"Could not run acceptance suite: {error}"})

    status = "pass" if results and all(r["status"] == "pass" for r in results) else "fail"
    (output / "result.json").write_text(json.dumps({"status": status, "sha": sha, "tests": results}, indent=2) + "\n")
    lines = [f"## Acceptance tests: {status.upper()}", ""]
    for result in results:
        lines.append(f"### {result['name']}: {result['status'].upper()}")
        if result["feedback"]:
            lines.extend(["", result["feedback"]])
        lines.append("")
    (output / "feedback.md").write_text("\n".join(lines))
    print("\n".join(lines))
    return 0 if status == "pass" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sha", help="Candidate SHA recorded in the report")
    args = parser.parse_args()
    sys.exit(run(args.manifest.resolve(), args.project.resolve(), args.output.resolve(), args.sha))
