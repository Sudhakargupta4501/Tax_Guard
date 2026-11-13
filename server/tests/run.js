'use strict';
// Cross-platform test runner (no shell globbing needed): node tests/run.js [unit|integration]
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const which = process.argv[2];
const dirs = which ? [which] : ['unit', 'integration'];
const files = dirs.flatMap((d) => {
  const dir = path.join(__dirname, d);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).map((f) => path.join(dir, f)) : [];
});
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } });
process.exit(r.status ?? 1);
