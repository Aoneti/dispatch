import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Sparkles,
} from "lucide-react";
import type { AIProvider, Draft, DraftFormat } from "../lib/types";
import { AI_PROVIDER_LABELS, GEMINI_MODEL } from "../lib/types";
import { useStore } from "../lib/store";
import { formatRelative } from "../lib/utils";
import { Button, Field, Input, Modal } from "./ui";

interface SetupModalProps {
  open: boolean;
  provider: AIProvider;
  model: string;
  format: DraftFormat;
  onClose: () => void;
  onProceed: (apiKey: string) => void;
  onOpenSettings: () => void;
}

/**
 * Универсальное окно подключения и подтверждения передачи текста статьи
 * выбранному AI-провайдеру (Google Gemini или Groq).
 * Согласие на передачу данных и API-ключи для Gemini и Groq хранятся раздельно.
 * Никаких запросов без нажатия кнопки генерации не выполняется.
 */
export function ProviderConsentDialog({
  open,
  provider,
  model,
  format,
  onClose,
  onProceed,
  onOpenSettings,
}: SetupModalProps) {
  const { settings, saveApiKey, saveGroqApiKey, updateSettings, notify } = useStore();
  const [keyInput, setKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);

  const isGroq = provider === "groq";
  const providerLabel = AI_PROVIDER_LABELS[provider];
  const savedConsent = isGroq ? settings.groqPrivacyAcknowledged : settings.privacyAcknowledged;
  const savedKey = isGroq ? settings.groqApiKey : settings.apiKey;
  const resolvedModel = isGroq ? model : GEMINI_MODEL;

  const [consent, setConsent] = useState(savedConsent);

  useEffect(() => {
    if (!open) return;
    setKeyInput("");
    setShowKey(false);
    setConsent(savedConsent);
  }, [open, provider, savedConsent]);

  const hasSavedKey = Boolean(savedKey);
  const effectiveKey = hasSavedKey ? savedKey : keyInput.trim();
  const formatButton =
    format === "short" ? "Сгенерировать короткий пост" : "Сгенерировать расширенный пост";
  const formatDescription =
    format === "short"
      ? `Будет выполнен один запрос в ${providerLabel} только для короткого поста (1–2 предложения, ~200–280 символов).`
      : `Будет выполнен один запрос в ${providerLabel} только для расширенного поста (3–5 предложений, ~450–550 символов).`;

  const handleContinue = () => {
    if (!hasSavedKey) {
      if (effectiveKey.length <= 20) {
        notify({
          title: "Слишком короткий ключ",
          description: isGroq
            ? "Вставьте полный API-ключ из Groq Console."
            : "Вставьте полный API-ключ из Google AI Studio.",
          variant: "warning",
        });
        return;
      }
      if (isGroq) {
        saveGroqApiKey(effectiveKey);
      } else {
        saveApiKey(effectiveKey);
      }
    }
    if (!consent) return;
    if (isGroq) {
      updateSettings({ groqPrivacyAcknowledged: true });
    } else {
      updateSettings({ privacyAcknowledged: true });
    }
    onProceed(effectiveKey);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        hasSavedKey
          ? `Подтверждение отправки в ${providerLabel}`
          : `Подключение ${providerLabel}`
      }
      description={formatDescription}
      size="md"
      icon={hasSavedKey ? <Sparkles size={17} /> : <KeyRound size={17} />}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="accent"
            size="sm"
            disabled={!consent || effectiveKey.length <= 20}
            onClick={handleContinue}
            icon={<Sparkles size={13} />}
          >
            {formatButton}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {!hasSavedKey && (
          <>
            {isGroq ? (
              <p className="text-[12px] leading-relaxed text-muted">
                Получите собственный API-ключ в{" "}
                <a
                  href="https://console.groq.com/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-accent-ink underline underline-offset-2"
                >
                  Groq Console <ExternalLink size={10} className="inline align-baseline" />
                </a>{" "}
                (
                <a
                  href="https://console.groq.com/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted underline underline-offset-2 hover:text-ink"
                >
                  документация
                </a>
                ). Выбранная модель:{" "}
                <span className="font-mono text-[11px] text-ink">{resolvedModel}</span>.
              </p>
            ) : (
              <p className="text-[12px] leading-relaxed text-muted">
                Получите собственный бесплатный API-ключ в{" "}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-accent-ink underline underline-offset-2"
                >
                  Google AI Studio <ExternalLink size={10} className="inline align-baseline" />
                </a>
                . Используется модель{" "}
                <span className="font-mono text-[11px] text-ink">{GEMINI_MODEL}</span>.
              </p>
            )}

            <Field
              label={`API-ключ ${providerLabel}`}
              htmlFor="dialog-provider-key"
            >
              <div className="relative">
                <Input
                  id="dialog-provider-key"
                  type={showKey ? "text" : "password"}
                  value={keyInput}
                  onChange={(event) => setKeyInput(event.target.value)}
                  placeholder={isGroq ? "gsk_…" : "AIza…"}
                  autoComplete="off"
                  spellCheck={false}
                  className="pr-9 font-mono text-[12px]"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((prev) => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-ink"
                  aria-label={showKey ? "Скрыть ключ" : "Показать ключ"}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </Field>

            <div className="flex items-start gap-2 rounded-[6px] border border-line bg-paper/70 p-2.5 text-[11px] leading-relaxed text-muted">
              <Lock size={13} className="mt-0.5 shrink-0 text-moss" />
              <span>
                Ключ {providerLabel} хранится отдельно только в вашем браузере и не попадает в
                экспорт, логи, метаданные статей и запросы к другому провайдеру.
              </span>
            </div>
          </>
        )}

        <label className="flex cursor-pointer items-start gap-2.5 rounded-[6px] border border-line bg-surface-2 p-3">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
          />
          <span className="text-[11.5px] leading-relaxed text-ink-soft">
            {isGroq ? (
              <>
                Я понимаю, что при генерации текст выбранной статьи отправляется во внешний сервис{" "}
                <strong>Groq API</strong> (модель{" "}
                <span className="font-mono text-[11px]">{resolvedModel}</span>). Обработка данных,
                квоты и условия использования регулируются политикой Groq.
              </>
            ) : (
              <>
                Я понимаю, что при генерации текст выбранной статьи отправляется в{" "}
                <strong>Google Gemini API</strong> (модель{" "}
                <span className="font-mono text-[11px]">{GEMINI_MODEL}</span>). На бесплатном
                тарифе (Free Tier) Google может использовать содержимое запросов для улучшения
                продуктов; лимиты и условия биллинга определяет Google.
              </>
            )}
          </span>
        </label>

        <button
          type="button"
          onClick={() => {
            onClose();
            onOpenSettings();
          }}
          className="text-[11.5px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          Открыть настройки AI-провайдеров
        </button>
      </div>
    </Modal>
  );
}

