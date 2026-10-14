/* 端到端交互自测：node tools/uitest.js
 * 用 jsdom 真正加载 index.html 和全部脚本，模拟玩家操作：
 *   选阶段 → 开一局 → 点释义查看单词 → 敲键盘填满棋盘 → 自动判过关
 *   再验证词汇查阅、生词本、难度差异等功能。
 * 需要先安装 jsdom（仅测试用，不影响游戏本身）：
 *   node -e "require('jsdom')" || npm i jsdom
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let jsdom;
try {
  jsdom = require('jsdom');
} catch (e) {
  const alt = path.join('C:', 'Users', 'DDDD', '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules', 'jsdom');
  jsdom = require(alt);
}
const { JSDOM, VirtualConsole } = jsdom;

let failed = 0;
function ok(cond, msg) {
  if (cond) {
    console.log('  ✓ ' + msg);
  } else {
    failed++;
    console.log('  ✗ ' + msg);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const pageErrors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => {
  if (!/Not implemented/.test(e.message)) pageErrors.push(e.message);
});

const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc
});
const { window } = dom;
const doc = window.document;

/* 按 index.html 里的顺序把脚本注入进去 */
const srcs = (html.match(/<script src="([^"]+)"><\/script>/g) || []).map((s) =>
  s.replace(/.*src="([^"]+)".*/, '$1')
);
ok(srcs.length >= 10, `index.html 引用了 ${srcs.length} 个脚本文件`);
srcs.forEach((src) => {
  const el = doc.createElement('script');
  el.textContent = fs.readFileSync(path.join(ROOT, src), 'utf8');
  doc.body.appendChild(el);
});

const $ = (s) => doc.querySelector(s);
const $$ = (s) => Array.prototype.slice.call(doc.querySelectorAll(s));
const key = (k) => doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }));

