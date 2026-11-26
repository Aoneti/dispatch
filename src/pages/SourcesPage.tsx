import { useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Rss,
  Trash2,
} from "lucide-react";
import type { Source } from "../lib/types";
import { useStore } from "../lib/store";
import {
  Button,
  EmptyState,
  IconButton,
  Modal,
  SourceMark,
  StatusDot,
  Toggle,
} from "../components/ui";
import { cn, domainOf, formatRelative, pluralRu } from "../lib/utils";

interface SourcesProps {
  onAddSource: () => void;
  onEditSource: (source: Source) => void;
}

export function SourcesPage({ onAddSource, onEditSource }: SourcesProps) {
  const {
    sources,
    articles,
    refreshSource,
    refreshAll,
    isRefreshingAll,
    syncingIds,
    toggleSource,
    deleteSource,
    loadOlderArticles,
    notify,
  } = useStore();
  const [deleteTarget, setDeleteTarget] = useState<Source | null>(null);
  const [removeArticles, setRemoveArticles] = useState(true);

  const countFor = (id: string) => articles.filter((article) => article.sourceId === id).length;
  const unreadFor = (id: string) => articles.filter((article) => article.sourceId === id && article.readAt === null).length;
  const hasEnabled = sources.some((source) => source.enabled);

  const handleToggle = (source: Source) => {
    toggleSource(source.id);
    notify({
      title: source.enabled ? `Источник «${source.name}» отключён` : `Источник «${source.name}» включён`,
      description: source.enabled
        ? "Лента не будет обновляться, пока вы не включите её снова."
        : "Лента снова участвует в обновлении новостей.",
      variant: "info",
    });
  };

  return (
    <div className="mx-auto w-full max-w-[920px] px-4 pb-12 pt-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">
            Источники
          </h1>
          <p className="mt-1 text-[12.5px] text-muted">
            RSS 2.0 и Atom-ленты. Статьи из всех включённых источников собираются в общую ленту.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sources.length > 0 && (
            <Button
              variant="secondary"
              size="md"
              onClick={() => void refreshAll(true)}
              loading={isRefreshingAll}
              disabled={!hasEnabled}
              icon={<RefreshCw size={13} />}
            >
              Обновить все
            </Button>
          )}
          <Button variant="primary" size="md" onClick={onAddSource} icon={<Plus size={14} />}>
            Добавить источник
          </Button>
        </div>
      </div>

      {sources.length === 0 ? (
        <div className="mt-6 rounded-[8px] border border-line bg-surface shadow-card">
          <EmptyState
            icon={<Rss size={21} />}
            title="Список источников пуст"
            description="Добавьте прямую ссылку на RSS или Atom-ленту нужного издания. Можно подключить сколько угодно источников — Chrome запросит разрешение только для каждого выбранного сайта."
            action={
              <Button variant="primary" size="md" onClick={onAddSource} icon={<Plus size={14} />}>
                Добавить RSS-ленту
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-5 overflow-hidden rounded-[8px] border border-line bg-surface shadow-card">
          {sources.map((source) => {
            const count = countFor(source.id);
            const unread = unreadFor(source.id);
            const syncing = syncingIds.includes(source.id) || source.status === "syncing";
            return (
              <div
                key={source.id}
                className={cn(
                  "border-b border-line last:border-b-0",
                  !source.enabled && "bg-paper/45"
                )}
              >
                <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                  <SourceMark name={source.name} muted={!source.enabled} />

                  <div className="min-w-[160px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onEditSource(source)}
                        className="truncate text-left text-[13.5px] font-medium text-ink hover:underline"
                      >
                        {source.name}
                      </button>
                      <span className="inline-flex items-center gap-1.5 text-[11px]">
                        {syncing ? (
                          <span className="inline-flex items-center gap-1 text-amber">
                            <LoaderCircle size={11} className="spin-slow" /> Обновление…
                          </span>
                        ) : !source.enabled ? (
                          <span className="inline-flex items-center gap-1 text-faint">
                            <StatusDot tone="idle" /> Отключён
                          </span>
                        ) : source.status === "error" ? (
                          <span className="inline-flex items-center gap-1 text-rose">
                            <StatusDot tone="error" /> Ошибка
                          </span>
                        ) : source.status === "ok" ? (
                          <span className="inline-flex items-center gap-1 text-moss">
                            <StatusDot tone="ok" /> Активен
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-muted">
                            <StatusDot tone="idle" /> Ожидает обновления
                          </span>
                        )}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted">
                      <a
                        href={source.siteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:text-ink"
                      >
                        {domainOf(source.siteUrl)}
                        <ExternalLink size={10} />
                      </a>
                      <span className="text-line-strong">·</span>
                      <span>{pluralRu(count, "статья", "статьи", "статей")}</span>
                      {source.feedItemCount !== undefined && (
                        <>
                          <span className="text-line-strong">·</span>
                          <span>В ленте: {source.feedItemCount}</span>
                        </>
                      )}
                      {unread > 0 && (
                        <>
                          <span className="text-line-strong">·</span>
                          <span className="text-accent">{pluralRu(unread, "непрочитанная", "непрочитанные", "непрочитанных")}</span>
                        </>
                      )}
                      {source.lastSyncAt && (
                        <>
                          <span className="text-line-strong">·</span>
                          <span>{formatRelative(source.lastSyncAt)}</span>
                        </>
                      )}
                    </div>
                    {source.enabled && source.status === "ok" && source.feedItemCount !== undefined && !source.nextOlderPage && (
                      <p className="mt-1 text-[10.5px] text-faint">
                        Издатель отдаёт в ленту последние {pluralRu(source.feedItemCount, "публикацию", "публикации", "публикаций")}; доступ к более ранним публикациям через эту ленту не предоставлен.
                      </p>
                    )}
                  </div>

                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    {source.nextOlderPage && (
                      <IconButton
                        label={`Загрузить более старые публикации «${source.name}»`}
                        size="sm"
                        disabled={syncing}
                        onClick={() => void loadOlderArticles(source.id)}
                      >
                        <Plus size={14} />
                      </IconButton>
                    )}
                    <Toggle
                      checked={source.enabled}
                      onChange={() => handleToggle(source)}
                      label={source.enabled ? `Отключить ${source.name}` : `Включить ${source.name}`}
                    />
                    <span className="mx-1 h-4 w-px bg-line" />
                    <IconButton
                      label={`Обновить «${source.name}»`}
                      size="sm"
                      disabled={syncing}
                      onClick={() => void refreshSource(source.id, true)}
                    >
                      <RefreshCw size={14} className={syncing ? "spin-slow" : ""} />
                    </IconButton>
                    <IconButton
                      label={`Редактировать «${source.name}»`}
                      size="sm"
                      onClick={() => onEditSource(source)}
                    >
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton
                      label={`Удалить «${source.name}»`}
                      size="sm"
                      className="hover:text-rose"
                      onClick={() => {
                        setDeleteTarget(source);
                        setRemoveArticles(true);
                      }}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                </div>

                {source.status === "error" && source.lastError && (
                  <div className="flex items-start gap-2 border-t border-rose/15 bg-rose/[0.05] px-4 py-2 text-[11.5px] leading-relaxed text-rose">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    <span>{source.lastError}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Удалить источник?"
        description={
          deleteTarget
            ? `Источник «${deleteTarget.name}» будет удалён из списка.`
            : undefined
        }
        size="sm"
        icon={<Trash2 size={17} />}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>
              Отмена
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (!deleteTarget) return;
                deleteSource(deleteTarget.id, removeArticles);
                setDeleteTarget(null);
              }}
            >
              Удалить
            </Button>
          </>
        }
      >
        <div className="space-y-2.5">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-[6px] border border-line bg-paper/60 p-3 text-[12px] leading-relaxed text-ink-soft">
            <input
              type="checkbox"
              checked={removeArticles}
              onChange={(event) => setRemoveArticles(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
            <span>
              Также удалить загруженные статьи этого источника (
              {deleteTarget ? countFor(deleteTarget.id) : 0})
            </span>
          </label>
          <p className="text-[11px] text-muted">
            Сохранённые черновики постов останутся нетронутыми.
          </p>
        </div>
      </Modal>
    </div>
  );
}
