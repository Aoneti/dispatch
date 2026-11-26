import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  articleDedupeKeys,
  FeedError,
  feedItemToArticle,
  runWithConcurrency,
  syncOlderPages,
  syncSourceFeed,
} from "./feeds";
import { createEmptyWorkspace } from "./seed";
import { readWorkspaceRecord, writeWorkspaceRecord } from "./db";
import { ensureHostAccess } from "./permissions";
import type {
  AIProvider,
  AIUsageStats,
  Article,
  Draft,
  DraftFormat,
  DraftStatus,
  ExtractionStatus,
  MassChangeUndo,
  ParsedFeed,
  Settings,
  Source,
  SourceSufficiency,
  ThemeMode,
  ToastMessage,
  WorkspaceData,
} from "./types";
import {
  AI_PROVIDER_LABELS,
  DEFAULT_GROQ_MODEL,
  DEFAULT_SETTINGS,
  FEED_CONCURRENCY,
  GEMINI_MODEL,
  isValidGroqModel,
  LEGACY_SEED_ARTICLE_IDS,
  LEGACY_SEED_DRAFT_IDS,
  LEGACY_SEED_SOURCE_IDS,
  SCHEMA_VERSION,
} from "./types";
import { charCount, pluralRu, sanitizeHtml, uid } from "./utils";

const WORKSPACE_KEY = "dispatch.workspace.v1";
const WORKSPACE_SAVED_AT_KEY = "dispatch.workspace.savedAt.v1";

const GEMINI_API_KEY_STORAGE = "dispatch.gemini.key.v1";
const GEMINI_CHROME_STORAGE_KEY = "dispatchGeminiKeyV1";

const GROQ_API_KEY_STORAGE = "dispatch.groq.key.v1";
const GROQ_CHROME_STORAGE_KEY = "dispatchGroqKeyV1";

type ChromeLocalStorage = {
  get: (keys: string | string[]) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove?: (keys: string | string[]) => Promise<void>;
};

function extensionStorage(): ChromeLocalStorage | null {
  const chromeApi = (globalThis as unknown as { chrome?: { storage?: { local?: ChromeLocalStorage } } }).chrome;
  return chromeApi?.storage?.local ?? null;
}

function loadGeminiApiKey(): string {
  try {
    return localStorage.getItem(GEMINI_API_KEY_STORAGE) || "";
  } catch {
    return "";
  }
}

function persistGeminiApiKey(key: string) {
  try {
    if (key) localStorage.setItem(GEMINI_API_KEY_STORAGE, key);
    else localStorage.removeItem(GEMINI_API_KEY_STORAGE);
  } catch {
    // Если localStorage недоступен, ключ останется в памяти до закрытия вкладки.
  }
  try {
    const local = extensionStorage();
    if (local) {
      if (key) {
        void local.set({ [GEMINI_CHROME_STORAGE_KEY]: key }).catch(() => undefined);
      } else if (local.remove) {
        void local.remove(GEMINI_CHROME_STORAGE_KEY).catch(() => undefined);
      } else {
        void local.set({ [GEMINI_CHROME_STORAGE_KEY]: "" }).catch(() => undefined);
      }
    }
  } catch {
    // Вне расширения chrome.storage.local отсутствует.
  }
}

function loadGroqApiKey(): string {
  try {
    return localStorage.getItem(GROQ_API_KEY_STORAGE) || "";
  } catch {
    return "";
  }
}

