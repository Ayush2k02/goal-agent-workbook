/**
 * 02-mastra.ts — run the goal agent (framework version) on one case.
 *
 * Run:  pnpm mastra A1   (cases: A1 A2 A3 · B1 B2 B3 — see domain.ts)
 *
 * This is a thin wrapper: the whole agent — tools, loop, dispatch, history, step
 * cap, retry — lives declaratively in agent.ts (`runMastraGoalAgent`). Compare
 * with 01-vanilla.ts, which hand-writes all of that against the model SDK.
 * Notice this file and the bench (03) share the exact same agent.
 */

import { runMastraGoalAgent } from "./agent"
import { CASES, ORGS } from "./domain"
import { MODEL } from "./model"

async function main() {
  const caseId = process.argv[2] ?? "A1"
  const action = CASES[caseId]
  if (!action) {
    console.error(`Unknown case "${caseId}". Try: ${Object.keys(CASES).join(", ")}`)
    process.exit(1)
  }
  const org = ORGS[action.orgKey]

  console.log(`\n=== MASTRA goal agent · ${MODEL} · ${org.displayName} · case ${action.id} (${caseId}) ===\n`)

  const { decision, auditText } = await runMastraGoalAgent(org, action, (e) => {
    if (e.tool === "search") console.log(`  🔧 search(${JSON.stringify(e.input)})`)
    else console.log(`  🔧 submit_decision → ${e.ok ? "committed" : "⚠️ retryable error"}`)
  })

  if (auditText) console.log(`  💬 ${auditText}`)
  console.log("\n--- committed decision ---")
  console.log(decision ? JSON.stringify(decision, null, 2) : "(no decision submitted)")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
