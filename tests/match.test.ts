import { afterEach, describe, expect, test } from "bun:test";
import { __internal, makeClient } from "../src/client";

const {
  buildMatchParameters,
  parseMatchDetails,
  parseMatchGrade,
  parseProjection,
  extractIdFromFullUrl,
} = __internal;

const MATCH_DETAILS_URL =
  "http://mdmbox.dev/fhir/StructureDefinition/match-details";
const MATCH_GRADE_URL = "http://hl7.org/fhir/StructureDefinition/match-grade";

/** Look up a Parameters entry by name. */
const param = (body: ReturnType<typeof buildMatchParameters>, name: string) =>
  body.parameter.find((p) => p.name === name);

describe("buildMatchParameters", () => {
  test("empty options yield an empty Parameters body", () => {
    const body = buildMatchParameters({});
    expect(body.resourceType).toBe("Parameters");
    expect(body.parameter).toEqual([]);
  });

  test("modelId → valueString", () => {
    const body = buildMatchParameters({ modelId: "sonic-patient-model" });
    expect(param(body, "modelId")).toEqual({
      name: "modelId",
      valueString: "sonic-patient-model",
    });
  });

  test("emits all known options with correct value[x] types", () => {
    const body = buildMatchParameters({
      modelId: "m",
      threshold: 16.5,
      onlyCertainMatches: false,
      onlySingleMatch: false,
      count: 20,
    });
    expect(param(body, "modelId")).toEqual({ name: "modelId", valueString: "m" });
    expect(param(body, "threshold")).toEqual({
      name: "threshold",
      valueDecimal: 16.5,
    });
    expect(param(body, "onlyCertainMatches")).toEqual({
      name: "onlyCertainMatches",
      valueBoolean: false,
    });
    expect(param(body, "onlySingleMatch")).toEqual({
      name: "onlySingleMatch",
      valueBoolean: false,
    });
    expect(param(body, "count")).toEqual({ name: "count", valueInteger: 20 });
  });

  test("boolean false is still emitted (presence, not truthiness)", () => {
    const body = buildMatchParameters({ onlyCertainMatches: false });
    expect(param(body, "onlyCertainMatches")).toEqual({
      name: "onlyCertainMatches",
      valueBoolean: false,
    });
  });

  test("resource is included for type-level match, after modelId", () => {
    const resource = { resourceType: "Patient", id: "1" };
    const body = buildMatchParameters({ modelId: "m" }, resource);
    expect(param(body, "resource")).toEqual({ name: "resource", resource });
    // modelId precedes resource (matches server examples).
    const names = body.parameter.map((p) => p.name);
    expect(names.indexOf("modelId")).toBeLessThan(names.indexOf("resource"));
  });

  test("resource is omitted when not passed (instance-level match)", () => {
    const body = buildMatchParameters({ modelId: "m" });
    expect(param(body, "resource")).toBeUndefined();
  });
});

describe("parseMatchDetails", () => {
  test("parses nested extension + valueDecimal", () => {
    const ext = [
      {
        url: MATCH_DETAILS_URL,
        extension: [
          { url: "ext", valueDecimal: 6.465648574292063 },
          { url: "fn", valueDecimal: 13.336495228175629 },
          { url: "sex", valueDecimal: 0.0 },
          { url: "dob", valueDecimal: 10.59415069916466 },
        ],
      },
    ];
    expect(parseMatchDetails(ext)).toEqual({
      fn: 13.336495228175629,
      dob: 10.59415069916466,
      ext: 6.465648574292063,
      sex: 0,
    });
  });

  test("returns an empty object when extension missing", () => {
    expect(parseMatchDetails([])).toEqual({});
  });

  test("handles negative values", () => {
    const ext = [
      {
        url: MATCH_DETAILS_URL,
        extension: [
          { url: "dob", valueDecimal: -10.3 },
          { url: "ext", valueDecimal: 0 },
          { url: "fn", valueDecimal: -12.4 },
          { url: "sex", valueDecimal: 1.85 },
        ],
      },
    ];
    expect(parseMatchDetails(ext)).toEqual({
      fn: -12.4,
      dob: -10.3,
      ext: 0,
      sex: 1.85,
    });
  });

  test("collects all numeric keys; skips non-numeric values", () => {
    const ext = [
      {
        url: MATCH_DETAILS_URL,
        extension: [
          { url: "fn", valueDecimal: 5 },
          { url: "unknown", valueDecimal: 99 },
          { url: "dob", valueString: "not a number" },
        ],
      },
    ];
    // Model-defined keys (incl. "unknown") are kept; the non-numeric "dob" is skipped.
    expect(parseMatchDetails(ext)).toEqual({ fn: 5, unknown: 99 });
  });
});

