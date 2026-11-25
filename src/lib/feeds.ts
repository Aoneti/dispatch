import type { Article, ParsedFeed, ParsedFeedItem, Source } from "./types";
import { FEED_FETCH_MAX_ITEMS, FEED_OLDER_PAGES_LIMIT } from "./types";
import { charCount, normalizeText, normalizeUrl, sanitizeHtml, stripHtml } from "./utils";

const FEED_TIMEOUT_MS = 18_000;

export class FeedError extends Error {
  code: "invalid_url" | "unsupported_format" | "network" | "http" | "empty" | "permission";
  constructor(code: FeedError["code"], message: string) {
    super(message);
    this.name = "FeedError";
    this.code = code;
  }
}

interface FetchFeedOptions {
  etag?: string;
  lastModified?: string;
}

interface FetchXmlResult {
  xml: string;
  finalUrl: string;
  etag?: string;
  lastModified?: string;
  notModified?: boolean;
}

async function timedFetch(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Загружает RSS/Atom-ленту напрямую без сторонних CORS-прокси.
 * В Chrome-расширении доступ к конкретному домену предоставляется через optional_host_permissions.
 */
export async function fetchFeedXml(rawUrl: string, options: FetchFeedOptions = {}): Promise<FetchXmlResult> {
  const url = normalizeUrl(rawUrl);
  if (!url) {
    throw new FeedError("invalid_url", "Укажите корректный адрес ленты (http:// или https://).");
  }

  const headers: Record<string, string> = {
    Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
  };
  if (options.etag) headers["If-None-Match"] = options.etag;
  if (options.lastModified) headers["If-Modified-Since"] = options.lastModified;

  let response: Response;
  try {
    response = await timedFetch(url, { headers, credentials: "omit" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new FeedError("network", "Истекло время ожидания ответа от сервера ленты. Попробуйте позже.");
    }
    throw new FeedError(
      "network",
      "Не удалось загрузить ленту. Проверьте подключение, адрес ленты и выданное разрешение на доступ к этому сайту."
    );
  }

  if (response.status === 304) {
    return { xml: "", finalUrl: response.url || url, notModified: true };
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new FeedError("http", "Лента не найдена (HTTP 404). Проверьте правильность адреса.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new FeedError("http", `Сервер отклонил запрос (HTTP ${response.status}). Возможно, доступ к ленте ограничен.`);
    }
    if (response.status === 429) {
      throw new FeedError("http", "Сервер временно ограничил частоту запросов (HTTP 429). Попробуйте обновить позже.");
    }
    throw new FeedError("http", `Сервер вернул ошибку HTTP ${response.status}.`);
  }

  const xml = await response.text();
  if (!xml.trim()) {
    throw new FeedError("empty", "Сервер вернул пустой ответ вместо XML-ленты.");
  }

  return {
    xml,
    finalUrl: response.url || url,
    etag: response.headers.get("etag") || undefined,
    lastModified: response.headers.get("last-modified") || undefined,
  };
}

function childText(parent: Element, names: string[]): string {
  for (const name of names) {
    const target = name.toLowerCase();
    const direct = Array.from(parent.children).find((child) => child.tagName.toLowerCase() === target);
    const descendant = Array.from(parent.getElementsByTagName("*")).find(
      (child) => child.tagName.toLowerCase() === target
    );
    const el = direct || descendant;
    if (el) {
      const text = normalizeText(el.textContent || "");
      if (text) return text;
    }
  }
  return "";
}

function atomLink(entry: Element, baseUrl: string): string {
  const links = Array.from(entry.querySelectorAll("link"));
  const alternate =
    links.find((link) => (link.getAttribute("rel") || "alternate") === "alternate") || links[0];
  const href = alternate?.getAttribute("href")?.trim() || childText(entry, ["id"]);
  if (!href) return "";
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function firstDate(value: string, fallback: number): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveUrl(value: string, baseUrl: string): string {
  if (!value) return "";
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

/**
 * Находит ссылку на следующую более старую страницу ленты (RFC 5005).
 * Для RSS 2.0 ищет atom:link rel="next" или rel="prev-archive".
 * Для Atom ищет <link rel="next"> или rel="prev-archive".
 */
function findOlderPageLink(doc: Document, baseUrl: string): string | null {
  const links = Array.from(doc.querySelectorAll("link"));
  for (const link of links) {
    const rel = (link.getAttribute("rel") || "").trim().toLowerCase();
    if (rel === "next" || rel === "prev-archive") {
      const href = link.getAttribute("href")?.trim();
      if (href) {
        const resolved = resolveUrl(href, baseUrl);
        if (resolved && normalizeUrl(resolved)) return resolved;
      }
    }
  }
  return null;
}

function cleanTitle(value: string, fallback: string) {
  return normalizeText(value) || fallback;
}

function contentFromItem(item: Element, isAtom: boolean) {
  const raw = isAtom
    ? childText(item, ["content", "summary"])
    : childText(item, ["content:encoded", "encoded", "description", "summary"]);
  const html = sanitizeHtml(raw);
  const text = stripHtml(html);
  return { html, text };
}

function normalizeItem(item: ParsedFeedItem): ParsedFeedItem {
  const text = stripHtml(item.contentHtml);
  return {
    ...item,
    title: normalizeText(item.title).slice(0, 260) || "Без заголовка",
    excerpt: normalizeText(item.excerpt || text).slice(0, 400),
    contentHtml: item.contentHtml,
    contentText: text,
  };
}

export function parseFeedXml(xml: string, fallbackUrl: string): ParsedFeed {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new FeedError("unsupported_format", "По этому адресу получен некорректный XML. Нужна прямая ссылка на RSS или Atom-ленту.");
  }
  const root = doc.documentElement;
  const rootName = root?.tagName?.toLowerCase() ?? "";
  const isAtom = rootName === "feed";
  const isRss = rootName === "rss" || rootName === "rdf:rdf";
  if (!isAtom && !isRss) {
    throw new FeedError(
      "unsupported_format",
      "Формат не поддерживается: ожидается RSS 2.0 или Atom. Укажите прямую ссылку на XML-ленту, а не на главную страницу сайта."
    );
  }

  const channel = isAtom ? root : doc.querySelector("channel") || root;
  const title = cleanTitle(childText(channel, ["title"]), "Без названия");
  const description = childText(channel, ["description", "subtitle"]);
  let siteUrl = isAtom
    ? Array.from(root.querySelectorAll("link"))
        .find((link) => (link.getAttribute("rel") || "alternate") === "alternate")
        ?.getAttribute("href") || fallbackUrl
    : childText(channel, ["link"]) || fallbackUrl;

  const rawItems = isAtom
    ? Array.from(root.querySelectorAll("entry"))
    : Array.from(doc.querySelectorAll("item")).length
      ? Array.from(doc.querySelectorAll("item"))
      : Array.from(doc.querySelectorAll("item, entry"));

  const items: ParsedFeedItem[] = [];
  for (let index = 0; index < rawItems.length; index += 1) {
    const item = rawItems[index];
    const itemTitle = childText(item, ["title"]);
    const link = isAtom
      ? atomLink(item, fallbackUrl)
      : childText(item, ["link", "guid"]) || item.getAttribute("about") || "";
    const guid = isAtom
      ? childText(item, ["id"]) || link
      : childText(item, ["guid", "id"]) || link;
    const dateValue = childText(item, ["pubdate", "published", "updated", "dc:date", "date"]);
    const author =
      childText(item, ["dc:creator", "creator"]) ||
      (item.querySelector("author name")?.textContent || "").trim() ||
      childText(item, ["author"]) ||
      "";
    const content = contentFromItem(item, isAtom);
    const rawDesc = stripHtml(childText(item, ["summary", "description"]));
    if (!itemTitle && !link) continue;
    const canonicalLink = normalizeUrl(resolveUrl(link, fallbackUrl)) || normalizeUrl(fallbackUrl);
    if (!canonicalLink) continue;
    // Не подставляем Date.now() для неизвестных дат, чтобы старые публикации не всплывали вверх.
    const publishedAt = firstDate(dateValue, Date.now() - (rawItems.length - index) * 1_000);
    items.push(
      normalizeItem({
        title: cleanTitle(itemTitle, "Без заголовка"),
        link: canonicalLink,
        guid: guid || canonicalLink,
        publishedAt,
        author,
        excerpt: normalizeText(rawDesc || content.text).slice(0, 400),
        contentHtml: content.html,
        contentText: content.text,
      })
    );
  }

  if (items.length === 0) {
    throw new FeedError("empty", "Лента распознана, но не содержит ни одной публикации.");
  }

  try {
    siteUrl = new URL(siteUrl).toString();
  } catch {
    siteUrl = fallbackUrl;
  }

  const nextOlderPage = findOlderPageLink(doc, fallbackUrl);

  return {
    title,
    siteUrl,
    description,
    items,
    format: isAtom ? "atom" : "rss",
    totalItems: items.length,
    nextOlderPage,
  };
}

export async function loadFeedPreview(url: string) {
  const xmlResult = await fetchFeedXml(url);
  const feed = parseFeedXml(xmlResult.xml, url);
  return { ...feed, etag: xmlResult.etag, lastModified: xmlResult.lastModified };
}

export function canonicalizeUrl(raw: string) {
  const normalized = normalizeUrl(raw);
  if (!normalized) return raw;
  try {
    const url = new URL(normalized);
    url.hash = "";
    const tracking = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "yclid",
      "from",
    ];
    tracking.forEach((key) => url.searchParams.delete(key));
    return url.toString().replace(/\/$/, "");
  } catch {
    return normalized;
  }
}

export function fingerprint(title: string, content: string) {
  const basis = normalizeText(`${title} ${content}`)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .slice(0, 1_500);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < basis.length; i += 1) {
    const char = basis.charCodeAt(i);
    h1 = Math.imul(h1 ^ char, 2654435761);
    h2 = Math.imul(h2 ^ char, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h2 = Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

export function articleDedupeKeys(article: Pick<Article, "guid" | "url" | "title" | "contentText">) {
  const keys = [`url:${canonicalizeUrl(article.url)}`];
  if (article.guid) keys.push(`guid:${article.guid}`);
  keys.push(`hash:${fingerprint(article.title, article.contentText.slice(0, 800))}`);
  return keys;
}

export function feedItemToArticle(item: ParsedFeedItem, source: Source, feedOrder = 0): Article {
  const canonical = canonicalizeUrl(item.link);
  const contentText = item.contentText || stripHtml(item.contentHtml);
  const count = charCount(contentText);
  const extraction = count >= 550 ? "full" : count >= 180 ? "partial" : "insufficient";
  return {
    id: `art_${fingerprint(source.id, item.guid || canonical).slice(0, 12)}`,
    sourceId: source.id,
    sourceName: source.name,
    title: item.title,
    url: canonical,
    guid: item.guid || canonical,
    author: item.author || "",
    publishedAt: item.publishedAt,
    fetchedAt: Date.now(),
    excerpt: item.excerpt || contentText.slice(0, 320),
    contentHtml: item.contentHtml,
    contentText,
    extraction,
    extractionNote:
      extraction === "full"
        ? undefined
        : "В RSS передан только краткий фрагмент. Нажмите «Извлечь полный текст», чтобы загрузить статью с сайта.",
    charCount: count,
    readAt: null,
    savedAt: null,
    feedOrder,
  };
}

export interface SyncFeedResult {
  articles: Article[];
  feedTitle?: string;
  notModified: boolean;
  total: number;
  etag?: string;
  lastModified?: string;
  nextOlderPage: string | null;
}

export async function syncSourceFeed(
  source: Source,
  existingArticles: Article[]
): Promise<SyncFeedResult> {
  const result = await fetchFeedXml(source.url, {
    etag: source.etag,
    lastModified: source.lastModified,
  });
  if (result.notModified) {
    return { articles: [], notModified: true, total: 0, nextOlderPage: null };
  }
  const feed = parseFeedXml(result.xml, source.url);
  const existingKeys = new Set(existingArticles.flatMap((article) => articleDedupeKeys(article)));
  const added: Article[] = [];
  for (let i = 0; i < feed.items.length; i += 1) {
    if (i >= FEED_FETCH_MAX_ITEMS) break;
    const item = feed.items[i];
    const article = feedItemToArticle(item, source, i);
    const keys = articleDedupeKeys(article);
    if (keys.some((key) => existingKeys.has(key))) continue;
    keys.forEach((key) => existingKeys.add(key));
    added.push(article);
  }
  return {
    articles: added,
    feedTitle: feed.title,
    notModified: false,
    total: feed.totalItems,
    etag: result.etag,
    lastModified: result.lastModified,
    nextOlderPage: feed.nextOlderPage,
  };
}

/**
 * Загружает более старую страницу ленты, если издатель сообщает о пагинации.
 * Защищается от повторов и циклических ссылок.
 */
export async function syncOlderPages(
  source: Source,
  existingArticles: Article[],
  visitedUrls: Set<string>
): Promise<{
  articles: Article[];
  pagesFetched: number;
  nextOlderPage: string | null;
  finished: boolean;
}> {
  const added: Article[] = [];
  let currentUrl = source.nextOlderPage || null;
  let pagesFetched = 0;
  const existingKeys = new Set(existingArticles.flatMap((article) => articleDedupeKeys(article)));

  while (currentUrl && pagesFetched < FEED_OLDER_PAGES_LIMIT) {
    if (visitedUrls.has(currentUrl)) break;
    visitedUrls.add(currentUrl);

    let result: FetchXmlResult;
    try {
      result = await fetchFeedXml(currentUrl);
    } catch (error) {
      if (error instanceof FeedError && error.code === "http") {
        break;
      }
      throw error;
    }

    let feed: ParsedFeed;
    try {
      feed = parseFeedXml(result.xml, currentUrl);
    } catch {
      break;
    }

    let newOnPage = 0;
    for (let i = 0; i < feed.items.length; i += 1) {
      if (i >= FEED_FETCH_MAX_ITEMS) break;
      const item = feed.items[i];
      const article = feedItemToArticle(item, source, existingArticles.length + added.length + i);
      const keys = articleDedupeKeys(article);
      if (keys.some((key) => existingKeys.has(key))) continue;
      keys.forEach((key) => existingKeys.add(key));
      added.push(article);
      newOnPage += 1;
    }

    pagesFetched += 1;
    currentUrl = feed.nextOlderPage;

    if (newOnPage === 0 && added.length === 0) break;
  }

  return {
    articles: added,
    pagesFetched,
    nextOlderPage: currentUrl,
    finished: !currentUrl || visitedUrls.has(currentUrl),
  };
}

/**
 * Загружает исходную веб-страницу статьи напрямую без сторонних прокси.
 */
export async function fetchArticlePage(url: string): Promise<string> {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    throw new Error("Некорректный адрес статьи.");
  }
  let response: Response;
  try {
    response = await timedFetch(normalized, {
      credentials: "omit",
      headers: { Accept: "text/html, application/xhtml+xml;q=0.9, */*;q=0.8" },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Истекло время ожидания ответа от сайта статьи.");
    }
    throw new Error(
      "Не удалось загрузить страницу статьи. Проверьте разрешение доступа к домену или откройте оригинал в браузере."
    );
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Сайт ограничил доступ к странице (HTTP ${response.status}). Сохранён доступный текст из RSS.`);
    }
    if (response.status === 404) {
      throw new Error("Страница статьи не найдена (HTTP 404). Сохранён текст из RSS.");
    }
    throw new Error(`Не удалось загрузить страницу (HTTP ${response.status}). Сохранён текст из RSS.`);
  }
  return await response.text();
}

export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { ok: true, value: await worker(items[index]) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  });
  await Promise.all(runners);
  return results;
}
