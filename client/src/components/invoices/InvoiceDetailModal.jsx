import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Ban } from 'lucide-react';
import { api } from '../../services/api';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../common/Toast';
import { Alert, ErrorState, Field, Modal, Spinner, StatusBadge } from '../common/ui';
import InvoiceSummary from './InvoiceSummary';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format';

export default function InvoiceDetailModal({ invoiceId, onClose, onChanged }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useApi(() => api.get(`/invoices/${invoiceId}`), [invoiceId], { enabled: Boolean(invoiceId) });
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const inv = data?.invoice;
  const canCancel = ['admin', 'business_owner'].includes(user?.role);

  const downloadPdf = async () => {
    try { await api.download(`/invoices/${invoiceId}/pdf`, `${inv.invoiceNumber}.pdf`); } catch (e) { toast.error(e.message); }
  };
  const cancelInvoice = async () => {
    setBusy(true);
    try {
      await api.put(`/invoices/${invoiceId}`, { status: 'Cancelled', cancelReason: reason });
      toast.success('Invoice cancelled');
      setCancelling(false);
      reload();
      onChanged?.();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={Boolean(invoiceId)} onClose={onClose} size="lg" title={inv ? `Invoice ${inv.invoiceNumber}` : 'Invoice details'}
      footer={inv && <>
        {canCancel && inv.status === 'Issued' && !cancelling && <button type="button" className="btn-secondary mr-auto text-red-700" onClick={() => setCancelling(true)}><Ban className="h-4 w-4" />Cancel invoice</button>}
        {can('payment:write') && inv.status === 'Issued' && inv.outstanding > 0 && <Link className="btn-secondary" to={`/payments?invoice=${inv._id}`}>Record payment</Link>}
        <button type="button" className="btn-primary" onClick={downloadPdf}><Download className="h-4 w-4" />Download PDF</button>
      </>}>
      {loading && !data && <Spinner />}
      <ErrorState error={error} onRetry={reload} />
      {inv && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={inv.status} />
            <StatusBadge status={inv.paymentStatus} />
            {inv.isOverdue && <span className="text-xs font-medium text-red-700">Overdue</span>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase text-slate-500">Bill to</h3>
              <p className="font-medium text-slate-900">{inv.customerSnapshot?.name}</p>
              <p className="text-slate-600">{inv.customerSnapshot?.address || 'No address recorded'}</p>
              <p className="text-slate-600">GSTIN: {inv.customerSnapshot?.gstin || 'Not provided'}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              <dt className="text-slate-500">Invoice date</dt><dd>{formatDate(inv.invoiceDate)}</dd>
              <dt className="text-slate-500">Due date</dt><dd>{formatDate(inv.dueDate)}</dd>
              <dt className="text-slate-500">Supply</dt><dd>{inv.supplyType === 'intra' ? 'Intra-state (CGST+SGST)' : 'Inter-state (IGST)'}</dd>
              <dt className="text-slate-500">Paid</dt><dd>{formatCurrency(inv.amountPaid)}</dd>
              <dt className="text-slate-500">Outstanding</dt><dd className="font-semibold">{formatCurrency(inv.outstanding)}</dd>
            </dl>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead><tr>{['Item', 'Qty', 'Rate', 'Disc %', 'Taxable', 'GST %', 'Tax', 'Total'].map((h, i) => <th key={h} className={`th ${i > 0 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {inv.items.map((it) => (
                  <tr key={it._id}>
                    <td className="td"><p className="font-medium">{it.name}</p>{it.description && <p className="text-xs text-slate-500">{it.description}</p>}</td>
                    <td className="td text-right tabular-nums">{it.quantity}</td>
                    <td className="td text-right tabular-nums">{formatCurrency(it.unitPrice)}</td>
                    <td className="td text-right tabular-nums">{it.discountPercent}</td>
                    <td className="td text-right tabular-nums">{formatCurrency(it.taxableAmount)}</td>
                    <td className="td text-right tabular-nums">{it.taxRate}</td>
                    <td className="td text-right tabular-nums">{formatCurrency(it.taxAmount)}</td>
                    <td className="td text-right tabular-nums">{formatCurrency(it.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ml-auto max-w-xs">
            <InvoiceSummary subtotal={inv.subtotal} discount={inv.discount} taxable={inv.taxableAmount} cgst={inv.taxBreakdown?.cgst} sgst={inv.taxBreakdown?.sgst} igst={inv.taxBreakdown?.igst} totalTax={inv.taxBreakdown?.totalTax} grandTotal={inv.grandTotal} supplyType={inv.supplyType} />
          </div>

          {data.alerts?.length > 0 && (
            <Alert tone="warning" title={`${data.alerts.length} fraud-risk alert(s) on this invoice`}>
              <ul className="mt-1 space-y-1">
                {data.alerts.map((a) => (
                  <li key={a._id} className="flex flex-wrap items-center gap-2"><StatusBadge status={a.severity} /><span className="font-medium">{a.alertId}</span><span className="text-slate-700">{a.description}</span><StatusBadge status={a.reviewStatus} /></li>
                ))}
              </ul>
              <p className="mt-1 text-xs">Alerts are indicators for human review, not findings of wrongdoing.</p>
            </Alert>
          )}

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">Payments (manual entries, not bank-verified)</h3>
            {data.payments?.length ? (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {data.payments.map((p) => (
                  <li key={p._id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span><StatusBadge status={p.kind} /> <span className="ml-1 text-slate-600">{p.method}{p.transactionReference ? ` · ${p.transactionReference}` : ''}</span></span>
                    <span className="tabular-nums">{p.kind === 'refund' ? '−' : ''}{formatCurrency(p.amount)} <span className="text-xs text-slate-500">on {formatDateTime(p.paymentDate)}</span></span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-slate-500">No payments recorded.</p>}
          </div>

          {cancelling && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <Field label="Reason for cancellation" required><textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <div className="mt-2 flex gap-2">
                <button type="button" className="btn-danger" disabled={!reason.trim() || busy} onClick={cancelInvoice}>Confirm cancellation</button>
                <button type="button" className="btn-secondary" onClick={() => setCancelling(false)}>Keep invoice</button>
              </div>
            </div>
          )}
          {inv.status === 'Cancelled' && <Alert tone="info">Cancelled: {inv.cancelReason}</Alert>}
        </div>
      )}
    </Modal>
  );
}
