import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api, applyServerErrors } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/common/Toast';
import { Alert, Badge, Card, DataTable, ErrorState, Field, Modal, PageHeader, Pagination, Spinner, StatusBadge, SubmitButton } from '../components/common/ui';
import { businessSchema, profileSchema, taxConfigSchema } from '../schemas';
import { GST_STATES, ROLE_LABELS, formatDate, formatDateTime, toInputDate } from '../utils/format';

function ProfileTab() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(profileSchema), defaultValues: { name: user.name, currentPassword: '', newPassword: '' } });
  const onSubmit = async (v) => {
    try {
      const body = await api.patch('/auth/me', v);
      toast.success(body.message);
      await refreshUser();
      reset({ name: body.data.name, currentPassword: '', newPassword: '' });
    } catch (e) {
      if (e.message === 'Current password is incorrect') setError('currentPassword', { type: 'server', message: e.message });
      else if (!applyServerErrors(e, setError)) toast.error(e.message);
    }
  };
  return (
    <Card title="Your profile">
      <dl className="mb-5 grid gap-1 sm:grid-cols-2"><dt className="text-slate-500">Email</dt><dd>{user.email}</dd><dt className="text-slate-500">Role</dt><dd>{ROLE_LABELS[user.role]}</dd><dt className="text-slate-500">Member since</dt><dd>{formatDate(user.createdAt)}</dd></dl>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid max-w-xl gap-4">
        <Field label="Name" error={errors.name} required><input className="input" {...register('name')} /></Field>
        <Field label="Current password" error={errors.currentPassword} hint="Only needed to change your password."><input type="password" autoComplete="current-password" className="input" {...register('currentPassword')} /></Field>
        <Field label="New password" error={errors.newPassword}><input type="password" autoComplete="new-password" className="input" {...register('newPassword')} /></Field>
        <div><SubmitButton busy={isSubmitting}>Save profile</SubmitButton></div>
      </form>
    </Card>
  );
}

function BusinessTab() {
  const { can } = useAuth();
  const toast = useToast();
  const editable = can('settings:write');
  const { data, loading, error, reload } = useApi(() => api.get('/settings/business'), []);
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(businessSchema) });
  useEffect(() => { if (data) reset({ name: data.name, gstin: data.gstin || '', stateCode: data.stateCode, address: data.address || '', email: data.email || '', phone: data.phone || '' }); }, [data, reset]);
  const onSubmit = async (v) => {
    try { const body = await api.put('/settings/business', v); toast.success(body.message); reload(); } catch (e) { if (!applyServerErrors(e, setError)) toast.error(e.message); }
  };
  return (
    <Card title="Business profile">
      {loading && !data && <Spinner />}<ErrorState error={error} onRetry={reload} />
      {data && (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid max-w-2xl gap-4 sm:grid-cols-2">
          {!editable && <Alert tone="info" className="sm:col-span-2">Only administrators can change the business profile. It appears on invoices and decides intra- vs inter-state GST.</Alert>}
          <Field label="Business name" error={errors.name} required className="sm:col-span-2"><input className="input" disabled={!editable} {...register('name')} /></Field>
          <Field label="State code (supplier)" error={errors.stateCode} required><select className="input" disabled={!editable} {...register('stateCode')}>{GST_STATES.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}</select></Field>
          <Field label="GSTIN" error={errors.gstin}><input className="input uppercase" maxLength={15} disabled={!editable} {...register('gstin')} /></Field>
          <Field label="Address" error={errors.address} className="sm:col-span-2"><input className="input" disabled={!editable} {...register('address')} /></Field>
          <Field label="Email" error={errors.email}><input type="email" className="input" disabled={!editable} {...register('email')} /></Field>
          <Field label="Phone" error={errors.phone}><input className="input" disabled={!editable} {...register('phone')} /></Field>
          {editable && <div><SubmitButton busy={isSubmitting}>Save business profile</SubmitButton></div>}
        </form>
      )}
    </Card>
  );
}

