import { cloneElement, isValidElement, useEffect, useId, useRef } from 'react';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Info, Loader2, RefreshCw, X, Inbox, AlertTriangle } from 'lucide-react';

export const cx = (...c) => c.filter(Boolean).join(' ');

export function Spinner({ label = 'Loading…', className = '' }) {
  return (
    <div role="status" className={cx('flex items-center justify-center gap-2 py-10 text-slate-500', className)}>
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function Alert({ tone = 'info', title, children, onRetry, className = '' }) {
  const tones = {
    info: ['border-sky-200 bg-sky-50 text-sky-900', Info],
    success: ['border-emerald-200 bg-emerald-50 text-emerald-900', CheckCircle2],
    warning: ['border-amber-200 bg-amber-50 text-amber-900', AlertTriangle],
    error: ['border-red-200 bg-red-50 text-red-900', AlertCircle],
  };
  const [cls, Icon] = tones[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'note'} className={cx('flex gap-3 rounded-lg border p-3.5 text-sm', cls, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
        {onRetry && <button type="button" onClick={onRetry} className="mt-2 inline-flex items-center gap-1.5 font-medium underline underline-offset-2"><RefreshCw className="h-3.5 w-3.5" />Try again</button>}
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  if (!error) return null;
  return <Alert tone="error" title={error.network ? 'Connection problem' : 'Something went wrong'} onRetry={onRetry}>{error.message}</Alert>;
}

export function EmptyState({ title = 'Nothing here yet', children, icon: Icon = Inbox, action }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <Icon className="h-9 w-9 text-slate-300" aria-hidden="true" />
      <p className="font-medium text-slate-700">{title}</p>
      {children && <p className="max-w-md text-slate-500">{children}</p>}
      {action}
    </div>
  );
}

export function Card({ title, actions, children, className = '', bodyClassName = 'p-5' }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
          {title && (typeof title === 'string' ? <h2 className="text-sm font-semibold text-slate-900">{title}</h2> : title)}
          {actions}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'brand' }) {
  const tones = { brand: 'bg-brand-50 text-brand-700', green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', red: 'bg-red-50 text-red-700', slate: 'bg-slate-100 text-slate-600' };
  return (
    <div className="card flex items-start gap-3 p-4">
      {Icon && <span className={cx('rounded-lg p-2.5', tones[tone])}><Icon className="h-5 w-5" aria-hidden="true" /></span>}
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-0.5 truncate text-xl font-semibold text-slate-900" title={String(value)}>{value}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}

const BADGE_TONES = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  purple: 'bg-violet-50 text-violet-700 ring-violet-200',
};
export function Badge({ tone = 'slate', children }) {
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', BADGE_TONES[tone])}>{children}</span>;
}

const STATUS_TONE = {
  Paid: 'green', 'Partially Paid': 'amber', Unpaid: 'red', Issued: 'blue', Cancelled: 'slate',
  Low: 'green', Medium: 'amber', High: 'red',
  New: 'blue', 'Under Review': 'amber', Resolved: 'green', 'False Positive': 'slate',
  active: 'green', disabled: 'slate', payment: 'green', refund: 'amber',
};
export const StatusBadge = ({ status }) => <Badge tone={STATUS_TONE[status] || 'slate'}>{status}</Badge>;

export function Field({ label, error, hint, required, children, className = '' }) {
  const id = useId();
  const inputId = (isValidElement(children) && children.props.id) || id;
  const child = isValidElement(children)
    ? cloneElement(children, { id: inputId, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': error ? `${id}-err` : hint ? `${id}-hint` : undefined })
    : children;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-slate-700">
        {label}{required && <span className="text-red-600" aria-hidden="true"> *</span>}
      </label>
      {child}
      {hint && !error && <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-red-600">{error.message || error}</p>}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer, size = 'md' }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={cx('flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl outline-none sm:rounded-2xl', widths[size])}>
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, busy, onConfirm, onCancel, children }) {
  return (
    <Modal open={open} title={title} onClose={onCancel} size="sm"
      footer={<>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{confirmLabel}</button>
      </>}>
      <p className="text-slate-600">{message}</p>
      {children}
    </Modal>
  );
}

export function Pagination({ pagination, onPage }) {
  if (!pagination || pagination.pages <= 1) {
    return pagination ? <p className="px-4 py-3 text-xs text-slate-500">{pagination.total} record{pagination.total === 1 ? '' : 's'}</p> : null;
  }
  const { page, pages, total, limit } = pagination;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
      <p className="text-xs text-slate-500">Showing {from}–{to} of {total}</p>
      <div className="flex items-center gap-1">
        <button type="button" className="btn-secondary px-2 py-1" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
        <span className="px-2 text-xs text-slate-600">Page {page} of {pages}</span>
        <button type="button" className="btn-secondary px-2 py-1" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </nav>
  );
}

/** Responsive table: horizontally scrollable on small screens. */
export function DataTable({ columns, rows, loading, error, onRetry, emptyTitle, emptyText, rowKey = '_id', onRowClick, caption }) {
  if (error) return <div className="p-4"><ErrorState error={error} onRetry={onRetry} /></div>;
  if (loading && !rows?.length) return <Spinner />;
  if (!rows?.length) return <EmptyState title={emptyTitle || 'No records found'}>{emptyText}</EmptyState>;
  return (
    <div className={cx('overflow-x-auto', loading && 'opacity-60')}>
      <table className="min-w-full divide-y divide-slate-100 text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead><tr>{columns.map((c) => <th key={c.key} scope="col" className={cx('th', c.align === 'right' && 'text-right')}>{c.header}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row[rowKey]} className={cx(onRowClick && 'cursor-pointer hover:bg-slate-50')} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {columns.map((c) => <td key={c.key} className={cx('td', c.align === 'right' && 'text-right tabular-nums', c.className)}>{c.render ? c.render(row) : row[c.key] ?? '-'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SearchBar({ value, onChange, placeholder = 'Search…', children }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="search" className="input max-w-xs" placeholder={placeholder} aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      {children}
    </div>
  );
}

export const SubmitButton = ({ busy, children, ...p }) => (
  <button type="submit" className="btn-primary" disabled={busy || p.disabled} {...p}>
    {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{children}
  </button>
);
