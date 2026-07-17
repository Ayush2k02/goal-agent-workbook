/**
 * 02-mastra.ts — the SAME goal agent, built with the Mastra framework.
 *
 * Run:  pnpm mastra   (or: pnpm mastra refund | praise)
 *
 * Line for line, this does what 01-vanilla.ts does — but every one of the six
 * hand-written jobs from the vanilla file is now declarative:
 *
 *   vanilla (01)                          mastra (02)
 *   ----------------------------------    ----------------------------------
 *   JSON-Schema tool defs                 createTool({ inputSchema: <zod> })
 *   the for-loop over messages.create     agent.generate(...)   ← the loop
 *   runTool() dispatch switch             Mastra routes calls to execute()
 *   messages.push(assistant / results)    Mastra threads history internally
 *   MAX_STEPS guard                       { maxSteps: 12 }
 *   safeParse + is_error retry            inputSchema validates; execute returns
 *                                          a retryable result the model re-reads
 *
 * You still bring the SAME zod schema, the SAME tool backing functions, and the
 * SAME prompts. The framework only owns the orchestration.
 *
 * NOTE ON PROVIDER: this runs on Google Gemini via `@ai-sdk/google` — the same
 * provider the real Sift goal agent uses. Notice how little of THIS file cares:
 * only the `model:` line differs from an Anthropic setup, because Mastra takes
 * any AI-SDK model adapter. The vanilla file, by contrast, is coupled to its
 * provider's loop shape. The real Sift agent is invoked over an HTTP
 * `/api/v1/responses` endpoint; here we call `.generate()` in-process.
 *
 * NOTE ON API SURFACE: Mastra's API evolves across releases. If a name here
 * doesn't match your installed version, check `@mastra/core`'s types — the
 * shape (Agent + createTool + generate) is stable; exact option names drift.
 */

import { Agent } from "@mastra/core/agent"
import { createTool } from "@mastra/core/tools"
import { CASES, GOALS } from "./domain"
import { google, MODEL } from "./model"
import { buildInputPrompt, SYSTEM_PROMPT } from "./prompt"
import { decisionInputSchema, searchInputSchema } from "./schema"
import { createDecisionSink, runSearch } from "./tools"

async function main() {
  const caseId = process.argv[2] ?? "password"
  const action = CASES[caseId]
  if (!action) {
    console.error(`Unknown case "${caseId}". Try: ${Object.keys(CASES).join(", ")}`)
    process.exit(1)
  }

  // Per-run tool state, exactly as in the vanilla file. We build the tools
  // INSIDE main() so the decision sink's latch is scoped to this run. (Sift
  // builds its tools per run too, injecting the action id via requestContext —
  // the closure below is the toy equivalent of that injection.)
  const sink = createDecisionSink(GOALS)

  const searchTool = createTool({
    id: "search",
    description:
      "Read-only lookup of the knowledge base or the tag catalog. Returns real IDs you must use when acting.",
    inputSchema: searchInputSchema, // ← the same zod object, used directly
    execute: async ({ context }) => {
      console.log(`  🔧 search(${JSON.stringify(context)})`)
      return runSearch(context)
    },
  })

  const submitDecisionTool = createTool({
    id: "submit_decision",
    description:
      "Submit your final act/abstain decisions, one per applying goal. Call this exactly once to finish the run.",
    inputSchema: decisionInputSchema,
    // The same backing sink: latch + retryable validation. Mastra hands the
    // model whatever this returns, so a `{ ok: false, retryable: true }` result
    // is read by the model and corrected on the next step — no extra plumbing.
    execute: async ({ context }) => {
      const result = sink.submit(context)
      console.log(`  🔧 submit_decision → ${result.ok ? "committed" : "⚠️ retryable error"}`)
      return result
    },
  })

  // The agent: persona/policy + model + tools, declared once. Compare with the
  // vanilla file, where "the agent" was an imperative for-loop.
  const agent = new Agent({
    name: "Goal Agent",
    instructions: SYSTEM_PROMPT,
    model: google(MODEL), // ← the ONLY provider-specific line in this file
    tools: { search: searchTool, submit_decision: submitDecisionTool },
  })

  console.log(`\n=== MASTRA goal agent · ${MODEL} · case ${action.id} (${caseId}) ===\n`)

  // The loop, dispatch, history threading, step cap, and retry — all inside
  // this ONE call. maxSteps is Sift's real cap.
  const res = await agent.generate(buildInputPrompt(action, GOALS), {
    maxSteps: 12,
  })

  // The tool calls above were logged from inside each tool's execute (the
  // Mastra equivalent of the vanilla file's dispatch logging). Mastra also
  // exposes the full trace on the result — res.toolCalls, res.steps, res.usage —
  // which is what Sift persists to `mastra_ai_spans`.
  if (res.text.trim()) console.log(`  💬 ${res.text.trim()}`)

  // Same as vanilla: the real "output" is the committed decision (a tool side
  // effect), not the model's final text.
  const decision = sink.result()
  console.log("\n--- committed decision ---")
  console.log(decision ? JSON.stringify(decision, null, 2) : "(agent abstained on all goals / never submitted)")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