function TaxForm({ cfg, onClose, onSaved }) {
  const toast = useToast();
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(taxConfigSchema),
    defaultValues: cfg ? { name: cfg.name, category: cfg.category, rate: cfg.rate, effectiveDate: toInputDate(cfg.effectiveDate), isActive: cfg.isActive } : { name: '', category: '', rate: '', effectiveDate: toInputDate(new Date()), isActive: true },
  });
  const onSubmit = async (v) => {
    try {
      const body = cfg ? await api.put(`/tax-config/${cfg._id}`, v) : await api.post('/tax-config', v);
      toast.success(body.message); onSaved(); onClose();
    } catch (e) { if (!applyServerErrors(e, setError)) toast.error(e.message); }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={cfg ? 'Edit tax rate' : 'Add tax rate'}
      footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><SubmitButton form="tax-form" busy={isSubmitting}>Save</SubmitButton></>}>
      <form id="tax-form" onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4">
        <Field label="Name" error={errors.name} required><input className="input" {...register('name')} /></Field>
        <Field label="Category key" error={errors.category} required hint="Products reference this, e.g. GST-18."><input className="input" {...register('category')} /></Field>
        <Field label="Total GST rate (%)" error={errors.rate} required><input type="number" step="0.01" min="0" max="100" className="input" {...register('rate')} /></Field>
        <Field label="Effective from" error={errors.effectiveDate}><input type="date" className="input" {...register('effectiveDate')} /></Field>
        <label className="flex items-center gap-2"><input type="checkbox" {...register('isActive')} />Active</label>
      </form>
    </Modal>
  );
}

function TaxTab() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useApi(() => api.get('/tax-config'), []);
  const [form, setForm] = useState(null);
  const editable = can('taxconfig:write');
  return (
    <Card title="Tax configuration" bodyClassName="p-0" actions={editable && <button type="button" className="btn-primary" onClick={() => setForm('new')}>Add tax rate</button>}>
      <Alert tone="warning" className="m-4">Rates here are illustrative defaults for a student project. Verify against current official GST notifications; changes apply to new invoices only and are audit-logged.</Alert>
      <DataTable rows={data} loading={loading} error={error} onRetry={reload} emptyTitle="No tax rates configured" columns={[
        { key: 'name', header: 'Name' }, { key: 'category', header: 'Category', render: (r) => <Badge tone="blue">{r.category}</Badge> },
        { key: 'rate', header: 'Rate', align: 'right', render: (r) => `${r.rate}%` }, { key: 'eff', header: 'Effective', render: (r) => formatDate(r.effectiveDate) },
        { key: 'act', header: 'Status', render: (r) => <StatusBadge status={r.isActive ? 'active' : 'disabled'} /> },
        { key: 'e', header: '', render: (r) => editable && <button type="button" className="btn-ghost px-2 py-1" onClick={() => setForm(r)}>Edit</button> },
      ]} />
      {form && <TaxForm cfg={form === 'new' ? null : form} onClose={() => setForm(null)} onSaved={reload} />}
    </Card>
  );
}

const THRESHOLD_LABELS = {
  amountToleranceRupees: ['Arithmetic tolerance (₹)', 'Allowed difference when recomputing totals/tax'],
  duplicateWindowDays: ['Duplicate window (days)', 'Look-back for identical invoices'],
  unusualAmountZScore: ['Unusual amount z-score', 'Robust (median/MAD) cut-off'],
  unusualAmountMinHistory: ['Min. invoices for amount check', 'No judgement below this history'],
  invoicesPerCustomerPerDay: ['Invoices per customer per day', 'Frequency burst threshold'],
  refundCountThreshold: ['Refund count threshold', 'Refunds per customer in window'],
  refundWindowDays: ['Refund window (days)', ''],
  gstinRequiredAboveRupees: ['GSTIN expected above (₹)', 'Missing-info rule'],
  reconciliationTolerancePct: ['Reconciliation tolerance (%)', 'Monthly recorded vs supplied'],
  underReportingThresholdPct: ['Under-reporting indicator (%)', 'Recorded below supplied by more than this'],
  mediumSeverityFrom: ['Medium severity from score', ''],
  highSeverityFrom: ['High severity from score', ''],
};

