/**
 * eligibility.ts — the pre-invocation gate.
 *
 * Before the goal agent is invoked at all, the production trigger decides whether it
 * SHOULD run (semantic-goal-agent-trigger.ts → evaluateGoalAgentEligibility).
 * If not, the model is never called — no tokens, no decision.
 *
 * We model 7 of the real skip reasons, in roughly the real order. The 8th,
 * `no_matching_goals`, needs saved-search SCOPE resolution and is left out.
 */

import type { Action, IneligibleReason, Org } from "./data.store"

/** Runaway backstop — the real GOAL_AGENT_HARD_TURN_CAP. */
export const HARD_TURN_CAP = 25

export type Eligibility = { eligible: true } | { eligible: false; reason: IneligibleReason }

export const evaluateEligibility = (action: Action | undefined, org: Org | undefined): Eligibility => {
  if (!action || !org) return { eligible: false, reason: "action_not_found" }
  if (action.operationStatus === "CLOSED") return { eligible: false, reason: "action_closed" }
  if (action.hiddenByModeration === true) return { eligible: false, reason: "hidden_moderated" }
  if (org.isInternal === true) return { eligible: false, reason: "internal_org" }
  if (org.goals.length === 0) return { eligible: false, reason: "no_enabled_goals" }
  if (action.priorGoalDecision === true) return { eligible: false, reason: "already_ran_for_action" }
  if ((action.priorRunCount ?? 0) >= HARD_TURN_CAP) return { eligible: false, reason: "turn_cap_reached" }
  return { eligible: true }
}
