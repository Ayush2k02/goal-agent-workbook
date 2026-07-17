/**
 * 03-bench.ts — run the FROZEN BENCH and score it.
 *
 * Run:  pnpm bench
 *
 * For each frozen case: run the SAME production agent (agent.ts), capture the
 * recorded decision, and score it against the pinned groundTruth with
 * deterministic scorers (the toy analog of Sift's `core/scorers/quality.ts`):
 *
 *   - decision-match   → act vs abstain matches
 *   - actions-match    → the set of action types matches
 *   - <assertions>     → english-reply / no-fabricated-ids / no-refund-promise
 *
 * Prints PASS/FAIL per case and a summary, and EXITS NONZERO if any case fails —
 * so it works as a regression gate. Because the model is non-deterministic, an
 * occasional flake is expected; a case that fails consistently is a real
 * regression. (Real Sift adds LLM-judge scorers + "settled" case selection to
 * tame this; we keep it simple and structural.)
 */

import { runMastraGoalAgent } from "./agent"
import { BENCH, BENCH_VERSION, type Assertion } from "./bench"
import { CASES, ORGS, type ActionType } from "./domain"
import { MODEL } from "./model"
import type { DecisionInput } from "./schema"

const REFUND_BLOCKLIST = /\b(refund(ed|ing)?|credit(ed)?|reimburs\w*|reversal|reversed|money back)\b/i

const allActions = (d: DecisionInput | null): { type: ActionType; text?: string; tagId?: string; closeReasonId?: string }[] =>
  (d?.decisions ?? []).flatMap((b) =>
    b.actions.map((a) => ({ type: a.type, text: a.params?.text, tagId: a.params?.tagId, closeReasonId: a.params?.closeReasonId })),
  )

const sortedTypes = (types: ActionType[]) => [...types].sort().join(",")

/** Returns [] on pass, or a list of failure reasons. */
function score(caseId: string, decision: DecisionInput | null): string[] {
  const bc = BENCH.find((b) => b.caseId === caseId)!
  const org = ORGS[CASES[caseId].orgKey]
  const gt = bc.groundTruth
  const fails: string[] = []

  const actualDecision = decision?.decision ?? "abstain" // no submit = abstain
  if (actualDecision !== gt.decision) fails.push(`decision: expected ${gt.decision}, got ${actualDecision}`)

  const actions = allActions(decision)
  const gotTypes = sortedTypes(actions.map((a) => a.type))
  const wantTypes = sortedTypes(gt.actions)
  if (gotTypes !== wantTypes) fails.push(`actions: expected [${wantTypes}], got [${gotTypes}]`)

  for (const assertion of gt.assertions as Assertion[]) {
    if (assertion === "english-reply") {
      const replies = actions.filter((a) => a.type === "DRAFT_REPLY")
      if (replies.length === 0 || replies.some((r) => !r.text?.trim())) fails.push("english-reply: DRAFT_REPLY missing non-empty text")
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
        if (a.type === "DRAFT_REPLY" && a.text && REFUND_BLOCKLIST.test(a.text)) {
          fails.push(`no-refund-promise: reply contains a refund/credit promise`)
        }
      }
    }
  }
  return fails
}

async function main() {
  console.log(`\n=== FROZEN BENCH (${BENCH_VERSION}) · ${MODEL} · ${BENCH.length} cases ===\n`)
  let passed = 0
  const failedCases: string[] = []

  // Sequential keeps output readable and avoids hammering rate limits.
  for (const bc of BENCH) {
    const action = CASES[bc.caseId]
    const org = ORGS[action.orgKey]
    const { decision } = await runMastraGoalAgent(org, action) // same agent as the demo
    const fails = score(bc.caseId, decision)
    const want = `${bc.groundTruth.decision}${bc.groundTruth.actions.length ? ` [${bc.groundTruth.actions.join("+")}]` : ""}`
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
