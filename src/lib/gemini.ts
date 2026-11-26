import type { Article, DraftFormat } from "./types";
import { GEMINI_ENDPOINT, GEMINI_MODEL } from "./types";
import type { ConnectionTestResult, GeneratePostResult, TokenUsage } from "./editorial";
import {
  AIProviderError,
  buildEditorialSystemPrompt,
  buildEditorialUserPrompt,
  checkSourceSufficiency,
  parseJsonObjectText,
  validatePostPayload,
} from "./editorial";

export { AIProviderError as GeminiError };
export type { AIErrorKind as GeminiErrorKind } from "./editorial";

type ApiErrorBody = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<{
      "@type"?: string;
      reason?: string;
      fieldViolations?: Array<{ field?: string; description?: string }>;
      retryDelay?: string;
    }>;
  };
};

export function isGeminiConfigured(key: string) {
  return Boolean(key && key.trim().length > 20);
}

function parseRetryDelayMs(
  details?: Array<{ "@type"?: string; retryDelay?: string }>
): number | undefined {
  if (!details) return undefined;
  for (const detail of details) {
    if (detail?.["@type"]?.includes("RetryInfo") && detail.retryDelay) {
      const match = detail.retryDelay.match(/([\d.]+)s/);
      if (match) return Math.ceil(Number(match[1]) * 1_000);
    }
  }
  return undefined;
}

/**
 * Классификация 429 Google Gemini по нескольким сигналам:
 * 1) machine-readable reason из error.details (RATE_LIMITED / RESOURCE_EXHAUSTED);
 * 2) error.status из тела ответа (RESOURCE_EXHAUSTED);
 * 3) текст сообщения как дополнительный сигнал дневной квоты.
 */
function classifyGemini429(
  apiMessage: string,
  reason: string,
  status: string
): { kind: "quota" | "rate_limit"; isDaily: boolean } {
  const reasonUpper = reason.toUpperCase();
  const statusUpper = status.toUpperCase();
  if (reasonUpper === "RATE_LIMITED" || statusUpper === "RESOURCE_EXHAUSTED") {
    const daily = /QUOTA|EXHAUSTED|DAILY|FREE.?TIER|BILLING/i.test(apiMessage);
    return { kind: daily ? "quota" : "rate_limit", isDaily: daily };
  }
  const daily = /quota|exhausted|per day|daily|free tier|billing/i.test(apiMessage);
  return { kind: daily ? "quota" : "rate_limit", isDaily: daily };
}

/**
 * Отправляет запрос на официальный endpoint gemini-3.1-flash-lite.
 * Контролируемый экспоненциальный backoff только для временных ошибок:
 * 5xx, сетевые сбои и таймауты.
 * Никаких повторов при 400, 401, 403, 404, блокировке или исчерпании дневной квоты.
 */
