// 将 zh 文档中指向英文页面的内部链接本地化为 /zh/ 前缀。
// 只处理 ](/section...) 形式的 Markdown 内链；外链、锚点、已有 /zh/ 的链接不动。
import fs from 'node:fs';
import path from 'node:path';

const zhRoot = new URL('./src/content/docs/zh/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const SECTIONS = 'analysis|design|synthesis|simulation|data-exchange';
const RE = new RegExp(`\\]\\(/((?:${SECTIONS})[^)]*)\\)`, 'g');

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

let totalFixed = 0;
const filesTouched = [];
for (const f of walk(zhRoot)) {
  const before = fs.readFileSync(f, 'utf8');
  let count = 0;
  const after = before.replace(RE, (_, rest) => {
    count++;
    return `](/zh/${rest})`;
  });
  if (count > 0) {
    fs.writeFileSync(f, after, 'utf8');
    totalFixed += count;
    filesTouched.push(`${path.relative(zhRoot, f)} (${count})`);
  }
}

console.log(`修复链接总数: ${totalFixed}`);
console.log(`涉及文件数: ${filesTouched.length}`);
filesTouched.forEach(t => console.log(' -', t));

// 复验：不应再有英文 section 内链
let remaining = 0;
for (const f of walk(zhRoot)) {
  const c = fs.readFileSync(f, 'utf8');
  remaining += (c.match(RE) || []).length;
}
console.log(`\n复验——残留英文内链: ${remaining} ${remaining === 0 ? '✓' : '✗ 失败'}`);
