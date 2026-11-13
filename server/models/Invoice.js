'use strict';
const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: { type: String, required: true },
    description: String,
    sku: String,
    hsnSac: String,
    quantity: { type: Number, required: true, min: 0.001 },
    unitPrice: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    grossAmount: { type: Number, required: true },
    discountAmount: { type: Number, default: 0 },
    taxableAmount: { type: Number, required: true },
    taxCategory: String,
    taxRate: { type: Number, required: true, min: 0 },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    igst: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    lineTotal: { type: Number, required: true },
  },
  { _id: true }
);

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true, trim: true },
    externalReference: { type: String, trim: true, maxlength: 60 }, // e.g. manual/legacy invoice reference
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    customerSnapshot: {
      name: String,
      email: String,
      address: String,
      gstin: String,
      stateCode: String,
    },
    supplierStateCode: { type: String, required: true },
    supplyType: { type: String, enum: ['intra', 'inter'], required: true },
    items: { type: [itemSchema], validate: (v) => Array.isArray(v) && v.length > 0 },
    subtotal: { type: Number, required: true }, // sum of gross amounts
    discount: { type: Number, default: 0 },
    taxableAmount: { type: Number, required: true },
    taxBreakdown: {
      cgst: { type: Number, default: 0 },
      sgst: { type: Number, default: 0 },
      igst: { type: Number, default: 0 },
      totalTax: { type: Number, default: 0 },
    },
    grandTotal: { type: Number, required: true },
    amountPaid: { type: Number, default: 0 },
    outstanding: { type: Number, required: true },
    invoiceDate: { type: Date, required: true, index: true },
    dueDate: { type: Date },
    paymentStatus: { type: String, enum: ['Unpaid', 'Partially Paid', 'Paid'], default: 'Unpaid', index: true },
    status: { type: String, enum: ['Issued', 'Cancelled'], default: 'Issued', index: true },
    cancelReason: String,
    notes: { type: String, maxlength: 500 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

invoiceSchema.index({ customer: 1, invoiceDate: -1 });
invoiceSchema.index({ externalReference: 1 }, { sparse: true });

invoiceSchema.virtual('isOverdue').get(function () {
  return this.status === 'Issued' && this.outstanding > 0 && this.dueDate && this.dueDate < new Date();
});
invoiceSchema.set('toJSON', { virtuals: true, transform: (_d, r) => { delete r.__v; delete r.id; return r; } });

module.exports = mongoose.model('Invoice', invoiceSchema);
