/**
 * 03-bench.ts — run the FROZEN BENCH and score it.
 *
 * Run:  pnpm bench
 *
 * For each frozen case: first apply the eligibility gate (skip cases cost ZERO
 * model calls — the agent is never invoked, exactly like production); otherwise
 * run the SAME production agent (agent.ts), capture the recorded decision, and
 * score it against the pinned groundTruth with deterministic scorers (the toy
 * analog of Sift's core/scorers/quality.ts):
 *
 *   - decision-match   → act / abstain / skipped matches (+ skip reason)
 *   - actions-match    → the set of action types matches
 *   - <assertions>     → english-reply / no-fabricated-ids / no-refund-promise
 *
 * Exits nonzero if any case fails, so it works as a regression gate. The model
 * is non-deterministic, so treat a CONSISTENT failure as a real regression.
 */

import { runMastraGoalAgent } from "./agent"
import { type ActionType, BENCH, BENCH_VERSION, CASES, ORGS } from "./data.store"
import { evaluateEligibility } from "./eligibility"
import { MODEL } from "./model"
import type { DecisionInput } from "./schema"

const REFUND_BLOCKLIST = /\b(refund(ed|ing)?|credit(ed)?|reimburs\w*|reversal|reversed|money back)\b/i

type FlatAction = { type: ActionType; text?: string; tagId?: string; closeReasonId?: string }
const allActions = (d: DecisionInput | null): FlatAction[] =>
  (d?.decisions ?? []).flatMap((b) =>
    b.actions.map((a) => ({ type: a.type, text: a.params?.text, tagId: a.params?.tagId, closeReasonId: a.params?.closeReasonId })),
  )
const sortedTypes = (types: ActionType[]) => [...types].sort().join(",")

/** One run result: either a skip (gate fired) or a committed decision. */
type Outcome = { decision: "act" | "abstain" | "skipped"; skipReason?: string; committed: DecisionInput | null }

function score(caseId: string, out: Outcome): string[] {
  const bc = BENCH.find((b) => b.caseId === caseId)!
  const org = ORGS[CASES[caseId].orgKey]
  const gt = bc.groundTruth
  const fails: string[] = []

  if (out.decision !== gt.decision) fails.push(`decision: expected ${gt.decision}, got ${out.decision}`)
  if (gt.decision === "skipped" && out.decision === "skipped" && out.skipReason !== gt.skipReason) {
    fails.push(`skipReason: expected ${gt.skipReason}, got ${out.skipReason}`)
  }

  const actions = allActions(out.committed)
  const gotTypes = sortedTypes(actions.map((a) => a.type))
  const wantTypes = sortedTypes(gt.actions)
  if (gotTypes !== wantTypes) fails.push(`actions: expected [${wantTypes}], got [${gotTypes}]`)

  for (const assertion of gt.assertions) {
    if (assertion === "english-reply") {
      const replies = actions.filter((a) => a.type === "DRAFT_REPLY")
      if (replies.length === 0 || replies.some((r) => !r.text?.trim())) fails.push("english-reply: DRAFT_REPLY missing text")
    }
    if (assertion === "no-fabricated-ids") {
      const tagIds = new Set(org.tags.map((t) => t.id))
      const crIds = new Set(org.closeReasons.map((c) => c.id))
      for (const a of actions) {
        if (a.type === "ADD_TAG" && !tagIds.has(a.tagId ?? "")) fails.push(`no-fabricated-ids: bad tagId ${a.tagId}`)
        if (a.type === "CLOSE_ACTION_WITH_REASON" && !crIds.has(a.closeReasonId ?? "")) fails.push(`no-fabricated-ids: bad closeReasonId ${a.closeReasonId}`)
      }
    }
    if (assertion === "no-refund-promise") {
      for (const a of actions) {
        if (a.type === "DRAFT_REPLY" && a.text && REFUND_BLOCKLIST.test(a.text)) fails.push("no-refund-promise: reply promises a refund/credit")
      }
    }
  }
  return fails
}

async function runCase(caseId: string): Promise<Outcome> {
  const action = CASES[caseId]
  const org = ORGS[action.orgKey]
  // Eligibility gate first — a skip never invokes the model.
  const elig = evaluateEligibility(action)
  if (!elig.eligible) return { decision: "skipped", skipReason: elig.reason, committed: null }
  const { decision } = await runMastraGoalAgent(org, action)
  return { decision: decision?.decision ?? "abstain", committed: decision }
}

async function main() {
  console.log(`\n=== FROZEN BENCH (${BENCH_VERSION}) · ${MODEL} · ${BENCH.length} cases ===\n`)
  let passed = 0
  const failedCases: string[] = []

  for (const bc of BENCH) {
    const org = ORGS[CASES[bc.caseId].orgKey]
    const out = await runCase(bc.caseId)
    const fails = score(bc.caseId, out)
    const gt = bc.groundTruth
    const want = gt.decision === "skipped" ? `skipped (${gt.skipReason})` : `${gt.decision}${gt.actions.length ? ` [${gt.actions.join("+")}]` : ""}`
    if (fails.length === 0) {
      passed++
      console.log(`  ✅ ${bc.caseId}  ${org.displayName.padEnd(11)} → ${want}`)
    } else {
      failedCases.push(bc.caseId)
      console.log(`  ❌ ${bc.caseId}  ${org.displayName.padEnd(11)} → expected ${want}`)
      for (const f of fails) console.log(`        · ${f}`)
    }
  }

  console.log(`\n${passed}/${BENCH.length} passed` + (failedCases.length ? ` — failed: ${failedCases.join(", ")}` : " — bench green ✅"))
  process.exit(failedCases.length ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
