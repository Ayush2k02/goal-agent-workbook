/**
 * data.store.ts — the SINGLE source of all data for the workbook.
 *
 * Everything data-shaped lives here and nowhere else: the orgs, the cases, which
 * cases are active, and the frozen-bench expectations. Every other file imports
 * from this store; no other file defines orgs/cases/bench inline.
 *
 * Grounded in the real repo (synthetic values — no customer data):
 *   - Action types: GOAL_ALLOWED_ACTION_TYPES
 *     (packages/data/timescale-db/src/types/workflow-action-registry.ts)
 *   - Goal config: WorkflowGoal (name/outcome/instructions/allowedActions/reviewPolicy)
 *   - Decision shape: submitGoalDecisionSchema
 *   - Lyft org + goals mirror the checked-in, ALREADY-REDACTED eval fixtures
 *     (apps/siftgpt-mastra/src/evals/goal-agent/suites/replay/definitions.ts +
 *      bench/snapshots/lyft.json). No live prod data is read.
 *   - Eligibility reasons: GoalAgentIneligibleReason
 *     (packages/core/action-manager/src/workflow/semantic-goal-agent-trigger.ts)
 */

// ===========================================================================
// TYPES
// ===========================================================================

/** The 9 real goal action types. We exercise a subset. */
export const GOAL_ALLOWED_ACTION_TYPES = [
  "DRAFT_REPLY",
  "RUN_MACRO",
  "ADD_NOTE",
  "ADD_TAG",
  "ASSIGN",
  "ASSIGN_QUEUE",
  "SET_CUSTOM_FIELD",
  "CLOSE_ACTION_WITH_REASON",
  "SEND_NOTIFICATION",
] as const
export type ActionType = (typeof GOAL_ALLOWED_ACTION_TYPES)[number]

/** The two reply-producing actions. Sift enforces AT MOST ONE per submission. */
export const REPLY_PRODUCING: ActionType[] = ["DRAFT_REPLY", "RUN_MACRO"]

export type SiftTag = { id: string; label: string }
export type CloseReason = { id: string; label: string }
export type ReviewPolicy = "approval_required" | "auto_send"

export type Goal = {
  id: string
  name: string
  outcome: string
  instructions: string
  allowedActions: ActionType[]
  reviewPolicy: ReviewPolicy
}

export type Org = {
  key: string
  id: string
  displayName: string
  tags: SiftTag[]
  closeReasons: CloseReason[]
  goals: Goal[]
}

export type ThreadMessage = { author: "Customer" | "Agent"; text: string; at: string }
export type Action = {
  id: string
  easyId: number
  orgKey: string
  platform: string
  /** Terminal statuses (CLOSED) are never (re)processed — see eligibility.ts. */
  operationStatus: "OPEN" | "CLOSED"
  /** True if the agent already committed a decision on this action (once-per-action gate). */
  priorGoalDecision?: boolean
  customerHandle: string
  thread: ThreadMessage[]
  knownFacts?: string
  customerTimeline?: string
  internalNotes?: string
}

/** The two eligibility skip reasons we model (Sift has more). */
export type IneligibleReason = "action_closed" | "already_ran_for_action"

export type Assertion = "english-reply" | "no-fabricated-ids" | "no-refund-promise"
export type BenchCase = {
  caseId: string
  goalName?: string
  groundTruth: {
    decision: "act" | "abstain" | "skipped"
    skipReason?: IneligibleReason // set when decision is "skipped"
    actions: ActionType[]
    assertions: Assertion[]
  }
}

// ===========================================================================
// ORGS
// ===========================================================================

// ORG A — Acme Cloud: a DRAFT_REPLY support org.
export const ACME: Org = {
  key: "acmecloud",
  id: "org_acmecloud_demo",
  displayName: "Acme Cloud",
  tags: [{ id: "tag_acme_billing", label: "billing" }],
  closeReasons: [{ id: "cr_acme_resolved", label: "Resolved" }],
  goals: [
    {
      id: "goal_answer_howto",
      name: "Answer how-to questions",
      outcome: "Customer how-to questions get a correct, concise reply grounded in what we already know.",
      instructions:
        "If the customer asks a how-to / usage question you can answer from the known facts, draft a short, friendly reply. Do NOT promise refunds, credits, or account changes.",
      allowedActions: ["DRAFT_REPLY"],
      reviewPolicy: "approval_required",
    },
    {
      id: "goal_deflect_billing",
      name: "Deflect billing complaints with empathy",
      outcome: "Billing/refund complaints get brief empathy and a handoff, with no refund promise.",
      instructions:
        "For billing disputes or refund demands, draft a brief empathetic reply that acknowledges the problem and says a billing specialist will follow up. NEVER promise, confirm, or imply a refund, credit, or reversal.",
      allowedActions: ["DRAFT_REPLY"],
      reviewPolicy: "approval_required",
    },
  ],
}