export { ProviderConsentDialog as GeminiConsentDialog };

interface ReplaceDraftDialogProps {
  open: boolean;
  draft: Draft | null;
  targetProvider: AIProvider;
  onClose: () => void;
  onConfirmReplace: () => void;
  onOpenExisting: (draftId: string) => void;
}

/**
 * Предупреждение перед повторной генерацией уже существующего формата черновика,
 * чтобы не потерять текст и ручные правки пользователя.
 */
export function ReplaceDraftDialog({
  open,
  draft,
  targetProvider,
  onClose,
  onConfirmReplace,
  onOpenExisting,
}: ReplaceDraftDialogProps) {
  if (!draft) return null;
  const formatName = draft.format === "short" ? "короткий пост" : "расширенный пост";
  const targetLabel = AI_PROVIDER_LABELS[targetProvider];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Заменить ${formatName}?`}
      description={`Для этой статьи уже сохранён ${formatName} (${AI_PROVIDER_LABELS[draft.provider]} · ${draft.model}, обновлён: ${formatRelative(draft.updatedAt).toLowerCase()}).`}
      size="sm"
      icon={<AlertTriangle size={17} />}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onClose();
              onOpenExisting(draft.id);
            }}
          >
            Открыть черновик
          </Button>
          <Button
            variant="accent"
            size="sm"
            onClick={() => {
              onClose();
              onConfirmReplace();
            }}
          >
            Заменить
          </Button>
        </>
      }
    >
      <div className="space-y-2.5">
        {draft.edited ? (
          <div className="rounded-[6px] border border-amber/35 bg-amber-soft/60 p-3 text-[12px] leading-relaxed text-ink">
            <p className="font-medium text-amber">В черновике есть ваши ручные правки</p>
            <p className="mt-1 text-[11.5px] text-ink-soft">
              При повторной генерации текущий отредактированный текст будет заменён новым вариантом
              от {targetLabel}.
            </p>
          </div>
        ) : (
          <p className="text-[12px] leading-relaxed text-muted">
            Предыдущий вариант будет заменён новым постом от {targetLabel}. Второй формат поста при
            этом не затрагивается.
          </p>
        )}
      </div>
    </Modal>
  );
}
