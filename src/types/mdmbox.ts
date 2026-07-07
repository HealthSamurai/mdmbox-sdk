/**
 * Type definitions for MDMbox API operations.
 */

import type { OperationOutcome } from "./fhir";

// ==================== Match ====================

/** A single match result. */
export interface MatchResult {
  id: string;
  resource: Record<string, unknown>;
  /** Raw log-odds weight (`search.score`). */
  score: number;
  /** Normalized match probability 0..1 (`search.normalizedScore`). */
  normalizedScore?: number;
  /** Match grade from the `match-grade` extension `valueCode` (e.g. "certain"). */
  matchGrade?: string;
  /**
   * Per-feature log-odds contributions. Keys are model-defined and therefore
   * vary by matching model (e.g. `fn`/`dob`/`ext`/`sex`, or
   * `given`/`family`/`birth_date`/`email`/...), so this is an open map.
   */
  matchDetails: Record<string, number>;
  projection: Record<string, unknown>;
}

/** Successful match response. */
export interface MatchResponse {
  total: number;
  results: MatchResult[];
}

/**
 * Tuning parameters shared by `match` and `matchById`. All are sent as named
 * entries inside the FHIR `Parameters` request body.
 */
export interface MatchOptions {
  /** MatchingModel id. Required by the server (`modelId`). */
  modelId?: string;
  /** Log-odds weight threshold (`threshold`, `valueDecimal`). */
  threshold?: number;
  /** Restrict results to certain-grade matches (`onlyCertainMatches`). */
  onlyCertainMatches?: boolean;
  /** Ask the server to designate a single appropriate match (`onlySingleMatch`). */
  onlySingleMatch?: boolean;
  /** Cap the number of results (`count`, `valueInteger`). */
  count?: number;
}

/** Parameters for `matchById` — match an existing resource by id. */
export interface MatchByIdParams extends MatchOptions {
  /** FHIR resource type (e.g. "Patient", "Practitioner"). */
  resourceType: string;
  /** Resource id to match against — the resource is loaded server-side. */
  id: string;
}

/** Parameters for `match` — match a resource passed in the request body. */
export interface MatchParams extends MatchOptions {
  /** FHIR resource type (e.g. "Patient", "Practitioner"). */
  resourceType: string;
  /** The FHIR resource to match against (sent as the `resource` parameter). */
  resource: Record<string, unknown>;
}

// ==================== Matching Model ====================

/** A MatchingModel resource — describes blocking rules and feature scoring. */
export interface MatchingModel {
  id: string;
  resource: string;
  blocks: Record<string, unknown>;
  features: Record<string, unknown>;
  thresholds?: { auto?: number; manual?: number };
  vars?: Record<string, unknown>;
  relatedResources?: string[];
  "bulk-table"?: Record<string, unknown>;
}

// ==================== Find Related ====================

/** Parameters for `findRelated` — find resources referencing a given resource. */
export interface FindRelatedParams {
  /** FHIR resource type (e.g. "Patient"). */
  resourceType: string;
  /** Resource id to find references to. */
  id: string;
  /** Resource types to search in (e.g. ["Encounter", "Observation"]). */
  relatedTypes: string[];
  /** Max number of results (default: server-side). */
  count?: number;
  /** Offset for pagination. */
  offset?: number;
}

// ==================== Merge ====================

/** One entry of a merge plan (mirrors a FHIR `Bundle.entry`). */
export interface MergePlanEntry {
  resource?: Record<string, unknown>;
  request: {
    method: "PUT" | "POST" | "DELETE";
    url: string;
    /** Optimistic-locking ETag, e.g. `W/"3"`. */
    ifMatch?: string;
  };
}

/** The transaction Bundle wrapping all merge plan entries. */
export interface TransactionBundle {
  resourceType: "Bundle";
  type: "transaction";
  entry: MergePlanEntry[];
}

/**
 * Parameters accepted by `MdmboxClient.merge`.
 *
 * @property source Reference to the resource being merged away (e.g. `"Patient/123"`).
 * @property target Reference to the resource being merged into (the "winner").
 * @property withIfMatch When true (default), the SDK populates `ifMatch` on every PUT entry
 *   from `entry.resource.meta.versionId`. Set to `false` to manage `ifMatch` manually.
 * @property entries List of merge plan entries (PUT/POST/DELETE).
 */
