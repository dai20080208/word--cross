/* 词库统计：各阶段词条数、可上盘词数、长度分布、跨库重复
 * 用法：node tools/dict-stats.js
 */
const path = require('path');
const D = path.join(__dirname, '..', 'js', 'data');
global.window = global;
['primary', 'junior', 'senior', 'cet4', 'cet6', 'ielts'].forEach((f) => require(path.join(D, f + '.js')));

let total = 0;
const all = new Map();
for (const lv of window.WORD_BANKS) {
  const pool = lv.words.filter((e) => /^[a-z]{3,10}$/.test(e[0].toLowerCase()));
  const byLen = {};
  const seen = new Set();
  const dup = [];
  let bad = [];
  for (const e of lv.words) {
    if (!Array.isArray(e) || e.length !== 3) { bad.push(e); continue; }
    const w = e[0].toLowerCase();
    byLen[w.length] = (byLen[w.length] || 0) + 1;
    if (seen.has(w)) dup.push(w);
    seen.add(w);
    const cur = all.get(w) || new Set();
    cur.add(lv.id); all.set(w, cur);
  }
  console.log(
    lv.id.padEnd(8),
    '总 ' + String(lv.words.length).padStart(4),
    '可上盘 ' + String(pool.length).padStart(4),
    '库内重复 ' + String(dup.length).padStart(2),
    '格式错 ' + bad.length,
    JSON.stringify(byLen)
  );
  if (dup.length) console.log('   重复：', dup.join(', '));
  total += lv.words.length;
}
console.log('合计词条 ' + total + '，去重后 ' + all.size);
const cross = [...all.entries()].filter(([, v]) => v.size > 1);
console.log('跨阶段重复 ' + cross.length + ' 个');
