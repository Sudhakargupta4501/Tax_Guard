import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, Eye, Pencil, Plus } from 'lucide-react';
import { api, applyServerErrors } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useDebounce } from '../hooks/useDebounce';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/common/Toast';
import { Alert, Card, ConfirmDialog, DataTable, ErrorState, Field, Modal, PageHeader, Pagination, SearchBar, Spinner, StatCard, StatusBadge, SubmitButton, Badge } from '../components/common/ui';
import { customerSchema } from '../schemas';
import { GST_STATES, formatCurrency, formatDate, stateName } from '../utils/format';

const EMPTY = { name: '', email: '', phone: '', line1: '', city: '', pincode: '', stateCode: '', gstin: '' };

function CustomerForm({ customer, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(customer);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(customerSchema),
    defaultValues: customer ? { name: customer.name, email: customer.email || '', phone: customer.phone || '', line1: customer.address?.line1 || '', city: customer.address?.city || '', pincode: customer.address?.pincode || '', stateCode: customer.stateCode, gstin: customer.gstin || '' } : EMPTY,
  });
  const onSubmit = async (v) => {
    const body = { name: v.name, email: v.email, phone: v.phone, stateCode: v.stateCode, gstin: v.gstin, address: { line1: v.line1, city: v.city, state: stateName(v.stateCode), pincode: v.pincode } };
    try {
      const res = editing ? await api.put(`/customers/${customer._id}`, body) : await api.post('/customers', body);
      toast.success(res.message);
      onSaved();
      onClose();
    } catch (e) {
      if (!applyServerErrors(e, setError)) {
        if (e.status === 409) setError('email', { type: 'server', message: e.message }); else toast.error(e.message);
      }
    }
  };
  return (
    <Modal open onClose={onClose} title={editing ? 'Edit customer' : 'Add customer'}
      footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><SubmitButton form="customer-form" busy={isSubmitting}>{editing ? 'Save changes' : 'Add customer'}</SubmitButton></>}>
      <form id="customer-form" onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={errors.name} required className="sm:col-span-2"><input className="input" {...register('name')} /></Field>
        <Field label="Email" error={errors.email}><input type="email" className="input" {...register('email')} /></Field>
        <Field label="Phone" error={errors.phone}><input className="input" {...register('phone')} /></Field>
        <Field label="Billing address" error={errors.line1} className="sm:col-span-2"><input className="input" placeholder="Street / building" {...register('line1')} /></Field>
        <Field label="City" error={errors.city}><input className="input" {...register('city')} /></Field>
        <Field label="Pincode" error={errors.pincode}><input inputMode="numeric" maxLength={6} className="input" {...register('pincode')} /></Field>
        <Field label="State (place of supply)" error={errors.stateCode} required>
          <select className="input" {...register('stateCode')}><option value="">Select state…</option>{GST_STATES.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}</select>
        </Field>
        <Field label="GSTIN (if registered)" error={errors.gstin} hint="15 characters; first two digits must match the state."><input className="input uppercase" maxLength={15} {...register('gstin')} /></Field>
      </form>
    </Modal>
  );
}

