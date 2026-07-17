/**
 * 02-mastra.ts — run the goal agent (framework version) on one case.
 *
 * Run:  pnpm mastra L1   (cases: L1 L2 L3 · N1 · X1–X4 — see data.store.ts)
 *
 * This is a thin wrapper: the whole agent — tools, loop, dispatch, history, step
 * cap, retry — lives declaratively in agent.ts (`runMastraGoalAgent`). Compare
 * with 01-vanilla.ts, which hand-writes all of that against the model SDK.
 * Notice this file and the bench (03) share the exact same agent.
 */

import { runMastraGoalAgent } from "./agent"
import { CASES, ORGS } from "./data.store"
import { evaluateEligibility } from "./eligibility"
import { MODEL } from "./model"

async function main() {
  const caseId = process.argv[2] ?? "L1"
  const action = CASES[caseId]
  if (!action) {
    console.error(`Unknown case "${caseId}". Try: ${Object.keys(CASES).join(", ")}`)
    process.exit(1)
  }
  const org = ORGS[action.orgKey]

  console.log(`\n=== MASTRA goal agent · ${MODEL} · ${org.displayName} · case ${action.id} (${caseId}) ===\n`)

  // Pre-invocation gate: if the action isn't eligible, the agent is never called.
  const elig = evaluateEligibility(action, org)
  if (!elig.eligible) {
    console.log(`  ⏭️  skipped — ${elig.reason} (goal agent not invoked)`)
    return
  }

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
