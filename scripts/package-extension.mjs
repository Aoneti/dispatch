import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";

const root = process.cwd();
const distDir = path.join(root, "dist");
const manifestPath = path.join(distDir, "manifest.json");
const indexPath = path.join(distDir, "index.html");
const archivePath = path.join(root, "dispatch-extension.zip");

const errors = [];

if (!fs.existsSync(distDir)) {
  console.error("Папка dist не найдена. Сначала выполните: npm run build:extension");
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) {
  errors.push("Отсутствует dist/manifest.json");
} else {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (err) {
    errors.push(`manifest.json содержит некорректный JSON: ${err.message}`);
  }

  if (manifest) {
    if (manifest.manifest_version !== 3) {
      errors.push("manifest_version должен быть равен 3");
    }
    for (const key of ["name", "version", "description", "action", "icons", "side_panel", "background", "permissions"]) {
      if (!manifest[key]) errors.push(`В manifest.json отсутствует обязательное поле: ${key}`);
    }
    for (const iconPath of Object.values(manifest.icons || {})) {
      const abs = path.join(distDir, String(iconPath));
      if (!fs.existsSync(abs)) errors.push(`Не найдена иконка: ${iconPath}`);
    }
    const defaultPath = manifest.side_panel?.default_path;
    if (!defaultPath || !fs.existsSync(path.join(distDir, defaultPath))) {
      errors.push(`Не найден файл side_panel: ${defaultPath || "(не указан)"}`);
    }
    const worker = manifest.background?.service_worker;
    if (!worker || !fs.existsSync(path.join(distDir, worker))) {
      errors.push(`Не найден service worker: ${worker || "(не указан)"}`);
    }
  }
}

if (!fs.existsSync(indexPath)) {
  errors.push("Отсутствует dist/index.html");
} else {
  const html = fs.readFileSync(indexPath, "utf8");
  // Запрещены встроенные исполняемые <script> без src (CSP Manifest V3).
  const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(
    ([, attrs, body]) => !/\bsrc\s*=/i.test(attrs) && body.trim().length > 0
  );
  if (inlineScripts.length > 0) {
    errors.push("В dist/index.html обнаружены встроенные скрипты — это нарушает CSP Manifest V3");
  }
  const externalScripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  if (externalScripts.length === 0) {
    errors.push("В dist/index.html не подключён локальный JS-файл");
  }
  for (const src of externalScripts) {
    if (/^https?:\/\//i.test(src)) {
      errors.push(`Обнаружен удалённый скрипт: ${src}`);
    } else if (src.startsWith("/src/") || src.includes("localhost")) {
      errors.push(`Обнаружена недопустимая ссылка в скрипте: ${src}`);
    } else {
      const cleaned = src.replace(/^\.\//, "");
      if (!fs.existsSync(path.join(distDir, cleaned))) {
        errors.push(`Подключённый JS-файл не найден в dist: ${src}`);
      }
    }
  }
  const stylesheets = [...html.matchAll(/<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi)];
  for (const tag of stylesheets) {
    const hrefMatch = tag[0].match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[1];
    if (/^https?:\/\//i.test(href)) {
      errors.push(`Обнаружен внешний CSS/шрифт: ${href}`);
    } else {
      const cleaned = href.replace(/^\.\//, "");
      if (!fs.existsSync(path.join(distDir, cleaned))) {
        errors.push(`Подключённый CSS-файл не найден в dist: ${href}`);
      }
    }
  }
  if (/fonts\.googleapis\.com|fonts\.gstatic\.com|localhost:\d+/i.test(html)) {
    errors.push("В dist/index.html остались ссылки на внешние шрифты или localhost");
  }
}

if (errors.length > 0) {
  console.error("Проверка сборки расширения не пройдена:\n - " + errors.join("\n - "));
  process.exit(1);
}

function addDirToZip(zip, currentDir, relativeBase = "") {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const zipPath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      addDirToZip(zip, fullPath, zipPath);
    } else if (entry.isFile()) {
      zip.file(zipPath, fs.readFileSync(fullPath));
    }
  }
}

const zip = new JSZip();
addDirToZip(zip, distDir);

const buffer = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
});

fs.writeFileSync(archivePath, buffer);

const sizeKb = (buffer.length / 1024).toFixed(1);
const fileCount = Object.keys(zip.files).filter((name) => !zip.files[name].dir).length;
console.log(`Готово: ${archivePath} (${sizeKb} КБ, файлов: ${fileCount})`);
console.log("Для установки в Chrome откройте chrome://extensions → «Режим разработчика» → «Загрузить распакованное расширение» → выберите папку dist.");
