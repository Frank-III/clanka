import { OpenAiClient } from "@effect/ai-openai"
import { Layer } from "effect"
import { CODEX_API_BASE, CodexAuth } from "./CodexAuth.ts"

export const CodexAiClient = OpenAiClient.layer({
  apiUrl: CODEX_API_BASE,
}).pipe(Layer.provide(CodexAuth.layerClient))
