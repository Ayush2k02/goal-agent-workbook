/**
 * tools.ts — the tool *backing logic*, shared by both implementations.
 *
 * A tool has two parts: (1) a name + input schema the model sees, and (2) the
 * code that runs when the model calls it. This file is part (2) — plain
 * functions with no dependency on Anthropic or Mastra. Both 01-vanilla.ts and
 * 02-mastra.ts wire these same functions up; only the wiring differs.
 *
 * Two tools, mirroring Sift's real goal agent:
 *   - runSearch          → a read-only lookup (like Sift's `search`)
 *   - createDecisionSink → the terminal "submit_decision" tool, WITH the two
 *     behaviors that make Sift's `submit_goal_decision` interesting:
 *       (a) a per-run LATCH so a duplicate submit is a harmless no-op, and
 *       (b) RETRYABLE VALIDATION — invalid input comes back as an error the
 *           model reads and corrects, rather than crashing the run.
 */

import { KNOWLEDGE_BASE, TAGS, type Goal } from "./domain"
import type { DecisionInput, SearchInput } from "./schema"

// ---------------------------------------------------------------------------
// Tool 1: search — read-only catalog lookup. Returns real IDs the agent must
// use when it acts. Never mutates anything.
// ---------------------------------------------------------------------------

export const runSearch = (input: SearchInput) => {
  const q = input.query.toLowerCase()
  if (input.kind === "knowledge_base") {
    const hits = KNOWLEDGE_BASE.filter(
      (e) =>
        e.question.toLowerCase().includes(q) ||
        q.split(/\s+/).some((w) => w.length > 3 && e.question.toLowerCase().includes(w)),
    )
    return { kind: "knowledge_base", results: hits }
  }
  const hits = TAGS.filter((t) => t.label.includes(q) || q.includes(t.label))
  return { kind: "tag", results: hits }
}

// ---------------------------------------------------------------------------
// Tool 2: submit_decision — the terminal tool. Calling it (successfully) is how
// the agent finishes. This is a FACTORY: we build a fresh sink per run so the
// latch is naturally run-scoped — the same trick the real tool uses (it's
// rebuilt per run, so its `submitted` closure can't leak between cases).
// ---------------------------------------------------------------------------

export type DecisionResult =
  | { ok: true; committed: DecisionInput }
  | { ok: false; retryable: true; errors: string[] }

export const createDecisionSink = (enabledGoals: Goal[]) => {
  const goalsById = new Map(enabledGoals.map((g) => [g.id, g]))
  let committed: DecisionInput | null = null

  const submit = (input: DecisionInput): DecisionResult => {
    // (a) LATCH: if we already accepted a decision, ignore duplicates and
    // return the first one. The model sometimes calls the tool twice.
    if (committed) return { ok: true, committed }

    // (b) RETRYABLE VALIDATION: collect every problem and hand them back so the
    // model can fix them in the next step instead of the run dying.
    const errors: string[] = []
    for (const d of input.decisions) {
      const goal = goalsById.get(d.goalId)
      if (!goal) {
        errors.push(`Unknown goalId "${d.goalId}" — use one of the enabled goals.`)
        continue
      }
      if (d.decision === "act") {
        if (!d.action) {
          errors.push(`Goal ${d.goalId}: decision "act" requires an action.`)
          continue
        }
        if (!goal.allowedActions.includes(d.action.type)) {
          errors.push(
            `Goal ${d.goalId}: action "${d.action.type}" not allowed. Allowed: ${goal.allowedActions.join(", ")}.`,
          )
        }
        if (d.action.type === "draft_reply" && !d.action.replyText?.trim()) {
          errors.push(`Goal ${d.goalId}: draft_reply requires non-empty replyText.`)
        }
        if (d.action.type === "tag") {
          const known = TAGS.some((t) => t.id === d.action?.tagId)
          if (!known) {
            errors.push(
              `Goal ${d.goalId}: tagId "${d.action.tagId ?? "(missing)"}" is not a real tag. Resolve it with search first.`,
            )
          }
        }
      } else if (d.decision === "abstain" && !d.reason?.trim()) {
        errors.push(`Goal ${d.goalId}: abstain requires a reason.`)
      }
    }

    if (errors.length > 0) return { ok: false, retryable: true, errors }

    committed = input
    return { ok: true, committed }
  }

  return {
    submit,
    /** Read the committed decision after the run finishes. */
    result: () => committed,
  }
}