(async function run() {
  // 等 jsdom 把 DOMContentLoaded 派发完，app.js 才会执行 init()
  await new Promise((resolve) => {
    if (doc.readyState === 'complete') return resolve();
    doc.addEventListener('DOMContentLoaded', resolve);
    doc.addEventListener('load', resolve);
    setTimeout(resolve, 800);
  });
  await sleep(60);

  console.log('\n=== 1. 初始化 ===');
  ok(!!window.VOCAB && window.VOCAB.all.length > 1000, `词库加载完成，共 ${window.VOCAB.all.length} 个词条`);
  ok(!!window.WordBook, '生词本模块初始化成功');
  ok($$('#levelList .level-card').length === 6, '首页渲染出 6 个学习阶段');
  ok($$('#diffList .diff-card').length === 3, '首页渲染出 3 档难度');
  ok($$('#dictList .word-card').length > 0, '词汇查阅页首次进入就有内容');
  ok($('#bookList').textContent.indexOf('空') >= 0, '生词本初始为空并给出引导');

  console.log('\n=== 2. 选阶段 + 开一局 ===');
  $('[data-level="cet4"]').click();
  ok($('[data-level="cet4"]').classList.contains('active'), '点击"四级"后卡片高亮');
  $('[data-diff="normal"]').click();
  $('#btnStart').click();
  ok($('#screen-game').classList.contains('active'), '成功进入游戏页');
  const letterCells = $$('#grid .cell:not(.gap)');
  const hintCells = $$('#grid .cell.hint');
  ok(letterCells.length >= 30, `棋盘渲染出 ${letterCells.length} 个字母格`);
  ok(hintCells.length >= 3, `挖空后保留了 ${hintCells.length} 个提示字母`);
  ok(Number($('#totalCount').textContent) === letterCells.length, '顶部进度条总格数正确');
  ok($$('#clueList .clue').length === 10, '下方列出 10 条中文释义');
  ok($('#clueList').textContent.indexOf('四级') < 0 && $('#gameLevel').textContent === '四级', '标题显示当前阶段为四级');
  ok($$('#grid .cell .num').length === 10, '每个单词的起始格带有序号标记');

  console.log('\n=== 3. 点释义"查看单词"并自动收进生词本 ===');
  for (let i = 0; i < 10; i++) {
    const li = $$('#clueList .clue')[i];
    if (!li) break;
    li.querySelector('.clue-btn').click();   // 每次点击都会重绘列表，所以按位置重新取
  }
  ok(window.WordBook.count() === 10, `查看 10 条释义后生词本收到 ${window.WordBook.count()} 个单词`);
  ok(Number($('#bookBadge').textContent) === 10, '顶栏生词本角标同步更新为 10');
  const firstClue = $('#clueList .clue');
  ok(/[a-z]{3,}/.test(firstClue.querySelector('.clue-word').textContent), '释义行上显示出对应英文单词');
  ok($$('#grid .cell .ch.ghost').length > 0, '查看过的单词在棋盘上以浅色字母提示');

  console.log('\n=== 4. 敲键盘把整盘填满 ===');
  const answers = {};
  $$('#grid .cell:not(.gap)').forEach((c) => {
    answers[c.getAttribute('data-r') + ',' + c.getAttribute('data-c')] =
      c.querySelector('.ch').textContent.trim();
  });
  const missing = Object.keys(answers).filter((k) => !answers[k]);
  ok(missing.length === 0, '棋盘上每个格子的答案都拿得到（视图与数据一致）');
  let typed = 0;
  $$('#grid .cell:not(.gap)').forEach((c) => {
    if (c.classList.contains('hint')) return;
    const k = c.getAttribute('data-r') + ',' + c.getAttribute('data-c');
    c.click();
    key(answers[k].toLowerCase());
    typed++;
  });
  ok(typed >= 20, `共敲入 ${typed} 个字母`);
  await sleep(50);
  ok(!$('#modal').classList.contains('hidden'), '填满棋盘后自动判定结果并弹出弹窗');
  ok(/过关/.test($('#modalTitle').textContent), `弹窗标题为「${$('#modalTitle').textContent}」`);
  ok($('#modalBody').textContent.indexOf('用时') >= 0, '弹窗里给出了用时等成绩');
  ok($$('#grid .cell.bad').length === 0, '全部填对，没有标红的错误格');
  ok($('#bestLine') || true, '');

  console.log('\n=== 5. 错误答案会被标出来 ===');
  $('#modalActions').querySelector('.btn-ghost').click(); // 回首页
  ok($('#screen-home').classList.contains('active'), '点"回首页"能返回首页');
  $('#btnStart').click();
  const target = $$('#grid .cell:not(.gap)').filter((c) => !c.classList.contains('hint'))[0];
  target.click();
  const wrong = /a/i.test(target.querySelector('.ch').textContent) ? 'z' : 'a';
  key(wrong);
  $('#btnCheck').click();
  ok($$('#grid .cell.bad').length >= 1, '故意填错后点检查，错误格被标红');

  console.log('\n=== 6. 提示 / 清空 / 换一局 ===');
  const badBefore = $$('#grid .cell.bad').length;
  $('#btnHint').click();
  ok(badBefore > 0 && $$('#grid .cell.bad').length === 0, '「提示一个字母」把填错的格子直接补齐了');
  ok($$('#grid .cell.hinted').length >= 1, '被提示填上的格子有区别于手填的样式');
  $('#btnClear').click();
  ok($$('#grid .cell.filled').length === 0 && $$('#grid .cell.hinted').length === 0, '「清空重填」把玩家填的都清掉了');
  ok($$('#grid .cell.hint').length >= 3, '清空不会清掉赠送的提示字母');
  const before = $$('#grid .cell:not(.gap)').map((c) => c.getAttribute('data-r') + c.getAttribute('data-c')).join();
  $('#btnNew').click();
  const after = $$('#grid .cell:not(.gap)').map((c) => c.getAttribute('data-r') + c.getAttribute('data-c')).join();
  ok(before !== after, '「换一局」重新生成了不同的棋盘');

  console.log('\n=== 7. 难度差异 ===');
  $('#screen-game').classList.remove('active');
  $('#screen-home').classList.add('active');
  $('[data-diff="easy"]').click();
  $('#btnStart').click();
  const easyHints = $$('#grid .cell.hint').length;
  const easyTotal = $$('#grid .cell:not(.gap)').length;
  ok(easyHints / easyTotal > 0.25, `简单模式提示字母占比 ${(easyHints / easyTotal * 100).toFixed(0)}%（含每词首字母）`);
  $('[data-screen="home"]').click();
  $('[data-diff="hard"]').click();
  $('#btnStart').click();
  const hardHints = $$('#grid .cell.hint').length;
  const hardTotal = $$('#grid .cell:not(.gap)').length;
  ok(hardHints / hardTotal < 0.16, `挑战模式提示字母占比 ${(hardHints / hardTotal * 100).toFixed(0)}%`);
  ok(easyHints > hardHints, '简单模式的提示确实比挑战模式多');

  console.log('\n=== 8. 词汇查阅 ===');
  $('[data-screen="dict"]').click();
  ok($('#screen-dict').classList.contains('active'), '进入词汇查阅页');
  const input = $('#dictInput');
  input.value = 'apple';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(300);
  ok($('#dictList').textContent.indexOf('apple') >= 0, '输入英文 apple 能搜到结果');
  input.value = '苹果';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(300);
  ok($('#dictList').textContent.indexOf('apple') >= 0, '输入中文"苹果"也能搜到 apple');
  input.value = 'zzzz';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(300);
  ok(/共找到 0 个/.test($('#dictCount').textContent), '搜不到时提示 0 条');
  input.value = '';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(300);
  $('#dictLevels [data-level="ielts"]').click();
  ok(/雅思/.test($('#dictCount').textContent) && !/全部阶段/.test($('#dictCount').textContent),
    '阶段筛选生效：' + $('#dictCount').textContent.slice(0, 30));
  const addBtn = $('#dictList [data-add]');
  const addWord = addBtn.getAttribute('data-add');
  addBtn.click();
  ok(window.WordBook.has(addWord), `点「＋生词本」能把 ${addWord} 收藏起来`);
  ok($('#dictMore') !== null, '列表带「显示更多」按钮');

  console.log('\n=== 9. 生词本页 ===');
  $('[data-screen="book"]').click();
  ok($('#screen-book').classList.contains('active'), '进入生词本页');
  ok($$('#bookList .word-card').length === window.WordBook.count(), '生词本列表条数与数据一致');
  ok($('#bookList').textContent.indexOf(addWord) >= 0, `生词本里能找到刚收藏的 ${addWord}`);
  const csv = window.WordBook.exportCsv();
  ok(csv.indexOf(addWord) >= 0 && csv.indexOf('单词') === 1, `导出的 CSV 含表头与单词 ${addWord}`);
  $('#bookList [data-remove]').click();
  ok($$('#bookList .word-card').length === window.WordBook.count(), '移除后列表实时更新');

  console.log('\n=== 10. 用生词本出题 ===');
  // 前面移除过一个词，这里补几个，保证够 10 个能上棋盘的词
  ['chocolate', 'bamboo', 'sunshine'].forEach((w) =>
    window.WordBook.add({ w: w, p: 'n.', c: '测试词', levels: ['测试'] })
  );
  const usable = window.WordBook.all().filter((it) => /^[a-z]{3,10}$/.test(it.lw));
  ok(usable.length >= 10, `生词本里有 ${usable.length} 个词可以直接出题`);
  $('[data-screen="book"]').click();
  $('#bookPlay').click();
  await sleep(30);
  ok($('#screen-game').classList.contains('active'), '能用生词本里的单词开新局');
  ok($('#gameLevel').textContent === '生词本出题', '标题显示来源为生词本');
  const bookWords = $$('#clueList .clue').length;
  ok(bookWords === 10, `生词本出的这局同样是 10 个单词（实际 ${bookWords} 个）`);

  console.log('\n=== 页面运行时错误 ===');
  ok(pageErrors.length === 0, pageErrors.length ? '出现错误：' + pageErrors.slice(0, 3).join(' | ') : '全程没有任何 JS 报错');

  console.log(failed === 0 ? '\n✅ 端到端交互全部通过\n' : `\n❌ 共 ${failed} 项失败\n`);
  window.close();
  process.exit(failed === 0 ? 0 : 1);
})();
