import { describe, expect, test } from "bun:test";
import { buildMergeBody } from "../src";
import { __internal } from "../src/client";

const { applyIfMatch } = __internal;

describe("applyIfMatch", () => {
  test("populates ifMatch from resource.meta.versionId when withIfMatch=true", () => {
    const entries = [
      {
        resource: { resourceType: "Patient", id: "1", meta: { versionId: "5" } },
        request: { method: "PUT" as const, url: "Patient/1" },
      },
    ];
    const result = applyIfMatch(entries, true);
    expect(result[0].request.ifMatch).toBe('W/"5"');
  });

  test("does NOT overwrite an existing ifMatch", () => {
    const entries = [
      {
        resource: { resourceType: "Patient", id: "1", meta: { versionId: "5" } },
        request: {
          method: "PUT" as const,
          url: "Patient/1",
          ifMatch: 'W/"manual"',
        },
      },
    ];
    const result = applyIfMatch(entries, true);
    expect(result[0].request.ifMatch).toBe('W/"manual"');
  });

  test("does nothing when withIfMatch=false", () => {
    const entries = [
      {
        resource: { resourceType: "Patient", id: "1", meta: { versionId: "5" } },
        request: { method: "PUT" as const, url: "Patient/1" },
      },
    ];
    const result = applyIfMatch(entries, false);
    expect(result[0].request.ifMatch).toBeUndefined();
  });

  test("skips entries without versionId", () => {
    const entries = [
      {
        resource: { resourceType: "Patient", id: "1" },
        request: { method: "PUT" as const, url: "Patient/1" },
      },
    ];
    const result = applyIfMatch(entries, true);
    expect(result[0].request.ifMatch).toBeUndefined();
  });

  test("does not mutate the original entry", () => {
    const entries = [
      {
        resource: { resourceType: "Patient", id: "1", meta: { versionId: "5" } },
        request: { method: "PUT" as const, url: "Patient/1" },
      },
    ];
    applyIfMatch(entries, true);
    expect(entries[0].request.ifMatch).toBeUndefined();
  });
});

describe("buildMergeBody", () => {
  const entries = [
    {
      resource: { resourceType: "Patient", id: "456", meta: { versionId: "3" } },
      request: { method: "PUT" as const, url: "Patient/456" },
    },
    {
      request: { method: "DELETE" as const, url: "Patient/123", ifMatch: 'W/"2"' },
    },
  ];

  test("wraps the plan in a Parameters envelope", () => {
    const body = buildMergeBody({
      source: "Patient/123",
      target: "Patient/456",
      entries,
      preview: false,
    });
    expect(body.resourceType).toBe("Parameters");

    const names = body.parameter.map((p) => p.name);
    expect(names).toEqual(["source", "target", "preview", "plan"]);
  });

  test("source/target are valueReferences", () => {
    const body = buildMergeBody({
      source: "Patient/123",
      target: "Patient/456",
      entries,
      preview: false,
    });
    const source = body.parameter.find((p) => p.name === "source") as any;
    const target = body.parameter.find((p) => p.name === "target") as any;
    expect(source.valueReference).toEqual({ reference: "Patient/123" });
    expect(target.valueReference).toEqual({ reference: "Patient/456" });
  });

  test("preview=false is propagated", () => {
    const body = buildMergeBody({
      source: "Patient/123",
      target: "Patient/456",
      entries,
      preview: false,
    });
    const preview = body.parameter.find((p) => p.name === "preview") as any;
    expect(preview.valueBoolean).toBe(false);
  });

  test("preview=true is propagated", () => {
    const body = buildMergeBody({
      source: "Patient/123",
      target: "Patient/456",
      entries,
      preview: true,
    });
    const preview = body.parameter.find((p) => p.name === "preview") as any;
    expect(preview.valueBoolean).toBe(true);
  });

  test("plan is a transaction Bundle and ifMatch is auto-populated", () => {
    const body = buildMergeBody({
      source: "Patient/123",
      target: "Patient/456",
      entries,
      preview: false,
    });
    const plan = body.parameter.find((p) => p.name === "plan") as any;
    const bundle = plan.resource;
    expect(bundle.resourceType).toBe("Bundle");
    expect(bundle.type).toBe("transaction");
    expect(bundle.entry.length).toBe(2);
    expect(bundle.entry[0].request.ifMatch).toBe('W/"3"');
    expect(bundle.entry[1].request.ifMatch).toBe('W/"2"');
  });

  test("withIfMatch=false leaves ifMatch alone", () => {
    const body = buildMergeBody({
      source: "Patient/123",
      target: "Patient/456",
      withIfMatch: false,
      entries,
      preview: false,
    });
    const plan = body.parameter.find((p) => p.name === "plan") as any;
    expect(plan.resource.entry[0].request.ifMatch).toBeUndefined();
    expect(plan.resource.entry[1].request.ifMatch).toBe('W/"2"');
  });
});