async function postGeminiGenerateContent(
  apiKey: string,
  payload: Record<string, unknown>,
  options: { timeout?: number; maxRetries?: number } = {}
) {
  if (!isGeminiConfigured(apiKey)) {
    throw new AIProviderError(
      "gemini",
      "no_key",
      "Сначала укажите API-ключ Google Gemini в разделе «Настройки»."
    );
  }

  const timeout = options.timeout ?? 75_000;
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = 1_000;
  const maxDelayMs = 30_000;

  let attempt = 0;
  let lastError: AIProviderError | null = null;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response: Response;

    try {
      response = await fetch(GEMINI_ENDPOINT, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey.trim(),
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof DOMException && error.name === "AbortError") {
        lastError = new AIProviderError(
          "gemini",
          "timeout",
          "Превышено время ожидания ответа от Google Gemini. Попробуйте повторить запрос.",
          { technical: "Таймаут запроса", retryable: true }
        );
      } else {
        lastError = new AIProviderError(
          "gemini",
          "network",
          "Не удалось подключиться к Google Gemini. Проверьте интернет-соединение и попробуйте снова.",
          { technical: "Сетевая ошибка", retryable: true }
        );
      }
      if (attempt < maxRetries) {
        attempt += 1;
        const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt) + Math.random() * 600);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw lastError;
    }

    clearTimeout(timer);

    if (!response.ok) {
      let body: ApiErrorBody = {};
      try {
        body = (await response.json()) as ApiErrorBody;
      } catch {
        body = {};
      }
      const apiMessage = body.error?.message || `HTTP ${response.status}`;
      const reason = body.error?.details?.find((d) => d.reason)?.reason || "";
      const statusField = body.error?.status || "";
      const retryDelayMs = parseRetryDelayMs(body.error?.details);
      const technicalBits = [
        `HTTP ${response.status}`,
        [reason, statusField].filter(Boolean).join(" · "),
      ].filter(Boolean);
      const technical = technicalBits.join(" · ");
      const httpStatus = response.status;

      if (httpStatus === 400 && /api[_\s-]?key|api_key_invalid/i.test(apiMessage)) {
        throw new AIProviderError(
          "gemini",
          "invalid_key",
          "Google Gemini отклонил API-ключ. Проверьте, что ключ скопирован полностью и активен в Google AI Studio.",
          { technical, httpStatus, retryable: false }
        );
      }
      if (httpStatus === 401) {
        throw new AIProviderError(
          "gemini",
          "invalid_key",
          "Неверный API-ключ Google Gemini (HTTP 401). Проверьте ключ в Google AI Studio.",
          { technical, httpStatus, retryable: false }
        );
      }
      if (httpStatus === 403) {
        throw new AIProviderError(
          "gemini",
          "forbidden",
          "Нет доступа к Google Gemini с этим ключом (HTTP 403). Проверьте права ключа и настройки проекта в Google AI Studio.",
          { technical, httpStatus, retryable: false }
        );
      }
      if (httpStatus === 404) {
        throw new AIProviderError(
          "gemini",
          "model_unavailable",
          `Модель ${GEMINI_MODEL} сейчас недоступна для этого ключа или проекта Google Gemini. Автоматическое переключение не выполняется.`,
          { technical, httpStatus, retryable: false }
        );
      }
      if (httpStatus === 429) {
        const { kind, isDaily } = classifyGemini429(apiMessage, reason, statusField);
        if (!isDaily && retryDelayMs !== undefined && retryDelayMs <= 12_000 && attempt < maxRetries) {
          attempt += 1;
          await new Promise((r) => setTimeout(r, retryDelayMs + Math.random() * 400));
          continue;
        }
        throw new AIProviderError(
          "gemini",
          kind,
          isDaily
            ? "Достигнут лимит квоты Google Gemini. Запрос остановлен, повторные попытки не выполняются. Дождитесь обновления квоты в Google AI Studio."
            : "Превышена частота запросов к Google Gemini (HTTP 429). Подождите немного и повторите попытку вручную.",
          {
            technical,
            httpStatus,
            retryable: !isDaily,
            retryAfterMs: retryDelayMs,
          }
        );
      }
      if (httpStatus >= 500) {
        lastError = new AIProviderError(
          "gemini",
          "server",
          "Сервер Google Gemini временно недоступен. Попробуйте повторить позже — ваши новости и черновики в сохранности.",
          { technical, httpStatus, retryable: true }
        );
        if (attempt < maxRetries) {
          attempt += 1;
          const delay = Math.min(
            maxDelayMs,
            baseDelayMs * Math.pow(2, attempt) + Math.random() * 600
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw lastError;
      }
      if (httpStatus === 400) {
        throw new AIProviderError(
          "gemini",
          "invalid_response",
          "Google Gemini отклонил запрос (HTTP 400). Возможно, текст статьи слишком длинный или содержит неподдерживаемые данные.",
          { technical, httpStatus, retryable: false }
        );
      }
      throw new AIProviderError(
        "gemini",
        "unknown",
        `Запрос к Google Gemini завершился с ошибкой (HTTP ${httpStatus}). Попробуйте позже.`,
        { technical, httpStatus, retryable: false }
      );
    }

    return response;
  }

  throw (
    lastError ||
    new AIProviderError(
      "gemini",
      "unknown",
      "Не удалось выполнить запрос к Google Gemini после нескольких попыток.",
      { retryable: true }
    )
  );
}

