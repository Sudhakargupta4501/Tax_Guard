import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, Pencil, Plus } from 'lucide-react';
import { api, applyServerErrors } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useDebounce } from '../hooks/useDebounce';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/common/Toast';
import { Alert, Badge, Card, ConfirmDialog, DataTable, Field, Modal, PageHeader, Pagination, SearchBar, SubmitButton } from '../components/common/ui';
import { productSchema } from '../schemas';
import { formatCurrency } from '../utils/format';

function ProductForm({ product, taxConfigs, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(product);
  const { register, handleSubmit, setError, watch, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(productSchema),
    defaultValues: product ? { ...product, description: product.description || '', hsnSac: product.hsnSac || '' } : { name: '', sku: '', description: '', hsnSac: '', unitPrice: '', taxCategory: '', trackInventory: false, inventoryQuantity: 0 },
  });
  const categories = [...new Map(taxConfigs.filter((t) => t.isActive).map((t) => [t.category, t])).values()];
  const track = watch('trackInventory');
  const onSubmit = async (v) => {
    const cfg = categories.find((c) => c.category === v.taxCategory);
    const body = { ...v, taxRate: cfg ? cfg.rate : product?.taxRate ?? 0 }; // display copy; server resolves the rate from tax configuration
    try {
      const res = editing ? await api.put(`/products/${product._id}`, body) : await api.post('/products', body);
      toast.success(res.message);
      onSaved();
      onClose();
    } catch (e) {
      if (!applyServerErrors(e, setError)) { if (e.status === 409) setError('sku', { type: 'server', message: e.message }); else toast.error(e.message); }
    }
  };
  return (
    <Modal open onClose={onClose} title={editing ? 'Edit product' : 'Add product or service'}
      footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><SubmitButton form="product-form" busy={isSubmitting}>{editing ? 'Save changes' : 'Add product'}</SubmitButton></>}>
      <form id="product-form" onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={errors.name} required className="sm:col-span-2"><input className="input" {...register('name')} /></Field>
        <Field label="SKU" error={errors.sku} required><input className="input uppercase" {...register('sku')} /></Field>
        <Field label="HSN / SAC code" error={errors.hsnSac}><input className="input" {...register('hsnSac')} /></Field>
        <Field label="Unit price (₹)" error={errors.unitPrice} required><input type="number" step="0.01" min="0" className="input" {...register('unitPrice')} /></Field>
        <Field label="Tax category" error={errors.taxCategory} required hint="Rates are configured in Settings → Tax configuration.">
          <select className="input" {...register('taxCategory')}><option value="">Select…</option>{categories.map((c) => <option key={c.category} value={c.category}>{c.name} ({c.rate}%)</option>)}</select>
        </Field>
        <Field label="Description" error={errors.description} className="sm:col-span-2"><textarea rows={2} className="input" {...register('description')} /></Field>
        <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" {...register('trackInventory')} />Track inventory for this product</label>
        {track && <Field label="Inventory quantity" error={errors.inventoryQuantity}><input type="number" min="0" className="input" {...register('inventoryQuantity')} /></Field>}
      </form>
    </Modal>
  );
}

export default function Products() {
  const { can } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounce(search);
  useEffect(() => setPage(1), [q]);
  const { data, pagination, loading, error, reload } = useApi(() => api.get('/products', { search: q, page, limit: 10 }), [q, page]);
  const { data: taxConfigs } = useApi(() => api.get('/tax-config'), []);
  const [form, setForm] = useState(null);
  const [toRemove, setToRemove] = useState(null);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try { const res = await api.delete(`/products/${toRemove._id}`); toast.success(res.message); setToRemove(null); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Products & services" subtitle="Prices, tax categories and optional inventory tracking."
        actions={can('product:write') && <button type="button" className="btn-primary" onClick={() => setForm('new')}><Plus className="h-4 w-4" />Add product</button>} />
      {taxConfigs && !taxConfigs.length && <Alert tone="warning" className="mb-4" title="No tax configuration found">An administrator must add tax categories (or run <code>npm run create-admin</code> / <code>npm run seed</code>) before products and invoices can be created.</Alert>}
      <Card bodyClassName="p-0" title={<SearchBar value={search} onChange={setSearch} placeholder="Search name or SKU" />}>
        <DataTable rows={data} loading={loading} error={error} onRetry={reload} emptyTitle="No products found" emptyText="Add a product or service to use it on invoices." columns={[
          { key: 'name', header: 'Product', render: (r) => <div><p className="font-medium text-slate-900">{r.name}</p><p className="text-xs text-slate-500">{r.sku}{r.hsnSac ? ` · HSN/SAC ${r.hsnSac}` : ''}</p></div> },
          { key: 'price', header: 'Unit price', align: 'right', render: (r) => formatCurrency(r.unitPrice) },
          { key: 'tax', header: 'Tax', render: (r) => <Badge tone="blue">{r.taxCategory} · {r.taxRate}%</Badge> },
          { key: 'inv', header: 'Inventory', align: 'right', render: (r) => (r.trackInventory ? <span className={r.inventoryQuantity < 10 ? 'font-medium text-amber-700' : ''}>{r.inventoryQuantity}</span> : <span className="text-slate-400">Not tracked</span>) },
          { key: 'act', header: <span className="sr-only">Actions</span>, render: (r) => (
            <div className="flex justify-end gap-1">
              {can('product:write') && <button type="button" className="btn-ghost px-2 py-1" aria-label={`Edit ${r.name}`} onClick={() => setForm(r)}><Pencil className="h-4 w-4" /></button>}
              {can('product:delete') && <button type="button" className="btn-ghost px-2 py-1 text-red-600" aria-label={`Archive ${r.name}`} onClick={() => setToRemove(r)}><Archive className="h-4 w-4" /></button>}
            </div>) },
        ]} />
        <Pagination pagination={pagination} onPage={setPage} />
      </Card>
      {form && <ProductForm product={form === 'new' ? null : form} taxConfigs={taxConfigs || []} onClose={() => setForm(null)} onSaved={reload} />}
      <ConfirmDialog open={Boolean(toRemove)} danger busy={busy} title="Archive product" confirmLabel="Archive" onCancel={() => setToRemove(null)} onConfirm={remove}
        message={`Archive ${toRemove?.name}? Existing invoices keep their recorded values; the product just stops appearing on new invoices.`} />
    </>
  );
}
