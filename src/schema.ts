/**
 * schema.ts — ONE decision schema, shared by both implementations.
 *
 * This is the single most important idea in the workbook: the vanilla loop and
 * the Mastra agent use the *same* zod schema. Both pass it straight to their
 * tool definitions (the AI SDK's `tool({ parameters })` and Mastra's
 * `createTool({ inputSchema })`) — no hand-written JSON Schema anywhere.
 *
 * This mirrors Sift's real `submitGoalDecisionSchema`: a structured "act or
 * abstain, once per applying goal" contract. We keep the schema STRUCTURAL only
 * (types + enums). The cross-field rules ("act requires an action", "a reply
 * needs text") live in tools.ts so the agent gets a retryable error it can fix —
 * exactly how the real tool's `.superRefine` + `executeGoalDecision` behave.
 */

import { z } from "zod"

export const searchInputSchema = z.object({
  kind: z
    .enum(["knowledge_base", "tag"])
    .describe("Which catalog to search."),
  query: z.string().describe("What to look for, in plain words."),
})
export type SearchInput = z.infer<typeof searchInputSchema>

const actionSchema = z.object({
  type: z.enum(["draft_reply", "tag"]),
  replyText: z
    .string()
    .optional()
    .describe("Required when type is draft_reply. The customer-facing reply."),
  tagId: z
    .string()
    .optional()
    .describe("Required when type is tag. A real tag id resolved via search."),
})

const oneGoalDecision = z.object({
  goalId: z.string().describe("The goal this decision is about."),
  decision: z.enum(["act", "abstain"]),
  action: actionSchema
    .optional()
    .describe("Required when decision is 'act'. Omit when abstaining."),
  evidence: z
    .string()
    .describe("The words in the customer's message that justify this decision."),
  reason: z.string().describe("One short sentence explaining the call."),
})

export const decisionInputSchema = z.object({
  decisions: z
    .array(oneGoalDecision)
    .describe("Exactly one entry per goal that applies to this case."),
})
export type DecisionInput = z.infer<typeof decisionInputSchema>
