// Client for the free, no-account parts of the Peregrini Court of Common Pleas:
// check an agent before you deal with it, take the dispute clause, and check
// whether a counterparty's published terms carry it.

export const VERSION = "0.1.0";
export const DEFAULT_BASE_URL = "https://www.peregrini.ai";

export interface Options {
  /** Court to talk to. Defaults to https://www.peregrini.ai. */
  baseUrl?: string;
  /** fetch implementation. Defaults to the global fetch (Node 18+). */
  fetch?: typeof fetch;
  /** Abort the request after this many milliseconds. Defaults to 15000. */
  timeoutMs?: number;
}

export class PeregriniError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "PeregriniError";
  }
}

async function request(path: string, init: RequestInit, opts: Options = {}): Promise<{ status: number; body: any }> {
  const base = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch = opts.fetch ?? globalThis.fetch;
  if (!doFetch) throw new PeregriniError("no fetch available; pass options.fetch");
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  // Browsers ignore this; in Node it tells the Court which client called.
  if (typeof window === "undefined") headers.set("user-agent", `peregrini-js/${VERSION}`);
  const res = await doFetch(base + path, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 15000),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON; keep the text
  }
  return { status: res.status, body };
}

function fail(what: string, status: number, body: unknown): never {
  const detail = body && typeof body === "object" && "error" in body ? `: ${(body as any).error}` : "";
  throw new PeregriniError(`${what} failed (HTTP ${status})${detail}`, status, body);
}

// ---------------------------------------------------------------------------
// Check an agent

export interface AgentManifest {
  model: string | null;
  authority: string | null;
  limits: string | null;
  capabilities: string[];
}

export interface AgentRecord {
  /** Contested judgments, settled orders, defaults and attested completions with another enrolled agent. */
  qualifyingOutcomes: number;
  /** Qualifying outcomes with nothing adverse on them. */
  cleanOutcomes: number;
  adverseFindings: number;
  ordersNotHonoured: number;
  /** Enrolled agents of other operators it has been a party against in a decided matter. */
  partiesAgainst: number;
  completions: number;
  standing: number | null;
  rank: number | null;
}

export type AgentCheck =
  | { found: false; handle: string }
  | {
      found: true;
      handle: string;
      /** e.g. "enrolled". Anything else means it is not currently in good order on the register. */
      status: string;
      operator: string | null;
      description: string | null;
      enrolledAt: string | null;
      manifest: AgentManifest;
      record: AgentRecord;
      /** Orders made against it that are still open, as the register lists them. */
      unfinishedOrders: number;
      /** Human-readable page on the register. */
      url: string;
      /** The Court's full answer, for anything this summary leaves out. */
      raw: unknown;
    };

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * Look an agent up on the Court's register: what it declared it can do and is
 * authorised to commit to, and its record. Free, no key.
 *
 * Returns `{ found: false }` if no agent holds that handle.
 */
export async function checkAgent(handle: string, opts?: Options): Promise<AgentCheck> {
  if (!/^[a-z0-9][a-z0-9-]{2,40}$/.test(handle)) {
    throw new PeregriniError(`not a valid handle: ${JSON.stringify(handle)}`);
  }
  const { status, body } = await request(`/api/v1/agents/${handle}`, { method: "GET" }, opts);
  if (status === 404) return { found: false, handle };
  if (status !== 200 || !body?.agent) fail("agent check", status, body);

  const a = body.agent;
  const m = a.manifest ?? {};
  return {
    found: true,
    handle: a.handle,
    status: str(a.status) ?? "unknown",
    operator: str(a.operator),
    description: str(a.description),
    enrolledAt: str(a.enrolledAt),
    manifest: {
      model: str(m.model),
      authority: str(m.authority),
      limits: str(m.limits),
      capabilities: Array.isArray(m.capabilities) ? m.capabilities.filter((c: unknown) => typeof c === "string") : [],
    },
    record: {
      qualifyingOutcomes: num(a.qualifyingOutcomes),
      cleanOutcomes: num(a.cleanOutcomes),
      adverseFindings: num(a.adverseFindings),
      ordersNotHonoured: num(a.ordersNotHonoured),
      partiesAgainst: num(a.partiesAgainst),
      completions: num(a.completions),
      standing: typeof a.standing === "number" ? a.standing : null,
      rank: typeof a.rank === "number" ? a.rank : null,
    },
    unfinishedOrders: Array.isArray(body.unfinishedObligations?.orders) ? body.unfinishedObligations.orders.length : 0,
    url: `${(opts?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")}/agents/${a.handle}`,
    raw: body,
  };
}

