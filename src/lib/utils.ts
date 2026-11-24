import type { ExtractionStatus } from "./types";

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function uid(prefix = "id") {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function charCount(text: string) {
  return Array.from(text ?? "").length;
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

/**
 * Склонение русских существительных по числу:
 * pluralRu(1, "статья", "статьи", "статей") -> "1 статья"
 */
export function pluralRu(count: number, one: string, few: string, many: string) {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 19) return `${formatNumber(count)} ${many}`;
  if (last === 1) return `${formatNumber(count)} ${one}`;
  if (last >= 2 && last <= 4) return `${formatNumber(count)} ${few}`;
  return `${formatNumber(count)} ${many}`;
}

export function formatRelative(timestamp: number | null | undefined) {
  if (!timestamp) return "Не обновлялось";
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "Только что";
  if (diff < 3_600_000) {
    const mins = Math.max(1, Math.floor(diff / 60_000));
    return `${mins} мин. назад`;
  }
  if (diff < 86_400_000) {
    const hours = Math.floor(diff / 3_600_000);
    return `${hours} ч. назад`;
  }
  if (diff < 172_800_000) return "Вчера";
  if (diff < 604_800_000) {
    const days = Math.floor(diff / 86_400_000);
    return `${pluralRu(days, "день", "дня", "дней")} назад`;
  }
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
  }).format(timestamp);
}

export function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

export function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(timestamp);
}

export function formatDateTime(timestamp: number) {
  return `${formatDate(timestamp)}, ${formatTime(timestamp)}`;
}

export function formatDayLabel(timestamp: number) {
  const now = new Date();
  const date = new Date(timestamp);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86_400_000;
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (startOfDay >= startToday) return "Сегодня";
  if (startOfDay >= startYesterday) return "Вчера";
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(timestamp);
}

export function initials(name: string) {
  const clean = name.replace(/^the\s+/i, "").trim();
  const parts = clean.split(/[\s-]+/).filter(Boolean);
  if (parts.length === 0) return "RS";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function normalizeUrl(raw: string) {
  let value = (raw || "").trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function isValidHttpUrl(raw: string) {
  const normalized = normalizeUrl(raw);
  if (!normalized) return false;
  try {
    const url = new URL(normalized);
    return url.hostname.includes(".") || url.hostname === "localhost";
  } catch {
    return false;
  }
}

export async function copyText(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Запасной способ копирования
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function downloadFile(filename: string, content: string, type = "application/json") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function stripHtml(html: string) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, noscript").forEach((node) => node.remove());
  return normalizeText(doc.body?.textContent || "");
}

const ALLOWED_TAGS = new Set([
  "P",
  "H2",
  "H3",
  "H4",
  "BLOCKQUOTE",
  "UL",
  "OL",
  "LI",
  "STRONG",
  "B",
  "EM",
  "I",
  "A",
  "BR",
  "FIGURE",
  "FIGCAPTION",
]);

export function sanitizeHtml(html: string) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc
    .querySelectorAll(
      "script, style, noscript, iframe, object, embed, form, input, button, svg, video, audio, img, source, link, meta"
    )
    .forEach((node) => node.remove());

  const clean = (node: Node): Node[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      return [doc.createTextNode(node.textContent || "")];
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return [];
    const element = node as Element;
    if (!ALLOWED_TAGS.has(element.tagName)) {
      return Array.from(element.childNodes).flatMap(clean);
    }
    const replacement = doc.createElement(element.tagName.toLowerCase());
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const isSafeLink =
        element.tagName === "A" &&
        (name === "href" || name === "title" || name === "rel" || name === "target");
      if (isSafeLink) replacement.setAttribute(attr.name, attr.value);
    }
    if (element.tagName === "A") {
      const href = replacement.getAttribute("href") || "";
      if (!/^https?:\/\//i.test(href) && !href.startsWith("#")) {
        replacement.removeAttribute("href");
      } else {
        replacement.setAttribute("target", "_blank");
        replacement.setAttribute("rel", "noopener noreferrer nofollow");
      }
    }
    Array.from(element.childNodes)
      .flatMap(clean)
      .forEach((child) => replacement.appendChild(child));
    return [replacement];
  };

  const container = doc.createElement("div");
  Array.from(doc.body.childNodes)
    .flatMap(clean)
    .forEach((node) => container.appendChild(node));
  return container.innerHTML;
}

