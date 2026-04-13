import { describe, expect, test } from "bun:test";
import { __internal } from "../src/client";

const { buildMatchQuery, parseMatchDetails, parseProjection, extractIdFromFullUrl } =
  __internal;

describe("buildMatchQuery", () => {
  test("returns empty string when no params", () => {
    expect(buildMatchQuery({})).toBe("");
  });

  test("translates `modelId` → `model-id`", () => {
    const qs = buildMatchQuery({ modelId: "sonic-patient-model" });
    const params = new URLSearchParams(qs);
    expect(params.get("model-id")).toBe("sonic-patient-model");
  });

  test("emits all known params", () => {
    const qs = buildMatchQuery({
      page: 2,
      count: 50,
      modelId: "m",
      threshold: 16.5,
      withDuplicates: true,
      episodeNumber: "EPS-1",
      projectionId: "proj-agg",
    });
    const params = new URLSearchParams(qs);
    expect(params.get("page")).toBe("2");
    expect(params.get("size")).toBe("50");
    expect(params.get("model-id")).toBe("m");
    expect(params.get("threshold")).toBe("16.5");
    expect(params.get("with-duplicates")).toBe("true");
    expect(params.get("episode-number")).toBe("EPS-1");
    expect(params.get("projection-id")).toBe("proj-agg");
  });

  test("withDuplicates=false is omitted", () => {
    const qs = buildMatchQuery({ withDuplicates: false });
    expect(qs).toBe("");
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
