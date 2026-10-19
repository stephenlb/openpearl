# OpenPearl: Mutable Software Framework

Customers ask for features, and each feature ships as a tenant extension within minutes, with no human in the loop. Fully automatic merge is safe here because of how the system is built: a customer's code can't touch the core, auth or another tenant's data. Evals are the second line of defense, and the runtime is the third.

```
customer (authenticated)                       human-owned core (never auto-merged)
   │                                             framework/core     store with row-level security, manifests, bundles
   ▼                                             framework/sdk      capability SDK, the only path to data
intake/server.js ── signed issue ──┐             framework/runtime  worker isolates + sandbox + extension host
                                   ▼
.github/workflows/tenant-feature.yml
  verify     signature from OPENPEARL_INTAKE_KEY, issue opened by OPENPEARL_INTAKE_BOT
  triage     LLM eval: in scope? cross-tenant, privilege, exfiltration, injection → reject; unclear → ask the customer
  implement  agent: file tools only, no shell, no repo token, sees only this tenant
  gate       trusted gates.js + isolation harness + regression spec + 3 LLM evals
             + acceptance spec written by a second agent that never sees the code
  publish    exact gated patch + accepted spec → PR → openpearl/* statuses → squash merge (no agent)
  deploy     sign merged commit → smoke-test → live, or preview for extensions that write data
  report     label openpearl-live / -preview / -needs-info / -merged / -rejected / -needs-human (read by intake)
tenant-promote.yml  a tenant admin approved the preview (signed by intake) → live
host         watches each new release and rolls it back on denials, errors or "not what I asked"
```

## Layers

| Layer | Where | What it guarantees |
|---|---|---|
| Row-level security | `core/store.js` | Every query is scoped by a session issued by core. A tenant can't be named in a filter or document, and owner-visible rows stay with their owner (and tenant admins). |
| Capabilities | `sdk/host.js`, `core/manifest.js` | An extension can only use the capabilities and routes its manifest declares, and only those in its tenant's plan (`core/entitlements.json`). Overreach disables it and raises an alert. |
| Row-level security in Postgres | `core/postgres.sql`, `core/postgres.js` | With `OPENPEARL_DATABASE_URL`, tenant and owner scoping is enforced by the database. The app role can't bypass RLS, change a row's tenant or owner, or delete. |
| Sensitive fields | `core/policies.json` → `sensitive` | Fields such as `customers.email` reach an extension only with their own capability (`data:read:customers.email`), only for listed roles, and never in logs. Plan wildcards don't cover them. |
| Isolates | `runtime/executor.js`, `runtime/worker.js` | Each worker is a separate V8 isolate with a memory cap and no environment, killed and replaced if it exceeds its limits. |
| Sandbox | `runtime/sandbox.js` | Fresh V8 context per request. Only strings cross the boundary, there's no string code generation or `import`, and each call has a 1 s limit. |
| Signed bundles | `core/bundle.js` | The runtime only loads Ed25519-signed bundles whose hash matches. What runs is exactly what was merged. |
| Merge gates | `gates.js` | Changes stay inside `tenants/<tenant>/extensions/<slug>/`. They also check file modes, the manifest and plan, forbidden identifiers, secrets and size. |
| Isolation harness | `../isolation/` | Seeds canaries for 3 users plus another tenant, then drives every route with hostile inputs. It fails on any canary a persona isn't entitled to see, including data laundered into shared collections. |
| Acceptance spec | `../isolation/spec.js`, `../.github/workflows/evals/spec-author.md` | A second agent turns the request, manifest and README into behavioural tests without seeing the code. Accepted specs are committed as `acceptance.json` and rerun as regression tests on every later change. |
| LLM evals | `../.github/workflows/evals/tenant-*.md`, `capability-minimality.md`, `intent-match.md` | Catch intent the deterministic layers can't: obfuscation, unnecessary capabilities, hidden behaviour, prompt injection. |
| Preview and approval | `deploy/cli.js --channel`, `tenant-promote.yml` | Extensions that write data (or plans with `previewRequired`) go to `/preview/ext/<slug>` first. Previews are for tenant admins only and use read-only data; a signed approval from intake puts them live. |
| Live monitor | `../deploy/monitor.js`, `serve.js` | For 10 minutes after each release, a capability denial, an error rate above 20% or repeated "not what I asked" feedback rolls back to the previous version. |
| Eval of evals | `../evals/corpus/` | The attack extensions must be stopped by at least one deterministic layer (CI, every PR), and benign ones must pass their acceptance specs. The labelled requests measure triage: any accepted attack fails the nightly run. |

## Run it in containers

The image runs the extension host by default. The same image also runs the intake service, migrations and the deploy CLI.

```sh
cp .env.example .env                 # set passwords and tokens
node deploy/keygen.js keys           # keys/signing.pem (keep secret) and keys/signing.pub.pem
docker compose up --build            # or: podman compose up --build
docker compose --profile intake up   # also run the intake service on :8787
```

- `compose.yaml` runs Postgres 17, a one-shot migration and the host on `:8788`. All containers run unprivileged, with read-only filesystems and no capabilities. The host connects as `openpearl_app` and mounts the registry read-only.
- `Containerfile` and `.containerignore` are symlinks to the Docker files, for Podman.
- `deploy/podman/openpearl.kube.yaml` runs the same stack as a pod with `podman kube play`.
- Deploy extensions into `./.openpearl-registry` with `OPENPEARL_SIGNING_KEY_FILE=keys/signing.pem node deploy/cli.js ...`. The host picks up new versions, previews and rollbacks on the next request.

