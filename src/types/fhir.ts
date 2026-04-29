/**
 * FHIR type definitions for the SDK.
 *
 * We re-export types from @health-samurai/aidbox-client where possible.
 * Where their codegen types are too narrow for our use case, we extend
 * them with intersection types.
 */

// Direct re-exports — used as-is
export type {
  OperationOutcome,
  OperationOutcomeIssue,
  Meta,
  Reference,
  Coding,
} from "@health-samurai/aidbox-client";

// ==================== Extended types ====================

import type {
  Resource as FhirResource,
  Bundle as FhirBundle,
  BundleEntry as FhirBundleEntry,
} from "@health-samurai/aidbox-client";

/**
 * A generic FHIR resource with arbitrary `resourceType`.
 *
 * Upstream `Resource` restricts `resourceType` to a closed union.
 * Our merge-plan helpers must work with any resource type, so we widen it.
 */
export type Resource = Omit<FhirResource, "resourceType"> & {
  resourceType: string;
  id: string;
  [key: string]: unknown;
};

/**
 * A FHIR Bundle entry with required `request`.
 *
 * Upstream `BundleEntry.request` is optional and `resource` uses the
 * narrow `FhirResource`. We tighten `request` and widen `resource`.
 */
export type BundleEntry = Omit<FhirBundleEntry, "request" | "resource"> & {
  resource?: Resource;
  request: {
    method: "GET" | "PUT" | "POST" | "DELETE";
    url: string;
    ifMatch?: string;
  };
};

/**
 * A FHIR batch / transaction Bundle (request) or its response.
 *
 * The MDMbox FHIR proxy accepts `"batch" | "transaction"` and replies with
 * a `"batch-response" | "transaction-response"` Bundle.
 */
export type Bundle = Omit<FhirBundle, "entry" | "type"> & {
  type: "batch" | "transaction" | "batch-response" | "transaction-response";
  entry: BundleEntry[];
};

/**
 * A FHIR searchset Bundle returned from `search`.
 */
export type SearchsetBundle<T = unknown> = Omit<FhirBundle, "entry" | "type"> & {
  type: "searchset";
  total?: number;
  entry?: Array<{
    fullUrl?: string;
    resource?: T;
    search?: { mode?: "match" | "include" | "outcome"; score?: number };
  }>;
};
