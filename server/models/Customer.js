'use strict';
const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    email: { type: String, lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String, trim: true, maxlength: 20 },
    address: {
      line1: { type: String, trim: true, maxlength: 200 },
      city: { type: String, trim: true, maxlength: 100 },
      state: { type: String, trim: true, maxlength: 100 },
      pincode: { type: String, trim: true, maxlength: 10 },
    },
    stateCode: { type: String, required: true, match: /^\d{2}$/ }, // GST state code (place of supply)
    gstin: { type: String, uppercase: true, trim: true },
    isArchived: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

// Unique email only when an email is supplied.
customerSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
customerSchema.index({ name: 'text' });
customerSchema.index({ gstin: 1 });

module.exports = mongoose.model('Customer', customerSchema);
