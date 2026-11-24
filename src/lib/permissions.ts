type ChromePermissions = {
  request?: (permissions: { origins?: string[] }) => Promise<boolean>;
  contains?: (permissions: { origins?: string[] }) => Promise<boolean>;
};

function permissionApi(): ChromePermissions | null {
  const chromeApi = (globalThis as unknown as { chrome?: { permissions?: ChromePermissions } }).chrome;
  return chromeApi?.permissions ?? null;
}

export function isExtensionContext(): boolean {
  return Boolean(permissionApi()?.request);
}

/**
 * Запрашивает optional_host_permissions только для конкретного домена RSS-источника
 * или страницы статьи. Должна вызываться напрямую в ответ на клик пользователя.
 */
export async function ensureHostAccess(rawUrl: string): Promise<boolean> {
  const api = permissionApi();
  if (!api?.request) return true;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const origin = `${url.origin}/*`;
    if (api.contains) {
      const already = await api.contains({ origins: [origin] });
      if (already) return true;
    }
    return await api.request({ origins: [origin] });
  } catch {
    return false;
  }
}

export async function hasHostAccess(rawUrl: string): Promise<boolean> {
  const api = permissionApi();
  if (!api?.contains) return true;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return await api.contains({ origins: [`${url.origin}/*`] });
  } catch {
    return false;
  }
}