function ThresholdsTab() {
  const { can } = useAuth();
  const toast = useToast();
  const editable = can('settings:write');
  const { data, loading, error, reload } = useApi(() => api.get('/settings/fraud-thresholds'), []);
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm();
  const [serverError, setServerError] = useState('');
  useEffect(() => { if (data) reset(Object.fromEntries(Object.keys(THRESHOLD_LABELS).map((k) => [k, data[k]]))); }, [data, reset]);
  const onSubmit = async (v) => {
    setServerError('');
    try { const body = await api.put('/settings/fraud-thresholds', v); toast.success(body.message); reload(); } catch (e) { setServerError(e.errors?.map((x) => x.message).join('; ') || e.message); }
  };
  return (
    <Card title="Fraud-detection thresholds">
      <Alert tone="warning" className="mb-4">Thresholds are illustrative and untested on representative data. Changing them affects future analyses; re-run analysis to apply them to existing records.</Alert>
      {loading && !data && <Spinner />}<ErrorState error={error} onRetry={reload} />
      {data && (
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" noValidate>
          {serverError && <Alert tone="error" className="sm:col-span-2 lg:col-span-3">{serverError}</Alert>}
          {Object.entries(THRESHOLD_LABELS).map(([k, [label, hint]]) => (
            <Field key={k} label={label} hint={hint}><input type="number" step="any" className="input" disabled={!editable} {...register(k)} /></Field>
          ))}
          {editable && <div className="sm:col-span-2 lg:col-span-3"><SubmitButton busy={isSubmitting}>Save thresholds</SubmitButton></div>}
        </form>
      )}
    </Card>
  );
}

function UsersTab() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const { data, pagination, loading, error, reload } = useApi(() => api.get('/users', { page, limit: 10 }), [page]);
  const update = async (u, patch) => {
    try { const body = await api.patch(`/users/${u._id}`, patch); toast.success(body.message); reload(); } catch (e) { toast.error(e.message); }
  };
  return (
    <Card title="Users and roles" bodyClassName="p-0">
      <DataTable rows={data} loading={loading} error={error} onRetry={reload} columns={[
        { key: 'name', header: 'User', render: (r) => <div><p className="font-medium">{r.name}{r._id === me._id && <span className="ml-1 text-xs text-slate-400">(you)</span>}</p><p className="text-xs text-slate-500">{r.email}</p></div> },
        { key: 'role', header: 'Role', render: (r) => <select className="input w-44" aria-label={`Role for ${r.name}`} value={r.role} onChange={(e) => update(r, { role: e.target.value })}>{Object.entries(ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select> },
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.accountStatus} /> },
        { key: 'last', header: 'Last sign-in', render: (r) => formatDateTime(r.lastLoginAt) },
        { key: 'act', header: '', render: (r) => <button type="button" className="btn-ghost px-2 py-1" onClick={() => update(r, { accountStatus: r.accountStatus === 'active' ? 'disabled' : 'active' })}>{r.accountStatus === 'active' ? 'Disable' : 'Enable'}</button> },
      ]} />
      <Pagination pagination={pagination} onPage={setPage} />
    </Card>
  );
}

function AboutTab() {
  return (
    <Card title="About and assumptions">
      <ul className="list-disc space-y-1.5 pl-5 text-slate-700">
        <li>TaxGuard AI is an <strong>educational</strong> billing and fraud-risk system. It does not replace professional tax advice or official tax authority decisions.</li>
        <li>GST is simplified: one total rate per category split into CGST+SGST (intra-state) or IGST (inter-state). No cess, reverse charge, composition scheme, exports/SEZ, TDS/TCS or e-invoicing (IRN).</li>
        <li>Money is calculated in integer paise with half-up rounding on the server.</li>
        <li>Payments are manual entries and are not verified against any bank.</li>
        <li>Fraud alerts are explainable indicators for human review. Scores are not probabilities and thresholds are illustrative.</li>
        <li>The optional ML service is an unsupervised Isolation Forest indicator; no accuracy metrics are claimed.</li>
      </ul>
    </Card>
  );
}

export default function Settings() {
  const { can } = useAuth();
  const tabs = [['profile', 'Profile', ProfileTab], ['business', 'Business', BusinessTab], ['tax', 'Tax configuration', TaxTab], ['fraud', 'Fraud thresholds', ThresholdsTab], ...(can('user:manage') ? [['users', 'Users & roles', UsersTab]] : []), ['about', 'About', AboutTab]];
  const [active, setActive] = useState('profile');
  const Active = tabs.find(([k]) => k === active)[2];
  return (
    <>
      <PageHeader title="Settings" subtitle="Profile, business details, tax rates, fraud thresholds and user roles." />
      <div role="tablist" aria-label="Settings sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" type="button" aria-selected={active === k} onClick={() => setActive(k)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${active === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{label}</button>
        ))}
      </div>
      <div role="tabpanel"><Active /></div>
    </>
  );
}
