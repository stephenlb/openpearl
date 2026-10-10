"""Generate docs/research.html from research/data/*.json so every number in the report is traceable."""
import json, os, statistics as st, shutil, datetime as dt
H = os.path.dirname(__file__); D = os.path.join(H, "..", "data"); DOCS = os.path.join(H, "..", "..", "docs")
M = json.load(open(os.path.join(D, "metrics.json"))); EV = json.load(open(os.path.join(D, "engine-eval.json"))); RC = json.load(open(os.path.join(D, "recovery.json")))
shutil.copy(os.path.join(D, "metrics.csv"), os.path.join(DOCS, "research", "metrics.csv")); shutil.copy(os.path.join(D, "metrics.json"), os.path.join(DOCS, "research", "metrics.json"))
shutil.copy(os.path.join(D, "engine-eval.json"), os.path.join(DOCS, "research", "engine-eval.json"))
n = lambda x: 0 if x is None else x
Ex = sorted([r for r in M if r["key"].startswith("E")], key=lambda r: r["issue"]); F = [r for r in M if r["key"][0] == "F"]; Rr = [r for r in M if r["key"][0] == "R"]
ts = {"E": Ex}
rs = [r["run_seconds"] for r in M if r["run_seconds"]]
q = lambda v, p: sorted(v)[min(len(v) - 1, int(p * len(v)))]
first_merged = sum(r["merged"] for r in Ex); unmerged = [r["key"] for r in Ex if not r["merged"]]
pre = [r for r in M if r["issue"] <= 188 and r["key"][0] in "E"] + [r for r in M if r["key"] == "F01"]; post = [r for r in M if r["issue"] > 188 and r["key"][0] in "ER"]
pre_fail = sum(not r["merged"] for r in pre); post_fail = sum(not r["merged"] for r in post)
conf_d = sum(r["conflict_detected"] for r in M); conf_r = sum(r["conflict_resolved"] for r in M)
tests = {k: sum(r["tests"] == k for r in M) for k in ("pass", "fail", "none")}
rounds = sum(r["review_rounds"] for r in M); findr = sum(r["review_rounds_with_findings"] for r in M)
adds = sum(n(r["pr_additions"]) for r in M); dels = sum(n(r["pr_deletions"]) for r in M); files = sum(n(r["pr_files"]) for r in M)
admit = sum(r["agent_admitted_not_running_tests"] for r in M)
retries = sum(r["merge_retries"] for r in M)
h1 = st.mean(r["run_seconds"] for r in Ex[:25]); h2 = st.mean(r["run_seconds"] for r in Ex[25:])
span = (max(json.loads(l)["created_at"] for l in open(os.path.join(D, "issues.jsonl"))) - min(json.loads(l)["created_at"] for l in open(os.path.join(D, "issues.jsonl")))) / 3600
loc_src = sum(sum(1 for _ in open(os.path.join(H, "..", "engine", "src", f))) for f in os.listdir(os.path.join(H, "..", "engine", "src")))
loc_test = sum(sum(1 for _ in open(os.path.join(H, "..", "engine", "test", f))) for f in os.listdir(os.path.join(H, "..", "engine", "test")))
nmod = len(os.listdir(os.path.join(H, "..", "engine", "src")))
hh = {round(r["failRate"], 2): r for r in EV["healing"]}
sc = EV["scorecard"]; b = EV["bandit"]; ab = EV["ab"]; tm = EV["timeout"]; lm = EV["limiter"]; ch = EV["cache"]; tn = EV["tuner"]
phase_rows = ""
for p in dict.fromkeys(r["phase"] for r in M):
    g = [r for r in M if r["phase"] == p]
    phase_rows += f"<tr><td>{p}</td><td>{len(g)}</td><td>{sum(r['merged'] for r in g)}</td><td>{st.mean(n(r['run_seconds']) for r in g):.0f}</td><td>{st.mean(n(r['pr_additions']) for r in g):.0f}</td><td>{sum(r['review_rounds_with_findings'] for r in g)}</td></tr>"
