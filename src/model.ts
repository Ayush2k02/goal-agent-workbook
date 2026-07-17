/**
 * model.ts — the Gemini model, shared by both implementations.
 *
 * This mirrors how the real Sift goal agent resolves its model: the same
 * `@ai-sdk/google` provider, and the same key fallback
 * (`GEMINI_API_KEY ?? GOOGLE_GENERATIVE_AI_API_KEY`) with a hard throw if
 * neither is set. Both 01-vanilla.ts and 02-mastra.ts import `google` + `MODEL`
 * from here, so they run on the exact same model.
 *
 * The real agent pins `gemini-3.1-flash-lite` with a prompt-cache proxy and
 * `thinkingLevel: "minimal"`. We keep it simple: a widely-available flash model,
 * overridable via GEMINI_MODEL.
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google"

export const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash"

const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY
if (!apiKey) {
  throw new Error(
    "Set GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY) — get one at https://aistudio.google.com/apikey",
  )
}

export const google = createGoogleGenerativeAI({ apiKey })