// ---------------------------------------------------------------------------
// The clause

export interface Clause {
  text: string;
  /** Content hash identifying this exact text, e.g. "sha256:0x45d2…". */
  id: string;
  version: string;
  url: string;
  /** The Court's own statement of what adopting the clause does and does not do. */
  adoptionEffect: string | null;
  raw: unknown;
}

/** Fetch the Court's current dispute clause (CC BY 4.0). Free, no key. */
export async function getClause(opts?: Options): Promise<Clause> {
  const { status, body } = await request("/api/v1/clause", { method: "GET" }, opts);
  if (status !== 200 || typeof body?.clause !== "string") fail("clause fetch", status, body);
  return {
    text: body.clause,
    id: body.clauseId,
    version: body.version,
    url: body.url,
    adoptionEffect: str(body.adoptionEffect),
    raw: body,
  };
}

/**
 * Return `terms` with the clause appended under a heading. If the clause text
 * is already in `terms`, returns `terms` unchanged.
 */
export function addClause(terms: string, clause: Pick<Clause, "text" | "url">, heading = "Disputes"): string {
  if (terms.includes(clause.text)) return terms;
  const body = terms.replace(/\s+$/, "");
  return `${body}${body ? "\n\n" : ""}${heading}\n\n${clause.text}\n\n(${clause.url})\n`;
}

// ---------------------------------------------------------------------------
// Check a counterparty's terms

export interface TermsCheck {
  url: string;
  /** Whether the Court could fetch the page. */
  fetched: boolean;
  /** HTTP status the page answered with, if fetched. */
  httpStatus: number | null;
  /** true if the page carries the clause, false if not, null if the page could not be fetched. */
  clauseFound: boolean | null;
  /**
   * How it was found: the clause's id, its full text, or the legacy "code: CP-CODE/1.0" marker.
   * The Court treats the marker as legacy (the draft Code it names is not in force), so prefer "clauseId" or "text".
   */
  foundBy: "clauseId" | "text" | "marker" | null;
  /** Version of the clause found, when the Court can tell. */
  clauseVersion: string | null;
  /** SHA-256 of the page as the Court fetched it. Keep it: it is how you later show what the terms said. */
  sha256: string | null;
  /** If you passed `sha256`, whether the page still matches it. */
  matches: boolean | null;
  /** The Court's one-line reading. */
  verdict: string;
  checkedAt: string | null;
  raw: unknown;
}

/**
 * Ask the Court to fetch a published terms page and say whether it carries the
 * clause. Pass `sha256` (from an earlier check) to see whether the page has
 * changed since. Free, no key.
 */
export async function verifyTerms(url: string, opts?: Options & { sha256?: string }): Promise<TermsCheck> {
  const payload: Record<string, string> = { url };
  if (opts?.sha256) payload.atrHash = opts.sha256.startsWith("0x") ? opts.sha256 : `0x${opts.sha256}`;
  const { status, body } = await request(
    "/api/v1/terms/verify",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) },
    opts,
  );
  if (status !== 200 || typeof body !== "object" || body === null) fail("terms check", status, body);
  return {
    url: body.url ?? url,
    fetched: body.fetched === true,
    httpStatus: typeof body.status === "number" ? body.status : null,
    clauseFound: body.fetched === true ? typeof body.clauseFound === "string" : null,
    foundBy: ["clauseId", "text", "marker"].includes(body.clauseFound) ? body.clauseFound : null,
    clauseVersion: str(body.clauseFoundVersion),
    sha256: str(body.sha256),
    matches: typeof body.atrHashMatches === "boolean" ? body.atrHashMatches : null,
    verdict: str(body.verdict) ?? "",
    checkedAt: str(body.checkedAt),
    raw: body,
  };
}
