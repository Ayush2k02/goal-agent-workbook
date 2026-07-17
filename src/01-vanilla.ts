/**
 * 01-vanilla.ts — the goal agent with NO framework.
 *
 * Run:  pnpm vanilla   (or: pnpm vanilla refund | praise)
 *
 * Everything here is hand-written against the raw Anthropic Messages API. Read
 * this file top to bottom and you'll see every job an agent framework does for
 * you — because here, you do them:
 *
 *   1. Describe the tools as JSON Schema.                       (TOOLS below)
 *   2. Run the agent LOOP: call the model, and if it wants a
 *      tool, run the tool, append the result, call again.       (the for-loop)
 *   3. Dispatch each tool_use block to the right function.       (runTool)
 *   4. Thread the message history correctly (assistant turn,
 *      then a user turn of tool_result blocks).                  (messages.push)
 *   5. Cap the number of steps so a confused model can't loop
 *      forever.                                                   (MAX_STEPS)
 *   6. Parse the model's JSON tool input and surface validation
 *      errors back to it so it can retry.                        (is_error)
 *
 * Compare with 02-mastra.ts, which does all six declaratively.
 */

import Anthropic from "@anthropic-ai/sdk"
import { CASES, GOALS } from "./domain"
import { buildInputPrompt, SYSTEM_PROMPT } from "./prompt"
import {
  decisionInputSchema,
  searchInputSchema,
  toAnthropicSchema,
} from "./schema"
import { createDecisionSink, runSearch } from "./tools"

const MODEL = "claude-opus-4-8"
const MAX_STEPS = 12 // Sift's real cap. Bounds tool round-trips.

const client = new Anthropic() // reads ANTHROPIC_API_KEY (or an `ant` profile)

// --- 1. Tool definitions the model sees. Note we DERIVE the JSON schema from
// the same zod schema Mastra uses — one source of truth. ---------------------
const TOOLS: Anthropic.Tool[] = [
  {
    name: "search",
    description:
      "Read-only lookup of the knowledge base or the tag catalog. Returns real IDs you must use when acting.",
    input_schema: toAnthropicSchema(searchInputSchema),
  },
  {
    name: "submit_decision",
    description:
      "Submit your final act/abstain decisions, one per applying goal. Call this exactly once to finish the run.",
    input_schema: toAnthropicSchema(decisionInputSchema),
  },
]

async function main() {
  const caseId = process.argv[2] ?? "password"
  const action = CASES[caseId]
  if (!action) {
    console.error(`Unknown case "${caseId}". Try: ${Object.keys(CASES).join(", ")}`)
    process.exit(1)
  }

  // Per-run tool state. The decision sink is rebuilt for THIS run — its latch
  // can't leak into another case. (Sift rebuilds its tools per run for the
  // same reason, injecting the action id via requestContext.)
  const sink = createDecisionSink(GOALS)

  // --- 4. The message history. We start with just the user's input prompt. ---
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildInputPrompt(action, GOALS) },
  ]

  console.log(`\n=== VANILLA goal agent · case ${action.id} (${caseId}) ===\n`)

  // --- 2. The agent loop. This while-loop IS the agent. --------------------
  for (let step = 1; step <= MAX_STEPS; step++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    })

    // Surface the model's narration so you can watch it think.
    for (const block of res.content) {
      if (block.type === "text" && block.text.trim()) {
        console.log(`  [step ${step}] 💬 ${block.text.trim()}`)
      }
    }

    // If the model didn't ask for a tool, it's done talking.
    if (res.stop_reason !== "tool_use") break

    // --- Preserve the assistant turn (tool_use blocks and all) before we
    // answer it. Dropping this breaks the conversation. ---------------------
    messages.push({ role: "assistant", content: res.content })

    // --- 3. Run every tool the model called this turn, collect the results. --
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of res.content) {
      if (block.type !== "tool_use") continue
      const { output, isError } = runTool(block.name, block.input, sink)
      console.log(
        `  [step ${step}] 🔧 ${block.name}(${JSON.stringify(block.input)})${isError ? " ⚠️ retryable error" : ""}`,
      )
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(output),
        is_error: isError,
      })
    }

    // --- The tool results go back as a single user turn. ---------------------
    messages.push({ role: "user", content: toolResults })

    // Once a decision is committed, we could stop early — but we let the model
    // take its final "here's what I did" turn, matching Sift (which does NOT
    // hard-stop on the tool, so the model can read retryable errors and retry).
  }

  // --- The "output" of the run is the committed decision — a side effect of
  // the submit_decision tool, not the model's final text. Same as Sift. -----
  const decision = sink.result()
  console.log("\n--- committed decision ---")
  console.log(decision ? JSON.stringify(decision, null, 2) : "(agent abstained on all goals / never submitted)")
}

/** --- 3. Dispatch a tool_use block to the right backing function. --------- */
function runTool(
  name: string,
  input: unknown,
  sink: ReturnType<typeof createDecisionSink>,
): { output: unknown; isError: boolean } {
  if (name === "search") {
    const parsed = searchInputSchema.safeParse(input)
    if (!parsed.success) return { output: { errors: parsed.error.issues }, isError: true }
    return { output: runSearch(parsed.data), isError: false }
  }
  if (name === "submit_decision") {
    // Structural parse first, then the cross-field rules in the sink. Both
    // failure modes come back as retryable errors the model can fix.
    const parsed = decisionInputSchema.safeParse(input)
    if (!parsed.success) return { output: { retryable: true, errors: parsed.error.issues }, isError: true }
    const result = sink.submit(parsed.data)
    return { output: result, isError: !result.ok }
  }
  return { output: { error: `unknown tool ${name}` }, isError: true }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
