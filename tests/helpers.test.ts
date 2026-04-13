import { describe, expect, test } from "bun:test";
import {
  getField,
  setField,
  unionUnique,
  pickFields,
  replaceReference,
  relink,
  toBundle,
} from "../src";
import type { Resource } from "../src";

const patient = (id: string, extra: Record<string, unknown> = {}): Resource => ({
  resourceType: "Patient",
  id,
  ...extra,
});

describe("fields", () => {
  test("getField/setField round-trip", () => {
    const p = patient("1", { gender: "male" });
    expect(getField(p, "gender")).toBe("male");
    const updated = setField(p, "gender", "female");
    expect(getField(updated, "gender")).toBe("female");
    // immutability
    expect(getField(p, "gender")).toBe("male");
  });

  test("unionUnique keeps `a` items first and dedups by key", () => {
    const a = [{ k: "x" }, { k: "y" }];
    const b = [{ k: "y" }, { k: "z" }];
    expect(unionUnique(a, b, (i) => i.k)).toEqual([
      { k: "x" },
      { k: "y" },
      { k: "z" },
    ]);
  });

  test("pickFields applies fromTarget then fromSource overrides", () => {
    const source = patient("1", { name: [{ family: "S" }], gender: "male" });
    const target = patient("2", { name: [{ family: "T" }], gender: "female" });
    const result = pickFields(source, target, ["name"], ["gender"]);
    expect(result.id).toBe("2");
    expect((result as any).gender).toBe("female"); // from target
    expect((result as any).name).toEqual([{ family: "S" }]); // from source
  });
});

describe("references", () => {
  test("replaceReference rewrites Patient/sourceId nested", () => {
    const enc: any = {
      resourceType: "Encounter",
      id: "e1",
      subject: { reference: "Patient/123" },
      participant: [{ individual: { reference: "Patient/123" } }],
    };
    const out: any = replaceReference(enc, "123", "456", "Patient");
    expect(out.subject.reference).toBe("Patient/456");
    expect(out.participant[0].individual.reference).toBe("Patient/456");
  });

  test("replaceReference rewrites top-level resourceType+id shape", () => {
    const ref = { resourceType: "Patient", id: "123" };
    const out: any = replaceReference(ref, "123", "456", "Patient");
    expect(out.id).toBe("456");
  });

  test("replaceReference is immutable", () => {
    const enc: any = {
      resourceType: "Encounter",
      id: "e1",
      subject: { reference: "Patient/123" },
    };
    replaceReference(enc, "123", "456", "Patient");
    expect(enc.subject.reference).toBe("Patient/123");
  });

  test("relink applies replaceReference to a list", () => {
    const list: Resource[] = [
      {
        resourceType: "Encounter",
        id: "e1",
        subject: { reference: "Patient/123" },
      } as any,
    ];
    const out = relink(list, "123", "456", "Patient");
    expect((out[0] as any).subject.reference).toBe("Patient/456");
  });
});

describe("bundle", () => {
  test("toBundle: PUT for save, DELETE for delete, ifMatch from versionId", () => {
    const save: Resource[] = [
      {
        resourceType: "Patient",
        id: "1",
        meta: { versionId: "5" },
      },
    ];
    const del: Resource[] = [
      {
        resourceType: "Patient",
        id: "2",
        meta: { versionId: "9" },
      },
    ];
    const bundle = toBundle({ save, delete: del });
    expect(bundle.resourceType).toBe("Bundle");
    expect(bundle.type).toBe("transaction");
    expect(bundle.entry.length).toBe(2);
    expect(bundle.entry[0].request.method).toBe("PUT");
    expect(bundle.entry[0].request.url).toBe("Patient/1");
    expect(bundle.entry[0].request.ifMatch).toBe("5");
    expect(bundle.entry[1].request.method).toBe("DELETE");
    expect(bundle.entry[1].request.ifMatch).toBe("9");
  });

  test("toBundle works with empty inputs", () => {
    const bundle = toBundle({});
    expect(bundle.entry).toEqual([]);
  });
});
