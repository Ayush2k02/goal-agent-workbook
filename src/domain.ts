/**
 * domain.ts — the toy world, shaped like Sift's real data model.
 *
 * Grounded in the real repo (kept simple, synthetic — no customer data):
 *   - Action types come from `GOAL_ALLOWED_ACTION_TYPES`
 *     (packages/data/timescale-db/src/types/workflow-action-registry.ts).
 *   - A "goal" mirrors the `WorkflowGoal` model: name / outcome / instructions /
 *     allowedActions / reviewPolicy
 *     (packages/data/timescale-db/src/models/workflow-goal.ts).
 *   - An "action" (the case) is an `ActionableInsightsThread`; the agent sees it
 *     rendered as the four ACTION-CONTEXT blocks
 *     (packages/core/action-manager/src/workflow/get-action-context.ts).
 *
 * Two orgs show the two archetypes side by side:
 *   - Acme Cloud (support)  → a DRAFT_REPLY org: it answers/deflects inquiries.
 *   - Nimbus (community)    → a tag/triage org: it tags & closes, never replies.
 * Same kind of question routes differently depending on which goals are enabled.
 */

// ---------------------------------------------------------------------------
// The 9 real goal action types. We only exercise a few, but the enum is real.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Catalogs the agent resolves IDs against via the `search` tool (read-only).
// ---------------------------------------------------------------------------
export type SiftTag = { id: string; label: string }
export type CloseReason = { id: string; label: string }

// ---------------------------------------------------------------------------
// A goal, mirroring WorkflowGoal.
// ---------------------------------------------------------------------------
export type ReviewPolicy = "approval_required" | "auto_send"
export type Goal = {
  id: string
  name: string
  outcome: string
  instructions: string
  allowedActions: ActionType[]
  reviewPolicy: ReviewPolicy
}

// ---------------------------------------------------------------------------
// An org: its goals + its catalogs.
// ---------------------------------------------------------------------------
export type Org = {
  key: string
  id: string
  displayName: string
  tags: SiftTag[]
  closeReasons: CloseReason[]
  goals: Goal[]
}

// ---------------------------------------------------------------------------
// An action (the "case"). The agent sees these rendered into the four
// ACTION-CONTEXT blocks — see prompt.ts.
// ---------------------------------------------------------------------------
export type ThreadMessage = { author: "Customer" | "Agent"; text: string; at: string }
export type Action = {
  id: string
  easyId: number
  orgKey: string
  platform: string
  status: "OPEN"
  customerHandle: string
  thread: ThreadMessage[]
  knownFacts?: string
  customerTimeline?: string
  internalNotes?: string
}

// ---------------------------------------------------------------------------
// ORG A — Acme Cloud: a DRAFT_REPLY support org.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// ORG B — Nimbus: a tag / triage community org (never drafts replies).
// ---------------------------------------------------------------------------
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
      instructions:
        "If the customer is reporting a product bug or breakage, add the Bug tag. Do not draft a reply.",
      allowedActions: ["ADD_TAG"],
      reviewPolicy: "auto_send",
    },
  ],
}

export const ORGS: Record<string, Org> = { acmecloud: ACME, nimbus: NIMBUS }

// ---------------------------------------------------------------------------
// The cases. Each belongs to an org. The demo runners (01/02) and the frozen
// bench (03) both use these.
// ---------------------------------------------------------------------------
export const CASES: Record<string, Action> = {
  // --- Acme Cloud (draft-reply org) ---
  A1: {
    id: "act_a1",
    easyId: 4101,
    orgKey: "acmecloud",
    platform: "email",
    status: "OPEN",
    customerHandle: "dana@ex.com",
    thread: [{ author: "Customer", text: "How do I export my data to CSV?", at: "2026-07-01T09:00Z" }],
    knownFacts: "Plan: Pro. Data export is available under Settings → Data → Export (produces a CSV/ZIP, emailed when ready).",
  },
  A2: {
    id: "act_a2",
    easyId: 4102,
    orgKey: "acmecloud",
    platform: "email",
    status: "OPEN",
    customerHandle: "priya@ex.com",
    thread: [
      {
        author: "Customer",
        text: "I was double-charged $49 this month and I want a refund now. This is the second time it's happened.",
        at: "2026-07-02T14:20Z",
      },
    ],
    knownFacts: "Plan: Pro. Billing disputes are handled by the billing specialist team; agents must not confirm refunds.",
  },
  A3: {
    id: "act_a3",
    easyId: 4103,
    orgKey: "acmecloud",
    platform: "x",
    status: "OPEN",
    customerHandle: "@leo",
    thread: [{ author: "Customer", text: "Love the new dashboard, great work team! 🙌", at: "2026-07-03T11:00Z" }],
  },

  // --- Nimbus (tag / triage org) ---
  B1: {
    id: "act_b1",
    easyId: 5201,
    orgKey: "nimbus",
    platform: "x",
    status: "OPEN",
    customerHandle: "@moonboy",
    thread: [
      { author: "Customer", text: "$NIMB going parabolic 🚀 buy now before it 10x, link in bio", at: "2026-07-04T08:00Z" },
    ],
  },
  B2: {
    id: "act_b2",
    easyId: 5202,
    orgKey: "nimbus",
    platform: "discord",
    status: "OPEN",
    customerHandle: "sam#4412",
    thread: [
      { author: "Customer", text: "the app crashes every time I upload a video over 2 minutes, totally broken", at: "2026-07-04T10:30Z" },
    ],
  },
  B3: {
    id: "act_b3",
    easyId: 5203,
    orgKey: "nimbus",
    platform: "discord",
    status: "OPEN",
    customerHandle: "kai#0098",
    thread: [{ author: "Customer", text: "how do I change my username?", at: "2026-07-04T12:00Z" }],
  },
}
