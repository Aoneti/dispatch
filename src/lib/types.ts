export type PageKey = "inbox" | "sources" | "drafts" | "settings";

export type AIProvider = "gemini" | "groq";

export type GroqModelId = "openai/gpt-oss-120b" | "openai/gpt-oss-20b";

export interface GroqModelOption {
  id: GroqModelId;
  label: string;
  description: string;
}

export type SourceStatus = "ok" | "error" | "syncing" | "unknown";

export type ExtractionStatus =
  | "full"
  | "partial"
  | "insufficient"
  | "failed"
  | "not_extracted";

export interface Source {
  id: string;
  name: string;
  url: string;
  siteUrl: string;
  enabled: boolean;
  createdAt: number;
  lastSyncAt: number | null;
  lastError: string | null;
  status: SourceStatus;
  articleCount: number;
  /** Число статей в самой последней полученной странице RSS (до дедупликации). */
  feedItemCount?: number;
  /** Ссылка на более старую страницу ленты (RFC 5005: next / prev-archive), если издатель её отдаёт. */
  nextOlderPage?: string;
  etag?: string;
  lastModified?: string;
}

export interface Article {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  url: string;
  guid: string;
  author: string;
  publishedAt: number;
  fetchedAt: number;
  excerpt: string;
  contentHtml: string;
  contentText: string;
  extraction: ExtractionStatus;
  extractionNote?: string;
  charCount: number;
  /** null — статья не прочитана; timestamp — дата прочтения. */
  readAt: number | null;
  /** null — статья не сохранена; timestamp — дата сохранения. */
  savedAt: number | null;
  /** Стабильная позиция в исходной ленте, используется если дата публикации неизвестна. */
  feedOrder: number;
}

export type DraftFormat = "short" | "long";
export type DraftStatus = "ok" | "needs_review" | "insufficient_source";
export type SourceSufficiency = "sufficient" | "partial" | "insufficient";

export interface Draft {
  id: string;
  articleId: string;
  articleTitle: string;
  sourceName: string;
  sourceUrl: string;
  createdAt: number;
  updatedAt: number;
  provider: AIProvider;
  model: string;
  format: DraftFormat;
  originalText: string;
  text: string;
  warnings: string[];
  keyFacts: string[];
  sufficiency: SourceSufficiency;
  status: DraftStatus;
  edited: boolean;
}

export type ThemeMode = "light" | "dark" | "system";

/** Локальная статистика использования одного AI-провайдера. */
export interface AIUsageStats {
  requests: number;
  successful: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastRequestAt: number | null;
  lastErrorAt: number | null;
  lastErrorKind: string | null;
  /** Краткая техника последнего сбоя, например «429 · RESOURCE_EXHAUSTED». */
  lastErrorDetail: string | null;
}

export type GeminiUsageStats = AIUsageStats;

export interface Settings {
  /** Активный провайдер генерации. Для существующих пользователей по умолчанию остаётся "gemini". */
  activeProvider: AIProvider;
  /** API-ключ исключительно для Google Gemini (хранится отдельно под dispatch.gemini.key.v1). */
  apiKey: string;
  /** Фиксированная модель Google Gemini. */
  model: string;
  /** API-ключ исключительно для Groq (хранится отдельно под dispatch.groq.key.v1). */
  groqApiKey: string;
  /** Выбранная пользователем модель Groq. */
  groqModel: GroqModelId;
  theme: ThemeMode;
  /** Подтверждение передачи текста статьи в Google Gemini. */
  privacyAcknowledged: boolean;
  /** Отдельное подтверждение передачи текста статьи в Groq. */
  groqPrivacyAcknowledged: boolean;
  /** Отмечать статью прочитанной при открытии (по умолчанию включено). */
  autoMarkRead: boolean;
  /** Включить ручную очистку старых прочитанных статей (по умолчанию выключено). */
  autoCleanupEnabled: boolean;
  /** Срок хранения прочитанных статей в днях при включённой очистке. */
  retentionDays: number;
  /** Интервал фонового обновления RSS-лент в минутах. */
  syncMinutes: number;
  /** Время последней успешной проверки соединения Google Gemini. */
  lastTestedAt: number | null;
  /** Время последней успешной проверки соединения Groq. */
  groqLastTestedAt: number | null;
  /** Идентификатор модели Groq, для которой успешно прошла последняя проверка соединения. */
  groqTestedModel: string | null;
  lastSyncAllAt: number | null;
  geminiUsage: AIUsageStats;
  groqUsage: AIUsageStats;
}

export interface WorkspaceData {
  schemaVersion: number;
  sources: Source[];
  articles: Article[];
  drafts: Draft[];
  settings: Settings;
}

