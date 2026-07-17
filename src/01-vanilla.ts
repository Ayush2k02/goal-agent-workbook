/**
 * 01-vanilla.ts — the goal agent with NO agent framework, on Gemini.
 *
 * Run:  pnpm vanilla L1   (cases: L1 L2 L3 · N1 · X1–X4 — see data.store.ts)
 *
 * We talk to Gemini through the Vercel AI SDK (`generateText` + `@ai-sdk/google`)
 * — the same model layer the real agent sits on — but we hand-write the
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
import { createDecisionGate, runSearch } from "./tools"
import { log } from "./log"
import { registerHandWiredTracing } from "./telemetry"

const MAX_STEPS = 12 // the real cap. Bounds tool round-trips.

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
  // Stand up the OTel tracer by hand — the framework's job, done ourselves — so
  // the `experimental_telemetry` spans below have somewhere to go. Must run
  // before the first generateText call.
  registerHandWiredTracing()

  const caseId = process.argv[2] ?? "L1"
  const action = CASES[caseId]
  if (!action) {
    console.error(`Unknown case "${caseId}". Try: ${Object.keys(CASES).join(", ")}`)
    process.exit(1)
  }
  const org = ORGS[action.orgKey]

  log.banner(`VANILLA goal agent · ${MODEL} · ${org.displayName} · case ${action.id} (${caseId})`)

  // Pre-invocation gate: if the action isn't eligible, the agent is never called.
  const elig = evaluateEligibility(action, org)
  if (!elig.eligible) {
    log.skip(elig.reason)
    return
  }

  const gate = createDecisionGate(org) // per-run tool state — write-once latch: the first valid submit_decision commits, later ones are no-ops
  const messages: CoreMessage[] = [{ role: "user", content: buildInputPrompt(action, org) }]

  // --- The agent loop. This for-loop IS the agent. -------------------------
  for (let step = 1; step <= MAX_STEPS; step++) {
    const stepLog = log.step(step)

    // The ➡️ input / ⬅️ output of this turn is captured as an OpenTelemetry span:
    // `experimental_telemetry` tells the AI SDK to record the prompt, response,
    // token usage, and latency. telemetry.ts renders that span (and, if an OTLP
    // endpoint is set, ships it to a real backend). `metadata.step` tags the span
    // so the trace line can show which turn it was.
    const res = await generateText({
      model: google(MODEL),
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
      experimental_telemetry: { isEnabled: true, functionId: "vanilla.step", metadata: { step, caseId } },
    })

    if (res.text.trim()) stepLog.say(res.text.trim())
    if (res.finishReason !== "tool-calls" || res.toolCalls.length === 0) break

    // Preserve the assistant turn (its tool calls) before answering it.
    messages.push(...res.response.messages)

    // Run every tool the model called, collect results.
    const toolResults = res.toolCalls.map((call) => {
      const { output, isError, errors } = runTool(org, call.toolName, call.args, gate)
      const { head, lines } = describeCall(call.toolName, call.args)
      stepLog.tool(head, lines)
      // A rejection isn't a failure: the gate refused an invalid draft and handed
      // the model the reasons to fix on the next step — the retry loop working.
      if (isError) stepLog.rejected(errors ?? [])
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

  log.committed(gate.result())
}

/**
 * A compact, human-readable one-liner (+ detail lines) for a tool call, so the
 * step log stays scannable instead of dumping the raw args JSON. The full
 * committed decision is still logged as a structured field at the end of the run.
 */
function describeCall(name: string, args: unknown): { head: string; lines: string[] } {
  const clip = (s: string, n = 72) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
  const a = args as any

  if (name === "search") {
    return { head: `search · ${a?.kind ?? "?"} "${a?.query ?? ""}"`, lines: [] }
  }
  // The one interesting param for an action: reply text, a tag id, or a close-reason id.
  const actionDetail = (act: any): string => {
    if (act?.params?.text != null) return ` "${clip(act.params.text)}"`
    if (act?.params?.tagId != null) return ` ${act.params.tagId}`
    if (act?.params?.closeReasonId != null) return ` ${act.params.closeReasonId}`
    return ""
  }

  if (name === "submit_decision") {
    if (a?.decision === "abstain") return { head: "submit_decision · abstain", lines: [] }
    const lines = (a?.decisions ?? []).map((d: any) => {
      const acts = (d?.actions ?? [])
        .map((act: any) => `${act?.type}${actionDetail(act)}`)
        .join(", ")
      return `• ${d?.goalId} → ${acts || "(no actions)"}`
    })
    return { head: `submit_decision · act`, lines }
  }
  return { head: `${name}(${JSON.stringify(args)})`, lines: [] }
}

function runTool(
  org: (typeof ORGS)[string],
  name: string,
  input: unknown,
  gate: ReturnType<typeof createDecisionGate>,
): { output: unknown; isError: boolean; errors?: string[] } {
  // Zod issues → readable "path: message" lines the model (and the log) can use.
  const fmtZod = (issues: { path: (string | number)[]; message: string }[]) =>
    issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)

  if (name === "search") {
    const parsed = searchInputSchema.safeParse(input)
    if (!parsed.success) return { output: { errors: parsed.error.issues }, isError: true, errors: fmtZod(parsed.error.issues) }
    return { output: runSearch(org, parsed.data), isError: false }
  }
  if (name === "submit_decision") {
    const parsed = decisionInputSchema.safeParse(input)
    if (!parsed.success) return { output: { retryable: true, errors: parsed.error.issues }, isError: true, errors: fmtZod(parsed.error.issues) }
    const result = gate.submit(parsed.data)
    return { output: result, isError: !result.ok, errors: result.ok ? undefined : result.errors }
  }
  return { output: { error: `unknown tool ${name}` }, isError: true, errors: [`unknown tool ${name}`] }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
