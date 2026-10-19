# Writing a tenant extension

An extension adds a feature for one tenant. It lives in `tenants/<tenant>/extensions/<slug>/` and contains exactly these files:

| File | Required | Purpose |
|---|---|---|
| `manifest.json` | yes | Name, routes and capabilities |
| `index.js` | yes | The code: one plain script, no imports |
| `README.md` | strongly recommended | Each route's input and the exact shape of its response. Independent acceptance tests are written from it. |
| `acceptance.json` | managed by the platform | Accepted acceptance tests, rerun on every later change. Don't edit it. |

Nothing else in the repository may change. The merge gates reject any change outside this directory.

## manifest.json

```json
{
  "version": 1,
  "name": "order-summary",
  "description": "Order count and total for the current tenant.",
  "routes": [{ "method": "GET", "path": "/summary" }],
  "capabilities": ["data:read:orders"]
}
```

- `name` must equal the directory name (`<slug>`).
- `routes` lists 1-20 routes. `method` is GET, POST, PUT or DELETE. `path` is lowercase and starts with `/`. The host serves them at `/ext/<slug><path>`.
- `capabilities` must be the smallest set the feature needs, and all of them must be in the tenant's plan (`framework/core/entitlements.json`):
  - `data:read:<collection>` and `data:write:<collection>`, where the collections are listed in `framework/core/policies.json`
  - `data:read:<collection>.<field>` and `data:write:<collection>.<field>` for fields the policy marks `sensitive`, such as `customers.email`. Without these, sensitive fields are left out of results and can't be written. A field may also be limited to certain roles.
  - `kv:read` and `kv:write` for small per-user key-value state
  - `log`

## index.js

The script runs in a sandbox whose only API is the global `openpearl`:

```js
openpearl.route('GET', '/summary', (req) => {
  const orders = openpearl.data.find('orders');
  return { count: orders.length };
});
```

- `openpearl.route(method, path, handler)` registers a handler. Every route must be listed in the manifest.
- `handler(req)` receives `{ method, path, query, body, user: { id, roles } }`. It must return a JSON-serialisable value synchronously; promises are not supported.
- `openpearl.data.find(collection, filter?)` takes an equality filter, e.g. `{ id }` or `{ status: 'open' }`. Results only ever contain rows the current user may see.
- `openpearl.data.insert(collection, doc)` and `openpearl.data.update(collection, id, patch)`. The fields `id`, `tenant` and `owner` are set by the platform and can't be written.
- `openpearl.kv.get(key)` and `openpearl.kv.set(key, value)` store state for the current user of this extension.
- `openpearl.log(...parts)` writes to the tenant's audit log.

The platform handles tenant and user scoping. There is no way to name a tenant, and you shouldn't try. Collections with `"visibility": "owner"` return only the caller's own rows, unless the caller is an admin.

### Not available, and rejected by the gates

There is no `import`, `require`, `process`, `fetch`, timers, `Promise`/`async`/`await`, `eval`/`Function`, `this`, `globalThis`, prototypes or `constructor`, `Reflect`, `Proxy` or `Symbol`, and no escapes outside string literals.

Each request runs in a fresh sandbox, so top-level variables don't persist between requests. Each call is limited to 1 second.

### Rules

- Validate input. Check types and pick known fields; never pass `req.query` or `req.body` straight to `find`, `insert` or `update`.
- Don't copy rows from an owner-visible collection into a tenant-visible one.
- Calling a capability or route that isn't declared disables the extension immediately and alerts the operators.
- Never log sensitive values. The platform redacts them, and the isolation harness fails extensions that try.
- Extensions that write data go to a preview first. Tenant admins try them at `/preview/ext/<slug>`, with writes disabled, and approve them before they go live.
