'use strict';
const env = require('../config/env');
const Setting = require('../models/Setting');
const { DEFAULT_THRESHOLDS } = require('../config/fraudConfig');

async function getBusinessProfile() {
  const doc = await Setting.findOne({ key: 'business' }).lean();
  return {
    name: env.BUSINESS_NAME,
    gstin: env.BUSINESS_GSTIN,
    stateCode: env.BUSINESS_STATE_CODE,
    address: env.BUSINESS_ADDRESS,
    email: '',
    phone: '',
    currency: env.DEFAULT_CURRENCY,
    ...(doc ? doc.value : {}),
  };
}

async function saveBusinessProfile(value, userId) {
  const doc = await Setting.findOneAndUpdate({ key: 'business' }, { value, updatedBy: userId }, { upsert: true, new: true, setDefaultsOnInsert: true });
  return doc.value;
}

async function getThresholds() {
  const doc = await Setting.findOne({ key: 'fraudThresholds' }).lean();
  return { ...DEFAULT_THRESHOLDS, ...(doc ? doc.value : {}) };
}

async function saveThresholds(value, userId) {
  const current = (await Setting.findOne({ key: 'fraudThresholds' }).lean())?.value || {};
  const merged = { ...current, ...value };
  await Setting.findOneAndUpdate({ key: 'fraudThresholds' }, { value: merged, updatedBy: userId }, { upsert: true, new: true });
  return getThresholds();
}

module.exports = { getBusinessProfile, saveBusinessProfile, getThresholds, saveThresholds };
