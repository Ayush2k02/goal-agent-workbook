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

import "./telemetry" // side-effect: register the OTel tracer BEFORE any model call
import { runMastraGoalAgent } from "./agent"
import { CASES, ORGS } from "./data.store"
import { evaluateEligibility } from "./eligibility"
import { log } from "./log"
import { MODEL } from "./model"

async function main() {
  const caseId = process.argv[2] ?? "L1"
  const action = CASES[caseId]
  if (!action) {
    console.error(`Unknown case "${caseId}". Try: ${Object.keys(CASES).join(", ")}`)
    process.exit(1)
  }
  const org = ORGS[action.orgKey]

  log.banner(`MASTRA goal agent · ${MODEL} · ${org.displayName} · case ${action.id} (${caseId})`)

  // Pre-invocation gate: if the action isn't eligible, the agent is never called.
  const elig = evaluateEligibility(action, org)
  if (!elig.eligible) {
    log.skip(elig.reason)
    return
  }

  // The ➡️ input / ⬅️ output of each turn is captured as an OpenTelemetry span —
  // but note WHERE it's wired: the vanilla loop stood up the tracer by hand, while
  // here `trace: true` just asks Mastra to configure telemetry declaratively (see
  // agent.ts). Same terminal trace, far less plumbing — that's the comparison.
  // Here we only log the tool events the framework surfaces through `onTool`.
  const { decision, auditText } = await runMastraGoalAgent(
    org,
    action,
    (e) => {
      if (e.tool === "search") log.tool(`search(${JSON.stringify(e.input)})`)
      else if (e.ok) log.tool("submit_decision", { status: "committed" })
      // A rejection isn't a failure: the sink refused an invalid draft and handed
      // the model the reasons to fix on the next step — the retry loop working.
      else log.tool("submit_decision", { status: "rejected", errors: e.errors ?? [] })
    },
    { trace: true },
  )

  if (auditText) log.say(auditText)
  log.committed(decision)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
