import { Ok, Err } from "@health-samurai/aidbox-client";
import type { Result } from "@health-samurai/aidbox-client";
import type { OperationOutcome } from "./types/fhir";
import type {
  MatchByIdParams,
  MatchParams,
  MatchResponse,
  MatchResult,
  MatchingModel,
  FindRelatedParams,
  MergeParams,
  MergePlanEntry,
  MergePreviewResponse,
  MergeResponse,
  TransactionBundle,
} from "./types/mdmbox";

// ==================== Private helpers ====================

const MATCH_DETAILS_URL =
  "http://mdmbox.dev/fhir/StructureDefinition/match-details";
const PROJECTION_URL =
  "http://mdmbox.dev/fhir/StructureDefinition/projection";

function parseMatchDetails(ext: any[]): MatchResult["matchDetails"] {
  const detailsExt = ext?.find((e: any) => e.url === MATCH_DETAILS_URL);
  if (!detailsExt?.valueString) return { fn: 0, dob: 0, ext: 0, sex: 0 };
  const s: string = detailsExt.valueString;
  const get = (key: string): number => {
    const m = s.match(new RegExp(`:${key}\\s+(-?[\\d.]+)`));
    return m ? parseFloat(m[1]) : 0;
  };
  return { fn: get("fn"), dob: get("dob"), ext: get("ext"), sex: get("sex") };
}

function parseProjection(ext: any[]): Record<string, unknown> {
  const projExt = ext?.find((e: any) => e.url === PROJECTION_URL);
  if (!projExt?.extension) return {};
  const result: Record<string, unknown> = {};
  for (const e of projExt.extension) {
    result[e.url] =
      e.valueString ?? e.valueInteger ?? e.valueDecimal ?? e.valueBoolean ?? null;
  }
  return result;
}

function extractIdFromFullUrl(fullUrl: string): string {
  const parts = fullUrl.split("/");
  return parts[parts.length - 1] || "";
}

function buildMatchQuery(params: {
  modelId?: string;
  threshold?: number;
  page?: number;
  count?: number;
  withDuplicates?: boolean;
  episodeNumber?: string;
  projectionId?: string;
}): string {
  const qs = new URLSearchParams();
  if (params.page !== undefined) qs.set("page", String(params.page));
  if (params.count !== undefined) qs.set("size", String(params.count));
  if (params.modelId) qs.set("model-id", params.modelId);
  if (params.threshold !== undefined)
    qs.set("threshold", String(params.threshold));
  if (params.withDuplicates) qs.set("with-duplicates", "true");
  if (params.episodeNumber) qs.set("episode-number", params.episodeNumber);
  if (params.projectionId) qs.set("projection-id", params.projectionId);
  return qs.toString();
}

function applyIfMatch(
  entries: MergePlanEntry[],
  withIfMatch: boolean
): MergePlanEntry[] {
  if (!withIfMatch) return entries;
  return entries.map((e) => {
    if (e.request.ifMatch) return e;
    const versionId = (e.resource as any)?.meta?.versionId;
    if (!versionId) return e;
    return {
      ...e,
      request: { ...e.request, ifMatch: `W/"${versionId}"` },
    };
  });
}

/** Build the FHIR `Parameters` body for a merge request. */
export function buildMergeBody(
  params: MergeParams & { preview: boolean }
): {
  resourceType: "Parameters";
  parameter: Array<Record<string, unknown>>;
} {
  const withIfMatch = params.withIfMatch !== false;
  const entries = applyIfMatch(params.entries, withIfMatch);

  const bundle: TransactionBundle = {
    resourceType: "Bundle",
    type: "transaction",
    entry: entries,
  };

  return {
    resourceType: "Parameters",
    parameter: [
      { name: "source", valueReference: { reference: params.source } },
      { name: "target", valueReference: { reference: params.target } },
      { name: "preview", valueBoolean: params.preview },
      { name: "plan", resource: bundle },
    ],
  };
}

function getParameter(payload: any, name: string): any {
  return payload?.parameter?.find((p: any) => p.name === name);
}

// ==================== Config & types ====================

/**
 * Configuration for `makeClient`.
 *
 * @property baseUrl MDMbox base URL (without trailing slash).
 * @property headers Optional extra headers added to every request.
 */
export interface MdmboxClientConfig {
  baseUrl: string;
  headers?: Record<string, string>;
}

/** Error shape returned in `Err` results. */
export interface MdmboxError {
  resource: OperationOutcome;
}

/** The client object returned by `makeClient`. */
export interface MdmboxClient {
  /** Low-level typed request. */
  request: <T>(url: string, init?: RequestInit) => Promise<Result<{ resource: T }, MdmboxError>>;

  /** `POST /api/fhir/{resource}/{id}/$match` — match an existing resource by id. */
  matchById: (params: MatchByIdParams) => Promise<Result<{ resource: MatchResponse }, MdmboxError>>;

  /** `POST /api/fhir/{resource}/$match` — match a resource passed in the request body. */
  match: (params: MatchParams) => Promise<Result<{ resource: MatchResponse }, MdmboxError>>;

  /** `POST /api/$merge` */
  merge: (params: MergeParams) => Promise<Result<MergeResponse, MdmboxError>>;

  /** `POST /api/$merge` with `preview: true` */
  mergePreview: (params: MergeParams) => Promise<Result<MergePreviewResponse, MdmboxError>>;

  /** `POST /api/fhir/{resource}/{id}/$referencing` */
  findRelated: (params: FindRelatedParams) => Promise<Result<{ resource: any }, MdmboxError>>;

  /** `GET /api/models/{id}` */
  getModel: (params: { id: string }) => Promise<Result<{ resource: MatchingModel }, MdmboxError>>;
}

