import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, FileText, Receipt, Wallet, CheckCircle2, Clock, ShieldAlert, Files } from 'lucide-react';
import { api } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { Alert, Card, DataTable, ErrorState, PageHeader, Spinner, StatCard, StatusBadge } from '../components/common/ui';
import DateRangeFilter from '../components/dashboard/DateRangeFilter';
import { COLORS, Donut, MonthlyBars } from '../components/dashboard/charts';
import { formatCurrency, formatDate, formatNumber } from '../utils/format';

export default function Dashboard() {
  const { user, can } = useAuth();
  const [range, setRange] = useState({ from: '', to: '' });
  const { data, loading, error, reload } = useApi(() => api.get('/reports/summary', range), [range.from, range.to]);
  const c = data?.cards;

  return (
    <>
      <PageHeader title={`Welcome, ${user.name.split(' ')[0]}`} subtitle="Figures below come from invoices and payments stored in the database for the selected period."
        actions={<DateRangeFilter value={range} onChange={setRange} />} />
      <ErrorState error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total sales" value={formatCurrency(c.totalSales)} hint="Net of discounts, excl. GST" icon={Banknote} tone="green" />
            <StatCard label="Total invoiced" value={formatCurrency(c.totalInvoiced)} hint="Including GST" icon={FileText} />
            <StatCard label="Tax recorded" value={formatCurrency(c.totalTax)} hint="Recorded, not verified liability" icon={Receipt} tone="slate" />
            <StatCard label="Outstanding" value={formatCurrency(c.outstanding)} hint={`Collected ${formatCurrency(c.collected)}`} icon={Wallet} tone="amber" />
            <StatCard label="Total invoices" value={formatNumber(c.totalInvoices)} icon={Files} />
            <StatCard label="Paid invoices" value={formatNumber(c.paidInvoices)} icon={CheckCircle2} tone="green" />
            <StatCard label="Unpaid invoices" value={formatNumber(c.unpaidInvoices)} hint={`${c.partialInvoices} partially paid`} icon={Clock} tone="amber" />
            <StatCard label="Open fraud alerts" value={formatNumber(c.openAlerts)} hint="New or under review" icon={ShieldAlert} tone={c.openAlerts ? 'red' : 'green'} />
          </div>

          {c.totalInvoices === 0 && <Alert tone="info" title="No invoices in this period">Create an invoice, widen the date range, or load the synthetic demo data with <code>npm run seed</code> to see charts populate.</Alert>}

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2"><MonthlyBars title="Monthly sales and tax recorded" data={data.monthly} series={[{ key: 'sales', name: 'Sales (excl. GST)', color: COLORS.primary }, { key: 'tax', name: 'Tax recorded', color: COLORS.teal }]} /></Card>
            <Card><Donut title="Invoice payment status" items={data.paymentStatus.map((s) => ({ name: s.status, value: s.count }))} /></Card>
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2"><MonthlyBars title="Outstanding amount by invoice month" data={data.monthly} series={[{ key: 'outstanding', name: 'Outstanding', color: COLORS.amber }]} /></Card>
            <Card><Donut title="Open alerts by severity" items={data.alertsBySeverity.map((s) => ({ name: s.severity, value: s.count }))} /></Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Recent invoices" bodyClassName="p-0" actions={<Link className="text-xs font-medium text-brand-700 hover:underline" to="/invoices">View all</Link>}>
              <DataTable rows={data.recentInvoices} emptyTitle="No invoices yet" columns={[
                { key: 'n', header: 'Invoice', render: (r) => <span className="font-medium">{r.invoiceNumber}</span> },
                { key: 'c', header: 'Customer', render: (r) => r.customerSnapshot?.name },
                { key: 'd', header: 'Date', render: (r) => formatDate(r.invoiceDate) },
                { key: 't', header: 'Total', align: 'right', render: (r) => formatCurrency(r.grandTotal) },
                { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.paymentStatus} /> },
              ]} />
            </Card>
            {can('fraud:read') && (
              <Card title="Recent fraud-risk alerts" bodyClassName="p-0" actions={<Link className="text-xs font-medium text-brand-700 hover:underline" to="/fraud">Review</Link>}>
                <DataTable rows={data.recentAlerts} emptyTitle="No alerts" emptyText="Run an analysis from the Fraud Detection page." columns={[
                  { key: 'a', header: 'Alert', render: (r) => <span className="font-medium">{r.alertId}</span> },
                  { key: 'i', header: 'Invoice', render: (r) => r.invoice?.invoiceNumber || '-' },
                  { key: 'sc', header: 'Score', align: 'right', render: (r) => r.riskScore },
                  { key: 'sv', header: 'Severity', render: (r) => <StatusBadge status={r.severity} /> },
                  { key: 'st', header: 'Status', render: (r) => <StatusBadge status={r.reviewStatus} /> },
                ]} />
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
