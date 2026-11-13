'use strict';
const dns = require('node:dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
let env;
try {
  env = require('./config/env');
} catch (err) {
  console.error(`\n[CONFIG ERROR] ${err.message}\n`);
  process.exit(1);
}
const app = require('./app');
const { connectDatabase } = require('./config/database');
const mongoose = require('mongoose');

async function start() {
  await connectDatabase();
  const server = app.listen(env.PORT, () => console.log(`TaxGuard AI API listening on port ${env.PORT} (${env.NODE_ENV})`));

  const shutdown = async (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
      await mongoose.connection.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
