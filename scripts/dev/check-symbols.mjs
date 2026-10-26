// 一次性校验脚本：确认 SandboxPage 里的"常用沙具" id 都真实存在
import { readFileSync } from 'node:fs';

const source = readFileSync('src/sandbox/symbols.ts', 'utf8');
const ids = new Set();
const re = /^\s+s\('([a-z0-9-]+)',\s*'([^']+)'/gm;
let match;
while ((match = re.exec(source)) !== null) ids.add(match[1]);

const wanted = [
  'tree', 'pine', 'flower', 'stone', 'dog', 'cat', 'snake', 'bird',
  'me', 'child', 'family', 'house', 'bridge', 'door', 'box', 'mirror',
  'sea', 'fire', 'rainbow', 'sun',
];
const missing = wanted.filter((id) => !ids.has(id));
console.log('总条目:', ids.size);
console.log('缺失:', missing.length === 0 ? '(无)' : missing.join(', '));

// 按子类采样，帮助挑选更有代表性的常用沙具
const entries = [];
const re2 = /^\s+s\('([a-z0-9-]+)',\s*'([^']+)',\s*'([a-z-]+)'/gm;
let m2;
while ((m2 = re2.exec(source)) !== null) entries.push({ id: m2[1], label: m2[2], sub: m2[3] });
const subs = [...new Set(entries.map((entry) => entry.sub))];
console.log(`子类数: ${subs.length}`);
for (const sub of subs) {
  const first = entries.filter((entry) => entry.sub === sub).slice(0, 4);
  console.log(`${sub.padEnd(20)} ${first.map((entry) => `${entry.id}(${entry.label})`).join(' ')}`);
}
