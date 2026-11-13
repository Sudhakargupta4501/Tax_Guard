'use strict';
// Default GST slabs used by the demo and by first-time setup. Illustrative only - verify against current official rates.
const TaxConfiguration = require('../models/TaxConfiguration');

const DEFAULT_TAX = [
  { name: 'GST 0% (Exempt / Nil)', rate: 0, category: 'GST-0' },
  { name: 'GST 5%', rate: 5, category: 'GST-5' },
  { name: 'GST 12%', rate: 12, category: 'GST-12' },
  { name: 'GST 18%', rate: 18, category: 'GST-18' },
  { name: 'GST 28%', rate: 28, category: 'GST-28' },
];

async function ensureDefaultTaxConfigs(userId) {
  let created = 0;
  for (const t of DEFAULT_TAX) {
    const exists = await TaxConfiguration.exists({ category: t.category });
    if (exists) continue;
    await TaxConfiguration.create({ ...t, effectiveDate: new Date('2017-07-01'), isActive: true, metadata: { note: 'Illustrative default; edit in Settings.' }, createdBy: userId });
    created += 1;
  }
  return created;
}

module.exports = { DEFAULT_TAX, ensureDefaultTaxConfigs };
