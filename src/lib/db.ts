/**
 * Локальное хранилище рабочего пространства в IndexedDB.
 * Синхронный кэш в localStorage ускоряет открытие панели; IndexedDB выступает
 * основным локальным хранилищем. API-ключ Gemini сюда никогда не записывается.
 */

const DB_NAME = "dispatch-editorial";
const DB_VERSION = 2;
const STORE = "workspace";
const RECORD_KEY = "current";

export interface WorkspaceRecord {
  savedAt: number;
  data: unknown;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB недоступен"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Не удаляем существующее хранилище, чтобы безопасно сохранить данные при миграции v1 -> v2.
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Не удалось открыть локальную базу данных"));
    request.onblocked = () => reject(new Error("Локальная база данных занята другой вкладкой"));
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

export async function readWorkspaceRecord(): Promise<WorkspaceRecord | null> {
  try {
    const db = await openDatabase();
    return await new Promise<WorkspaceRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(RECORD_KEY);
      request.onsuccess = () => {
        const value = request.result as WorkspaceRecord | undefined;
        if (!value || typeof value.savedAt !== "number" || !value.data) {
          resolve(null);
          return;
        }
        resolve(value);
      };
      request.onerror = () => reject(request.error || new Error("Ошибка чтения локальной базы данных"));
      tx.onabort = () => reject(tx.error || new Error("Операция чтения отменена"));
    });
  } catch {
    return null;
  }
}

export async function writeWorkspaceRecord(data: unknown, savedAt = Date.now()): Promise<boolean> {
  try {
    const db = await openDatabase();
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ savedAt, data } satisfies WorkspaceRecord, RECORD_KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error("Ошибка записи в локальную базу данных"));
      tx.onabort = () => reject(tx.error || new Error("Операция записи отменена"));
    });
  } catch {
    return false;
  }
}
