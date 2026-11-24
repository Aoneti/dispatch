import {
  FileText,
  KeyRound,
  Menu,
  Moon,
  Newspaper,
  RefreshCw,
  Rss,
  Settings,
  Sun,
  X,
} from "lucide-react";
import type { PageKey } from "../lib/types";
import { GEMINI_MODEL } from "../lib/types";
import { cn, formatRelative } from "../lib/utils";
import { useStore } from "../lib/store";
import { IconButton, StatusDot } from "./ui";

export const PAGE_LABELS: Record<PageKey, string> = {
  inbox: "Новости",
  sources: "Источники",
  drafts: "Черновики",
  settings: "Настройки",
};

const NAV_ITEMS: Array<{ key: PageKey; label: string; icon: React.ReactNode }> = [
  { key: "inbox", label: "Новости", icon: <Newspaper size={16} strokeWidth={1.8} /> },
  { key: "sources", label: "Источники", icon: <Rss size={16} strokeWidth={1.8} /> },
  { key: "drafts", label: "Черновики", icon: <FileText size={16} strokeWidth={1.8} /> },
  { key: "settings", label: "Настройки", icon: <Settings size={16} strokeWidth={1.8} /> },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative flex h-[28px] w-[28px] items-center justify-center rounded-[6px] bg-ink text-paper">
        <Rss size={14} strokeWidth={2} />
        <span className="absolute -bottom-px -right-px h-[8px] w-[8px] rounded-tl-[3px] rounded-br-[5px] border border-paper bg-accent" />
      </div>
      <div className="min-w-0">
        <div className="font-serif text-[17px] font-semibold leading-none tracking-[-0.015em] text-ink">
          Dispatch
        </div>
        <div className="mt-[3px] font-mono text-[8.5px] uppercase leading-none tracking-[0.1em] text-faint">
          RSS в X
        </div>
      </div>
    </div>
  );
}

function SidebarContent({
  page,
  onNavigate,
  onClose,
}: {
  page: PageKey;
  onNavigate: (page: PageKey) => void;
  onClose?: () => void;
}) {
  const { articles, sources, drafts, settings } = useStore();

  const counts: Partial<Record<PageKey, number>> = {
    inbox: articles.length,
    sources: sources.length,
    drafts: drafts.length,
  };

  const go = (next: PageKey) => {
    onNavigate(next);
    onClose?.();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-13 shrink-0 items-center justify-between border-b border-line px-4">
        <Brand />
        {onClose && (
          <IconButton label="Закрыть меню" size="sm" onClick={onClose}>
            <X size={16} />
          </IconButton>
        )}
      </div>

      <nav aria-label="Основная навигация" className="flex-1 space-y-1 overflow-y-auto px-2.5 py-4">
        {NAV_ITEMS.map((item) => {
          const active = page === item.key;
          const count = counts[item.key];
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => go(item.key)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-left text-[13px] transition-colors",
                active
                  ? "border border-line bg-surface font-medium text-ink shadow-card"
                  : "border border-transparent text-muted hover:bg-ink/[0.035] hover:text-ink dark:hover:bg-white/[0.04]"
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-accent" />
              )}
              <span className={cn("shrink-0", active ? "text-ink" : "text-faint")}>{item.icon}</span>
              <span className="flex-1 truncate">{item.label}</span>
              {typeof count === "number" && count > 0 && (
                <span className="font-mono text-[10px] leading-none text-faint">{count}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-line p-2.5">
        <button
          type="button"
          onClick={() => go("settings")}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-[6px] border px-2.5 py-2 text-left transition-colors",
            settings.apiKey
              ? "border-line bg-surface hover:border-line-strong"
              : "border-accent/25 bg-accent-soft/60 hover:bg-accent-soft"
          )}
        >
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border",
              settings.apiKey
                ? "border-moss/25 bg-moss-soft text-moss"
                : "border-accent/25 bg-surface text-accent"
            )}
          >
            <KeyRound size={12} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11.5px] font-medium text-ink">
              {settings.apiKey ? "Gemini подключён" : "Укажите API-ключ"}
            </span>
            <span className="mt-0.5 block truncate font-mono text-[9px] text-muted">
              {GEMINI_MODEL}
            </span>
          </span>
          <StatusDot tone={settings.apiKey ? "ok" : "idle"} />
        </button>
      </div>
    </div>
  );
}

export function Sidebar({
  page,
  onNavigate,
  mobileOpen,
  onCloseMobile,
}: {
  page: PageKey;
  onNavigate: (page: PageKey) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  return (
    <>
      <aside className="hidden h-full w-[224px] shrink-0 flex-col border-r border-line bg-paper lg:flex">
        <SidebarContent page={page} onNavigate={onNavigate} />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="anim-fade absolute inset-0 bg-[#171612]/40 backdrop-blur-[1.5px]"
            onClick={onCloseMobile}
            aria-hidden
          />
          <aside className="anim-rise relative flex h-full w-[256px] flex-col border-r border-line bg-paper shadow-lift">
            <SidebarContent page={page} onNavigate={onNavigate} onClose={onCloseMobile} />
          </aside>
        </div>
      )}
    </>
  );
}

export function Topbar({
  page,
  onOpenMobile,
}: {
  page: PageKey;
  onOpenMobile: () => void;
}) {
  const { sources, settings, updateSettings, refreshAll, isRefreshingAll } = useStore();
  const hasEnabled = sources.some((source) => source.enabled);
  const latestSync = sources.reduce((max, source) => Math.max(max, source.lastSyncAt || 0), 0);
  const isDark =
    settings.theme === "dark" ||
    (settings.theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  return (
    <header className="flex h-13 shrink-0 items-center gap-2.5 border-b border-line bg-paper px-3 sm:px-5">
      <IconButton label="Открыть меню" onClick={onOpenMobile} className="lg:hidden">
        <Menu size={17} />
      </IconButton>

      <span className="font-serif text-[16px] font-semibold text-ink lg:text-[14px] lg:font-sans lg:font-medium">
        {PAGE_LABELS[page]}
      </span>

      <div className="ml-auto flex items-center gap-1.5">
        {hasEnabled && (
          <button
            type="button"
            onClick={() => void refreshAll(true)}
            disabled={isRefreshingAll}
            title="Обновить все включённые RSS-ленты"
            className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-transparent px-2.5 text-[11.5px] text-muted transition-colors hover:border-line hover:bg-surface hover:text-ink disabled:opacity-60"
          >
            <RefreshCw size={13} className={isRefreshingAll ? "spin-slow text-accent" : ""} />
            <span className="hidden sm:inline">
              {isRefreshingAll
                ? "Обновление…"
                : latestSync
                  ? `Обновлено: ${formatRelative(latestSync).toLowerCase()}`
                  : "Обновить ленты"}
            </span>
          </button>
        )}

        <IconButton
          label={isDark ? "Включить светлую тему" : "Включить тёмную тему"}
          onClick={() => updateSettings({ theme: isDark ? "light" : "dark" })}
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </IconButton>
      </div>
    </header>
  );
}

export function BottomNav({
  page,
  onNavigate,
}: {
  page: PageKey;
  onNavigate: (page: PageKey) => void;
}) {
  return (
    <nav
      aria-label="Нижняя навигация"
      className="flex h-[54px] shrink-0 items-center justify-around border-t border-line bg-paper lg:hidden"
    >
      {NAV_ITEMS.map((item) => {
        const active = page === item.key;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onNavigate(item.key)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-full flex-1 flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition-colors",
              active ? "text-accent" : "text-muted hover:text-ink"
            )}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
