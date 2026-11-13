import { useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useToast } from '../components/common/Toast';
import { Alert, Card, DataTable, ErrorState, PageHeader, Spinner, StatCard, Badge } from '../components/common/ui';
import DateRangeFilter from '../components/dashboard/DateRangeFilter';
import { formatCurrency, monthLabel } from '../utils/format';

export default function TaxReports() {
  const toast = useToast();
  const [range, setRange] = useState({ from: '', to: '' });
  const { data, loading, error, reload } = useApi(() => api.get('/reports/tax', range), [range.from, range.to]);

  const exportCsv = () => api.download('/reports/tax', 'tax-report.csv', { ...range, format: 'csv' }).catch((e) => toast.error(e.message));
  const t = data?.totals;

  return (
    <>
      <PageHeader title="Tax reports" subtitle="GST recorded on issued invoices, with invoice-level discrepancies and reconciliation against supplied transaction records."
        actions={<><DateRangeFilter value={range} onChange={setRange} /><button type="button" className="btn-secondary self-end" onClick={exportCsv}><Download className="h-4 w-4" />Export CSV</button></>} />
      <Alert tone="warning" className="mb-4" title="Recorded values, not verified tax liability">{data?.notice || 'Figures are the tax values recorded on invoices in this system. They are not independently verified tax liability and do not replace professional advice or returns filed with the tax authority.'}</Alert>
      <ErrorState error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Taxable sales" value={formatCurrency(t.taxable)} />
            <StatCard label="CGST recorded" value={formatCurrency(t.cgst)} tone="slate" />
            <StatCard label="SGST recorded" value={formatCurrency(t.sgst)} tone="slate" />
            <StatCard label="IGST recorded" value={formatCurrency(t.igst)} tone="slate" />
            <StatCard label="Total tax recorded" value={formatCurrency(t.totalTax)} tone="green" hint={`Invoiced ${formatCurrency(t.invoiced)}`} />
          </div>

          <Card title="Tax by category and rate" bodyClassName="p-0">
            <DataTable rowKey="category" rows={data.byRate.map((r) => ({ ...r, key: `${r.category}-${r.rate}` }))} emptyTitle="No taxable sales in this period" columns={[
              { key: 'category', header: 'Category', render: (r) => <Badge tone="blue">{r.category}</Badge> },
              { key: 'rate', header: 'Rate', align: 'right', render: (r) => `${r.rate}%` },
              { key: 'taxable', header: 'Taxable value', align: 'right', render: (r) => formatCurrency(r.taxable) },
              { key: 'cgst', header: 'CGST', align: 'right', render: (r) => formatCurrency(r.cgst) },
              { key: 'sgst', header: 'SGST', align: 'right', render: (r) => formatCurrency(r.sgst) },
              { key: 'igst', header: 'IGST', align: 'right', render: (r) => formatCurrency(r.igst) },
              { key: 'tax', header: 'Total tax', align: 'right', render: (r) => <strong>{formatCurrency(r.tax)}</strong> },
            ]} />
          </Card>

          <Card title="Tax by month" bodyClassName="p-0">
            <DataTable rowKey="month" rows={data.monthly} emptyTitle="No data" columns={[
              { key: 'month', header: 'Month', render: (r) => monthLabel(r.month) },
              { key: 'taxable', header: 'Taxable value', align: 'right', render: (r) => formatCurrency(r.taxable) },
              { key: 'cgst', header: 'CGST', align: 'right', render: (r) => formatCurrency(r.cgst) },
              { key: 'sgst', header: 'SGST', align: 'right', render: (r) => formatCurrency(r.sgst) },
              { key: 'igst', header: 'IGST', align: 'right', render: (r) => formatCurrency(r.igst) },
              { key: 'tax', header: 'Total tax', align: 'right', render: (r) => <strong>{formatCurrency(r.tax)}</strong> },
            ]} />
          </Card>

          <Card title={`Invoice-level discrepancies (${data.discrepancies.length})`} bodyClassName="p-0">
            <DataTable rowKey="invoiceId" rows={data.discrepancies.map((d, i) => ({ ...d, invoiceId: `${d.invoiceId}-${i}` }))} emptyTitle="No arithmetic or tax discrepancies found" emptyText="Every invoice in this period recomputes to its stored totals." columns={[
              { key: 'n', header: 'Invoice', render: (r) => <span className="font-medium">{r.invoiceNumber}</span> },
              { key: 'c', header: 'Customer' },
              { key: 'cat', header: 'Type', render: (r) => <Badge tone="amber">{r.category === 'TAX_DISCREPANCY' ? 'Tax discrepancy' : 'Incorrect total'}</Badge> },
              { key: 'd', header: 'Detail', className: 'max-w-xl whitespace-normal', render: (r) => r.description },
            ]} />
          </Card>

          <Card title="Reconciliation: recorded sales vs supplied transaction records" bodyClassName="p-0">
            <DataTable rowKey="month" rows={data.reconciliation} emptyTitle="No supplied transaction records" emptyText="Import transaction records on the Fraud Detection page to compare them with recorded sales." columns={[
              { key: 'month', header: 'Month', render: (r) => monthLabel(r.month) },
              { key: 'rec', header: 'Recorded sales (incl. GST)', align: 'right', render: (r) => formatCurrency(r.recorded) },
              { key: 'sup', header: 'Supplied records', align: 'right', render: (r) => formatCurrency(r.supplied) },
              { key: 'diff', header: 'Difference', align: 'right', render: (r) => formatCurrency(r.difference) },
              { key: 'pct', header: '%', align: 'right', render: (r) => `${r.differencePct}%` },
              { key: 'flag', header: 'Result', render: (r) => (r.flag ? <Badge tone="amber">{r.flag === 'POTENTIAL_UNDER_REPORTING' ? 'Possible under-reporting indicator' : 'Difference above tolerance'}</Badge> : <Badge tone="green">Within tolerance</Badge>) },
            ]} />
          </Card>
        </div>
      )}
    </>
  );
}
