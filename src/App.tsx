import { useCallback, useEffect, useState } from "react";
import type { PageKey, Source } from "./lib/types";
import { pushUnreadCountToBadge, StoreProvider, useStore } from "./lib/store";
import { cn } from "./lib/utils";
import { BottomNav, Sidebar, Topbar } from "./components/shell";
import { SourceDialog } from "./components/SourceDialog";
import { ToastViewport } from "./components/ui";
import { InboxPage } from "./pages/InboxPage";
import { SourcesPage } from "./pages/SourcesPage";
import { DraftsPage } from "./pages/DraftsPage";
import { SettingsPage } from "./pages/SettingsPage";

function Workspace() {
  const {
    refreshAll,
    purgeOldArticles,
    settings,
    articles,
    markRead,
    toggleSaved,
    hydrated,
    hasLocalCache,
  } = useStore();
  const [page, setPage] = useState<PageKey>("inbox");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);

  const navigate = useCallback((next: PageKey) => {
    setPage(next);
    setMobileNavOpen(false);
  }, []);

  const openAddSource = useCallback(() => {
    setEditingSource(null);
    setSourceDialogOpen(true);
  }, []);

  const openEditSource = useCallback((source: Source) => {
    setEditingSource(source);
    setSourceDialogOpen(true);
  }, []);

  const openDraft = useCallback((draftId: string) => {
    setSelectedDraftId(draftId);
    setPage("drafts");
    setMobileNavOpen(false);
  }, []);

  // Простое автоматическое обновление только RSS-лент (Gemini никогда не вызывается).
  useEffect(() => {
    const runtime = (
      globalThis as unknown as {
        chrome?: {
          runtime?: {
            onMessage?: {
              addListener: (handler: (message: { type?: string }) => void) => void;
              removeListener?: (handler: (message: { type?: string }) => void) => void;
            };
          };
        };
      }
    ).chrome?.runtime;

    if (runtime?.onMessage) {
      const handler = (message: { type?: string }) => {
        if (message?.type === "dispatch:sync-due") {
          void refreshAll(false);
        }
      };
      runtime.onMessage.addListener(handler);
      return () => runtime.onMessage?.removeListener?.(handler);
    }

    // Интервал берётся из настроек пользователя (минимум 15 минут).
    const minutes = Math.max(15, Math.floor(settings.syncMinutes) || 30);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshAll(false);
      }
    }, minutes * 60_000);
    return () => window.clearInterval(timer);
  }, [refreshAll, settings.syncMinutes]);

  // Передаём выбранный интервал фоновому service worker для Chrome Alarms.
  useEffect(() => {
    const local = (
      globalThis as unknown as {
        chrome?: {
          storage?: {
            local?: {
              set: (items: Record<string, unknown>) => Promise<void>;
            };
          };
        };
      }
    ).chrome?.storage?.local;
    if (!local?.set) return;
    void local
      .set({ dispatchSyncMinutes: Math.max(15, Math.floor(settings.syncMinutes) || 30) })
      .catch(() => undefined);
  }, [settings.syncMinutes]);

  // Если фоновое расписание сработало, пока панель была закрыта, обновляем только RSS при открытии.
  useEffect(() => {
    const storage = (
      globalThis as unknown as {
        chrome?: {
          storage?: {
            local?: {
              get: (key: string) => Promise<Record<string, unknown>>;
            };
          };
        };
      }
    ).chrome?.storage?.local;
    if (!storage) return;
    storage
      .get("dispatchSyncDueAt")
      .then((res) => {
        if (typeof res?.dispatchSyncDueAt === "number" && res.dispatchSyncDueAt > 0) {
          void refreshAll(false);
        }
      })
      .catch(() => undefined);
  }, [refreshAll]);

  // Автоматическая очистка старых прочитанных статей только при включении пользователем.
  useEffect(() => {
    if (!settings.autoCleanupEnabled) return;
    const interval = window.setInterval(() => {
      purgeOldArticles();
    }, 86_400_000);
    return () => window.clearInterval(interval);
  }, [purgeOldArticles, settings.autoCleanupEnabled]);

  // Уведомление фонового скрипта об обновлении счётчика непрочитанных.
  useEffect(() => {
    pushUnreadCountToBadge(articles);
  }, [articles]);

  // Клавиатурное управление в открытом просмотре: R — прочитано/не прочитано, S — в сохранённые.
  useEffect(() => {
    if (page !== "inbox" || !selectedArticleId) return;
    const article = articles.find((a) => a.id === selectedArticleId);
    if (!article) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "r") {
        event.preventDefault();
        markRead(article.id, article.readAt === null);
      } else if (key === "s") {
        event.preventDefault();
        toggleSaved(article.id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [page, selectedArticleId, articles, markRead, toggleSaved]);

  const splitLayout = page === "inbox" || page === "drafts";
  // Индикатор восстановления данных показываем только когда быстрого кэша нет
  // (при наличии кэша первый рендер мгновенный, IndexedDB лишь уточняет данные).
  const restoring = !hydrated && !hasLocalCache;

  return (
    <div className="flex h-[100dvh] min-h-0 overflow-hidden bg-paper text-ink">
      <Sidebar
        page={page}
        onNavigate={navigate}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar page={page} onOpenMobile={() => setMobileNavOpen(true)} />

        <main className={cn("min-h-0 flex-1", splitLayout ? "overflow-hidden" : "overflow-y-auto")}>
          {restoring ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-accent" />
                <p className="text-[12px] text-muted">Восстановление данных из локального хранилища…</p>
              </div>
            </div>
          ) : (
          <>
          {page === "inbox" && (
            <InboxPage
              selectedId={selectedArticleId}
              onSelect={setSelectedArticleId}
              onAddSource={openAddSource}
              onOpenDraft={openDraft}
              onOpenSettings={() => navigate("settings")}
            />
          )}
          {page === "sources" && (
            <SourcesPage onAddSource={openAddSource} onEditSource={openEditSource} />
          )}
          {page === "drafts" && (
            <DraftsPage
              selectedDraftId={selectedDraftId}
              onSelectDraft={setSelectedDraftId}
              onOpenInbox={() => navigate("inbox")}
            />
          )}
          {page === "settings" && <SettingsPage />}
          </>
          )}
        </main>

        <BottomNav page={page} onNavigate={navigate} />
      </div>

      <SourceDialog
        open={sourceDialogOpen}
        onClose={() => setSourceDialogOpen(false)}
        source={editingSource}
      />

      <ToastViewport />
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Workspace />
    </StoreProvider>
  );
}
