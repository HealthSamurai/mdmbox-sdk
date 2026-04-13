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
 * A FHIR transaction Bundle entry with required `request`.
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
 * A FHIR transaction Bundle.
 */
export type Bundle = Omit<FhirBundle, "entry" | "type"> & {
  type: "transaction";
  entry: BundleEntry[];
};
