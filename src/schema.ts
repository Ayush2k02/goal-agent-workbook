/**
 * schema.ts — ONE decision schema, shared by both implementations.
 *
 * This is the single most important idea in the workbook: the vanilla loop and
 * the Mastra agent use the *same* zod schema. Mastra feeds it straight into
 * `createTool({ inputSchema })`; the vanilla loop converts it to JSON Schema for
 * the Anthropic `tools` array. Same source of truth, two consumers.
 *
 * This mirrors Sift's real `submitGoalDecisionSchema`: a structured "act or
 * abstain, once per applying goal" contract. We keep the schema STRUCTURAL only
 * (types + enums). The cross-field rules ("act requires an action", "a reply
 * needs text") live in tools.ts so the agent gets a retryable error it can fix —
 * exactly how the real tool's `.superRefine` + `executeGoalDecision` behave.
 */

import { z } from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"

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

/**
 * Anthropic's Messages API wants a plain JSON Schema for each tool's
 * `input_schema`. Mastra never needs this step — it consumes the zod object
 * directly. This helper is the "tax" the vanilla side pays.
 */
export const toAnthropicSchema = (schema: z.ZodTypeAny) => {
  const json = zodToJsonSchema(schema, { target: "jsonSchema7" }) as Record<
    string,
    unknown
  >
  // Anthropic ignores $schema; drop it to keep the tool definition clean.
  delete json.$schema
  return json as { type: "object"; properties: Record<string, unknown> }
}
