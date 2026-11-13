import { useState } from 'react';
import { presetRange } from '../../utils/format';

const PRESETS = [['all', 'All time'], ['month', 'This month'], ['quarter', 'This quarter'], ['year', 'This year'], ['custom', 'Custom']];

/** Controlled period selector. Emits { from, to } (YYYY-MM-DD, empty = unbounded). */
export default function DateRangeFilter({ value, onChange }) {
  const [preset, setPreset] = useState('all');
  const pick = (p) => {
    setPreset(p);
    if (p !== 'custom') onChange(presetRange(p));
  };
  return (
    <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Date range filter">
      <label className="text-xs font-medium text-slate-600">
        Period
        <select className="input mt-1 w-40" value={preset} onChange={(e) => pick(e.target.value)}>
          {PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      {preset === 'custom' && (
        <>
          <label className="text-xs font-medium text-slate-600">From
            <input type="date" className="input mt-1" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          </label>
          <label className="text-xs font-medium text-slate-600">To
            <input type="date" className="input mt-1" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} />
          </label>
        </>
      )}
    </div>
  );
}
