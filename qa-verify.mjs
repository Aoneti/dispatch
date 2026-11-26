import http from "node:http";
import fs from "node:fs";
import { chromium } from "playwright";

fs.mkdirSync("qa-shots", { recursive: true });

const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Деловая лента</title>
  <link>http://127.0.0.1:4566/</link>
  <description>Тестовая RSS 2.0 лента</description>
  <item>
    <title>Центробанк оставил ставку без изменений на заседании в пятницу</title>
    <link>http://127.0.0.1:4566/news/cb-rate?utm_source=rss</link>
    <guid>feed1-cb-rate</guid>
    <pubDate>Tue, 24 Nov 2026 09:15:00 GMT</pubDate>
    <author>Ирина Соколова</author>
    <description>Совет директоров регулятора сохранил ключевую ставку на прежнем уровне. По данным пресс-релиза, годовая инфляция замедлилась до 6,8%, но инфляционные ожидания населения остаются повышенными. Следующее заседание назначено на декабрь.</description>
  </item>
  <item>
    <title>Завод открыл новый цех электроники в Калуге</title>
    <link>http://127.0.0.1:4566/news/plant</link>
    <guid>feed1-plant</guid>
    <pubDate>Mon, 23 Nov 2026 14:30:00 GMT</pubDate>
    <description>Короткий анонс о запуске нового цеха.</description>
  </item>
</channel></rss>`;

const atomXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ТехноВести</title>
  <link href="http://127.0.0.1:4566/" rel="alternate"/>
  <entry>
    <title>Инженеры сократили задержку облачного поиска на треть</title>
    <link href="http://127.0.0.1:4566/news/search-latency" rel="alternate"/>
    <id>atom-search-1</id>
    <updated>2026-11-24T08:10:00Z</updated>
    <author><name>Алексей Морозов</name></author>
    <summary>Команда разработки обновила индексацию запросов и снизила среднюю задержку ответа с 120 до 78 миллисекунд без потери точности выдачи.</summary>
  </entry>
</feed>`;

const fullArticleHtml = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="author" content="Пётр Белов"><title>Новый цех</title></head><body>
<nav><a href="/">Главная</a></nav>
<article>
  <h1>Завод открыл новый цех электроники в Калуге</h1>
  <p>Производственное предприятие в Калуге ввело в эксплуатацию новый сборочный цех площадью 8 тысяч квадратных метров. Инвестиции в проект составили 1,4 миллиарда рублей, сообщает пресс-служба компании.</p>
  <p>На площадке установили две автоматизированные линии поверхностного монтажа печатных плат. Расчётная мощность первой очереди достигает 350 тысяч модулей в год, поставки запланированы для российских производителей промышленного оборудования.</p>
  <p>В новом подразделении создано 160 рабочих мест для инженеров и операторов. Выход цеха на плановую загрузку ожидается во втором квартале следующего года.</p>
