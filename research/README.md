# OpenPearl self-healing research

Experiment: 63 GitHub issues (50 experiment tickets E01-E50, fixes F01-F08, re-files R01-R04, chaos drill X01) opened with `gh issue create`, processed by the OpenPearl pipeline, building `pearl-engine` in `engine/`.

- `engine/` - the product built by the pipeline (zero dependencies, `node --test`).
- `harness/plan.py` - the 50-issue plan. `drive.py` - creates issues in waves and waits. `collect.py` - pulls metrics from the GitHub API. `engine_eval.mjs` - measures the engine. `charts.py`, `report.py` - build `docs/research/*.svg` and `docs/research.html`.
- `data/` - raw metrics (`metrics.csv|json`, `engine-eval.json`, `recovery.json`, `issues.jsonl`, driver logs).

Report: `docs/research.html` (published at /research.html).
