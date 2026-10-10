"""Create experiment issues with `gh issue create` in waves and wait for the pipeline to finish each wave.
usage: drive.py <first_index> <last_index>   (1-based, inclusive)  -- waves are split at BREAKS and wave size WAVE."""
import json, subprocess, sys, time, os
sys.path.insert(0, os.path.dirname(__file__))
from plan import P, PRE
WAVE = 2
BREAKS = {12, 20, 40, 47}   # never put index i and i+1 in the same wave (i+1 depends on i); 1-based i
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "issues.jsonl")
def sh(*a):
    return subprocess.run(a, capture_output=True, text=True)
def waves(lo, hi):
    w, out = [], []
    for i in range(lo, hi + 1):
        w.append(i)
        if len(w) == WAVE or i in BREAKS or i == 1 or (i == 49 and False):
            out.append(w); w = []
    if w: out.append(w)
    return out
def create(i):
    phase, title, spec, kind = P[i - 1]
    body = PRE + f"## Task\n{spec}\n\n## Acceptance\n- Tests added and passing\n- Only `research/engine/` touched\n- Experiment id: E{i:02d} (phase: {phase}, kind: {kind})\n"
    r = sh("gh", "issue", "create", "--title", f"[E{i:02d}] {title}", "--body", body)
    if r.returncode: raise SystemExit(r.stderr)
    url = r.stdout.strip().splitlines()[-1]
    rec = dict(n=i, issue=int(url.rsplit("/", 1)[1]), url=url, title=title, phase=phase, kind=kind, created_at=time.time())
    open(OUT, "a").write(json.dumps(rec) + "\n")
    print("created", rec, flush=True)
    return rec
def done(num):
    try:
        j = json.loads(sh("gh", "issue", "view", str(num), "--json", "state,comments").stdout)
    except ValueError:
        return False  # transient gh/network failure: poll again
    txt = " ".join(c["body"] for c in j["comments"])
    return j["state"] == "CLOSED" or "PR Auto-Merged" in txt or "PR Ready for Review" in txt or "failed" in txt.lower() and "workflow run" in txt.lower() and False
def run_failed(num):
    r = json.loads(sh("gh", "run", "list", "--workflow", "issue-to-pr.yml", "--limit", "100", "--json", "displayTitle,status,conclusion").stdout)
    rs = [x for x in r if x["displayTitle"].startswith(f"[E")]  # filtered below by title
    return rs
if __name__ == "__main__":
    lo, hi = int(sys.argv[1]), int(sys.argv[2])
    for w in waves(lo, hi):
        recs = [create(i) for i in w]
        t0 = time.time()
        pending = {r["issue"] for r in recs}
        while pending and time.time() - t0 < 75 * 60:
            time.sleep(45)
            for n in list(pending):
                if done(n): pending.discard(n); print("finished", n, f"{time.time()-t0:.0f}s", flush=True)
        if pending: print("TIMEOUT waiting for", pending, flush=True)
        time.sleep(20)