// ==================== Factory ====================

/**
 * Create a MDMbox client.
 *
 * @example
 * ```ts
 * import { makeClient } from "mdmbox-sdk";
 *
 * const mdmbox = makeClient({ baseUrl: "http://localhost:3003" });
 *
 * const result = await mdmbox.matchById({
 *   resourceType: "Patient",
 *   id: "123",
 *   modelId: "sonic-patient-model",
 *   threshold: 16,
 * });
 *
 * if (result.isErr()) {
 *   console.error(result.value.resource.issue[0]?.details?.text);
 *   return;
 * }
 *
 * result.value.resource.results.forEach((r) => console.log(r.id, r.score));
 * ```
 */
export function makeClient(config: MdmboxClientConfig): MdmboxClient {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...config.headers,
  };

  async function request<T>(
    url: string,
    init?: RequestInit
  ): Promise<Result<{ resource: T }, MdmboxError>> {
    try {
      const res = await fetch(`${baseUrl}${url}`, {
        ...init,
        headers: { ...headers, ...init?.headers },
      });

      const body: any = await res.json().catch(() => null);

      if (!res.ok) {
        const outcome: OperationOutcome =
          body?.resourceType === "OperationOutcome"
            ? body
            : {
                resourceType: "OperationOutcome",
                issue: [
                  {
                    severity: "error",
                    code: "exception",
                    diagnostics: `Request failed: ${res.status}`,
                  },
                ],
              };
        return Err({ resource: outcome });
      }

      return Ok({ resource: body as T });
    } catch (e: any) {
      return Err({
        resource: {
          resourceType: "OperationOutcome",
          issue: [
            {
              severity: "fatal",
              code: "exception",
              diagnostics: e?.message ?? "Network error",
            },
          ],
        },
      });
    }
  }

  function parseMatchBundle(
    result: Result<{ resource: any }, MdmboxError>
  ): Result<{ resource: MatchResponse }, MdmboxError> {
    return result.map(({ resource: bundle }) => ({
      resource: {
        total: bundle.total ?? (bundle.entry || []).length,
        results: (bundle.entry || []).map((e: any) => ({
          id: extractIdFromFullUrl(e.fullUrl || ""),
          resource: e.resource,
          score: e.search?.score ?? 0,
          matchDetails: parseMatchDetails(e.search?.extension),
          projection: parseProjection(e.search?.extension),
        })),
      } as MatchResponse,
    }));
  }

  async function matchById(
    params: MatchByIdParams
  ): Promise<Result<{ resource: MatchResponse }, MdmboxError>> {
    const query = buildMatchQuery(params);
    const url = `/api/fhir/${params.resourceType}/${params.id}/$match${query ? `?${query}` : ""}`;
    return parseMatchBundle(await request<any>(url, { method: "POST" }));
  }

  async function match(
    params: MatchParams
  ): Promise<Result<{ resource: MatchResponse }, MdmboxError>> {
    const query = buildMatchQuery(params);
    const url = `/api/fhir/${params.resourceType}/$match${query ? `?${query}` : ""}`;
    return parseMatchBundle(
      await request<any>(url, {
        method: "POST",
        body: JSON.stringify(params.body),
      })
    );
  }

  async function merge(
    params: MergeParams
  ): Promise<Result<MergeResponse, MdmboxError>> {
    const body = buildMergeBody({ ...params, preview: false });
    const result = await request<any>("/api/$merge", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return result.map(({ resource: payload }) => {
      const outcomeParam = getParameter(payload, "outcome");
      const outcome: OperationOutcome = outcomeParam?.resource ?? {
        resourceType: "OperationOutcome",
        issue: [],
      };
      return {
        resource: {
          outcome,
          task: getParameter(payload, "task")?.resource,
          result: getParameter(payload, "result")?.resource,
          inputParameters: getParameter(payload, "input-parameters")?.resource,
        },
      };
    });
  }

  async function mergePreview(
    params: MergeParams
  ): Promise<Result<MergePreviewResponse, MdmboxError>> {
    const body = buildMergeBody({ ...params, preview: true });
    const result = await request<any>("/api/$merge", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return result.map(({ resource: payload }) => {
      const outcomeParam = getParameter(payload, "outcome");
      const outcome: OperationOutcome = outcomeParam?.resource ?? {
        resourceType: "OperationOutcome",
        issue: [],
      };
      const bundleParam = getParameter(payload, "bundle");
      return {
        resource: {
          outcome,
          bundle: bundleParam?.resource as TransactionBundle,
        },
      };
    });
  }

  async function findRelated(
    params: FindRelatedParams
  ): Promise<Result<{ resource: any }, MdmboxError>> {
    const parameter: Array<Record<string, unknown>> = params.relatedTypes.map(
      (t) => ({ name: "type", valueString: t })
    );
    if (params.count !== undefined)
      parameter.push({ name: "count", valueInteger: params.count });
    if (params.offset !== undefined)
      parameter.push({ name: "offset", valueInteger: params.offset });

    const body = { resourceType: "Parameters", parameter };
    const url = `/api/fhir/${params.resourceType}/${params.id}/$referencing`;
    return request<any>(url, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async function getModel(params: {
    id: string;
  }): Promise<Result<{ resource: MatchingModel }, MdmboxError>> {
    return request<MatchingModel>(`/api/models/${params.id}`);
  }

  return {
    request,
    matchById,
    match,
    merge,
    mergePreview,
    findRelated,
    getModel,
  };
}

// Re-exported for tests.
export const __internal = {
  buildMatchQuery,
  parseMatchDetails,
  parseProjection,
  extractIdFromFullUrl,
  applyIfMatch,
  getParameter,
};
