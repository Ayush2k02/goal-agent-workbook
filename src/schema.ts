/**
 * schema.ts — ONE decision schema, shaped like Sift's real
 * `submitGoalDecisionSchema` (packages/core/agents/src/agents/tools/submit-goal-decision.ts).
 *
 * Both the vanilla loop and the Mastra agent pass these zod schemas straight to
 * their tool definitions — no hand-written JSON Schema anywhere.
 *
 * We keep the schema STRUCTURAL (types + enums). The cross-field rules
 * (allowed-actions gating, "a reply needs text", "a tag needs a real id",
 * "at most one reply-producing action") live in tools.ts so the agent gets a
 * retryable error it can fix — exactly how the real tool's `.superRefine` +
 * `executeGoalDecision` behave.
 */

import { z } from "zod"
import { GOAL_ALLOWED_ACTION_TYPES } from "./domain"

export const searchInputSchema = z.object({
  kind: z.enum(["tag", "close_reason"]).describe("Which catalog to search."),
  query: z.string().describe("What to look for, in plain words."),
})
export type SearchInput = z.infer<typeof searchInputSchema>

// A single flat "param bag" — the model fills the field for its action type,
// mirroring the real `actionParamsSchema`.
const actionParamsSchema = z.object({
  text: z.string().optional().describe("DRAFT_REPLY: the customer-facing reply body."),
  tagId: z.string().optional().describe("ADD_TAG: a real tag id resolved via search."),
  closeReasonId: z
    .string()
    .optional()
    .describe("CLOSE_ACTION_WITH_REASON: a real close-reason id resolved via search."),
})

const actionSchema = z.object({
  type: z.enum(GOAL_ALLOWED_ACTION_TYPES),
  params: actionParamsSchema.optional(),
  reason: z.string().optional().describe("Why this action, in one short phrase."),
})

const goalDecisionSchema = z.object({
  goalId: z.string().describe("The goal this block is about."),
  actions: z.array(actionSchema).describe("One or more actions this goal takes. Empty is invalid for 'act'."),
})

export const decisionInputSchema = z.object({
  decision: z.enum(["act", "abstain"]),
  decisions: z
    .array(goalDecisionSchema)
    .describe("One block per applying goal. Empty when abstaining."),
  confidence: z.enum(["high", "medium", "low"]),
  evidence: z.array(z.string()).describe("The customer's own words that justify the decision."),
  humanSummary: z.string().describe("One short sentence a human reviewer would read."),
})
export type DecisionInput = z.infer<typeof decisionInputSchema>
