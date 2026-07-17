/**
 * telemetry.ts — OpenTelemetry tracing for the LLM step, and the shared span
 * renderer both runners use.
 *
 * An LLM call is naturally a *span*: it has a start and end (latency), inputs
 * (the prompt), outputs (text + tool calls), and metadata (model, token usage,
 * finish reason). That's exactly the "➡️ input / ⬅️ output" pair the vanilla loop
 * used to hand-assemble with color — so here we stop faking it and read it off
 * real telemetry instead.
 *
 * This file is deliberately the SEAM of the vanilla-vs-Mastra comparison:
 *   • `PrettyLLMSpanExporter` — one exporter, so the terminal trace looks
 *     identical no matter who produced the span. Both paths import it.
 *   • `registerHandWiredTracing()` — the VANILLA path. 01-vanilla.ts calls this
 *     to stand up a tracer provider by hand, then flags each `generateText` with
 *     `experimental_telemetry`. This is you doing the framework's job yourself.
 *   • The MASTRA path (agent.ts) does NOT call the above. It hands the same
 *     exporter to `new Mastra({ telemetry: { export: { type: "custom", … } } })`
 *     and gets tracing for free — the framework owns the provider wiring.
 *
 * The exporter class has no import side effects, so agent.ts can pull it in
 * without accidentally registering a second global provider.
 */

import { ExportResultCode, type ExportResult } from "@opentelemetry/core"
import { Resource } from "@opentelemetry/resources"
import {
  BatchSpanProcessor,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-node"
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import {
  AISpanType,
  AITracingEventType,
  type AITracingEvent,
  type AITracingExporter,
  type LLMGenerationAttributes,
} from "@mastra/core/ai-tracing"
import { block, c } from "./log"

// A minimal structural view of a finished span — just the fields we render. Both
// the vanilla path (OTel sdk-trace 1.x) and Mastra (which bundles sdk-trace 2.x)
// hand us spans that satisfy this, so the one exporter plugs into either without
// tripping over the two versions' incompatible `ReadableSpan` types.
interface FinishedSpan {
  name: string
  attributes: Record<string, unknown>
  duration: [number, number]
}

/** ms between a span's start and end, from its HrTime `[seconds, nanos]` duration. */
function durationMs(span: FinishedSpan): number {
  const [s, ns] = span.duration
  return Math.round(s * 1000 + ns / 1e6)
}

/** First attribute present from a list of candidate keys, as a string. */
function attr(span: FinishedSpan, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = span.attributes[k]
    if (v != null) return String(v)
  }
  return undefined
}

/** One message's content: a plain string, or the AI SDK's array of typed parts. */
function renderContent(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (part?.type === "text") return part.text
        if (part?.type === "tool-call") return `[tool-call ${part.toolName}] ${JSON.stringify(part.args ?? part.input)}`
        if (part?.type === "tool-result") return `[tool-result ${part.toolName}] ${JSON.stringify(part.result ?? part.output)}`
        return JSON.stringify(part)
      })
      .join("\n")
  }
  return JSON.stringify(content, null, 2)
}

