import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cpu, FileUp, Play } from 'lucide-react';
import { api } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useDebounce } from '../hooks/useDebounce';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/common/Toast';
import { Alert, Card, DataTable, PageHeader, Pagination, StatusBadge } from '../components/common/ui';
import AlertDetailModal from '../components/fraud/AlertDetailModal';
import ImportTransactionsModal from '../components/fraud/ImportTransactionsModal';
import { formatDateTime } from '../utils/format';

export default function FraudDetection() {
  const { can } = useAuth();
  const toast = useToast();
  const [filters, setFilters] = useState({ search: '', category: '', severity: '', reviewStatus: '' });
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [running, setRunning] = useState(false);
  const [includeMl, setIncludeMl] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const search = useDebounce(filters.search);
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  useEffect(() => setPage(1), [search, filters.category, filters.severity, filters.reviewStatus]);

  const meta = useApi(() => api.get('/fraud-alerts/meta'), []);
  const { data, pagination, loading, error, reload } = useApi(
    () => api.get('/fraud-alerts', { ...filters, search, page, limit: 10 }),
    [search, filters.category, filters.severity, filters.reviewStatus, page]
  );
  const m = meta.data;

  const analyze = async () => {
    setRunning(true);
    try {
      const body = await api.post('/fraud-alerts/analyze', { includeMl });
      toast.success(body.message);
      if (includeMl && !body.data.ml.available) toast.error(`ML indicator skipped: ${body.data.ml.reason || 'service unavailable'}`);
      reload();
      meta.reload();
    } catch (e) { toast.error(e.message); } finally { setRunning(false); }
  };

  return (
    <>
      <PageHeader title="Fraud-risk detection" subtitle="Explainable rules flag records for human review. An alert is not a finding that fraud occurred."
        actions={<>
          {can('transactions:import') && <button type="button" className="btn-secondary" onClick={() => setShowImport(true)}><FileUp className="h-4 w-4" />Import transactions</button>}
          {can('fraud:analyze') && <button type="button" className="btn-primary" onClick={analyze} disabled={running}><Play className="h-4 w-4" />{running ? 'Analysing…' : 'Run analysis'}</button>}
        </>} />

      <div className="mb-4 grid gap-3 lg:grid-cols-2">
        <Alert tone="info" title="How scores work">Each alert has a 0–100 risk score built from a rule weight, the size of the discrepancy and corroborating categories on the same record. Low &lt; {m?.thresholds.mediumSeverityFrom ?? 35} ≤ Medium &lt; {m?.thresholds.highSeverityFrom ?? 65} ≤ High. Thresholds are illustrative defaults, configurable in Settings, and the score is <strong>not</strong> a probability of fraud. Detection version: {m?.detectionVersion || '…'}.</Alert>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3.5 text-sm">
          <Cpu className="h-5 w-5 text-slate-400" aria-hidden="true" />
          <div className="flex-1">
            <p className="font-medium text-slate-800">Optional ML anomaly indicator (Isolation Forest)</p>
            <p className="text-slate-500">{!m ? 'Checking…' : m.ml.available ? 'ML service is reachable. It is unsupervised and has not been validated against labelled fraud cases.' : m.ml.configured ? 'ML service is configured but not reachable. Rule-based detection still works.' : 'ML service not configured (optional). Rule-based detection is fully functional.'}</p>
            <p className="text-slate-500">Supplied transaction records for reconciliation: {m?.suppliedTransactionRecords ?? '…'}</p>
          </div>
          {can('fraud:analyze') && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={includeMl} disabled={!m?.ml.available} onChange={(e) => setIncludeMl(e.target.checked)} />Include ML on next run</label>}
        </div>
      </div>

      <Card bodyClassName="p-0" title={
        <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-4" role="search">
          <input type="search" className="input" placeholder="Search alert, invoice or customer" aria-label="Search alerts" value={filters.search} onChange={set('search')} />
          <select className="input" aria-label="Filter by category" value={filters.category} onChange={set('category')}><option value="">All categories</option>{Object.entries(m?.categories || {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select className="input" aria-label="Filter by severity" value={filters.severity} onChange={set('severity')}><option value="">All severities</option><option>High</option><option>Medium</option><option>Low</option></select>
          <select className="input" aria-label="Filter by review status" value={filters.reviewStatus} onChange={set('reviewStatus')}><option value="">All statuses</option><option>New</option><option>Under Review</option><option>Resolved</option><option>False Positive</option></select>
        </div>}>
        <DataTable rows={data} loading={loading} error={error} onRetry={reload} onRowClick={(r) => setOpenId(r._id)} emptyTitle="No alerts" emptyText="Nothing matches these filters. Run an analysis to check current records." columns={[
          { key: 'id', header: 'Alert', render: (r) => <span className="font-medium text-brand-700">{r.alertId}</span> },
          { key: 'cat', header: 'Category', render: (r) => m?.categories?.[r.category] || r.category },
          { key: 'inv', header: 'Invoice', render: (r) => r.invoice?.invoiceNumber || <span className="text-slate-400">{r.entityType === 'reconciliation' ? `Month ${r.entityId}` : '—'}</span> },
          { key: 'desc', header: 'Explanation', className: 'max-w-md', render: (r) => <p className="line-clamp-2 text-slate-600" title={r.description}>{r.description}</p> },
          { key: 'score', header: 'Risk', align: 'right', render: (r) => <span className="font-semibold">{r.riskScore}</span> },
          { key: 'sev', header: 'Severity', render: (r) => <StatusBadge status={r.severity} /> },
          { key: 'meth', header: 'Method', render: (r) => <span className="text-xs text-slate-500">{r.detectionMethod}<br />{r.detectionVersion}</span> },
          { key: 'det', header: 'Detected', render: (r) => formatDateTime(r.detectedAt) },
          { key: 'st', header: 'Status', render: (r) => <StatusBadge status={r.reviewStatus} /> },
        ]} />
        <Pagination pagination={pagination} onPage={setPage} />
      </Card>
      <p className="mt-3 text-xs text-slate-500">Alerts are never deleted: resolved and false-positive alerts stay on record with their history. Related invoices open from <Link className="underline" to="/invoices">Invoice History</Link>.</p>

      <AlertDetailModal alertId={openId} onClose={() => setOpenId(null)} onChanged={() => { reload(); }} />
      <ImportTransactionsModal open={showImport} onClose={() => setShowImport(false)} onImported={meta.reload} />
    </>
  );
}
