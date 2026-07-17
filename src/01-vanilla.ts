/**
 * 01-vanilla.ts — the goal agent with NO agent framework, on Gemini.
 *
 * Run:  pnpm vanilla A1   (cases: A1 A2 A3 · B1 B2 B3 — see domain.ts)
 *
 * We talk to Gemini through the Vercel AI SDK (`generateText` + `@ai-sdk/google`)
 * — the same model layer Sift's real agent sits on — but we hand-write the
 * agentic loop. Read top to bottom and you'll see every job a framework does for
 * you, because here you do them: tool defs, the loop, dispatch, history
 * threading, the step cap, and surfacing validation errors for retry.
 *
 * The tools here have NO `execute` — deliberately. Without it the AI SDK hands
 * the tool call back to US instead of running it, so the loop is ours.
 * Compare with agent.ts / 02-mastra.ts, where all of this is declarative.
 */

import { generateText, tool, type CoreMessage } from "ai"
import { CASES, ORGS } from "./data.store"
import { evaluateEligibility } from "./eligibility"
import { google, MODEL } from "./model"
import { buildInputPrompt, SYSTEM_PROMPT } from "./prompt"
import { decisionInputSchema, searchInputSchema } from "./schema"
import { createDecisionSink, runSearch } from "./tools"

const MAX_STEPS = 12 // Sift's real cap. Bounds tool round-trips.

const TOOLS = {
  search: tool({
    description: "Read-only lookup of the org's tag or close-reason catalog. Returns real IDs to use when acting.",
    parameters: searchInputSchema,
  }),
  submit_decision: tool({
    description: "Submit your final act/abstain decision (one block per applying goal). Call exactly once to finish.",
    parameters: decisionInputSchema,
  }),
}

async function main() {
  const caseId = process.argv[2] ?? "A1"
  const action = CASES[caseId]
  if (!action) {
    console.error(`Unknown case "${caseId}". Try: ${Object.keys(CASES).join(", ")}`)
    process.exit(1)
  }
  const org = ORGS[action.orgKey]

  console.log(`\n=== VANILLA goal agent · ${MODEL} · ${org.displayName} · case ${action.id} (${caseId}) ===\n`)

  // Pre-invocation gate: if the action isn't eligible, the agent is never called.
  const elig = evaluateEligibility(action)
  if (!elig.eligible) {
    console.log(`  ⏭️  skipped — ${elig.reason} (goal agent not invoked)`)
    return
  }

  const sink = createDecisionSink(org) // per-run tool state (latch lives here)
  const messages: CoreMessage[] = [{ role: "user", content: buildInputPrompt(action, org, org.goals) }]

  // --- The agent loop. This for-loop IS the agent. -------------------------
  for (let step = 1; step <= MAX_STEPS; step++) {
    const res = await generateText({ model: google(MODEL), system: SYSTEM_PROMPT, tools: TOOLS, messages })

    if (res.text.trim()) console.log(`  [step ${step}] 💬 ${res.text.trim()}`)
    if (res.finishReason !== "tool-calls" || res.toolCalls.length === 0) break

    // Preserve the assistant turn (its tool calls) before answering it.
    messages.push(...res.response.messages)

    // Run every tool the model called, collect results.
    const toolResults = res.toolCalls.map((call) => {
      const { output, isError } = runTool(org, call.toolName, call.args, sink)
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

    messages.push({ role: "tool", content: toolResults })
  }

  const decision = sink.result()
  console.log("\n--- committed decision ---")
  console.log(decision ? JSON.stringify(decision, null, 2) : "(no decision submitted)")
}

function runTool(
  org: (typeof ORGS)[string],
  name: string,
  input: unknown,
  sink: ReturnType<typeof createDecisionSink>,
): { output: unknown; isError: boolean } {
  if (name === "search") {
    const parsed = searchInputSchema.safeParse(input)
    if (!parsed.success) return { output: { errors: parsed.error.issues }, isError: true }
    return { output: runSearch(org, parsed.data), isError: false }
  }
  if (name === "submit_decision") {
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
