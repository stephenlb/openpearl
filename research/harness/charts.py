"""Render charts (SVG) from research/data/metrics.json into docs/research/."""
import json, os, statistics as st
import matplotlib; matplotlib.use("svg")
import matplotlib.pyplot as plt
H = os.path.dirname(__file__); D = os.path.join(H, "..", "data"); O = os.path.join(H, "..", "..", "docs", "research")
os.makedirs(O, exist_ok=True)
plt.rcParams.update({"svg.fonttype": "none", "font.family": "sans-serif", "axes.spines.top": False, "axes.spines.right": False,
                     "axes.grid": True, "grid.alpha": .25, "figure.dpi": 100})
rows = json.load(open(os.path.join(D, "metrics.json")))
COL = {"core": "#2a7de1", "heal": "#1baf6b", "improve": "#9a5fd1", "optimize": "#e8912d", "measure": "#d6455d", "trap": "#555555", "fix": "#c9a400"}
def save(fig, name): fig.tight_layout(); fig.savefig(os.path.join(O, name)); plt.close(fig)
def num(v): return v if isinstance(v, (int, float)) else 0
x = list(range(len(rows))); keys = [r["key"] for r in rows]; cols = [COL[r["phase"]] for r in rows]
def legend(ax):
    from matplotlib.patches import Patch
    ax.legend(handles=[Patch(color=c, label=p) for p, c in COL.items()], ncol=4, fontsize=8, frameon=False)
def bars(field, title, ylabel, name, fmt="{:.0f}"):
    fig, ax = plt.subplots(figsize=(11, 4)); v = [num(r[field]) for r in rows]
    ax.bar(x, v, color=cols); ax.set_xticks(x); ax.set_xticklabels(keys, rotation=90, fontsize=7)
    ax.axhline(st.mean(v), color="#222", ls="--", lw=1); ax.text(len(x) - 1, st.mean(v), f" mean {fmt.format(st.mean(v))}", fontsize=8, va="bottom", ha="right")
    ax.set_title(title); ax.set_ylabel(ylabel); legend(ax); save(fig, name)
bars("run_seconds", "Pipeline wall-clock per issue (workflow run)", "seconds", "run-seconds.svg")
bars("pr_additions", "Lines added per PR", "lines", "pr-additions.svg")
bars("pr_files", "Files changed per PR", "files", "pr-files.svg")
# cumulative merged
fig, ax = plt.subplots(figsize=(7, 4)); cum = 0; ys = []
for r in rows: cum += 1 if r["merged"] else 0; ys.append(cum)
ax.plot(range(1, len(rows) + 1), ys, lw=2, color="#1baf6b", label="merged PRs"); ax.plot(range(1, len(rows) + 1), range(1, len(rows) + 1), ls=":", color="#888", label="ideal (100%)")
ax.set_xlabel("issues opened (in order)"); ax.set_ylabel("count"); ax.set_title("Cumulative auto-merged PRs vs issues opened"); ax.legend(frameon=False); save(fig, "cumulative-merged.svg")
# phase summary
phases = list(dict.fromkeys(r["phase"] for r in rows)); fig, axs = plt.subplots(1, 3, figsize=(12, 3.8))
def agg(f): return [f([r for r in rows if r["phase"] == p]) for p in phases]
axs[0].bar(phases, agg(lambda g: st.mean(num(r["run_seconds"]) for r in g)), color=[COL[p] for p in phases]); axs[0].set_title("Mean run seconds")
axs[1].bar(phases, agg(lambda g: 100 * sum(r["merged"] for r in g) / len(g)), color=[COL[p] for p in phases]); axs[1].set_title("Merge rate %"); axs[1].set_ylim(0, 105)
axs[2].bar(phases, agg(lambda g: st.mean(num(r["pr_additions"]) for r in g)), color=[COL[p] for p in phases]); axs[2].set_title("Mean lines added")
for a in axs: a.tick_params(axis="x", labelrotation=30)
save(fig, "phase-summary.svg")
# histogram of durations
fig, ax = plt.subplots(figsize=(7, 4)); v = [num(r["run_seconds"]) for r in rows]; ax.hist(v, bins=12, color="#2a7de1")
for q, c in ((.5, "#222"), (.95, "#d6455d")):
    qv = sorted(v)[min(len(v) - 1, int(q * len(v)))]; ax.axvline(qv, color=c, ls="--"); ax.text(qv, ax.get_ylim()[1] * .9, f" p{int(q*100)}={qv:.0f}s", color=c, fontsize=8)
