'use strict';
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    userName: String,
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true, index: true },
    entityId: { type: String, index: true },
    summary: mongoose.Schema.Types.Mixed,
    ip: String,
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);

// Audit records are append-only: block updates and deletes made through Mongoose.
const BLOCKED = [
  'updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne',
  'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove',
];
BLOCKED.forEach((op) => {
  auditLogSchema.pre(op, function blockMutation(next) {
    next(new Error('Audit log records are immutable'));
  });
});
auditLogSchema.pre('save', function blockResave(next) {
  if (!this.isNew) return next(new Error('Audit log records are immutable'));
  return next();
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
