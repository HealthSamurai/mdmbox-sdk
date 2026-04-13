/**
 * Generic utilities for building client-side merge plans.
 *
 * These are resource-type agnostic — they work with any FHIR resource.
 * Domain-specific helpers (mergeIdentifiers, mergeNames, etc.) belong
 * in the application layer.
 */

import type { Resource, Bundle, BundleEntry } from "./types/fhir";

// ==================== Field access ====================

/** Get a top-level field from a resource. */
export function getField<T = unknown>(
  resource: Resource,
  field: string
): T | undefined {
  return (resource as any)[field];
}

/** Return a new resource with a single field replaced. */
export function setField(
  resource: Resource,
  field: string,
  value: unknown
): Resource {
  return { ...resource, [field]: value };
}

/**
 * Combine two arrays of objects, deduplicating by a custom key function.
 * Items in `a` win on conflict.
 */
export function unionUnique<T extends object>(
  a: T[],
  b: T[],
  keyFn: (item: T) => string
): T[] {
  const existing = new Set(a.map(keyFn));
  return [...a, ...b.filter((item) => !existing.has(keyFn(item)))];
}

/**
 * Build a result resource by picking fields from two source resources.
 * Starts from `target`, then applies `fromTarget` fields, then `fromSource` overrides.
 */
export function pickFields(
  source: Resource,
  target: Resource,
  fromSource: string[],
  fromTarget: string[]
): Resource {
  const result = { ...target };
  for (const field of fromTarget) {
    const val = getField(target, field);
    if (val !== undefined) (result as any)[field] = val;
  }
  for (const field of fromSource) {
    const val = getField(source, field);
    if (val !== undefined) (result as any)[field] = val;
  }
  return result;
}

// ==================== References ====================

/**
 * Recursively replace FHIR references of the form `{refType}/{sourceId}`
 * with `{refType}/{targetId}`.
 */
export function replaceReference(
  node: unknown,
  sourceId: string,
  targetId: string,
  refType: string
): unknown {
  if (Array.isArray(node)) {
    return node.map((item) =>
      replaceReference(item, sourceId, targetId, refType)
    );
  }

  if (node !== null && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const result = { ...obj };

    if (result.reference === `${refType}/${sourceId}`) {
      result.reference = `${refType}/${targetId}`;
    }

    if (result.id === sourceId && result.resourceType === refType) {
      result.id = targetId;
    }

    for (const [key, value] of Object.entries(result)) {
      result[key] = replaceReference(value, sourceId, targetId, refType);
    }

    return result;
  }

  return node;
}

/** Apply `replaceReference` to a list of resources. */
export function relink(
  resources: Resource[],
  sourceId: string,
  targetId: string,
  resourceType: string
): Resource[] {
  return resources.map(
    (r) => replaceReference(r, sourceId, targetId, resourceType) as Resource
  );
}

// ==================== Bundle builder ====================

/**
 * Build a FHIR transaction Bundle from lists of resources to save (PUT) and delete.
 * If a resource carries a `meta.versionId`, it is added as `request.ifMatch`.
 */
export function toBundle(params: {
  save?: Resource[];
  delete?: Resource[];
}): Bundle {
  const entries: BundleEntry[] = [];

  for (const resource of params.save || []) {
    const entry: BundleEntry = {
      resource,
      request: {
        method: "PUT",
        url: `${resource.resourceType}/${resource.id}`,
      },
    };
    if (resource.meta?.versionId) {
      entry.request.ifMatch = resource.meta.versionId;
    }
    entries.push(entry);
  }

  for (const resource of params.delete || []) {
    const entry: BundleEntry = {
      request: {
        method: "DELETE",
        url: `${resource.resourceType}/${resource.id}`,
      },
    };
    if (resource.meta?.versionId) {
      entry.request.ifMatch = resource.meta.versionId;
    }
    entries.push(entry);
  }

  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: entries,
  };
}
