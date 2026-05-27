import { describe, expect, test } from "bun:test";
import { __internal } from "../src/client";

const {
  buildMatchParameters,
  parseMatchDetails,
  parseProjection,
  extractIdFromFullUrl,
} = __internal;

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
  test("parses Clojure-style map", () => {
    const ext = [
      {
        url: "http://mdmbox.dev/fhir/StructureDefinition/match-details",
        valueString: "{:dob 10.59, :ext 6.46, :fn 13.33, :sex 0.0}",
      },
    ];
    expect(parseMatchDetails(ext)).toEqual({
      fn: 13.33,
      dob: 10.59,
      ext: 6.46,
      sex: 0,
    });
  });

  test("returns zeros when extension missing", () => {
    expect(parseMatchDetails([])).toEqual({ fn: 0, dob: 0, ext: 0, sex: 0 });
  });

  test("handles negative values", () => {
    const ext = [
      {
        url: "http://mdmbox.dev/fhir/StructureDefinition/match-details",
        valueString: "{:dob -10.3, :ext 0, :fn -12.4, :sex 1.85}",
      },
    ];
    expect(parseMatchDetails(ext)).toEqual({
      fn: -12.4,
      dob: -10.3,
      ext: 0,
      sex: 1.85,
    });
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

describe("extractIdFromFullUrl", () => {
  test("returns trailing segment", () => {
    expect(extractIdFromFullUrl("http://localhost:8888/fhir//105")).toBe("105");
  });

  test("returns empty for empty input", () => {
    expect(extractIdFromFullUrl("")).toBe("");
  });
});
