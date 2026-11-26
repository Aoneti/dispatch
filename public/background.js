/**
 * Dispatch — фоновый service worker (Manifest V3).
 *
 * Открывает боковую панель при нажатии на иконку расширения и поддерживает
 * простое фоновое расписание обновления RSS-лент (каждые 30 минут).
 * Запросы к Google Gemini из фонового скрипта никогда не выполняются.
 */

const ALARM_NAME = "dispatch-rss-sync";
const DEFAULT_SYNC_MINUTES = 30;
const MIN_SYNC_MINUTES = 15; // Chrome Alarms не поддерживает интервалы короче 1 минуты, 15 — разумный минимум.
const BADGE_COLOR = "#d94f2b";

async function readSyncMinutes() {
  try {
    const res = await chrome.storage.local.get("dispatchSyncMinutes");
    const value = Number(res.dispatchSyncMinutes);
    return Number.isFinite(value) && value >= MIN_SYNC_MINUTES ? Math.floor(value) : DEFAULT_SYNC_MINUTES;
  } catch {
    return DEFAULT_SYNC_MINUTES;
  }
}

async function scheduleAutoSync() {
  const minutes = await readSyncMinutes();
  try {
    await chrome.alarms.clear(ALARM_NAME);
    await chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: minutes,
      periodInMinutes: minutes,
    });
  } catch (error) {
    console.warn("Не удалось настроить расписание обновления Dispatch:", error);
  }
}

async function notifyOpenPanel() {
  try {
    const contexts =
      typeof chrome.runtime.getContexts === "function"
        ? await chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL", "TAB"] })
        : [];
    if (contexts.length === 0) return;
    await chrome.runtime.sendMessage({ type: "dispatch:sync-due" }).catch(() => undefined);
  } catch {
    // Открытой панели нет — отметка сохранится до следующего открытия.
  }
}

async function markSyncDue() {
  try {
    await chrome.storage.local.set({ dispatchSyncDueAt: Date.now() });
  } catch {
    // Значок необязателен.
  }
  await notifyOpenPanel();
}

async function clearSyncDue() {
  try {
    await chrome.storage.local.set({ dispatchSyncDueAt: 0 });
  } catch {
    // Значок необязателен.
  }
}

async function updateUnreadBadge(count) {
  try {
    if (!chrome.action) return;
    const text = count > 0 ? (count > 99 ? "99+" : String(count)) : "";
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    await chrome.action.setBadgeText({ text });
    await chrome.action.setTitle({
      title: count > 0 ? `Dispatch — ${count} непрочитанных` : "Открыть Dispatch",
    });
  } catch {
    // Значок необязателен.
  }
}

async function readUnreadCount() {
  try {
    const res = await chrome.storage.local.get("dispatchUnreadCount");
    return typeof res.dispatchUnreadCount === "number" ? res.dispatchUnreadCount : 0;
  } catch {
    return 0;
  }
}

async function updateUnreadBadgeFromStorage() {
  const count = await readUnreadCount();
  await updateUnreadBadge(count);
}

function enableSidePanel() {
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      void chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch(() => undefined);
    }
  } catch {
    // Игнорируем на неподдерживаемых сборках.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  enableSidePanel();
  void scheduleAutoSync();
});

chrome.runtime.onStartup.addListener(() => {
  enableSidePanel();
  void scheduleAutoSync();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    void markSyncDue();
  }
});

// При изменении пользовательского интервала в настройках пересоздаём alarm.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.dispatchSyncMinutes) {
    void scheduleAutoSync();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "dispatch:sync-complete") {
    void clearSyncDue().then(() => updateUnreadBadgeFromStorage().then(() => sendResponse({ ok: true })));
    return true;
  }
  if (message?.type === "dispatch:unread-count") {
    void updateUnreadBadge(message?.count ?? 0).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

// Восстанавливаем значок при старте браузера.
chrome.runtime.onStartup.addListener(() => {
  void updateUnreadBadgeFromStorage();
});

enableSidePanel();
