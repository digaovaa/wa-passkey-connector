import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const parts = String(pkg.version).split('.');
if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
  throw new Error(`Versão inválida em package.json: ${pkg.version}`);
}

const prev = pkg.version;
parts[2] = String(Number(parts[2]) + 1);
const next = parts.join('.');

pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`[bump-version] ${prev} → ${next}`);
