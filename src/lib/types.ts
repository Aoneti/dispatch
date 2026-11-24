export type PageKey = "inbox" | "sources" | "drafts" | "settings";

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

export interface Settings {
  apiKey: string;
  model: string;
  theme: ThemeMode;
  privacyAcknowledged: boolean;
  lastTestedAt: number | null;
  lastSyncAllAt: number | null;
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

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  variant: "success" | "error" | "info" | "warning";
}

export const GEMINI_MODEL = "gemini-3.1-flash-lite";
export const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent";

export const DEFAULT_SYNC_MINUTES = 30;
export const FEED_CONCURRENCY = 3;
export const SCHEMA_VERSION = 2;

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  model: GEMINI_MODEL,
  theme: "light",
  privacyAcknowledged: false,
  lastTestedAt: null,
  lastSyncAllAt: null,
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
