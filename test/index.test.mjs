import { test } from "node:test";
import assert from "node:assert/strict";
import { addClause, checkAgent, getClause, PeregriniError, verifyTerms } from "../dist/index.js";

// A fetch that answers from a table and records what it was asked.
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const [status, body] = routes[path] ?? [404, { error: "not found" }];
    return new Response(JSON.stringify(body), { status });
  };
  fn.calls = calls;
  return fn;
}

const CLAUSE = { clause: "Any dispute ... (Rule 2.8).", clauseId: "sha256:0xabc", version: "1.2", url: "https://www.peregrini.ai/clauses/1.2", adoptionEffect: "Reading does not enrol." };

test("checkAgent summarises a register entry", async () => {
  const fetch = fakeFetch({
    "/api/v1/agents/some-agent": [200, {
      agent: {
        handle: "some-agent", status: "enrolled", operator: "Acme", enrolledAt: "2026-09-01T00:00:00Z",
        manifest: { model: "m", authority: "a", limits: "l", capabilities: ["x", 3] },
        qualifyingOutcomes: 5, cleanOutcomes: 4, adverseFindings: 1, ordersNotHonoured: 0, partiesAgainst: 2, completions: 1, standing: 0.8, rank: 3,
      },
      unfinishedObligations: { orders: [{}, {}] },
    }],
  });
  const r = await checkAgent("some-agent", { fetch });
  assert.equal(r.found, true);
  assert.equal(r.operator, "Acme");
  assert.deepEqual(r.manifest.capabilities, ["x"]);
  assert.equal(r.record.partiesAgainst, 2);
  assert.equal(r.unfinishedOrders, 2);
  assert.equal(r.url, "https://www.peregrini.ai/agents/some-agent");
});

test("checkAgent reports an unknown handle as not found", async () => {
  const r = await checkAgent("nobody-here", { fetch: fakeFetch({}) });
  assert.deepEqual(r, { found: false, handle: "nobody-here" });
});

test("checkAgent refuses a malformed handle without calling out", async () => {
  const fetch = fakeFetch({});
  await assert.rejects(checkAgent("../admin", { fetch }), PeregriniError);
  assert.equal(fetch.calls.length, 0);
});

test("checkAgent raises on a server error", async () => {
  const fetch = fakeFetch({ "/api/v1/agents/some-agent": [500, { error: "boom" }] });
  await assert.rejects(checkAgent("some-agent", { fetch }), /HTTP 500.*boom/);
});

test("baseUrl is honoured", async () => {
  const fetch = fakeFetch({ "/api/v1/clause": [200, CLAUSE] });
  await getClause({ fetch, baseUrl: "https://staging.example/" });
  assert.equal(fetch.calls[0].url, "https://staging.example/api/v1/clause");
});

test("getClause and addClause", async () => {
  const c = await getClause({ fetch: fakeFetch({ "/api/v1/clause": [200, CLAUSE] }) });
  assert.equal(c.id, "sha256:0xabc");
  const once = addClause("My terms.\n\n", c);
  assert.match(once, /^My terms\.\n\nDisputes\n\nAny dispute/);
  assert.equal(addClause(once, c), once, "adding twice changes nothing");
  assert.match(addClause("", c), /^Disputes\n/);
});

test("verifyTerms: found, not found, not fetched", async () => {
  const cases = [
    [{ fetched: true, status: 200, clauseFound: "clauseId", clauseFoundVersion: "1.2", sha256: "ff", atrHashMatches: null, verdict: "v" }, true, "clauseId"],
    [{ fetched: true, status: 200, clauseFound: null, sha256: "ff", atrHashMatches: null, verdict: "v" }, false, null],
    [{ fetched: false, clauseFound: null, error: "timeout", verdict: "not fetched" }, null, null],
  ];
  for (const [body, found, by] of cases) {
    const r = await verifyTerms("https://x.example/terms", { fetch: fakeFetch({ "/api/v1/terms/verify": [200, body] }) });
    assert.equal(r.clauseFound, found);
    assert.equal(r.foundBy, by);
  }
});

test("verifyTerms sends the hash in the Court's format", async () => {
  const fetch = fakeFetch({ "/api/v1/terms/verify": [200, { fetched: true, atrHashMatches: true, clauseFound: "text" }] });
  const r = await verifyTerms("https://x.example/terms", { fetch, sha256: "ab".repeat(32) });
  assert.deepEqual(JSON.parse(fetch.calls[0].init.body), { url: "https://x.example/terms", atrHash: "0x" + "ab".repeat(32) });
  assert.equal(r.matches, true);
});

// Against the real Court. Run with: npm run test:live
test("live: the Court answers as this client expects", { skip: !process.env.PEREGRINI_LIVE }, async () => {
  const c = await getClause();
  assert.match(c.id, /^sha256:0x[0-9a-f]{64}$/);
  const r = await verifyTerms(c.url);
  assert.equal(r.clauseFound, true);
  assert.equal((await checkAgent("no-such-agent-xyz")).found, false);
  const a = await checkAgent("al-ai-claude-code");
  assert.equal(a.found, true);
  assert.equal(typeof a.record.qualifyingOutcomes, "number");
});