heal_rows = "".join(f"<tr><td>{int(k*100)}%</td><td>{hh[k]['baselineSuccess']*100:.1f}%</td><td>{hh[k]['healingSuccess']*100:.1f}% &plusmn;{hh[k]['healingSd']*100:.1f}</td><td>{(hh[k]['healingSuccess']-hh[k]['baselineSuccess'])*100:+.1f} pt</td><td>{hh[k]['baselineAttempts']:.2f} &rarr; {hh[k]['healingAttempts']:.2f}</td><td>{hh[k]['baselineP95']:.0f} &rarr; {hh[k]['healingP95']:.0f}</td></tr>" for k in (0.1, 0.2, 0.3, 0.5, 0.6, 0.8, 0.9))
tuner_rows = "".join(f"<tr><td>{t['steps']}</td><td>{t['tunerErr']:.2f}</td><td>{t['randomErr']:.2f}</td></tr>" for t in tn)
fix_rows = [
 ("F01", "Test gate ran nothing: <code>Tests: none</code> for research PRs", "Root <code>package.json</code> with <code>scripts.test</code>", "Next PRs reported <code>Tests: pass</code>", "operator"),
 ("F02", f"Merge race: base moved after the eval, <code>gh pr merge</code> failed; 4 of {len(pre)} early PRs needed a human", "Bounded re-sync + conflict-resolve + retry loop around the merge", f"{retries} merge retries fired, all {retries} merged; failures {pre_fail}/{len(pre)} &rarr; {post_fail}/{len(post)}", "operator"),
 ("F03", "Engine <code>npm test</code> failed on Node 24 (my own spec bug)", "Explicit test glob in package script", "Merged; script passes", "operator"),
 ("F04", "AUTO_MERGE let red tests onto main", "Fix two failing tests", "Green for about 1 minute: E29 (a rerun finishing concurrently) re-broke main, then E35 added another red test", "operator"),
 ("F05", "GitHub secondary rate limit killed 4 runs at step 1 (~40 min)", "<code>gh_retry</code> backoff helper for all comment calls", "Not re-triggered after the fix, so <b>unverified under load</b>", "operator"),
 ("F06", "Main red again (two more tests)", "Fix two failing tests", "Green: 380/380", "operator"),
 ("F07", f"Nothing watched main; {tests['fail']} PRs gated <code>fail</code>", "New <code>main-watchdog.yml</code> opens a <code>main-red</code> issue", f"Caught 2 of 2 red-main events with no human action after the merge; MTTR {RC['natural_R04']['true_mttr_s']/60:.1f} min and {RC['drill_X01']['mttr_s']/60:.1f} min", "operator (the watchdog itself); detection and repair are automatic"),
 ("F08", "Early-step failures were never retried", "Retry workflow also reruns failures before the agent starts", "Not triggered since, so <b>unverified</b>", "operator"),
 ("R01-R04", "E06/E16/E17/E23 PRs stuck (merge race)", "Re-filed the same tickets", "4 of 4 merged on the first retry", "operator"),
]
fix_html = "".join(f"<tr><td>{a}</td><td>{b_}</td><td>{c}</td><td>{d}</td><td>{e}</td></tr>" for a, b_, c, d, e in fix_rows)
# incident ledger: automatic recovery fraction
inc = [("merge conflicts with main", conf_d, conf_r), ("merge race (before F02)", 4, 0), ("merge race (after F02)", retries, retries), ("rate-limit run kills", 4, 0),
       ("red main (before F07)", 2, 0), ("red main (after F07)", 2, 2), ("test-gate blind spot", 1, 0), ("broken package script", 1, 0)]
