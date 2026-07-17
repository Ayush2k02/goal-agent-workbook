/**
 * eligibility.ts — the pre-invocation gate.
 *
 * Before the goal agent is invoked at all, Sift's trigger decides whether it
 * SHOULD run (semantic-goal-agent-trigger.ts → evaluateGoalAgentEligibility).
 * If not, the model is never called — no tokens, no decision.
 *
 * We model two of the real skip reasons (the real gate has more):
 *   - action_closed          → terminal status; never (re)process a closed action
 *   - already_ran_for_action → once-per-action; the agent already decided here
 *
 * This runs in the RUNNERS, before the agent — so the invocation is skipped
 * entirely, exactly like production.
 */

import type { Action, IneligibleReason } from "./data.store"

export type Eligibility = { eligible: true } | { eligible: false; reason: IneligibleReason }

export const evaluateEligibility = (action: Action): Eligibility => {
  if (action.operationStatus === "CLOSED") return { eligible: false, reason: "action_closed" }
  if (action.priorGoalDecision === true) return { eligible: false, reason: "already_ran_for_action" }
  return { eligible: true }
}
