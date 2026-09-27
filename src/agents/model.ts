import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { env } from "@/config/env";

/**
 * Modelo configurável por ambiente. ANTHROPIC_BASE_URL permite usar qualquer gateway
 * compatível com a API da Anthropic sem mudar código.
 */
export function commerceModel(): LanguageModel {
  const { ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, AI_MODEL } = env();
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY não configurada (veja .env.example)");
  }
  const anthropic = createAnthropic({ apiKey: ANTHROPIC_API_KEY, baseURL: ANTHROPIC_BASE_URL });
  return anthropic(AI_MODEL);
}
