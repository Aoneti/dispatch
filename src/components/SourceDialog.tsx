import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Globe2,
  LoaderCircle,
  Rss,
  Search,
} from "lucide-react";
import type { ParsedFeed, Source } from "../lib/types";
import { FeedError, loadFeedPreview } from "../lib/feeds";
import { ensureHostAccess } from "../lib/permissions";
import { useStore } from "../lib/store";
import { domainOf, formatDate, isValidHttpUrl, normalizeUrl, pluralRu } from "../lib/utils";
import { Badge, Button, Field, Input, Modal, Select } from "./ui";

interface Props {
  open: boolean;
  onClose: () => void;
  source?: Source | null;
}

type ValidationState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "success"; feed: ParsedFeed; format: "RSS" | "Atom" }
  | { state: "error"; message: string };

export function SourceDialog({ open, onClose, source }: Props) {
  const { addSource, updateSource, refreshSource, notify, sources } = useStore();
  const editing = Boolean(source);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [validation, setValidation] = useState<ValidationState>({ state: "idle" });
  const [allowUnvalidated, setAllowUnvalidated] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const nameTouched = useRef(false);

  useEffect(() => {
    if (!open) return;
    setUrl(source?.url || "");
    setName(source?.name || "");
    setEnabled(source?.enabled ?? true);
    setValidation({ state: "idle" });
    setAllowUnvalidated(false);
    setSubmitError("");
    nameTouched.current = Boolean(source?.name);
  }, [open, source]);

  const validate = async () => {
    setSubmitError("");
    const normalized = normalizeUrl(url);
    if (!isValidHttpUrl(normalized)) {
      setValidation({
        state: "error",
        message: "Укажите корректный адрес ленты, например https://example.com/rss.xml.",
      });
      return;
    }
    if (sources.some((item) => normalizeUrl(item.url) === normalized && item.id !== source?.id)) {
      setValidation({ state: "error", message: "Эта лента уже добавлена в список источников." });
      return;
    }

    setValidation({ state: "loading" });
    try {
      // Запрашиваем доступ только к конкретному домену добавляемой ленты.
      const granted = await ensureHostAccess(normalized);
      if (!granted) {
        setValidation({
          state: "error",
          message:
            "Разрешение на доступ к этому домену не выдано. Нажмите «Проверить» снова и подтвердите запрос браузера.",
        });
        return;
      }

      const feed = await loadFeedPreview(normalized);
      setValidation({
        state: "success",
        feed,
        format: feed.format === "atom" ? "Atom" : "RSS",
      });
      if (!nameTouched.current || !name.trim()) {
        setName(feed.title.slice(0, 80));
        nameTouched.current = false;
      }
      if (!source) setUrl(normalized);
    } catch (error) {
      const message =
        error instanceof FeedError
          ? error.message
          : "Не удалось загрузить или проверить ленту. Убедитесь, что это прямая ссылка на RSS или Atom.";
      setValidation({ state: "error", message });
    }
  };

  const handleSave = async () => {
    setSubmitError("");
    const normalized = normalizeUrl(url);
    if (!isValidHttpUrl(normalized)) {
      setSubmitError("Укажите корректный адрес RSS или Atom-ленты.");
      return;
    }
    if (!name.trim()) {
      setSubmitError("Укажите название источника.");
      return;
    }
    if (sources.some((item) => normalizeUrl(item.url) === normalized && item.id !== source?.id)) {
      setSubmitError("Источник с таким адресом уже добавлен.");
      return;
    }

    const siteUrl =
      validation.state === "success"
        ? validation.feed.siteUrl
        : source?.siteUrl || `https://${domainOf(normalized)}`;

    if (editing && source) {
      const urlChanged = normalized !== source.url;
      if (urlChanged && validation.state !== "success") {
        await ensureHostAccess(normalized);
      }
      updateSource(source.id, {
        name: name.trim(),
        url: normalized,
        siteUrl,
        enabled,
        status: urlChanged ? "unknown" : source.status,
        lastError: urlChanged ? null : source.lastError,
        etag: urlChanged ? undefined : source.etag,
        lastModified: urlChanged ? undefined : source.lastModified,
      });
      notify({
        title: "Источник сохранён",
        description: urlChanged ? "Адрес изменился — обновите ленту, чтобы получить новости." : name.trim(),
        variant: "success",
      });
      onClose();
      return;
    }

    if (validation.state !== "success" && enabled) {
      await ensureHostAccess(normalized);
    }

    const created = addSource({
      name: name.trim(),
      url: normalized,
      siteUrl,
      enabled,
      preview: validation.state === "success" ? validation.feed : undefined,
    });

    notify({
      title: "Источник добавлен",
      description:
        validation.state === "success"
          ? `Загружено: ${pluralRu(created.articleCount, "статья", "статьи", "статей")}.`
          : enabled
            ? "Запущена первая загрузка ленты."
            : "Источник добавлен в отключённом состоянии.",
      variant: "success",
    });
    onClose();

    if (enabled && validation.state !== "success") {
      window.setTimeout(() => void refreshSource(created.id, false), 120);
    }
  };

  const addDisabled =
    !isValidHttpUrl(url) ||
    !name.trim() ||
    validation.state === "loading" ||
    (validation.state === "error" && !allowUnvalidated);

  const footer = (
    <>
      <Button variant="ghost" size="sm" onClick={onClose}>
        Отмена
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void validate()}
        loading={validation.state === "loading"}
        icon={<Search size={13} />}
      >
        {validation.state === "success" ? "Проверить ещё раз" : "Проверить ленту"}
      </Button>
      <Button variant="primary" size="sm" onClick={() => void handleSave()} disabled={addDisabled}>
        {editing ? "Сохранить" : "Добавить"}
      </Button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Редактировать источник" : "Добавить источник"}
      description={
        editing
          ? "Измените название, адрес или состояние RSS-ленты."
          : "Укажите прямую ссылку на RSS 2.0 или Atom-ленту. Chrome запросит разрешение только для этого сайта."
      }
      size="md"
      icon={<Rss size={17} />}
      footer={footer}
    >
      <div className="space-y-4">
        <Field
          label="Адрес RSS или Atom-ленты"
          htmlFor="source-url"
          hint="Нужна прямая ссылка на XML-ленту (обычно оканчивается на .xml, .rss или /feed)."
        >
          <div className="flex gap-2">
            <Input
              id="source-url"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                if (validation.state !== "idle") setValidation({ state: "idle" });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void validate();
                }
              }}
              placeholder="https://example.com/rss.xml"
              className="font-mono text-[12px]"
              spellCheck={false}
              autoComplete="off"
            />
            <Button
              variant="secondary"
              size="sm"
              className="h-9 shrink-0"
              onClick={() => void validate()}
              loading={validation.state === "loading"}
            >
              Проверить
            </Button>
          </div>
        </Field>

        {validation.state === "loading" && (
          <div className="flex items-center gap-2 rounded-[6px] border border-line bg-surface-2 px-3 py-2.5 text-[12px] text-muted">
            <LoaderCircle size={14} className="spin-slow text-accent" />
            Проверяем ленту и загружаем описание…
          </div>
        )}

        {validation.state === "success" && (
          <div className="anim-rise rounded-[6px] border border-moss/30 bg-moss-soft/50 p-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={14} className="text-moss" />
              <p className="text-[12px] font-medium text-ink">Лента {validation.format} корректна</p>
              <Badge tone="moss">
                {pluralRu(validation.feed.items.length, "запись", "записи", "записей")}
              </Badge>
            </div>
            <p className="mt-1 font-serif text-[13.5px] font-medium text-ink">
              {validation.feed.title}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1">
                <Globe2 size={11} /> {domainOf(validation.feed.siteUrl)}
              </span>
              {validation.feed.items[0] && (
                <>
                  <span>·</span>
                  <span>Свежая: {formatDate(validation.feed.items[0].publishedAt)}</span>
                </>
              )}
            </div>
          </div>
        )}

        {validation.state === "error" && (
          <div className="anim-rise space-y-2 rounded-[6px] border border-amber/30 bg-amber-soft/50 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber" />
              <div>
                <p className="text-[12px] font-medium text-ink">Не удалось проверить ленту</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{validation.message}</p>
              </div>
            </div>
            <label className="flex cursor-pointer items-start gap-2 border-t border-amber/20 pt-2 text-[11px] leading-relaxed text-muted">
              <input
                type="checkbox"
                checked={allowUnvalidated}
                onChange={(event) => setAllowUnvalidated(event.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
              />
              Добавить источник без проверки (попробовать обновить позже)
            </label>
          </div>
        )}

        <Field label="Название источника" htmlFor="source-name">
          <Input
            id="source-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              nameTouched.current = true;
            }}
            placeholder="Например: Новостное издание"
            maxLength={80}
          />
        </Field>

        <Field label="Состояние" htmlFor="source-status">
          <Select
            id="source-status"
            value={enabled ? "enabled" : "disabled"}
            onChange={(event) => setEnabled(event.target.value === "enabled")}
          >
            <option value="enabled">Включён — участвует в обновлении</option>
            <option value="disabled">Отключён — не обновляется</option>
          </Select>
        </Field>

        {submitError && (
          <p className="flex items-center gap-1.5 text-[11.5px] text-rose">
            <AlertTriangle size={13} /> {submitError}
          </p>
        )}
      </div>
    </Modal>
  );
}
