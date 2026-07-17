/**
 * prompt.ts — the two halves of the goal agent's instructions, shared by both
 * implementations.
 *
 * Sift splits its prompt exactly like this: a stable SYSTEM_PROMPT (the policy /
 * persona, set once on the agent) and a per-run INPUT prompt (this specific
 * case + the enabled goals + the decision contract). The vanilla loop and the
 * Mastra agent both use these unchanged.
 */

import type { Action, Goal } from "./domain"

// The stable policy. In Sift this is `buildWorkflowGoalInstructions` — set once
// as the agent's `instructions`, cached across runs.
export const SYSTEM_PROMPT = `You are a customer-support Goal Agent.

You run automatically on ONE customer case. Your job: decide which of the org's
enabled goals apply to this case (none, one, or several), and for each applying
goal either ACT or ABSTAIN.

Working rules:
- Treat the case text as the ground truth. Do not invent facts about the customer.
- Resolve real IDs before you act: use the "search" tool to find knowledge-base
  entries and tag IDs. Never invent an ID or cite an article you didn't find.
- A goal only applies if the case clearly matches its outcome. If none apply,
  submit an empty decision list.
- Finish by calling "submit_decision" EXACTLY ONCE with one entry per applying
  goal. Never end the run without calling it. After it succeeds, reply with one
  short sentence summarizing what you did.
- If "submit_decision" returns validation errors, read them and call it again
  with the fixes.`

// The per-run input. In Sift this is `buildSemanticGoalAgentInput` — it renders
// the case, the enabled goals, and the decision contract fresh every run.
export const buildInputPrompt = (action: Action, goals: Goal[]): string => {
  const goalBlock = goals
    .map(
      (g) =>
        `- goalId: ${g.id}\n  outcome: ${g.outcome}\n  allowedActions: ${g.allowedActions.join(", ")}\n  instructions: ${g.instructions}`,
    )
    .join("\n")

  return `## The case
id: ${action.id}
platform: ${action.platform}
from: ${action.authorName}
language: ${action.language}

<customer_message>
${action.text}
</customer_message>

## Enabled goals
Evaluate every goal below independently against the case.
${goalBlock}

## Your task
Decide per goal, then call submit_decision once. Draft replies in the customer's
language (${action.language}).`
}