</article>
<footer>Все права защищены</footer></body></html>`;

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "If-None-Match, If-Modified-Since, Accept");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.url?.startsWith("/rss.xml")) {
    res.writeHead(200, { "Content-Type": "application/rss+xml; charset=utf-8" });
    res.end(rssXml);
  } else if (req.url?.startsWith("/atom.xml")) {
    res.writeHead(200, { "Content-Type": "application/atom+xml; charset=utf-8" });
    res.end(atomXml);
  } else if (req.url?.startsWith("/news/plant")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fullArticleHtml);
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

await new Promise((resolve) => server.listen(4566, "127.0.0.1", resolve));

const browser = await chromium.launch();
const results = {};
const consoleErrors = [];

try {
  const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 820 }, acceptDownloads: true });
  const page = await ctx1.newPage();
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("generativelanguage") && !m.text().includes("127.0.0.1:4566")) consoleErrors.push(`console: ${m.text()}`); });

  // --- Перехват Gemini: поведение управляется глобально ---
  const geminiCalls = [];
  let geminiMode = "ok"; // ok | 429-daily | 429-rate | 503-then-ok | test-ok
  let gemini503Count = 0;
  await page.route("https://generativelanguage.googleapis.com/**", async (route) => {
    const req = route.request();
    const body = req.postDataJSON();
    geminiCalls.push({ url: req.url(), apiKey: req.headers()["x-goog-api-key"] || "", body });
    if (geminiMode === "test-ok") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }] }) });
      return;
    }
    if (geminiMode === "429-daily") {
      await route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { code: 429, message: "Free tier quota exceeded", status: "RESOURCE_EXHAUSTED", details: [{ reason: "RESOURCE_EXHAUSTED" }] } }) });
      return;
    }
    if (geminiMode === "429-rate") {
      await route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { code: 429, message: "Rate limit exceeded, retry after 1s", status: "RESOURCE_EXHAUSTED", details: [{ reason: "RATE_LIMITED" }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "1s" }] } }) });
      return;
    }
    if (geminiMode === "503-then-ok") {
      gemini503Count += 1;
      if (gemini503Count <= 2) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: 503, message: "Backend error", status: "UNAVAILABLE" } }) });
        return;
      }
      // после 2 сбоев — успех
    }
    const userText = body?.contents?.[0]?.parts?.[0]?.text || "";
    const isShort = userText.includes("один короткий пост");
    const payload = isShort
      ? { status: "ok", post: "Центробанк сохранил ключевую ставку на прежнем уровне. По данным регулятора, годовая инфляция замедлилась до 6,8%.", char_count: 100, key_facts: ["Ставка сохранена"], warnings: [], source_sufficiency: "sufficient" }
      : { status: "ok", post: "Совет директоров Центробанка на заседании в пятницу оставил ключевую ставку без изменений. Годовая инфляция замедлилась до 6,8%, однако инфляционные ожидания остаются высокими. Регулятор сохранит жёсткие условия для возврата к цели в 4%. Следующее заседание пройдёт в декабре.", char_count: 250, key_facts: ["Ставка сохранена", "Инфляция 6,8%", "Цель 4%"], warnings: ["Убедитесь в формулировке прогноза."], source_sufficiency: "sufficient" };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 60, totalTokenCount: 180 } }) });
  });

  // === 1. Пустой первый запуск ===
  await page.goto("http://127.0.0.1:4175/", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const emptyText = await page.locator("body").innerText();
  results.startsEmpty = emptyText.includes("Пока нет источников новостей") && !emptyText.includes("РБК");
  results.noGeminiOnStart = geminiCalls.length === 0;
  await page.screenshot({ path: "qa-shots/01-empty-desktop.png" });

  // === 2. Добавление лент, дедупликация, извлечение ===
  await page.getByRole("button", { name: "Добавить первую RSS-ленту" }).click();
  await page.locator("#source-url").fill("http://127.0.0.1:4566/rss.xml");
  await page.getByRole("button", { name: "Проверить ленту" }).click();
  await page.waitForTimeout(500);
  const d1 = await page.locator("[role=dialog]").innerText();
  results.rssValidated = d1.includes("Лента RSS корректна") && d1.includes("Деловая лента");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await page.waitForTimeout(400);

  await page.locator("aside nav button", { hasText: "Источники" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "Добавить источник" }).click();
  await page.locator("#source-url").fill("http://127.0.0.1:4566/atom.xml");
  await page.getByRole("button", { name: "Проверить ленту" }).click();
  await page.waitForTimeout(500);
  const d2 = await page.locator("[role=dialog]").innerText();
  results.atomValidated = d2.includes("Лента Atom корректна") && d2.includes("ТехноВести");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "qa-shots/02-sources.png" });

  await page.locator("aside nav button", { hasText: "Новости" }).click();
  await page.waitForTimeout(300);
  const inboxText = await page.locator("main").innerText();
  results.unifiedFeed = inboxText.includes("Центробанк оставил ставку") && inboxText.includes("Инженеры сократили задержку") && inboxText.includes("Завод открыл новый цех");

  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await page.waitForTimeout(600);
  const articleCount = await page.evaluate(() => JSON.parse(localStorage.getItem("dispatch.workspace.v1")).articles.length);
  results.dedupeNoDuplicates = articleCount === 3;
  // Честная подсказка об отсутствии архива в ленте (после обновления)
  await page.locator("aside nav button", { hasText: "Источники" }).click();
  await page.waitForTimeout(300);
  results.noPaginationHint = (await page.locator("main").innerText()).includes("не предоставлен");
  await page.locator("aside nav button", { hasText: "Новости" }).click();
  await page.waitForTimeout(300);

  await page.getByText("Завод открыл новый цех").first().click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "Извлечь полный текст" }).first().click();
  await page.waitForTimeout(500);
  results.fullTextExtracted = (await page.locator("main").innerText()).includes("1,4 миллиарда рублей");

  // === 3. Прочитано/сохранено: счётчики, массовое, Undo ===
  await page.getByText("Центробанк оставил ставку").first().click();
  await page.waitForTimeout(300);
  // Клавиатурные шорткаты: S — сохранить, R — переключить прочитанность
  await page.keyboard.press("s");
  await page.waitForTimeout(450);
  let state = await page.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem("dispatch.workspace.v1"));
    const a = ws.articles.find((x) => x.title.includes("Центробанк"));
    return { readAt: a.readAt, savedAt: a.savedAt };
  });
  results.keyboardS = state.savedAt !== null;
  // Ждём автоотметки прочтения (срабатывает через 1 с после открытия)
  await page.waitForTimeout(1300);
  // Статья прочитана автоматически → R возвращает её в непрочитанные
  await page.keyboard.press("r");
  await page.waitForTimeout(450);
  state = await page.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem("dispatch.workspace.v1"));
    const a = ws.articles.find((x) => x.title.includes("Центробанк"));
    return { readAt: a.readAt };
  });
  results.keyboardR = state.readAt === null;
  // Счётчик непрочитанных в бейдже навигации совпадает с хранилищем
  await page.waitForTimeout(450);
  const badgeInfo = await page.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem("dispatch.workspace.v1"));
    const unread = ws.articles.filter((a) => a.readAt === null).length;
    const badge = document.querySelector('aside nav button[aria-current="page"]')?.textContent || "";
    return { unread, badge };
  });
  results.unreadBadge = badgeInfo.badge.includes(String(badgeInfo.unread));

  // Массовое «Прочитать всё» + Undo
  await page.getByRole("tab", { name: /Непрочитанные/ }).click();
  await page.waitForTimeout(150);
  await page.getByRole("button", { name: /Прочитать всё/ }).click();
  await page.waitForTimeout(300);
  const afterMass = await page.evaluate(() => JSON.parse(localStorage.getItem("dispatch.workspace.v1")).articles.every((a) => a.readAt !== null));
  results.massReadAll = afterMass;
  const undoVisible = await page.getByRole("button", { name: "Отменить" }).isVisible();
  await page.getByRole("button", { name: "Отменить" }).click();
  await page.waitForTimeout(300);
  const afterUndo = await page.evaluate(() => JSON.parse(localStorage.getItem("dispatch.workspace.v1")).articles.filter((a) => a.readAt === null).length);
  results.undoRestores = undoVisible && afterUndo > 0;

  // === 4. Gemini: генерация, независимость, ошибки, повтор ===
  await page.getByRole("tab", { name: /Все/ }).first().click();
  await page.waitForTimeout(150);
  await page.getByText("Центробанк оставил ставку").first().click();
  await page.waitForTimeout(250);

  // Настройка Gemini
  await page.locator("aside nav button", { hasText: "Настройки" }).click();
  await page.waitForTimeout(300);
  await page.locator("#settings-gemini-key").fill("AIzaTestKeyForVerification1234567890");
  await page.getByRole("button", { name: "Сохранить ключ" }).click();
  await page.waitForTimeout(200);
  geminiMode = "test-ok";
  await page.getByRole("button", { name: "Проверить подключение" }).click();
  await page.waitForTimeout(400);
  results.testConnection = geminiCalls.length === 1 &&
    geminiCalls[0].url === "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent" &&
    geminiCalls[0].apiKey === "AIzaTestKeyForVerification1234567890";
  // Интервал синхронизации
  await page.getByLabel("Интервал обновления RSS-лент").selectOption("60");
  await page.waitForTimeout(450);
  const syncMin = await page.evaluate(() => JSON.parse(localStorage.getItem("dispatch.workspace.v1")).settings.syncMinutes);
  results.syncIntervalSetting = syncMin === 60;
  // Подтверждение передачи текста в Gemini (обязательное согласие)
  await page.getByLabel(/Разрешить отправку текста выбранной статьи/).check();
  await page.waitForTimeout(150);
  // Хints по размеру данных
  results.dataSizeShown = (await page.locator("main").innerText()).includes("КБ");
  await page.screenshot({ path: "qa-shots/03-settings.png" });

  // Вспомогательная функция: открыть статью в ленте.
  const openCbrArticle = async () => {
    await page.locator("aside nav button", { hasText: "Новости" }).click();
    await page.waitForTimeout(250);
    await page.getByText("Центробанк оставил ставку").first().click();
    await page.waitForTimeout(250);
  };

  // Короткий пост
  await openCbrArticle();
  geminiMode = "ok";
  const callsBefore = geminiCalls.length;
  await page.getByRole("button", { name: "Сгенерировать короткий пост" }).click();
  await page.waitForTimeout(900);
  const draftsAfterShort = await page.evaluate(() => JSON.parse(localStorage.getItem("dispatch.workspace.v1")).drafts);
  results.shortOneCall = geminiCalls.length - callsBefore === 1;
  results.shortOnlyDraft = draftsAfterShort.length === 1 && draftsAfterShort[0].format === "short";
  results.usageRecorded = (await page.evaluate(() => JSON.parse(localStorage.getItem("dispatch.workspace.v1")).settings.geminiUsage)).requests === 1;
  // После успешной генерации приложение само перешло в «Черновики»
  results.autoOpenedDrafts = await page.evaluate(() =>
    (document.querySelector('aside nav button[aria-current="page"]')?.textContent || "").includes("Черновики")
  );

  // Расширенный пост (независимо, из ленты)
  await openCbrArticle();
  const callsBeforeLong = geminiCalls.length;
  await page.getByRole("button", { name: "Сгенерировать расширенный пост" }).click();
  await page.waitForTimeout(900);
  const draftsAfterLong = await page.evaluate(() => JSON.parse(localStorage.getItem("dispatch.workspace.v1")).drafts);
  results.longOneCall = geminiCalls.length - callsBeforeLong === 1;
  results.twoDrafts = draftsAfterLong.length === 2;
  results.formats = draftsAfterLong.map((d) => d.format).sort().join(",");
  await page.screenshot({ path: "qa-shots/04-drafts.png" });

  // 429 daily — без повторов (через диалог замены)
  await openCbrArticle();
  geminiMode = "429-daily";
  const callsBefore429 = geminiCalls.length;
  await page.getByRole("button", { name: "Сгенерировать короткий пост" }).click();
  await page.waitForTimeout(300);
  const replaceDialog = page.locator("[role=dialog]").first();
  if (await replaceDialog.isVisible()) {
    await page.getByRole("button", { name: "Заменить" }).click();
    await page.waitForTimeout(500);
  }
  results.noRetryOn429Daily = geminiCalls.length - callsBefore429 === 1;
  results.msg429 = (await page.locator("main").innerText()).includes("лимит квоты");

  // 503 — с backoff (2 сбоя + успех = 3 запроса)
  geminiMode = "503-then-ok";
  gemini503Count = 0;
  const callsBefore503 = geminiCalls.length;
  await page.getByRole("button", { name: "Сгенерировать расширенный пост" }).click();
  await page.waitForTimeout(300);
  const repDialog2 = page.locator("[role=dialog]").first();
  if (await repDialog2.isVisible()) {
    await page.getByRole("button", { name: "Заменить" }).click();
  }
  await page.waitForTimeout(12000); // backoff ~2s + ~4s + запросы
  results.backoffThenSuccess = geminiCalls.length - callsBefore503 === 3;
  // После успеха с backoff приложение автоматически открыло черновики
  results.backoffSuccessToast = await page.evaluate(() =>
    (document.querySelector('aside nav button[aria-current="page"]')?.textContent || "").includes("Черновики")
  );

  // === 5. Сохранение после перезапуска (включая readAt/savedAt/syncMinutes) ===
  await page.waitForTimeout(350);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const persisted = await page.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem("dispatch.workspace.v1"));
    const key = localStorage.getItem("dispatch.gemini.key.v1");
    const cb = ws.articles.find((x) => x.title.includes("Центробанк"));
    return {
      articles: ws.articles.length,
      drafts: ws.drafts.length,
      syncMinutes: ws.settings.syncMinutes,
      savedKept: cb.savedAt !== null,
      keyKept: key === "AIzaTestKeyForVerification1234567890",
      noKeyInWorkspace: !JSON.stringify(ws).includes("AIzaTestKey"),
      usageKept: ws.settings.geminiUsage.requests >= 3,
    };
  });
  results.persisted = persisted;

  // Экспорт без ключа
  await page.locator("aside nav button", { hasText: "Настройки" }).click();
  await page.waitForTimeout(300);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Экспортировать JSON" }).click(),
  ]);
  const exported = fs.readFileSync(await download.path(), "utf8");
  results.exportNoKey = !exported.includes("AIzaTestKey") && exported.includes("Деловая лента") && exported.includes("syncMinutes");
  await ctx1.close();

  // === 6. Миграция v1 → v3 с сохранением данных ===
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page2 = await ctx2.newPage();
  await page2.addInitScript(() => {
    localStorage.setItem("dispatch.gemini.key.v1", "AIzaUserMigratedKey123456789012");
    localStorage.setItem("dispatch.workspace.v1", JSON.stringify({
      schemaVersion: 1,
      sources: [
        { id: "src-rbc", name: "РБК", url: "https://rssexport.rbc.ru/rbcnews/news/30/full.rss", siteUrl: "https://www.rbc.ru", enabled: true, createdAt: 1000, lastSyncAt: 2000, lastError: null, status: "ok", articleCount: 2 },
        { id: "src_user_99", name: "Мой личный RSS", url: "https://my-blog.example/rss.xml", siteUrl: "https://my-blog.example", enabled: true, createdAt: 5000, lastSyncAt: 6000, lastError: null, status: "ok", articleCount: 1 },
      ],
      articles: [
        { id: "art-cbr-rate", sourceId: "src-rbc", sourceName: "РБК", title: "Демо ЦБ", url: "https://rbc.ru/1", guid: "1", author: "", publishedAt: 2000, fetchedAt: 2000, excerpt: "", contentHtml: "<p>demo</p>", contentText: "demo", isRead: false, isSaved: true, extraction: "full", charCount: 4 },
        { id: "art_user_1", sourceId: "src_user_99", sourceName: "Мой личный RSS", title: "Моя настоящая статья", url: "https://my-blog.example/post-1", guid: "u1", author: "Автор", publishedAt: 7000, fetchedAt: 7000, excerpt: "Анонс", contentHtml: "<p>Настоящий текст</p>", contentText: "Настоящий текст", isRead: true, isSaved: false, extraction: "full", charCount: 15 },
      ],
      drafts: [
        { id: "draft-cbr", articleId: "art-cbr-rate", articleTitle: "Демо ЦБ", sourceName: "РБК", sourceUrl: "https://rbc.ru/1", createdAt: 2000, updatedAt: 2000, model: "gemini-2.5-flash", originalShort: "s", originalLong: "l", shortPost: "s", longPost: "l", warnings: [], keyFacts: [], sufficiency: "sufficient", status: "ok", edited: false, version: 1 },
        { id: "draft_user_1", articleId: "art_user_1", articleTitle: "Моя настоящая статья", sourceName: "Мой личный RSS", sourceUrl: "https://my-blog.example/post-1", createdAt: 8000, updatedAt: 9000, model: "gemini-2.5-flash", originalShort: "Исходный короткий", originalLong: "Исходный длинный", shortPost: "Мой отредактированный короткий", longPost: "Исходный длинный", warnings: ["Замечание"], keyFacts: ["Факт 1"], sufficiency: "sufficient", status: "ok", edited: true, version: 2 },
      ],
      settings: { apiKey: "", model: "gemini-2.5-flash", theme: "dark", privacyAcknowledged: true, demoData: true },
    }));
  });
  await page2.goto("http://127.0.0.1:4175/", { waitUntil: "networkidle" });
  await page2.waitForTimeout(600);
  results.migration = await page2.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem("dispatch.workspace.v1"));
    const key = localStorage.getItem("dispatch.gemini.key.v1");
    return {
      schemaVersion: ws.schemaVersion,
      sources: ws.sources.map((s) => s.id).sort().join(","),
      articles: ws.articles.map((a) => a.id).sort().join(","),
      drafts: ws.drafts.map((d) => d.id).sort().join(","),
      userDraftText: ws.drafts.find((d) => d.id === "draft_user_1_short")?.text,
      userDraftEdited: ws.drafts.find((d) => d.id === "draft_user_1_short")?.edited,
      readAtMigrated: ws.articles.find((a) => a.id === "art_user_1")?.readAt !== null,
      savedAtMigrated: ws.articles.find((a) => a.id === "art_user_1")?.savedAt === null,
      theme: ws.settings.theme,
      model: ws.settings.model,
      privacy: ws.settings.privacyAcknowledged,
      keyPreserved: key === "AIzaUserMigratedKey123456789012",
      darkApplied: document.documentElement.classList.contains("dark"),
    };
  });
  await ctx2.close();
} finally {
  await browser.close();
  server.close();
}

results.consoleErrors = consoleErrors;
console.log(JSON.stringify(results, null, 2));
const failed = Object.entries(results).filter(([k, v]) => {
  if (k === "consoleErrors") return false;
  if (typeof v === "object" && v !== null) return false;
  return v === false;
});
console.log(failed.length ? "FAILED: " + failed.map(([k]) => k).join(", ") : "ALL CHECKS PASSED");
