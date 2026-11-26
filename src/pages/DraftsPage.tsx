import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Link2,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import type { Draft } from "../lib/types";
import { AI_PROVIDER_LABELS } from "../lib/types";
import { useStore } from "../lib/store";
import { Badge, Button, ConfirmDialog, EmptyState } from "../components/ui";
import {
  charCount,
  cn,
  copyText,
  domainOf,
  formatDateTime,
  formatRelative,
  pluralRu,
} from "../lib/utils";

interface DraftsProps {
  selectedDraftId: string | null;
  onSelectDraft: (id: string | null) => void;
  onOpenInbox: () => void;
}

export function DraftsPage({ selectedDraftId, onSelectDraft, onOpenInbox }: DraftsProps) {
  const { drafts, updateDraft, resetDraftToOriginal, deleteDraft, notify } = useStore();
  const [copiedKey, setCopiedKey] = useState<"plain" | "link" | null>(null);
  const [savedStamp, setSavedStamp] = useState<number | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const sorted = useMemo(
    () => [...drafts].sort((a, b) => b.updatedAt - a.updatedAt),
    [drafts]
  );

  // На десктопе по умолчанию выбираем самый свежий черновик.
  const active: Draft | null = useMemo(() => {
    if (selectedDraftId) {
      return sorted.find((item) => item.id === selectedDraftId) || null;
    }
    return sorted[0] || null;
  }, [selectedDraftId, sorted]);

  useEffect(() => {
    setSavedStamp(null);
    setCopiedKey(null);
  }, [active?.id]);

  if (sorted.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={<FileText size={22} />}
          title="Черновиков пока нет"
          description="Откройте любую новость и нажмите «Сгенерировать короткий пост» или «Сгенерировать расширенный пост». Готовый черновик появится здесь."
          action={
            <Button variant="primary" size="md" onClick={onOpenInbox}>
              Перейти к новостям
            </Button>
          }
        />
      </div>
    );
  }

  const handleCopy = async (withSourceLink: boolean) => {
    if (!active || !active.text.trim()) return;
    if (withSourceLink && !active.sourceUrl) {
      notify({
        title: "Ссылка на источник отсутствует",
        description: "Для этого черновика не сохранён адрес оригинальной статьи.",
        variant: "warning",
      });
      return;
    }
    const payload = withSourceLink
      ? `${active.text.trimEnd()}\n\n${active.sourceUrl}`
      : active.text;
    const ok = await copyText(payload);
    if (ok) {
      const kind = withSourceLink ? "link" : "plain";
      setCopiedKey(kind);
      window.setTimeout(() => setCopiedKey((curr) => (curr === kind ? null : curr)), 1_800);
      notify({
        title: withSourceLink ? "Скопировано со ссылкой на источник" : "Текст скопирован",
        description: "Расширение ничего не публикует в X — вставьте текст вручную.",
        variant: "success",
      });
    } else {
      notify({
        title: "Не удалось скопировать",
        description: "Выделите текст в редакторе и скопируйте его вручную (Ctrl+C).",
        variant: "error",
      });
    }
  };

  const handleSave = () => {
    if (!active) return;
    const now = Date.now();
    updateDraft(active.id, { text: active.text, updatedAt: now });
    setSavedStamp(now);
    notify({
      title: "Черновик сохранён",
      variant: "success",
    });
  };

  const showEditorOnMobile = Boolean(selectedDraftId && active);

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Список независимых черновиков */}
      <aside
        aria-label="Список черновиков"
        className={cn(
          "flex w-full min-w-0 shrink-0 flex-col border-r border-line bg-paper md:w-[300px] xl:w-[340px]",
          showEditorOnMobile && "hidden md:flex"
        )}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
          <span className="text-[12px] font-medium text-ink-soft">
            {pluralRu(sorted.length, "черновик", "черновика", "черновиков")}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {sorted.map((draft) => {
            const isSelected = active?.id === draft.id;
            const length = charCount(draft.text);
            return (
              <button
                key={draft.id}
                type="button"
                onClick={() => onSelectDraft(draft.id)}
                aria-pressed={isSelected}
                className={cn(
                  "block w-full border-b border-line px-4 py-3 text-left transition-colors",
                  isSelected ? "bg-surface shadow-inset-line" : "hover:bg-surface/65"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={draft.format === "short" ? "moss" : "blue"}>
                    {draft.format === "short" ? "Короткий" : "Расширенный"}
                  </Badge>
                  <span className="shrink-0 font-mono text-[10px] text-faint">
                    {formatRelative(draft.updatedAt)}
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-2 font-serif text-[14px] font-semibold leading-[1.32] text-ink">
                  {draft.articleTitle}
                </p>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted">
                  <span className="truncate">{draft.sourceName}</span>
                  <span className="shrink-0 font-mono text-[10px] text-faint">
                    · {draft.provider === "groq" ? "Groq" : "Gemini"}
                  </span>
                  {draft.edited && <span className="text-faint">· изменён</span>}
                  <span
                    className={cn(
                      "ml-auto shrink-0 font-mono text-[10.5px]",
                      draft.format === "short" && length > 280 ? "text-amber" : "text-faint"
                    )}
                  >
                    {length} симв.
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Редактор выбранного черновика */}
      {active && (
        <section
          aria-label="Редактор черновика"
          className={cn(
            "flex min-w-0 flex-1 flex-col overflow-hidden bg-surface",
            !showEditorOnMobile && "hidden md:flex"
          )}
        >
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3 sm:px-5">
            <button
              type="button"
              onClick={() => onSelectDraft(null)}
              className="inline-flex h-7 items-center gap-1 rounded-[5px] px-1.5 text-[12px] font-medium text-muted hover:bg-surface-2 hover:text-ink md:hidden"
            >
              <ArrowLeft size={14} /> Черновики
            </button>

            <Badge tone={active.format === "short" ? "moss" : "blue"}>
              {active.format === "short" ? "Короткий пост" : "Расширенный пост"}
            </Badge>
            {active.status === "needs_review" && <Badge tone="amber">Проверить</Badge>}
            {active.edited && <Badge tone="neutral">Изменён</Badge>}

            <span className="ml-auto hidden font-mono text-[10.5px] text-faint sm:inline">
              {savedStamp
                ? "Сохранено"
                : `Обновлён: ${formatRelative(active.updatedAt).toLowerCase()}`}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[680px] space-y-4 px-4 pb-12 pt-5 sm:px-7">
              <div>
                <h2 className="font-serif text-[21px] font-semibold leading-[1.26] text-ink">
                  {active.articleTitle}
                </h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted">
                  <span>{active.sourceName}</span>
                  <span className="text-line-strong">·</span>
                  <span>{formatDateTime(active.createdAt)}</span>
                  <span className="text-line-strong">·</span>
                  <span className="font-mono text-[10.5px] text-faint">
                    {AI_PROVIDER_LABELS[active.provider]} · {active.model}
                  </span>
                </div>
              </div>

              <DraftEditorBox
                draft={active}
                copiedKey={copiedKey}
                onChange={(text) => updateDraft(active.id, { text })}
                onSave={handleSave}
                onCopyPlain={() => void handleCopy(false)}
                onCopyWithLink={() => void handleCopy(true)}
                onReset={() => setResetOpen(true)}
                onDelete={() => setDeleteOpen(true)}
              />

              {/* Замечания и ключевые факты */}
              {(active.warnings.length > 0 || active.keyFacts.length > 0) && (
                <div className="space-y-3 rounded-[7px] border border-line bg-paper/60 p-3.5">
                  {active.warnings.length > 0 && (
                    <div>
                      <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-amber">
                        <AlertTriangle size={13} /> На что обратить внимание
                      </p>
                      <ul className="mt-1.5 space-y-1 text-[12px] leading-relaxed text-ink-soft">
                        {active.warnings.map((warning) => (
                          <li key={warning}>• {warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {active.keyFacts.length > 0 && (
                    <div className={active.warnings.length > 0 ? "border-t border-line pt-3" : ""}>
                      <p className="text-[11px] font-medium text-muted">Факты из статьи</p>
                      <ul className="mt-1.5 space-y-1 text-[12px] leading-relaxed text-ink-soft">
                        {active.keyFacts.map((fact) => (
                          <li key={fact}>• {fact}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Оригинальная ссылка хранится отдельно */}
              {active.sourceUrl && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-[7px] border border-line bg-paper/50 px-3.5 py-2.5 text-[12px]">
                  <div className="min-w-0 flex-1">
                    <span className="text-muted">Ссылка на оригинал: </span>
                    <span className="font-mono text-[11px] text-ink-soft">
                      {domainOf(active.sourceUrl)}
                    </span>
                  </div>
                  <a
                    href={active.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-accent-ink hover:underline"
                  >
                    Открыть <ExternalLink size={12} />
                  </a>
                </div>
              )}

              <p className="text-[11px] text-faint">
                Изменения сохраняются локально автоматически. Ссылка добавляется только по кнопке
                «Копировать со ссылкой». Автопубликация в X отключена.
              </p>
            </div>
          </div>

          <ConfirmDialog
            open={resetOpen}
            onClose={() => setResetOpen(false)}
            onConfirm={() => resetDraftToOriginal(active.id)}
            title="Вернуть исходный текст ИИ?"
            description={`Ваши ручные правки в этом черновике будут заменены первоначальным вариантом от ${AI_PROVIDER_LABELS[active.provider]}.`}
            note="Второй формат поста (если он создан) не изменится."
            confirmLabel="Вернуть исходный"
            tone="primary"
          />

          <ConfirmDialog
            open={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            onConfirm={() => {
              const removing = active.id;
              const remaining = sorted.find((item) => item.id !== removing);
              deleteDraft(removing);
              onSelectDraft(remaining ? remaining.id : null);
            }}
            title="Удалить черновик?"
            description="Этот черновик будет удалён без возможности восстановления."
            note="Исходная статья останется в разделе «Новости»."
            confirmLabel="Удалить"
          />
        </section>
      )}
    </div>
  );
}

function DraftEditorBox({
  draft,
  copiedKey,
  onChange,
  onSave,
  onCopyPlain,
  onCopyWithLink,
  onReset,
  onDelete,
}: {
  draft: Draft;
  copiedKey: "plain" | "link" | null;
  onChange: (text: string) => void;
  onSave: () => void;
  onCopyPlain: () => void;
  onCopyWithLink: () => void;
  onReset: () => void;
  onDelete: () => void;
}) {
  const count = charCount(draft.text);
  const isShort = draft.format === "short";
  const overStandardLimit = count > 280;
  const target = isShort ? 280 : 500;

  return (
    <div className="overflow-hidden rounded-[8px] border border-line bg-surface shadow-card">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2/60 px-3.5 py-2.5">
        <span className="text-[12px] font-medium text-ink-soft">
          {isShort ? "Текст короткого поста" : "Текст расширенного поста"}
        </span>
        <span
          data-testid="draft-char-count"
          className={cn(
            "inline-flex items-center gap-1 rounded-[4px] border px-2 py-0.5 font-mono text-[11px]",
            isShort && overStandardLimit
              ? "border-amber/35 bg-amber-soft text-amber"
              : "border-line bg-surface text-ink-soft"
          )}
        >
          {isShort && overStandardLimit && <AlertTriangle size={11} />}
          {count} / {isShort ? target : `~${target}`} симв.
        </span>
      </div>

      <textarea
        value={draft.text}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Текст черновика"
        spellCheck
        rows={isShort ? 5 : 8}
        placeholder="Введите или отредактируйте текст поста…"
        className="block w-full resize-y border-0 bg-surface px-4 py-3.5 font-serif text-[16px] leading-[1.68] text-ink outline-none placeholder:text-faint focus:ring-0"
      />

      {overStandardLimit && (
        <div
          className={cn(
            "flex items-start gap-2 border-t px-3.5 py-2 text-[11.5px] leading-relaxed",
            isShort
              ? "border-amber/25 bg-amber-soft/55 text-amber"
              : "border-line bg-surface-2/70 text-muted"
          )}
        >
          {isShort && <AlertTriangle size={13} className="mt-0.5 shrink-0" />}
          <span>
            {isShort
              ? `Длина ${count} симв. превышает стандартный лимит X (280 символов). Текст не обрезан автоматически — при необходимости сократите вручную.`
              : `Длина ${count} симв. (выше стандартных 280 символов X — для публикации длинных постов может требоваться подписка X Premium). Текст не обрезается.`}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-surface-2/50 px-3 py-2.5">
        <Button variant="primary" size="sm" onClick={onSave} icon={<Save size={13} />}>
          Сохранить
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={!draft.text.trim()}
          onClick={onCopyPlain}
          icon={copiedKey === "plain" ? <Check size={13} className="text-moss" /> : <Copy size={13} />}
        >
          {copiedKey === "plain" ? "Скопировано" : "Копировать"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={!draft.text.trim() || !draft.sourceUrl}
          onClick={onCopyWithLink}
          icon={copiedKey === "link" ? <Check size={13} className="text-moss" /> : <Link2 size={13} />}
        >
          {copiedKey === "link" ? "Скопировано" : "Копировать со ссылкой"}
        </Button>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={!draft.edited}
            onClick={onReset}
            title={`Вернуть исходный вариант от ${AI_PROVIDER_LABELS[draft.provider]}`}
            icon={<RotateCcw size={13} />}
          >
            <span className="hidden sm:inline">Исходный текст</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            title="Удалить черновик"
            className="text-muted hover:text-rose"
            icon={<Trash2 size={13} />}
          >
            <span className="hidden sm:inline">Удалить</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