describe("parseMatchGrade", () => {
  test("extracts valueCode from match-grade extension", () => {
    const ext = [{ url: MATCH_GRADE_URL, valueCode: "certain" }];
    expect(parseMatchGrade(ext)).toBe("certain");
  });

  test("returns undefined when absent", () => {
    expect(parseMatchGrade([])).toBeUndefined();
  });
});

describe("parseProjection", () => {
  test("flattens valueString/valueInteger/valueBoolean", () => {
    const ext = [
      {
        url: "http://mdmbox.dev/fhir/StructureDefinition/projection",
        extension: [
          { url: "birth_date", valueString: "2008-05-07" },
          { url: "encounter_count", valueInteger: 4 },
          { url: "active", valueBoolean: true },
        ],
      },
    ];
    expect(parseProjection(ext)).toEqual({
      birth_date: "2008-05-07",
      encounter_count: 4,
      active: true,
    });
  });

  test("returns {} when extension missing", () => {
    expect(parseProjection([])).toEqual({});
  });
});

describe("parseMatchBundle (via match)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const stubFetch = (bundle: unknown) => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(bundle), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
  };

  const client = makeClient({ baseUrl: "http://localhost:3003" });
  const callMatch = () =>
    client.match({ resourceType: "Patient", resource: { resourceType: "Patient" } });

  test("extracts normalizedScore, matchGrade and matchDetails", async () => {
    stubFetch({
      resourceType: "Bundle",
      type: "searchset",
      total: 1,
      entry: [
        {
          fullUrl: "http://localhost:3003/fhir/Patient/42",
          resource: { resourceType: "Patient", id: "42" },
          search: {
            mode: "match",
            score: 30.396294501632352,
            normalizedScore: 0.9999999992923743,
            extension: [
              { url: MATCH_GRADE_URL, valueCode: "certain" },
              {
                url: MATCH_DETAILS_URL,
                extension: [
                  { url: "ext", valueDecimal: 6.46 },
                  { url: "fn", valueDecimal: 13.33 },
                  { url: "sex", valueDecimal: 0.0 },
                  { url: "dob", valueDecimal: 10.59 },
                ],
              },
            ],
          },
        },
      ],
    });

    const result = await callMatch();
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    const r = result.value.resource.results[0]!;
    expect(r.score).toBe(30.396294501632352);
    expect(r.normalizedScore).toBe(0.9999999992923743);
    expect(r.matchGrade).toBe("certain");
    expect(r.matchDetails).toEqual({ fn: 13.33, dob: 10.59, ext: 6.46, sex: 0 });
  });

  test("entry without normalizedScore / match-grade does not throw", async () => {
    stubFetch({
      resourceType: "Bundle",
      type: "searchset",
      entry: [
        {
          fullUrl: "http://localhost:3003/fhir/Patient/7",
          resource: { resourceType: "Patient", id: "7" },
          search: { mode: "match", score: 12 },
        },
      ],
    });

    const result = await callMatch();
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    const r = result.value.resource.results[0]!;
    expect(r.normalizedScore).toBeUndefined();
    expect(r.matchGrade).toBeUndefined();
    expect(r.matchDetails).toEqual({});
  });

  test("collects model-defined match-details keys as-is", async () => {
    stubFetch({
      resourceType: "Bundle",
      type: "searchset",
      total: 1,
      entry: [
        {
          fullUrl: "http://localhost:3003/fhir/Patient/105",
          resource: { resourceType: "Patient", id: "105" },
          search: {
            mode: "match",
            score: 27.0,
            extension: [
              {
                url: MATCH_DETAILS_URL,
                extension: [
                  { url: "given", valueDecimal: 8.0 },
                  { url: "family", valueDecimal: 10.0 },
                  { url: "birth_date", valueDecimal: 12.0 },
                  { url: "postal_code", valueDecimal: -2.0 },
                  { url: "gender", valueDecimal: -1.0 },
                  { url: "email", valueDecimal: 0.0 },
                  { url: "phone", valueDecimal: 0.0 },
                ],
              },
            ],
          },
        },
      ],
    });

    const result = await callMatch();
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    const r = result.value.resource.results[0]!;
    expect(r.matchDetails).toEqual({
      given: 8.0,
      family: 10.0,
      birth_date: 12.0,
      postal_code: -2.0,
      gender: -1.0,
      email: 0.0,
      phone: 0.0,
    });
  });
});

describe("extractIdFromFullUrl", () => {
  test("returns trailing segment", () => {
    expect(extractIdFromFullUrl("http://localhost:8888/fhir//105")).toBe("105");
  });

  test("returns empty for empty input", () => {
    expect(extractIdFromFullUrl("")).toBe("");
  });
});
