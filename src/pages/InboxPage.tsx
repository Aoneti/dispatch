import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  CheckCheck,
  ExternalLink,
  FileSearch,
  FileText,
  FileWarning,
  Newspaper,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { AIProvider, Article, Draft, DraftFormat } from "../lib/types";
import { AI_PROVIDER_LABELS, GEMINI_MODEL } from "../lib/types";
import { fetchArticlePage } from "../lib/feeds";
import { AIProviderError, generateLongPost, generateShortPost } from "../lib/ai";
import { ensureHostAccess } from "../lib/permissions";
import { useStore } from "../lib/store";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Input,
  Select,
} from "../components/ui";
import { ProviderConsentDialog, ReplaceDraftDialog } from "../components/GenerateDialog";
import {
  charCount,
  cn,
  domainOf,
  extractArticleFromHtml,
  formatDate,
  formatDayLabel,
  formatNumber,
  formatTime,
  pluralRu,
  sanitizeHtml,
  uid,
} from "../lib/utils";

const INITIAL_BATCH = 50;

type FeedView = "all" | "unread" | "read" | "saved";
type SortOrder = "newest" | "oldest";

interface InboxProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAddSource: () => void;
  onOpenDraft: (draftId: string) => void;
  onOpenSettings: () => void;
}

interface GenerationSnapshot {
  provider: AIProvider;
  apiKey: string;
  model: string;
  article: Article;
  format: DraftFormat;
}

type GenerationFeedback =
  | {
      kind: "insufficient";
      articleId: string;
      provider: AIProvider;
      format: DraftFormat;
      warnings: string[];
    }
  | {
      kind: "error";
      articleId: string;
      provider: AIProvider;
      format: DraftFormat;
      message: string;
      technical?: string;
      retryAfterMs?: number;
      retryable?: boolean;
    };