export interface ParsedFeedItem {
  title: string;
  link: string;
  guid: string;
  publishedAt: number;
  author: string;
  excerpt: string;
  contentHtml: string;
  contentText: string;
}

export interface ParsedFeed {
  title: string;
  siteUrl: string;
  description: string;
  items: ParsedFeedItem[];
  format: "rss" | "atom";
  /** Фактическое число публикаций в полученной странице ленты (до дедупликации). */
  totalItems: number;
  /** URL следующей более старой страницы, если лента поддерживает пагинацию (RFC 5005). */
  nextOlderPage: string | null;
}

export type GeminiGeneratedStatus =
  | "ok"
  | "insufficient_source"
  | "needs_review"
  | "error";

export interface GeminiPostPayload {
  status: GeminiGeneratedStatus;
  post: string;
  char_count: number;
  key_facts: string[];
  warnings: string[];
  source_sufficiency: SourceSufficiency;
}

export type AIPostPayload = GeminiPostPayload;

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  variant: "success" | "error" | "info" | "warning";
  /** Необязательное действие в уведомлении (например, «Отменить»). */
  action?: { label: string; onClick: () => void };
}

/** Результат массовой операции для Undo. */
export interface MassChangeUndo {
  label: string;
  changedIds: Array<{ id: string; readAt: number | null; savedAt: number | null }>;
}

export const AI_PROVIDER_LABELS: Record<AIProvider, string> = {
  gemini: "Google Gemini",
  groq: "Groq",
};

export const GEMINI_MODEL = "gemini-3.1-flash-lite";
export const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent";

export const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

/** Централизованная конфигурация поддерживаемых моделей Groq (Structured Outputs strict: true). */
export const GROQ_MODELS: readonly GroqModelOption[] = [
  {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    description: "Основная модель, приоритет качества",
  },
  {
    id: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B",
    description: "Более быстрая альтернатива",
  },
] as const;

export const DEFAULT_GROQ_MODEL: GroqModelId = "openai/gpt-oss-120b";

export function isValidGroqModel(value: unknown): value is GroqModelId {
  return typeof value === "string" && GROQ_MODELS.some((m) => m.id === value);
}

export const DEFAULT_SYNC_MINUTES = 30;
export const FEED_CONCURRENCY = 3;
export const SCHEMA_VERSION = 4;
/** Разумный лимит количества публикаций, загружаемых из одной страницы ленты. */
export const FEED_FETCH_MAX_ITEMS = 500;
/** Сколько старых страниц можно запросить за одну ручную операцию. */
export const FEED_OLDER_PAGES_LIMIT = 3;

export const DEFAULT_AI_USAGE: AIUsageStats = {
  requests: 0,
  successful: 0,
  errors: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  lastRequestAt: null,
  lastErrorAt: null,
  lastErrorKind: null,
  lastErrorDetail: null,
};

export const DEFAULT_GEMINI_USAGE: AIUsageStats = { ...DEFAULT_AI_USAGE };

export const DEFAULT_SETTINGS: Settings = {
  activeProvider: "gemini",
  apiKey: "",
  model: GEMINI_MODEL,
  groqApiKey: "",
  groqModel: DEFAULT_GROQ_MODEL,
  theme: "light",
  privacyAcknowledged: false,
  groqPrivacyAcknowledged: false,
  autoMarkRead: true,
  autoCleanupEnabled: false,
  retentionDays: 30,
  syncMinutes: 30,
  lastTestedAt: null,
  groqLastTestedAt: null,
  groqTestedModel: null,
  lastSyncAllAt: null,
  geminiUsage: { ...DEFAULT_AI_USAGE },
  groqUsage: { ...DEFAULT_AI_USAGE },
};

/**
 * Точные идентификаторы демонстрационных записей из версии 1.
 * Используются только для безопасной миграции: удаляются ровно эти записи,
 * пользовательские источники, статьи и черновики полностью сохраняются.
 */
export const LEGACY_SEED_SOURCE_IDS = new Set<string>([
  "src-rbc",
  "src-kommersant",
  "src-bell",
  "src-vedomosti",
  "src-meduza",
  "src-habr",
  "src-tass",
  "src-guardian",
]);

export const LEGACY_SEED_ARTICLE_IDS = new Set<string>([
  "art-cbr-rate",
  "art-yandex-cloud",
  "art-mintsifry",
  "art-eu-package",
  "art-ma-market",
  "art-rust",
  "art-dividends",
  "art-local-brands",
  "art-aviation",
  "art-ocean",
  "art-llm-cost",
  "art-mortgage",
  "art-labour",
]);

export const LEGACY_SEED_DRAFT_IDS = new Set<string>([
  "draft-cbr",
  "draft-yandex",
  "draft-eu",
]);
