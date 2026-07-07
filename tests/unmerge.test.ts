import { describe, expect, test } from "bun:test";
import { buildUnmergeBody } from "../src";
import type { MergePlanEntry } from "../src/types/mdmbox";

const entries: MergePlanEntry[] = [
  {
    resource: { resourceType: "Patient", id: "456", meta: { versionId: "3" } },
    request: { method: "PUT", url: "Patient/456" },
  },
  { request: { method: "PUT", url: "Patient/123" } },
];

describe("buildUnmergeBody", () => {
  test("wraps the plan with task + preview + plan (no source/target)", () => {
    const body = buildUnmergeBody({ task: "Task/mrg-1", entries, preview: false });
    expect(body.resourceType).toBe("Parameters");
    const names = body.parameter.map((p) => p.name);
    expect(names).toEqual(["task", "preview", "plan"]);
    expect(names).not.toContain("source");
    expect(names).not.toContain("target");
  });

  test("task is a valueReference (what the server reverses on)", () => {
    const body = buildUnmergeBody({ task: "Task/mrg-1", entries, preview: false });
    const task = body.parameter.find((p) => p.name === "task") as any;
    expect(task.valueReference).toEqual({ reference: "Task/mrg-1" });
  });

  test("preview flag is propagated", () => {
    const yes = buildUnmergeBody({ task: "Task/mrg-1", entries, preview: true });
    const no = buildUnmergeBody({ task: "Task/mrg-1", entries, preview: false });
    expect((yes.parameter.find((p) => p.name === "preview") as any).valueBoolean).toBe(true);
    expect((no.parameter.find((p) => p.name === "preview") as any).valueBoolean).toBe(false);
  });

  test("plan is a transaction Bundle and ifMatch is auto-populated", () => {
    const body = buildUnmergeBody({ task: "Task/mrg-1", entries, preview: false });
    const plan = body.parameter.find((p) => p.name === "plan") as any;
    expect(plan.resource.resourceType).toBe("Bundle");
    expect(plan.resource.type).toBe("transaction");
    expect(plan.resource.entry[0].request.ifMatch).toBe('W/"3"');
  });
});
