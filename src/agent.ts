/**
 * agent.ts — the Mastra goal agent, built ONCE and reused.
 *
 * This is the "production" agent: the demo runner (02-mastra.ts) and the frozen
 * bench (03-bench.ts) both call `runMastraGoalAgent`, so the bench exercises the
 * exact same agent a user would — the only thing swapped is nothing at all: our
 * decision sink already only RECORDS the decision (no side effects), which is
 * precisely what Sift's bench "recorder" target does to `submit_goal_decision`.
 *
 * Every framework job is declarative here — tools, loop, dispatch, history
 * threading, step cap, retry. Compare with 01-vanilla.ts, which hand-writes them.
 */

import { Agent } from "@mastra/core/agent"
import { createTool } from "@mastra/core/tools"
import type { Action, Org } from "./data.store"
import { google, MODEL } from "./model"
import { buildInputPrompt, SYSTEM_PROMPT } from "./prompt"
import { decisionInputSchema, searchInputSchema } from "./schema"
import { createDecisionSink, runSearch, type DecisionResult } from "./tools"

export type ToolEvent =
  | { tool: "search"; input: unknown }
  | { tool: "submit_decision"; ok: boolean }

/**
 * Run the goal agent on one action for one org. Returns the committed decision
 * (or null if the agent abstained without submitting). `onTool` lets a caller
 * observe tool calls (the demo narrates them; the bench stays quiet).
 */
export async function runMastraGoalAgent(
  org: Org,
  action: Action,
  onTool: (e: ToolEvent) => void = () => {},
) {
  // Per-run tool state — the latch is scoped to this run (Sift injects the
  // action id via requestContext; the closure here is the toy equivalent).
  const sink = createDecisionSink(org)

  const searchTool = createTool({
    id: "search",
    description: "Read-only lookup of the org's tag or close-reason catalog. Returns real IDs to use when acting.",
    inputSchema: searchInputSchema,
    execute: async ({ context }) => {
      onTool({ tool: "search", input: context })
      return runSearch(org, context)
    },
  })

  const submitDecisionTool = createTool({
    id: "submit_decision",
    description: "Submit your final act/abstain decision (one block per applying goal). Call exactly once to finish.",
    inputSchema: decisionInputSchema,
    // The same sink: latch + retryable validation. A `{ ok:false }` result is
    // read by the model and corrected on the next step — no extra plumbing.
    execute: async ({ context }): Promise<DecisionResult> => {
      const result = sink.submit(context)
      onTool({ tool: "submit_decision", ok: result.ok })
      return result
    },
  })

  const agent = new Agent({
    name: "Goal Agent",
    instructions: SYSTEM_PROMPT,
    model: google(MODEL),
    tools: { search: searchTool, submit_decision: submitDecisionTool },
  })

  const res = await agent.generate(buildInputPrompt(action, org, org.goals), { maxSteps: 12 })
  return { decision: sink.result(), auditText: res.text.trim() }
}
