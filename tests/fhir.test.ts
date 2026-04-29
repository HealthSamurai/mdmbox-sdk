import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { makeClient, __internal } from "../src/client";
import type { Bundle } from "../src/types/fhir";

const { buildSearchParams, parseReference } = __internal;

interface CapturedRequest {
  url: string;
  init?: RequestInit;
}

interface MockResponseSpec {
  status?: number;
  body: unknown;
}

const BASE_URL = "http://localhost:3003";

function mockFetch(spec: MockResponseSpec): {
  calls: CapturedRequest[];
  restore: () => void;
} {
  const calls: CapturedRequest[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(spec.body), {
      status: spec.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

describe("buildSearchParams", () => {
  test("returns empty when no params", () => {
    expect(buildSearchParams().toString()).toBe("");
    expect(buildSearchParams(undefined).toString()).toBe("");
  });

  test("preserves repeated keys from a pair list", () => {
    const qs = buildSearchParams([
      ["_has", "Encounter:patient:status=finished"],
      ["_has", "Observation:subject:code=1234"],
    ]).toString();
    // URLSearchParams URL-encodes ":" and "=", so compare via parsing:
    const parsed = new URLSearchParams(qs);
    expect(parsed.getAll("_has")).toEqual([
      "Encounter:patient:status=finished",
      "Observation:subject:code=1234",
    ]);
  });

  test("expands array values from a Record into repeated keys", () => {
    const qs = buildSearchParams({ a: ["1", "2"], b: "3" });
    expect(qs.getAll("a")).toEqual(["1", "2"]);
    expect(qs.get("b")).toBe("3");
  });
});

describe("parseReference", () => {
  test("parses Type/id", () => {
    expect(parseReference("Patient/123")).toEqual({
      resourceType: "Patient",
      id: "123",
    });
  });

  test("parses Type/id/_history/vid", () => {
    expect(parseReference("Patient/123/_history/2")).toEqual({
      resourceType: "Patient",
      id: "123",
      versionId: "2",
    });
  });

  test("returns null for malformed reference", () => {
    expect(parseReference("Patient")).toBeNull();
    expect(parseReference("Patient/123/_history")).toBeNull();
    expect(parseReference("Patient/123/extra/2")).toBeNull();
  });
});

describe("MdmboxClient.read", () => {
  let mock: ReturnType<typeof mockFetch>;
  afterEach(() => mock?.restore());

  test("happy path — returns the resource and hits the right URL", async () => {
    mock = mockFetch({
      body: { resourceType: "Patient", id: "123", gender: "male" },
    });
    const client = makeClient({ baseUrl: BASE_URL });
    const result = await client.read({ resourceType: "Patient", id: "123" });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.resource).toEqual({
        resourceType: "Patient",
        id: "123",
        gender: "male",
      });
    }
    expect(mock.calls[0].url).toBe(`${BASE_URL}/fhir-server-api/Patient/123`);
    // Default GET (no method specified)
    expect(mock.calls[0].init?.method).toBeUndefined();
  });

  test("URL-encodes id with special characters", async () => {
    mock = mockFetch({ body: { resourceType: "Patient", id: "abc/xyz" } });
    const client = makeClient({ baseUrl: BASE_URL });
    await client.read({ resourceType: "Patient", id: "abc/xyz" });
    expect(mock.calls[0].url).toBe(
      `${BASE_URL}/fhir-server-api/Patient/abc%2Fxyz`
    );
  });

  test("404 — returns Err with the OperationOutcome from the body", async () => {
    const outcome = {
      resourceType: "OperationOutcome",
      issue: [
        {
          severity: "error",
          code: "not-found",
          diagnostics: "Patient not found",
        },
      ],
    };
    mock = mockFetch({ status: 404, body: outcome });

    const client = makeClient({ baseUrl: BASE_URL });
    const result = await client.read({ resourceType: "Patient", id: "missing" });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.value.resource).toEqual(outcome);
    }
  });
});

describe("MdmboxClient.vread", () => {
  let mock: ReturnType<typeof mockFetch>;
  afterEach(() => mock?.restore());

  test("hits /_history/{vid}", async () => {
    mock = mockFetch({
      body: { resourceType: "Patient", id: "123", meta: { versionId: "2" } },
    });
    const client = makeClient({ baseUrl: BASE_URL });
    const result = await client.vread({
      resourceType: "Patient",
      id: "123",
      versionId: "2",
    });

    expect(result.isOk()).toBe(true);
    expect(mock.calls[0].url).toBe(
      `${BASE_URL}/fhir-server-api/Patient/123/_history/2`
    );
  });

  test("URL-encodes versionId", async () => {
    mock = mockFetch({ body: {} });
    const client = makeClient({ baseUrl: BASE_URL });
    await client.vread({
      resourceType: "Patient",
      id: "123",
      versionId: "v 1",
    });
    expect(mock.calls[0].url).toBe(
      `${BASE_URL}/fhir-server-api/Patient/123/_history/v%201`
    );
  });
});

