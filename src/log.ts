/**
 * log.ts — structured logging for the demo runners, on Pino.
 *
 * Two channels tell the agent's story:
 *   • The LLM step itself is a *trace span* — see telemetry.ts. Its ➡️ input /
 *     ⬅️ output render from real OpenTelemetry data, not from here.
 *   • Everything around it — the run banner, tool calls, rejections, the final
 *     decision — is *structured logging*, and that's this file.
 *
 * We use Pino, the de-facto standard production logger for Node/TS: JSON-first,
 * level-based, fast. Here it's paired with `pino-pretty` for readable colored
 * terminal output; in production you'd drop the pretty stream and let Pino emit
 * raw JSON straight to your aggregator (Datadog, Loki, CloudWatch). Fields you
 * pass as the first arg (`{ decision }`, `{ errors }`) are real structured data
 * you could query on — not baked into the message string.
 *
 * Colors auto-disable when stdout isn't a TTY or when NO_COLOR is set. The `c`
 * palette and `block` gutter are shared with telemetry.ts for the trace view.
 */

import { pino } from "pino"
import PinoPretty from "pino-pretty"

const colorEnabled =
  !process.env.NO_COLOR && (process.env.FORCE_COLOR === "1" || process.stdout.isTTY === true)

const wrap = (open: number, close: number) => (s: string) =>
  colorEnabled ? `\x1b[${open}m${s}\x1b[${close}m` : s

/** Raw ANSI palette, shared with the trace renderer in telemetry.ts. */
export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
}

/**
 * Render a multi-line payload with a colored gutter bar so a full prompt /
 * response stays readable (newlines preserved) instead of collapsing to one
 * clipped line. Long blocks are capped. Used by the trace renderer.
 */
export function block(text: string, paint: (s: string) => string, indent: number, max = 40): string {
  const pad = " ".repeat(indent)
  const bar = paint("│ ")
  const lines = text.replace(/\s+$/, "").split("\n")
  const shown = lines.length > max ? [...lines.slice(0, max), `… (+${lines.length - max} more lines)`] : lines
  return shown.map((l) => `${pad}${bar}${paint(l)}`).join("\n")
}

// A pretty stream (not the worker-thread transport) so it composes cleanly with
// the trace lines telemetry.ts writes straight to stdout, and stays robust under
// tsx. In production: construct pino() with no stream to get raw JSON on stdout.
const stream = PinoPretty({
  colorize: colorEnabled,
  translateTime: "SYS:HH:MM:ss.l",
  ignore: "pid,hostname",
  messageKey: "msg",
})

/** The raw Pino logger. Prefer the `log` helpers below; reach for this for ad-hoc lines. */
export const logger = pino({ level: process.env.LOG_LEVEL ?? "info" }, stream)

/** Status of a submit_decision tool call, for the trailing annotation. */
type ToolStatus = "committed" | "rejected"

/** A logger scoped to one step of the agent loop — carries `step` on every record. */
export interface StepLog {
  /** 💬 A line of the model's own prose, bound to this step. */
  say(text: string): void
  /** 🔧 A tool call the model made: a headline plus optional detail lines. */
  tool(head: string, detail?: string[]): void
  /** ✗ A rejected draft handed back to the model to fix — the retry loop working, not a failure. */
  rejected(errors: string[]): void
}

function step(n: number): StepLog {
  return {
    say(text) {
      logger.info({ step: n }, `💬 ${text}`)
    },
    tool(head, detail = []) {
      logger.info({ step: n, ...(detail.length ? { detail } : {}) }, `🔧 ${head}`)
    },
    rejected(errors) {
      logger.warn({ step: n, errors }, "✗ rejected — sent back to the model to fix")
    },
  }
}

export const log = {
  /** The run header. */
  banner(title: string): void {
    logger.info(c.bold(title))
  },

  /** ⏭️ The pre-invocation gate refused the action; the agent was never called. */
  skip(reason: string, note = "goal agent not invoked"): void {
    logger.warn({ reason }, `⏭️  skipped — ${reason} (${note})`)
  },

  /** 💬 A line of model prose not tied to a step (e.g. a final audit note). */
  say(text: string): void {
    logger.info(`💬 ${text}`)
  },

  /**
   * 🔧 A tool call logged outside a step (the Mastra runner's flat event stream).
   * `status` adds "→ committed / → rejected"; `errors` are attached as fields.
   */
  tool(head: string, opts: { status?: ToolStatus; errors?: string[] } = {}): void {
    if (opts.status === "rejected") {
      logger.warn({ errors: opts.errors }, `🔧 ${head} → rejected — sent back to the model to fix`)
    } else {
      logger.info(`🔧 ${head}${opts.status === "committed" ? " → committed" : ""}`)
    }
  },

  /** The final decision — as a structured `decision` field you could query on. */
  committed(decision: unknown): void {
    if (decision) logger.info({ decision }, "committed decision")
    else logger.warn("no decision submitted")
  },

  /** Open a logger scoped to one step of the agent loop. */
  step,
}
