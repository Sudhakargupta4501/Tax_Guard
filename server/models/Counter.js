'use strict';
const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });
const Counter = mongoose.model('Counter', counterSchema);

/** Atomically increments and returns the next sequence value for a key. */
async function nextSequence(key) {
  const doc = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return doc.seq;
}

module.exports = Counter;
module.exports.nextSequence = nextSequence;
