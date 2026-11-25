import React, { useEffect, useId, useRef } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Info,
  LoaderCircle,
  X,
  XCircle,
} from "lucide-react";
import { cn, initials } from "../lib/utils";
import { useStore } from "../lib/store";

/* ------------------------------- Кнопка ------------------------------- */

type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger";
type ButtonSize = "xs" | "sm" | "md";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-ink text-paper border border-transparent hover:bg-ink-soft shadow-[0_1px_2px_rgba(20,20,20,.12)] disabled:opacity-45 dark:hover:bg-ink/90",
  accent:
    "bg-accent text-white border border-transparent hover:bg-accent-hover shadow-[0_1px_2px_rgba(120,40,20,.18)] disabled:opacity-50",
  secondary:
    "bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-2 shadow-[0_1px_1px_rgba(20,20,20,.03)] disabled:text-faint disabled:opacity-60",
  ghost:
    "bg-transparent text-muted border border-transparent hover:text-ink hover:bg-surface-2 disabled:text-faint disabled:opacity-50",
  danger:
    "bg-rose/10 text-rose border border-rose/25 hover:bg-rose/15 disabled:opacity-45",
};

const buttonSizes: Record<ButtonSize, string> = {
  xs: "h-8 px-2.5 text-[12.5px] gap-1.5 rounded-[5px]",
  sm: "h-9 px-3 text-[13px] gap-1.5 rounded-[6px]",
  md: "h-10 px-4 text-[13.5px] gap-1.5 rounded-[7px]",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  icon,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[background,color,border,box-shadow] duration-150 disabled:cursor-not-allowed",
        buttonVariants[variant],
        buttonSizes[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <LoaderCircle size={14} className="spin-slow shrink-0" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/* ------------------------- Кнопка с иконкой --------------------------- */

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  size?: "sm" | "md";
}

export function IconButton({
  label,
  active,
  size = "md",
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[6px] border border-transparent text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" ? "h-7 w-7" : "h-8 w-8",
        active && "border-line bg-surface text-ink",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ------------------------------- Бейдж -------------------------------- */

type BadgeTone = "neutral" | "accent" | "moss" | "amber" | "blue" | "rose";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "border-line bg-surface-2 text-muted",
  accent: "border-accent/25 bg-accent-soft text-accent-ink",
  moss: "border-moss/25 bg-moss-soft text-moss",
  amber: "border-amber/25 bg-amber-soft text-amber",
  blue: "border-blue/25 bg-blue-soft text-blue",
  rose: "border-rose/25 bg-rose/10 text-rose",
};

export function Badge({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: BadgeTone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[20px] items-center gap-1 whitespace-nowrap rounded-[4px] border px-1.5 text-[10.5px] font-medium leading-none",
        badgeTones[tone],
        className
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/* ------------------------ Инициалы и статус --------------------------- */

export function SourceMark({
  name,
  muted,
  size = "md",
}: {
  name: string;
  muted?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center border border-line bg-paper-deep font-mono font-medium text-ink-soft",
        size === "sm" ? "h-6 w-6 rounded-[4px] text-[9.5px]" : "h-8 w-8 rounded-[5px] text-[10.5px]",
        muted && "opacity-50"
      )}
    >
      {initials(name)}
    </span>
  );
}

export function StatusDot({ tone }: { tone: "ok" | "error" | "idle" | "syncing" }) {
  const map = {
    ok: "bg-moss",
    error: "bg-rose",
    idle: "bg-faint",
    syncing: "bg-amber",
  };
  return <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", map[tone])} aria-hidden />;
}

/* ---------------------------- Поля ввода ------------------------------ */

const fieldBase =
  "w-full rounded-[6px] border border-line bg-surface text-[13px] text-ink shadow-[0_1px_1px_rgba(20,20,20,.02)] transition-[border,box-shadow] duration-150 placeholder:text-faint hover:border-line-strong focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/10 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, "h-9 px-3", className)} {...props} />;
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn(fieldBase, "h-9 appearance-none pl-3 pr-8", className)} {...props}>
        {children}
      </select>
      <ChevronDown
        size={13}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
        aria-hidden
      />
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[12px] font-medium text-ink-soft">
        {label}
      </label>
      {children}
      {error ? (
        <p className="flex items-start gap-1 text-[11.5px] text-rose">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}
        </p>
      ) : hint ? (
        <p className="text-[11px] leading-relaxed text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[19px] w-[34px] shrink-0 items-center rounded-full border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40",
        checked ? "border-moss/60 bg-moss" : "border-line-strong bg-paper-deep"
      )}
    >
      <span
        className={cn(
          "inline-block h-[13px] w-[13px] rounded-full shadow-sm transition-transform duration-150",
          checked ? "translate-x-[17px] bg-white" : "translate-x-[2px] bg-faint dark:bg-muted"
        )}
      />
    </button>
  );
}

