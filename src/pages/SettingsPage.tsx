import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
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
import type { AIProvider, AIUsageStats, GroqModelId, ThemeMode } from "../lib/types";
import { AI_PROVIDER_LABELS, GEMINI_MODEL, GROQ_MODELS } from "../lib/types";
import type { AIErrorKind, StructuredOutputMode } from "../lib/ai";
import { AIProviderError, errorKindBadgeLabel, testProviderConnection } from "../lib/ai";
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
  | { kind: "ok"; latencyMs: number; model: string; structuredMode?: StructuredOutputMode }
  | { kind: "error"; errorKind: AIErrorKind; message: string; technical?: string };

function UsageSummaryBlock({
  label,
  usage,
}: {
  label: string;
  usage: AIUsageStats;
}) {
  return (
    <div className="border-t border-line pt-3">
      <p className="text-[11px] font-medium text-muted">{label}</p>
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
          <p className="text-faint">Токены (вх. / исх.)</p>
          <p className="font-medium text-ink">
            {formatNumber(usage.inputTokens)} / {formatNumber(usage.outputTokens)}
          </p>
        </div>
      </div>
      {usage.lastRequestAt && (
        <p className="mt-1.5 text-[10.5px] text-faint">
          Последний запрос: {formatRelative(usage.lastRequestAt).toLowerCase()}
          {usage.totalTokens > 0 ? ` · всего ${formatNumber(usage.totalTokens)} ток.` : ""}
          {usage.errors > 0 && usage.lastErrorAt
            ? ` · последний сбой ${formatRelative(usage.lastErrorAt).toLowerCase()} (${usage.lastErrorKind}${usage.lastErrorDetail ? `, ${usage.lastErrorDetail}` : ""})`
            : ""}
        </p>
      )}
    </div>
  );
}