function persistGroqApiKey(key: string) {
  try {
    if (key) localStorage.setItem(GROQ_API_KEY_STORAGE, key);
    else localStorage.removeItem(GROQ_API_KEY_STORAGE);
  } catch {
    // Если localStorage недоступен, ключ останется в памяти до закрытия вкладки.
  }
  try {
    const local = extensionStorage();
    if (local) {
      if (key) {
        void local.set({ [GROQ_CHROME_STORAGE_KEY]: key }).catch(() => undefined);
      } else if (local.remove) {
        void local.remove(GROQ_CHROME_STORAGE_KEY).catch(() => undefined);
      } else {
        void local.set({ [GROQ_CHROME_STORAGE_KEY]: "" }).catch(() => undefined);
      }
    }
  } catch {
    // Вне расширения chrome.storage.local отсутствует.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown, limit = 10): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeStatus(raw: unknown): DraftStatus {
  if (raw === "ok" || raw === "needs_review" || raw === "insufficient_source") return raw;
  return "needs_review";
}

function normalizeSufficiency(raw: unknown): SourceSufficiency {
  if (raw === "sufficient" || raw === "partial" || raw === "insufficient") return raw;
  return "partial";
}

function normalizeExtraction(raw: unknown): ExtractionStatus {
  if (
    raw === "full" ||
    raw === "partial" ||
    raw === "insufficient" ||
    raw === "failed" ||
    raw === "not_extracted"
  ) {
    return raw;
  }
  return "partial";
}

function normalizeTheme(raw: unknown): ThemeMode {
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "light";
}

function normalizeProvider(raw: unknown): AIProvider {
  if (raw === "groq" || raw === "gemini") return raw;
  return "gemini";
}

function normalizeUsageStats(raw: unknown): AIUsageStats {
  const obj = isRecord(raw) ? raw : {};
  return {
    requests: Number(obj.requests) || 0,
    successful: Number(obj.successful) || 0,
    errors: Number(obj.errors) || 0,
    inputTokens: Number(obj.inputTokens) || 0,
    outputTokens: Number(obj.outputTokens) || 0,
    totalTokens: Number(obj.totalTokens) || 0,
    lastRequestAt: typeof obj.lastRequestAt === "number" ? obj.lastRequestAt : null,
    lastErrorAt: typeof obj.lastErrorAt === "number" ? obj.lastErrorAt : null,
    lastErrorKind: typeof obj.lastErrorKind === "string" ? obj.lastErrorKind : null,
    lastErrorDetail: typeof obj.lastErrorDetail === "string" ? obj.lastErrorDetail : null,
  };
}

/**
 * Безопасная миграция данных рабочего пространства к схеме v2:
 * 1. Удаляет строго известные демонстрационные источники, статьи и черновики v1.
 * 2. Полностью сохраняет все пользовательские RSS-источники, статьи и черновики.
 * 3. Разделяет пользовательские черновики старого формата (shortPost + longPost)
 *    на две независимые записи с сохранением всех ручных правок.
 * 4. Сохраняет API-ключ, тему оформления и подтверждение передачи данных.
 */
export function migrateWorkspaceData(
  raw: unknown,
  options: { preserveApiKey?: boolean; isImport?: boolean } = {}
): { data: WorkspaceData; migrated: boolean } | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw.sources) || !Array.isArray(raw.articles) || !Array.isArray(raw.drafts)) {
    return null;
  }

  const prevVersion = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 1;
  let migrated = prevVersion < SCHEMA_VERSION;

  const sourceIds = new Set<string>();
  const sources: Source[] = [];
  for (const item of raw.sources) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.url !== "string") continue;
    if (LEGACY_SEED_SOURCE_IDS.has(item.id)) {
      migrated = true;
      continue;
    }
    if (!/^https?:\/\//i.test(item.url) || sourceIds.has(item.id)) continue;
    sourceIds.add(item.id);
    const status =
      options.isImport
        ? "unknown"
        : item.status === "ok" || item.status === "error" || item.status === "unknown"
          ? item.status
          : "unknown";
    sources.push({
      id: item.id,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : "Источник без названия",
      url: item.url,
      siteUrl: typeof item.siteUrl === "string" && item.siteUrl ? item.siteUrl : item.url,
      enabled: item.enabled !== false,
      createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
      lastSyncAt: typeof item.lastSyncAt === "number" ? item.lastSyncAt : null,
      lastError: typeof item.lastError === "string" ? item.lastError : null,
      status,
      articleCount: 0,
      etag: typeof item.etag === "string" ? item.etag : undefined,
      lastModified: typeof item.lastModified === "string" ? item.lastModified : undefined,
    });
  }

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const articleIds = new Set<string>();
  const articles: Article[] = [];
  for (const item of raw.articles) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.title !== "string") continue;
    const sourceId = typeof item.sourceId === "string" ? item.sourceId : "";
    if (LEGACY_SEED_ARTICLE_IDS.has(item.id) || LEGACY_SEED_SOURCE_IDS.has(sourceId)) {
      migrated = true;
      continue;
    }
    if (articleIds.has(item.id)) continue;
    articleIds.add(item.id);
    const contentText = typeof item.contentText === "string" ? item.contentText : "";
    const linkedSource = sourceById.get(sourceId);
    // Совместимость со старой схемой: раньше прочтение хранилось как isRead.
    const legacyIsRead = Boolean((item as Record<string, unknown>).isRead);
    const legacyIsSaved = Boolean((item as Record<string, unknown>).isSaved);
    const readAt =
      typeof item.readAt === "number" ? item.readAt : legacyIsRead ? (typeof item.publishedAt === "number" ? item.publishedAt : Date.now()) : null;
    const savedAt =
      typeof item.savedAt === "number" ? item.savedAt : legacyIsSaved ? Date.now() : null;
    articles.push({
      id: item.id,
      sourceId,
      sourceName:
        linkedSource?.name ||
        (typeof item.sourceName === "string" && item.sourceName.trim() ? item.sourceName.trim() : "Неизвестный источник"),
      title: item.title,
      url: typeof item.url === "string" ? item.url : "",
      guid: typeof item.guid === "string" ? item.guid : "",
      author: typeof item.author === "string" ? item.author : "",
      publishedAt: typeof item.publishedAt === "number" ? item.publishedAt : Date.now(),
      fetchedAt: typeof item.fetchedAt === "number" ? item.fetchedAt : Date.now(),
      excerpt: typeof item.excerpt === "string" ? item.excerpt : "",
      // Санитизация HTML при каждом чтении из хранилища — защита от старых повреждённых записей.
      contentHtml: sanitizeHtml(typeof item.contentHtml === "string" ? item.contentHtml : ""),
      contentText,
      extraction: normalizeExtraction(item.extraction),
      extractionNote: typeof item.extractionNote === "string" ? item.extractionNote : undefined,
      charCount: typeof item.charCount === "number" && item.charCount >= 0 ? item.charCount : charCount(contentText),
      readAt,
      savedAt,
      feedOrder: typeof item.feedOrder === "number" ? item.feedOrder : 0,
    });
  }

  // Пересчитываем реальное число статей для каждого источника.
  const counts = new Map<string, number>();
  for (const article of articles) {
    if (article.sourceId) counts.set(article.sourceId, (counts.get(article.sourceId) || 0) + 1);
  }
  for (const source of sources) {
    source.articleCount = counts.get(source.id) || 0;
  }

  const draftIds = new Set<string>();
  const drafts: Draft[] = [];
  for (const item of raw.drafts) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.articleTitle !== "string") continue;
    const articleId = typeof item.articleId === "string" ? item.articleId : "";
    if (LEGACY_SEED_DRAFT_IDS.has(item.id) || LEGACY_SEED_ARTICLE_IDS.has(articleId)) {
      migrated = true;
      continue;
    }

    // Старые черновики были созданы через Google Gemini — сохраняем обратную совместимость.
    const draftProvider: AIProvider =
      item.provider === "groq" || item.provider === "gemini" ? item.provider : "gemini";
    if (item.provider !== "groq" && item.provider !== "gemini") {
      migrated = true;
    }

    const base = {
      articleId,
      articleTitle: item.articleTitle,
      sourceName: typeof item.sourceName === "string" ? item.sourceName : "",
      sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : "",
      createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
      updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : Date.now(),
      provider: draftProvider,
      model: typeof item.model === "string" && item.model.trim() ? item.model.trim() : GEMINI_MODEL,
      warnings: asStringArray(item.warnings, 8),
      keyFacts: asStringArray(item.keyFacts, 8),
      sufficiency: normalizeSufficiency(item.sufficiency),
      status: normalizeStatus(item.status),
    };

    // Формат один пост на запись (v2+).
    if ((item.format === "short" || item.format === "long") && typeof item.text === "string") {
      if (draftIds.has(item.id)) continue;
      draftIds.add(item.id);
      const originalText = typeof item.originalText === "string" ? item.originalText : item.text;
      drafts.push({
        id: item.id,
        ...base,
        format: item.format,
        originalText,
        text: item.text,
        edited: item.text !== originalText || Boolean(item.edited),
      });
      continue;
    }

    // Старый формат v1 (shortPost + longPost в одной записи) → разделяем на две независимые.
    const shortPost = typeof item.shortPost === "string" ? item.shortPost : "";
    const originalShort = typeof item.originalShort === "string" ? item.originalShort : shortPost;
    const longPost = typeof item.longPost === "string" ? item.longPost : "";
    const originalLong = typeof item.originalLong === "string" ? item.originalLong : longPost;

    if (shortPost.trim() || originalShort.trim()) {
      const id = `${item.id}_short`;
      if (!draftIds.has(id)) {
        draftIds.add(id);
        drafts.push({
          id,
          ...base,
          format: "short",
          originalText: originalShort,
          text: shortPost || originalShort,
          edited: Boolean(shortPost && shortPost !== originalShort),
        });
      }
      migrated = true;
    }

    if (longPost.trim() || originalLong.trim()) {
      const id = `${item.id}_long`;
      if (!draftIds.has(id)) {
        draftIds.add(id);
        drafts.push({
          id,
          ...base,
          format: "long",
          originalText: originalLong,
          text: longPost || originalLong,
          edited: Boolean(longPost && longPost !== originalLong),
        });
      }
      migrated = true;
    }
  }

  const rawSettings = isRecord(raw.settings) ? raw.settings : {};
  const settings: Settings = {
    activeProvider: normalizeProvider(rawSettings.activeProvider),
    apiKey: options.preserveApiKey !== false ? loadGeminiApiKey() : "",
    model: GEMINI_MODEL,
    groqApiKey: options.preserveApiKey !== false ? loadGroqApiKey() : "",
    groqModel: isValidGroqModel(rawSettings.groqModel)
      ? rawSettings.groqModel
      : DEFAULT_GROQ_MODEL,
    theme: normalizeTheme(rawSettings.theme),
    privacyAcknowledged: Boolean(rawSettings.privacyAcknowledged),
    groqPrivacyAcknowledged: Boolean(rawSettings.groqPrivacyAcknowledged),
    autoMarkRead: rawSettings.autoMarkRead !== false,
    autoCleanupEnabled: rawSettings.autoCleanupEnabled === true,
    retentionDays:
      typeof rawSettings.retentionDays === "number" && rawSettings.retentionDays > 0
        ? rawSettings.retentionDays
        : 30,
    syncMinutes:
      typeof rawSettings.syncMinutes === "number" && rawSettings.syncMinutes >= 15
        ? Math.floor(rawSettings.syncMinutes)
        : 30,
    lastTestedAt: typeof rawSettings.lastTestedAt === "number" ? rawSettings.lastTestedAt : null,
    groqLastTestedAt:
      typeof rawSettings.groqLastTestedAt === "number" ? rawSettings.groqLastTestedAt : null,
    groqTestedModel:
      typeof rawSettings.groqTestedModel === "string" ? rawSettings.groqTestedModel : null,
    lastSyncAllAt: typeof rawSettings.lastSyncAllAt === "number" ? rawSettings.lastSyncAllAt : null,
    geminiUsage: normalizeUsageStats(rawSettings.geminiUsage),
    groqUsage: normalizeUsageStats(rawSettings.groqUsage),
  };

  if (rawSettings.model && rawSettings.model !== GEMINI_MODEL) {
    migrated = true;
  }

  return {
    data: {
      schemaVersion: SCHEMA_VERSION,
      sources,
      articles,
      drafts,
      settings,
    },
    migrated,
  };
}

