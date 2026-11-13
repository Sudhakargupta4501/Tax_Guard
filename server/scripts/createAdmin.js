'use strict';
const dns = require('node:dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
/**
 * One-time secure setup: creates the first administrator from environment variables
 * (ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD) and the default GST tax configurations.
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='Str0ngPassw0rd' ADMIN_NAME='Your Name' npm run create-admin
 * No credentials are hardcoded. Remove the variables afterwards.
 */
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const env = require('../config/env');
const { connectDatabase } = require('../config/database');
const User = require('../models/User');
const v = require('../validators/schemas');
const { ensureDefaultTaxConfigs } = require('./defaultTax');

(async () => {
  const parsed = v.register.safeParse({ name: process.env.ADMIN_NAME, email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  if (!parsed.success) {
    console.error('Set ADMIN_NAME, ADMIN_EMAIL and a strong ADMIN_PASSWORD (min 8 chars, upper, lower, number):');
    parsed.error.issues.forEach((i) => console.error(`  - ${i.path.join('.')}: ${i.message}`));
    process.exit(1);
  }
  const { name, email, password } = parsed.data;
  await connectDatabase();
  let user = await User.findOne({ email });
  if (user) {
    console.log(`User ${email} already exists (role: ${user.role}). Nothing changed.`);
  } else {
    user = await User.create({ name, email, role: 'admin', passwordHash: await bcrypt.hash(password, env.BCRYPT_ROUNDS) });
    console.log(`Administrator created: ${email}`);
  }
  const n = await ensureDefaultTaxConfigs(user._id);
  console.log(`Default tax configurations added: ${n}`);
  await mongoose.connection.close();
})().catch((e) => { console.error('Setup failed:', e.message); process.exit(1); });
