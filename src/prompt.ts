/**
 * prompt.ts — the two halves of the goal agent's instructions.
 *
 * Sift splits its prompt like this: a stable SYSTEM_PROMPT (policy, set once on
 * the agent) and a per-run INPUT prompt (this case + enabled goals + the
 * decision contract). The per-run input renders the four ACTION-CONTEXT blocks
 * (known facts / current thread / internal notes / customer timeline) that
 * Sift's `getActionContext` produces.
 */

import type { Action, Goal, Org } from "./data.store"

export const SYSTEM_PROMPT = `You are a customer-support Goal Agent.

You run automatically on ONE case. Decide which of the org's enabled goals apply
(none, one, or several), and for each applying goal either ACT or ABSTAIN.

Rules:
- Treat the ACTION-CONTEXT blocks as ground truth. Do not invent facts.
- A goal only applies if the case clearly matches its outcome, and you may only
  take actions listed in that goal's allowedActions.
- Resolve real IDs before acting: use "search" to find tag and close-reason IDs.
  Never invent an ID.
- At most ONE reply-producing action (DRAFT_REPLY) across the whole decision. If
  two goals both call for a reply, pick the single best-fitting goal and draft
  once — do not emit the same reply under multiple goals.
- Never promise or imply a refund, credit, or reversal.
- If no goal applies, submit decision "abstain" with empty decisions.
- Finish by calling "submit_decision" EXACTLY ONCE. If it returns validation
  errors, read them and call it again with fixes. After it succeeds, reply with
  one short audit sentence.`

const renderActionContext = (action: Action): string => {
  const thread = action.thread
    .map((m, i) => `  ${i + 1}. ${m.author} · ${m.at} · ${action.platform}\n     ${m.text}`)
    .join("\n")
  return [
    `### What we already know\n${action.knownFacts ?? "No prior facts on file."}`,
    `### Current action ${action.id} (#${action.easyId})\nStatus: ${action.operationStatus} · Platform: ${action.platform} · Customer: ${action.customerHandle}\nThread:\n${thread}`,
    `### Internal notes\n${action.internalNotes ?? "No internal notes."}`,
    `### Customer timeline\n${action.customerTimeline ?? "No prior cases."}`,
  ].join("\n\n")
}

export const buildInputPrompt = (action: Action, org: Org, goals: Goal[]): string => {
  const goalBlock = goals
    .map(
      (g) =>
        `- goalId: ${g.id}\n  name: ${g.name}\n  outcome: ${g.outcome}\n  allowedActions: ${g.allowedActions.join(", ")}\n  reviewPolicy: ${g.reviewPolicy}\n  instructions: ${g.instructions}`,
    )
    .join("\n")

  return `# Org: ${org.displayName}

## ACTION-CONTEXT
${renderActionContext(action)}

## Enabled goals
Evaluate every goal independently against this case.
${goalBlock}

## Your task
Decide per goal, then call submit_decision once. Draft any reply in the
customer's language.`
}
