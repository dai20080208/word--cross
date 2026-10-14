/* 自测脚本：node tools/selftest.js
 * 不依赖浏览器，直接校验词库格式与交叉布局算法的正确性：
 *   1) 词库：字段完整、纯字母、阶段内无重复
 *   2) 布局：交点字母一致、无非法相邻、单词确实横向/纵向连续、不外溢
 *   3) 成功率：每个阶段跑多局，统计"10 个单词全部摆下"的比例与耗时
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.window = global;
['primary', 'junior', 'senior', 'cet4', 'cet6', 'ielts'].forEach((f) => {
  require(path.join(ROOT, 'js', 'data', f + '.js'));
});
require(path.join(ROOT, 'js', 'vocab.js'));
require(path.join(ROOT, 'js', 'crossword.js'));

const ROUNDS = Number(process.argv[2] || 40);
let failed = 0;
function ok(cond, msg) {
  if (cond) return;
  failed++;
  if (failed <= 20) console.log('  ✗ ' + msg);
}

/* ---------- 1. 词库校验 ---------- */
console.log('\n=== 词库校验 ===');
let total = 0;
VOCAB.levels.forEach((lv) => {
  const seen = new Set();
  lv.words.forEach((e) => {
    ok(Array.isArray(e) && e.length === 3, `${lv.id} 词条格式应为 [单词, 词性, 释义]`);
    if (!Array.isArray(e) || e.length !== 3) return;
    const [w, p, c] = e;
    total++;
    ok(!seen.has(w), `${lv.id} 阶段内重复词: ${w}`);
    seen.add(w);
    ok(/^[a-z]+$/i.test(w), `${lv.id} 单词含非法字符: ${w}`);
    ok(!!p, `${lv.id} 缺少词性: ${w}`);
    ok(!!c, `${lv.id} 缺少释义: ${w}`);
  });
  const pool = VOCAB.pools[lv.id];
  console.log(
    `  ${lv.name.padEnd(4)} 词条 ${String(lv.words.length).padStart(3)}   可入棋盘 ${String(pool.length).padStart(3)}`
  );
  ok(pool.length >= 10, `${lv.id} 可入棋盘的词不足 10 个`);
});
console.log(`  合计词条 ${total}，全局去重后 ${VOCAB.all.length}`);

/* ---------- 2 + 3. 布局校验与成功率 ---------- */
console.log(`\n=== 布局校验（每阶段 ${ROUNDS} 局） ===`);
let allRate = 0;
VOCAB.levels.forEach((lv) => {
  const pool = VOCAB.pools[lv.id];
  let full = 0;
  let minCells = Infinity;
  let maxCells = 0;
  let sum = 0;
  let minHints = Infinity;
  let crossSum = 0;
  const t0 = Date.now();
  for (let i = 0; i < ROUNDS; i++) {
    const puzzle = Crossword.generate(pool, 10, 0.15);
    if (!puzzle) { ok(false, `${lv.id} 第 ${i + 1} 局生成失败`); continue; }
    const problems = Crossword.validate(puzzle);
    ok(problems.length === 0, `${lv.id} 第 ${i + 1} 局: ${problems.slice(0, 3).join(' / ')}`);
    if (puzzle.words.length === 10) full++;
    sum += puzzle.letterCount;
    crossSum += puzzle.crossings;
    minCells = Math.min(minCells, puzzle.letterCount);
    maxCells = Math.max(maxCells, puzzle.letterCount);
    minHints = Math.min(minHints, puzzle.hintCount);
  }
  const ms = Date.now() - t0;
  const rate = full / ROUNDS;
  allRate += rate / VOCAB.levels.length;
  console.log(
    `  ${lv.name.padEnd(4)} 10 词全放 ${(rate * 100).toFixed(0).padStart(3)}%   字母格 ${minCells}~${maxCells}（均 ${(
      sum / ROUNDS
    ).toFixed(1)}）  平均交点 ${(crossSum / ROUNDS).toFixed(1)}  最少提示 ${minHints}   ${ms}ms/${ROUNDS}局`
  );
});
ok(allRate >= 0.99, `整体成功率 ${(allRate * 100).toFixed(1)}% 低于 99%`);

/* ---------- 4. 抽样打印一局，肉眼确认 ---------- */
console.log('\n=== 样例（高中，一局） ===');
const demo = Crossword.generate(VOCAB.pools.senior, 10, 0.15);
for (let r = 0; r < demo.rows; r++) {
  let line = '';
  for (let c = 0; c < demo.cols; c++) {
    const cell = demo.grid[r][c];
    if (!cell) line += ' .';
    else if (!cell.revealed) line += ' _';
    else line += ' ' + cell.ch;
  }
  console.log('  ' + line);
}
console.log('  提示词条：');
demo.words.forEach((w) => console.log(`    ${w.num}. ${w.p} ${w.c}`));
console.log('  答案：' + demo.words.map((w) => w.w).join(', '));

console.log(failed === 0 ? '\n✅ 全部自测通过\n' : `\n❌ 共 ${failed} 项失败\n`);
process.exit(failed === 0 ? 0 : 1);
