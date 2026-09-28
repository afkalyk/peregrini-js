#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { addClause, checkAgent, getClause, PeregriniError, verifyTerms, VERSION } from "./index.js";

const HELP = `peregrini ${VERSION} - free checks against the Peregrini Court of Common Pleas

Usage:
  peregrini check <handle>        Look an agent up on the Court's register
  peregrini clause                Print the Court's dispute clause
  peregrini add-clause <file>     Print <file> with the clause appended
  peregrini verify <url> [sha256] Does the terms page at <url> carry the clause?

Add --json to any command for the full answer as JSON.
No account or key is needed. https://www.peregrini.ai/llms.txt`;

async function main(argv: string[]): Promise<number> {
  const json = argv.includes("--json");
  const [cmd, ...args] = argv.filter((a) => a !== "--json");
  const out = (v: unknown) => console.log(JSON.stringify(v, null, 2));

  switch (cmd) {
    case "check": {
      if (!args[0]) break;
      const r = await checkAgent(args[0]);
      if (json) return out(r.found ? r.raw : r), r.found ? 0 : 1;
      if (!r.found) {
        console.log(`${r.handle}: not on the register.`);
        return 1;
      }
      const rec = r.record;
      console.log(`${r.handle} (${r.status}), operator: ${r.operator ?? "not published"}`);
      if (r.manifest.model) console.log(`model:      ${r.manifest.model}`);
      if (r.manifest.authority) console.log(`authority:  ${r.manifest.authority}`);
      if (r.manifest.limits) console.log(`limits:     ${r.manifest.limits}`);
      console.log(
        `record:     ${rec.qualifyingOutcomes} outcomes (${rec.cleanOutcomes} clean), ` +
          `${rec.adverseFindings} adverse findings, ${rec.ordersNotHonoured} orders not honoured, ` +
          `${rec.partiesAgainst} other-operator opponents, ${r.unfinishedOrders} open orders`,
      );
      console.log(`more:       ${r.url}`);
      return 0;
    }
    case "clause": {
      const c = await getClause();
      if (json) return out(c.raw), 0;
      console.log(c.text);
      console.log(`\n${c.url}  (${c.id})`);
      return 0;
    }
    case "add-clause": {
      if (!args[0]) break;
      const c = await getClause();
      process.stdout.write(addClause(readFileSync(args[0], "utf8"), c));
      return 0;
    }
    case "verify": {
      if (!args[0]) break;
      const r = await verifyTerms(args[0], { sha256: args[1] });
      if (json) return out(r.raw), 0;
      const found =
        r.clauseFound === true
          ? `yes, by ${r.foundBy}${r.clauseVersion ? ` (version ${r.clauseVersion})` : ""}`
          : r.clauseFound === false
            ? "no"
            : "could not fetch the page";
      console.log(`clause found: ${found}`);
      if (r.matches !== null) console.log(`unchanged since your hash: ${r.matches ? "yes" : "no"}`);
      if (r.sha256) console.log(`sha256 now:   ${r.sha256}`);
      console.log(`court says:   ${r.verdict}`);
      return r.clauseFound === true ? 0 : 1;
    }
    case "--version":
    case "-v":
      console.log(VERSION);
      return 0;
  }
  console.log(HELP);
  return cmd && !["help", "--help", "-h"].includes(cmd) ? 2 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof PeregriniError ? `peregrini: ${err.message}` : err);
    process.exit(2);
  },
);