describe("MdmboxClient.search", () => {
  let mock: ReturnType<typeof mockFetch>;
  afterEach(() => mock?.restore());

  test("repeated keys form ?a=1&a=2", async () => {
    mock = mockFetch({
      body: { resourceType: "Bundle", type: "searchset", total: 0, entry: [] },
    });
    const client = makeClient({ baseUrl: BASE_URL });
    await client.search({
      resourceType: "Patient",
      params: [
        ["a", "1"],
        ["a", "2"],
      ],
    });

    const url = new URL(mock.calls[0].url);
    expect(url.pathname).toBe("/fhir-server-api/Patient");
    expect(url.searchParams.getAll("a")).toEqual(["1", "2"]);
  });

  test("Record with array values produces repeated keys", async () => {
    mock = mockFetch({
      body: { resourceType: "Bundle", type: "searchset", entry: [] },
    });
    const client = makeClient({ baseUrl: BASE_URL });
    await client.search({
      resourceType: "Patient",
      params: { name: ["John", "Doe"], _count: "10" },
    });

    const url = new URL(mock.calls[0].url);
    expect(url.searchParams.getAll("name")).toEqual(["John", "Doe"]);
    expect(url.searchParams.get("_count")).toBe("10");
  });

  test("returns the searchset Bundle as-is (no flattening)", async () => {
    const bundle = {
      resourceType: "Bundle",
      type: "searchset",
      total: 1,
      entry: [
        {
          fullUrl: "http://localhost:8888/fhir/Patient/123",
          resource: { resourceType: "Patient", id: "123" },
          search: { mode: "match", score: 1 },
        },
      ],
    };
    mock = mockFetch({ body: bundle });
    const client = makeClient({ baseUrl: BASE_URL });
    const result = await client.search({ resourceType: "Patient" });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.resource).toEqual(bundle);
    }
  });

  test("no params — bare URL with no query string", async () => {
    mock = mockFetch({
      body: { resourceType: "Bundle", type: "searchset", entry: [] },
    });
    const client = makeClient({ baseUrl: BASE_URL });
    await client.search({ resourceType: "Patient" });
    expect(mock.calls[0].url).toBe(`${BASE_URL}/fhir-server-api/Patient`);
  });
});

describe("MdmboxClient.bundle", () => {
  let mock: ReturnType<typeof mockFetch>;
  afterEach(() => mock?.restore());

  test("POSTs to /fhir-server-api with JSON body and Content-Type header", async () => {
    const responseBundle: Bundle = {
      resourceType: "Bundle",
      type: "transaction",
      entry: [],
    };
    mock = mockFetch({ body: responseBundle });

    const client = makeClient({ baseUrl: BASE_URL });
    const input: Bundle = {
      resourceType: "Bundle",
      type: "batch",
      entry: [
        {
          request: { method: "GET", url: "Patient/123" },
        },
      ],
    };
    const result = await client.bundle({ bundle: input });

    expect(result.isOk()).toBe(true);
    expect(mock.calls[0].url).toBe(`${BASE_URL}/fhir-server-api`);
    expect(mock.calls[0].init?.method).toBe("POST");
    expect(JSON.parse(mock.calls[0].init?.body as string)).toEqual(input);

    const headers = new Headers(mock.calls[0].init?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  test("forwards configured headers", async () => {
    mock = mockFetch({
      body: { resourceType: "Bundle", type: "transaction", entry: [] },
    });
    const client = makeClient({
      baseUrl: BASE_URL,
      headers: { Authorization: "Bearer abc" },
    });
    await client.bundle({
      bundle: { resourceType: "Bundle", type: "transaction", entry: [] },
    });

    const headers = new Headers(mock.calls[0].init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer abc");
  });
});

describe("MdmboxClient.readReference", () => {
  let mock: ReturnType<typeof mockFetch>;
  afterEach(() => mock?.restore());

  test("Type/id form delegates to read", async () => {
    mock = mockFetch({ body: { resourceType: "Patient", id: "123" } });
    const client = makeClient({ baseUrl: BASE_URL });
    const result = await client.readReference({ reference: "Patient/123" });

    expect(result.isOk()).toBe(true);
    expect(mock.calls[0].url).toBe(`${BASE_URL}/fhir-server-api/Patient/123`);
  });

  test("Type/id/_history/vid form delegates to vread", async () => {
    mock = mockFetch({ body: { resourceType: "Patient", id: "123" } });
    const client = makeClient({ baseUrl: BASE_URL });
    const result = await client.readReference({
      reference: "Patient/123/_history/4",
    });

    expect(result.isOk()).toBe(true);
    expect(mock.calls[0].url).toBe(
      `${BASE_URL}/fhir-server-api/Patient/123/_history/4`
    );
  });

  test("malformed reference returns Err without making a request", async () => {
    mock = mockFetch({ body: {} });
    const client = makeClient({ baseUrl: BASE_URL });
    const result = await client.readReference({ reference: "garbage" });

    expect(result.isErr()).toBe(true);
    expect(mock.calls.length).toBe(0);
  });
});
