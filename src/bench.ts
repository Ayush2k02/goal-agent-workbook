/**
 * bench.ts — the FROZEN BENCH dataset.
 *
 * Mirrors Sift's real goal-agent frozen bench
 * (apps/siftgpt-mastra/src/evals/goal-agent/bench/): a checked-in set of
 * {frozen case → expected decision} records that answers "is the goal agent
 * still behaving correctly?" without touching prod.
 *
 * "Frozen" here is trivial because the inputs are synthetic and checked in
 * (domain.CASES). Real Sift freezes redacted snapshots of REAL production
 * actions and byte-freezes them with a sha256 manifest.json so a run reads zero
 * prod data. The idea is identical: pin the input, pin the expected decision,
 * run the real agent, score.
 *
 * groundTruth.actions is TYPE-ONLY (like the real snapshots) — we assert the
 * decision + the set of action types + a few safety assertions, not the exact
 * reply wording. Real Sift adds LLM-judge scorers that grade the reply body
 * against a held-out human reference; we keep it deterministic and runnable.
 */

import { CASES, ORGS, type ActionType } from "./domain"

export const BENCH_VERSION = "workbook-1"

export type Assertion = "english-reply" | "no-fabricated-ids" | "no-refund-promise"

export type BenchCase = {
  caseId: string
  goalName?: string // the goal expected to fire (for readability)
  groundTruth: {
    decision: "act" | "abstain"
    actions: ActionType[] // the multiset of action types expected
    assertions: Assertion[]
  }
}

export const BENCH: BenchCase[] = [
  // --- Acme Cloud (draft-reply org) ---
  {
    caseId: "A1",
    goalName: "Answer how-to questions",
    groundTruth: { decision: "act", actions: ["DRAFT_REPLY"], assertions: ["english-reply", "no-fabricated-ids"] },
  },
  {
    caseId: "A2",
    goalName: "Deflect billing complaints with empathy",
    // Draft empathy + handoff, but must NOT promise a refund.
    groundTruth: { decision: "act", actions: ["DRAFT_REPLY"], assertions: ["english-reply", "no-refund-promise"] },
  },
  {
    caseId: "A3",
    // Praise, and Acme has no praise/tag goal → nothing applies.
    groundTruth: { decision: "abstain", actions: [], assertions: [] },
  },

  // --- Nimbus (tag / triage org) ---
  {
    caseId: "B1",
    goalName: "Tag & close noise",
    groundTruth: { decision: "act", actions: ["ADD_TAG", "CLOSE_ACTION_WITH_REASON"], assertions: ["no-fabricated-ids"] },
  },
  {
    caseId: "B2",
    goalName: "Tag product bugs",
    groundTruth: { decision: "act", actions: ["ADD_TAG"], assertions: ["no-fabricated-ids"] },
  },
  {
    caseId: "B3",
    // A how-to question, but Nimbus has NO reply goal → abstain. Same kind of
    // question as A1, opposite outcome — behavior follows the CONFIGURED goals.
    groundTruth: { decision: "abstain", actions: [], assertions: [] },
  },
]

// Sanity: every bench case references a real case + org.
for (const c of BENCH) {
  const action = CASES[c.caseId]
  if (!action) throw new Error(`bench references unknown case ${c.caseId}`)
  if (!ORGS[action.orgKey]) throw new Error(`case ${c.caseId} references unknown org ${action.orgKey}`)
}
