import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api, applyServerErrors } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/common/Toast';
import { Alert, Card, DataTable, Field, Modal, PageHeader, Pagination, StatusBadge, SubmitButton } from '../components/common/ui';
import { paymentSchema } from '../schemas';
import { formatCurrency, formatDate, toInputDate } from '../utils/format';

function PaymentForm({ presetInvoice, onClose, onSaved }) {
  const toast = useToast();
  const invoices = useApi(() => api.get('/invoices', { status: 'Issued', limit: 100 }), []);
  const open = useMemo(() => (invoices.data || []).filter((i) => i.outstanding > 0 || i.amountPaid > 0), [invoices.data]);
  const { register, handleSubmit, watch, setError, setValue, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(paymentSchema),
    defaultValues: { invoiceId: presetInvoice || '', kind: 'payment', amount: '', method: 'UPI', paymentDate: toInputDate(new Date()), transactionReference: '', notes: '' },
  });
  const { invoiceId, kind } = watch();
  const inv = open.find((i) => i._id === invoiceId);
  const limit = inv ? (kind === 'refund' ? inv.amountPaid : inv.outstanding) : null;

  useEffect(() => { if (inv && kind === 'payment') setValue('amount', inv.outstanding); }, [inv, kind, setValue]);

  const onSubmit = async (v) => {
    if (limit !== null && Number(v.amount) > limit + 0.005) { setError('amount', { type: 'manual', message: `Cannot exceed ${formatCurrency(limit)}` }); return; }
    try {
      const body = await api.post('/payments', { ...v, idempotencyKey: crypto.randomUUID?.() });
      toast.success(body.message);
      onSaved();
      onClose();
    } catch (e) {
      if (!applyServerErrors(e, setError)) toast.error(e.message);
    }
  };
  return (
    <Modal open onClose={onClose} title="Record payment or refund"
      footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><SubmitButton form="payment-form" busy={isSubmitting}>Record entry</SubmitButton></>}>
      <Alert tone="warning" className="mb-4">Payments are <strong>manual entries</strong> typed in by staff. They are not verified against a bank or payment gateway, and recorded payments cannot be edited or deleted.</Alert>
      <form id="payment-form" onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Invoice" error={errors.invoiceId} required className="sm:col-span-2">
          <select className="input" {...register('invoiceId')}>
            <option value="">{invoices.loading ? 'Loading…' : 'Select invoice…'}</option>
            {open.map((i) => <option key={i._id} value={i._id}>{i.invoiceNumber} · {i.customerSnapshot?.name} · outstanding {formatCurrency(i.outstanding)}</option>)}
          </select>
        </Field>
        <Field label="Type" error={errors.kind}><select className="input" {...register('kind')}><option value="payment">Payment received</option><option value="refund">Refund issued</option></select></Field>
        <Field label="Amount (₹)" error={errors.amount} required hint={limit !== null ? `Maximum ${formatCurrency(limit)}` : undefined}><input type="number" step="0.01" min="0" className="input" {...register('amount')} /></Field>
        <Field label="Method" error={errors.method}><select className="input" {...register('method')}>{['Cash', 'Bank Transfer', 'UPI', 'Card', 'Cheque', 'Other'].map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Payment date" error={errors.paymentDate} required><input type="date" max={toInputDate(new Date())} className="input" {...register('paymentDate')} /></Field>
        <Field label="Transaction reference" error={errors.transactionReference} className="sm:col-span-2"><input className="input" {...register('transactionReference')} /></Field>
        <Field label="Notes" error={errors.notes} className="sm:col-span-2"><input className="input" {...register('notes')} /></Field>
      </form>
    </Modal>
  );
}

export default function Payments() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState('');
  const preset = params.get('invoice');
  const [showForm, setShowForm] = useState(Boolean(preset) && can('payment:write'));
  const { data, pagination, loading, error, reload } = useApi(() => api.get('/payments', { page, limit: 10, kind }), [page, kind]);
  useEffect(() => setPage(1), [kind]);

  const close = () => { setShowForm(false); if (preset) setParams({}, { replace: true }); };

  return (
    <>
      <PageHeader title="Payments" subtitle="Payment history and outstanding balances. Entries are manual and unverified."
        actions={can('payment:write') && <button type="button" className="btn-primary" onClick={() => setShowForm(true)}><Plus className="h-4 w-4" />Record payment</button>} />
      <Card bodyClassName="p-0" title={<select className="input w-44" aria-label="Filter by type" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Payments & refunds</option><option value="payment">Payments only</option><option value="refund">Refunds only</option></select>}>
        <DataTable rows={data} loading={loading} error={error} onRetry={reload} emptyTitle="No payments recorded" emptyText="Record a payment against an invoice to see it here." columns={[
          { key: 'd', header: 'Date', render: (r) => formatDate(r.paymentDate) },
          { key: 'i', header: 'Invoice', render: (r) => <span className="font-medium">{r.invoice?.invoiceNumber}</span> },
          { key: 'c', header: 'Customer', render: (r) => r.invoice?.customerSnapshot?.name },
          { key: 'k', header: 'Type', render: (r) => <StatusBadge status={r.kind} /> },
          { key: 'm', header: 'Method', render: (r) => <span>{r.method}{r.transactionReference ? <span className="block text-xs text-slate-500">{r.transactionReference}</span> : null}</span> },
          { key: 'a', header: 'Amount', align: 'right', render: (r) => <span className={r.kind === 'refund' ? 'text-amber-700' : ''}>{r.kind === 'refund' ? '−' : ''}{formatCurrency(r.amount)}</span> },
          { key: 'st', header: 'Invoice status', render: (r) => <StatusBadge status={r.invoice?.paymentStatus} /> },
          { key: 'by', header: 'Recorded by', render: (r) => r.recordedBy?.name },
        ]} />
        <Pagination pagination={pagination} onPage={setPage} />
      </Card>
      {showForm && <PaymentForm presetInvoice={preset} onClose={close} onSaved={reload} />}
    </>
  );
}
