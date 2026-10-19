# Security model

This covers the customer feature-request pipeline (`.github/workflows/tenant-feature.yml`) and the tenant framework. For the internal issue pipeline, see the README.

## Threats and controls

| Threat | Primary control | Backups |
|---|---|---|
| Customer A reads tenant B's data | The store scopes every query by a session issued by core; tenants can't be named (`framework/core/store.js`). In Postgres, row-level security enforces the same in the database (`framework/core/postgres.sql`). | Isolation canaries, `tenant-isolation` eval, triage eval |
| Sensitive fields (PII) leak to the wrong people or into logs | Sensitive fields need their own capability and an allowed role, plan wildcards never grant them, and logs are redacted (`framework/sdk/host.js`) | Per-field canaries in the isolation harness; extensions that log or copy sensitive values fail |
| A feature is safe but wrong, or a later change breaks it | Acceptance spec written by a second agent that never sees the code, committed and rerun as a regression suite | `intent-match` eval; live monitor rollback; customer feedback |
| A bad release reaches users | Extensions that write data deploy to a read-only, admin-only preview until a signed approval | Live monitor rolls back on denials, error rates or negative feedback (`deploy/monitor.js`) |
| User reads another user's private rows in the same tenant | Owner visibility enforced by the store; per-user KV | Laundering checks in the isolation harness, `tenant-isolation` eval |
| Extension escapes the sandbox | Fresh context per request, no host objects or string code generation, `import` refused (`framework/runtime/sandbox.js`) | Worker isolate with a memory cap and no environment (`framework/runtime/executor.js`); forbidden-identifier gate; LLM evals |
| Extension uses more access than declared | Capability checks in the SDK; the extension is disabled and an alert raised on overreach | Gates check the manifest against the plan; `capability-minimality` eval |
| Request edits core, auth, plans or the pipeline | Path allowlist: only `tenants/<tenant>/extensions/<slug>/` (`framework/gates.js`) | CODEOWNERS and branch protection; `issue-to-pr.yml` protected paths |
| Prompt injection in the request or the code | Agents have no shell, network tools or repo token; deterministic gates decide before any LLM | Triage eval, request corpus in `openpearl-evals.yml` |
| Forged or replayed request or approval | HMAC signature, one-hour expiry, issue author (or workflow dispatcher) must be the intake App | Tenant comes from authentication, not from text; only tenant admins can approve |
| Agent reads or leaks another tenant's code | Agent jobs see a view without other tenants, `.git` or `.github` (`tenant-view.sh`) | |
| Tampered artifact deployed | Only Ed25519-signed bundles of the merged commit load, and the hash is checked | Signing key only in the `openpearl-production` environment |
| Secrets stolen by an agent or candidate code | Agent steps get only LLM credentials; candidate code runs under `env -i`; no job with an agent can push | Optional egress blocking (`OPENPEARL_EGRESS_ALLOW`) |

## Known limitations

- **Worker isolates share the host process.** Each extension call runs in a fresh `node:vm` context inside a worker-thread isolate. The isolate has a memory cap and no environment, and is killed and replaced on overrun. That blocks the known escapes (see `framework/test/runtime.test.js` and `executor.test.js`), but a V8 bug would still reach the host process. For high-risk deployments, run the host itself per tenant (one container per tenant via `compose.yaml` or the Podman pod), or use workerd behind the `command` adapter.
- **Previews read real data.** Writes are disabled and only tenant admins can open them, but an admin sees whatever the preview reads.
- **The forbidden-identifier scan is heuristic.** Its lexer skips strings and comments but isn't a full parser. Computed property access (`o['con' + 'structor']`) gets past it. It is a cheap early rejection, not a boundary.
- **The isolation harness only finds leaks its inputs reach.** A leak that needs a specific magic input may not trigger. The `tenant-isolation` eval reads the code to catch that kind of intent.
- **LLM evals can be wrong.** They sit behind deterministic layers that can't be argued with. Track their catch rate with `openpearl-evals.yml` and add every miss to `evals/corpus/`.
- **Keys are high value.** A leaked `OPENPEARL_INTAKE_KEY` lets an attacker submit requests as any tenant, though those requests are still bound by every gate. A leaked `OPENPEARL_SIGNING_KEY` lets an attacker sign bundles. Rotate them and keep both out of agent jobs.
- **The intake service keeps request state in memory.** Restarting it forgets which requests exist, so status, answers and approvals fail closed for older requests. Back it with your database in production.
- **Use a private repository.** Customer requests and tenant extension code are visible to anyone who can read the repo.
- **Imported Jira and Trello issues** in `issue-to-pr.yml` inherit the trust of the `PUSH_TOKEN` owner. Only import from boards that trusted people write to.

## Reporting

Please report vulnerabilities privately to the maintainers rather than in a public issue.