export interface MergeParams {
  source: string;
  target: string;
  withIfMatch?: boolean;
  entries: MergePlanEntry[];
}

/** Successful merge response. */
export interface MergeResponse {
  resource: {
    outcome: OperationOutcome;
    inputParameters?: Record<string, unknown>;
    task?: Record<string, unknown>;
    result?: Record<string, unknown>;
  };
}

/** Successful merge preview response. */
export interface MergePreviewResponse {
  resource: {
    outcome: OperationOutcome;
    bundle: TransactionBundle;
  };
}

// ==================== Unmerge ====================

/**
 * Parameters accepted by `MdmboxClient.unmerge`.
 *
 * @property source Reference to the resource that was merged away (e.g. `"Patient/123"`).
 * @property target Reference to the resource that was merged into (the "winner").
 * @property withIfMatch When true (default), the SDK populates `ifMatch` on every PUT entry
 *   from `entry.resource.meta.versionId`. Set to `false` to manage `ifMatch` manually.
 * @property entries List of unmerge plan entries (PUT/POST/DELETE).
 */
export interface UnmergeParams {
  source: string;
  target: string;
  withIfMatch?: boolean;
  entries: MergePlanEntry[];
}

/** Successful unmerge response. */
export interface UnmergeResponse {
  resource: {
    outcome: OperationOutcome;
    inputParameters?: Record<string, unknown>;
    task?: Record<string, unknown>;
    result?: Record<string, unknown>;
  };
}

/** Successful unmerge preview response. */
export interface UnmergePreviewResponse {
  resource: {
    outcome: OperationOutcome;
    bundle: TransactionBundle;
  };
}

// ==================== Link / Unlink ====================

/**
 * One entry of a link (or unlink) plan (mirrors a FHIR `Bundle.entry`).
 *
 * Unlike a merge plan, a link plan is append-only — the server allows only
 * `POST` (create a new `Linkage`) and `PATCH` (non-destructively extend an
 * existing one). An unlink plan typically carries a single `DELETE` of the
 * `Linkage` (a profiled Linkage is fixed `active=true`, so it cannot be
 * deactivated in place).
 *
 * `fullUrl` is a client-assigned `urn:uuid:` for a POSTed resource so the
 * server's audit Provenance can reference the created Linkage.
 */
export interface LinkPlanEntry {
  fullUrl?: string;
  resource?: Record<string, unknown>;
  request: {
    method: "POST" | "PATCH" | "PUT" | "DELETE";
    url: string;
    /** Optimistic-locking ETag, e.g. `W/"3"`. */
    ifMatch?: string;
  };
}

/**
 * Parameters accepted by `MdmboxClient.link`.
 *
 * The client owns the plan; there is no source/target. The plan MUST create or
 * patch at least one profiled `Linkage`.
 *
 * @property withIfMatch When true (default), the SDK populates `ifMatch` on any
 *   entry that carries `resource.meta.versionId`. Set to `false` to manage it
 *   manually (the usual case for PATCH entries).
 * @property entries List of link plan entries (POST / PATCH).
 */
export interface LinkParams {
  withIfMatch?: boolean;
  entries: LinkPlanEntry[];
}

/** Successful link response. */
export interface LinkResponse {
  resource: {
    outcome: OperationOutcome;
    inputParameters?: Record<string, unknown>;
    task?: Record<string, unknown>;
  };
}

/** Successful link preview response. */
export interface LinkPreviewResponse {
  resource: {
    outcome: OperationOutcome;
    bundle: TransactionBundle;
  };
}

/**
 * Parameters accepted by `MdmboxClient.unlink`.
 *
 * @property task Reference to the link audit `Task` being reversed (e.g.
 *   `"Task/123"`).
 * @property withIfMatch When true (default), the SDK populates `ifMatch` on any
 *   entry that carries `resource.meta.versionId`.
 * @property entries List of reverse plan entries — typically a single `DELETE`
 *   of the Linkage.
 */
export interface UnlinkParams {
  task: string;
  withIfMatch?: boolean;
  entries: LinkPlanEntry[];
}

/** Successful unlink response. */
export interface UnlinkResponse {
  resource: {
    outcome: OperationOutcome;
    inputParameters?: Record<string, unknown>;
    task?: Record<string, unknown>;
  };
}

/** Successful unlink preview response. */
export interface UnlinkPreviewResponse {
  resource: {
    outcome: OperationOutcome;
    bundle: TransactionBundle;
  };
}
