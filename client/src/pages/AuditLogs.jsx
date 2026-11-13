import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useDebounce } from '../hooks/useDebounce';
import { Alert, Card, DataTable, PageHeader, Pagination } from '../components/common/ui';
import { formatDateTime } from '../utils/format';

const ENTITIES = ['Invoice', 'Payment', 'Customer', 'Product', 'FraudAlert', 'TaxConfiguration', 'User', 'Setting', 'Report', 'TransactionRecord'];

export default function AuditLogs() {
  const [f, setF] = useState({ entityType: '', action: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const action = useDebounce(f.action);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  useEffect(() => setPage(1), [f.entityType, action, f.from, f.to]);
  const { data, pagination, loading, error, reload } = useApi(() => api.get('/audit-logs', { ...f, action, page, limit: 15 }), [f.entityType, action, f.from, f.to, page]);

  return (
    <>
      <PageHeader title="Audit logs" subtitle="Append-only history of important actions. Entries cannot be edited or deleted through the application. Passwords and tokens are never logged." />
      <Alert tone="info" className="mb-4">Showing who did what and when. Use the filters to narrow by entity, action text (for example <code>invoice.</code> or <code>fraud.review</code>) or date.</Alert>
      <Card bodyClassName="p-0" title={
        <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-4" role="search">
          <select className="input" aria-label="Filter by entity" value={f.entityType} onChange={set('entityType')}><option value="">All entities</option>{ENTITIES.map((e) => <option key={e}>{e}</option>)}</select>
          <input type="search" className="input" placeholder="Action contains…" aria-label="Filter by action" value={f.action} onChange={set('action')} />
          <input type="date" className="input" aria-label="From date" value={f.from} onChange={set('from')} />
          <input type="date" className="input" aria-label="To date" value={f.to} min={f.from || undefined} onChange={set('to')} />
        </div>}>
        <DataTable rows={data} loading={loading} error={error} onRetry={reload} emptyTitle="No audit entries match" columns={[
          { key: 't', header: 'When', render: (r) => formatDateTime(r.timestamp) },
          { key: 'u', header: 'User', render: (r) => r.userName || <span className="text-slate-400">system</span> },
          { key: 'a', header: 'Action', render: (r) => <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{r.action}</code> },
          { key: 'e', header: 'Entity', render: (r) => <span>{r.entityType}{r.entityId ? <span className="block text-xs text-slate-400">{r.entityId.slice(-8)}</span> : null}</span> },
          { key: 's', header: 'Summary', className: 'max-w-md whitespace-normal', render: (r) => (r.summary ? <details><summary className="cursor-pointer text-xs text-brand-700">View changes</summary><pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(r.summary, null, 2)}</pre></details> : '-') },
        ]} />
        <Pagination pagination={pagination} onPage={setPage} />
      </Card>
    </>
  );
}
