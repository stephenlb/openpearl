"""Collect per-issue pipeline metrics from the GitHub API into research/data/metrics.json + metrics.csv."""
import json, subprocess, re, csv, os, datetime as dt
D = os.path.join(os.path.dirname(__file__), "..", "data")
def gh(*a):
    r = subprocess.run(["gh", *a], capture_output=True, text=True)
    return json.loads(r.stdout) if r.stdout.strip() else None
def ts(s): return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() if s else None
recs = {}
for l in open(os.path.join(D, "issues.jsonl")):
    r = json.loads(l); recs[r["issue"]] = r
runs = gh("run", "list", "--workflow", "issue-to-pr.yml", "--limit", "300", "--json",
          "databaseId,displayTitle,conclusion,status,createdAt,updatedAt,startedAt,attempt,number") or []
by_title = {}
for x in runs: by_title.setdefault(x["displayTitle"], []).append(x)
rows = []
for num, r in sorted(recs.items()):
    iss = gh("issue", "view", str(num), "--json", "state,createdAt,closedAt,comments,title")
    text = "\n".join(c["body"] for c in iss["comments"])
    prm = re.search(r"/pull/(\d+)", text)
    pr = gh("pr", "view", prm.group(1), "--json", "additions,deletions,changedFiles,commits,createdAt,mergedAt,state,reviews,comments") if prm else None
    rr = by_title.get(iss["title"], [])
    run = max(rr, key=lambda x: x["createdAt"]) if rr else None
    dur = (ts(run["updatedAt"]) - ts(run["startedAt"])) if run else None
    rounds = re.findall(r"review-(\d+): (.*)", text)
    findings = sum(0 if "no issues" in t.lower() else 1 for _, t in rounds)
    row = dict(
        key=str(r["n"]) if str(r["n"])[0] in "FRX" else f"E{int(r['n']):02d}", issue=num, phase=r["phase"], kind=r["kind"],
        state=iss["state"], merged=bool(pr and pr["state"] == "MERGED"),
        run_conclusion=run and run["conclusion"], run_attempts=max([x["attempt"] for x in rr] or [0]), run_seconds=dur,
        issue_to_close_s=(ts(iss["closedAt"]) - ts(iss["createdAt"])) if iss["closedAt"] else None,
        pr_additions=pr and pr["additions"], pr_deletions=pr and pr["deletions"],
        pr_files=pr and pr["changedFiles"], pr_commits=pr and len(pr["commits"]),
        review_rounds=len(rounds), review_rounds_with_findings=findings,
        conflict_detected="Merge conflicts" in text and "detected" in text,
        conflict_resolved="conflicts" in text and "resolved and pushed" in text,
        conflict_unresolved="manual resolution required" in text.lower(),
        tests=(re.search(r"### Tests\s+(\w+)", text) or [0, None])[1],
        merge_retries=len(re.findall(r"Merge retry \d", text)),
        agent_admitted_not_running_tests=bool(re.search(r"(haven't|didn't|did not|have not|not) run (the )?tests", text, re.I)),
        comments=len(iss["comments"]), human_handoff="PR Ready for Review" in text,
        automerged="auto-merged" in text.lower(),
    )
    rows.append(row)
json.dump(rows, open(os.path.join(D, "metrics.json"), "w"), indent=1)
if rows:
    w = csv.DictWriter(open(os.path.join(D, "metrics.csv"), "w", newline=""), fieldnames=list(rows[0]))
    w.writeheader(); w.writerows(rows)
print(len(rows), "rows")
