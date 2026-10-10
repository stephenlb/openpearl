"""50-issue experiment plan. Each entry: (phase, title, module/file, spec, kind)
kind: normal | trap (deliberately hard/ambiguous/conflicting, to probe self-healing of the pipeline)."""
PRE = ("Part of the OpenPearl self-healing research benchmark: we are building `pearl-engine`, a zero-dependency "
       "Node.js (>=22, ESM) library in `research/engine/`. Rules: only touch files under `research/engine/` "
       "(do not edit `.github/` or `docs/`); no npm dependencies; tests use `node:test` in `research/engine/test/` "
       "and must pass with `node --test research/engine/test`; every module exports named functions from "
       "`research/engine/src/<name>.js` and is re-exported from `research/engine/src/index.js` (create if missing). "
       "Keep modules small and deterministic (inject clocks/RNG; no real sleeping in tests).\n\n")

P = []
def add(phase, title, spec, kind="normal"): P.append((phase, title, spec, kind))

# Phase A: core
add("core","Scaffold pearl-engine package","Create `research/engine/package.json` (name pearl-engine, type module, scripts.test = `node --test test`), `src/index.js`, `README.md` (one paragraph), and `test/smoke.test.js` asserting the index module imports.")
add("core","Add task runner with retries","`src/runner.js`: `runTask(fn, {retries=3, delayMs=0, sleep, onAttempt})` returns `{ok, value|error, attempts}`. Retries on thrown errors, injectable `sleep`. Tests for success first try, success after 2 failures, exhausted retries.")
add("core","Add exponential backoff with jitter","`src/backoff.js`: `backoffDelay(attempt,{baseMs=100,factor=2,maxMs=10000,jitter=0.2,rng=Math.random})`. Deterministic with injected rng. Tests for growth, cap, jitter bounds.")
add("core","Add circuit breaker","`src/breaker.js`: `createBreaker({threshold=5,cooldownMs=30000,now=Date.now})` with `call(fn)`, states closed/open/half-open, `state()`. Tests for every transition using fake clock.")
add("core","Add metrics recorder","`src/metrics.js`: `createMetrics()` with `inc(name,n)`, `observe(name,value)`, `snapshot()` returning counters and for histograms count,min,max,mean,p50,p95,p99. Tests with known values.")
add("core","Add structured event log","`src/events.js`: `createEventLog({now})` with `emit(type,data)`, `query({type,since})`, `toJSONL()`, `fromJSONL(str)`. Ring buffer cap option. Tests.")
add("core","Add config loader with validation","`src/config.js`: `loadConfig(obj)` merges defaults (retries,timeoutMs,concurrency,cacheTtlMs), validates types and ranges, throws an Error listing ALL invalid fields. Tests.")
add("core","Add timeout wrapper","`src/timeout.js`: `withTimeout(promiseFn, ms, {setTimer, clearTimer})` rejecting with `TimeoutError` (exported class). Tests with injected fake timers.")
add("core","Add health check module","`src/health.js`: `createHealth()` with `register(name, checkFn)` and `run()` returning `{status:'ok'|'degraded'|'down', checks:{name:{ok,ms,error}}}`. Tests.")
add("core","Add CLI entry","`research/engine/bin/pearl.js` with commands `version`, `health`, `config <json>` using existing modules; exit codes 0/1/2. Tests spawn the CLI via child_process.")
# Phase B: self-healing
add("heal","Add fault injector","`src/chaos.js`: `createChaos({rng,failRate,latencyMs,errorTypes})` with `wrap(fn)` that randomly throws typed errors or adds latency (via injectable sleep). Tests with seeded rng. Also add `src/rng.js` exporting `seededRng(seed)` (mulberry32).")
add("heal","Add failure classifier","`src/classify.js`: `classifyError(err)` returns `{class:'transient'|'permanent'|'timeout'|'resource'|'unknown', retryable:boolean}` using error code/name/message heuristics (ECONNRESET, ETIMEDOUT, EACCES, ENOMEM, TimeoutError...). Tests table-driven, 20+ cases.")
add("heal","Make runner retry only retryable errors","Update `src/runner.js` to use `classifyError`: non-retryable errors stop immediately. Keep backward compat via option `retryAll`. Add tests; do not break existing ones.")
add("heal","Add watchdog","`src/watchdog.js`: `createWatchdog({timeoutMs,now,onStall})` with `heartbeat(id)`, `check()` returning stalled ids and calling onStall once per stall. Tests.")
add("heal","Add checkpoint store","`src/checkpoint.js`: in-memory + JSON file backed `createCheckpointStore({path,fs})` with `save(key,state)`, `load(key)`, `clear(key)`. Atomic write (tmp+rename). Tests using a temp dir.")
add("heal","Add crash recovery","`src/recover.js`: `resumeJobs(store, handlers)` replays unfinished checkpoints through handlers and reports `{resumed, failed, skipped}`. Tests with simulated crash mid-job.")
add("heal","Add dead-letter queue","`src/dlq.js`: `createDLQ({max})` with `push(job,err)`, `list()`, `replay(handler)` returning counts, oldest-evicted when full. Tests.")
add("heal","Add corrupt state repair","`src/repair.js`: `repairJSONL(text)` drops malformed lines and returns `{repaired, dropped:[{line,reason}]}`; `repairCheckpoint(obj, schema)` fills missing fields from defaults. Tests with corrupted inputs.")
add("heal","Add degraded-mode controller","`src/degrade.js`: `createDegrader({levels})` moves down a ladder (full, reduced, minimal) when error rate over a rolling window exceeds thresholds and recovers with hysteresis. Tests with fake clock.")
add("heal","Add self-heal playbook engine","`src/playbook.js`: `createPlaybook(rules)` mapping error class -> ordered remedies (retry, backoff, reset-breaker, replay-dlq, degrade). `heal(error, ctx)` returns the actions taken and outcome. Tests; integrate with classifier and breaker.")
# Phase C: self-improving
add("improve","Add outcome learning store","`src/learn.js`: `createLearner()` with `record({strategy,context,success,costMs})` and `stats(strategy)` returning attempts, successRate, meanCost, wilson lower bound. Tests with known data.")
add("improve","Add strategy scoring and selection","`src/strategy.js`: `rankStrategies(learner,candidates)` ordering by Wilson lower bound then cost; ties stable. Tests.")
add("improve","Add postmortem generator","`src/postmortem.js`: `buildPostmortem(events)` returns markdown with timeline, root-cause class counts, MTTR, affected jobs. Tests with golden output.")
add("improve","Add issue draft generator from failures","`src/issuedraft.js`: `draftIssues(events,{minCount=3})` groups recurring failures by signature and returns `[{title, body, labels}]` suitable for `gh issue create`. Tests; titles must be stable/deterministic.")
add("improve","Add regression test generator","`src/regress.js`: `generateRegressionTest(failureEvent)` returns source text of a `node:test` file reproducing the failure as an assertion template. Tests that output parses (use `new Function`/vm.Script on stripped import-free code or `node --check` via child_process).")
add("improve","Add A/B comparison utility","`src/ab.js`: `compareArms(a,b)` for success-rate arrays: returns lift, two-proportion z, p-value (normal approximation), and `decision` ('adopt'|'reject'|'inconclusive'). Tests with known values.")
add("improve","Add bandit strategy selector","`src/bandit.js`: `createBandit(arms,{epsilon,rng})` epsilon-greedy and `thompson` mode (Beta sampling with seeded rng), `choose()`, `reward(arm,value)`. Tests show it converges to the best arm in 500 seeded pulls.")
add("improve","Add improvement ledger","`src/ledger.js`: `createLedger()` recording `{change, metricBefore, metricAfter, ts}` and `summary()` with net improvement, win rate, regressions flagged. Tests.")
add("improve","Add code quality metrics collector","`src/quality.js`: `measureSource(text)` returns lines, functions (regex), max nesting depth, comment ratio, cyclomatic estimate. `scanDir(path)` aggregates. Tests with fixtures.")
add("improve","Add feedback loop orchestrator","`src/loop.js`: `runImprovementCycle({events,learner,ledger})` ties learner, issuedraft, ledger together and returns `{drafts, ranked, summary}`. Integration test using fixtures.")
# Phase D: self-optimizing
add("optimize","Add adaptive timeout estimator","`src/adaptive-timeout.js`: `createTimeoutEstimator({min,max,percentile=0.95,multiplier=1.5})` with `observe(ms)` and `current()`. Rolling window. Tests.")
add("optimize","Add adaptive concurrency limiter","`src/concurrency.js`: AIMD limiter `createLimiter({min,max,start})` with `acquire()/release(ok)` growth on success and multiplicative decrease on failure/latency spike. Tests.")
add("optimize","Add TTL cache with adaptive TTL","`src/cache.js`: `createCache({ttlMs,now,maxEntries})` LRU + TTL, `get/set/stats()` with hit rate; `adaptTtl()` increases TTL for high-hit-rate keys. Tests.")
add("optimize","Add micro-benchmark harness","`src/bench.js`: `bench(name, fn, {iterations,warmup,now})` returns ops/sec, mean, stddev, p95 ns using `process.hrtime.bigint`. `compareBench(a,b)`. Tests with injected clock.")
add("optimize","Add auto-tuner hill climber","`src/tuner.js`: `tune({params,evaluate,steps,rng})` coordinate hill-climbing with random restarts; returns best params and trajectory. Tests optimizing a known quadratic.")
add("optimize","Add batching queue","`src/batch.js`: `createBatcher({maxSize,maxWaitMs,flush,setTimer})` coalescing items; flush on size or time. Tests.")
add("optimize","Add load shedder","`src/shed.js`: `createShedder({maxQueue,priority})` rejecting lowest-priority work when queue depth or latency exceed limits. Tests.")
add("optimize","Add cost budget tracker","`src/budget.js`: `createBudget({limit,windowMs,now})` with `charge(cost)`, `remaining()`, `canAfford()`, rolling window. Tests.")
add("optimize","Add profiler for task stages","`src/profile.js`: `createProfiler({now})` with `stage(name,fn)` accumulating per-stage time and `report()` returning percent breakdown sorted descending, identifying the bottleneck. Tests.")
add("optimize","Add self-optimizing pipeline facade","`src/engine.js`: `createEngine(config)` composing runner, breaker, classifier, adaptive timeout, limiter, cache, metrics, learner into `engine.run(name, fn)`. Integration tests with chaos injection showing success rate with healing > without (seeded).")
# Phase E: measurement + pipeline traps
add("measure","Add simulation runner","`src/sim.js`: `simulate({jobs,failRate,seed,engineConfig})` runs N jobs under chaos with and without healing features and returns a comparison object of success rate, mean attempts, p95 latency, MTTR. Tests are deterministic.")
add("measure","Add scorecard","`src/scorecard.js`: `scorecard(results)` returns 0-100 scores for self-healing, self-improving, self-optimizing with documented weights and a markdown rendering. Tests.")
add("measure","Add SVG chart helper","`src/svg.js`: `barChart(data,opts)` and `lineChart(series,opts)` returning valid, escaped SVG strings with axes and labels. Tests validate structure and escaping of `<`/`&` in labels.")
add("measure","Add benchmark scenarios file","`research/engine/scenarios/scenarios.json` with 12 named scenarios (failRate 0.05..0.6, latency spikes, corrupt state) plus `src/scenarios.js` loader with validation, plus `bin/pearl.js` command `scenarios`. Tests.")
add("measure","Add end-to-end demo script","`research/engine/examples/demo.js` running the engine under all scenarios and printing a table; a test runs it and checks exit code 0 and that output has 12 rows.")
add("trap","TRAP: ambiguous request","Make the engine faster. (No further detail is given on purpose: this tests how the pipeline handles under-specified tickets. Constrain yourself to a measurable, safe, in-scope micro-optimization inside research/engine/src, add a benchmark test, and explain the assumption in the PR.)","trap")
add("trap","TRAP: fix seeded bug in backoff","`backoffDelay` must never return a value greater than `maxMs` even when jitter is positive, and must return an integer. Reproduce with a failing test first, then fix. Do not change the public signature.","trap")
add("trap","TRAP: conflicting edit of runner","Add an `onGiveUp` callback to `runTask` in `src/runner.js` invoked once when retries are exhausted. (A sibling ticket edits the same file at the same time; resolve any merge conflicts preserving both.)","trap")
add("trap","TRAP: conflicting edit of runner 2","Add a `timeoutMs` option to `runTask` in `src/runner.js` using `withTimeout`; timed-out attempts count as retryable timeouts. (A sibling ticket edits the same file at the same time; resolve any merge conflicts preserving both.)","trap")
add("trap","TRAP: impossible requirement","Make `runTask` guarantee success for every possible function including ones that always throw. If impossible, implement the closest honest behavior (clear failure report with diagnostics) and say so in the PR, rather than faking success.","trap")