export function SettingsPage() {
  const {
    sources,
    articles,
    drafts,
    settings,
    saveApiKey,
    clearApiKey,
    saveGroqApiKey,
    clearGroqApiKey,
    updateSettings,
    exportWorkspace,
    importWorkspace,
    clearAllData,
    purgeOldArticles,
    notify,
  } = useStore();

  // Состояния Google Gemini (полностью изолированы от Groq)
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [geminiReplacing, setGeminiReplacing] = useState(false);
  const [geminiRevealInput, setGeminiRevealInput] = useState(false);
  const [geminiRevealSaved, setGeminiRevealSaved] = useState(false);
  const [geminiTesting, setGeminiTesting] = useState(false);
  const [geminiTestState, setGeminiTestState] = useState<TestState>({ kind: "idle" });
  const [removeGeminiKeyOpen, setRemoveGeminiKeyOpen] = useState(false);

  // Состояния Groq (полностью изолированы от Google Gemini)
  const [groqKeyInput, setGroqKeyInput] = useState("");
  const [groqReplacing, setGroqReplacing] = useState(false);
  const [groqRevealInput, setGroqRevealInput] = useState(false);
  const [groqRevealSaved, setGroqRevealSaved] = useState(false);
  const [groqTesting, setGroqTesting] = useState(false);
  const [groqTestState, setGroqTestState] = useState<TestState>({ kind: "idle" });
  const [removeGroqKeyOpen, setRemoveGroqKeyOpen] = useState(false);

  // Данные и импорт
  const [clearDataOpen, setClearDataOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    raw: string;
    counts: { sources: number; articles: number; drafts: number };
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const savedGeminiKey = settings.apiKey;
  const typedGeminiKey = geminiKeyInput.trim();
  const geminiKeyToTest = typedGeminiKey || savedGeminiKey;

  const savedGroqKey = settings.groqApiKey;
  const typedGroqKey = groqKeyInput.trim();
  const groqKeyToTest = typedGroqKey || savedGroqKey;

  const handleSaveGeminiKey = () => {
    if (typedGeminiKey.length <= 20) {
      notify({
        title: "Слишком короткий ключ",
        description: "Вставьте полный API-ключ из Google AI Studio.",
        variant: "warning",
      });
      return;
    }
    saveApiKey(typedGeminiKey);
    setGeminiKeyInput("");
    setGeminiReplacing(false);
    setGeminiRevealInput(false);
    setGeminiTestState({ kind: "idle" });
  };

  // Проверка подключения Google Gemini выполняется строго по нажатию кнопки.
  const handleTestGemini = async () => {
    if (!geminiKeyToTest || geminiTesting) return;
    setGeminiTesting(true);
    setGeminiTestState({ kind: "idle" });
    try {
      const result = await testProviderConnection({
        provider: "gemini",
        apiKey: geminiKeyToTest,
        model: GEMINI_MODEL,
      });
      setGeminiTestState({ kind: "ok", latencyMs: result.latencyMs, model: result.model });
      if (!typedGeminiKey || typedGeminiKey === savedGeminiKey) {
        updateSettings({ lastTestedAt: Date.now() });
      }
      notify({
        title: "Google Gemini подключён",
        description: `Модель ${GEMINI_MODEL} ответила за ${result.latencyMs} мс.`,
        variant: "success",
      });
    } catch (caught) {
      const err =
        caught instanceof AIProviderError
          ? caught
          : new AIProviderError(
              "gemini",
              "unknown",
              "Не удалось проверить подключение к Google Gemini."
            );
      setGeminiTestState({
        kind: "error",
        errorKind: err.kind,
        message: err.message,
        technical: err.technical,
      });
      notify({
        title: "Ошибка подключения к Google Gemini",
        description: err.message,
        variant: "error",
      });
    } finally {
      setGeminiTesting(false);
    }
  };

  const handleSaveGroqKey = () => {
    if (typedGroqKey.length <= 20) {
      notify({
        title: "Слишком короткий ключ",
        description: "Вставьте полный API-ключ из Groq Console.",
        variant: "warning",
      });
      return;
    }
    saveGroqApiKey(typedGroqKey);
    setGroqKeyInput("");
    setGroqReplacing(false);
    setGroqRevealInput(false);
    setGroqTestState({ kind: "idle" });
  };

  // Проверка подключения Groq выполняется строго по нажатию кнопки и именно для выбранной модели.
  const handleTestGroq = async () => {
    if (!groqKeyToTest || groqTesting) return;
    const targetModel = settings.groqModel;
    setGroqTesting(true);
    setGroqTestState({ kind: "idle" });
    try {
      const result = await testProviderConnection({
        provider: "groq",
        apiKey: groqKeyToTest,
        model: targetModel,
      });
      setGroqTestState({
        kind: "ok",
        latencyMs: result.latencyMs,
        model: targetModel,
        structuredMode: result.structuredMode,
      });
      if (!typedGroqKey || typedGroqKey === savedGroqKey) {
        updateSettings({
          groqLastTestedAt: Date.now(),
          groqTestedModel: targetModel,
        });
      }
      const usedFallback = result.structuredMode === "json_object";
      notify({
        title: usedFallback
          ? "Groq подключён (резервный режим JSON)"
          : "Groq подключён",
        description: usedFallback
          ? `Модель ${targetModel} работает через резервный режим структурированного JSON (json_object), ответ за ${result.latencyMs} мс.`
          : `Модель ${targetModel} прошла проверку Strict Structured Outputs за ${result.latencyMs} мс.`,
        variant: usedFallback ? "warning" : "success",
      });
    } catch (caught) {
      const err =
        caught instanceof AIProviderError
          ? caught
          : new AIProviderError("groq", "unknown", "Не удалось проверить подключение к Groq API.");
      setGroqTestState({
        kind: "error",
        errorKind: err.kind,
        message: err.message,
        technical: err.technical,
      });
      notify({
        title: "Ошибка подключения к Groq",
        description: err.message,
        variant: "error",
      });
    } finally {
      setGroqTesting(false);
    }
  };

  const handleExport = () => {
    const json = exportWorkspace();
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(`dispatch-backup-${date}.json`, json);
    notify({
      title: "Резервная копия сохранена",
      description: "API-ключи Google Gemini и Groq в файл не включены.",
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

  const geminiLast4 = savedGeminiKey ? savedGeminiKey.slice(-4) : "";
  const groqPrefix = savedGroqKey ? savedGroqKey.slice(0, 4) : "gsk_";
  const groqLast4 = savedGroqKey ? savedGroqKey.slice(-4) : "";

  const geminiVerified =
    Boolean(savedGeminiKey) &&
    (settings.lastTestedAt !== null || geminiTestState.kind === "ok");

  const groqVerified =
    Boolean(savedGroqKey) &&
    ((settings.groqLastTestedAt !== null && settings.groqTestedModel === settings.groqModel) ||
      (groqTestState.kind === "ok" && groqTestState.model === settings.groqModel));

  const selectedGroqOption =
    GROQ_MODELS.find((m) => m.id === settings.groqModel) || GROQ_MODELS[0];

  const activeProvider = settings.activeProvider;
  const activeModelId = activeProvider === "groq" ? settings.groqModel : GEMINI_MODEL;

  const dataSizeLabel = useMemo(() => {
    try {
      const bytes = new Blob([JSON.stringify({ sources, articles, drafts })]).size;
      if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
      return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
    } catch {
      return "—";
    }
  }, [sources, articles, drafts]);

  const renderProviderStatusBadge = (
    hasKey: boolean,
    isVerified: boolean,
    testState: TestState
  ) => {
    if (testState.kind === "error") {
      return <Badge tone="rose">{errorKindBadgeLabel(testState.errorKind)}</Badge>;
    }
    if (testState.kind === "ok" && testState.structuredMode === "json_object") {
      return <Badge tone="amber">Резервный JSON</Badge>;
    }
    if (isVerified) {
      return <Badge tone="moss">Подключён</Badge>;
    }
    if (hasKey) {
      return <Badge tone="amber">Ключ сохранён</Badge>;
    }
    return <Badge tone="neutral">Ключ не задан</Badge>;
  };

  return (
    <div className="mx-auto w-full max-w-[780px] space-y-5 px-4 pb-12 pt-5 sm:px-6">
      <div>
        <h1 className="font-serif text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Настройки
        </h1>
        <p className="mt-1 text-[12.5px] text-muted">
          Выбор AI-провайдера, подключение Google Gemini и Groq, оформление, RSS и локальные данные.
        </p>
      </div>

      {/* Выбор активного AI-провайдера */}
      <section className="overflow-hidden rounded-[8px] border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
          <div className="min-w-[220px] flex-1">
            <div className="flex items-center gap-2">
              <Cpu size={15} className="text-accent" />
              <h2 className="text-[14px] font-semibold text-ink">Активный AI-провайдер</h2>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
              Сейчас для генерации постов выбран{" "}
              <strong className="font-medium text-ink">
                {AI_PROVIDER_LABELS[activeProvider]}
              </strong>{" "}
              (<span className="font-mono text-[11px]">{activeModelId}</span>). Выбор сохраняется
              автоматически; переключение между провайдерами при ошибках не выполняется.
            </p>
          </div>
          <Segmented<AIProvider>
            value={settings.activeProvider}
            onChange={(nextProvider) => updateSettings({ activeProvider: nextProvider })}
            options={[
              { value: "gemini", label: "Google Gemini" },
              { value: "groq", label: "Groq" },
            ]}
          />
        </div>
      </section>

      {/* Блок 1: Google Gemini */}
      <section className="overflow-hidden rounded-[8px] border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <KeyRound size={15} className="text-accent" />
            <h2 className="text-[14px] font-semibold text-ink">Google Gemini</h2>
            {activeProvider === "gemini" && <Badge tone="accent">Активный</Badge>}
          </div>
          {renderProviderStatusBadge(Boolean(savedGeminiKey), geminiVerified, geminiTestState)}
        </div>

        <div className="space-y-4 px-4 py-4 sm:px-5">
          {/* Фиксированная модель Gemini */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-line bg-paper/70 px-3.5 py-2.5">
            <div>
              <p className="text-[11px] text-muted">Используемая модель</p>
              <p className="mt-0.5 font-mono text-[13px] font-medium text-ink">{GEMINI_MODEL}</p>
            </div>
            <Badge tone="neutral">Фиксированная модель</Badge>
          </div>

          {/* API-ключ Google Gemini */}
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
                . Хранится отдельно от ключа Groq.
              </>
            }
          >
            {savedGeminiKey && !geminiReplacing ? (
              <div className="flex flex-wrap items-center gap-2 rounded-[6px] border border-line bg-paper/60 px-3 py-2">
                <Lock size={13} className="shrink-0 text-moss" />
                <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-ink-soft">
                  {geminiRevealSaved
                    ? savedGeminiKey
                    : `${savedGeminiKey.slice(0, 4)}${"•".repeat(18)}${geminiLast4}`}
                </code>
                <button
                  type="button"
                  onClick={() => setGeminiRevealSaved((prev) => !prev)}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface hover:text-ink"
                  aria-label={
                    geminiRevealSaved
                      ? "Скрыть сохранённый ключ Google Gemini"
                      : "Показать сохранённый ключ Google Gemini"
                  }
                >
                  {geminiRevealSaved ? <EyeOff size={13} /> : <Eye size={13} />}
                  {geminiRevealSaved ? "Скрыть" : "Показать"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGeminiReplacing(true);
                    setGeminiKeyInput("");
                    setGeminiRevealSaved(false);
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
                    type={geminiRevealInput ? "text" : "password"}
                    value={geminiKeyInput}
                    onChange={(event) => setGeminiKeyInput(event.target.value)}
                    placeholder={savedGeminiKey ? "Вставьте новый API-ключ Gemini…" : "AIza…"}
                    autoComplete="off"
                    spellCheck={false}
                    className="pr-10 font-mono text-[12px]"
                  />
                  <button
                    type="button"
                    onClick={() => setGeminiRevealInput((prev) => !prev)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-ink"
                    aria-label={geminiRevealInput ? "Скрыть ключ Gemini" : "Показать ключ Gemini"}
                  >
                    {geminiRevealInput ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {savedGeminiKey && geminiReplacing && (
                  <button
                    type="button"
                    onClick={() => {
                      setGeminiReplacing(false);
                      setGeminiKeyInput("");
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
            {(!savedGeminiKey || geminiReplacing) && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveGeminiKey}
                disabled={typedGeminiKey.length <= 20}
                icon={<Save size={13} />}
              >
                Сохранить ключ
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              loading={geminiTesting}
              disabled={!geminiKeyToTest}
              onClick={() => void handleTestGemini()}
              icon={<Zap size={13} />}
            >
              Проверить подключение
            </Button>
            {savedGeminiKey && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRemoveGeminiKeyOpen(true)}
                className="text-muted hover:text-rose"
                icon={<Trash2 size={13} />}
              >
                Удалить ключ
              </Button>
            )}
            {settings.lastTestedAt && geminiTestState.kind === "idle" && (
              <span className="ml-auto text-[11px] text-faint">
                Проверено: {formatRelative(settings.lastTestedAt).toLowerCase()}
              </span>
            )}
          </div>

          {geminiTestState.kind === "ok" && (
            <div className="anim-rise flex items-start gap-2 rounded-[6px] border border-moss/30 bg-moss-soft/50 p-3 text-[12px]">
              <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-moss" />
              <div>
                <p className="font-medium text-ink">Подключение к Google Gemini подтверждено</p>
                <p className="mt-0.5 text-[11.5px] text-muted">
                  Модель <span className="font-mono">{GEMINI_MODEL}</span> ответила за{" "}
                  {geminiTestState.latencyMs} мс.
                </p>
              </div>
            </div>
          )}

          {geminiTestState.kind === "error" && (
            <div className="anim-rise flex items-start gap-2 rounded-[6px] border border-rose/30 bg-rose/[0.06] p-3 text-[12px]">
              <XCircle size={15} className="mt-0.5 shrink-0 text-rose" />
              <div>
                <p className="font-medium text-ink">Подключение к Google Gemini не удалось</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-soft">
                  {geminiTestState.message}
                </p>
                {geminiTestState.technical && (
                  <p className="mt-1 font-mono text-[10.5px] text-muted">
                    {geminiTestState.technical}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Согласие на передачу данных в Google Gemini */}
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

          <div className="space-y-1.5 rounded-[6px] border border-line bg-paper/65 p-3 text-[11.5px] leading-relaxed text-muted">
            <p className="flex items-center gap-1.5 font-medium text-ink-soft">
              <AlertTriangle size={13} className="shrink-0 text-amber" /> О тарифе Google Gemini и
              безопасности
            </p>
            <p>
              На бесплатном тарифе (Free Tier) Google действуют собственные лимиты, а содержимое
              запросов может использоваться Google для улучшения продуктов. Условия биллинга проекта
              в Google Cloud определяет Google.
            </p>
          </div>

          <UsageSummaryBlock
            label="Статистика использования Google Gemini"
            usage={settings.geminiUsage}
          />
        </div>
      </section>

      {/* Блок 2: Groq */}
      <section className="overflow-hidden rounded-[8px] border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <KeyRound size={15} className="text-accent" />
            <h2 className="text-[14px] font-semibold text-ink">Groq</h2>
            {activeProvider === "groq" && <Badge tone="accent">Активный</Badge>}
          </div>
          {renderProviderStatusBadge(Boolean(savedGroqKey), groqVerified, groqTestState)}
        </div>

        <div className="space-y-4 px-4 py-4 sm:px-5">
          {/* Выбор модели Groq */}
          <Field
            label="Модель Groq"
            htmlFor="settings-groq-model"
            hint={
              <>
                Текущий ID:{" "}
                <span className="font-mono text-[11px] text-ink-soft">{settings.groqModel}</span>{" "}
                ({selectedGroqOption.description}). Поддерживается строгая JSON-схема (Structured
                Outputs <span className="font-mono text-[11px]">strict: true</span>). Смена модели
                не переключает активный провайдер.
              </>
            }
          >
            <Select
              id="settings-groq-model"
              value={settings.groqModel}
              onChange={(event) => {
                const nextModel = event.target.value as GroqModelId;
                updateSettings({ groqModel: nextModel });
                if (groqTestState.kind !== "idle") {
                  setGroqTestState({ kind: "idle" });
                }
              }}
              aria-label="Выбор модели Groq"
            >
              {GROQ_MODELS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} ({option.id}) — {option.description.toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>

          {/* API-ключ Groq */}
          <Field
            label="API-ключ Groq"
            htmlFor="settings-groq-key"
            hint={
              <>
                Получить ключ можно в{" "}
                <a
                  href="https://console.groq.com/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-accent-ink underline underline-offset-2"
                >
                  Groq Console <ExternalLink size={10} className="inline align-baseline" />
                </a>
                , документация —{" "}
                <a
                  href="https://console.groq.com/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-accent-ink underline underline-offset-2"
                >
                  console.groq.com/docs{" "}
                  <ExternalLink size={10} className="inline align-baseline" />
                </a>
                . Хранится отдельно от ключа Google Gemini.
              </>
            }
          >
            {savedGroqKey && !groqReplacing ? (
              <div className="flex flex-wrap items-center gap-2 rounded-[6px] border border-line bg-paper/60 px-3 py-2">
                <Lock size={13} className="shrink-0 text-moss" />
                <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-ink-soft">
                  {groqRevealSaved ? savedGroqKey : `${groqPrefix}${"•".repeat(18)}${groqLast4}`}
                </code>
                <button
                  type="button"
                  onClick={() => setGroqRevealSaved((prev) => !prev)}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface hover:text-ink"
                  aria-label={
                    groqRevealSaved
                      ? "Скрыть сохранённый ключ Groq"
                      : "Показать сохранённый ключ Groq"
                  }
                >
                  {groqRevealSaved ? <EyeOff size={13} /> : <Eye size={13} />}
                  {groqRevealSaved ? "Скрыть" : "Показать"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGroqReplacing(true);
                    setGroqKeyInput("");
                    setGroqRevealSaved(false);
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
                    id="settings-groq-key"
                    type={groqRevealInput ? "text" : "password"}
                    value={groqKeyInput}
                    onChange={(event) => setGroqKeyInput(event.target.value)}
                    placeholder={savedGroqKey ? "Вставьте новый API-ключ Groq…" : "gsk_…"}
                    autoComplete="off"
                    spellCheck={false}
                    className="pr-10 font-mono text-[12px]"
                  />
                  <button
                    type="button"
                    onClick={() => setGroqRevealInput((prev) => !prev)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-ink"
                    aria-label={groqRevealInput ? "Скрыть ключ Groq" : "Показать ключ Groq"}
                  >
                    {groqRevealInput ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {savedGroqKey && groqReplacing && (
                  <button
                    type="button"
                    onClick={() => {
                      setGroqReplacing(false);
                      setGroqKeyInput("");
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
            {(!savedGroqKey || groqReplacing) && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveGroqKey}
                disabled={typedGroqKey.length <= 20}
                icon={<Save size={13} />}
              >
                Сохранить ключ
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              loading={groqTesting}
              disabled={!groqKeyToTest}
              onClick={() => void handleTestGroq()}
              icon={<Zap size={13} />}
            >
              Проверить подключение
            </Button>
            {savedGroqKey && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRemoveGroqKeyOpen(true)}
                className="text-muted hover:text-rose"
                icon={<Trash2 size={13} />}
              >
                Удалить ключ
              </Button>
            )}
            {settings.groqLastTestedAt &&
              settings.groqTestedModel === settings.groqModel &&
              groqTestState.kind === "idle" && (
                <span className="ml-auto text-[11px] text-faint">
                  Проверено: {formatRelative(settings.groqLastTestedAt).toLowerCase()}
                </span>
              )}
          </div>

          {groqTestState.kind === "ok" &&
            (groqTestState.structuredMode === "json_object" ? (
              <div className="anim-rise flex items-start gap-2 rounded-[6px] border border-amber/35 bg-amber-soft/50 p-3 text-[12px]">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber" />
                <div>
                  <p className="font-medium text-ink">
                    Соединение работает через резервный режим структурированного JSON
                  </p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-soft">
                    Модель <span className="font-mono">{groqTestState.model}</span> ответила за{" "}
                    {groqTestState.latencyMs} мс в режиме{" "}
                    <span className="font-mono">json_object</span> (Strict Structured Outputs вернул{" "}
                    <span className="font-mono">json_validate_failed</span>, но все поля схемы
                    прошли локальную проверку).
                  </p>
                </div>
              </div>
            ) : (
              <div className="anim-rise flex items-start gap-2 rounded-[6px] border border-moss/30 bg-moss-soft/50 p-3 text-[12px]">
                <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-moss" />
                <div>
                  <p className="font-medium text-ink">Подключение к Groq подтверждено</p>
                  <p className="mt-0.5 text-[11.5px] text-muted">
                    Модель <span className="font-mono">{groqTestState.model}</span> прошла проверку
                    Strict Structured Outputs (JSON Schema) за {groqTestState.latencyMs} мс.
                  </p>
                </div>
              </div>
            ))}

          {groqTestState.kind === "error" && (
            <div className="anim-rise flex items-start gap-2 rounded-[6px] border border-rose/30 bg-rose/[0.06] p-3 text-[12px]">
              <XCircle size={15} className="mt-0.5 shrink-0 text-rose" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">Подключение к Groq не удалось</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-soft">
                  {groqTestState.message}
                </p>
                {groqTestState.technical && (
                  <p className="mt-1 break-words font-mono text-[10.5px] text-muted">
                    {groqTestState.technical}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Отдельное согласие на передачу данных в Groq */}
          <label className="flex cursor-pointer items-start gap-2.5 border-t border-line pt-4">
            <input
              type="checkbox"
              checked={settings.groqPrivacyAcknowledged}
              onChange={(event) =>
                updateSettings({ groqPrivacyAcknowledged: event.target.checked })
              }
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
            <span className="text-[12px] leading-relaxed text-ink-soft">
              Разрешить отправку текста выбранной статьи в Groq API при нажатии кнопки генерации.
              Согласие для Google Gemini не переносится на Groq автоматически.
            </span>
          </label>

          <div className="space-y-1.5 rounded-[6px] border border-line bg-paper/65 p-3 text-[11.5px] leading-relaxed text-muted">
            <p className="flex items-center gap-1.5 font-medium text-ink-soft">
              <AlertTriangle size={13} className="shrink-0 text-amber" /> О лимитах Groq и хранении
              ключа
            </p>
            <p>
              Лимиты запросов (RPM/RPD) и токенов (TPM/TPD), а также условия тарификации определяет
              Groq. При недоступности выбранной модели автоматическое переключение на другую модель
              или другой провайдер не выполняется.
            </p>
            <p>
              Оба API-ключа (Google Gemini и Groq) хранятся раздельно только в локальном профиле
              браузера, не синхронизируются через Chrome Sync и никогда не попадают в экспорт, логи
              или метаданные статей.
            </p>
          </div>

          <UsageSummaryBlock
            label="Статистика использования Groq"
            usage={settings.groqUsage}
          />
        </div>
      </section>

      {/* Раздел 3: Оформление и чтение */}
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
              <p className="text-[13px] font-medium text-ink">
                Автоматически отмечать прочитанной при открытии
              </p>
              <p className="mt-0.5 text-[11.5px] text-muted">
                Статья помечается прочитанной только при реальном открытии. Вернуть в непрочитанные
                можно в любой момент.
              </p>
            </div>
            <Toggle
              checked={settings.autoMarkRead}
              onChange={(checked) => updateSettings({ autoMarkRead: checked })}
              label="Автоматически отмечать прочитанной при открытии"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div>
              <p className="text-[13px] font-medium text-ink">Интервал обновления RSS-лент</p>
              <p className="mt-0.5 text-[11.5px] text-muted">
                Автоматическое обновление выполняется, пока панель открыта. Кнопка «Обновить»
                всегда доступна.
              </p>
            </div>
            <Select
              value={String(settings.syncMinutes)}
              onChange={(e) => updateSettings({ syncMinutes: Number(e.target.value) })}
              className="h-8 w-[130px] text-[12px]"
              aria-label="Интервал обновления RSS-лент"
            >
              {[15, 30, 60, 180].map((m) => (
                <option key={m} value={m}>
                  {m === 60 ? "Каждый час" : m === 180 ? "Каждые 3 часа" : `Каждые ${m} мин.`}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </section>

      {/* Раздел 4: Данные и хранилище */}
      <section className="overflow-hidden rounded-[8px] border border-line bg-surface shadow-card">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <h2 className="text-[14px] font-semibold text-ink">Данные и резервная копия</h2>
          <p className="mt-0.5 text-[11.5px] text-muted">
            Всё хранится только на этом устройстве (IndexedDB + кэш браузера):{" "}
            {pluralRu(sources.length, "источник", "источника", "источников")},{" "}
            {pluralRu(articles.length, "статья", "статьи", "статей")},{" "}
            {pluralRu(drafts.length, "черновик", "черновика", "черновиков")} · около {dataSizeLabel}
            .
          </p>
        </div>

        <div className="space-y-4 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
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
            API-ключи Google Gemini и Groq никогда не включаются в экспорт и сохраняются отдельно
            при импорте или очистке новостных данных.
          </p>
        </div>
      </section>

      {/* Подтверждения */}
      <ConfirmDialog
        open={removeGeminiKeyOpen}
        onClose={() => setRemoveGeminiKeyOpen(false)}
        onConfirm={() => {
          clearApiKey();
          setGeminiKeyInput("");
          setGeminiReplacing(false);
          setGeminiRevealSaved(false);
          setGeminiTestState({ kind: "idle" });
        }}
        title="Удалить API-ключ Google Gemini?"
        description="Ключ Google Gemini будет удалён из этого браузера."
        note="Ключ Groq, добавленные источники, статьи и черновики останутся без изменений."
        confirmLabel="Удалить ключ"
      />

      <ConfirmDialog
        open={removeGroqKeyOpen}
        onClose={() => setRemoveGroqKeyOpen(false)}
        onConfirm={() => {
          clearGroqApiKey();
          setGroqKeyInput("");
          setGroqReplacing(false);
          setGroqRevealSaved(false);
          setGroqTestState({ kind: "idle" });
        }}
        title="Удалить API-ключ Groq?"
        description="Ключ Groq будет удалён из этого браузера."
        note="Ключ Google Gemini, добавленные источники, статьи и черновики останутся без изменений."
        confirmLabel="Удалить ключ"
      />

      <ConfirmDialog
        open={clearDataOpen}
        onClose={() => setClearDataOpen(false)}
        onConfirm={clearAllData}
        title="Очистить локальные данные?"
        description="Все RSS-источники, статьи и черновики будут удалены."
        note="Перед очисткой рекомендуется сохранить резервную копию (JSON). Оба API-ключа и настройки приложения не удаляются."
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
        note="Текущие источники, статьи и черновики будут заменены данными из файла. Ваши сохранённые API-ключи Google Gemini и Groq останутся прежними."
        confirmLabel="Импортировать"
        tone="primary"
      />
    </div>
  );
}
