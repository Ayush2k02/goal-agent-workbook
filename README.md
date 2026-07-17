# Goal Agent Workbook

A runnable, side-by-side workbook for learning how a **goal agent** works — the
kind Sift runs autonomously after synthesis. You get the *same* agent built two
ways:

- **`src/01-vanilla.ts`** — hand-written against the raw Anthropic Messages API.
  You write the agent loop, the tool dispatch, the message threading, the step
  cap, and the retry-on-error yourself.
- **`src/02-mastra.ts`** — the exact same behavior, built with the
  [Mastra](https://mastra.ai) framework. The loop and all its bookkeeping become
  a single `agent.generate(...)` call.

Both files import the **same** domain, the **same** decision schema, the **same**
tool-backing functions, and the **same** prompts. The only thing that changes is
who runs the loop — you, or the framework. That's the whole lesson.

> This is a simplified **analog** of Sift's real goal agent, not the real thing.
> It captures the shape (one case + enabled goals → act/abstain per goal, via a
> read-only `search` tool and a terminal `submit_decision` tool with a latch and
> retryable validation) but runs standalone with just an API key. Callouts marked
> **"In real Sift"** point at where the production agent differs.

---

## The toy scenario

The agent is handed **one customer case** and a list of **org goals**, and must
decide — per goal — whether to **act** (draft a reply / attach a tag) or
**abstain**. Three cases ship in [`src/domain.ts`](src/domain.ts):

| case (`pnpm vanilla <case>`) | what the agent should do |
| --- | --- |
| `password` (default) | recognize a how-to question → `search` the KB → draft a grounded reply under `goal_deflect_kb` |
| `refund` | recognize a billing/refund issue → `search` the tag catalog → **abstain** and tag it under `goal_escalate_billing` (never auto-promise a refund) |
| `praise` | recognize positive feedback → draft a short thank-you under `goal_thank_praise` |

---

## Setup

```bash
cd ~/goal-agent-workbook
pnpm install            # or npm install
export ANTHROPIC_API_KEY=sk-ant-...   # or: cp .env.example .env && edit
```

Both files use `claude-opus-4-8`. (The real Sift agent uses **Gemini** via
`@ai-sdk/google` — see the provider note in `02-mastra.ts`. We use Anthropic here
so both files share a model and the diff stays clean.)

## Run it

```bash
pnpm vanilla            # the hand-written agent, on the `password` case
pnpm mastra             # the Mastra agent, same case
pnpm vanilla refund     # try the abstain-and-tag path
pnpm mastra praise      # try the thank-you path
pnpm both               # run both back to back and compare output
```

Watch the step-by-step log: the model narrates, calls `search` to resolve an ID,
then calls `submit_decision`. The committed decision printed at the end is the
agent's real output — a **side effect of the terminal tool**, not the model's
final sentence.

---

## The concept map

The six jobs an agent framework does for you — and where each lives in the two
files and in the real Sift codebase.

| Concept | Vanilla (`01`) — you write it | Mastra (`02`) — declared | In real Sift |
| --- | --- | --- | --- |
| **Tool definition** | JSON Schema, hand-derived from zod via `toAnthropicSchema` | `createTool({ inputSchema: <zod> })` — zod used directly | `createTool` from `@mastra/core/tools` |
| **The agent loop** | the `for (step…)` loop calling `messages.create` | `agent.generate(...)` runs the loop internally | Mastra `Agent.generate/stream`, driven server-side over `POST /api/v1/responses` |
| **Tool dispatch** | `runTool()` switch on `block.name` | Mastra routes each call to the tool's `execute` | same (Mastra) |
| **History threading** | `messages.push()` — assistant turn, then a user turn of `tool_result`s | handled inside `generate` | same (Mastra) |
| **Step cap** | `MAX_STEPS = 12` guard | `{ maxSteps: 12 }` | `defaultOptions: { maxSteps: 12 }` on the Agent |
| **Structured decision** | `submit_decision` tool + zod schema | same tool + same zod schema | `submit_goal_decision` + `submitGoalDecisionSchema` |
| **Retryable validation** | `safeParse` + `is_error: true` tool result | `execute` returns `{ ok:false, retryable:true }`; model re-reads it | `.superRefine` + `executeGoalDecision` return retryable errors |
| **Per-run tool state (latch)** | `createDecisionSink()` rebuilt per run | same sink, closed over inside `main()` | tool rebuilt per run; `submitted` latch + action id injected via `requestContext` |
| **Model provider** | Anthropic SDK (`@anthropic-ai/sdk`) | AI-SDK adapter (`@ai-sdk/anthropic`) | `@ai-sdk/google` Gemini, `thinkingLevel: "minimal"` |
| **Run output** | the committed decision (tool side effect) | same | side effect of `submit_goal_decision` + a one-line audit sentence |
| **Tracing** | `console.log` per step | `res.steps` / `res.toolCalls` | `mastra_ai_spans` table + Datadog via `@mastra/observability` |

### What Mastra buys you (and what it doesn't)

Mastra owns the **orchestration**: the loop, dispatch, history, step cap, and
tool-result retry. It does **not** replace your **domain thinking** — you still
author the schema, the tools' backing logic, the prompts, and the decision
contract. In this workbook those live in `schema.ts`, `tools.ts`, and
`prompt.ts`, imported unchanged by both files. That split is the point: the
framework is loop plumbing; the agent's *judgment* is still yours to design.

---

## File tour

| File | What it teaches |
| --- | --- |
| [`src/domain.ts`](src/domain.ts) | the toy world: cases, goals, KB, tags (Sift's action + goals + catalogs) |
| [`src/schema.ts`](src/schema.ts) | ONE zod decision schema, consumed by both — plus the JSON-Schema tax the vanilla side pays |
| [`src/tools.ts`](src/tools.ts) | tool *backing logic*: `runSearch` + the `submit_decision` sink (latch + retryable validation) |
| [`src/prompt.ts`](src/prompt.ts) | the stable system prompt + the per-run input prompt (Sift's two-part prompt split) |
| [`src/01-vanilla.ts`](src/01-vanilla.ts) | the whole agent as a hand-written loop — read this first |
| [`src/02-mastra.ts`](src/02-mastra.ts) | the same agent, framework-managed — read this second, and diff it against `01` |

---

## Suggested exercises

1. **Break the loop cap.** Set `MAX_STEPS = 1` in `01-vanilla.ts` and run the
   `password` case. The model can't both `search` and `submit_decision` in one
   step, so it never finishes. Now find the `maxSteps` in `02-mastra.ts` — same
   failure, one line. This is why Sift caps at 12.
2. **Force a retry.** In `tools.ts`, temporarily make `goal_escalate_billing`
   disallow the `tag` action (`allowedActions: []`). Run `refund` and watch the
   model receive the validation error and correct itself. That's the retryable
   contract doing its job — in both files, with zero orchestration code from you.
3. **Add a tool.** Add a `resolve_queue` tool (a third catalog lookup). Notice
   you touch `tools.ts` (backing fn) + one entry in each file's tool list — and
   nothing in the loop. The loop doesn't care how many tools exist.
4. **Delete the latch.** Remove the `if (committed) return …` guard in
   `createDecisionSink`. On some runs the model calls `submit_decision` twice;
   without the latch the second call overwrites the first. This is the bug the
   latch prevents.
5. **Read the real thing.** Open Sift's `submit-goal-decision.ts` and
   `workflow-goal-agent-client.ts` and map each piece back to this workbook using
   the concept map above.
