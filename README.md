# mdmbox-sdk

TypeScript SDK for [MDMbox](https://www.health-samurai.io/mdmbox) — patient matching, merging, and deduplication on [Aidbox](https://www.health-samurai.io/aidbox) FHIR servers.

## Installation

```bash
# bun
bun add github:HealthSamurai/mdmbox-sdk

# npm
npm install HealthSamurai/mdmbox-sdk

# yarn
yarn add HealthSamurai/mdmbox-sdk
```

The package includes a `prepare` script that runs `tsc` on install, so it works with any runtime (Bun, Node.js, Vite, webpack). Bun users additionally get direct TypeScript imports via the `"bun"` export condition.

The SDK re-exports [`@health-samurai/aidbox-client`](https://github.com/nicola/aidbox-sdk-js) so you don't need to install it separately.

## Quick start

```ts
import { makeAidboxClient } from "mdmbox-sdk";
import { makeClient as makeMdmboxClient } from "mdmbox-sdk";

const aidbox = makeAidboxClient({
  baseUrl: "http://localhost:8888",
  auth: "Basic <base64-credentials>",
});

const mdmbox = makeMdmboxClient({
  baseUrl: "http://localhost:3003",
  auth: { username: "my-client", password: "my-secret" },
});

// Find matches for a patient
const result = await mdmbox.matchById({
  resourceType: "Patient",
  id: "123",
  modelId: "my-patient-model",
  threshold: 16,
});

if (result.isOk()) {
  result.value.resource.results.forEach((r) => {
    console.log(r.id, r.score, r.matchDetails);
  });
}
```

## API

### `makeClient(config)`

Creates a MDMbox client.

```ts
import { makeClient } from "mdmbox-sdk";

const mdmbox = makeClient({
  baseUrl: "http://localhost:3003",
  auth: { username: "my-client", password: "my-secret" }, // optional
  headers: { "X-Trace-Id": "..." }, // optional extra headers
});
```

All methods return `Result<T, MdmboxError>` — use `result.isOk()` / `result.isErr()` to handle success and failure.

### Authentication

MDMbox validates the inbound `Authorization` header (via its embedded libox).
Pass `auth` to set that header on every request:

```ts
// HTTP Basic — the supported scheme today. Credentials are base64-encoded
// into `Authorization: Basic ...`.
makeClient({ baseUrl, auth: { username: "my-client", password: "my-secret" } });

// Bearer token — sent as `Authorization: Bearer <token>`.
makeClient({ baseUrl, auth: { token: "ey..." } });

// Raw header value — used verbatim.
makeClient({ baseUrl, auth: "Basic dXNlcjpwYXNz" });
```

An `Authorization` entry in `headers` (client- or per-request) takes precedence
over `auth`. When auth is disabled server-side (`MDMBOX_AUTH_ENABLED=false`),
`auth` can be omitted entirely.

All tuning options (`modelId`, `threshold`, `onlyCertainMatches`,
`onlySingleMatch`, `count`) are sent as named entries inside a FHIR
`Parameters` request body — the SDK builds it for you.

#### `matchById(params)`

Match an existing resource by id. The resource is loaded server-side from the
id, so you don't pass it.

```ts
const result = await mdmbox.matchById({
  resourceType: "Patient",
  id: "123",
  modelId: "sonic-patient-model",
  threshold: 16,
  onlyCertainMatches: false,
  onlySingleMatch: false,
  count: 20,
});
```

#### `match(params)`

Match a resource passed inline.

```ts
const result = await mdmbox.match({
  resourceType: "Patient",
  resource: {
    resourceType: "Patient",
    name: [{ given: ["Jane"], family: "Doe" }],
    gender: "female",
    birthDate: "1985-04-12",
  },
  modelId: "sonic-patient-model",
  threshold: 16,
  count: 20,
});
```

#### `merge(params)` / `mergePreview(params)`

Execute or preview a merge. The SDK auto-populates `ifMatch` headers from `resource.meta.versionId` for optimistic locking.

```ts
const result = await mdmbox.merge({
  source: "Patient/123",
  target: "Patient/456",
  entries: [
    {
      resource: { /* merged Patient state */ },
      request: { method: "PUT", url: "Patient/456" },
    },
    {
      request: { method: "DELETE", url: "Patient/123" },
    },
  ],
});
```

#### `findRelated(params)`

Find resources referencing a given resource.

```ts
const result = await mdmbox.findRelated({
  resourceType: "Patient",
  id: "123",
  relatedTypes: ["Encounter", "Observation"],
});
```

#### `getModel(params)`

Fetch a matching model by id.

```ts
const result = await mdmbox.getModel({ id: "sonic-patient-model" });
```

### FHIR access

The MDMbox client exposes a whitelisted FHIR proxy under `/fhir-server-api`, so apps don't need a separate Aidbox client to read or write resources. All methods use the same auth/headers as the rest of the SDK and return `Result<{ resource }, MdmboxError>`.

#### `read(params)`

`GET /fhir-server-api/{resourceType}/{id}` — read a FHIR resource by id.

```ts
const result = await mdmbox.read({ resourceType: "Patient", id: "123" });
```

#### `vread(params)`

`GET /fhir-server-api/{resourceType}/{id}/_history/{vid}` — read a specific version.

```ts
const result = await mdmbox.vread({
  resourceType: "Patient",
  id: "123",
  versionId: "2",
});
```

#### `search(params)`

`GET /fhir-server-api/{resourceType}?...` — FHIR search. Returns the searchset Bundle as-is; flattening is left to the caller. Pass `params` as a `[key, value][]` pair list to preserve order and support repeated keys (e.g. `_has`), or as a `Record<string, string | string[]>`.

```ts
const result = await mdmbox.search({
  resourceType: "Patient",
  params: [
    ["name", "John"],
    ["_count", "20"],
  ],
});

if (result.isOk()) {
  for (const entry of result.value.resource.entry ?? []) {
    console.log(entry.resource);
  }
}
```

#### `readReference(params)`

Read by FHIR reference string. Accepts `"Type/id"` or `"Type/id/_history/vid"` (the latter delegates to `vread`). Useful for following references in a merge plan.

```ts
const result = await mdmbox.readReference({
  reference: "Patient/123/_history/4",
});
```

#### `bundle(params)`

`POST /fhir-server-api` — submit a FHIR `Bundle` (batch or transaction).

```ts
const result = await mdmbox.bundle({
  bundle: {
    resourceType: "Bundle",
    type: "batch",
    entry: [
      { request: { method: "GET", url: "Patient/123" } },
      { request: { method: "GET", url: "Encounter?subject=Patient/123" } },
    ],
  },
});
```

### `makeAidboxClient(config)`

> **Deprecated.** Prefer the [`MdmboxClient` FHIR methods](#fhir-access) (`read` / `search` / `bundle` / …) — they go through the whitelisted MDMbox proxy and don't require a separate Aidbox dependency or auth setup. `makeAidboxClient` will be removed in a future release.

Re-exported from `@health-samurai/aidbox-client`. Provides FHIR `read`, `search`, `searchBundle`, `transaction`, and `query` operations.

```ts
import { makeAidboxClient } from "mdmbox-sdk";

const aidbox = makeAidboxClient({
  baseUrl: "http://localhost:8888",
  auth: "Basic <base64-credentials>",
});

const patient = await aidbox.read("Patient", "123");
const results = await aidbox.search("Patient", { name: "John" });
```

### Merge-plan helpers

Pure functions for building merge plans on the client side.

```ts
import {
  getField,
  setField,
  pickFields,
  unionUnique,
  replaceReference,
  relink,
  toBundle,
} from "mdmbox-sdk";
```

| Function | Description |
|---|---|
| `getField(resource, field)` | Get a top-level field from a resource |
| `setField(resource, field, value)` | Return a new resource with a field replaced (immutable) |
| `pickFields(source, target, fromSource, fromTarget)` | Build a result by picking fields from two resources |
| `unionUnique(a, b, keyFn)` | Merge two arrays, deduplicating by a key function |
| `replaceReference(node, sourceId, targetId, refType)` | Recursively rewrite FHIR references |
| `relink(resources, sourceId, targetId, resourceType)` | Apply `replaceReference` to a list of resources |
| `toBundle({ save, delete })` | Build a FHIR transaction Bundle with auto `ifMatch` |

### End-to-end example

```ts
import {
  makeAidboxClient,
  makeClient as makeMdmboxClient,
  relink,
  toBundle,
} from "mdmbox-sdk";

const aidbox = makeAidboxClient({ baseUrl: "http://localhost:8888", auth });
const mdmbox = makeMdmboxClient({ baseUrl: "http://localhost:3003" });

// 1. Load source and target patients
const source = await aidbox.read("Patient", "123");
const target = await aidbox.read("Patient", "456");

// 2. Find related resources and rewrite references
const related = await mdmbox.findRelated({
  resourceType: "Patient",
  id: "123",
  relatedTypes: ["Encounter", "Observation"],
});
const relinked = relink(related.value.resource, "123", "456", "Patient");

// 3. Execute merge
const result = await mdmbox.merge({
  source: "Patient/123",
  target: "Patient/456",
  entries: [
    {
      resource: { ...target, identifier: [...target.identifier, ...source.identifier] },
      request: { method: "PUT", url: "Patient/456" },
    },
    ...relinked.map((r) => ({
      resource: r as Record<string, unknown>,
      request: { method: "PUT" as const, url: `${r.resourceType}/${r.id}` },
    })),
    {
      request: { method: "DELETE", url: "Patient/123" },
    },
  ],
});
```

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Type-check
bun run check-types
```

## Project structure

```
src/
├── index.ts          ← public exports
├── client.ts         ← MdmboxClient factory and operations
├── merge-plan.ts     ← pure helpers for building merge plans
└── types/
    ├── fhir.ts       ← Resource, Bundle, Reference, ...
    └── mdmbox.ts     ← MatchResult, MergeParams, MatchingModel, ...
```

## License

[MIT](LICENSE) — Health Samurai
