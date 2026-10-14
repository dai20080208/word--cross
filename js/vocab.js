/* 词库汇总：把各阶段词库合并成统一索引，供"交叉填字"和"词汇查阅"共用。
 * 同一个单词可能出现在多个阶段（如 accept 在高中和四级里都有），
 * 这里全局去重一次，但保留它所属的所有阶段标签。
 */
window.VOCAB = (function () {
  const levels = window.WORD_BANKS || [];
  const all = [];            // 去重后的全部词条
  const map = new Map();     // 小写单词 -> 词条
  const pools = {};          // 阶段 id -> 可进入棋盘的词条（3~10 个纯字母）

  levels.forEach(function (lv) {
    const list = [];
    lv.words.forEach(function (entry) {
      if (!entry || entry.length < 3) return;
      const w = String(entry[0]).trim();
      const p = String(entry[1] || '').trim();
      const c = String(entry[2] || '').trim();
      const lw = w.toLowerCase();
      let item = map.get(lw);
      if (!item) {
        item = { w: w, lw: lw, p: p, c: c, levels: [], levelIds: [] };
        map.set(lw, item);
        all.push(item);
      }
      if (item.levelIds.indexOf(lv.id) < 0) {
        item.levelIds.push(lv.id);
        item.levels.push(lv.name);
      }
      list.push(item);
    });
    // 棋盘用词：纯字母、3~10 个字母、至少有 3 个不同字母（太少不好交叉）
    const pool = [];
    const seen = new Set();
    list.forEach(function (it) {
      if (!/^[a-z]{3,10}$/.test(it.lw)) return;
      if (new Set(it.lw).size < 3) return;
      if (seen.has(it.lw)) return;
      seen.add(it.lw);
      pool.push(it);
    });
    pools[lv.id] = pool;
  });

  function levelById(id) {
    return levels.filter(function (l) { return l.id === id; })[0] || null;
  }

  /** 词汇查阅：按英文片段或中文释义模糊搜索 */
  function search(query, levelId) {
    const q = String(query || '').trim().toLowerCase();
    let list = all;
    if (levelId && levelId !== 'all') {
      list = list.filter(function (it) { return it.levelIds.indexOf(levelId) >= 0; });
    }
    if (!q) return list;
    const starts = [];
    const contains = [];
    list.forEach(function (it) {
      if (it.lw.indexOf(q) === 0) starts.push(it);
      else if (it.lw.indexOf(q) >= 0 || it.c.indexOf(q) >= 0 || it.p.indexOf(q) >= 0) contains.push(it);
    });
    return starts.concat(contains);
  }

  return {
    levels: levels,
    all: all,
    pools: pools,
    map: map,
    levelById: levelById,
    search: search
  };
})();
