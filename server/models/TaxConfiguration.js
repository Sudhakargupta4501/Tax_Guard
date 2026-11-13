'use strict';
const mongoose = require('mongoose');

const taxConfigurationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    rate: { type: Number, required: true, min: 0, max: 100 }, // total GST % (split into CGST+SGST or IGST)
    category: { type: String, required: true, trim: true, maxlength: 50 },
    effectiveDate: { type: Date, required: true, default: () => new Date('2017-07-01') },
    isActive: { type: Boolean, default: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

taxConfigurationSchema.index({ category: 1, effectiveDate: -1 }, { unique: true });

module.exports = mongoose.model('TaxConfiguration', taxConfigurationSchema);
