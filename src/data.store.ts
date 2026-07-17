/**
 * data.store.ts — the SINGLE source of all data for the workbook.
 *
 * Everything data-shaped lives here and nowhere else: the orgs, the cases, which
 * cases are active, and the frozen-bench expectations. Every other file imports
 * from this store.
 *
 * Two orgs, on purpose:
 *   - Lyft   → a real-shaped org (mirrors the checked-in, ALREADY-REDACTED eval
 *              fixtures: definitions.ts + bench/snapshots/lyft.json). It carries
 *              both archetypes: draft/intake goals AND a tag+close noise goal.
 *   - Newco  → an org with NO goals configured, to demo the no_enabled_goals gate.
 *
 * Grounded in the real repo (synthetic values — no customer data):
 *   - Action types: GOAL_ALLOWED_ACTION_TYPES (workflow-action-registry.ts)
 *   - Goal config: WorkflowGoal (name/outcome/instructions/allowedActions/reviewPolicy)
 *   - Decision shape: submitGoalDecisionSchema
 *   - Eligibility reasons: GoalAgentIneligibleReason (semantic-goal-agent-trigger.ts)
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

/** The two reply-producing actions. The real system enforces AT MOST ONE per submission. */
export const REPLY_PRODUCING: ActionType[] = ["DRAFT_REPLY", "RUN_MACRO"]

export type Tag = { id: string; label: string }
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
  tags: Tag[]
  closeReasons: CloseReason[]
  goals: Goal[]
  /** Internal/demo orgs never invoke the goal agent (internal_org gate). */
  isInternal?: boolean
}

export type ThreadMessage = { author: "Customer" | "Agent"; text: string; at: string }
export type Action = {
  id: string
  easyId: number
  orgKey: string
  platform: string
  /** Terminal statuses (CLOSED) are never (re)processed — action_closed gate. */
  operationStatus: "OPEN" | "CLOSED"
  /** Hidden by moderation → never processed — hidden_moderated gate. */
  hiddenByModeration?: boolean
  /** The agent already committed a decision here — already_ran_for_action gate. */
  priorGoalDecision?: boolean
  /** How many times the agent has already run on this action — turn_cap_reached gate. */
  priorRunCount?: number
  customerHandle: string
  thread: ThreadMessage[]
  knownFacts?: string
  customerTimeline?: string
  internalNotes?: string
}

/**
 * The complete set of skip reasons, matching the real GoalAgentIneligibleReason.
 * We implement 7; `no_matching_goals` is listed for completeness but not modeled
 * — it needs saved-search SCOPE resolution, which this workbook deliberately omits.
 */
export type IneligibleReason =
  | "action_not_found"
  | "action_closed"
  | "hidden_moderated"
  | "internal_org"
  | "no_enabled_goals"
  | "no_matching_goals" // not modeled here (needs saved-search scope)
  | "already_ran_for_action"
  | "turn_cap_reached"

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

// Lyft — real-shaped: draft/intake goals + a tag+close noise goal.
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

// Newco — installed the product but configured NO goals. Demonstrates no_enabled_goals.
export const NEWCO: Org = {
  key: "newco",
  id: "org_newco_demo",
  displayName: "Newco",
  tags: [],
  closeReasons: [],
  goals: [],
}

export const ORGS: Record<string, Org> = { lyft: LYFT, newco: NEWCO }

