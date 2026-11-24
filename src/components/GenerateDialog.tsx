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
import type { Draft, DraftFormat } from "../lib/types";
import { GEMINI_MODEL } from "../lib/types";
import { useStore } from "../lib/store";
import { formatRelative } from "../lib/utils";
import { Button, Field, Input, Modal } from "./ui";

interface SetupModalProps {
  open: boolean;
  format: DraftFormat;
  onClose: () => void;
  onProceed: (apiKey: string) => void;
  onOpenSettings: () => void;
}

/**
 * Компактное окно перед первой генерацией, если ещё не задан API-ключ
 * или не подтверждена передача текста статьи в Google Gemini.
 * Никаких запросов без нажатия кнопки «Сгенерировать» не выполняется.
 */
export function GeminiConsentDialog({
  open,
  format,
  onClose,
  onProceed,
  onOpenSettings,
}: SetupModalProps) {
  const { settings, saveApiKey, updateSettings, notify } = useStore();
  const [keyInput, setKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [consent, setConsent] = useState(settings.privacyAcknowledged);

  useEffect(() => {
    if (!open) return;
    setKeyInput("");
    setShowKey(false);
    setConsent(settings.privacyAcknowledged);
  }, [open, settings.privacyAcknowledged]);

  const hasSavedKey = Boolean(settings.apiKey);
  const effectiveKey = hasSavedKey ? settings.apiKey : keyInput.trim();
  const formatButton =
    format === "short" ? "Сгенерировать короткий пост" : "Сгенерировать расширенный пост";
  const formatDescription =
    format === "short"
      ? "Будет выполнен один запрос только для короткого поста (1–2 предложения, ~200–280 символов)."
      : "Будет выполнен один запрос только для расширенного поста (3–5 предложений, ~500 символов).";

  const handleContinue = () => {
    if (!hasSavedKey) {
      if (effectiveKey.length <= 20) {
        notify({
          title: "Слишком короткий ключ",
          description: "Вставьте полный API-ключ из Google AI Studio.",
          variant: "warning",
        });
        return;
      }
      saveApiKey(effectiveKey);
    }
    if (!consent) return;
    updateSettings({ privacyAcknowledged: true });
    onProceed(effectiveKey);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={hasSavedKey ? "Подтверждение отправки в Google Gemini" : "Подключение Google Gemini"}
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
              . Используется только модель{" "}
              <span className="font-mono text-[11px] text-ink">{GEMINI_MODEL}</span>.
            </p>

            <Field label="API-ключ Google Gemini" htmlFor="dialog-gemini-key">
              <div className="relative">
                <Input
                  id="dialog-gemini-key"
                  type={showKey ? "text" : "password"}
                  value={keyInput}
                  onChange={(event) => setKeyInput(event.target.value)}
                  placeholder="AIza…"
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
                Ключ сохраняется только локально в вашем браузере и не попадает в экспорт, логи и
                метаданные статей.
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
            Я понимаю, что текст выбранной статьи отправляется в API Google Gemini ({GEMINI_MODEL}).
            На бесплатном тарифе (Free Tier) Google может использовать содержимое запросов для
            улучшения своих продуктов. Лимиты и условия биллинга определяет Google.
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
          Открыть полные настройки Google Gemini
        </button>
      </div>
    </Modal>
  );
}

interface ReplaceDraftDialogProps {
  open: boolean;
  draft: Draft | null;
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
  onClose,
  onConfirmReplace,
  onOpenExisting,
}: ReplaceDraftDialogProps) {
  if (!draft) return null;
  const formatName = draft.format === "short" ? "короткий пост" : "расширенный пост";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Заменить ${formatName}?`}
      description={`Для этой статьи уже сохранён ${formatName} (обновлён: ${formatRelative(draft.updatedAt).toLowerCase()}).`}
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
              При повторной генерации текущий отредактированный текст будет заменён новым вариантом от
              Google Gemini.
            </p>
          </div>
        ) : (
          <p className="text-[12px] leading-relaxed text-muted">
            Предыдущий вариант будет заменён новым. Второй формат поста при этом не затрагивается.
          </p>
        )}
      </div>
    </Modal>
  );
}