// ORG B — Nimbus: a tag / triage community org (never drafts replies).
export const NIMBUS: Org = {
  key: "nimbus",
  id: "org_nimbus_demo",
  displayName: "Nimbus",
  tags: [
    { id: "tag_nimbus_irrelevant", label: "Irrelevant" },
    { id: "tag_nimbus_bug", label: "Bug" },
    { id: "tag_nimbus_praise", label: "Praise" },
  ],
  closeReasons: [
    { id: "cr_nimbus_irrelevant", label: "Irrelevant" },
    { id: "cr_nimbus_resolved", label: "Resolved" },
  ],
  goals: [
    {
      id: "goal_tag_close_noise",
      name: "Tag & close noise",
      outcome: "Off-topic noise (spam, stock pumps, ads, jokes) is tagged Irrelevant and closed — no reply.",
      instructions:
        "For spam, stock-pump posts, ads, or off-topic jokes: add the Irrelevant tag AND close with reason Irrelevant — both actions, in one decision. Never draft a reply.",
      allowedActions: ["ADD_TAG", "CLOSE_ACTION_WITH_REASON"],
      reviewPolicy: "auto_send",
    },
    {
      id: "goal_tag_bugs",
      name: "Tag product bugs",
      outcome: "Genuine bug reports are tagged Bug for the product team.",
      instructions: "If the customer is reporting a product bug or breakage, add the Bug tag. Do not draft a reply.",
      allowedActions: ["ADD_TAG"],
      reviewPolicy: "auto_send",
    },
  ],
}

// ORG C — Lyft: mirrors the real (redacted) eval fixtures. A reply-first support
// org (public-complaint deflection, no-refund intake) plus a tag/close noise goal.
export const LYFT: Org = {
  key: "lyft",
  id: "org_lyft_demo",
  displayName: "Lyft",
  tags: [{ id: "tag_lyft_irrelevant", label: "Irrelevant" }],
  closeReasons: [{ id: "cr_lyft_irrelevant", label: "Irrelevant" }],
  goals: [
    {
      id: "goal_deflect_dm",
      name: "Deflect public complaint to DM",
      outcome: "Public complaint receives brief empathy plus a DM request without collecting PII publicly.",
      instructions:
        "For public X/Facebook/Instagram complaints, draft a short empathetic reply asking the customer to DM the team. Do not request email, phone, or trip details in public. Do not promise refunds, credits, driver action, or investigations.",
      allowedActions: ["DRAFT_REPLY", "RUN_MACRO"],
      reviewPolicy: "approval_required",
    },
    {
      id: "goal_charge_intake",
      name: "Charge / refund intake",
      outcome: "Billing disputes collect the details needed for review without promising a refund.",
      instructions:
        "For overcharge, duplicate charge, or refund requests, draft a concise intake reply asking the customer to DM the account name, email, and the relevant trip detail so the team can review. Say the team can look into it — NEVER that a refund or credit will happen.",
      allowedActions: ["DRAFT_REPLY", "RUN_MACRO"],
      reviewPolicy: "approval_required",
    },
    {
      id: "goal_tag_close_irrelevant",
      name: "Tag + close as Irrelevant",
      outcome: "Non-support noise is tagged/closed without a customer reply.",
      instructions:
        "For spam, jokes, brand chatter, stock-pump posts, or ads with no support need, add the Irrelevant tag AND close with reason Irrelevant — always both actions, in one decision. Do not draft a reply.",
      allowedActions: ["ADD_TAG", "CLOSE_ACTION_WITH_REASON"],
      reviewPolicy: "auto_send",
    },
  ],
}

export const ORGS: Record<string, Org> = { acmecloud: ACME, nimbus: NIMBUS, lyft: LYFT }