function serializeWorkspace(data: WorkspaceData) {
  // API-ключи обоих провайдеров намеренно исключаются из сериализации и IndexedDB.
  const { apiKey: _removedGemini, groqApiKey: _removedGroq, ...safeSettings } = data.settings;
  return JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    sources: data.sources,
    articles: data.articles,
    drafts: data.drafts,
    settings: safeSettings,
  });
}

function loadWorkspace(): { data: WorkspaceData; didMigrate: boolean } {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (!raw) {
      const empty = createEmptyWorkspace();
      return {
        data: {
          ...empty,
          settings: {
            ...empty.settings,
            apiKey: loadGeminiApiKey(),
            groqApiKey: loadGroqApiKey(),
          },
        },
        didMigrate: false,
      };
    }
    const result = migrateWorkspaceData(JSON.parse(raw), { preserveApiKey: true });
    if (!result) return { data: createEmptyWorkspace(), didMigrate: false };
    return { data: result.data, didMigrate: result.migrated };
  } catch {
    return { data: createEmptyWorkspace(), didMigrate: false };
  }
}

export function buildExportPayload(data: WorkspaceData) {
  const { apiKey: _removedGemini, groqApiKey: _removedGroq, ...safeSettings } = data.settings;
  return JSON.stringify(
    {
      app: "Dispatch — RSS в X",
      exportVersion: 3,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      note: "API-ключи Google Gemini и Groq в экспорт никогда не включаются.",
      sources: data.sources,
      articles: data.articles,
      drafts: data.drafts,
      settings: safeSettings,
    },
    null,
    2
  );
}

export function parseImportPayload(
  raw: string
): { data: WorkspaceData; counts: { sources: number; articles: number; drafts: number } } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Выбранный файл не является корректным JSON.");
  }
  const migrated = migrateWorkspaceData(parsed, { preserveApiKey: true, isImport: true });
  if (!migrated) {
    throw new Error("В файле отсутствуют обязательные разделы sources, articles или drafts.");
  }
  const { data } = migrated;
  if (data.sources.length === 0 && data.articles.length === 0 && data.drafts.length === 0) {
    throw new Error("В файле не найдено ни одной пользовательской записи для импорта.");
  }
  return {
    data,
    counts: {
      sources: data.sources.length,
      articles: data.articles.length,
      drafts: data.drafts.length,
    },
  };
}

// Отправляет актуальный счётчик непрочитанных в фоновый service worker для значка расширения.
export function pushUnreadCountToBadge(articles: Article[]) {
  const count = articles.filter((a) => a.readAt === null).length;
  try {
    const chromeApi = (
      globalThis as unknown as {
        chrome?: {
          storage?: {
            local?: { set: (items: Record<string, unknown>) => Promise<void> };
          };
          runtime?: { sendMessage?: (message: unknown) => Promise<unknown> };
        };
      }
    ).chrome;
    const local = chromeApi?.storage?.local;
    if (local?.set) {
      void local.set({ dispatchUnreadCount: count }).catch(() => undefined);
    }
    const runtime = chromeApi?.runtime;
    if (runtime?.sendMessage) {
      void runtime.sendMessage({ type: "dispatch:unread-count", count }).catch(() => undefined);
    }
  } catch {
    // Вне расширения значок недоступен.
  }
}

