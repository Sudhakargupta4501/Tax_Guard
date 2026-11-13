import { useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Download, FilePlus2, Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, applyServerErrors } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useToast } from '../components/common/Toast';
import { Alert, Card, ErrorState, Field, PageHeader, Spinner, SubmitButton } from '../components/common/ui';
import InvoiceSummary from '../components/invoices/InvoiceSummary';
import { invoiceSchema } from '../schemas';
import { calcInvoice } from '../utils/invoiceCalc';
import { formatCurrency, toInputDate } from '../utils/format';

const today = () => toInputDate(new Date());
const inDays = (n) => toInputDate(new Date(Date.now() + n * 86400000));

export default function CreateInvoice() {
  const toast = useToast();
  const customers = useApi(() => api.get('/customers', { limit: 100 }), []);
  const products = useApi(() => api.get('/products', { limit: 100 }), []);
  const business = useApi(() => api.get('/settings/business'), []);
  const [created, setCreated] = useState(null);
  const [serverError, setServerError] = useState('');

  const { register, control, handleSubmit, watch, reset, setError, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(invoiceSchema),
    defaultValues: { customerId: '', invoiceDate: today(), dueDate: inDays(30), notes: '', items: [{ productId: '', quantity: 1, discountPercent: 0 }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  const values = watch();
  const customer = customers.data?.find((c) => c._id === values.customerId);
  const productById = useMemo(() => new Map((products.data || []).map((p) => [p._id, p])), [products.data]);
  console.log('Products API data:', products.data);
  console.log('Selected item:', values.items);

  const intra = customer && business.data ? customer.stateCode === business.data.stateCode : true;
  const preview = useMemo(() => {
    const lines = (values.items || []).map((it) => {
      const p = productById.get(it.productId);
      return { quantity: it.quantity, unitPrice: p?.unitPrice || 0, discountPercent: it.discountPercent, taxRate: p?.taxRate || 0 };
    });
    return calcInvoice(lines, intra);
  }, [values.items, productById, intra]);

  const onSubmit = async (v) => {
    setServerError('');
    try {
      // Only identifiers and quantities are sent; the server recalculates prices, taxes and totals.
      const body = await api.post('/invoices', { customerId: v.customerId, invoiceDate: v.invoiceDate, dueDate: v.dueDate, notes: v.notes, items: v.items });
      toast.success(body.message);
      setCreated(body.data);
      reset({ customerId: '', invoiceDate: today(), dueDate: inDays(30), notes: '', items: [{ productId: '', quantity: 1, discountPercent: 0 }] });
    } catch (e) {
      if (!applyServerErrors(e, setError)) setServerError(e.message);
    }
  };

  const loading = (customers.loading && !customers.data) || (products.loading && !products.data);
  const loadError = customers.error || products.error || business.error;

  return (
    <>
      <PageHeader title="Create invoice" subtitle="Totals shown here are a live preview. The server recalculates every amount and tax from the product and tax configuration when you save." />
      {loading && <Spinner />}
      <ErrorState error={loadError} onRetry={() => { customers.reload(); products.reload(); business.reload(); }} />

      {created && (
        <Alert tone="success" title={`Invoice ${created.invoiceNumber} created`} className="mb-4">
          Grand total {formatCurrency(created.grandTotal)}.{' '}
          <button type="button" className="font-medium underline" onClick={() => api.download(`/invoices/${created._id}/pdf`, `${created.invoiceNumber}.pdf`).catch((e) => toast.error(e.message))}>
            <Download className="mr-1 inline h-3.5 w-3.5" />Download PDF
          </button>{' · '}<Link className="font-medium underline" to="/invoices">View invoice history</Link>
        </Alert>
      )}
      {!loading && !loadError && !(products.data || []).length && <Alert tone="warning" className="mb-4" title="No products yet">Add at least one product before creating an invoice. <Link className="underline" to="/products">Go to Products</Link></Alert>}

      {!loading && !loadError && (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-6 lg:grid-cols-3" aria-label="Create invoice">
          <div className="space-y-6 lg:col-span-2">
            {serverError && <Alert tone="error">{serverError}</Alert>}
            <Card title="Invoice details">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Customer" error={errors.customerId} required className="sm:col-span-3">
                  <select className="input" {...register('customerId')}>
                    <option value="">Select customer…</option>
                    {(customers.data || []).map((c) => <option key={c._id} value={c._id}>{c.name}{c.gstin ? ` · ${c.gstin}` : ''}</option>)}
                  </select>
                </Field>
                <Field label="Invoice date" error={errors.invoiceDate} required><input type="date" max={today()} className="input" {...register('invoiceDate')} /></Field>
                <Field label="Due date" error={errors.dueDate} required><input type="date" className="input" {...register('dueDate')} /></Field>
                <Field label="Notes" error={errors.notes}><input className="input" {...register('notes')} /></Field>
              </div>
              {customer && <p className="mt-3 text-xs text-slate-500">Supply type: <strong>{intra ? 'Intra-state (CGST + SGST)' : 'Inter-state (IGST)'}</strong> · Customer state {customer.stateCode}{business.data ? ` vs business state ${business.data.stateCode}` : ''}{!customer.gstin ? ' · No customer GSTIN on file' : ''}</p>}
            </Card>

            <Card title="Items" actions={<button type="button" className="btn-secondary" onClick={() => append({ productId: '', quantity: 1, discountPercent: 0 })}><Plus className="h-4 w-4" />Add item</button>}>
              {errors.items?.message && <p role="alert" className="mb-2 text-xs text-red-600">{errors.items.message}</p>}
              <ul className="space-y-4">
                {fields.map((f, i) => {
                  const p = productById.get(values.items?.[i]?.productId);
                  const line = preview.lines[i];
                  return (
                    <li key={f.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="grid gap-3 sm:grid-cols-12">
                        <Field label={`Product / service ${i + 1}`} error={errors.items?.[i]?.productId} required className="sm:col-span-6">
                          <select className="input" {...register(`items.${i}.productId`)}>
                            <option value="">Select…</option>
                            {(products.data || []).map((pr) => <option key={pr._id} value={pr._id}>{pr.name} — {formatCurrency(pr.unitPrice)} (+{pr.taxRate}% GST)</option>)}
                          </select>
                        </Field>
                        <Field label="Qty" error={errors.items?.[i]?.quantity} required className="sm:col-span-2"><input type="number" step="any" min="0" className="input" {...register(`items.${i}.quantity`)} /></Field>
                        <Field label="Discount %" error={errors.items?.[i]?.discountPercent} className="sm:col-span-2"><input type="number" step="any" min="0" max="100" className="input" {...register(`items.${i}.discountPercent`)} /></Field>
                        <div className="flex items-end sm:col-span-2">
                          <button type="button" className="btn-ghost w-full text-red-600" onClick={() => remove(i)} disabled={fields.length === 1} aria-label={`Remove item ${i + 1}`}><Trash2 className="h-4 w-4" />Remove</button>
                        </div>
                      </div>
                      {p && line && <p className="mt-2 text-xs text-slate-500">Taxable {formatCurrency(line.taxable)} · GST {p.taxRate}% = {formatCurrency(line.tax)} · Line total <strong className="text-slate-800">{formatCurrency(line.total)}</strong>{p.trackInventory && Number(values.items[i].quantity) > p.inventoryQuantity ? <span className="ml-2 text-red-600">Only {p.inventoryQuantity} in stock</span> : null}</p>}
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>

          <div>
            <Card title="Summary (preview)" className="lg:sticky lg:top-6">
              <InvoiceSummary subtotal={preview.subtotal} discount={preview.discount} taxable={preview.taxable} cgst={preview.cgst} sgst={preview.sgst} igst={preview.igst} totalTax={preview.totalTax} grandTotal={preview.grandTotal} supplyType={intra ? 'intra' : 'inter'} />
              <p className="mt-3 text-xs text-slate-500">GST is simplified for this academic project: one rate per product category, no cess, reverse charge or e-invoicing.</p>
              <SubmitButton busy={isSubmitting}><FilePlus2 className="h-4 w-4" />{isSubmitting ? 'Saving…' : 'Save invoice'}</SubmitButton>
            </Card>
          </div>
        </form>
      )}
    </>
  );
}
