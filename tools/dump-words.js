/* 导出各阶段已有单词清单（每行 12 个），扩充词库时用来比对去重
 * 用法：
 *   node tools/dump-words.js            # 全部阶段
 *   node tools/dump-words.js primary    # 只看某一阶段
 */
const path = require('path');
const D = path.join(__dirname, '..', 'js', 'data');
global.window = global;
['primary', 'junior', 'senior', 'cet4', 'cet6', 'ielts'].forEach((f) => require(path.join(D, f + '.js')));

const only = process.argv[2];
window.WORD_BANKS.forEach((lv) => {
  if (only && lv.id !== only) return;
  const ws = lv.words.map((e) => e[0].toLowerCase());
  console.log('### ' + lv.id + ' (' + ws.length + ')');
  for (let i = 0; i < ws.length; i += 12) console.log(ws.slice(i, i + 12).join(' '));
});
