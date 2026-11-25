#!/usr/bin/env node
/** Deletes a downloaded optional model: `node scripts/remove-model.mjs rephrase|grammar`. */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { c, MODEL, ROOT } from './check-system.mjs';

function dirSize(dir) {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return total;
}

const targets = [join(ROOT, 'public', 'models', MODEL.id), join(ROOT, 'dist', 'models', MODEL.id)];
let freed = 0;
for (const dir of targets) {
  if (!existsSync(dir)) continue;
  freed += dirSize(dir);
  rmSync(dir, { recursive: true, force: true });
  console.log(`Removed ${dir}`);
}
if (freed) console.log(c.green(`Freed ${(freed / 1024 ** 2).toFixed(0)} MB. ${MODEL.label} is now off; the basic spelling & grammar check still works.`));
else console.log(`${MODEL.label} is not installed. Nothing to remove.`);