// ===========================================================================
// CASES — every action, keyed by caseId. Some are intentionally ineligible
// (closed / already-ran) to demonstrate the pre-invocation skip gate.
// ===========================================================================
export const CASES: Record<string, Action> = {
  // --- Acme Cloud (draft-reply org) ---
  A1: {
    id: "act_a1", easyId: 4101, orgKey: "acmecloud", platform: "email", operationStatus: "OPEN",
    customerHandle: "dana@ex.com",
    thread: [{ author: "Customer", text: "How do I export my data to CSV?", at: "2026-07-01T09:00Z" }],
    knownFacts: "Plan: Pro. Data export lives under Settings → Data → Export (produces a CSV/ZIP, emailed when ready).",
  },
  A2: {
    id: "act_a2", easyId: 4102, orgKey: "acmecloud", platform: "email", operationStatus: "OPEN",
    customerHandle: "priya@ex.com",
    thread: [{ author: "Customer", text: "I was double-charged $49 this month and I want a refund now. Second time this has happened.", at: "2026-07-02T14:20Z" }],
    knownFacts: "Plan: Pro. Billing disputes are handled by the billing specialist team; agents must not confirm refunds.",
  },
  A3: {
    id: "act_a3", easyId: 4103, orgKey: "acmecloud", platform: "x", operationStatus: "OPEN",
    customerHandle: "@leo",
    thread: [{ author: "Customer", text: "Love the new dashboard, great work team! 🙌", at: "2026-07-03T11:00Z" }],
  },

  // --- Nimbus (tag / triage org) ---
  B1: {
    id: "act_b1", easyId: 5201, orgKey: "nimbus", platform: "x", operationStatus: "OPEN",
    customerHandle: "@moonboy",
    thread: [{ author: "Customer", text: "$NIMB going parabolic 🚀 buy now before it 10x, link in bio", at: "2026-07-04T08:00Z" }],
  },
  B2: {
    id: "act_b2", easyId: 5202, orgKey: "nimbus", platform: "discord", operationStatus: "OPEN",
    customerHandle: "sam#4412",
    thread: [{ author: "Customer", text: "the app crashes every time I upload a video over 2 minutes, totally broken", at: "2026-07-04T10:30Z" }],
  },
  B3: {
    id: "act_b3", easyId: 5203, orgKey: "nimbus", platform: "discord", operationStatus: "OPEN",
    customerHandle: "kai#0098",
    thread: [{ author: "Customer", text: "how do I change my username?", at: "2026-07-04T12:00Z" }],
  },

  // --- Lyft (redacted-fixture-shaped) ---
  L1: {
    id: "act_l1", easyId: 6301, orgKey: "lyft", platform: "x", operationStatus: "OPEN",
    customerHandle: "@rider_j",
    thread: [{ author: "Customer", text: "@AskLyft charged me twice for one ride this morning and no one will help. refund me now.", at: "2026-07-05T07:45Z" }],
  },
  L2: {
    id: "act_l2", easyId: 6302, orgKey: "lyft", platform: "x", operationStatus: "OPEN",
    customerHandle: "@degen",
    thread: [{ author: "Customer", text: "$LYFT calls printing 🚀🚀 to the moon, buy before earnings", at: "2026-07-05T09:10Z" }],
  },

  // --- Eligibility skip demos (agent must NOT be invoked) ---
  X1: {
    id: "act_x1", easyId: 6401, orgKey: "lyft", platform: "x", operationStatus: "CLOSED",
    customerHandle: "@late_rider",
    thread: [{ author: "Customer", text: "driver took a weird route, felt overcharged", at: "2026-07-01T06:00Z" }],
    internalNotes: "Already handled by a human and closed.",
  },
  X2: {
    id: "act_x2", easyId: 6402, orgKey: "lyft", platform: "x", operationStatus: "OPEN", priorGoalDecision: true,
    customerHandle: "@repeat_rider",
    thread: [{ author: "Customer", text: "still waiting on that refund from last week", at: "2026-07-05T10:00Z" }],
    internalNotes: "Goal agent already ran once on this action (a re-fire arrived).",
  },
}

/** The cases that are eligible to actually invoke the agent (open + not already-run). */
export const ACTIVE_CASES: string[] = ["A1", "A2", "A3", "B1", "B2", "B3", "L1", "L2"]

// ===========================================================================
// FROZEN BENCH — {frozen case → expected decision}. Skip cases expect the
// pre-invocation gate to fire, so they cost ZERO model calls.
// ===========================================================================
export const BENCH_VERSION = "workbook-2"
export const BENCH: BenchCase[] = [
  { caseId: "A1", goalName: "Answer how-to questions", groundTruth: { decision: "act", actions: ["DRAFT_REPLY"], assertions: ["english-reply", "no-fabricated-ids"] } },
  { caseId: "A2", goalName: "Deflect billing complaints", groundTruth: { decision: "act", actions: ["DRAFT_REPLY"], assertions: ["english-reply", "no-refund-promise"] } },
  { caseId: "A3", groundTruth: { decision: "abstain", actions: [], assertions: [] } },
  { caseId: "B1", goalName: "Tag & close noise", groundTruth: { decision: "act", actions: ["ADD_TAG", "CLOSE_ACTION_WITH_REASON"], assertions: ["no-fabricated-ids"] } },
  { caseId: "B2", goalName: "Tag product bugs", groundTruth: { decision: "act", actions: ["ADD_TAG"], assertions: ["no-fabricated-ids"] } },
  { caseId: "B3", groundTruth: { decision: "abstain", actions: [], assertions: [] } },
  { caseId: "L1", goalName: "Charge / refund intake", groundTruth: { decision: "act", actions: ["DRAFT_REPLY"], assertions: ["english-reply", "no-refund-promise"] } },
  { caseId: "L2", goalName: "Tag + close as Irrelevant", groundTruth: { decision: "act", actions: ["ADD_TAG", "CLOSE_ACTION_WITH_REASON"], assertions: ["no-fabricated-ids"] } },
  { caseId: "X1", groundTruth: { decision: "skipped", skipReason: "action_closed", actions: [], assertions: [] } },
  { caseId: "X2", groundTruth: { decision: "skipped", skipReason: "already_ran_for_action", actions: [], assertions: [] } },
]

// Sanity: every bench/active case references a real case + org.
for (const id of [...ACTIVE_CASES, ...BENCH.map((b) => b.caseId)]) {
  const action = CASES[id]
  if (!action) throw new Error(`data.store: unknown case ${id}`)
  if (!ORGS[action.orgKey]) throw new Error(`data.store: case ${id} references unknown org ${action.orgKey}`)
}
