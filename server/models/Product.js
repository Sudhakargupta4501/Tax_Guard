'use strict';
const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 500 },
    sku: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 50 },
    hsnSac: { type: String, trim: true, maxlength: 10 },
    unitPrice: { type: Number, required: true, min: 0 },
    taxCategory: { type: String, required: true, trim: true }, // matches TaxConfiguration.category
    taxRate: { type: Number, required: true, min: 0, max: 100 },
    trackInventory: { type: Boolean, default: false },
    inventoryQuantity: { type: Number, default: 0, min: 0 },
    isArchived: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

productSchema.index({ name: 'text', sku: 'text' });

module.exports = mongoose.model('Product', productSchema);