/* ------------------------- Модальное окно ----------------------------- */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  icon,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  icon?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>(
        "input, textarea, select, button:not([disabled]), [href]"
      );
      focusable?.focus();
    }, 20);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm: "max-w-[400px]", md: "max-w-[490px]", lg: "max-w-[560px]" };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 pt-[8vh] sm:p-6 sm:pt-[10vh]">
      <div
        className="anim-fade fixed inset-0 bg-[#171612]/45 backdrop-blur-[1.5px] dark:bg-black/60"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "anim-rise relative z-10 w-full rounded-[9px] border border-line bg-surface shadow-lift",
          widths[size]
        )}
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          {icon && <div className="mt-0.5 shrink-0 text-accent">{icon}</div>}
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="font-serif text-[18px] font-semibold leading-snug tracking-[-0.01em] text-ink"
            >
              {title}
            </h2>
            {description && <p className="mt-1 text-[12px] leading-relaxed text-muted">{description}</p>}
          </div>
          <IconButton label="Закрыть окно" size="sm" onClick={onClose} className="-mr-1 -mt-0.5">
            <X size={15} />
          </IconButton>
        </div>
        <div className="max-h-[68vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2/60 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  note,
  confirmLabel = "Удалить",
  tone = "danger",
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  note?: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      icon={<AlertTriangle size={17} />}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            size="sm"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-[12px] leading-relaxed text-muted">
        {note || "Действие выполняется локально в вашем браузере и не может быть отменено без резервной копии."}
      </p>
    </Modal>
  );
}

/* --------------------------- Уведомления ------------------------------ */

export function ToastViewport() {
  const { toasts, dismissToast } = useStore();
  const icons = {
    success: <CheckCircle2 size={15} className="text-[#8AD0A0]" />,
    error: <XCircle size={15} className="text-[#F0A49C]" />,
    info: <Info size={15} className="text-[#A9C6E4]" />,
    warning: <AlertTriangle size={15} className="text-[#EBC884]" />,
  };
  return (
    <div
      className="pointer-events-none fixed bottom-16 right-4 z-[80] flex w-[calc(100vw-32px)] max-w-[360px] flex-col gap-2 md:bottom-5 md:right-5"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="anim-rise pointer-events-auto flex items-start gap-2.5 rounded-[7px] border border-white/10 bg-ink px-3.5 py-2.5 text-paper shadow-lift"
        >
          <span className="mt-0.5 shrink-0">{icons[toast.variant]}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium leading-snug">{toast.title}</p>
            {toast.description && (
              <p className="mt-0.5 text-[11px] leading-relaxed text-paper/75">{toast.description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            aria-label="Скрыть уведомление"
            className="-mr-1 -mt-0.5 rounded p-1 text-paper/55 transition-colors hover:bg-white/10 hover:text-paper"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------- Пустое состояние --------------------------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "px-5 py-10" : "px-6 py-14"
      )}
    >
      <div className="mb-3.5 flex h-11 w-11 items-center justify-center rounded-[8px] border border-line bg-surface text-muted shadow-card">
        {icon}
      </div>
      <h3 className="font-serif text-[18px] font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 max-w-[360px] text-[12.5px] leading-relaxed text-muted">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* --------------------- Сегментированный переключатель ------------------ */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: React.ReactNode }>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[6px] border border-line bg-paper-deep p-0.5",
        className
      )}
      role="tablist"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-[4px] px-2.5 text-[11.5px] font-medium transition-all",
            value === option.value
              ? "bg-surface text-ink shadow-[0_1px_2px_rgba(20,20,20,.08)]"
              : "text-muted hover:text-ink"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