const NEGATIVE_PATTERN =
  /(comment|sidebar|footer|header|menu|nav|cookie|promo|banner|advert|subscribe|paywall|related|share|social|breadcrumb|popup|modal|newsletter|teaser|recommend)/i;
const POSITIVE_PATTERN =
  /(article|content|story|post|entry|body|text|main|material|read)/i;

export interface ExtractionResult {
  title: string;
  author: string;
  html: string;
  text: string;
  status: ExtractionStatus;
  note?: string;
  charCount: number;
}

export function extractArticleFromHtml(rawHtml: string): ExtractionResult {
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");
  const title =
    normalizeText(doc.querySelector('meta[property="og:title"]')?.getAttribute("content") || "") ||
    normalizeText(doc.querySelector("h1")?.textContent || "") ||
    normalizeText(doc.title || "");
  const author =
    normalizeText(doc.querySelector('meta[name="author"]')?.getAttribute("content") || "") ||
    normalizeText(doc.querySelector('[rel="author"]')?.textContent || "");

  doc
    .querySelectorAll(
      "script, style, noscript, iframe, form, button, input, select, textarea, nav, footer, aside, header, [role=navigation], [aria-hidden=true], video, audio, picture, figure img, svg"
    )
    .forEach((node) => node.remove());

  const candidates: Array<{ node: Element; score: number }> = [];
  doc.querySelectorAll("article, main, [role=main], section, div").forEach((node) => {
    const text = normalizeText((node as HTMLElement).innerText || node.textContent || "");
    if (text.length < 300) return;
    const signature = `${node.id} ${node.className}`;
    let score = Math.min(text.length / 200, 40);
    score += node.querySelectorAll("p").length * 2.5;
    score += node.querySelectorAll("h2, h3").length * 1.5;
    if (POSITIVE_PATTERN.test(signature)) score += 12;
    if (NEGATIVE_PATTERN.test(signature)) score -= 22;
    if (node.matches("article, main, [role=main]")) score += 16;
    score -= node.querySelectorAll("a").length * 0.4;
    candidates.push({ node, score });
  });
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  if (!best) {
    const fallbackText = normalizeText(doc.body?.textContent || "");
    if (fallbackText.length >= 240) {
      const sliced = fallbackText.slice(0, 15_000);
      return {
        title,
        author,
        html: `<p>${escapeHtml(sliced)}</p>`,
        text: sliced,
        status: "partial",
        note: "Удалось извлечь только упрощённый текст страницы. При необходимости сверьтесь с оригиналом.",
        charCount: charCount(sliced),
      };
    }
    return {
      title,
      author,
      html: "",
      text: "",
      status: "failed",
      note: "На странице не найдено достаточно читаемого текста статьи.",
      charCount: 0,
    };
  }

  const clone = best.node.cloneNode(true) as Element;
  clone
    .querySelectorAll("img, picture, source, svg, canvas, video, audio, iframe, form, nav")
    .forEach((node) => node.remove());
  clone.querySelectorAll("h1").forEach((h1) => {
    const h2 = doc.createElement("h2");
    h2.textContent = h1.textContent;
    h1.replaceWith(h2);
  });

  const cleanedHtml = sanitizeHtml(clone.innerHTML);
  const text = normalizeText(
    new DOMParser().parseFromString(cleanedHtml, "text/html").body?.textContent || ""
  );
  const count = charCount(text);
  const status: ExtractionStatus =
    count >= 600 ? "full" : count >= 220 ? "partial" : "insufficient";
  return {
    title,
    author,
    html: cleanedHtml,
    text,
    status,
    note:
      status === "partial"
        ? "Извлечена только часть статьи. Перед генерацией поста сверьтесь с оригиналом."
        : status === "insufficient"
          ? "На странице удалось получить слишком мало читаемого текста."
          : undefined,
    charCount: count,
  };
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