export function InboxPage({
  selectedId,
  onSelect,
  onAddSource,
  onOpenDraft,
  onOpenSettings,
}: InboxProps) {
  const {
    articles,
    sources,
    drafts,
    refreshAll,
    isRefreshingAll,
    markAllReadInView,
    markAllReadInSource,
  } = useStore();
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [view, setView] = useState<FeedView>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_BATCH);

  const draftsMap = useMemo(() => {
    const map = new Map<string, { short?: Draft; long?: Draft }>();
    for (const draft of drafts) {
      const entry = map.get(draft.articleId) || {};
      if (draft.format === "short" && !entry.short) entry.short = draft;
      if (draft.format === "long" && !entry.long) entry.long = draft;
      map.set(draft.articleId, entry);
    }
    return map;
  }, [drafts]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru");
    const matches = articles.filter((article) => {
      if (view === "unread" && article.readAt !== null) return false;
      if (view === "read" && article.readAt === null) return false;
      if (view === "saved" && article.savedAt === null) return false;
      if (sourceFilter !== "all" && article.sourceId !== sourceFilter) return false;
      if (query) {
        const haystack = [
          article.title,
          article.excerpt,
          article.contentText,
          article.author,
          article.sourceName,
        ]
          .join(" ")
          .toLocaleLowerCase("ru");
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    return [...matches].sort((a, b) =>
      sortOrder === "newest" ? b.publishedAt - a.publishedAt : a.publishedAt - b.publishedAt
    );
  }, [articles, search, sourceFilter, view, sortOrder]);

  useEffect(() => {
    setVisibleLimit(INITIAL_BATCH);
  }, [search, sourceFilter, view, sortOrder]);

  const selected = useMemo(
    () => (selectedId ? articles.find((article) => article.id === selectedId) || null : null),
    [articles, selectedId]
  );

  const visible = filtered.slice(0, visibleLimit);
  const grouped = useMemo(() => {
    const map = new Map<string, Article[]>();
    for (const article of visible) {
      const day = formatDayLabel(article.publishedAt);
      const list = map.get(day);
      if (list) list.push(article);
      else map.set(day, [article]);
    }
    return Array.from(map.entries());
  }, [visible]);

  const unreadCount = useMemo(() => articles.filter((a) => a.readAt === null).length, [articles]);
  const readCount = useMemo(() => articles.filter((a) => a.readAt !== null).length, [articles]);
  const savedCount = useMemo(() => articles.filter((a) => a.savedAt !== null).length, [articles]);
  const allCount = articles.length;
  const sourceUnreadCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of articles) {
      if (a.readAt === null) map.set(a.sourceId, (map.get(a.sourceId) || 0) + 1);
    }
    return map;
  }, [articles]);

  const hasSources = sources.length > 0;
  const hasEnabledSources = sources.some((source) => source.enabled);

  // Пустой первый запуск — чистый экран с понятным предложением добавить первую RSS-ленту.
  if (!hasSources && articles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={<Newspaper size={22} />}
          title="Пока нет источников новостей"
          description="Добавьте первую RSS или Atom-ленту. Все свежие статьи из добавленных источников появятся здесь в одной ленте."
          action={
            <Button variant="primary" size="md" onClick={onAddSource} icon={<Plus size={15} />}>
              Добавить первую RSS-ленту
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Панель поиска и обновления */}
      <div className="shrink-0 border-b border-line bg-paper px-3 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[160px] flex-1 sm:max-w-[320px]">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
            />
            <Input
              id="news-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по заголовку, тексту, автору или источнику…"
              className="h-9 pl-8 pr-8 text-[13px]"
              aria-label="Поиск новостей"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Очистить поиск"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-ink"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {sources.length > 0 && (
            <div className="w-full sm:w-[200px]">
              <Select
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.target.value)}
                aria-label="Фильтр по источнику"
                className="h-9 text-[13px]"
              >
                <option value="all">Все источники ({allCount})</option>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                    {sourceUnreadCount.get(source.id) ? ` (${sourceUnreadCount.get(source.id)})` : ""}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => void refreshAll(true)}
              loading={isRefreshingAll}
              disabled={!hasEnabledSources}
              icon={<RefreshCw size={13} />}
            >
              Обновить
            </Button>
          </div>
        </div>

        {/* Вкладки представлений и массовые действия */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
          <div className="flex flex-wrap items-center gap-0.5" role="tablist" aria-label="Представления ленты">
            {(
              [
                ["all", "Все", allCount],
                ["unread", "Непрочитанные", unreadCount],
                ["read", "Прочитанные", readCount],
                ["saved", "Сохранённые", savedCount],
              ] as Array<[FeedView, string, number]>
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={view === value}
                onClick={() => setView(value)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-[5px] px-2.5 text-[12.5px] font-medium transition-colors",
                  view === value
                    ? "bg-ink text-paper"
                    : "text-muted hover:bg-surface hover:text-ink"
                )}
              >
                {label}
                <span className="font-mono text-[10.5px] leading-none">{count}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            {view === "unread" && filtered.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  markAllReadInView(
                    filtered.map((a) => a.id),
                    "Отмечено прочитанным в текущем представлении"
                  )
                }
                icon={<CheckCheck size={13} />}
              >
                Прочитать всё ({filtered.length})
              </Button>
            )}
            {sourceFilter !== "all" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => markAllReadInSource(sourceFilter)}
                icon={<CheckCheck size={13} />}
              >
                Прочитать источник
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSortOrder((prev) => (prev === "newest" ? "oldest" : "newest"))}
              icon={<ArrowUpDown size={13} />}
              title={sortOrder === "newest" ? "Сначала старые" : "Сначала новые"}
            >
              {sortOrder === "newest" ? "Сначала новые" : "Сначала старые"}
            </Button>
          </div>
        </div>
      </div>

      {/* Лента новостей и область чтения */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section
          aria-label="Лента новостей"
          className={cn(
            "flex w-full min-w-0 shrink-0 flex-col border-r border-line bg-paper md:w-[340px] xl:w-[390px]",
            selected && "hidden md:flex"
          )}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            {visible.length === 0 ? (
              <EmptyState
                compact
                icon={search || sourceFilter !== "all" || view !== "all" ? <Search size={19} /> : <Newspaper size={19} />}
                title={articles.length === 0 ? "Статей пока нет" : "Ничего не найдено"}
                description={
                  articles.length === 0
                    ? hasEnabledSources
                      ? "Нажмите «Обновить», чтобы загрузить свежие публикации из подключённых RSS-лент."
                      : "Все источники сейчас отключены. Включите нужную ленту в разделе «Источники»."
                    : view === "saved"
                      ? "Сохранённых публикаций пока нет. Нажмите на значок закладки в любой новости."
                      : "Попробуйте другой запрос, представление или сбросьте фильтры."
                }
                action={
                  articles.length === 0 ? (
                    hasEnabledSources ? (
                      <Button
                        variant="primary"
                        size="sm"
                        loading={isRefreshingAll}
                        onClick={() => void refreshAll(true)}
                        icon={<RefreshCw size={13} />}
                      >
                        Обновить ленты
                      </Button>
                    ) : undefined
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSearch("");
                        setSourceFilter("all");
                        setView("all");
                      }}
                    >
                      Сбросить фильтры
                    </Button>
                  )
                }
              />
            ) : (
              <>
                {grouped.map(([dayLabel, items]) => (
                  <div key={dayLabel}>
                    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-paper/95 px-4 py-1.5 backdrop-blur">
                      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-faint">
                        {dayLabel}
                      </span>
                      <span className="font-mono text-[11px] text-faint">{items.length}</span>
                    </div>
                    {items.map((article) => {
                      const active = selected?.id === article.id;
                      const linked = draftsMap.get(article.id);
                      const isUnread = article.readAt === null;
                      const isSaved = article.savedAt !== null;
                      return (
                        <button
                          key={article.id}
                          type="button"
                          onClick={() => onSelect(article.id)}
                          aria-pressed={active}
                          aria-label={`${isUnread ? "Непрочитанная. " : ""}${article.title}`}
                          className={cn(
                            "block w-full border-b border-line px-4 py-3 text-left transition-colors",
                            active ? "bg-surface shadow-inset-line" : "hover:bg-surface/65"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2 text-[11.5px] text-muted">
                            <span className="truncate font-medium">{article.sourceName}</span>
                            <span className="shrink-0 font-mono text-[10.5px] text-faint">
                              {formatTime(article.publishedAt)}
                            </span>
                          </div>
                          <div className="mt-1 flex items-start gap-1.5">
                            {isUnread && (
                              <span
                                className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                                aria-hidden
                                title="Непрочитанная"
                              />
                            )}
                            <h3
                              className={cn(
                                "min-w-0 flex-1 font-serif text-[15.5px] leading-[1.32] text-ink",
                                isUnread ? "font-semibold" : "font-medium text-ink-soft"
                              )}
                            >
                              {article.title}
                            </h3>
                          </div>
                          {article.excerpt && (
                            <p className="mt-1 line-clamp-2 text-[12px] leading-[1.5] text-muted">
                              {article.excerpt}
                            </p>
                          )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {isSaved && (
                              <Badge tone="blue" className="h-[18px] px-1 text-[10px]">
                                Сохранена
                              </Badge>
                            )}
                            {linked?.short && (
                              <Badge tone="moss" className="h-[18px] px-1 text-[10px]">
                                Короткий пост
                              </Badge>
                            )}
                            {linked?.long && (
                              <Badge tone="blue" className="h-[18px] px-1 text-[10px]">
                                Расширенный пост
                              </Badge>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}

                {filtered.length > visible.length && (
                  <div className="p-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      onClick={() => setVisibleLimit((current) => current + INITIAL_BATCH)}
                    >
                      Показать ещё ({filtered.length - visible.length})
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <ArticleReader
          article={selected}
          onBack={() => onSelect(null)}
          onOpenDraft={onOpenDraft}
          onOpenSettings={onOpenSettings}
        />
      </div>
    </div>
  );
}

/* -------------------------- Просмотр статьи --------------------------- */

function ArticleReader({
  article,
  onBack,
  onOpenDraft,
  onOpenSettings,
}: {
  article: Article | null;
  onBack: () => void;
  onOpenDraft: (draftId: string) => void;
  onOpenSettings: () => void;
}) {
  const {
    settings,
    getDraftForArticle,
    saveGeneratedDraft,
    updateArticleExtraction,
    deleteArticle,
    markRead,
    toggleSaved,
    notify,
    recordAIUsage,
  } = useStore();

  const [extracting, setExtracting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Строгая блокировка параллельных и повторных AI-запросов.
  const [generating, setGenerating] = useState<{ articleId: string; format: DraftFormat } | null>(null);
  const inFlightRef = useRef(false);

  const [consentSnapshot, setConsentSnapshot] = useState<GenerationSnapshot | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<{
    snapshot: GenerationSnapshot;
    draft: Draft;
  } | null>(null);
  const [feedback, setFeedback] = useState<GenerationFeedback | null>(null);

  // Автоматическое прочтение при реальном открытии статьи.
  useEffect(() => {
    if (!article || article.readAt !== null || !settings.autoMarkRead) return;
    const timer = window.setTimeout(() => {
      markRead(article.id, true);
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [article?.id, article?.readAt, settings.autoMarkRead, markRead]);

  useEffect(() => {
    setFeedback((prev) => (prev && article && prev.articleId === article.id ? prev : null));
  }, [article]);

  if (!article) {
    return (
      <section
        aria-label="Чтение статьи"
        className="hidden min-w-0 flex-1 items-center justify-center bg-surface p-8 md:flex"
      >
        <div className="max-w-[320px] text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[8px] border border-line bg-paper text-faint">
            <FileText size={20} />
          </div>
          <h2 className="mt-3.5 font-serif text-[19px] font-semibold text-ink">Выберите новость</h2>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
            Откройте статью из списка слева, чтобы прочитать её и вручную сгенерировать короткий
            или расширенный пост для X.
          </p>
        </div>
      </section>
    );
  }

  const existingShort = getDraftForArticle(article.id, "short");
  const existingLong = getDraftForArticle(article.id, "long");

  const isBusy = generating !== null;
  const isGeneratingShort = generating?.articleId === article.id && generating.format === "short";
  const isGeneratingLong = generating?.articleId === article.id && generating.format === "long";

  const activeProvider = settings.activeProvider;
  const activeModel = activeProvider === "groq" ? settings.groqModel : GEMINI_MODEL;
  const activeProviderLabel = AI_PROVIDER_LABELS[activeProvider];

  // Единственная точка вызова AI-генерации — строго по клику пользователя и по зафиксированному snapshot.
  // Смена провайдера или модели в настройках во время запроса не влияет на уже запущенный запрос.
  const executeGeneration = async (snapshot: GenerationSnapshot, replaceId?: string) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setGenerating({ articleId: snapshot.article.id, format: snapshot.format });
    setFeedback(null);

    try {
      const dispatchOptions = {
        provider: snapshot.provider,
        apiKey: snapshot.apiKey,
        model: snapshot.model,
        article: snapshot.article,
      };
      const result =
        snapshot.format === "short"
          ? await generateShortPost(dispatchOptions)
          : await generateLongPost(dispatchOptions);

      if (result.status === "insufficient_source" || !result.post.trim()) {
        const warnings =
          result.warnings.length > 0
            ? result.warnings
            : [
                "В статье недостаточно данных для достоверного поста. Попробуйте извлечь полный текст и повторить запрос.",
              ];
        setFeedback({
          kind: "insufficient",
          articleId: snapshot.article.id,
          provider: snapshot.provider,
          format: snapshot.format,
          warnings,
        });
        notify({
          title: "Недостаточно текста статьи",
          description: "Черновик не создан — попробуйте извлечь полный текст публикации.",
          variant: "warning",
        });
        return;
      }

      const now = Date.now();
      const draft: Draft = {
        id: uid("draft"),
        articleId: snapshot.article.id,
        articleTitle: snapshot.article.title,
        sourceName: snapshot.article.sourceName,
        sourceUrl: snapshot.article.url,
        createdAt: now,
        updatedAt: now,
        provider: result.provider,
        model: result.model,
        format: snapshot.format,
        originalText: result.post,
        text: result.post,
        warnings: result.warnings,
        keyFacts: result.key_facts,
        sufficiency: result.source_sufficiency,
        status: result.status === "needs_review" ? "needs_review" : "ok",
        edited: false,
      };

      const saved = saveGeneratedDraft(draft, replaceId);
      const count = charCount(saved.text);
      recordAIUsage(snapshot.provider, {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
      notify({
        title: snapshot.format === "short" ? "Короткий пост готов" : "Расширенный пост готов",
        description: `${AI_PROVIDER_LABELS[saved.provider]} · ${pluralRu(count, "символ", "символа", "символов")} · проверьте текст перед публикацией.`,
        variant: "success",
      });
      onOpenDraft(saved.id);
    } catch (caught) {
      const error =
        caught instanceof AIProviderError
          ? caught
          : new AIProviderError(
              snapshot.provider,
              "unknown",
              "Не удалось выполнить генерацию. Попробуйте позже."
            );
      setFeedback({
        kind: "error",
        articleId: snapshot.article.id,
        provider: snapshot.provider,
        format: snapshot.format,
        message: error.message,
        technical: error.technical,
        retryAfterMs: error.retryAfterMs,
        retryable: error.retryable,
      });
      notify({
        title:
          snapshot.format === "short"
            ? "Ошибка генерации короткого поста"
            : "Ошибка генерации расширенного поста",
        description: error.message,
        variant: "error",
      });
      recordAIUsage(snapshot.provider, {
        error: true,
        kind: error.kind,
        detail: error.technical || error.kind,
      });
    } finally {
      inFlightRef.current = false;
      setGenerating(null);
    }
  };

  const handleGenerateClick = (format: DraftFormat) => {
    if (inFlightRef.current || isBusy) return;

    // Фиксируем snapshot настроек активного провайдера в момент нажатия кнопки.
    const provider = settings.activeProvider;
    const isGroq = provider === "groq";
    const snapshot: GenerationSnapshot = {
      provider,
      apiKey: isGroq ? settings.groqApiKey : settings.apiKey,
      model: isGroq ? settings.groqModel : GEMINI_MODEL,
      article,
      format,
    };
    const hasConsent = isGroq ? settings.groqPrivacyAcknowledged : settings.privacyAcknowledged;

    if (!snapshot.apiKey || !hasConsent) {
      setConsentSnapshot(snapshot);
      return;
    }

    const existing = format === "short" ? existingShort : existingLong;
    if (existing) {
      setReplaceTarget({ snapshot, draft: existing });
      return;
    }

    void executeGeneration(snapshot);
  };

  const handleConsentProceed = (resolvedApiKey: string) => {
    if (!consentSnapshot) return;
    const snapshot: GenerationSnapshot = {
      ...consentSnapshot,
      apiKey: resolvedApiKey,
    };
    setConsentSnapshot(null);
    const existing = snapshot.format === "short" ? existingShort : existingLong;
    if (existing) {
      setReplaceTarget({ snapshot, draft: existing });
      return;
    }
    void executeGeneration(snapshot);
  };

  const handleExtract = async () => {
    if (extracting) return;
    setExtracting(true);
    try {
      const granted = await ensureHostAccess(article.url);
      if (!granted) {
        notify({
          title: "Доступ к сайту не предоставлен",
          description: "Подтвердите разрешение Chrome для этого домена, чтобы загрузить полный текст.",
          variant: "warning",
        });
        return;
      }
      const html = await fetchArticlePage(article.url);
      const extracted = extractArticleFromHtml(html);
      if (extracted.status === "failed" || extracted.charCount < 120) {
        updateArticleExtraction(article.id, {
          html: article.contentHtml,
          text: article.contentText,
          status: "failed",
          note: "Не удалось извлечь текст со страницы. Сохранён доступный фрагмент из RSS.",
          charCount: article.charCount,
        });
        notify({
          title: "Не удалось извлечь полный текст",
          description: "На странице не найдено читаемого текста статьи. Фрагмент из RSS сохранён.",
          variant: "warning",
        });
      } else {
        updateArticleExtraction(article.id, {
          html: extracted.html,
          text: extracted.text,
          author: extracted.author || undefined,
          status: extracted.status,
          note: extracted.note,
          charCount: extracted.charCount,
        });
        setFeedback((prev) => (prev?.kind === "insufficient" ? null : prev));
        notify({
          title:
            extracted.status === "full"
              ? "Полный текст извлечён"
              : "Извлечена часть статьи",
          description: `Получено: ${pluralRu(extracted.charCount, "символ", "символа", "символов")}.`,
          variant: extracted.status === "full" ? "success" : "warning",
        });
      }
    } catch (error) {
      notify({
        title: "Не удалось загрузить страницу",
        description:
          error instanceof Error
            ? error.message
            : "Сайт недоступен или ограничивает загрузку. Фрагмент из RSS сохранён.",
        variant: "error",
      });
    } finally {
      setExtracting(false);
    }
  };

  const activeFeedback = feedback && feedback.articleId === article.id ? feedback : null;
  const isUnread = article.readAt === null;
  const isSaved = article.savedAt !== null;

  return (
    <section
      aria-label="Чтение статьи"
      className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface"
    >
      {/* Верхняя панель статьи */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3 sm:px-5">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-8 items-center gap-1 rounded-[5px] px-1.5 text-[12px] font-medium text-muted hover:bg-surface-2 hover:text-ink md:hidden"
        >
          <ArrowLeft size={14} /> К списку
        </button>

        <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
          <span className="font-medium text-ink-soft">{article.sourceName}</span>
          <span className="mx-1.5 text-line-strong">·</span>
          <span>{formatDate(article.publishedAt)}</span>
        </span>

        <div className="flex items-center gap-1">
          <IconButton
            label={isUnread ? "Отметить прочитанной" : "Вернуть в непрочитанные"}
            size="sm"
            onClick={() => markRead(article.id, !isUnread)}
            className={isUnread ? "text-amber" : "text-moss"}
          >
            <CheckCheck size={14} />
          </IconButton>
          <IconButton
            label={isSaved ? "Убрать из сохранённых" : "Сохранить новость"}
            size="sm"
            onClick={() => toggleSaved(article.id)}
            className={isSaved ? "text-blue" : ""}
          >
            <FileText size={14} fill={isSaved ? "currentColor" : "none"} />
          </IconButton>
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1 rounded-[5px] border border-line bg-surface px-2 text-[11.5px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
          >
            <ExternalLink size={12} />
            <span className="hidden sm:inline">Оригинал</span>
          </a>
          <IconButton
            label="Удалить статью"
            size="sm"
            onClick={() => setDeleteOpen(true)}
            className="hover:text-rose"
          >
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>

      {/* Тело статьи */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <article className="mx-auto max-w-[680px] px-4 pb-12 pt-5 sm:px-7">
          <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
            <ExtractionBadge status={article.extraction} />
            <span className="font-mono text-[10.5px] text-faint">
              {formatNumber(article.charCount)} симв.
            </span>
            {article.author && (
              <>
                <span className="text-line-strong">·</span>
                <span>{article.author}</span>
              </>
            )}
            {isUnread && <Badge tone="amber" className="h-[18px] px-1 text-[10px]">Непрочитанная</Badge>}
            {isSaved && <Badge tone="blue" className="h-[18px] px-1 text-[10px]">Сохранена</Badge>}
          </div>

          <h1 className="mt-3 font-serif text-[24px] font-semibold leading-[1.22] tracking-[-0.015em] text-ink sm:text-[28px]">
            {article.title}
          </h1>

          {/* Две независимые кнопки генерации — только выбранный формат */}
          <div className="mt-4 rounded-[8px] border border-line bg-paper/70 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="accent"
                size="md"
                loading={isGeneratingShort}
                disabled={isBusy}
                onClick={() => handleGenerateClick("short")}
                icon={<Sparkles size={14} />}
                className="flex-1 sm:flex-initial"
              >
                {isGeneratingShort ? "Генерация короткого…" : "Сгенерировать короткий пост"}
              </Button>
              <Button
                variant="primary"
                size="md"
                loading={isGeneratingLong}
                disabled={isBusy}
                onClick={() => handleGenerateClick("long")}
                icon={<Sparkles size={14} />}
                className="flex-1 sm:flex-initial"
              >
                {isGeneratingLong ? "Генерация расширенного…" : "Сгенерировать расширенный пост"}
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              Каждый формат запрашивается отдельно через {activeProviderLabel} ({activeModel}).
              Короткий — 1–2 предложения (~200–280 симв.), расширенный — 3–5 предложений (~450–550
              симв.).
            </p>

            {(existingShort || existingLong) && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
                <span className="text-[11px] text-muted">Готовые черновики:</span>
                {existingShort && (
                  <button
                    type="button"
                    onClick={() => onOpenDraft(existingShort.id)}
                    className="inline-flex items-center gap-1 rounded-[5px] border border-moss/30 bg-moss-soft px-2 py-1 text-[11.5px] font-medium text-moss transition-colors hover:border-moss/50"
                  >
                    Короткий ({charCount(existingShort.text)} симв.) <ArrowRight size={11} />
                  </button>
                )}
                {existingLong && (
                  <button
                    type="button"
                    onClick={() => onOpenDraft(existingLong.id)}
                    className="inline-flex items-center gap-1 rounded-[5px] border border-blue/30 bg-blue-soft px-2 py-1 text-[11.5px] font-medium text-blue transition-colors hover:border-blue/50"
                  >
                    Расширенный ({charCount(existingLong.text)} симв.) <ArrowRight size={11} />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Сообщение о недостаточном источнике */}
          {activeFeedback?.kind === "insufficient" && (
            <div className="anim-rise mt-3 rounded-[7px] border border-amber/35 bg-amber-soft/60 p-3.5">
              <div className="flex items-start gap-2">
                <FileWarning size={15} className="mt-0.5 shrink-0 text-amber" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-[12.5px] font-semibold text-ink">
                    Недостаточно данных в статье
                  </p>
                  <ul className="space-y-1 text-[12px] leading-relaxed text-ink-soft">
                    {activeFeedback.warnings.map((warning) => (
                      <li key={warning}>• {warning}</li>
                    ))}
                  </ul>
                  <div className="pt-1">
                    <Button
                      variant="secondary"
                      size="xs"
                      loading={extracting}
                      onClick={() => void handleExtract()}
                      icon={<FileSearch size={12} />}
                    >
                      Извлечь полный текст
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Сообщение об ошибке AI-провайдера */}
          {activeFeedback?.kind === "error" && (
            <div className="anim-rise mt-3 rounded-[7px] border border-rose/30 bg-rose/[0.06] p-3.5">
              <div className="flex items-start gap-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-semibold text-ink">
                    Не удалось создать пост ({AI_PROVIDER_LABELS[activeFeedback.provider]})
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">
                    {activeFeedback.message}
                  </p>
                  {activeFeedback.retryAfterMs && (
                    <p className="mt-1 text-[11px] text-muted">
                      {AI_PROVIDER_LABELS[activeFeedback.provider]} рекомендует повторить через{" "}
                      {Math.max(1, Math.ceil(activeFeedback.retryAfterMs / 1000))} сек.
                    </p>
                  )}
                  {activeFeedback.technical && (
                    <p className="mt-1.5 font-mono text-[10.5px] text-muted">
                      Код ответа: {activeFeedback.technical}
                    </p>
                  )}
                  {activeFeedback.retryable && (
                    <div className="mt-2">
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => handleGenerateClick(activeFeedback.format)}
                        icon={<RefreshCw size={11} />}
                      >
                        Повторить запрос
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Предложение извлечь полный текст, если в RSS пришёл только анонс */}
          {article.extraction !== "full" && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5 rounded-[7px] border border-amber/30 bg-amber-soft/45 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-ink">
                  {article.extraction === "insufficient"
                    ? "В ленте только короткий анонс"
                    : article.extraction === "failed"
                      ? "Полный текст загрузить не удалось"
                      : "Доступен неполный текст статьи"}
                </p>
                {article.extractionNote && (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                    {article.extractionNote}
                  </p>
                )}
              </div>
              <Button
                variant="secondary"
                size="sm"
                loading={extracting}
                onClick={() => void handleExtract()}
                icon={<FileSearch size={13} />}
              >
                Извлечь полный текст
              </Button>
            </div>
          )}

          {/* Содержимое статьи. Санитизация непосредственно перед рендерингом —
              защита даже от записей, уже прошедших через хранилище/импорт. */}
          {article.contentHtml ? (
            <div
              className="prose-editorial mt-5"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(article.contentHtml) }}
            />
          ) : (
            <p className="mt-5 font-serif text-[16px] leading-[1.7] text-ink-soft">
              {article.excerpt || "Текст статьи в ленте отсутствует. Откройте оригинал на сайте."}
            </p>
          )}

          {/* Ссылка на оригинал */}
          <div className="mt-7 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-[12px] text-muted">
            <span className="truncate">
              Источник: <span className="font-medium text-ink-soft">{domainOf(article.url)}</span>
            </span>
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-accent-ink hover:underline"
            >
              Открыть оригинал <ExternalLink size={12} />
            </a>
          </div>
        </article>
      </div>

      {/* Диалог ключа / согласия перед первой генерацией для выбранного провайдера */}
      <ProviderConsentDialog
        open={consentSnapshot !== null}
        provider={consentSnapshot?.provider || activeProvider}
        model={consentSnapshot?.model || activeModel}
        format={consentSnapshot?.format || "short"}
        onClose={() => setConsentSnapshot(null)}
        onProceed={handleConsentProceed}
        onOpenSettings={onOpenSettings}
      />

      {/* Предупреждение о замене уже существующего черновика этого формата */}
      <ReplaceDraftDialog
        open={replaceTarget !== null}
        draft={replaceTarget?.draft || null}
        targetProvider={replaceTarget?.snapshot.provider || activeProvider}
        onClose={() => setReplaceTarget(null)}
        onOpenExisting={onOpenDraft}
        onConfirmReplace={() => {
          if (!replaceTarget) return;
          const { snapshot, draft } = replaceTarget;
          void executeGeneration(snapshot, draft.id);
        }}
      />

      {/* Подтверждение удаления статьи */}
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          deleteArticle(article.id);
          onBack();
        }}
        title="Удалить статью из ленты?"
        description={`«${article.title}» будет удалена из списка новостей.`}
        note="Готовые черновики по этой статье останутся в разделе «Черновики»."
        confirmLabel="Удалить"
      />
    </section>
  );
}

function ExtractionBadge({ status }: { status: Article["extraction"] }) {
  switch (status) {
    case "full":
      return <Badge tone="moss">Полный текст</Badge>;
    case "partial":
      return <Badge tone="amber">Фрагмент</Badge>;
    case "insufficient":
      return <Badge tone="amber">Мало текста</Badge>;
    case "failed":
      return <Badge tone="rose">Не удалось извлечь</Badge>;
    default:
      return <Badge tone="neutral">Из RSS</Badge>;
  }
}