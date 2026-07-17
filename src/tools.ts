/**
 * tools.ts — the tool *backing logic*, shared by both implementations.
 *
 * Provider-agnostic plain functions (no Anthropic/Gemini/Mastra imports). Two
 * tools, mirroring the real goal agent:
 *   - runSearch          → read-only catalog lookup (the real `search`)
 *   - createDecisionGate → the terminal `submit_decision` tool, which does what
 *     the real `submit_goal_decision` + `executeGoalDecision` do BEFORE any side
 *     effect: validate the decision and return RETRYABLE errors the model can
 *     fix, with a once-per-run LATCH so a duplicate submit is a no-op.
 *
 * In production, on success this would draft the reply / apply the tag / close
 * the action. Here (like the bench's "recorder" target) it only RECORDS the
 * decision — no side effects — so we can inspect and score it.
 */

import { type Org, REPLY_PRODUCING } from "./data.store"
import type { DecisionInput } from "./schema"

// ---------------------------------------------------------------------------
// Tool 1: search — read-only catalog lookup. Returns real IDs the agent must
// use when it tags or closes. Never mutates anything.
// ---------------------------------------------------------------------------
export const runSearch = (org: Org, input: { kind: "tag" | "close_reason"; query: string }) => {
  const q = input.query.toLowerCase()
  if (input.kind === "tag") {
    const results = org.tags.filter((t) => t.label.toLowerCase().includes(q) || q.includes(t.label.toLowerCase()))
    return { kind: "tag", results }
  }
  const results = org.closeReasons.filter(
    (c) => c.label.toLowerCase().includes(q) || q.includes(c.label.toLowerCase()),
  )
  return { kind: "close_reason", results }
}

// ---------------------------------------------------------------------------
// Tool 2: submit_decision — the terminal tool. A fresh gate is built per run so
// the latch is naturally run-scoped (the real system rebuilds its tools per run too).
// ---------------------------------------------------------------------------
export type DecisionResult =
  | { ok: true; committed: DecisionInput }
  | { ok: false; retryable: true; errors: string[] }

export const createDecisionGate = (org: Org) => {
  const goalsById = new Map(org.goals.map((g) => [g.id, g]))
  const tagIds = new Set(org.tags.map((t) => t.id))
  const closeReasonIds = new Set(org.closeReasons.map((c) => c.id))
  let committed: DecisionInput | null = null

  // Validate one action against its goal. Pushes a message per broken rule.
  const validateAction = (
    goal: NonNullable<ReturnType<typeof goalsById.get>>,
    action: DecisionInput["decisions"][number]["actions"][number],
    errors: string[],
  ) => {
    const at = `Goal ${goal.id}`
    if (!goal.allowedActions.includes(action.type)) {
      errors.push(`${at}: action ${action.type} not allowed. Allowed: ${goal.allowedActions.join(", ")}.`)
    }
    if (action.type === "DRAFT_REPLY" && !action.params?.text?.trim()) {
      errors.push(`${at}: DRAFT_REPLY needs params.text.`)
    }
    if (action.type === "ADD_TAG" && !tagIds.has(action.params?.tagId ?? "")) {
      errors.push(`${at}: tagId "${action.params?.tagId ?? "(missing)"}" is not a real tag — resolve it with search.`)
    }
    if (action.type === "CLOSE_ACTION_WITH_REASON" && !closeReasonIds.has(action.params?.closeReasonId ?? "")) {
      errors.push(
        `${at}: closeReasonId "${action.params?.closeReasonId ?? "(missing)"}" is not a real close reason — resolve it with search.`,
      )
    }
  }

  // Every rule for an 'act' decision: at least one goal block, each goal must be
  // real and carry actions, every action must validate, and — across all goals —
  // at most one reply-producing action per submission.
  const validateAct = (input: DecisionInput, errors: string[]) => {
    if (input.decisions.length === 0) errors.push("'act' requires at least one goal decision block.")

    let replyProducingCount = 0
    for (const d of input.decisions) {
      const goal = goalsById.get(d.goalId)
      if (!goal) {
        errors.push(`Unknown goalId "${d.goalId}".`)
        continue
      }
      if (d.actions.length === 0) errors.push(`Goal ${d.goalId}: 'act' needs at least one action.`)
      for (const action of d.actions) {
        if (REPLY_PRODUCING.includes(action.type)) replyProducingCount++
        validateAction(goal, action, errors)
      }
    }

    if (replyProducingCount > 1) {
      errors.push(`At most one reply-producing action per run (found ${replyProducingCount}).`)
    }
  }

  const submit = (input: DecisionInput): DecisionResult => {
    // LATCH: ignore duplicate submits, return the first committed decision.
    if (committed) return { ok: true, committed }

    const errors: string[] = []
    if (input.decision === "abstain") {
      // An abstain may carry no actions.
      if (input.decisions.some((d) => d.actions.length > 0)) errors.push("abstain must carry no actions.")
    } else {
      validateAct(input, errors)
    }

    if (errors.length > 0) return { ok: false, retryable: true, errors }

    committed = input
    return { ok: true, committed }
  }

  return { submit, result: () => committed }
}