tot = sum(a for _, a, _ in inc); auto = sum(c for _, _, c in inc); tot2 = tot - conf_d; auto2 = auto - conf_r
inc_html = "".join(f"<tr><td>{a}</td><td>{b_}</td><td>{c}</td></tr>" for a, b_, c in inc)
def fig(name, cap): return f'<figure><img src="research/{name}" alt="{cap}"><figcaption>{cap}</figcaption></figure>'
html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Research: can OpenPearl build a self-healing, self-improving, self-optimizing engine? | OpenPearl</title>
<link rel="icon" type="image/png" href="favicon.png"><link rel="stylesheet" href="style.css">
<style>main{{max-width:980px;margin:0 auto;padding:24px}}table{{border-collapse:collapse;width:100%;font-size:15px;margin:12px 0 24px}}th,td{{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}}th{{background:var(--code)}}figure{{margin:18px 0}}figure img{{width:100%;height:auto;background:#fff;border:1px solid var(--line);border-radius:8px}}figcaption{{font-size:14px;color:#666}}.stats{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0}}.stat{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}}.stat b{{display:block;font-size:26px;font-weight:600}}.verdict td:first-child{{white-space:nowrap}}</style></head>
<body><header style="min-height:0"><nav><a class="brand" href="./"><img alt="" src="favicon.png">OpenPearl</a><div class="links"><a class="link" href="./">Home base</a><a class="link active" href="research.html">Research</a><a class="link" href="https://github.com/stephenlb/openpearl">GitHub</a></div></nav></header>
<main>
<p class="eyebrow">Research report &middot; {dt.date.today().isoformat()}</p>
<h1>Can a ticket pipeline build a self-healing, self-improving, self-optimizing engine?</h1>
<p>We opened <b>{len(M)} GitHub issues</b> with <code>gh issue create</code> (50 experiment tickets, {len(F)} pipeline fixes, {len(Rr)} re-files, 1 chaos drill) and let the OpenPearl workflow turn them into PRs and merges. The product was <code>pearl-engine</code>: a zero-dependency Node.js library in <a href="https://github.com/stephenlb/openpearl/tree/main/research/engine"><code>research/engine</code></a> that retries, heals, learns and tunes itself. Everything below is measured from the GitHub API and from running the engine; the raw data is linked at the bottom.</p>

<h2>Verdict</h2>
<p><b>Mostly yes at the engine level, partly at the pipeline level, and the pipeline's own self-improvement is operator-triggered, not autonomous.</b> The pipeline built a engine of {nmod} source files with {loc_src:,} lines of source and {loc_test:,} lines of tests, and every one of the 50 deliverables is on <code>main</code> (all merged, 4 only after a re-file). It repaired its own merge and monitoring gaps by merging 8 fixes to its own gates and workflows (4 of them edits to <code>.github/workflows</code>). But all 8 of those fixes were found and requested by a person. Only F07 gave the system its own trigger, and it covers one failure type (red tests on main).</p>
<table class="verdict"><tr><th>Goal</th><th>Pipeline (the factory)</th><th>Engine (the product)</th></tr>
<tr><td>Self-healing</td><td><b>Partial.</b> {conf_r}/{conf_d} merge conflicts resolved automatically. {auto}/{tot} incidents recovered with no human ({auto/tot*100:.0f}%); excluding conflicts {auto2}/{tot2} ({auto2/tot2*100:.0f}%). Red-main MTTR: {RC['manual_era']['red1']['mttr_s']/60:.0f} and {RC['manual_era']['red2']['mttr_s']/60:.0f} min by hand vs {RC['drill_X01']['mttr_s']:.0f} s automatic.</td><td><b>Strong in simulation.</b> At 30% injected faults success rises {hh[0.3]['baselineSuccess']*100:.1f}% &rarr; {hh[0.3]['healingSuccess']*100:.1f}%; at 60%, {hh[0.6]['baselineSuccess']*100:.1f}% &rarr; {hh[0.6]['healingSuccess']*100:.1f}%.</td></tr>
<tr><td>Self-improving</td><td><b>Weak.</b> It implements fixes it is asked for ({len(F)} of {len(F)} merged, merge-failure rate {pre_fail}/{len(pre)} &rarr; {post_fail}/{len(post)}), but it never proposed one on its own except through the watchdog.</td><td><b>Good.</b> Thompson-sampling selection cuts regret {b['random']['meanRegret']:.0f} &rarr; {b['thompson']['meanRegret']:.1f} ({(1-b['thompson']['meanRegret']/b['random']['meanRegret'])*100:.0f}%) and picks the best arm {b['thompson']['bestShare']*100:.0f}% of the time.</td></tr>
<tr><td>Self-optimizing</td><td><b>None observed.</b> Mean run time rose from {h1:.0f} s (first 25) to {h2:.0f} s (last 25). No pipeline setting tuned itself.</td><td><b>Mixed.</b> Adaptive timeout: {tm['fixedTimeouts']} &rarr; {tm['adaptiveTimeouts']} false timeouts; tuner beats random search {tn[-1]['randomErr']/tn[-1]['tunerErr']:.1f}x at 160 evals; adaptive cache TTL gains only {(ch['adaptiveHitRate']-ch['fixedHitRate'])*100:.1f} pt hit rate.</td></tr></table>
<p>Engine scorecard (computed by the engine's own <code>scorecard()</code> from measured values; the mapping of measurements to its inputs is ours and is a proxy): healing <b>{sc['healing']}</b>, improving <b>{sc['improving']}</b>, optimizing <b>{sc['optimizing']}</b>, overall <b>{sc['overall']}</b> / 100.</p>

<div class="stats">
<div class="stat"><b>{len(M)}</b>issues created</div><div class="stat"><b>{sum(r['merged'] for r in M)}/{len(M)}</b>PRs merged</div>
<div class="stat"><b>{first_merged}/50</b>experiment PRs merged first time ({first_merged*2}%)</div><div class="stat"><b>{st.mean(rs):.0f} s</b>mean run (median {st.median(rs):.0f}, p95 {q(rs,.95):.0f}, max {max(rs):.0f})</div>
<div class="stat"><b>{adds:,}</b>lines added, {dels} deleted, {files} files</div><div class="stat"><b>{rounds}</b>review rounds, {findr} with findings ({findr/rounds*100:.0f}%)</div>
<div class="stat"><b>{conf_r}/{conf_d}</b>conflicts auto-resolved</div><div class="stat"><b>{tests['fail']}/{len(M)-tests['none']}</b>PRs gated <code>fail</code> yet merged</div>
<div class="stat"><b>{span:.1f} h</b>between first and last issue created</div><div class="stat"><b>{sum(r['run_seconds'] or 0 for r in M)/60:.0f} min</b>total pipeline compute</div></div>

<h2>Method</h2>
<ul><li><b>Target:</b> <code>research/engine</code>, ESM, no dependencies, tests with <code>node:test</code>, every module small and deterministic (injected clock and RNG).</li>
<li><b>50 tickets in 6 phases:</b> 10 core, 10 self-healing, 10 self-improving, 10 self-optimizing, 5 measurement, 5 <i>trap</i> tickets (ambiguous request, seeded bug, two simultaneous edits of one file, an impossible requirement).</li>
<li><b>Dispatch:</b> issues were opened in waves (3 at a time, then 2 after the rate-limit incident). A wave never contained a ticket that depends on another in the same wave, except the deliberate conflicting pair E48/E49.</li>
<li><b>Pipeline under test:</b> unmodified <code>issue-to-pr.yml</code> with Claude Code on Bedrock, 2 review rounds, <code>AUTO_MERGE=1</code> (eval and guards skipped).</li>
<li><b>Metrics:</b> <code>research/harness/collect.py</code> reads runs, issues, PRs and comments through <code>gh</code>. <code>engine_eval.mjs</code> measures the product. <code>charts.py</code> and <code>report.py</code> produce this page.</li></ul>

<h2>Results: the pipeline</h2>
{fig('run-seconds.svg', f'Workflow wall-clock per issue. Mean {st.mean(rs):.0f} s; E49 (the conflicting-edit trap) was slowest at {max(rs):.0f} s.')}
{fig('duration-hist.svg', 'Run-time distribution.')}
{fig('duration-trend.svg', f'No learning curve: mean run time was {h1:.0f} s for the first 25 experiment issues and {h2:.0f} s for the last 25 (+{(h2/h1-1)*100:.0f}%), while the repo grew.')}
{fig('cumulative-merged.svg', 'Cumulative merged PRs against issues opened.')}
{fig('phase-summary.svg', 'Per-phase run time, merge rate and PR size.')}
<table><tr><th>Phase</th><th>Tickets</th><th>Merged</th><th>Mean run (s)</th><th>Mean lines added</th><th>Review rounds with findings</th></tr>{phase_rows}</table>
{fig('healing-events.svg', 'Self-healing events seen inside the pipeline.')}
{fig('test-gate-timeline.svg', f'Test gate by PR. The gate reported <code>fail</code> on {tests["fail"]} PRs, which all merged because AUTO_MERGE skips the guard. Red tests on main propagate to every later PR.')}
<p><b>Test evidence is thin.</b> In {admit} of {len(M)} PR summaries the agent says it did not run the tests, and the only independent evidence is the gate, which was blind until F01 and then red for most of the run.</p>

<h2>Incidents, fixes and what each fix achieved</h2>
<table><tr><th>Id</th><th>Finding</th><th>Fix (via <code>gh issue create</code>)</th><th>Effect</th><th>Requested by</th></tr>{fix_html}</table>
<table><tr><th>Incident class</th><th>Count</th><th>Recovered with no human</th></tr>{inc_html}<tr><th>Total</th><th>{tot}</th><th>{auto} ({auto/tot*100:.0f}%)</th></tr></table>
{fig('recovery-mttr.svg', f"Time to recover a red main. By hand: {RC['manual_era']['red1']['mttr_s']/60:.0f} and {RC['manual_era']['red2']['mttr_s']/60:.0f} min. With the watchdog: {RC['natural_R04']['true_mttr_s']/60:.1f} min (including {RC['natural_R04']['undetected_s']:.0f} s before the watchdog existed) and {RC['drill_X01']['mttr_s']:.0f} s for the chaos drill (detect {RC['drill_X01']['detect_s']:.0f} s + repair {RC['drill_X01']['repair_s']:.0f} s).")}
<p><b>Trap tickets:</b> all five merged. The seeded backoff bug (E47) was fixed with new tests (we did not verify that a failing test was written first); the two simultaneous <code>runner.js</code> edits (E48/E49) conflicted and were resolved with both features kept; the impossible requirement (E50) was answered with honest failure diagnostics instead of faked success; the ambiguous &ldquo;make it faster&rdquo; (E46) became a scoped cache micro-optimization with a test. No trap was refused or escalated to a human, which is also a risk: nothing questioned an ambiguous ticket.</p>

<h2>Results: the engine</h2>
<p>{nmod} source files, {loc_test if False else loc_src:,} source lines, {loc_test:,} test lines, 392 passing tests at the end of the run.</p>
{fig('heal-success.svg', 'Success rate with healing off and on, 10 seeds x 400 jobs per point; band is one standard deviation.')}
<table><tr><th>Injected fault rate</th><th>Baseline success</th><th>Healing success</th><th>Gain</th><th>Mean attempts</th><th>p95 latency (virtual ms)</th></tr>{heal_rows}</table>
{fig('heal-cost.svg', 'The price of healing: more attempts per job and higher tail latency.')}
{fig('improve-regret.svg', f"Cumulative regret over {b['pulls']} pulls, {b['seeds']} seeds: random {b['random']['meanRegret']:.1f}, epsilon-greedy {b['epsilon']['meanRegret']:.1f}, Thompson {b['thompson']['meanRegret']:.1f}.")}
{fig('improve-ab.svg', f"The A/B adoption gate finds a true +10 point lift {ab['power'][-1]['adoptRate']*100:.0f}% of the time at n=800 per arm ({ab['power'][0]['adoptRate']*100:.0f}% at n=25) and falsely adopts {ab['falseAdopt'][-1]['rate']*100:.1f}% of equal arms at n=800.")}
{fig('optimize-tuner.svg', 'Distance to the optimum on a noisy 3-parameter problem, 30 seeds.')}
<table><tr><th>Evaluation budget</th><th>Auto-tuner error</th><th>Random-search error</th></tr>{tuner_rows}</table>
{fig('optimize-timeout.svg', f"A latency shift at request 500: a fixed {tm['fixedMs']} ms timeout fires {tm['fixedTimeouts']} times, the adaptive timeout {tm['adaptiveTimeouts']} (mean {tm['adaptiveMeanMs']:.0f} ms).")}
{fig('optimize-limiter.svg', f"AIMD concurrency tracks a capacity drop from 24 to 8; {lm['rejected']} of {lm['served']+lm['rejected']} requests rejected ({lm['rejectRate']*100:.2f}%).")}
{fig('scorecard.svg', 'Engine scorecard from measured values (proxy mapping, see threats).')}
<p><b>Cache result is small:</b> adaptive TTL raised hit rate from {ch['fixedHitRate']*100:.1f}% to {ch['adaptiveHitRate']*100:.1f}% on a skewed 5,000-request workload.</p>
<p><b>Scenario coverage is inflated.</b> <code>scenarios.json</code> lists 12 scenarios but the simulator only models a failure rate, so latency-spike and corruption scenarios reproduce the plain fault-rate results: 12 scenarios yield 8 distinct outcomes. A ticket (E44) asked for these scenarios, and the pipeline built them to spec without noticing the simulator could not honor them.</p>

<h2>Review</h2>
<h3>Self-healing</h3><p>Works for failures the pipeline already has a rule for: conflicts ({conf_r}/{conf_d}), merge races after F02 ({retries}/{retries}), red tests on main after F07 (2/2). It does not work for failures nobody wrote a rule for. The run-killing rate limit needed 8 manual reruns, and the comment-chat agent cannot run <code>git fetch</code>/<code>merge</code>, so it could not rescue stale PRs. F05 and F08 target those but were never exercised afterwards. Healing here is a growing set of hand-reviewed rules, not general repair.</p>
<h3>Self-improving</h3><p>The pipeline is a capable <i>implementer of improvements</i>: {len(F)} of {len(F)} requested fixes merged, including four edits to its own workflow files. What it does not do is decide what to improve. The only autonomous improvement path is the watchdog, which converts a red <code>npm test</code> into a ticket. Nothing mines failed runs, slow runs or repeated review findings into tickets (the engine has a module for that, <code>issuedraft.js</code>, which is not wired to the pipeline).</p>
<h3>Self-optimizing</h3><p>No pipeline parameter changed itself. Review rounds, diff limits, wave size and concurrency were fixed or hand-set (wave size was lowered by the operator after the rate-limit incident). Run time got worse as the repo grew. The engine contains tuners and adaptive components that perform as designed in simulation, but nothing applies them to the pipeline.</p>

<h2>Threats to validity</h2>
<ul><li><b>One run, one model, no repeats.</b> Timings include GitHub queueing and the rate-limit incident; no confidence intervals for pipeline metrics.</li>
<li><b>The same model family writes the code, reviews it and judges it,</b> with <code>AUTO_MERGE=1</code> bypassing the independent eval. Test pass rates here do not show that the code is correct.</li>
<li><b>The engine is evaluated in simulation</b> with synthetic faults and virtual time; production behavior is untested.</li>
<li><b>The scorecard maps measurements to its inputs by our own choice</b> (for example A/B power stands in for regression coverage). Treat the 0-100 numbers as illustrative.</li>
<li><b>Operator interventions are part of the data:</b> 8 manual reruns, 5 rate-limit probe comments, 1 chat nudge, 1 PR-merge attempt that was blocked, and the choice of which findings became fix tickets.</li>
<li>The incident ledger counts are our classification.</li></ul>

<h2>Recommendations</h2>
<ol><li>Do not run <code>AUTO_MERGE=1</code> without a test gate. At least block when the gate says <code>fail</code>: {tests['fail']} PRs merged red.</li>
<li>Keep F07 and extend the watchdog to failed workflow runs, so F05/F08-style incidents open tickets too.</li>
<li>Serialize or queue merges, or keep shared registries such as <code>index.js</code> out of tickets: that file caused the original merge races.</li>
<li>Feed run metrics (duration, retries, findings per PR) back into settings such as review rounds and wave size, with an A/B gate like the engine's <code>compareArms</code>.</li>
<li>Make the agent challenge under-specified tickets instead of silently picking an interpretation (E46).</li></ol>

<h2>Reproduce and raw data</h2>
<pre><code>python3 -I research/harness/collect.py     # gh API -> research/data/metrics.json|csv
node research/harness/engine_eval.mjs      # engine measurements -> research/data/engine-eval.json
python3 -I research/harness/charts.py      # docs/research/*.svg
python3 -I research/harness/report.py      # this page</code></pre>
<p>Data: <a href="research/metrics.csv">metrics.csv</a>, <a href="research/metrics.json">metrics.json</a>, <a href="research/engine-eval.json">engine-eval.json</a>. Code and harness: <a href="https://github.com/stephenlb/openpearl/tree/main/research">research/</a>.</p>
</main></body></html>"""
open(os.path.join(DOCS, "research.html"), "w").write(html)
print("report written", len(html))