function CustomerDetail({ id, onClose }) {
  const { data, loading, error, reload } = useApi(() => api.get(`/customers/${id}`), [id]);
  const c = data?.customer;
  const b = data?.billing;
  return (
    <Modal open onClose={onClose} size="lg" title={c ? c.name : 'Customer'}>
      {loading && !data && <Spinner />}
      <ErrorState error={error} onRetry={reload} />
      {c && (
        <div className="space-y-4">
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <dt className="text-slate-500">Email</dt><dd>{c.email || '-'}</dd>
            <dt className="text-slate-500">Phone</dt><dd>{c.phone || '-'}</dd>
            <dt className="text-slate-500">Address</dt><dd>{[c.address?.line1, c.address?.city, c.address?.state, c.address?.pincode].filter(Boolean).join(', ') || '-'}</dd>
            <dt className="text-slate-500">State</dt><dd>{c.stateCode} · {stateName(c.stateCode)}</dd>
            <dt className="text-slate-500">GSTIN</dt><dd>{c.gstin || 'Not provided'}</dd>
          </dl>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Invoiced" value={formatCurrency(b.totalInvoiced)} hint={`${b.invoiceCount} invoices`} />
            <StatCard label="Paid" value={formatCurrency(b.totalPaid)} tone="green" />
            <StatCard label="Outstanding" value={formatCurrency(b.outstanding)} tone="amber" />
          </div>
          <h3 className="text-xs font-semibold uppercase text-slate-500">Billing history</h3>
          <div className="rounded-lg border border-slate-200">
            <DataTable rows={b.invoices} emptyTitle="No invoices for this customer" columns={[
              { key: 'n', header: 'Invoice', render: (r) => <span className="font-medium">{r.invoiceNumber}</span> },
              { key: 'd', header: 'Date', render: (r) => formatDate(r.invoiceDate) },
              { key: 't', header: 'Total', align: 'right', render: (r) => formatCurrency(r.grandTotal) },
              { key: 'o', header: 'Outstanding', align: 'right', render: (r) => formatCurrency(r.outstanding) },
              { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status === 'Cancelled' ? 'Cancelled' : r.paymentStatus} /> },
            ]} />
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Customers() {
  const { can } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const q = useDebounce(search);
  useEffect(() => setPage(1), [q, archived]);
  const { data, pagination, loading, error, reload } = useApi(() => api.get('/customers', { search: q, page, limit: 10, includeArchived: archived ? 'true' : undefined }), [q, page, archived]);
  const [form, setForm] = useState(null); // null | 'new' | customer
  const [viewId, setViewId] = useState(null);
  const [toRemove, setToRemove] = useState(null);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try { const res = await api.delete(`/customers/${toRemove._id}`); toast.success(res.message); setToRemove(null); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Customers" subtitle="Manage customers, their GST details and billing history."
        actions={can('customer:write') && <button type="button" className="btn-primary" onClick={() => setForm('new')}><Plus className="h-4 w-4" />Add customer</button>} />
      <Card bodyClassName="p-0" title={<SearchBar value={search} onChange={setSearch} placeholder="Search name, email, phone or GSTIN">
        <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />Show archived</label></SearchBar>}>
        <DataTable rows={data} loading={loading} error={error} onRetry={reload} emptyTitle="No customers found" emptyText={q ? 'Try a different search.' : 'Add your first customer to start invoicing.'} columns={[
          { key: 'name', header: 'Name', render: (r) => <div><p className="font-medium text-slate-900">{r.name} {r.isArchived && <Badge>Archived</Badge>}</p><p className="text-xs text-slate-500">{r.email || 'No email'}</p></div> },
          { key: 'phone', header: 'Phone' },
          { key: 'state', header: 'State', render: (r) => stateName(r.stateCode) },
          { key: 'gstin', header: 'GSTIN', render: (r) => r.gstin || <span className="text-slate-400">—</span> },
          { key: 'created', header: 'Added', render: (r) => formatDate(r.createdAt) },
          { key: 'act', header: <span className="sr-only">Actions</span>, render: (r) => (
            <div className="flex justify-end gap-1">
              <button type="button" className="btn-ghost px-2 py-1" aria-label={`View ${r.name}`} onClick={() => setViewId(r._id)}><Eye className="h-4 w-4" /></button>
              {can('customer:write') && !r.isArchived && <button type="button" className="btn-ghost px-2 py-1" aria-label={`Edit ${r.name}`} onClick={() => setForm(r)}><Pencil className="h-4 w-4" /></button>}
              {can('customer:delete') && !r.isArchived && <button type="button" className="btn-ghost px-2 py-1 text-red-600" aria-label={`Archive or delete ${r.name}`} onClick={() => setToRemove(r)}><Archive className="h-4 w-4" /></button>}
            </div>) },
        ]} />
        <Pagination pagination={pagination} onPage={setPage} />
      </Card>
      {form && <CustomerForm customer={form === 'new' ? null : form} onClose={() => setForm(null)} onSaved={reload} />}
      {viewId && <CustomerDetail id={viewId} onClose={() => setViewId(null)} />}
      <ConfirmDialog open={Boolean(toRemove)} danger busy={busy} title="Archive or delete customer" confirmLabel="Continue" onCancel={() => setToRemove(null)} onConfirm={remove}
        message={`Remove ${toRemove?.name}? Customers that already have invoices are archived (their history is kept); customers with no invoices are deleted.`} />
    </>
  );
}