function syncErrorMessage(error: unknown) {
  if (error instanceof FeedError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Не удалось обновить ленту. Проверьте адрес и доступ к сайту.";
}

interface StoreContextValue {
  data: WorkspaceData;
  sources: Source[];
  articles: Article[];
  drafts: Draft[];
  settings: Settings;
  toasts: ToastMessage[];
  notify: (toast: Omit<ToastMessage, "id">) => void;
  dismissToast: (id: string) => void;
  syncingIds: string[];
  isRefreshingAll: boolean;
  /** IndexedDB-гидратация завершена. До этого данные могут уточняться. */
  hydrated: boolean;
  /** Быстрый кэш localStorage существует (нет необходимости показывать индикатор восстановления). */
  hasLocalCache: boolean;
  updateSettings: (patch: Partial<Omit<Settings, "model">>) => void;
  saveApiKey: (key: string) => void;
  clearApiKey: () => void;
  saveGroqApiKey: (key: string) => void;
  clearGroqApiKey: () => void;
  addSource: (input: {
    name: string;
    url: string;
    siteUrl?: string;
    enabled?: boolean;
    preview?: ParsedFeed;
  }) => Source;
  updateSource: (id: string, patch: Partial<Source>) => void;
  deleteSource: (id: string, removeArticles: boolean) => void;
  toggleSource: (id: string) => void;
  refreshSource: (id: string, requestPermission?: boolean) => Promise<boolean>;
  refreshAll: (fromUserGesture?: boolean) => Promise<void>;
  loadOlderArticles: (sourceId: string) => Promise<{ added: number; pagesFetched: number; finished: boolean }>;
  markRead: (id: string, read: boolean) => void;
  toggleSaved: (id: string) => void;
  markAllReadInView: (articleIds: string[], label?: string) => void;
  markAllReadInSource: (sourceId: string) => void;
  undoMassChange: () => void;
  purgeOldArticles: () => number;
  recordAIUsage: (
    provider: AIProvider,
    stats: {
      inputTokens?: number;
      outputTokens?: number;
      error?: boolean;
      kind?: string;
      detail?: string;
    }
  ) => void;
  recordGeminiUsage: (stats: {
    inputTokens?: number;
    outputTokens?: number;
    error?: boolean;
    kind?: string;
    detail?: string;
  }) => void;
  deleteArticle: (id: string) => void;
  updateArticleExtraction: (
    id: string,
    content: {
      html: string;
      text: string;
      title?: string;
      author?: string;
      status: ExtractionStatus;
      note?: string;
      charCount: number;
    }
  ) => void;
  getDraftForArticle: (articleId: string, format: DraftFormat) => Draft | undefined;
  saveGeneratedDraft: (draft: Draft, replaceId?: string) => Draft;
  updateDraft: (id: string, patch: Partial<Pick<Draft, "text" | "updatedAt">>) => void;
  resetDraftToOriginal: (id: string) => void;
  deleteDraft: (id: string) => void;
  exportWorkspace: () => string;
  importWorkspace: (raw: string) => { sources: number; articles: number; drafts: number };
  clearAllData: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const initialRef = useRef<{ data: WorkspaceData; didMigrate: boolean } | null>(null);
  if (!initialRef.current) initialRef.current = loadWorkspace();

  const [data, setData] = useState<WorkspaceData>(initialRef.current.data);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [syncingIds, setSyncingIds] = useState<string[]>([]);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // Быстрый кэш в localStorage существует; первичным хранилищем является IndexedDB.
  const [hasLocalCache, _setHasLocalCache] = useState(() => {
    try {
      return localStorage.getItem(WORKSPACE_KEY) !== null;
    } catch {
      return false;
    }
  });
  const shouldWriteAfterHydrate = useRef(initialRef.current.didMigrate);
  const dataRef = useRef(data);
  dataRef.current = data;
  const persistTimer = useRef<number | null>(null);
  // Атомарная защита от повторного запуска синхронизации одного источника
  // несколькими независимыми вызовами (ref обновляется синхронно, в отличие от state).
  const inFlightSourcesRef = useRef<Set<string>>(new Set());
  const massUndoRef = useRef<MassChangeUndo | null>(null);

  const notify = useCallback((toast: Omit<ToastMessage, "id">) => {
    const message: ToastMessage = { ...toast, id: uid("toast") };
    setToasts((current) => [...current.slice(-1), message]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((entry) => entry.id !== message.id));
    }, 5_000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((entry) => entry.id !== id));
  }, []);

  // Сохранение в IndexedDB (первичное) и localStorage (быстрый кэш). API-ключ не пишется.
  const writeNow = useCallback(
    (next: WorkspaceData) => {
      const savedAt = Date.now();
      const serialized = serializeWorkspace(next);
      // IndexedDB — основной носитель: квоты заметно выше, данные переживают очистку кэша.
      try {
        void writeWorkspaceRecord(JSON.parse(serialized), savedAt);
      } catch {
        // IndexedDB недоступен — данные остаются в кэше и в памяти.
      }
      // localStorage — зеркало для мгновенного первого рендера.
      // setItem атомен: при нехватке квоты старый кэш не повреждается,
      // а при следующем запуске более свежий снимок из IndexedDB победит по savedAt.
      try {
        localStorage.setItem(WORKSPACE_KEY, serialized);
        localStorage.setItem(WORKSPACE_SAVED_AT_KEY, String(savedAt));
      } catch {
        notify({
          title: "Кэш браузера заполнен",
          description: "Основные данные продолжают храниться в IndexedDB. Рекомендуем удалить старые статьи.",
          variant: "warning",
        });
      }
    },
    [notify]
  );

  // Восстановление и безопасная миграция из IndexedDB при запуске.
  // Гонка исключена архитектурно: один и тот же объект-снимок передаётся в setData
  // и в запись хранилища, поэтому устаревшее dataRef.current в игру не входит.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let snapshot: WorkspaceData | null = null;
      try {
        const record = await readWorkspaceRecord();
        if (cancelled) return;
        if (record) {
          let localSavedAt = 0;
          let hasLocal = false;
          try {
            hasLocal = localStorage.getItem(WORKSPACE_KEY) !== null;
            localSavedAt = Number(localStorage.getItem(WORKSPACE_SAVED_AT_KEY) || 0);
          } catch {
            localSavedAt = 0;
          }
          if (!hasLocal || record.savedAt > localSavedAt) {
            const migrated = migrateWorkspaceData(record.data, { preserveApiKey: true });
            if (migrated) {
              const merged: WorkspaceData = {
                ...migrated.data,
                settings: {
                  ...migrated.data.settings,
                  apiKey: dataRef.current.settings.apiKey,
                  groqApiKey: dataRef.current.settings.groqApiKey,
                },
              };
              snapshot = merged;
              setData(merged);
            }
          }
        }
      } catch {
        // IndexedDB не читается — работаем с кэшем.
      }
      if (cancelled) return;
      const shouldWrite = shouldWriteAfterHydrate.current || snapshot !== null;
      if (shouldWrite) {
        shouldWriteAfterHydrate.current = false;
        if (snapshot) writeNow(snapshot);
        else writeNow(dataRef.current);
      }
      setHydrated(true);
    })().catch(() => setHydrated(true));
    return () => {
      cancelled = true;
    };
  }, [writeNow]);

  // Отложенное сохранение всех изменений рабочего пространства.
  useEffect(() => {
    if (!hydrated) return;
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      writeNow(data);
    }, 250);
    return () => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current);
    };
  }, [data, hydrated, writeNow]);

  // Восстановление API-ключей обоих провайдеров из chrome.storage.local (в контексте расширения).
  useEffect(() => {
    const local = extensionStorage();
    if (!local) return;
    let cancelled = false;
    local
      .get([GEMINI_CHROME_STORAGE_KEY, GROQ_CHROME_STORAGE_KEY])
      .then((result) => {
        if (cancelled) return;
        const storedGemini =
          typeof result?.[GEMINI_CHROME_STORAGE_KEY] === "string"
            ? (result[GEMINI_CHROME_STORAGE_KEY] as string)
            : "";
        const storedGroq =
          typeof result?.[GROQ_CHROME_STORAGE_KEY] === "string"
            ? (result[GROQ_CHROME_STORAGE_KEY] as string)
            : "";
        if (!storedGemini && !storedGroq) return;

        try {
          if (storedGemini) localStorage.setItem(GEMINI_API_KEY_STORAGE, storedGemini);
          if (storedGroq) localStorage.setItem(GROQ_API_KEY_STORAGE, storedGroq);
        } catch {
          // Используем ключи в памяти.
        }

        setData((current) => {
          const nextGemini = current.settings.apiKey || storedGemini;
          const nextGroq = current.settings.groqApiKey || storedGroq;
          if (
            nextGemini === current.settings.apiKey &&
            nextGroq === current.settings.groqApiKey
          ) {
            return current;
          }
          return {
            ...current,
            settings: {
              ...current.settings,
              apiKey: nextGemini,
              groqApiKey: nextGroq,
            },
          };
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Применение светлой/тёмной/системной темы.
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark =
        data.settings.theme === "dark" || (data.settings.theme === "system" && media.matches);
      root.classList.toggle("dark", dark);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [data.settings.theme]);

  const updateSettings = useCallback((patch: Partial<Omit<Settings, "model">>) => {
    if (typeof patch.apiKey === "string") persistGeminiApiKey(patch.apiKey);
    if (typeof patch.groqApiKey === "string") persistGroqApiKey(patch.groqApiKey);
    setData((current) => {
      const nextGroqModel =
        patch.groqModel !== undefined
          ? isValidGroqModel(patch.groqModel)
            ? patch.groqModel
            : current.settings.groqModel
          : current.settings.groqModel;
      return {
        ...current,
        settings: {
          ...current.settings,
          ...patch,
          model: GEMINI_MODEL,
          groqModel: nextGroqModel,
        },
      };
    });
  }, []);

  const saveApiKey = useCallback(
    (key: string) => {
      const clean = key.trim();
      persistGeminiApiKey(clean);
      setData((current) => ({
        ...current,
        settings: { ...current.settings, apiKey: clean, model: GEMINI_MODEL, lastTestedAt: null },
      }));
      notify({
        title: clean ? "API-ключ Google Gemini сохранён" : "API-ключ Google Gemini удалён",
        description: clean
          ? "Ключ хранится только локально в этом браузере и не включается в экспорт."
          : "Ключ Google Gemini удалён.",
        variant: clean ? "success" : "info",
      });
    },
    [notify]
  );

  const clearApiKey = useCallback(() => {
    persistGeminiApiKey("");
    setData((current) => ({
      ...current,
      settings: {
        ...current.settings,
        apiKey: "",
        lastTestedAt: null,
      },
    }));
    notify({
      title: "API-ключ Google Gemini удалён",
      description: "Сохранённые новости, источники, черновики и настройки Groq не затронуты.",
      variant: "info",
    });
  }, [notify]);

  const saveGroqApiKey = useCallback(
    (key: string) => {
      const clean = key.trim();
      persistGroqApiKey(clean);
      // Сохранение ключа Groq не переключает активный провайдер автоматически.
      setData((current) => ({
        ...current,
        settings: {
          ...current.settings,
          groqApiKey: clean,
          groqLastTestedAt: null,
          groqTestedModel: null,
        },
      }));
      notify({
        title: clean ? "API-ключ Groq сохранён" : "API-ключ Groq удалён",
        description: clean
          ? "Ключ хранится только локально в этом браузере и не включается в экспорт."
          : "Ключ Groq удалён.",
        variant: clean ? "success" : "info",
      });
    },
    [notify]
  );

  const clearGroqApiKey = useCallback(() => {
    persistGroqApiKey("");
    setData((current) => ({
      ...current,
      settings: {
        ...current.settings,
        groqApiKey: "",
        groqLastTestedAt: null,
        groqTestedModel: null,
      },
    }));
    notify({
      title: "API-ключ Groq удалён",
      description: "Сохранённые новости, источники, черновики и настройки Gemini не затронуты.",
      variant: "info",
    });
  }, [notify]);

  const addSource = useCallback<StoreContextValue["addSource"]>((input) => {
    const id = uid("src");
    const name = input.name.trim();
    const baseSource: Source = {
      id,
      name,
      url: input.url,
      siteUrl: input.siteUrl || input.url,
      enabled: input.enabled ?? true,
      createdAt: Date.now(),
      lastSyncAt: input.preview ? Date.now() : null,
      lastError: null,
      status: input.preview ? "ok" : "unknown",
      articleCount: 0,
      feedItemCount: input.preview ? input.preview.items.length : undefined,
    };

    const previewArticles = input.preview
      ? input.preview.items.slice(0, 80).map((item) => feedItemToArticle(item, baseSource))
      : [];

    let addedCount = 0;
    setData((current) => {
      const existingKeys = new Set(current.articles.flatMap((article) => articleDedupeKeys(article)));
      const fresh: Article[] = [];
      for (const article of previewArticles) {
        const keys = articleDedupeKeys(article);
        if (keys.some((key) => existingKeys.has(key))) continue;
        keys.forEach((key) => existingKeys.add(key));
        fresh.push(article);
      }
      addedCount = fresh.length;
      const savedSource: Source = { ...baseSource, articleCount: fresh.length };
      return {
        ...current,
        sources: [...current.sources, savedSource],
        articles: [...fresh, ...current.articles],
      };
    });

    return { ...baseSource, articleCount: addedCount || previewArticles.length };
  }, []);

  const updateSource = useCallback((id: string, patch: Partial<Source>) => {
    setData((current) => {
      const nextName = patch.name?.trim();
      return {
        ...current,
        sources: current.sources.map((source) =>
          source.id === id ? { ...source, ...patch, name: nextName || source.name, id: source.id } : source
        ),
        articles: nextName
          ? current.articles.map((article) =>
              article.sourceId === id ? { ...article, sourceName: nextName } : article
            )
          : current.articles,
        drafts: nextName
          ? current.drafts.map((draft) => {
              const linked = current.articles.find((article) => article.id === draft.articleId);
              return linked?.sourceId === id ? { ...draft, sourceName: nextName } : draft;
            })
          : current.drafts,
      };
    });
  }, []);

  const deleteSource = useCallback(
    (id: string, removeArticles: boolean) => {
      setData((current) => ({
        ...current,
        sources: current.sources.filter((source) => source.id !== id),
        articles: removeArticles
          ? current.articles.filter((article) => article.sourceId !== id)
          : current.articles,
        // Пользовательские черновики никогда не удаляются при удалении источника.
        drafts: current.drafts,
      }));
      notify({
        title: "Источник удалён",
        description: removeArticles
          ? "Источник и его статьи удалены. Ваши черновики сохранены."
          : "Источник удалён. Загруженные ранее статьи и черновики остались.",
        variant: "info",
      });
    },
    [notify]
  );

  const toggleSource = useCallback((id: string) => {
    setData((current) => ({
      ...current,
      sources: current.sources.map((source) =>
        source.id === id ? { ...source, enabled: !source.enabled } : source
      ),
    }));
  }, []);

  const applySyncSuccess = useCallback(
    (sourceId: string, result: Awaited<ReturnType<typeof syncSourceFeed>>) => {
      setData((current) => {
        const source = current.sources.find((item) => item.id === sourceId);
        if (!source) return current;
        const existingKeys = new Set(current.articles.flatMap((article) => articleDedupeKeys(article)));
        const fresh: Article[] = [];
        for (const article of result.articles) {
          const keys = articleDedupeKeys(article);
          if (keys.some((key) => existingKeys.has(key))) continue;
          keys.forEach((key) => existingKeys.add(key));
          fresh.push(article);
        }
        const nextArticles = [...fresh, ...current.articles];
        return {
          ...current,
          articles: nextArticles,
          sources: current.sources.map((item) =>
            item.id === sourceId
              ? {
                  ...item,
                  status: "ok",
                  lastError: null,
                  lastSyncAt: Date.now(),
                  articleCount: nextArticles.filter((article) => article.sourceId === sourceId).length,
                  feedItemCount: result.total,
                  etag: result.etag ?? item.etag,
                  lastModified: result.lastModified ?? item.lastModified,
                }
              : item
          ),
        };
      });
    },
    []
  );

  const applySyncError = useCallback((sourceId: string, error: unknown) => {
    setData((current) => ({
      ...current,
      sources: current.sources.map((source) =>
        source.id === sourceId
          ? { ...source, status: "error", lastError: syncErrorMessage(error) }
          : source
      ),
    }));
  }, []);

  const refreshSource = useCallback(
    async (id: string, requestPermission = true) => {
      const source = dataRef.current.sources.find((item) => item.id === id);
      // Атомарная защита: ref обновляется синхронно, поэтому два параллельных
      // вызова (например, ручное обновление во время «Обновить все») не пересекутся.
      if (!source || inFlightSourcesRef.current.has(id)) return false;

      if (requestPermission) {
        const granted = await ensureHostAccess(source.url);
        if (!granted) {
          const err = new FeedError(
            "permission",
            "Доступ к сайту источника не выдан. Разрешите доступ в окне Chrome, чтобы обновлять ленту."
          );
          applySyncError(id, err);
          notify({ title: `Нет доступа к «${source.name}»`, description: err.message, variant: "warning" });
          return false;
        }
      }

      inFlightSourcesRef.current.add(id);
      setSyncingIds((current) => [...current, id]);
      setData((current) => ({
        ...current,
        sources: current.sources.map((item) =>
          item.id === id ? { ...item, status: "syncing" } : item
        ),
      }));

      const startedAt = Date.now();
      try {
        const result = await syncSourceFeed(source, dataRef.current.articles);
        applySyncSuccess(id, result);
        // Точный счётчик: считаем статьи, реально сохранённые после начала обновления.
        const addedCount = dataRef.current.articles.filter((article) => article.fetchedAt >= startedAt && article.sourceId === id).length;
        notify({
          title: result.notModified ? `«${source.name}»: новых статей нет` : `«${source.name}» обновлён`,
          description: result.notModified
            ? "Лента не изменилась с прошлого обновления."
            : addedCount > 0
              ? `Добавлено: ${pluralRu(addedCount, "новая статья", "новые статьи", "новых статей")}.`
              : "Новых публикаций нет, дубликаты пропущены.",
          variant: "success",
        });
        return true;
      } catch (error) {
        applySyncError(id, error);
        notify({
          title: `Ошибка обновления «${source.name}»`,
          description: syncErrorMessage(error),
          variant: "error",
        });
        return false;
      } finally {
        inFlightSourcesRef.current.delete(id);
        setSyncingIds((current) => current.filter((entry) => entry !== id));
      }
    },
    [applySyncError, applySyncSuccess, notify]
  );

  const allRefreshRef = useRef(false);

  const refreshAll = useCallback(
    async (fromUserGesture = false) => {
      if (allRefreshRef.current) return;
      const enabled = dataRef.current.sources.filter((source) => source.enabled);
      if (enabled.length === 0) {
        if (fromUserGesture) {
          notify({
            title: "Нет активных источников",
            description: "Добавьте RSS-ленту или включите существующий источник.",
            variant: "warning",
          });
        }
        return;
      }

      allRefreshRef.current = true;
      // Блокируем индивидуальные обновления всех включённых источников на время пакетного обновления.
      enabled.forEach((source) => inFlightSourcesRef.current.add(source.id));
      setIsRefreshingAll(true);
      setSyncingIds(enabled.map((source) => source.id));
      setData((current) => ({
        ...current,
        sources: current.sources.map((source) =>
          source.enabled ? { ...source, status: "syncing" } : source
        ),
      }));

      const startedAt = Date.now();
      const failedSources: string[] = [];

      await runWithConcurrency(enabled, FEED_CONCURRENCY, async (source) => {
        try {
          const result = await syncSourceFeed(source, dataRef.current.articles);
          applySyncSuccess(source.id, result);
        } catch (error) {
          failedSources.push(source.name);
          applySyncError(source.id, error);
        }
      });

      // Точный итог: реально сохранённые новые статьи (дедупликация учтена в applySyncSuccess).
      const addedTotal = dataRef.current.articles.filter((article) => article.fetchedAt >= startedAt).length;

      setData((current) => ({
        ...current,
        settings: { ...current.settings, lastSyncAllAt: Date.now() },
      }));
      setIsRefreshingAll(false);
      setSyncingIds([]);
      allRefreshRef.current = false;
      enabled.forEach((source) => inFlightSourcesRef.current.delete(source.id));

      // Снимаем отметку фонового service worker только при полностью успешном обновлении;
      // при частичном сбое состояние «нужно повторить обновление» сохраняется.
      if (failedSources.length === 0) {
        try {
          const runtime = (
            globalThis as unknown as { chrome?: { runtime?: { sendMessage?: (m: unknown) => Promise<unknown> } } }
          ).chrome?.runtime;
          void runtime?.sendMessage?.({ type: "dispatch:sync-complete" }).catch(() => undefined);
        } catch {
          // Вне расширения игнорируем.
        }
      }

      if (failedSources.length === 0) {
        if (fromUserGesture || addedTotal > 0) {
          notify({
            title: "Ленты обновлены",
            description:
              addedTotal > 0
                ? `Добавлено: ${pluralRu(addedTotal, "новая статья", "новые статьи", "новых статей")}.`
                : "Новых публикаций пока нет.",
            variant: "success",
          });
        }
      } else if (fromUserGesture) {
        const failedList = failedSources.slice(0, 3).join(", ");
        const more = failedSources.length > 3 ? ` и ещё ${failedSources.length - 3}` : "";
        notify({
          title: `Не удалось обновить ${pluralRu(failedSources.length, "источник", "источника", "источников")}`,
          description: `${failedList}${more}. Остальные ленты обновлены — попробуйте ещё раз в разделе «Источники».`,
          variant: failedSources.length === enabled.length ? "error" : "warning",
        });
      }
    },
    [applySyncError, applySyncSuccess, notify]
  );

  const deleteArticle = useCallback(
    (id: string) => {
      setData((current) => {
        const nextArticles = current.articles.filter((article) => article.id !== id);
        return {
          ...current,
          articles: nextArticles,
          sources: current.sources.map((source) => ({
            ...source,
            articleCount: nextArticles.filter((article) => article.sourceId === source.id).length,
          })),
        };
      });
      notify({
        title: "Статья удалена из ленты",
        description: "Сохранённые черновики по ней остались в разделе «Черновики».",
        variant: "info",
      });
    },
    [notify]
  );

  const updateArticleExtraction = useCallback<StoreContextValue["updateArticleExtraction"]>(
    (id, content) => {
      setData((current) => ({
        ...current,
        articles: current.articles.map((article) =>
          article.id === id
            ? {
                ...article,
                contentHtml: content.html,
                contentText: content.text,
                title: content.title || article.title,
                author: content.author || article.author,
                extraction: content.status,
                extractionNote: content.note,
                charCount: content.charCount,
              }
            : article
        ),
      }));
    },
    []
  );

  const getDraftForArticle = useCallback(
    (articleId: string, format: DraftFormat) =>
      data.drafts.find((draft) => draft.articleId === articleId && draft.format === format),
    [data.drafts]
  );

  const saveGeneratedDraft = useCallback((draft: Draft, replaceId?: string) => {
    const finalDraft: Draft = { ...draft, edited: draft.text !== draft.originalText };
    setData((current) => {
      const targetId =
        replaceId ||
        current.drafts.find(
          (item) => item.articleId === draft.articleId && item.format === draft.format
        )?.id;
      const filtered = targetId
        ? current.drafts.filter((item) => item.id !== targetId)
        : current.drafts;
      return {
        ...current,
        drafts: [finalDraft, ...filtered],
      };
    });
    return finalDraft;
  }, []);

  const updateDraft = useCallback((id: string, patch: Partial<Pick<Draft, "text" | "updatedAt">>) => {
    setData((current) => ({
      ...current,
      drafts: current.drafts.map((draft) => {
        if (draft.id !== id) return draft;
        const text = typeof patch.text === "string" ? patch.text : draft.text;
        return {
          ...draft,
          text,
          updatedAt: patch.updatedAt ?? Date.now(),
          edited: text !== draft.originalText,
        };
      }),
    }));
  }, []);

  const markRead = useCallback((id: string, read: boolean) => {
    setData((current) => ({
      ...current,
      articles: current.articles.map((article) =>
        article.id === id ? { ...article, readAt: read ? Date.now() : null } : article
      ),
    }));
  }, []);

  const toggleSaved = useCallback((id: string) => {
    setData((current) => ({
      ...current,
      articles: current.articles.map((article) =>
        article.id === id ? { ...article, savedAt: article.savedAt ? null : Date.now() } : article
      ),
    }));
  }, []);

  const markAllReadInView = useCallback(
    (articleIds: string[], label = "Отмечено прочитанным") => {
      const ids = new Set(articleIds);
      const now = Date.now();
      // Списки изменений вычисляем ДО setData: апдейт-функция может выполняться
      // отложенно, поэтому побочный сбор данных внутри неё ненадёжен.
      const affected = dataRef.current.articles
        .filter((article) => ids.has(article.id) && !article.readAt)
        .map((article) => ({ id: article.id, readAt: article.readAt, savedAt: article.savedAt }));
      if (affected.length === 0) return;

      setData((current) => ({
        ...current,
        articles: current.articles.map((article) =>
          ids.has(article.id) && !article.readAt ? { ...article, readAt: now } : article
        ),
      }));

      massUndoRef.current = { label: "Отменить прочтение", changedIds: affected };
      notify({
        title: label,
        description: `Изменено: ${pluralRu(affected.length, "статья", "статьи", "статей")}.`,
        variant: "success",
        action: { label: "Отменить", onClick: () => undoMassChangeRef.current?.() },
      });
    },
    [notify]
  );

  const markAllReadInSource = useCallback(
    (sourceId: string) => {
      const source = dataRef.current.sources.find((s) => s.id === sourceId);
      const ids = dataRef.current.articles.filter((a) => a.sourceId === sourceId && !a.readAt).map((a) => a.id);
      if (ids.length === 0) {
        notify({ title: "Непрочитанных нет", description: "Все статьи этого источника уже прочитаны.", variant: "info" });
        return;
      }
      markAllReadInView(ids, `Источник «${source?.name || "Источник"}» отмечен прочитанным`);
    },
    [markAllReadInView, notify]
  );

  const undoMassChange = useCallback(() => {
    const undo = massUndoRef.current;
    if (!undo) return;
    setData((current) => {
      const map = new Map(undo.changedIds.map((entry) => [entry.id, entry]));
      return {
        ...current,
        articles: current.articles.map((article) => {
          const prev = map.get(article.id);
          if (!prev) return article;
          return { ...article, readAt: prev.readAt, savedAt: prev.savedAt };
        }),
      };
    });
    notify({ title: "Действие отменено", description: "Статусы статей восстановлены.", variant: "info" });
    massUndoRef.current = null;
  }, [notify]);

  // Ссылка для использования внутри notify callback.
  const undoMassChangeRef = useRef<() => void>(() => undoMassChange());
  undoMassChangeRef.current = undoMassChange;

  const purgeOldArticles = useCallback(() => {
    const current = dataRef.current;
    if (!current.settings.autoCleanupEnabled) return 0;
    const cutoff = Date.now() - Math.max(1, current.settings.retentionDays) * 86_400_000;
    const draftArticleIds = new Set(current.drafts.map((draft) => draft.articleId));
    const retained = current.articles.filter(
      (article) => article.savedAt !== null || article.readAt === null || article.publishedAt >= cutoff || draftArticleIds.has(article.id)
    );
    const removed = current.articles.length - retained.length;
    if (removed > 0) {
      setData((state) => ({
        ...state,
        articles: retained,
        sources: state.sources.map((source) => ({
          ...source,
          articleCount: retained.filter((article) => article.sourceId === source.id).length,
        })),
      }));
    }
    return removed;
  }, []);

  const loadOlderArticles = useCallback(
    async (sourceId: string) => {
      const source = dataRef.current.sources.find((item) => item.id === sourceId);
      if (!source || !source.nextOlderPage) {
        return { added: 0, pagesFetched: 0, finished: true };
      }
      if (inFlightSourcesRef.current.has(sourceId)) {
        return { added: 0, pagesFetched: 0, finished: false };
      }

      const granted = await ensureHostAccess(source.nextOlderPage);
      if (!granted) {
        notify({
          title: `Нет доступа к архиву «${source.name}»`,
          description: "Разрешите доступ в окне Chrome, чтобы загрузить более старые публикации.",
          variant: "warning",
        });
        return { added: 0, pagesFetched: 0, finished: false };
      }

      inFlightSourcesRef.current.add(sourceId);
      const startedAt = Date.now();
      setSyncingIds((current) => [...current, sourceId]);
      setData((current) => ({
        ...current,
        sources: current.sources.map((item) => (item.id === sourceId ? { ...item, status: "syncing" } : item)),
      }));

      try {
        const visited = new Set<string>([source.url]);
        const result = await syncOlderPages(source, dataRef.current.articles, visited);
        if (result.articles.length > 0) {
          setData((current) => {
            const existingKeys = new Set(current.articles.flatMap((article) => articleDedupeKeys(article)));
            const fresh: Article[] = [];
            for (const article of result.articles) {
              const keys = articleDedupeKeys(article);
              if (keys.some((key) => existingKeys.has(key))) continue;
              keys.forEach((key) => existingKeys.add(key));
              fresh.push(article);
            }
            const nextArticles = [...current.articles, ...fresh];
            return {
              ...current,
              articles: nextArticles,
              sources: current.sources.map((item) =>
                item.id === sourceId
                  ? {
                      ...item,
                      status: "ok",
                      lastError: null,
                      lastSyncAt: Date.now(),
                      articleCount: nextArticles.filter((a) => a.sourceId === sourceId).length,
                      nextOlderPage: result.finished ? undefined : result.nextOlderPage ?? item.nextOlderPage,
                    }
                  : item
              ),
            };
          });
        } else {
          setData((current) => ({
            ...current,
            sources: current.sources.map((item) =>
              item.id === sourceId
                ? {
                    ...item,
                    status: "ok",
                    nextOlderPage: result.finished ? undefined : result.nextOlderPage ?? item.nextOlderPage,
                  }
                : item
            ),
          }));
        }
        const addedCount = dataRef.current.articles.filter(
          (article) => article.fetchedAt >= startedAt && article.sourceId === sourceId
        ).length;
        if (addedCount === 0) {
          notify({
            title: `Больше старых публикаций нет`,
            description: "Все доступные в архиве публикации уже загружены.",
            variant: "info",
          });
        } else {
          notify({
            title: `Архив «${source.name}» загружен`,
            description: `Добавлено: ${pluralRu(addedCount, "старая публикация", "старые публикации", "старых публикаций")}${result.pagesFetched > 1 ? ` (${pluralRu(result.pagesFetched, "страница", "страницы", "страниц")})` : ""}.`,
            variant: "success",
          });
        }
        return { added: addedCount, pagesFetched: result.pagesFetched, finished: result.finished };
      } catch (error) {
        applySyncError(sourceId, error);
        notify({
          title: `Не удалось загрузить архив «${source.name}»`,
          description: syncErrorMessage(error),
          variant: "error",
        });
        return { added: 0, pagesFetched: 0, finished: false };
      } finally {
        inFlightSourcesRef.current.delete(sourceId);
        setSyncingIds((current) => current.filter((entry) => entry !== sourceId));
      }
    },
    [applySyncError, notify]
  );

  const recordAIUsage = useCallback<StoreContextValue["recordAIUsage"]>(
    (provider, stats) => {
      setData((current) => {
        const key = provider === "groq" ? "groqUsage" : "geminiUsage";
        const usage = current.settings[key];
        const next: AIUsageStats = { ...usage };
        next.requests += 1;
        if (stats.error) {
          next.errors += 1;
          next.lastErrorAt = Date.now();
          next.lastErrorKind = stats.kind || "unknown";
          next.lastErrorDetail = stats.detail || next.lastErrorDetail;
        } else {
          next.successful += 1;
        }
        next.inputTokens += stats.inputTokens || 0;
        next.outputTokens += stats.outputTokens || 0;
        next.totalTokens += (stats.inputTokens || 0) + (stats.outputTokens || 0);
        next.lastRequestAt = Date.now();
        return {
          ...current,
          settings: { ...current.settings, [key]: next },
        };
      });
    },
    []
  );

  const recordGeminiUsage = useCallback<StoreContextValue["recordGeminiUsage"]>(
    (stats) => recordAIUsage("gemini", stats),
    [recordAIUsage]
  );

  const resetDraftToOriginal = useCallback(
    (id: string) => {
      const target = dataRef.current.drafts.find((item) => item.id === id);
      const providerLabel = target ? AI_PROVIDER_LABELS[target.provider] : "ИИ";
      setData((current) => ({
        ...current,
        drafts: current.drafts.map((draft) =>
          draft.id === id
            ? { ...draft, text: draft.originalText, updatedAt: Date.now(), edited: false }
            : draft
        ),
      }));
      notify({
        title: "Исходный текст восстановлен",
        description: `Возвращён первоначальный вариант от ${providerLabel}.`,
        variant: "info",
      });
    },
    [notify]
  );

  const deleteDraft = useCallback(
    (id: string) => {
      setData((current) => ({
        ...current,
        drafts: current.drafts.filter((draft) => draft.id !== id),
      }));
      notify({ title: "Черновик удалён", variant: "info" });
    },
    [notify]
  );

  const exportWorkspace = useCallback(() => buildExportPayload(data), [data]);

  const importWorkspace = useCallback<StoreContextValue["importWorkspace"]>(
    (raw) => {
      const { data: imported, counts } = parseImportPayload(raw);
      setData((current) => ({
        ...imported,
        settings: {
          ...imported.settings,
          // Оба локальных API-ключа текущего пользователя сохраняются неизменными.
          apiKey: current.settings.apiKey,
          groqApiKey: current.settings.groqApiKey,
          model: GEMINI_MODEL,
        },
      }));
      notify({
        title: "Данные импортированы",
        description: `Загружено: ${pluralRu(counts.sources, "источник", "источника", "источников")}, ${pluralRu(counts.articles, "статья", "статьи", "статей")}, ${pluralRu(counts.drafts, "черновик", "черновика", "черновиков")}. Локальные API-ключи сохранены.`,
        variant: "success",
      });
      return counts;
    },
    [notify]
  );

  const clearAllData = useCallback(() => {
    setData((current) => ({
      schemaVersion: SCHEMA_VERSION,
      sources: [],
      articles: [],
      drafts: [],
      settings: {
        ...DEFAULT_SETTINGS,
        // Пользовательские настройки и оба API-ключа сохраняются — удаляются только новости/источники/черновики.
        activeProvider: current.settings.activeProvider,
        apiKey: current.settings.apiKey,
        groqApiKey: current.settings.groqApiKey,
        groqModel: current.settings.groqModel,
        theme: current.settings.theme,
        privacyAcknowledged: current.settings.privacyAcknowledged,
        groqPrivacyAcknowledged: current.settings.groqPrivacyAcknowledged,
        autoMarkRead: current.settings.autoMarkRead,
        autoCleanupEnabled: current.settings.autoCleanupEnabled,
        retentionDays: current.settings.retentionDays,
        syncMinutes: current.settings.syncMinutes,
        lastTestedAt: current.settings.lastTestedAt,
        groqLastTestedAt: current.settings.groqLastTestedAt,
        groqTestedModel: current.settings.groqTestedModel,
        geminiUsage: current.settings.geminiUsage,
        groqUsage: current.settings.groqUsage,
      },
    }));
    notify({
      title: "Локальные данные удалены",
      description: "Источники, статьи и черновики очищены. API-ключи и настройки сохранены.",
      variant: "info",
    });
  }, [notify]);

  const value = useMemo<StoreContextValue>(
    () => ({
      data,
      sources: data.sources,
      articles: data.articles,
      drafts: data.drafts,
      settings: data.settings,
      toasts,
      notify,
      dismissToast,
      syncingIds,
      isRefreshingAll,
      hydrated,
      hasLocalCache,
      updateSettings,
      saveApiKey,
      clearApiKey,
      saveGroqApiKey,
      clearGroqApiKey,
      addSource,
      updateSource,
      deleteSource,
      toggleSource,
      refreshSource,
      refreshAll,
      deleteArticle,
      updateArticleExtraction,
      getDraftForArticle,
      saveGeneratedDraft,
      updateDraft,
      resetDraftToOriginal,
      deleteDraft,
      exportWorkspace,
      importWorkspace,
      clearAllData,
      loadOlderArticles,
      markRead,
      toggleSaved,
      markAllReadInView,
      markAllReadInSource,
      undoMassChange,
      purgeOldArticles,
      recordAIUsage,
      recordGeminiUsage,
    }),
    [
      addSource,
      clearAllData,
      clearApiKey,
      clearGroqApiKey,
      data,
      deleteArticle,
      deleteDraft,
      deleteSource,
      dismissToast,
      exportWorkspace,
      getDraftForArticle,
      importWorkspace,
      isRefreshingAll,
      notify,
      refreshAll,
      refreshSource,
      resetDraftToOriginal,
      saveApiKey,
      saveGroqApiKey,
      saveGeneratedDraft,
      syncingIds,
      toasts,
      toggleSource,
      updateArticleExtraction,
      updateDraft,
      updateSettings,
      updateSource,
      loadOlderArticles,
      markRead,
      toggleSaved,
      markAllReadInView,
      markAllReadInSource,
      undoMassChange,
      purgeOldArticles,
      recordAIUsage,
      recordGeminiUsage,
      hydrated,
      hasLocalCache,
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) throw new Error("useStore должен вызываться внутри StoreProvider");
  return context;
}
