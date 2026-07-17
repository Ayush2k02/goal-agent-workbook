/**
 * 01-vanilla.ts — the goal agent with NO agent framework, on Gemini.
 *
 * Run:  pnpm vanilla   (or: pnpm vanilla refund | praise)
 *
 * We talk to Gemini through the Vercel AI SDK (`generateText` + `@ai-sdk/google`)
 * — the same model layer Sift's real agent sits on — but we hand-write the
 * agentic loop ourselves. Read this file top to bottom and you'll see every job
 * an agent framework does for you, because here you do them:
 *
 *   1. Describe the tools (their zod schemas).                  (TOOLS below)
 *   2. Run the agent LOOP: call the model, and if it wants a
 *      tool, run the tool, append the result, call again.       (the for-loop)
 *   3. Dispatch each tool call to the right function.            (runTool)
 *   4. Thread the message history correctly (assistant turn,
 *      then a `tool` turn of tool results).                      (messages.push)
 *   5. Cap the number of steps so a confused model can't loop
 *      forever.                                                   (MAX_STEPS)
 *   6. Surface validation errors back to the model so it retries. (isError)
 *
 * The tools here have NO `execute` — that's deliberate. Without it the AI SDK
 * hands the tool call back to us instead of running it, so the loop is ours.
 * Compare with 02-mastra.ts, where all six jobs are declarative.
 */

import { generateText, tool, type CoreMessage } from "ai"
import { CASES, GOALS } from "./domain"
import { google, MODEL } from "./model"
import { buildInputPrompt, SYSTEM_PROMPT } from "./prompt"
import { decisionInputSchema, searchInputSchema } from "./schema"
import { createDecisionSink, runSearch } from "./tools"

const MAX_STEPS = 12 // Sift's real cap. Bounds tool round-trips.

// --- 1. Tool definitions the model sees. No `execute` → the SDK returns the
// call to us instead of running it, so WE own the loop. Same zod schemas the
// Mastra file uses. -----------------------------------------------------------
const TOOLS = {
  search: tool({
    description:
      "Read-only lookup of the knowledge base or the tag catalog. Returns real IDs you must use when acting.",
    parameters: searchInputSchema,
  }),
  submit_decision: tool({
    description:
      "Submit your final act/abstain decisions, one per applying goal. Call this exactly once to finish the run.",
    parameters: decisionInputSchema,
  }),
}

async function main() {
  const caseId = process.argv[2] ?? "password"
  const action = CASES[caseId]
  if (!action) {
    console.error(`Unknown case "${caseId}". Try: ${Object.keys(CASES).join(", ")}`)
    process.exit(1)
  }

  // Per-run tool state. The decision sink is rebuilt for THIS run so its latch
  // can't leak into another case. (Sift rebuilds its tools per run too,
  // injecting the action id via requestContext.)
  const sink = createDecisionSink(GOALS)

  // --- 4. The message history. We start with just the user's input prompt. ---
  const messages: CoreMessage[] = [
    { role: "user", content: buildInputPrompt(action, GOALS) },
  ]

  console.log(`\n=== VANILLA goal agent · ${MODEL} · case ${action.id} (${caseId}) ===\n`)

  // --- 2. The agent loop. This for-loop IS the agent. ----------------------
  for (let step = 1; step <= MAX_STEPS; step++) {
    const res = await generateText({
      model: google(MODEL),
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    })

    if (res.text.trim()) console.log(`  [step ${step}] 💬 ${res.text.trim()}`)

    // If the model didn't ask for a tool, it's done.
    if (res.finishReason !== "tool-calls" || res.toolCalls.length === 0) break

    // --- Preserve the assistant turn (its tool calls) before we answer it.
    // res.response.messages already has it in the right shape. --------------
    messages.push(...res.response.messages)

    // --- 3. Run every tool the model called this turn, collect the results. --
    const toolResults = res.toolCalls.map((call) => {
      const { output, isError } = runTool(call.toolName, call.args, sink)
      console.log(
        `  [step ${step}] 🔧 ${call.toolName}(${JSON.stringify(call.args)})${isError ? " ⚠️ retryable error" : ""}`,
      )
      return {
        type: "tool-result" as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        result: output,
        isError,
      }
    })

    // --- The tool results go back as a single `tool` turn. -------------------
    messages.push({ role: "tool", content: toolResults })

    // We don't hard-stop when a decision commits — we let the model take its
    // final "here's what I did" turn, and so it can read a retryable error and
    // try again. Same as Sift (which does NOT stop on the terminal tool).
  }

  // --- The "output" of the run is the committed decision — a side effect of
  // the submit_decision tool, not the model's final text. Same as Sift. -----
  const decision = sink.result()
  console.log("\n--- committed decision ---")
  console.log(decision ? JSON.stringify(decision, null, 2) : "(agent abstained on all goals / never submitted)")
}

/** --- 3. Dispatch a tool call to the right backing function. -------------- */
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
    const parsed = decisionInputSchema.safeParse(input)
    if (!parsed.success) return { output: { retryable: true, errors: parsed.error.issues }, isError: true }
    const result = sink.submit(parsed.data) // cross-field rules + latch live here
    return { output: result, isError: !result.ok }
  }
  return { output: { error: `unknown tool ${name}` }, isError: true }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
