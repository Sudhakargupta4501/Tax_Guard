import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { api, applyServerErrors } from '../../services/api';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../common/Toast';
import { Alert, ErrorState, Field, Modal, Spinner, StatusBadge, SubmitButton } from '../common/ui';
import { reviewSchema } from '../../schemas';
import { formatCurrency, formatDateTime } from '../../utils/format';

const NEXT = {
  New: ['New', 'Under Review', 'Resolved', 'False Positive'],
  'Under Review': ['Under Review', 'New', 'Resolved', 'False Positive'],
  Resolved: ['Resolved', 'Under Review'],
  'False Positive': ['False Positive', 'Under Review'],
};

export default function AlertDetailModal({ alertId, onClose, onChanged }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useApi(() => api.get(`/fraud-alerts/${alertId}`), [alertId], { enabled: Boolean(alertId) });
  const alert = data?.alert;
  const [saving, setSaving] = useState(false);
  const canReview = can('fraud:review');

  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm({
    resolver: zodResolver(reviewSchema),
    defaultValues: { reviewStatus: 'New', comment: '', resolutionNotes: '' },
  });
  useEffect(() => { if (alert) reset({ reviewStatus: alert.reviewStatus, comment: '', resolutionNotes: alert.resolutionNotes || '' }); }, [alert, reset]);

  const onSubmit = async (values) => {
    setSaving(true);
    try {
      const payload = { comment: values.comment, resolutionNotes: values.resolutionNotes };
      if (values.reviewStatus !== alert.reviewStatus) payload.reviewStatus = values.reviewStatus;
      const body = await api.patch(`/fraud-alerts/${alertId}/review`, payload);
      toast.success(body.message || 'Alert updated'); // shown only after the server confirms
      await reload();
      onChanged?.();
    } catch (e) {
      if (!applyServerErrors(e, setError)) toast.error(e.message);
    } finally { setSaving(false); }
  };

  return (
    <Modal open={Boolean(alertId)} onClose={onClose} size="lg" title={alert ? `${alert.alertId} · ${data.categoryLabel}` : 'Alert details'}>
      {loading && !data && <Spinner />}
      <ErrorState error={error} onRetry={reload} />
      {alert && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={alert.severity} />
            <span className="font-semibold tabular-nums" title="Risk score (0-100). An indicator for review, not a probability of fraud.">Risk score {alert.riskScore}/100</span>
            <StatusBadge status={alert.reviewStatus} />
            <span className="text-xs text-slate-500">{alert.detectionMethod} · {alert.detectionVersion} · detected {formatDateTime(alert.detectedAt)}</span>
          </div>
          <Alert tone="info" title="Why was this flagged?">{alert.description}</Alert>

          <section aria-label="Triggered rules">
            <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">Triggered rules</h3>
            <ul className="space-y-2">
              {alert.triggeredRules?.map((r) => (
                <li key={r.ruleId} className="rounded-lg border border-slate-200 p-3">
                  <p className="font-medium text-slate-900">{r.name} <span className="text-xs font-normal text-slate-500">({r.ruleId}, weight {r.weight})</span></p>
                  <p className="text-slate-600">{r.detail}</p>
                  {r.evidence && <details className="mt-1"><summary className="cursor-pointer text-xs text-brand-700">Evidence</summary><pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(r.evidence, null, 2)}</pre></details>}
                </li>
              ))}
            </ul>
            {alert.corroboratingCategories?.length > 0 && <p className="mt-2 text-xs text-slate-500">Other categories on the same record (raise the score once, not per issue): {alert.corroboratingCategories.join(', ')}</p>}
          </section>

          {data.invoice && (
            <section aria-label="Related invoice" className="rounded-lg bg-slate-50 p-3">
              <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Related invoice</h3>
              <p><span className="font-medium">{data.invoice.invoiceNumber}</span> · {data.invoice.customerSnapshot?.name} · total {formatCurrency(data.invoice.grandTotal)} · tax {formatCurrency(data.invoice.taxBreakdown?.totalTax)} · {data.invoice.paymentStatus}</p>
            </section>
          )}

          <section aria-label="History">
            <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">History & comments</h3>
            <ol className="space-y-2 border-l-2 border-slate-200 pl-4">
              {alert.history?.map((h, i) => (
                <li key={i} className="text-sm"><span className="font-medium">{h.userName || 'System'}</span> {h.from ? <>changed status <StatusBadge status={h.from} /> → <StatusBadge status={h.to} /></> : <>created the alert</>}<span className="ml-2 text-xs text-slate-500">{formatDateTime(h.at)}</span>{h.note && <p className="text-slate-600">“{h.note}”</p>}</li>
              ))}
              {alert.reviewComments?.map((c, i) => (
                <li key={`c${i}`} className="text-sm"><span className="font-medium">{c.userName}</span> commented<span className="ml-2 text-xs text-slate-500">{formatDateTime(c.at)}</span><p className="text-slate-600">“{c.comment}”</p></li>
              ))}
            </ol>
            {alert.resolutionNotes && <p className="mt-2 text-sm"><span className="font-medium">Resolution notes:</span> {alert.resolutionNotes}</p>}
          </section>

          {canReview ? (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 rounded-lg border border-slate-200 p-4" noValidate aria-label="Review alert">
              <h3 className="text-sm font-semibold text-slate-900">Review this alert</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Review status" error={errors.reviewStatus}>
                  <select className="input" {...register('reviewStatus')}>{NEXT[alert.reviewStatus].map((s) => <option key={s}>{s}</option>)}</select>
                </Field>
                <Field label="Assigned reviewer"><input className="input" disabled value={alert.assignedReviewer?.name || 'Assigned on first review'} readOnly /></Field>
              </div>
              <Field label="Comment" error={errors.comment}><textarea className="input" rows={2} {...register('comment')} /></Field>
              <Field label="Resolution notes" hint="Required when resolving or marking a false positive." error={errors.resolutionNotes}><textarea className="input" rows={2} {...register('resolutionNotes')} /></Field>
              <SubmitButton busy={saving}>Save review</SubmitButton>
            </form>
          ) : <Alert tone="info">You can view this alert but your role cannot change its status.</Alert>}
        </div>
      )}
    </Modal>
  );
}