## Setup

1. **Intake.** Create a GitHub App with Issues read/write on this repo and run `intake/server.js` with the variables below. Replace `tokenAuthenticator` with your product's session check. Set the repo variable `OPENPEARL_INTAKE_BOT` to the App's bot login, e.g. `my-intake[bot]`.
2. **Keys.**
   - Generate a random intake key and store it as the `OPENPEARL_INTAKE_KEY` repo secret and in the intake service.
   - Generate a signing key pair with `node deploy/keygen.js <dir>`. Store `signing.pem` as `OPENPEARL_SIGNING_KEY` in a GitHub environment named `openpearl-production`, and add required reviewers there if you want a manual deploy switch. Give the runtime `signing.pub.pem` as `OPENPEARL_VERIFY_KEY`.
3. **Branch protection** on the default branch:
   - require the `openpearl/gates`, `openpearl/isolation`, `openpearl/evals` and `CI / test` checks;
   - require CODEOWNERS review for `framework/`, `isolation/`, `deploy/`, `intake/`, `evals/` and `.github/`.
4. **Deploy.** Set `OPENPEARL_DEPLOY_ADAPTER=command` and point `OPENPEARL_DEPLOY_COMMAND` at your script, called as `<script> <stage|enable|preview|promote|rollback> <tenant> <slug> [bundle.json]`. Or start with `local` while developing. Without an adapter, requests stop at `openpearl-merged`.
5. **Data.** For Postgres, run `framework/migrate.js` once as an admin role (it creates the tables, RLS policies and the `openpearl_app` role). Then point the host's `OPENPEARL_DATABASE_URL` at `openpearl_app`, never at a superuser or the table owner, because both bypass RLS.
6. **Plans and policies.** Edit `core/policies.json` (collections, visibility and sensitive fields) and `core/entitlements.json` (plans, tenants and `previewRequired`). These files are core, so a human reviews every change to them.

| Name | Kind | Purpose |
|---|---|---|
| `OPENPEARL_INTAKE_BOT` | variable | Login of the intake App; issues from anyone else are ignored |
| `OPENPEARL_INTAKE_KEY` | secret | HMAC key shared with the intake service |
| `OPENPEARL_SIGNING_KEY` | environment secret (`openpearl-production`) | Ed25519 private key for bundles |
| `OPENPEARL_DEPLOY_ADAPTER` / `OPENPEARL_DEPLOY_COMMAND` | variables | `local` or `command`, and the command's path |
| `OPENPEARL_PUSH_TOKEN` | secret, optional | Token for the publish job so its PR triggers CI. Without it, `GITHUB_TOKEN` is used. |
| `OPENPEARL_EGRESS_ALLOW` | variable, optional | Endpoints the implement job may reach; enables `harden-runner` egress blocking |
| `OPENPEARL_FIX_ROUNDS` | variable | Self-check and fix rounds in the implement job (0-3, default 2) |
| `OPENPEARL_MIN_BENIGN_ACCEPT` | variable | Minimum benign acceptance rate in the nightly triage corpus (default 0.8) |
| Intake service env | `OPENPEARL_INTAKE_TOKENS`, `OPENPEARL_REPO`, `OPENPEARL_GITHUB_TOKEN`, `OPENPEARL_INTAKE_KEY`, `OPENPEARL_INTAKE_PER_HOUR`, `OPENPEARL_BRANCH`, `PORT` | The intake App also needs Actions write, to dispatch `tenant-promote.yml` |
| Host env | `OPENPEARL_DATABASE_URL`, `OPENPEARL_VERIFY_KEY(_FILE)`, `OPENPEARL_SERVE_TOKENS`, `OPENPEARL_REGISTRY_DIR`, `OPENPEARL_ALERT_URL`, `OPENPEARL_WATCH_SECONDS`, `OPENPEARL_WATCH_MIN_REQUESTS`, `OPENPEARL_WATCH_MAX_ERROR_RATE`, `PORT` | |

## Try it locally

```sh
npm test                                               # framework, corpus and end-to-end tests
mkdir -p /tmp/repo/tenants/acme/extensions && cp -R evals/corpus/extensions/benign-order-summary/ext /tmp/repo/tenants/acme/extensions/order-summary
node isolation/run.js --tenant acme --dir /tmp/repo/tenants/acme/extensions/order-summary
node deploy/keygen.js /tmp
OPENPEARL_SIGNING_KEY="$(cat /tmp/signing.pem)" node deploy/cli.js --tenant acme --slug order-summary --commit local --repo /tmp/repo
OPENPEARL_VERIFY_KEY="$(cat /tmp/signing.pub.pem)" \
OPENPEARL_SERVE_TOKENS="{\"$(printf acme-alice-token-123 | shasum -a 256 | cut -d' ' -f1)\":{\"tenant\":\"acme\",\"user\":\"alice\"}}" \
  node framework/serve.js &
curl -H 'Authorization: Bearer acme-alice-token-123' localhost:8788/ext/order-summary/summary   # {"count":0,"total":0}
```

## Speed

Typical wall-clock times: triage under 30 s, implementation with self-checks 2-3 min, gates and isolation a few seconds, the three evals about a minute (run in parallel), then publish and deploy. That's roughly 4-6 minutes from request to live. Most of it is agent time, so use a fast model for triage and the evals.
