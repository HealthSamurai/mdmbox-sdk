/**
 * Integration tests against a live mdmbox.
 *
 * Set `MDMBOX_URL` (default `http://localhost:3003`) to point at a running
 * instance and `MDMBOX_PG_URL` (default
 * `postgres://postgres:postgres@localhost:5438/aidbox`) for fixture cleanup.
 * If either isn't reachable, every test in this file is skipped — CI without
 * a live mdmbox will still pass.
 *
 *   bun test tests/fhir.integration.test.ts
 *
 * Lifecycle:
 *   - beforeAll: wipe any leftover fixtures via Postgres, then PUT 10 fresh
 *     Patient fixtures via a transaction Bundle.
 *   - afterAll:  DELETE rows from `patient` and `patient_history` directly
 *     in Postgres so re-runs start clean (the FHIR proxy doesn't accept
 *     direct DELETE, and bundle-DELETE leaves history/tombstones behind).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { makeClient } from "../src/client";
import type { Bundle, Resource, SearchsetBundle } from "../src/types/fhir";

const BASE_URL = process.env.MDMBOX_URL ?? "http://localhost:3003";
const PG_URL =
  process.env.MDMBOX_PG_URL ??
  "postgres://postgres:postgres@localhost:5438/aidbox";
const ID_PREFIX = "mdmbox-sdk-it-";
const FIXTURE_TAG_SYSTEM = "http://mdmbox-sdk/test";
const FIXTURE_TAG_VALUE = "integration-fixtures";
const FIXTURE_IDENTIFIER = `${FIXTURE_TAG_SYSTEM}|${FIXTURE_TAG_VALUE}`;

interface Fixture {
  id: string;
  family: string;
  given: string;
  gender: "male" | "female";
  birthDate: string;
}

const FIXTURES: Fixture[] = [
  { id: `${ID_PREFIX}001`, family: "Smith",   given: "Alice",   gender: "female", birthDate: "1990-01-15" },
  { id: `${ID_PREFIX}002`, family: "Smith",   given: "Bob",     gender: "male",   birthDate: "1985-06-20" },
  { id: `${ID_PREFIX}003`, family: "Johnson", given: "Carol",   gender: "female", birthDate: "1992-03-10" },
  { id: `${ID_PREFIX}004`, family: "Johnson", given: "Dave",    gender: "male",   birthDate: "1978-11-05" },
  { id: `${ID_PREFIX}005`, family: "Williams",given: "Eve",     gender: "female", birthDate: "2000-07-22" },
  { id: `${ID_PREFIX}006`, family: "Williams",given: "Frank",   gender: "male",   birthDate: "1995-09-30" },
  { id: `${ID_PREFIX}007`, family: "Brown",   given: "Grace",   gender: "female", birthDate: "1988-04-18" },
  { id: `${ID_PREFIX}008`, family: "Brown",   given: "Henry",   gender: "male",   birthDate: "1972-12-01" },
  { id: `${ID_PREFIX}009`, family: "Davis",   given: "Ivy",     gender: "female", birthDate: "1998-02-14" },
  { id: `${ID_PREFIX}010`, family: "Davis",   given: "Jack",    gender: "male",   birthDate: "1980-08-25" },
];

function patientResource(f: Fixture): Resource {
  return {
    resourceType: "Patient",
    id: f.id,
    identifier: [
      { system: FIXTURE_TAG_SYSTEM, value: FIXTURE_TAG_VALUE },
    ],
    name: [{ family: f.family, given: [f.given] }],
    gender: f.gender,
    birthDate: f.birthDate,
  } as Resource;
}

const client = makeClient({ baseUrl: BASE_URL });
let live = false;
let db: SQL | undefined;

async function purgeFixtures(): Promise<void> {
  if (!db) return;
  // Both `patient` (live rows) and `patient_history` (old versions and
  // tombstones from prior bundle-DELETEs) must be cleaned, otherwise the
  // identifier-scoped search assertions can pick up stale data.
  await db`DELETE FROM patient WHERE id LIKE ${ID_PREFIX + "%"}`;
  await db`DELETE FROM patient_history WHERE id LIKE ${ID_PREFIX + "%"}`;
}

beforeAll(async () => {
  try {
    const meta = await fetch(`${BASE_URL}/fhir-server-api/metadata`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!meta.ok) return;
  } catch {
    return;
  }

  try {
    db = new SQL(PG_URL);
    await db`SELECT 1`;
  } catch (e: any) {
    console.error(`[integration] postgres unreachable at ${PG_URL}:`, e?.message);
    db = undefined;
    return;
  }

  await purgeFixtures();

  const seed: Bundle = {
    resourceType: "Bundle",
    type: "transaction",
    entry: FIXTURES.map((f) => ({
      resource: patientResource(f),
      request: { method: "PUT", url: `Patient/${f.id}` },
    })),
  };
  const result = await client.bundle({ bundle: seed });
  if (result.isErr()) {
    console.error(
      "[integration] failed to seed fixtures:",
      result.value.resource.issue?.[0]?.diagnostics
    );
    return;
  }
  live = true;
});

afterAll(async () => {
  try {
    if (live) await purgeFixtures();
  } finally {
    await db?.end();
  }
});

const it = (name: string, fn: () => Promise<void> | void) =>
  test(name, async () => {
    if (!live) {
      console.log(`[skip] ${name} — mdmbox not reachable / seeding failed`);
      return;
    }
    await fn();
  });

describe("integration: MdmboxClient FHIR (live)", () => {
  describe("read", () => {
    it("reads each seeded Patient by id", async () => {
      for (const f of FIXTURES) {
        const result = await client.read<any>({
          resourceType: "Patient",
          id: f.id,
        });
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const p = result.value.resource;
          expect(p.id).toBe(f.id);
          expect(p.gender).toBe(f.gender);
          expect(p.birthDate).toBe(f.birthDate);
          expect(p.name?.[0]?.family).toBe(f.family);
          expect(p.name?.[0]?.given?.[0]).toBe(f.given);
        }
      }
    });

    it("404 on a missing id returns Err with not-found OperationOutcome", async () => {
      const result = await client.read({
        resourceType: "Patient",
        id: `${ID_PREFIX}does-not-exist`,
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.value.resource.resourceType).toBe("OperationOutcome");
        expect(result.value.resource.issue?.[0]?.code).toBe("not-found");
      }
    });
  });

  describe("vread", () => {
    it("reads the current version of a seeded Patient", async () => {
      const f = FIXTURES[0];
      const head = await client.read<any>({
        resourceType: "Patient",
        id: f.id,
      });
      expect(head.isOk()).toBe(true);
      if (!head.isOk()) return;

      const versionId = head.value.resource.meta?.versionId;
      expect(versionId).toBeTruthy();

      const result = await client.vread<any>({
        resourceType: "Patient",
        id: f.id,
        versionId,
      });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.resource.id).toBe(f.id);
      }
    });
  });

  describe("readReference", () => {
    it("Type/id form reads the resource", async () => {
      const f = FIXTURES[1];
      const result = await client.readReference<any>({
        reference: `Patient/${f.id}`,
      });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value.resource.id).toBe(f.id);
    });

    it("Type/id/_history/vid form reads the specific version", async () => {
      const f = FIXTURES[1];
      const head = await client.read<any>({
        resourceType: "Patient",
        id: f.id,
      });
      if (!head.isOk()) throw new Error("head read failed");
      const versionId = head.value.resource.meta?.versionId;

      const result = await client.readReference<any>({
        reference: `Patient/${f.id}/_history/${versionId}`,
      });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value.resource.id).toBe(f.id);
    });
  });

  describe("search", () => {
    const fixtureIds = (bundle: SearchsetBundle<any>): string[] =>
      (bundle.entry ?? [])
        .map((e) => e.resource?.id)
        .filter((id): id is string => !!id && id.startsWith(ID_PREFIX));

    it("by family — finds two Smiths", async () => {
      const result = await client.search<any>({
        resourceType: "Patient",
        params: { family: "Smith", _count: "50" },
      });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const ids = fixtureIds(result.value.resource);
        expect(ids.sort()).toEqual([
          `${ID_PREFIX}001`,
          `${ID_PREFIX}002`,
        ]);
      }
    });

    it("by given — finds Alice", async () => {
      const result = await client.search<any>({
        resourceType: "Patient",
        params: { given: "Alice", family: "Smith", _count: "50" },
      });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const ids = fixtureIds(result.value.resource);
        expect(ids).toEqual([`${ID_PREFIX}001`]);
      }
    });

    it("by gender + family — narrows to one Brown female", async () => {
      const result = await client.search<any>({
        resourceType: "Patient",
        params: { gender: "female", family: "Brown", _count: "50" },
      });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const ids = fixtureIds(result.value.resource);
        expect(ids).toEqual([`${ID_PREFIX}007`]);
      }
    });

    it("by birthdate — exact match", async () => {
      const result = await client.search<any>({
        resourceType: "Patient",
        params: { birthdate: "1990-01-15", family: "Smith" },
      });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const ids = fixtureIds(result.value.resource);
        expect(ids).toEqual([`${ID_PREFIX}001`]);
      }
    });

    it("by birthdate range (scoped to fixtures via identifier)", async () => {
      // ge1995 within our fixture set ⇒ Eve (2000), Frank (1995), Ivy (1998).
      const result = await client.search<any>({
        resourceType: "Patient",
        params: [
          ["identifier", FIXTURE_IDENTIFIER],
          ["birthdate", "ge1995-01-01"],
          ["_count", "50"],
        ],
      });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const ids = fixtureIds(result.value.resource);
        expect(ids.sort()).toEqual([
          `${ID_PREFIX}005`, // Eve 2000
          `${ID_PREFIX}006`, // Frank 1995
          `${ID_PREFIX}009`, // Ivy 1998
        ]);
      }
    });

    it("by identifier — finds all 10 fixtures", async () => {
      const result = await client.search<any>({
        resourceType: "Patient",
        params: { identifier: FIXTURE_IDENTIFIER, _count: "50" },
      });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const ids = fixtureIds(result.value.resource);
        expect(ids.length).toBe(FIXTURES.length);
        expect(ids.sort()).toEqual(FIXTURES.map((f) => f.id).sort());
      }
    });

    it("returns a searchset Bundle as-is (no flattening)", async () => {
      const result = await client.search<any>({
        resourceType: "Patient",
        params: { _id: FIXTURES[0].id },
      });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const b = result.value.resource;
        expect(b.resourceType).toBe("Bundle");
        expect(b.type).toBe("searchset");
        expect(b.entry?.[0]?.resource?.id).toBe(FIXTURES[0].id);
      }
    });

    it("supports repeated keys in the query string", async () => {
      // Repeated `family` values combine via AND on this server. We only
      // care that the SDK actually emits the duplicate key (and the server
      // accepts it), so we use the same value twice for a stable assertion.
      const result = await client.search<any>({
        resourceType: "Patient",
        params: [
          ["family", "Davis"],
          ["family", "Davis"],
          ["_count", "50"],
        ],
      });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const ids = fixtureIds(result.value.resource);
        expect(ids.sort()).toEqual([
          `${ID_PREFIX}009`,
          `${ID_PREFIX}010`,
        ]);
      }
    });
  });

  describe("bundle", () => {
    it("batch GET — fetches multiple seeded Patients in one round-trip", async () => {
      const input: Bundle = {
        resourceType: "Bundle",
        type: "batch",
        entry: FIXTURES.slice(0, 3).map((f) => ({
          request: { method: "GET", url: `Patient/${f.id}` },
        })),
      };

      const result = await client.bundle({ bundle: input });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const out = result.value.resource;
        expect(out.resourceType).toBe("Bundle");
        expect(out.type).toBe("batch-response");
        expect(out.entry?.length).toBe(3);

        const ids = (out.entry ?? []).map(
          (e: any) => e.resource?.id
        );
        expect(ids).toEqual([
          `${ID_PREFIX}001`,
          `${ID_PREFIX}002`,
          `${ID_PREFIX}003`,
        ]);
      }
    });
  });
});
