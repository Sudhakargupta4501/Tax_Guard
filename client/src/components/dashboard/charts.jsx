import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCompact, formatCurrency, monthLabel } from '../../utils/format';
import { EmptyState } from '../common/ui';

// One consistent palette; status colours are also distinguished by text labels/legend, never by colour alone.
export const COLORS = { primary: '#4f46e5', teal: '#0d9488', amber: '#d97706', red: '#dc2626', green: '#059669', slate: '#64748b', violet: '#7c3aed', sky: '#0284c7' };
const STATUS_COLORS = { Paid: COLORS.green, 'Partially Paid': COLORS.amber, Unpaid: COLORS.red, Low: COLORS.green, Medium: COLORS.amber, High: COLORS.red };

function ChartBox({ title, data, height = 280, empty = 'No data for this period yet.', children, ariaLabel }) {
  return (
    <div role="img" aria-label={ariaLabel || title}>
      <h3 className="mb-2 text-sm font-semibold text-slate-800">{title}</h3>
      {!data?.length ? <EmptyState title="No data yet">{empty}</EmptyState> : <div style={{ height }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>}
    </div>
  );
}

const money = (v) => formatCurrency(v);
const axisMoney = (v) => formatCompact(v);

/** series: [{ key, name, color, type? }] over data rows keyed by `month`. */
export function MonthlyBars({ title, data, series, currency = true, stacked = false }) {
  const rows = (data || []).map((d) => ({ ...d, label: monthLabel(d.month) }));
  return (
    <ChartBox title={title} data={rows}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={currency ? axisMoney : undefined} allowDecimals={false} width={56} />
        <Tooltip formatter={(v, n) => [currency ? money(v) : v, n]} />
        {series.length > 1 && <Legend />}
        {series.map((s) => <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} stackId={stacked ? 'a' : undefined} radius={stacked ? 0 : [4, 4, 0, 0]} />)}
      </BarChart>
    </ChartBox>
  );
}

export function MonthlyLines({ title, data, series, currency = true }) {
  const rows = (data || []).map((d) => ({ ...d, label: monthLabel(d.month) }));
  return (
    <ChartBox title={title} data={rows}>
      <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={currency ? axisMoney : undefined} allowDecimals={false} width={56} />
        <Tooltip formatter={(v, n) => [currency ? money(v) : v, n]} />
        <Legend />
        {series.map((s) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={{ r: 3 }} />)}
      </LineChart>
    </ChartBox>
  );
}

/** Donut for categorical counts. items: [{ name, value }]. */
export function Donut({ title, items, colorFor }) {
  const data = (items || []).filter((i) => i.value > 0);
  const palette = Object.values(COLORS);
  return (
    <ChartBox title={title} data={data} height={260}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
          {data.map((d, i) => <Cell key={d.name} fill={(colorFor ? colorFor(d.name) : STATUS_COLORS[d.name]) || palette[i % palette.length]} />)}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ChartBox>
  );
}

/** Horizontal bars (product / category / region breakdowns). */
export function HBars({ title, data, nameKey, valueKey, currency = true, color = COLORS.primary, height }) {
  const rows = data || [];
  return (
    <ChartBox title={title} data={rows} height={height || Math.max(220, rows.length * 34 + 40)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={currency ? axisMoney : undefined} allowDecimals={false} />
        <YAxis type="category" dataKey={nameKey} tick={{ fontSize: 12 }} width={130} />
        <Tooltip formatter={(v) => [currency ? money(v) : v, '']} />
        <Bar dataKey={valueKey} fill={color} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartBox>
  );
}