/**
 * Проверка подключения к Google Gemini (gemini-3.1-flash-lite).
 * Вызывается исключительно по нажатию пользователем кнопки «Проверить подключение».
 */
export async function testGeminiConnection(apiKey: string): Promise<ConnectionTestResult> {
  const started = performance.now();
  const response = await postGeminiGenerateContent(
    apiKey,
    {
      contents: [{ role: "user", parts: [{ text: "Ответь одним словом: OK" }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 16 },
    },
    { timeout: 30_000, maxRetries: 1 }
  );
  let data: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    throw new AIProviderError(
      "gemini",
      "invalid_response",
      "Не удалось прочитать ответ Google Gemini при проверке подключения."
    );
  }
  const text = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!text) {
    throw new AIProviderError(
      "gemini",
      "invalid_response",
      "Соединение с Google Gemini установлено, но модель вернула пустой ответ."
    );
  }
  return {
    provider: "gemini",
    latencyMs: Math.round(performance.now() - started),
    model: GEMINI_MODEL,
    usage: {
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
      totalTokens: data.usageMetadata?.totalTokenCount,
    },
  };
}

const GEMINI_SINGLE_POST_SCHEMA = {
  type: "OBJECT",
  properties: {
    status: { type: "STRING", enum: ["ok", "insufficient_source", "needs_review", "error"] },
    post: { type: "STRING" },
    char_count: { type: "INTEGER" },
    key_facts: { type: "ARRAY", items: { type: "STRING" } },
    warnings: { type: "ARRAY", items: { type: "STRING" } },
    source_sufficiency: { type: "STRING", enum: ["sufficient", "partial", "insufficient"] },
  },
  required: ["status", "post", "char_count", "key_facts", "warnings", "source_sufficiency"],
};

function extractGeminiCandidateText(data: unknown): {
  text: string;
  usage: TokenUsage;
  responseId?: string;
  finishReason?: string;
} {
  const response = data as {
    candidates?: Array<{
      finishReason?: string;
      finishMessage?: string;
      content?: { parts?: Array<{ text?: string }> };
    }>;
    promptFeedback?: { blockReason?: string };
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
    responseId?: string;
  };

  const usage: TokenUsage = {
    inputTokens: response.usageMetadata?.promptTokenCount,
    outputTokens: response.usageMetadata?.candidatesTokenCount,
    totalTokens: response.usageMetadata?.totalTokenCount,
  };

  if (response.promptFeedback?.blockReason) {
    throw new AIProviderError(
      "gemini",
      "blocked",
      "Запрос заблокирован фильтрами безопасности Google Gemini. Подготовьте пост вручную.",
      {
        technical: response.promptFeedback.blockReason,
        promptFeedback: response.promptFeedback.blockReason,
        retryable: false,
      }
    );
  }

  const candidate = response.candidates?.[0];
  if (!candidate) {
    throw new AIProviderError(
      "gemini",
      "invalid_response",
      "Google Gemini вернул пустой список кандидатов. Попробуйте повторить запрос.",
      { retryable: true }
    );
  }

  const finishDetail = candidate.finishMessage
    ? `finishReason=${candidate.finishReason || "unknown"} · ${candidate.finishMessage}`
    : candidate.finishReason
      ? `finishReason=${candidate.finishReason}`
      : undefined;

  if (candidate.finishReason === "SAFETY") {
    throw new AIProviderError(
      "gemini",
      "blocked",
      "Ответ заблокирован фильтрами безопасности Google Gemini. Подготовьте пост вручную.",
      { finishReason: "SAFETY", technical: finishDetail, retryable: false }
    );
  }
  if (candidate.finishReason === "MAX_TOKENS") {
    throw new AIProviderError(
      "gemini",
      "max_tokens",
      "Ответ Google Gemini оборвался из-за лимита токенов. Попробуйте повторить запрос.",
      { finishReason: "MAX_TOKENS", technical: finishDetail, retryable: true }
    );
  }
  if (candidate.finishReason === "RECITATION") {
    throw new AIProviderError(
      "gemini",
      "recitation",
      "Google Gemini отклонил запрос из-за правил цитирования. Подготовьте пост вручную.",
      { finishReason: "RECITATION", technical: finishDetail, retryable: false }
    );
  }
  if (candidate.finishReason === "BLOCKLIST") {
    throw new AIProviderError(
      "gemini",
      "blocked",
      "Ответ Google Gemini заблокирован из-за содержимого статьи. Подготовьте пост вручную.",
      { finishReason: "BLOCKLIST", technical: finishDetail, retryable: false }
    );
  }
  if (candidate.finishReason && candidate.finishReason !== "STOP") {
    throw new AIProviderError(
      "gemini",
      "invalid_response",
      "Ответ Google Gemini не завершён штатно. Попробуйте повторить запрос.",
      { finishReason: candidate.finishReason, technical: finishDetail, retryable: true }
    );
  }

  const text = candidate.content?.parts?.map((part) => part.text || "").join("").trim() || "";
  if (!text) {
    throw new AIProviderError(
      "gemini",
      "invalid_response",
      "Google Gemini вернул пустой текст. Попробуйте повторить запрос.",
      { retryable: true }
    );
  }

  return {
    text,
    usage,
    responseId: response.responseId,
    finishReason: candidate.finishReason,
  };
}

