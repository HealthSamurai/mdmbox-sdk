/**
 * Type definitions for MDMbox API operations.
 */

import type { OperationOutcome } from "./fhir";

// ==================== Match ====================

/** A single match result. */
export interface MatchResult {
  id: string;
  resource: Record<string, unknown>;
  score: number;
  matchDetails: {
    fn: number;
    dob: number;
    ext: number;
    sex: number;
  };
  projection: Record<string, unknown>;
}

/** Successful match response. */
export interface MatchResponse {
  total: number;
  results: MatchResult[];
}

/** Parameters for `matchById` — match an existing resource by id. */
export interface MatchByIdParams {
  /** FHIR resource type (e.g. "Patient", "Practitioner"). */
  resourceType: string;
  /** Resource id to match against. */
  id: string;
  /** MatchingModel id (sent as `model-id` query param). */
  modelId?: string;
  threshold?: number;
  page?: number;
  count?: number;
  withDuplicates?: boolean;
  episodeNumber?: string;
  /** Projection id to enrich results with custom columns/aggregates. */
  projectionId?: string;
}

/** Parameters for `match` — match a resource passed in the request body. */
export interface MatchParams {
  /** FHIR resource type (e.g. "Patient", "Practitioner"). */
  resourceType: string;
  /** The FHIR Parameters body to match against. */
  body: Record<string, unknown>;
  /** MatchingModel id. */
  modelId?: string;
  threshold?: number;
  page?: number;
  count?: number;
  withDuplicates?: boolean;
  projectionId?: string;
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
