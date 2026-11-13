import { useState } from 'react';
import { api } from '../../services/api';
import { useToast } from '../common/Toast';
import { Alert, Field, Modal } from '../common/ui';
import { parseTransactionCsv } from '../../schemas';

const SAMPLE = 'reference,date,amount,direction,description\nSTMT-001,2026-09-15,125000.00,credit,Synthetic statement credit';

/** Lets staff paste an externally supplied transaction export (e.g. bank statement) for reconciliation. */
export default function ImportTransactionsModal({ open, onClose, onImported }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const { records, errors: errs } = parseTransactionCsv(text);
    setErrors(errs);
    if (errs.length || !records.length) return;
    setBusy(true);
    try {
      const body = await api.post('/fraud-alerts/transactions', { records, source: 'csv-paste' });
      toast.success(body.message);
      setText('');
      onImported?.();
      onClose();
    } catch (e) { setErrors([e.message]); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Import transaction records"
      footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn-primary" onClick={submit} disabled={busy || !text.trim()}>{busy ? 'Importing…' : 'Import'}</button></>}>
      <Alert tone="info" className="mb-3">Paste rows exported from a bank or payment-gateway statement. They are compared with recorded sales per month during analysis. Imported rows are treated as supplied data and are <strong>not verified</strong> by this system. Use synthetic data for demonstrations.</Alert>
      <Field label="CSV rows" hint="Columns: reference, date (YYYY-MM-DD), amount, direction (credit/debit), description"><textarea className="input font-mono text-xs" rows={8} placeholder={SAMPLE} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      {errors.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-red-600" role="alert">{errors.slice(0, 6).map((e) => <li key={e}>{e}</li>)}</ul>}
    </Modal>
  );
}
