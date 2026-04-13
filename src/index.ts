/**
 * mdmbox-sdk — TypeScript SDK for MDMbox and Aidbox.
 *
 * Re-exports `@health-samurai/aidbox-client` so consumers don't need
 * a direct dependency on it.
 *
 * See README.md for usage.
 */

// Aidbox client (re-exported from @health-samurai/aidbox-client)
export {
  makeClient as makeAidboxClient,
  Ok,
  Err,
} from "@health-samurai/aidbox-client";
export type {
  Result,
  FhirServerClient,
  RequestParams,
  ResponseWithMeta,
  ResourceResponse,
} from "@health-samurai/aidbox-client";

// MDMbox client
export * from "./client";

// Merge-plan helpers
export * from "./merge-plan";

// Types
export * from "./types";