ax.set_title("Distribution of pipeline run time"); ax.set_xlabel("seconds"); ax.set_ylabel("issues"); save(fig, "duration-hist.svg")
# time trend (learning curve) : run seconds vs sequence with rolling mean
fig, ax = plt.subplots(figsize=(8, 4)); v = [num(r["run_seconds"]) for r in rows]; ax.scatter(range(1, len(v) + 1), v, c=cols, s=25)
k = 5; rm = [st.mean(v[max(0, i - k + 1):i + 1]) for i in range(len(v))]; ax.plot(range(1, len(v) + 1), rm, color="#222", lw=1.5, label=f"rolling mean ({k})")
ax.set_xlabel("issue sequence"); ax.set_ylabel("seconds"); ax.set_title("Run time trend (self-optimizing signal)"); ax.legend(frameon=False); save(fig, "duration-trend.svg")
# review findings + conflicts
fig, ax = plt.subplots(figsize=(9, 3.8)); cats = ["review rounds", "rounds with findings", "conflicts detected", "conflicts resolved", "human handoffs", "extra run attempts"]
vals = [sum(num(r["review_rounds"]) for r in rows), sum(num(r["review_rounds_with_findings"]) for r in rows), sum(r["conflict_detected"] for r in rows),
        sum(r["conflict_resolved"] for r in rows), sum(r["human_handoff"] for r in rows), sum(max(0, num(r["run_attempts"]) - 1) for r in rows)]
ax.barh(cats, vals, color="#9a5fd1"); [ax.text(v, i, f" {v}", va="center", fontsize=9) for i, v in enumerate(vals)]
ax.set_title("Self-healing events inside the pipeline"); save(fig, "healing-events.svg")
print("charts written", len(os.listdir(O)))

# test-gate timeline in issue order (red-main propagation)
srt = sorted(rows, key=lambda r: r["issue"]); fig, ax = plt.subplots(figsize=(12, 2.6))
tc = {"pass": "#1baf6b", "fail": "#d6455d", "none": "#bbbbbb", None: "#bbbbbb"}
ax.bar(range(len(srt)), [1] * len(srt), color=[tc.get(r["tests"], "#bbb") for r in srt], width=.9)
ax.set_xticks(range(len(srt))); ax.set_xticklabels([r["key"] for r in srt], rotation=90, fontsize=6); ax.set_yticks([])
ax.set_title("Test gate per PR in issue order: red main contaminates later PRs"); ax.grid(False); save(fig, "test-gate-timeline.svg")
# ---------- engine-level charts ----------
E = json.load(open(os.path.join(D, "engine-eval.json")))
h = E["healing"]; fr = [r["failRate"] * 100 for r in h]
fig, ax = plt.subplots(figsize=(7.5, 4.2))
ax.plot(fr, [r["baselineSuccess"] * 100 for r in h], "o-", color="#d6455d", label="baseline (no healing)")
ax.plot(fr, [r["healingSuccess"] * 100 for r in h], "o-", color="#1baf6b", label="healing on")
ax.fill_between(fr, [(r["healingSuccess"] - r["healingSd"]) * 100 for r in h], [(r["healingSuccess"] + r["healingSd"]) * 100 for r in h], color="#1baf6b", alpha=.15)
ax.set_xlabel("injected failure rate (%)"); ax.set_ylabel("job success rate (%)"); ax.set_title("Self-healing: success rate vs fault rate (10 seeds x 400 jobs per point)"); ax.legend(frameon=False); save(fig, "heal-success.svg")
fig, axs = plt.subplots(1, 3, figsize=(12, 3.8))
for a, (b, hh, t) in zip(axs, (("baselineAttempts", "healingAttempts", "Mean attempts per job"), ("baselineP95", "healingP95", "p95 latency (virtual ms)"), ("baselineMttr", "healingMttr", "MTTR (virtual ms)"))):
    a.plot(fr, [r[b] for r in h], color="#d6455d", label="baseline"); a.plot(fr, [r[hh] for r in h], color="#1baf6b", label="healing"); a.set_title(t); a.set_xlabel("failure rate (%)")
