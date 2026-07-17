/**
 * domain.ts — the toy world the goal agent reasons over.
 *
 * This is a deliberately tiny stand-in for Sift's real data model. In the real
 * product, an "action" is a synthesized customer interaction, "goals" are
 * org-configured automation rules, and the catalogs (tags, queues, knowledge
 * base) are database tables the agent resolves IDs against. Here they're just
 * in-memory objects so the workbook runs anywhere with only an API key.
 *
 * The shape is what matters: the agent is handed ONE case + a list of enabled
 * goals, and must decide — per goal — whether to act or abstain.
 */

// ---------------------------------------------------------------------------
// The case the agent runs on (Sift calls this an "action")
// ---------------------------------------------------------------------------

export type Action = {
  id: string
  platform: string
  authorName: string
  text: string
  language: string
}

// ---------------------------------------------------------------------------
// Org-configured goals. Each goal describes an outcome + which actions it
// applies to + what the agent is allowed to do. The agent evaluates EVERY
// enabled goal independently against the case.
// ---------------------------------------------------------------------------

export type Goal = {
  id: string
  outcome: string
  instructions: string
  /** Which action types this goal permits when it decides to act. */
  allowedActions: Array<"draft_reply" | "tag">
}

// ---------------------------------------------------------------------------
// Read-only catalogs the agent looks things up in via the `search` tool.
// The agent must resolve real IDs from here before it can act — it is never
// allowed to invent a tagId or cite a KB article that doesn't exist.
// ---------------------------------------------------------------------------

export type KbEntry = { id: string; question: string; answer: string }
export type Tag = { id: string; label: string }

export const KNOWLEDGE_BASE: KbEntry[] = [
  {
    id: "kb_reset_pw",
    question: "How do I reset my password?",
    answer:
      "Open Settings → Security → Reset password. A reset link is emailed to your account address and is valid for 30 minutes.",
  },
  {
    id: "kb_export_data",
    question: "Can I export my data?",
    answer:
      "Yes. Settings → Data → Export produces a ZIP of your data within a few minutes; we email a download link when it's ready.",
  },
  {
    id: "kb_cancel_plan",
    question: "How do I cancel my subscription?",
    answer:
      "Settings → Billing → Cancel plan. Access continues until the end of the current billing period; no partial refunds are issued.",
  },
]

export const TAGS: Tag[] = [
  { id: "tag_billing", label: "billing" },
  { id: "tag_refund_request", label: "refund-request" },
  { id: "tag_praise", label: "praise" },
  { id: "tag_bug", label: "bug" },
]

// ---------------------------------------------------------------------------
// A few sample cases to run the agent against. Switch CASE_ID to see the agent
// take different paths: answer from KB, abstain-and-tag, or draft a thank-you.
// ---------------------------------------------------------------------------

export const CASES: Record<string, Action> = {
  password: {
    id: "AAS-1001",
    platform: "x",
    authorName: "@dana",
    text: "ugh I'm locked out — how do I reset my password? been trying for 20 min",
    language: "en",
  },
  refund: {
    id: "AAS-1002",
    platform: "email",
    authorName: "Priya M.",
    text: "I was double-charged $49 this month and want a refund. This is the second time it's happened.",
    language: "en",
  },
  praise: {
    id: "AAS-1003",
    platform: "instagram",
    authorName: "@leo.builds",
    text: "honestly the new export feature is *chef's kiss*. saved me hours this week 🙌",
    language: "en",
  },
}

export const GOALS: Goal[] = [
  {
    id: "goal_deflect_kb",
    outcome: "Answer answerable how-to questions from the knowledge base.",
    instructions:
      "If the customer is asking a how-to question that the knowledge base answers, draft a short, friendly reply grounded in the KB answer. Use the `search` tool to find the matching KB entry first — never answer from memory.",
    allowedActions: ["draft_reply"],
  },
  {
    id: "goal_escalate_billing",
    outcome: "Route billing and refund issues to a human.",
    instructions:
      "If the customer is reporting a billing problem or asking for a refund, do NOT draft a reply (we never promise refunds automatically). Abstain, and attach the billing tag so a human picks it up. Resolve the tag ID with `search` before tagging.",
    allowedActions: ["tag"],
  },
  {
    id: "goal_thank_praise",
    outcome: "Acknowledge positive feedback warmly.",
    instructions:
      "If the customer is giving praise or positive feedback, draft a brief, genuine thank-you in their language. No KB lookup needed.",
    allowedActions: ["draft_reply"],
  },
]
