import type { PropsWithChildren, ReactNode } from 'react';
import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api';
export function PageTitle({
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        {description ? <p className="muted">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}
export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null;
  const message =
    error instanceof Error ? error.message : 'Something went wrong. Please try again.';
  return (
    <div className="notice danger" role="alert">
      <strong>Action needed</strong>
      <p>{message}</p>
      {error instanceof ApiError && error.fields ? (
        <ul>
          {Object.entries(error.fields).map(([name, text]) => (
            <li key={name}>
              {name}: {text}
            </li>
          ))}
        </ul>
      ) : null}
      {error instanceof ApiError && error.requestId ? (
        <small>Reference: {error.requestId}</small>
      ) : null}
      {retry ? (
        <button type="button" className="button secondary small" onClick={retry}>
          Reload data
        </button>
      ) : null}
    </div>
  );
}
export function Loading({ label = 'Loading your workspace...' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
}: PropsWithChildren<{ title: string; action?: ReactNode }>) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <div className="muted">{children}</div>
      {action}
    </div>
  );
}
export function Badge({
  value,
  label: customLabel,
}: {
  value: string | undefined | null;
  label?: string;
}) {
  const label = customLabel ?? (value ? value.replaceAll('_', ' ').toLowerCase() : 'Unknown');
  const tone =
    value && ['COMPLETED', 'ACCEPTED', 'ACTIVE'].includes(value)
      ? 'success'
      : value && ['PENDING', 'DISPUTED', 'HIGH', 'Lost', 'Stolen'].includes(value)
        ? 'warning'
        : '';
  return <span className={`badge ${tone}`}>{label}</span>;
}
export function Metric({
  label,
  value,
  detail,
  to,
}: {
  label: string;
  value: number | string | undefined;
  detail?: string;
  to?: string;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value ?? '—'}</strong>
      {detail ? <small>{detail}</small> : null}
    </>
  );
  return to ? (
    <Link className="metric" to={to}>
      {content}
    </Link>
  ) : (
    <div className="metric">{content}</div>
  );
}
export function Panel({
  title,
  children,
  action,
  className = '',
}: PropsWithChildren<{ title?: string; action?: ReactNode; className?: string }>) {
  return (
    <section className={`panel ${className}`}>
      {title ? (
        <div className="panel-heading">
          <h2>{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}
export function Field({
  label,
  htmlFor,
  children,
  hint,
}: PropsWithChildren<{ label: string; htmlFor: string; hint?: string }>) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}
export function Checkbox({
  label,
  checked,
  onChange,
  className = '',
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <label className={`checkbox ${className}`.trim()}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
export function Select({
  label,
  htmlFor,
  value,
  onChange,
  options,
  hint,
  disabled = false,
  required = false,
  ariaDescribedBy,
}: {
  label: string;
  htmlFor: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  hint?: string;
  disabled?: boolean;
  required?: boolean;
  ariaDescribedBy?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <Field label={label} htmlFor={htmlFor} hint={hint}>
      <div ref={selectRef} className="custom-select" data-open={isOpen} data-disabled={disabled}>
        <button
          type="button"
          id={htmlFor}
          className="custom-select-trigger"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-describedby={ariaDescribedBy}
        >
          <span className="custom-select-value">
            {selectedOption ? selectedOption.label : 'Select...'}
          </span>
          <span className="custom-select-arrow">▼</span>
        </button>
        {isOpen && !disabled && (
          <ul className="custom-select-menu" role="listbox">
            {options.map((option) => (
              <li
                key={option.value}
                className={`custom-select-option ${option.value === value ? 'selected' : ''} ${option.disabled ? 'disabled' : ''}`}
                onClick={() => {
                  if (!option.disabled) {
                    onChange(option.value);
                    setIsOpen(false);
                  }
                }}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled}
              >
                {option.label}
              </li>
            ))}
          </ul>
        )}
        {required && (
          <input
            type="hidden"
            id={`${htmlFor}-hidden`}
            value={value}
            required={required}
            onChange={() => {}}
          />
        )}
      </div>
    </Field>
  );
}
export function LoadMore({
  available,
  loading,
  onClick,
}: {
  available?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  return available ? (
    <button
      className="button secondary load-more"
      type="button"
      disabled={loading}
      onClick={onClick}
    >
      {loading ? 'Loading...' : 'Load more'}
    </button>
  ) : null;
}
export function displayDate(value: string | null | undefined, withTime = false) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' as const } : {}),
    timeZone: 'Asia/Kolkata',
  }).format(date);
}
export function Timeline({
  items,
}: {
  items: {
    id: string;
    createdAt: string;
    kind?: string;
    type?: string;
    summary?: string;
    body?: string;
    visibility?: string;
    authorName?: string;
  }[];
}) {
  return items.length ? (
    <ol className="timeline">
      {items.map((item) => (
        <li key={item.id}>
          <div className="timeline-meta">
            <strong>{item.authorName ?? item.kind ?? item.type ?? 'Update'}</strong>
            <time dateTime={item.createdAt}>{displayDate(item.createdAt, true)}</time>
            {item.visibility === 'INTERNAL' ? <Badge value="INTERNAL" /> : null}
          </div>
          <p className="preserve">{item.body ?? item.summary}</p>
        </li>
      ))}
    </ol>
  ) : (
    <p className="muted">No history available yet.</p>
  );
}
