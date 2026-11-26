import type { AIProvider, Article, DraftFormat } from "./types";
import { GEMINI_MODEL } from "./types";
import type { ConnectionTestResult, GeneratePostResult } from "./editorial";
import { AIProviderError, errorKindBadgeLabel } from "./editorial";
import { generateGeminiPost, isGeminiConfigured, testGeminiConnection } from "./gemini";
import { generateGroqPost, isGroqConfigured, testGroqConnection } from "./groq";

export { AIProviderError, errorKindBadgeLabel };
export type {
  AIErrorKind,
  ConnectionTestResult,
  GeneratePostResult,
  StructuredOutputMode,
  TokenUsage,
} from "./editorial";

export interface DispatchedGenerateOptions {
  provider: AIProvider;
  apiKey: string;
  model: string;
  article: Article;
}

export function isProviderKeyConfigured(provider: AIProvider, key: string): boolean {
  return provider === "groq" ? isGroqConfigured(key) : isGeminiConfigured(key);
}

/**
 * Проверка подключения к выбранному провайдеру.
 * Выполняется только по явному нажатию пользователем кнопки «Проверить подключение».
 */
export function testProviderConnection(options: {
  provider: AIProvider;
  apiKey: string;
  model: string;
}): Promise<ConnectionTestResult> {
  if (options.provider === "groq") {
    return testGroqConnection(options.apiKey, options.model);
  }
  return testGeminiConnection(options.apiKey);
}

function dispatchSinglePost(
  format: DraftFormat,
  options: DispatchedGenerateOptions
): Promise<GeneratePostResult> {
  if (options.provider === "groq") {
    return generateGroqPost(format, {
      apiKey: options.apiKey,
      model: options.model,
      article: options.article,
    });
  }
  return generateGeminiPost(format, {
    apiKey: options.apiKey,
    article: options.article,
  });
}

/**
 * Генерирует исключительно короткий пост для X (1–2 предложения, ~200–280 символов)
 * через выбранного пользователем провайдера (Google Gemini или Groq).
 * Никакого автоматического переключения между провайдерами нет.
 */
export function generateShortPost(
  options: DispatchedGenerateOptions
): Promise<GeneratePostResult> {
  return dispatchSinglePost("short", {
    ...options,
    model: options.provider === "gemini" ? GEMINI_MODEL : options.model,
  });
}

/**
 * Генерирует исключительно расширенный пост для X (3–5 предложений, ~450–550 символов)
 * через выбранного пользователем провайдера (Google Gemini или Groq).
 * Никакого автоматического переключения между провайдерами нет.
 */
export function generateLongPost(
  options: DispatchedGenerateOptions
): Promise<GeneratePostResult> {
  return dispatchSinglePost("long", {
    ...options,
    model: options.provider === "gemini" ? GEMINI_MODEL : options.model,
  });
}
