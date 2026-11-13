import { useEffect, useState } from 'react';
import { AlertTriangle, Download, Eye } from 'lucide-react';
import { api } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useDebounce } from '../hooks/useDebounce';
import { useToast } from '../components/common/Toast';
import { Card, DataTable, PageHeader, Pagination, StatusBadge } from '../components/common/ui';
import InvoiceDetailModal from '../components/invoices/InvoiceDetailModal';
import { formatCurrency, formatDate } from '../utils/format';

export default function InvoiceHistory() {
  const toast = useToast();
  const [filters, setFilters] = useState({ search: '', customer: '', paymentStatus: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [viewId, setViewId] = useState(null);
  const search = useDebounce(filters.search);
  const customers = useApi(() => api.get('/customers', { limit: 100, includeArchived: 'true' }), []);
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  useEffect(() => setPage(1), [search, filters.customer, filters.paymentStatus, filters.from, filters.to]);

  const { data, pagination, loading, error, reload } = useApi(
    () => api.get('/invoices', { ...filters, search, page, limit: 10 }),
    [search, filters.customer, filters.paymentStatus, filters.from, filters.to, page]
  );

  const pdf = (r) => api.download(`/invoices/${r._id}/pdf`, `${r.invoiceNumber}.pdf`).catch((e) => toast.error(e.message));
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <>
      <PageHeader title="Invoice history" subtitle="Search, filter and open any invoice. Cancelled invoices are kept for audit purposes." />
      <Card bodyClassName="p-0" title={
        <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-6" role="search">
          <input type="search" className="input lg:col-span-2" placeholder="Search invoice number or customer" aria-label="Search invoices" value={filters.search} onChange={set('search')} />
          <select className="input" aria-label="Filter by customer" value={filters.customer} onChange={set('customer')}><option value="">All customers</option>{(customers.data || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</select>
          <select className="input" aria-label="Filter by payment status" value={filters.paymentStatus} onChange={set('paymentStatus')}><option value="">All payment statuses</option><option>Unpaid</option><option>Partially Paid</option><option>Paid</option></select>
          <input type="date" className="input" aria-label="From date" value={filters.from} onChange={set('from')} />
          <input type="date" className="input" aria-label="To date" value={filters.to} min={filters.from || undefined} onChange={set('to')} />
        </div>}>
        <DataTable rows={data} loading={loading} error={error} onRetry={reload} emptyTitle="No invoices found" emptyText={hasFilters ? 'No invoice matches these filters.' : 'Create your first invoice to see it here.'} columns={[
          { key: 'n', header: 'Invoice', render: (r) => <span className="font-medium text-slate-900">{r.invoiceNumber}</span> },
          { key: 'c', header: 'Customer', render: (r) => r.customerSnapshot?.name },
          { key: 'd', header: 'Date', render: (r) => formatDate(r.invoiceDate) },
          { key: 'due', header: 'Due', render: (r) => <span className={r.isOverdue ? 'font-medium text-red-700' : ''}>{formatDate(r.dueDate)}</span> },
          { key: 't', header: 'Total', align: 'right', render: (r) => formatCurrency(r.grandTotal) },
          { key: 'o', header: 'Outstanding', align: 'right', render: (r) => formatCurrency(r.outstanding) },
          { key: 's', header: 'Status', render: (r) => <div className="flex flex-wrap gap-1">{r.status === 'Cancelled' ? <StatusBadge status="Cancelled" /> : <StatusBadge status={r.paymentStatus} />}</div> },
          { key: 'f', header: 'Alerts', render: (r) => (r.openAlerts ? <span className="inline-flex items-center gap-1 text-amber-700" title={`Highest risk score ${r.maxRiskScore}`}><AlertTriangle className="h-4 w-4" />{r.openAlerts}</span> : <span className="text-slate-300">—</span>) },
          { key: 'a', header: <span className="sr-only">Actions</span>, render: (r) => (
            <div className="flex justify-end gap-1">
              <button type="button" className="btn-ghost px-2 py-1" aria-label={`View ${r.invoiceNumber}`} onClick={() => setViewId(r._id)}><Eye className="h-4 w-4" /></button>
              <button type="button" className="btn-ghost px-2 py-1" aria-label={`Download PDF for ${r.invoiceNumber}`} onClick={() => pdf(r)}><Download className="h-4 w-4" /></button>
            </div>) },
        ]} />
        <Pagination pagination={pagination} onPage={setPage} />
      </Card>
      <InvoiceDetailModal invoiceId={viewId} onClose={() => setViewId(null)} onChanged={reload} />
    </>
  );
}
