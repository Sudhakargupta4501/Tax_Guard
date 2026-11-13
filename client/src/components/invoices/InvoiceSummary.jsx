import { formatCurrency } from '../../utils/format';

/** Totals block shared by the Create Invoice preview and invoice details. Expects rupee values. */
export default function InvoiceSummary({ subtotal, discount, taxable, cgst, sgst, igst, totalTax, grandTotal, supplyType }) {
  const rows = [
    ['Subtotal', subtotal],
    ['Discount', -Math.abs(discount || 0)],
    ['Taxable amount', taxable],
    ...(supplyType === 'inter' ? [['IGST', igst]] : [['CGST', cgst], ['SGST', sgst]]),
    ['Total tax', totalTax],
  ];
  return (
    <dl className="space-y-1.5 text-sm" aria-label="Invoice totals">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-6">
          <dt className="text-slate-500">{label}</dt>
          <dd className="tabular-nums text-slate-800" data-testid={`sum-${label.toLowerCase().replace(/\s+/g, '-')}`}>{formatCurrency(value)}</dd>
        </div>
      ))}
      <div className="flex justify-between gap-6 border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">
        <dt>Grand total</dt>
        <dd className="tabular-nums" data-testid="sum-grand-total">{formatCurrency(grandTotal)}</dd>
      </div>
    </dl>
  );
}
