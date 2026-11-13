'use strict';
const mongoose = require('mongoose');
const env = require('./env');

mongoose.set('strictQuery', true);

async function connectDatabase(uri = env.MONGODB_URI) {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    throw err;
  }
  mongoose.connection.on('error', (e) => console.error('MongoDB error:', e.message));
  mongoose.connection.on('disconnected', () => console.warn('MongoDB disconnected'));
}

module.exports = { connectDatabase };
