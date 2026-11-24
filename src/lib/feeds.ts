import type { Article, ParsedFeed, ParsedFeedItem, Source } from "./types";
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

function atomLink(entry: Element): string {
  const links = Array.from(entry.querySelectorAll("link"));
  const alternate =
    links.find((link) => (link.getAttribute("rel") || "alternate") === "alternate") || links[0];
  return alternate?.getAttribute("href")?.trim() || childText(entry, ["id"]);
}

function firstDate(value: string): number {
  if (!value) return Date.now();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
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
  for (const item of rawItems) {
    const itemTitle = childText(item, ["title"]);
    const link = isAtom
      ? atomLink(item)
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
    const canonicalLink = normalizeUrl(link) || normalizeUrl(fallbackUrl);
    if (!canonicalLink) continue;
    items.push(
      normalizeItem({
        title: cleanTitle(itemTitle, "Без заголовка"),
        link: canonicalLink,
        guid: guid || canonicalLink,
        publishedAt: firstDate(dateValue),
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

  return {
    title,
    siteUrl,
    description,
    items,
    format: isAtom ? "atom" : "rss",
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

export function feedItemToArticle(item: ParsedFeedItem, source: Source): Article {
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
  };
}

export async function syncSourceFeed(
  source: Source,
  existingArticles: Article[]
): Promise<{
  articles: Article[];
  feedTitle?: string;
  notModified: boolean;
  total: number;
  etag?: string;
  lastModified?: string;
}> {
  const result = await fetchFeedXml(source.url, {
    etag: source.etag,
    lastModified: source.lastModified,
  });
  if (result.notModified) {
    return { articles: [], notModified: true, total: 0 };
  }
  const feed = parseFeedXml(result.xml, source.url);
  const existingKeys = new Set(existingArticles.flatMap((article) => articleDedupeKeys(article)));
  const added: Article[] = [];
  for (const item of feed.items.slice(0, 80)) {
    const article = feedItemToArticle(item, source);
    const keys = articleDedupeKeys(article);
    if (keys.some((key) => existingKeys.has(key))) continue;
    keys.forEach((key) => existingKeys.add(key));
    added.push(article);
  }
  return {
    articles: added,
    feedTitle: feed.title,
    notModified: false,
    total: feed.items.length,
    etag: result.etag,
    lastModified: result.lastModified,
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
