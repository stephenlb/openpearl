# Acceptance spec format

A spec is JSON that checks an extension's behaviour from the outside. The runner gives each case a fresh, empty store for the requesting tenant. It seeds the case's rows, calls one route as one persona, and checks the response.

```json
{
  "version": 1,
  "cases": [
    {
      "name": "finds an order by id",
      "as": "member",
      "seed": [
        { "ref": "o1", "collection": "orders", "owner": "peer", "doc": { "title": "Desk", "amount": 300 } }
      ],
      "request": { "method": "GET", "path": "/order", "query": { "id": "{{o1}}" } },
      "expect": { "status": 200, "body": { "id": "{{o1}}", "title": "Desk" }, "match": "subset" }
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `name` | Unique, 1-120 characters |
| `as` | Persona making the call: `member`, `peer` (another ordinary user) or `admin` |
| `seed` | Up to 50 rows: a `collection`, an `owner` persona and a `doc`. An optional `ref` lets you write `{{ref}}` for that row's id anywhere in `request` or `expect`. |
| `request` | `method` and `path` from the manifest, plus optional `query` and `body` |
| `expect.status` | Defaults to 200 |
| `expect.body` | With `match: "subset"` (the default), every key and array element you list must appear; extra keys and other array orders are fine. `match: "exact"` compares the whole body. |
| `expect.includes` / `expect.excludes` | Strings that must or must not appear in the response JSON |

Rows come back with `id` and `owner` plus their fields. Owner-visible collections return only the caller's own rows, unless the caller is an admin.

A spec can have up to 50 cases. A case fails if any check fails, or if the extension uses a capability its manifest doesn't declare.