/** Best-effort pretty text for the prompt the model read (AI SDK stores it as JSON). */
function renderPrompt(raw: string | undefined): string {
  if (!raw) return "(prompt unavailable)"
  try {
    const parsed = JSON.parse(raw)
    const messages = Array.isArray(parsed) ? parsed : parsed.messages
    if (Array.isArray(messages)) {
      return messages.map((m: any) => `▸ ${m.role}\n${renderContent(m.content)}`).join("\n")
    }
    return typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

/** Best-effort pretty text for what the model returned this turn (text + tool calls). */
function renderResponse(span: FinishedSpan): string {
  const parts: string[] = []
  const rawCalls = attr(span, "ai.response.toolCalls")
  if (rawCalls) {
    try {
      for (const call of JSON.parse(rawCalls)) {
        // The AI SDK stores each call's args as a JSON *string* — parse it so the
        // block shows real indented JSON instead of an escaped one-liner.
        const rawArgs = call.args ?? call.input
        const args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs
        parts.push(`▸ wants tool call: ${call.toolName}\n${JSON.stringify(args, null, 2)}`)
      }
    } catch {
      parts.push(rawCalls)
    }
  }
  const text = attr(span, "ai.response.text")
  if (text?.trim()) parts.push(`▸ text:\n${text.trim()}`)
  return parts.length ? parts.join("\n") : "(no tool calls, no text)"
}

/** Renders a `[{ role, content }]` message list the way both trace paths show prompts. */
function renderMessages(messages: any[]): string {
  return messages.map((m: any) => `▸ ${m.role}\n${renderContent(m.content)}`).join("\n")
}

/** Best-effort pretty text for a value the AI-tracing span carries as `input`/`output`. */
function renderValue(value: unknown): string {
  if (value == null) return "(none)"
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    if (value.every((m: any) => m && typeof m === "object" && "role" in m)) return renderMessages(value)
    return value.map(renderContent).join("\n")
  }
  const o = value as any
  if (Array.isArray(o.messages)) return renderMessages(o.messages) // { messages: [...] } — Mastra's LLM input
  if (o.toolCalls || typeof o.text === "string") {
    const parts: string[] = []
    for (const call of o.toolCalls ?? []) {
      const rawArgs = call.args ?? call.input
      const args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs
      parts.push(`▸ wants tool call: ${call.toolName}\n${JSON.stringify(args, null, 2)}`)
    }
    if (typeof o.text === "string" && o.text.trim()) parts.push(`▸ text:\n${o.text.trim()}`)
    if (parts.length) return parts.join("\n")
  }
  return JSON.stringify(value, null, 2)
}

/**
 * The workbook's terminal view of one LLM turn: a `⟪trace⟫` header (step tag,
 * model, latency, finish reason, token in→out) over ➡️ input / ⬅️ output gutter
 * blocks. Both exporters below normalize their own span format into this call, so
 * the trace reads identically whether it came from the hand-wired OTel provider
 * (vanilla) or Mastra's AI Tracing (framework).
 */
function renderTurn(t: {
  stepTag?: string
  model: string
  ms: number
  finish: string
  inTok?: number | string
  outTok?: number | string
  input: string
  output: string
}): void {
  const tokens = t.inTok != null && t.outTok != null ? ` · ${t.inTok}→${t.outTok} tok` : ""
  const indent = "  ⟪trace⟫ ".length
  console.log(
    `  ${c.cyan("⟪trace⟫")} ${c.dim(t.stepTag ?? "")}${c.bold("LLM turn")} ${c.dim(`· ${t.model} · ${t.ms}ms · finish=${t.finish}${tokens}`)}`,
  )
  console.log(`${" ".repeat(indent)}${c.blue("➡️  input")}`)
  console.log(block(t.input, c.blue, indent))
  console.log(`${" ".repeat(indent)}${c.magenta("⬅️  output")}`)
  console.log(block(t.output, c.magenta, indent))
}

/**
 * VANILLA exporter (raw OpenTelemetry). Keys on `ai.generateText.doGenerate`, the
 * span the AI SDK opens around one model round-trip, and reads the turn off its
 * flat string attributes. Plugs into the hand-wired provider in
 * `registerHandWiredTracing`. The outer `ai.generateText` aggregate is skipped.
 */
export class PrettyLLMSpanExporter {
  export(spans: FinishedSpan[], done: (result: ExportResult) => void): void {
    for (const span of spans) {
      if (span.name !== "ai.generateText.doGenerate") continue
      // Set by the vanilla loop via experimental_telemetry.metadata.
      const stepNo = attr(span, "ai.telemetry.metadata.step")
      renderTurn({
        stepTag: stepNo ? `[step ${stepNo}] ` : "",
        model: attr(span, "gen_ai.request.model", "ai.model.id") ?? "model",
        ms: durationMs(span),
        finish: attr(span, "ai.response.finishReason") ?? "unknown",
        inTok: attr(span, "ai.usage.promptTokens", "gen_ai.usage.input_tokens"),
        outTok: attr(span, "ai.usage.completionTokens", "gen_ai.usage.output_tokens"),
        input: renderPrompt(attr(span, "ai.prompt.messages", "ai.prompt")),
        output: renderResponse(span),
      })
    }
    done({ code: ExportResultCode.SUCCESS })
  }

  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}

/** ms between a Mastra AI span's start and end `Date`s. */
function spanMs(span: { startTime?: Date; endTime?: Date }): number {
  return span.endTime && span.startTime ? +span.endTime - +span.startTime : 0
}

/** One indented `⟪trace⟫` block: a header line over ➡️ input / ⬅️ output gutters. */
function renderSpanBlock(header: string, meta: string, input: string, output: string): void {
  const indent = "  ⟪trace⟫ ".length + 2 // nested one level under the agent-run header
  console.log(`    ${c.cyan("⟪trace⟫")} ${c.bold(header)} ${c.dim(meta)}`)
  console.log(`${" ".repeat(indent)}${c.blue("➡️  input")}`)
  console.log(block(input, c.blue, indent, 14))
  console.log(`${" ".repeat(indent)}${c.magenta("⬅️  output")}`)
  console.log(block(output, c.magenta, indent, 14))
}

/**
 * MASTRA exporter (Mastra AI Tracing — the framework's current, non-deprecated
 * observability). Where the vanilla path hand-builds an OTel provider, here we
 * just hand this exporter to `new Mastra({ observability: … })` (see agent.ts)
 * and the framework drives it, delivering typed AI spans as events.
 *
 * Unlike the vanilla path (one flat span per hand-written loop step), Mastra's
 * `generateLegacy` emits a whole SPAN TREE for the single agent call: a root
 * `agent_run` span with one `llm_generation` child (the entire multi-turn
 * generation, rolled into one span) and a `tool_call` child per tool invocation.
 * We BUFFER every ended span and render the tree top-down when the root
 * `agent_run` span closes (it ends last), so the terminal shows the full shape
 * the framework captured — not just the LLM turn.
 */
export class MastraLLMTraceExporter implements AITracingExporter {
  name = "pretty-llm-trace"

  // Per-run buffer (agent.ts constructs a fresh exporter per traced run).
  private spans: any[] = []

  async exportEvent(event: AITracingEvent): Promise<void> {
    if (event.type !== AITracingEventType.SPAN_ENDED) return
    this.spans.push(event.exportedSpan)
    // The root agent-run span ends last; that's our cue to render the tree.
    if (event.exportedSpan.type === AISpanType.AGENT_RUN) {
      this.renderTree()
      this.spans = []
    }
  }

  /** Render root → children (sorted by start time) as one nested trace tree. */
  private renderTree(): void {
    const root = this.spans.find((s) => s.type === AISpanType.AGENT_RUN)
    const children = this.spans
      .filter((s) => s !== root)
      .sort((a, b) => (a.startTime && b.startTime ? +a.startTime - +b.startTime : 0))

    if (root) {
      const agentId = root.attributes?.agentId ?? "agent"
      const toolCount = children.filter((s) => s.type === AISpanType.TOOL_CALL).length
      console.log(
        `  ${c.cyan("⟪trace⟫")} ${c.bold("agent run")} ${c.dim(`· ${agentId} · ${spanMs(root)}ms · ${toolCount} tool call${toolCount === 1 ? "" : "s"}`)}`,
      )
    }

    for (const span of children) {
      if (span.type === AISpanType.LLM_GENERATION) this.renderLLMSpan(span)
      else if (span.type === AISpanType.TOOL_CALL) this.renderToolSpan(span)
    }
  }

  /** The `llm_generation` child — the whole generation as one turn. */
  private renderLLMSpan(span: any): void {
    const a: LLMGenerationAttributes = span.attributes ?? {}
    const usage = a.usage ?? {}
    const inTok = usage.inputTokens ?? usage.promptTokens
    const outTok = usage.outputTokens ?? usage.completionTokens
    const tokens = inTok != null ? ` · ${inTok}→${outTok} tok` : ""
    renderSpanBlock(
      "LLM turn",
      `· ${a.model ?? "model"} · ${spanMs(span)}ms · finish=${a.finishReason ?? "unknown"}${tokens}`,
      renderValue(span.input),
      renderValue(span.output),
    )
  }

  /** A `tool_call` child — the tool's id, input, and returned result. */
  private renderToolSpan(span: any): void {
    const toolId = span.attributes?.toolId ?? "tool"
    renderSpanBlock(`tool call · ${toolId}`, `· ${spanMs(span)}ms`, renderValue(span.input), renderValue(span.output))
  }

  async shutdown(): Promise<void> {}
}

/**
 * The VANILLA path: stand up an OpenTelemetry tracer provider BY HAND and
 * register it globally, so the AI SDK's `experimental_telemetry` spans have
 * somewhere to go. This is the plumbing the framework does for you in agent.ts —
 * here 01-vanilla.ts calls it explicitly, before its first model call.
 *
 * Mastra does NOT use this; it configures the same exporter through its own
 * `telemetry` config (see agent.ts). Kept as a function (not an import side
 * effect) so pulling `PrettyLLMSpanExporter` into agent.ts registers nothing.
 */
export function registerHandWiredTracing(): void {
  const spanProcessors: SpanProcessor[] = [new SimpleSpanProcessor(new PrettyLLMSpanExporter())]

  // Production path: if an OTLP endpoint is configured, batch the SAME spans out
  // to it. Langfuse/Jaeger/Tempo all speak OTLP; the exporter reads endpoint and
  // headers from the standard OTEL_EXPORTER_OTLP_* env vars — no code change.
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    spanProcessors.push(new BatchSpanProcessor(new OTLPTraceExporter()))
  }

  const provider = new NodeTracerProvider({
    resource: new Resource({ [ATTR_SERVICE_NAME]: "goal-agent-workbook" }),
    spanProcessors,
  })
  provider.register()

  // Flush batched spans on exit so an OTLP run doesn't drop the last turns.
  process.on("beforeExit", () => {
    void provider.shutdown()
  })
}
