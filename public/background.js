/**
 * Dispatch — фоновый service worker (Manifest V3).
 *
 * Открывает боковую панель при нажатии на иконку расширения и поддерживает
 * простое фоновое расписание обновления RSS-лент (каждые 30 минут).
 * Запросы к Google Gemini из фонового скрипта никогда не выполняются.
 */

const ALARM_NAME = "dispatch-rss-sync";
const DEFAULT_SYNC_MINUTES = 30;
const BADGE_COLOR = "#d94f2b";

async function scheduleAutoSync() {
  try {
    await chrome.alarms.clear(ALARM_NAME);
    await chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: DEFAULT_SYNC_MINUTES,
      periodInMinutes: DEFAULT_SYNC_MINUTES,
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
    if (chrome.action) {
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
      await chrome.action.setBadgeText({ text: "•" });
      await chrome.action.setTitle({ title: "Dispatch — доступно обновление лент" });
    }
  } catch {
    // Значок необязателен.
  }
  await notifyOpenPanel();
}

async function clearSyncDue() {
  try {
    await chrome.storage.local.set({ dispatchSyncDueAt: 0 });
    if (chrome.action) {
      await chrome.action.setBadgeText({ text: "" });
      await chrome.action.setTitle({ title: "Открыть Dispatch" });
    }
  } catch {
    // Значок необязателен.
  }
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "dispatch:sync-complete") {
    void clearSyncDue().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

enableSidePanel();
