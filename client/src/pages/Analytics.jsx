import { useState } from 'react';
import { api } from '../services/api';
import { useApi } from '../hooks/useApi';
import { Alert, Card, ErrorState, PageHeader, Spinner } from '../components/common/ui';
import DateRangeFilter from '../components/dashboard/DateRangeFilter';
import { COLORS, Donut, HBars, MonthlyBars, MonthlyLines } from '../components/dashboard/charts';
import { stateName } from '../utils/format';

export default function Analytics() {
  const [range, setRange] = useState({ from: '', to: '' });
  const summary = useApi(() => api.get('/reports/summary', range), [range.from, range.to]);
  const sales = useApi(() => api.get('/reports/sales', range), [range.from, range.to]);
  const fraud = useApi(() => api.get('/reports/fraud', range), [range.from, range.to]);
  const error = summary.error || sales.error || fraud.error;
  const loading = (summary.loading && !summary.data) || (sales.loading && !sales.data) || (fraud.loading && !fraud.data);
  const reloadAll = () => { summary.reload(); sales.reload(); fraud.reload(); };
  const ready = summary.data && sales.data && fraud.data;

  return (
    <>
      <PageHeader title="Analytics" subtitle="Revenue, collections, product performance and fraud-alert trends computed from stored records." actions={<DateRangeFilter value={range} onChange={setRange} />} />
      <ErrorState error={error} onRetry={reloadAll} />
      {loading && <Spinner />}
      {ready && (
        <div className="space-y-6">
          {summary.data.cards.totalInvoices === 0 && <Alert tone="info" title="Not enough data yet">There are no invoices in this period, so charts are empty. Create invoices or run <code>npm run seed</code> for synthetic demo data.</Alert>}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card><MonthlyBars title="Monthly revenue (sales excl. GST)" data={sales.data.monthly} series={[{ key: 'sales', name: 'Sales', color: COLORS.primary }]} /></Card>
            <Card><MonthlyLines title="Invoice trend (count)" data={sales.data.monthly} currency={false} series={[{ key: 'invoices', name: 'Invoices', color: COLORS.teal }]} /></Card>
            <Card><MonthlyLines title="Invoiced vs collected" data={summary.data.monthly} series={[{ key: 'invoiced', name: 'Invoiced', color: COLORS.primary }, { key: 'collected', name: 'Collected (net of refunds)', color: COLORS.green }]} /></Card>
            <Card><Donut title="Invoice payment status" items={summary.data.paymentStatus.map((s) => ({ name: s.status, value: s.count }))} /></Card>
            <Card><HBars title="Top products by taxable sales" data={sales.data.byProduct.slice(0, 8)} nameKey="name" valueKey="taxable" /></Card>
            <Card><HBars title="Sales by customer state" data={sales.data.byRegion.map((r) => ({ ...r, name: stateName(r.stateCode) }))} nameKey="name" valueKey="taxable" color={COLORS.violet} /></Card>
          </div>

          <h2 className="pt-2 text-lg font-semibold text-slate-900">Fraud-risk alerts</h2>
          {fraud.data.total === 0 ? <Alert tone="info">No alerts in this period. Run an analysis from the Fraud Detection page.</Alert> : null}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card><HBars title="Alerts by category" data={fraud.data.byCategory.map((c) => ({ ...c, name: c.category.replaceAll('_', ' ').toLowerCase() }))} nameKey="name" valueKey="count" currency={false} color={COLORS.amber} /></Card>
            <Card><Donut title="Alerts by review status" items={fraud.data.byStatus.map((s) => ({ name: s.status, value: s.count }))} colorFor={(n) => ({ New: COLORS.sky, 'Under Review': COLORS.amber, Resolved: COLORS.green, 'False Positive': COLORS.slate }[n])} /></Card>
            <Card><MonthlyBars title="Alerts detected per month" data={fraud.data.trend} currency={false} series={[{ key: 'detected', name: 'All alerts', color: COLORS.amber }, { key: 'high', name: 'High severity', color: COLORS.red }]} /></Card>
            <Card><MonthlyBars title="Alert resolution trend" data={fraud.data.resolutionTrend} currency={false} stacked series={[{ key: 'resolved', name: 'Resolved', color: COLORS.green }, { key: 'falsePositive', name: 'False positive', color: COLORS.slate }]} /></Card>
          </div>
          <p className="text-xs text-slate-500">{fraud.data.notice} Average risk score: {fraud.data.averageRiskScore}.</p>
        </div>
      )}
    </>
  );
}