export async function generateGeminiPost(
  format: DraftFormat,
  options: { apiKey: string; article: Article }
): Promise<GeneratePostResult> {
  const { apiKey, article } = options;

  const insufficient = checkSourceSufficiency(article, format, "gemini", GEMINI_MODEL);
  if (insufficient) return insufficient;

  const maxTokens = format === "short" ? 1_000 : 1_600;

  const makePayload = (isRetry: boolean) => ({
    systemInstruction: {
      parts: [{ text: buildEditorialSystemPrompt(format) }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: buildEditorialUserPrompt(article, format, isRetry, 24_000) }],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      topP: 0.9,
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json",
      responseSchema: GEMINI_SINGLE_POST_SCHEMA,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
    ],
  });

  const started = performance.now();
  let lastError: AIProviderError | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await postGeminiGenerateContent(apiKey, makePayload(attempt > 0), {
      timeout: 75_000,
      maxRetries: 2,
    });
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      lastError = new AIProviderError(
        "gemini",
        "invalid_response",
        "Не удалось прочитать ответ от Google Gemini.",
        { retryable: true }
      );
      continue;
    }

    let extracted: ReturnType<typeof extractGeminiCandidateText>;
    try {
      extracted = extractGeminiCandidateText(data);
    } catch (error) {
      if (
        error instanceof AIProviderError &&
        (error.kind === "blocked" || error.kind === "recitation")
      ) {
        throw error;
      }
      lastError =
        error instanceof AIProviderError
          ? error
          : new AIProviderError(
              "gemini",
              "invalid_response",
              "Не удалось обработать ответ Google Gemini.",
              { retryable: true }
            );
      continue;
    }

    try {
      const parsed = parseJsonObjectText(extracted.text, "gemini");
      const validated = validatePostPayload(parsed, format, "gemini");
      return {
        ...validated,
        provider: "gemini",
        format,
        model: GEMINI_MODEL,
        latencyMs: Math.round(performance.now() - started),
        usage: extracted.usage,
        responseId: extracted.responseId,
      };
    } catch (error) {
      if (error instanceof AIProviderError && error.kind === "invalid_response") {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw (
    lastError ||
    new AIProviderError(
      "gemini",
      "invalid_response",
      "Google Gemini дважды вернул некорректный ответ. Черновик не сохранён — попробуйте позже.",
      { retryable: true }
    )
  );
}
