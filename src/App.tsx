import { useCallback, useEffect, useState } from "react";
import type { PageKey, Source } from "./lib/types";
import { DEFAULT_SYNC_MINUTES } from "./lib/types";
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
  const { refreshAll, purgeOldArticles, settings, articles } = useStore();
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

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshAll(false);
      }
    }, DEFAULT_SYNC_MINUTES * 60_000);
    return () => window.clearInterval(timer);
  }, [refreshAll]);

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

  const splitLayout = page === "inbox" || page === "drafts";

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
