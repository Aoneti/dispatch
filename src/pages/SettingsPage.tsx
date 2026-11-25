import { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Monitor,
  Moon,
  Save,
  Sun,
  Trash2,
  Upload,
  XCircle,
  Zap,
} from "lucide-react";
import type { ThemeMode } from "../lib/types";
import { GEMINI_MODEL } from "../lib/types";
import { GeminiError, testGeminiConnection } from "../lib/gemini";
import { parseImportPayload, useStore } from "../lib/store";
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Segmented,
  Select,
  Toggle,
} from "../components/ui";
import { downloadFile, formatNumber, formatRelative, pluralRu } from "../lib/utils";

type TestState =
  | { kind: "idle" }
  | { kind: "ok"; latencyMs: number }
  | { kind: "error"; message: string; technical?: string };

export function SettingsPage() {
  const {
    sources,
    articles,
    drafts,
    settings,
    saveApiKey,
    clearApiKey,
    updateSettings,
    exportWorkspace,
    importWorkspace,
    clearAllData,
    purgeOldArticles,
    notify,
  } = useStore();

  const [keyInput, setKeyInput] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [revealInput, setRevealInput] = useState(false);
  const [revealSaved, setRevealSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testState, setTestState] = useState<TestState>({ kind: "idle" });
  const [removeKeyOpen, setRemoveKeyOpen] = useState(false);
  const [clearDataOpen, setClearDataOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    raw: string;
    counts: { sources: number; articles: number; drafts: number };
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const savedKey = settings.apiKey;
  const typedKey = keyInput.trim();
  const keyToTest = typedKey || savedKey;

  const handleSaveKey = () => {
    if (typedKey.length <= 20) {
      notify({
        title: "Слишком короткий ключ",
        description: "Вставьте полный API-ключ из Google AI Studio.",
        variant: "warning",
      });
      return;
    }
    saveApiKey(typedKey);
    setKeyInput("");
    setReplacing(false);
    setRevealInput(false);
    setTestState({ kind: "idle" });
  };

  // Проверка подключения выполняется строго по нажатию пользователем.
  const handleTest = async () => {
    if (!keyToTest || testing) return;
    setTesting(true);
    setTestState({ kind: "idle" });
    try {
      const result = await testGeminiConnection(keyToTest);
      setTestState({ kind: "ok", latencyMs: result.latencyMs });
      if (!typedKey || typedKey === savedKey) {
        updateSettings({ lastTestedAt: Date.now() });
      }
      notify({
        title: "Подключение работает",
        description: `Модель ${GEMINI_MODEL} ответила за ${result.latencyMs} мс.`,
        variant: "success",
      });
    } catch (caught) {
      const err =
        caught instanceof GeminiError
          ? caught
          : new GeminiError("unknown", "Не удалось проверить подключение к Google Gemini.");
      setTestState({ kind: "error", message: err.message, technical: err.technical });
      notify({
        title: "Ошибка подключения",
        description: err.message,
        variant: "error",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleExport = () => {
    const json = exportWorkspace();
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(`dispatch-backup-${date}.json`, json);
    notify({
      title: "Резервная копия сохранена",
      description: "API-ключ Google Gemini в файл не включён.",
      variant: "success",
    });
  };

  const handleFilePick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 40 * 1_048_576) {
      notify({
        title: "Файл слишком большой",
        description: "Максимальный размер файла для импорта — 40 МБ.",
        variant: "error",
      });
      return;
    }
    try {
      const raw = await file.text();
      const parsed = parseImportPayload(raw);
      setPendingImport({ raw, counts: parsed.counts });
    } catch (error) {
      notify({
        title: "Не удалось импортировать файл",
        description: error instanceof Error ? error.message : "Проверьте формат JSON.",
        variant: "error",
      });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const last4 = savedKey ? savedKey.slice(-4) : "";
  const usage = settings.geminiUsage;

  return (
    <div className="mx-auto w-full max-w-[780px] space-y-5 px-4 pb-12 pt-5 sm:px-6">
      <div>
        <h1 className="font-serif text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Настройки
        </h1>
        <p className="mt-1 text-[12.5px] text-muted">
          Подключение Google Gemini, оформление, RSS и локальные данные.
        </p>
      </div>

      {/* Раздел 1: Google Gemini */}
      <section className="overflow-hidden rounded-[8px] border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <KeyRound size={15} className="text-accent" />
            <h2 className="text-[14px] font-semibold text-ink">Google Gemini</h2>
          </div>
          {savedKey ? (
            <Badge tone="moss">Ключ сохранён</Badge>
          ) : (
            <Badge tone="neutral">Не подключено</Badge>
          )}
        </div>

        <div className="space-y-4 px-4 py-4 sm:px-5">
          {/* Фиксированная модель */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-line bg-paper/70 px-3.5 py-2.5">
            <div>
              <p className="text-[11px] text-muted">Используемая модель</p>
              <p className="mt-0.5 font-mono text-[13px] font-medium text-ink">{GEMINI_MODEL}</p>
            </div>
            <Badge tone="accent">Бесплатный режим</Badge>
          </div>

          {/* API-ключ */}
          <Field
            label="API-ключ Google AI Studio"
            htmlFor="settings-gemini-key"
            hint={
              <>
                Получить бесплатный ключ можно в{" "}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-accent-ink underline underline-offset-2"
                >
                  Google AI Studio <ExternalLink size={10} className="inline align-baseline" />
                </a>
                .
              </>
            }
          >
            {savedKey && !replacing ? (
              <div className="flex flex-wrap items-center gap-2 rounded-[6px] border border-line bg-paper/60 px-3 py-2">
                <Lock size={13} className="shrink-0 text-moss" />
                <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-ink-soft">
                  {revealSaved ? savedKey : `AIza${"•".repeat(18)}${last4}`}
                </code>
                <button
                  type="button"
                  onClick={() => setRevealSaved((prev) => !prev)}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface hover:text-ink"
                  aria-label={revealSaved ? "Скрыть сохранённый ключ" : "Показать сохранённый ключ"}
                >
                  {revealSaved ? <EyeOff size={13} /> : <Eye size={13} />}
                  {revealSaved ? "Скрыть" : "Показать"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReplacing(true);
                    setKeyInput("");
                    setRevealSaved(false);
                  }}
                  className="rounded px-1.5 py-0.5 text-[11px] font-medium text-accent-ink hover:bg-surface"
                >
                  Заменить
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="relative">
                  <Input
                    id="settings-gemini-key"
                    type={revealInput ? "text" : "password"}
                    value={keyInput}
                    onChange={(event) => setKeyInput(event.target.value)}
                    placeholder={savedKey ? "Вставьте новый API-ключ…" : "AIza…"}
                    autoComplete="off"
                    spellCheck={false}
                    className="pr-10 font-mono text-[12px]"
                  />
                  <button
                    type="button"
                    onClick={() => setRevealInput((prev) => !prev)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-ink"
                    aria-label={revealInput ? "Скрыть ключ" : "Показать ключ"}
                  >
                    {revealInput ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {savedKey && replacing && (
                  <button
                    type="button"
                    onClick={() => {
                      setReplacing(false);
                      setKeyInput("");
                    }}
                    className="text-[11px] text-muted hover:text-ink"
                  >
                    Оставить прежний ключ
                  </button>
                )}
              </div>
            )}
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            {(!savedKey || replacing) && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveKey}
                disabled={typedKey.length <= 20}
                icon={<Save size={13} />}
              >
                Сохранить ключ
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              loading={testing}
              disabled={!keyToTest}
              onClick={() => void handleTest()}
              icon={<Zap size={13} />}
            >
              Проверить подключение
            </Button>
            {savedKey && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRemoveKeyOpen(true)}
                className="text-muted hover:text-rose"
                icon={<Trash2 size={13} />}
              >
                Удалить ключ
              </Button>
            )}
            {settings.lastTestedAt && testState.kind === "idle" && (
              <span className="ml-auto text-[11px] text-faint">
                Проверено: {formatRelative(settings.lastTestedAt).toLowerCase()}
              </span>
            )}
          </div>

          {testState.kind === "ok" && (
            <div className="anim-rise flex items-start gap-2 rounded-[6px] border border-moss/30 bg-moss-soft/50 p-3 text-[12px]">
              <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-moss" />
              <div>
                <p className="font-medium text-ink">Подключение успешно</p>
                <p className="mt-0.5 text-[11.5px] text-muted">
                  Модель <span className="font-mono">{GEMINI_MODEL}</span> ответила за{" "}
                  {testState.latencyMs} мс.
                </p>
              </div>
            </div>
          )}

          {testState.kind === "error" && (
            <div className="anim-rise flex items-start gap-2 rounded-[6px] border border-rose/30 bg-rose/[0.06] p-3 text-[12px]">
              <XCircle size={15} className="mt-0.5 shrink-0 text-rose" />
              <div>
                <p className="font-medium text-ink">Подключение не удалось</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-soft">
                  {testState.message}
                </p>
                {testState.technical && (
                  <p className="mt-1 font-mono text-[10.5px] text-muted">{testState.technical}</p>
                )}
              </div>
            </div>
          )}

          {/* Согласие на передачу данных */}
          <label className="flex cursor-pointer items-start gap-2.5 border-t border-line pt-4">
            <input
              type="checkbox"
              checked={settings.privacyAcknowledged}
              onChange={(event) =>
                updateSettings({ privacyAcknowledged: event.target.checked })
              }
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
            <span className="text-[12px] leading-relaxed text-ink-soft">
              Разрешить отправку текста выбранной статьи в Google Gemini при нажатии кнопки
              генерации. Без вашего нажатия запросы никогда не отправляются.
            </span>
          </label>

          {/* Важное предупреждение о бесплатном тарифе и хранении ключа */}
          <div className="space-y-1.5 rounded-[6px] border border-line bg-paper/65 p-3 text-[11.5px] leading-relaxed text-muted">
            <p className="flex items-center gap-1.5 font-medium text-ink-soft">
              <AlertTriangle size={13} className="shrink-0 text-amber" /> О бесплатном тарифе и
              безопасности
            </p>
            <p>
              Бесплатный тариф Google имеет собственные ограничения и квоты, которые зависят от
              вашего проекта и могут меняться со стороны Google. На Free Tier содержимое запросов
              может использоваться Google для улучшения продуктов.
            </p>
            <p>
              Расширение использует только {GEMINI_MODEL}, не подключает платные инструменты (включая
              Search и Maps Grounding) и не переключает модель автоматически. Однако условия биллинга
              определяет Google: если ваш проект в Google Cloud переведён на платный тариф,
              расширение не может принудительно изменить его статус.
            </p>
            <p>
              API-ключ хранится только локально в профиле Chrome, не синхронизируется и никогда не
              попадает в экспорт, логи или метаданные статей. Локальное хранилище браузера доступно
              тем, у кого есть доступ к профилю — при необходимости отзовите ключ в Google AI Studio.
            </p>
          </div>

          {/* Компактная статистика использования */}
          <div className="border-t border-line pt-3">
            <p className="text-[11px] font-medium text-muted">Статистика использования Gemini</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11.5px] sm:grid-cols-4">
              <div>
                <p className="text-faint">Запросов</p>
                <p className="font-medium text-ink">{formatNumber(usage.requests)}</p>
              </div>
              <div>
                <p className="text-faint">Успешных</p>
                <p className="font-medium text-ink">{formatNumber(usage.successful)}</p>
              </div>
              <div>
                <p className="text-faint">Ошибок</p>
                <p className="font-medium text-ink">{formatNumber(usage.errors)}</p>
              </div>
              <div>
                <p className="text-faint">Токенов</p>
                <p className="font-medium text-ink">{formatNumber(usage.totalTokens)}</p>
              </div>
            </div>
            {usage.lastRequestAt && (
              <p className="mt-1 text-[10.5px] text-faint">
                Последний запрос: {formatRelative(usage.lastRequestAt).toLowerCase()}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Раздел 2: Оформление и чтение */}
      <section className="overflow-hidden rounded-[8px] border border-line bg-surface shadow-card">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <h2 className="text-[14px] font-semibold text-ink">Оформление и чтение</h2>
          <p className="mt-0.5 text-[11.5px] text-muted">
            Тема, автоматическое прочтение и интервал обновления RSS.
          </p>
        </div>

        <div className="space-y-4 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-ink">Тема оформления</p>
              <p className="mt-0.5 text-[11.5px] text-muted">
                Применяется сразу и сохраняется локально.
              </p>
            </div>
            <Segmented<ThemeMode>
              value={settings.theme}
              onChange={(theme) => updateSettings({ theme })}
              options={[
                {
                  value: "light",
                  label: (
                    <>
                      <Sun size={12} /> Светлая
                    </>
                  ),
                },
                {
                  value: "dark",
                  label: (
                    <>
                      <Moon size={12} /> Тёмная
                    </>
                  ),
                },
                {
                  value: "system",
                  label: (
                    <>
                      <Monitor size={12} /> Системная
                    </>
                  ),
                },
              ]}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div>
              <p className="text-[13px] font-medium text-ink">Автоматически отмечать прочитанной при открытии</p>
              <p className="mt-0.5 text-[11.5px] text-muted">
                Статья помечается прочитанной только при реальном открытии. Вернуть в непрочитанные можно в любой момент.
              </p>
            </div>
            <Toggle
              checked={settings.autoMarkRead}
              onChange={(checked) => updateSettings({ autoMarkRead: checked })}
              label="Автоматически отмечать прочитанной при открытии"
            />
          </div>

          <div className="border-t border-line pt-4">
            <p className="text-[13px] font-medium text-ink">Обновление RSS-лент</p>
            <p className="mt-0.5 text-[11.5px] text-muted">
              Автоматическое обновление выполняется каждые 30 минут. Ручная кнопка «Обновить» всегда доступна.
            </p>
          </div>
        </div>
      </section>

      {/* Раздел 3: Данные и хранилище */}
      <section className="overflow-hidden rounded-[8px] border border-line bg-surface shadow-card">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <h2 className="text-[14px] font-semibold text-ink">Данные и резервная копия</h2>
          <p className="mt-0.5 text-[11.5px] text-muted">
            Всё хранится только на этом устройстве:{" "}
            {pluralRu(sources.length, "источник", "источника", "источников")},{" "}
            {pluralRu(articles.length, "статья", "статьи", "статей")},{" "}
            {pluralRu(drafts.length, "черновик", "черновика", "черновиков")}.
          </p>
        </div>

        <div className="space-y-4 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div>
              <p className="text-[13px] font-medium text-ink">Удалять старые прочитанные статьи</p>
              <p className="mt-0.5 text-[11.5px] text-muted">
                Сохранённые и непрочитанные материалы никогда не удаляются автоматически.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-muted">Срок:</span>
              <Select
                value={String(settings.retentionDays)}
                onChange={(e) => updateSettings({ retentionDays: Number(e.target.value) })}
                disabled={!settings.autoCleanupEnabled}
                className="h-8 w-[110px] text-[12px]"
                aria-label="Срок хранения прочитанных статей"
              >
                {[7, 14, 30, 60, 90, 180].map((d) => (
                  <option key={d} value={d}>
                    {d} дн.
                  </option>
                ))}
              </Select>
              <Toggle
                checked={settings.autoCleanupEnabled}
                onChange={(checked) => updateSettings({ autoCleanupEnabled: checked })}
                label="Включить очистку старых прочитанных статей"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExport}
              icon={<Download size={13} />}
            >
              Экспортировать JSON
            </Button>

            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => void handleFilePick(event.target.files?.[0])}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileRef.current?.click()}
              icon={<Upload size={13} />}
            >
              Импортировать JSON
            </Button>

            <Button
              variant="secondary"
              size="sm"
              disabled={!settings.autoCleanupEnabled}
              onClick={() => {
                const removed = purgeOldArticles();
                notify({
                  title: removed > 0 ? "Старые статьи удалены" : "Удалять нечего",
                  description:
                    removed > 0
                      ? `Удалено: ${pluralRu(removed, "старая статья", "старые статьи", "старых статей")}.`
                      : "Нет прочитанных статей старше выбранного срока.",
                  variant: removed > 0 ? "success" : "info",
                });
              }}
              icon={<Trash2 size={13} />}
            >
              Очистить сейчас
            </Button>

            <Button
              variant="danger"
              size="sm"
              disabled={sources.length === 0 && articles.length === 0 && drafts.length === 0}
              onClick={() => setClearDataOpen(true)}
              icon={<Trash2 size={13} />}
              className="sm:ml-auto"
            >
              Очистить данные
            </Button>
          </div>

          <p className="text-[11px] leading-relaxed text-muted">
            API-ключ Google Gemini никогда не включается в экспорт и сохраняется отдельно при
            импорте или очистке данных.
          </p>
        </div>
      </section>

      {/* Подтверждения */}
      <ConfirmDialog
        open={removeKeyOpen}
        onClose={() => setRemoveKeyOpen(false)}
        onConfirm={() => {
          clearApiKey();
          setKeyInput("");
          setReplacing(false);
          setRevealSaved(false);
          setTestState({ kind: "idle" });
        }}
        title="Удалить API-ключ?"
        description="Ключ Google Gemini будет удалён из этого браузера."
        note="Добавленные источники, статьи и черновики останутся без изменений."
        confirmLabel="Удалить ключ"
      />

      <ConfirmDialog
        open={clearDataOpen}
        onClose={() => setClearDataOpen(false)}
        onConfirm={clearAllData}
        title="Очистить локальные данные?"
        description="Все RSS-источники, статьи и черновики будут удалены."
        note="Перед очисткой рекомендуется сохранить резервную копию (JSON). API-ключ и выбранная тема не удаляются."
        confirmLabel="Удалить всё"
      />

      <ConfirmDialog
        open={pendingImport !== null}
        onClose={() => setPendingImport(null)}
        onConfirm={() => {
          if (!pendingImport) return;
          try {
            importWorkspace(pendingImport.raw);
          } catch (error) {
            notify({
              title: "Ошибка импорта",
              description: error instanceof Error ? error.message : "Некорректный файл.",
              variant: "error",
            });
          } finally {
            setPendingImport(null);
          }
        }}
        title="Заменить текущие данные?"
        description={
          pendingImport
            ? `В файле найдено: ${pluralRu(pendingImport.counts.sources, "источник", "источника", "источников")}, ${pluralRu(pendingImport.counts.articles, "статья", "статьи", "статей")}, ${pluralRu(pendingImport.counts.drafts, "черновик", "черновика", "черновиков")}.`
            : ""
        }
        note="Текущие источники, статьи и черновики будут заменены данными из файла. Ваш сохранённый API-ключ останется прежним."
        confirmLabel="Импортировать"
        tone="primary"
      />
    </div>
  );
}
