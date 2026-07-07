import { describe, expect, test } from "bun:test";
import { buildLinkBody, buildUnlinkBody } from "../src";
import type { LinkPlanEntry } from "../src/types/mdmbox";

const linkEntries: LinkPlanEntry[] = [
  {
    fullUrl: "urn:uuid:11111111-1111-4111-8111-111111111111",
    request: { method: "POST", url: "Linkage" },
    resource: {
      resourceType: "Linkage",
      meta: {
        profile: [
          "https://mdm.health-samurai.io/fhir/StructureDefinition/mdm-linkage",
        ],
      },
      active: true,
      item: [
        { type: "source", resource: { reference: "Patient/a" } },
        { type: "alternate", resource: { reference: "Patient/b" } },
      ],
    },
  },
];

describe("buildLinkBody", () => {
  test("wraps the plan in a Parameters envelope with plan + preview only", () => {
    const body = buildLinkBody({ entries: linkEntries, preview: false });
    expect(body.resourceType).toBe("Parameters");
    const names = body.parameter.map((p) => p.name);
    expect(names).toEqual(["plan", "preview"]);
  });

  test("has no source/target (client owns the plan)", () => {
    const body = buildLinkBody({ entries: linkEntries, preview: false });
    const names = body.parameter.map((p) => p.name);
    expect(names).not.toContain("source");
    expect(names).not.toContain("target");
  });

  test("plan is a transaction Bundle carrying the entries verbatim", () => {
    const body = buildLinkBody({ entries: linkEntries, preview: false });
    const plan = body.parameter.find((p) => p.name === "plan") as any;
    const bundle = plan.resource;
    expect(bundle.resourceType).toBe("Bundle");
    expect(bundle.type).toBe("transaction");
    expect(bundle.entry.length).toBe(1);
    expect(bundle.entry[0].request.method).toBe("POST");
    expect(bundle.entry[0].fullUrl).toBe(linkEntries[0].fullUrl);
  });

  test("preview flag is propagated", () => {
    const yes = buildLinkBody({ entries: linkEntries, preview: true });
    const no = buildLinkBody({ entries: linkEntries, preview: false });
    expect((yes.parameter.find((p) => p.name === "preview") as any).valueBoolean).toBe(true);
    expect((no.parameter.find((p) => p.name === "preview") as any).valueBoolean).toBe(false);
  });

  test("auto-populates ifMatch from resource.meta.versionId when present", () => {
    const entries: LinkPlanEntry[] = [
      {
        request: { method: "PATCH", url: "Linkage/l1" },
        resource: { resourceType: "Linkage", id: "l1", meta: { versionId: "7" } },
      },
    ];
    const body = buildLinkBody({ entries, preview: false });
    const plan = body.parameter.find((p) => p.name === "plan") as any;
    expect(plan.resource.entry[0].request.ifMatch).toBe('W/"7"');
  });

  test("withIfMatch=false leaves ifMatch alone", () => {
    const entries: LinkPlanEntry[] = [
      {
        request: { method: "PATCH", url: "Linkage/l1" },
        resource: { resourceType: "Linkage", id: "l1", meta: { versionId: "7" } },
      },
    ];
    const body = buildLinkBody({ entries, withIfMatch: false, preview: false });
    const plan = body.parameter.find((p) => p.name === "plan") as any;
    expect(plan.resource.entry[0].request.ifMatch).toBeUndefined();
  });
});

describe("buildUnlinkBody", () => {
  const deleteEntries: LinkPlanEntry[] = [
    { request: { method: "DELETE", url: "Linkage/l1" } },
  ];

  test("wraps the plan with task + preview + plan", () => {
    const body = buildUnlinkBody({
      task: "Task/lt1",
      entries: deleteEntries,
      preview: false,
    });
    expect(body.resourceType).toBe("Parameters");
    const names = body.parameter.map((p) => p.name);
    expect(names).toEqual(["task", "preview", "plan"]);
  });

  test("task is a valueReference", () => {
    const body = buildUnlinkBody({
      task: "Task/lt1",
      entries: deleteEntries,
      preview: false,
    });
    const task = body.parameter.find((p) => p.name === "task") as any;
    expect(task.valueReference).toEqual({ reference: "Task/lt1" });
  });

  test("plan is a transaction Bundle with the DELETE entry", () => {
    const body = buildUnlinkBody({
      task: "Task/lt1",
      entries: deleteEntries,
      preview: false,
    });
    const plan = body.parameter.find((p) => p.name === "plan") as any;
    expect(plan.resource.type).toBe("transaction");
    expect(plan.resource.entry[0].request.method).toBe("DELETE");
    expect(plan.resource.entry[0].request.url).toBe("Linkage/l1");
  });

  test("preview flag is propagated", () => {
    const body = buildUnlinkBody({
      task: "Task/lt1",
      entries: deleteEntries,
      preview: true,
    });
    expect((body.parameter.find((p) => p.name === "preview") as any).valueBoolean).toBe(true);
  });
});