axs[0].legend(frameon=False); save(fig, "heal-cost.svg")
b = E["bandit"]; fig, ax = plt.subplots(figsize=(7.5, 4.2))
for m, c in (("random", "#888"), ("epsilon", "#e8912d"), ("thompson", "#9a5fd1")): ax.plot(b["x"], b[m]["curve"], color=c, lw=2, label=f'{m} (final regret {b[m]["meanRegret"]:.1f})')
ax.set_xlabel("pulls"); ax.set_ylabel("cumulative regret"); ax.set_title("Self-improving: strategy selection regret (3 arms, 30 seeds)"); ax.legend(frameon=False); save(fig, "improve-regret.svg")
fig, ax = plt.subplots(figsize=(7, 4)); ab = E["ab"]
ax.plot([p["n"] for p in ab["power"]], [p["adoptRate"] * 100 for p in ab["power"]], "o-", color="#2a7de1", label="adopt rate when B is truly +10pt")
ax.plot([p["n"] for p in ab["falseAdopt"]], [p["rate"] * 100 for p in ab["falseAdopt"]], "o-", color="#d6455d", label="false adopt when arms equal")
ax.set_xscale("log"); ax.set_xlabel("samples per arm"); ax.set_ylabel("%"); ax.set_title("A/B gate: power and false-positive rate"); ax.legend(frameon=False); save(fig, "improve-ab.svg")
fig, ax = plt.subplots(figsize=(7, 4)); t = E["tuner"]
ax.plot([r["steps"] for r in t], [r["tunerErr"] for r in t], "o-", color="#e8912d", label="auto-tuner"); ax.plot([r["steps"] for r in t], [r["randomErr"] for r in t], "o-", color="#888", label="random search")
ax.set_xscale("log"); ax.set_xlabel("evaluation budget"); ax.set_ylabel("distance to optimum (lower is better)"); ax.set_title("Self-optimizing: auto-tuner vs random search"); ax.legend(frameon=False); save(fig, "optimize-tuner.svg")
fig, ax = plt.subplots(figsize=(8, 4)); s = E["timeout"]["series"]
ax.scatter([p["t"] for p in s], [p["latency"] for p in s], s=6, color="#bbb", label="observed latency")
ax.plot([p["t"] for p in s], [p["adaptive"] for p in s], color="#1baf6b", lw=2, label=f'adaptive timeout ({E["timeout"]["adaptiveTimeouts"]} timeouts)')
ax.axhline(E["timeout"]["fixedMs"], color="#d6455d", ls="--", label=f'fixed {E["timeout"]["fixedMs"]}ms ({E["timeout"]["fixedTimeouts"]} timeouts)')
ax.set_xlabel("request"); ax.set_ylabel("ms"); ax.set_title("Adaptive timeout after a latency regime shift at request 500"); ax.legend(frameon=False, fontsize=8); save(fig, "optimize-timeout.svg")
fig, ax = plt.subplots(figsize=(8, 4)); tr = E["limiter"]["traj"]
ax.plot([p["step"] for p in tr], [p["limit"] for p in tr], color="#2a7de1", label="AIMD concurrency limit"); ax.plot([p["step"] for p in tr], [p["capacity"] for p in tr], color="#d6455d", ls="--", label="true server capacity")
ax.set_xlabel("step"); ax.set_ylabel("concurrent requests"); ax.set_title(f'Adaptive concurrency tracks capacity drop (reject rate {E["limiter"]["rejectRate"]*100:.2f}%)'); ax.legend(frameon=False); save(fig, "optimize-limiter.svg")
sc = E["scorecard"]; fig, ax = plt.subplots(figsize=(6, 3.6)); names = ["healing", "improving", "optimizing", "overall"]
ax.bar(names, [sc[n] for n in names], color=["#1baf6b", "#9a5fd1", "#e8912d", "#2a7de1"]); [ax.text(i, sc[n] + 1, f"{sc[n]:.1f}", ha="center") for i, n in enumerate(names)]
ax.set_ylim(0, 105); ax.set_title("Engine scorecard (0-100)"); save(fig, "scorecard.svg")
print("engine charts done")

R = json.load(open(os.path.join(D, "recovery.json"))); fig, ax = plt.subplots(figsize=(8, 3.8))
lab = ["red main #1\n(operator-driven)", "red main #2\n(operator-driven)", "R04 red main\n(watchdog, incl. 343s undetected)", "X01 chaos drill\n(watchdog)"]
val = [R["manual_era"]["red1"]["mttr_s"], R["manual_era"]["red2"]["mttr_s"], R["natural_R04"]["true_mttr_s"], R["drill_X01"]["mttr_s"]]
ax.barh(lab, val, color=["#d6455d", "#d6455d", "#1baf6b", "#1baf6b"]); ax.set_xscale("log"); ax.invert_yaxis()
[ax.text(v * 1.05, i, f"{v/60:.1f} min", va="center", fontsize=9) for i, v in enumerate(val)]
ax.set_xlabel("time to recovery, seconds (log scale)"); ax.set_title("Mean time to recovery for a red main: manual vs automatic"); ax.set_xlim(50, 40000); save(fig, "recovery-mttr.svg")