// ===========================================================================
// CASES — keyed by caseId. L* are eligible; N1 + X* demonstrate the skip gate.
// ===========================================================================
export const CASES: Record<string, Action> = {
  // --- Lyft (eligible; invoke the agent) ---
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
  L3: {
    id: "act_l3", easyId: 6303, orgKey: "lyft", platform: "x", operationStatus: "OPEN",
    customerHandle: "@curious",
    thread: [{ author: "Customer", text: "@AskLyft how do I add a tip after the ride is over?", at: "2026-07-05T11:00Z" }],
  },

  // --- no_enabled_goals: org has no goals ---
  N1: {
    id: "act_n1", easyId: 7401, orgKey: "newco", platform: "email", operationStatus: "OPEN",
    customerHandle: "sam@ex.com",
    thread: [{ author: "Customer", text: "I was overcharged on my last order, can you help?", at: "2026-07-06T08:00Z" }],
  },

  // --- Eligibility skip demos (agent must NOT be invoked) ---
  X1: { // action_closed
    id: "act_x1", easyId: 6401, orgKey: "lyft", platform: "x", operationStatus: "CLOSED",
    customerHandle: "@late_rider",
    thread: [{ author: "Customer", text: "driver took a weird route, felt overcharged", at: "2026-07-01T06:00Z" }],
    internalNotes: "Already handled by a human and closed.",
  },
  X2: { // already_ran_for_action
    id: "act_x2", easyId: 6402, orgKey: "lyft", platform: "x", operationStatus: "OPEN", priorGoalDecision: true,
    customerHandle: "@repeat_rider",
    thread: [{ author: "Customer", text: "still waiting on that refund from last week", at: "2026-07-05T10:00Z" }],
    internalNotes: "Goal agent already ran once on this action (a re-fire arrived).",
  },
  X3: { // turn_cap_reached
    id: "act_x3", easyId: 6403, orgKey: "lyft", platform: "x", operationStatus: "OPEN", priorRunCount: 25,
    customerHandle: "@chatty",
    thread: [{ author: "Customer", text: "still no update??", at: "2026-07-05T10:30Z" }],
    internalNotes: "A long back-and-forth has re-fired the agent 25 times (runaway backstop).",
  },
  X4: { // hidden_moderated
    id: "act_x4", easyId: 6404, orgKey: "lyft", platform: "x", operationStatus: "OPEN", hiddenByModeration: true,
    customerHandle: "@trolls",
    thread: [{ author: "Customer", text: "[content hidden by moderation]", at: "2026-07-05T10:45Z" }],
  },
}

// ===========================================================================
// FROZEN BENCH — {frozen case → expected decision}. Skip cases assert the gate
// fires and cost ZERO model calls.
// ===========================================================================
export const BENCH_VERSION = "workbook-3"
export const BENCH: BenchCase[] = [
  { caseId: "L1", goalName: "Charge / refund intake", groundTruth: { decision: "act", actions: ["DRAFT_REPLY"], assertions: ["english-reply", "no-refund-promise"] } },
  { caseId: "L2", goalName: "Tag + close as Irrelevant", groundTruth: { decision: "act", actions: ["ADD_TAG", "CLOSE_ACTION_WITH_REASON"], assertions: ["no-fabricated-ids"] } },
  { caseId: "L3", goalName: "(no matching goal)", groundTruth: { decision: "abstain", actions: [], assertions: [] } },
  { caseId: "N1", groundTruth: { decision: "skipped", skipReason: "no_enabled_goals", actions: [], assertions: [] } },
  { caseId: "X1", groundTruth: { decision: "skipped", skipReason: "action_closed", actions: [], assertions: [] } },
  { caseId: "X2", groundTruth: { decision: "skipped", skipReason: "already_ran_for_action", actions: [], assertions: [] } },
  { caseId: "X3", groundTruth: { decision: "skipped", skipReason: "turn_cap_reached", actions: [], assertions: [] } },
  { caseId: "X4", groundTruth: { decision: "skipped", skipReason: "hidden_moderated", actions: [], assertions: [] } },
]

// Sanity: every bench case references a real case + org.
for (const id of BENCH.map((b) => b.caseId)) {
  const action = CASES[id]
  if (!action) throw new Error(`data.store: unknown case ${id}`)
  if (!ORGS[action.orgKey]) throw new Error(`data.store: case ${id} references unknown org ${action.orgKey}`)
}
