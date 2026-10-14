/* 交叉填字布局算法
 * ---------------------------------------------------------------
 * 玩法核心：抽 10 个单词，让它们纵横交错地摆在同一张棋盘上，
 * 交点必须是两个单词共有的同一个字母，再把大部分字母挖空。
 *
 * 放置规则（保证排版干净、不会串味）：
 *   1. 每个单词占一条直线，交点处字母必须相同；
 *   2. 一个格子最多被"横向 + 纵向"各一个单词占用，不允许同向重叠；
 *   3. 新增字母的上下（或左右）必须是空的，避免出现"两个单词并排紧贴却不相交"；
 *   4. 单词两端也不能紧邻其它字母。
 * 放不下时先跳过，等别的单词放下后再回补；仍有缺口就从词库里补词，
 * 整盘重试若干次，直到 10 个单词全部摆下为止。
 */
window.Crossword = (function () {
  'use strict';

  var H = 1;  // 横向
  var V = 2;  // 纵向
  var LIMIT = 60; // 坐标绝对值上限，防止棋盘跑飞

  function rnd(n) { return (Math.random() * n) | 0; }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = rnd(i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function key(r, c) { return r + ',' + c; }

  function makeBoard() {
    return { cells: new Map(), words: [], minR: 0, maxR: 0, minC: 0, maxC: 0 };
  }

  /* ---------- 1. 挑选单词：偏好"字母有重叠"，这样才交得起来 ---------- */
  function pickWords(pool, count) {
    var picked = [];
    var used = new Set();
    var letterSet = new Set();
    var guard = 0;
    while (picked.length < count && guard++ < count * 40) {
      var candidates = [];
      var bag = shuffle(pool);
      for (var i = 0; i < bag.length && candidates.length < 18; i++) {
        if (!used.has(bag[i].lw)) candidates.push(bag[i]);
      }
      if (!candidates.length) break;
      var best = null;
      var bestScore = -Infinity;
      candidates.forEach(function (it) {
        var seen = new Set();
        var hits = 0;
        for (var i = 0; i < it.lw.length; i++) {
          var ch = it.lw[i];
          if (letterSet.has(ch) && !seen.has(ch)) hits++;
          seen.add(ch);
        }
        // 随机扰动：保证每局都不一样，不是每次都挑同一批词
        var score = hits + Math.random() * 1.8;
        if (score > bestScore) { bestScore = score; best = it; }
      });
      picked.push(best);
      used.add(best.lw);
      for (var j = 0; j < best.lw.length; j++) letterSet.add(best.lw[j]);
    }
    return picked;
  }

  /* ---------- 2. 校验一个候选位置是否合法 ---------- */
  function check(board, word, r, c, dir) {
    var n = word.length;
    if (n < 2) return null;

    // 首尾外侧不能紧邻字母
    var bR = dir === H ? r : r - 1, bC = dir === H ? c - 1 : c;
    var aR = dir === H ? r : r + n, aC = dir === H ? c + n : c;
    if (board.cells.has(key(bR, bC)) || board.cells.has(key(aR, aC))) return null;

    // 起点不能和别的单词起点撞在一起，否则两个词会共用一个序号格，
    // 玩家就不知道纵向那个词从哪开始了
    for (var wi = 0; wi < board.words.length; wi++) {
      if (board.words[wi].startR === r && board.words[wi].startC === c) return null;
    }

    var crossings = 0;
    for (var i = 0; i < n; i++) {
      var rr = dir === V ? r + i : r;
      var cc = dir === H ? c + i : c;
      if (Math.abs(rr) > LIMIT || Math.abs(cc) > LIMIT) return null;
      var cell = board.cells.get(key(rr, cc));
      if (cell) {
        if (cell.ch !== word[i]) return null;   // 交点字母必须相同
        if (cell.dir & dir) return null;        // 不能同向重叠
        crossings++;
      } else {
        var n1 = dir === H ? board.cells.get(key(rr - 1, cc)) : board.cells.get(key(rr, cc - 1));
        var n2 = dir === H ? board.cells.get(key(rr + 1, cc)) : board.cells.get(key(rr, cc + 1));
        if (n1 || n2) return null;              // 会造成并排紧贴
      }
    }
    if (!crossings) return null;                // 至少要有一个交点
    return { crossings: crossings };
  }

  /* ---------- 3. 枚举所有可放位置并打分 ---------- */
  function findPlacements(board, word) {
    var out = [];
    if (!board.cells.size) return out;
    var dirs = [H, V];
    board.cells.forEach(function (cell) {
      for (var i = 0; i < word.length; i++) {
        if (word[i] !== cell.ch) continue;
        for (var d = 0; d < 2; d++) {
          var dir = dirs[d];
          if (cell.dir & dir) continue;  // 与该方向已有单词平行，跳过
          var r = dir === V ? cell.r - i : cell.r;
          var c = dir === H ? cell.c - i : cell.c;
          var res = check(board, word, r, c, dir);
          if (res) out.push({ r: r, c: c, dir: dir, crossings: res.crossings, score: 0 });
        }
      }
    });
    if (!out.length) return out;

    var box = { minR: board.minR, maxR: board.maxR, minC: board.minC, maxC: board.maxC };
    var curArea = (box.maxR - box.minR + 1) * (box.maxC - box.minC + 1);
    out.forEach(function (p) {
      var nr = { minR: box.minR, maxR: box.maxR, minC: box.minC, maxC: box.maxC };
      var len = word.length;
      if (p.dir === H) {
        nr.minC = Math.min(nr.minC, p.c);
        nr.maxC = Math.max(nr.maxC, p.c + len - 1);
      } else {
        nr.minR = Math.min(nr.minR, p.r);
        nr.maxR = Math.max(nr.maxR, p.r + len - 1);
      }
      var h = nr.maxR - nr.minR + 1;
      var w = nr.maxC - nr.minC + 1;
      var areaGrow = h * w - curArea;
      var aspect = Math.max(h, w) / Math.max(1, Math.min(h, w));
      // 交叉越多越好；棋盘越紧凑越好；太狭长要惩罚
      p.score = p.crossings * 14 - areaGrow * 0.45 - aspect * 3 + Math.random() * 5;
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  /* ---------- 4. 落子 ---------- */
  function placeWord(board, item, p) {
    var word = item.lw;
    // 注意：起点坐标用 startR/startC，不能叫 r/c —— item.c 是中文释义，会撞名
    var wordObj = {
      w: item.w, lw: word, p: item.p, c: item.c,
      levels: item.levels, levelIds: item.levelIds,
      dir: p.dir === H ? 'h' : 'v',
      startR: p.r, startC: p.c, cells: []
    };
    for (var i = 0; i < word.length; i++) {
      var rr = p.dir === V ? p.r + i : p.r;
      var cc = p.dir === H ? p.c + i : p.c;
      var kk = key(rr, cc);
      var cell = board.cells.get(kk);
      if (!cell) {
        cell = { r: rr, c: cc, ch: word[i], dir: 0, words: [], revealed: false };
        board.cells.set(kk, cell);
      }
      cell.dir |= p.dir;
      cell.words.push(wordObj);
      wordObj.cells.push(cell);
    }
    board.words.push(wordObj);
    board.minR = Math.min(board.minR, ...wordObj.cells.map(function (x) { return x.r; }));
    board.maxR = Math.max(board.maxR, ...wordObj.cells.map(function (x) { return x.r; }));
    board.minC = Math.min(board.minC, ...wordObj.cells.map(function (x) { return x.c; }));
    board.maxC = Math.max(board.maxC, ...wordObj.cells.map(function (x) { return x.c; }));
  }

  function placeFirst(board, item) {
    var word = item.lw;
    var wordObj = {
      w: item.w, lw: word, p: item.p, c: item.c,
      levels: item.levels, levelIds: item.levelIds,
      dir: 'h', startR: 0, startC: 0, cells: []
    };
    for (var i = 0; i < word.length; i++) {
      var cell = { r: 0, c: i, ch: word[i], dir: H, words: [wordObj], revealed: false };
      board.cells.set(key(0, i), cell);
      wordObj.cells.push(cell);
    }
    board.words.push(wordObj);
    board.minR = 0; board.maxR = 0; board.minC = 0; board.maxC = word.length - 1;
  }

  function tryPlace(board, item) {
    if (!board.cells.size) { placeFirst(board, item); return true; }
    var opts = findPlacements(board, item.lw);
    if (!opts.length) return false;
    var top = opts.filter(function (o) { return o.score >= opts[0].score - 6; }).slice(0, 5);
    placeWord(board, item, top[rnd(top.length)]);
    return true;
  }

  /** 反复扫剩余单词，直到摆不下为止；返回仍没放下的词 */
  function fill(board, list, target) {
    var pending = list.slice().sort(function (a, b) { return b.lw.length - a.lw.length; });
    var progress = true;
    var guard = 0;
    while (progress && board.words.length < target && guard++ < 8) {
      progress = false;
      var next = [];
      for (var i = 0; i < pending.length; i++) {
        if (board.words.length >= target) { next.push(pending[i]); continue; }
        if (tryPlace(board, pending[i])) progress = true;
        else next.push(pending[i]);
      }
      pending = next;
    }
    return pending;
  }

  /* ---------- 5. 挖空 + 归一化输出 ---------- */
  function pickHints(cells, ratio) {
    var n = Math.max(3, Math.round(cells.length * ratio));
    n = Math.min(n, Math.max(1, cells.length - 1));
    var crossings = cells.filter(function (c) { return c.words.length > 1; });
    var picks = [];
    var quota = Math.min(crossings.length, Math.round(n * 0.6));
    shuffle(crossings).slice(0, quota).forEach(function (c) { picks.push(c); });
    var rest = shuffle(cells.filter(function (c) { return picks.indexOf(c) < 0; }));
    for (var i = 0; i < rest.length && picks.length < n; i++) picks.push(rest[i]);
    picks.forEach(function (c) { c.revealed = true; });
    return picks.length;
  }

  function finalize(board, hintRatio) {
    var minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    board.cells.forEach(function (cell) {
      minR = Math.min(minR, cell.r); maxR = Math.max(maxR, cell.r);
      minC = Math.min(minC, cell.c); maxC = Math.max(maxC, cell.c);
    });
    var rows = maxR - minR + 1;
    var cols = maxC - minC + 1;

    // 先归一化到 0 起点
    board.cells.forEach(function (cell) { cell.r -= minR; cell.c -= minC; });
    board.words.forEach(function (w) { w.startR -= minR; w.startC -= minC; });

    // 竖着长的一条不适合屏幕，整体转 90°，让棋盘始终是"横的"
    if (rows > cols) {
      board.cells.forEach(function (cell) {
        var t = cell.r; cell.r = cell.c; cell.c = t;
      });
      board.words.forEach(function (w) {
        var t = w.startR; w.startR = w.startC; w.startC = t;
        w.dir = w.dir === 'h' ? 'v' : 'h';
      });
      var t2 = rows; rows = cols; cols = t2;
    }

    var grid = [];
    for (var r = 0; r < rows; r++) grid.push(new Array(cols).fill(null));
    var allCells = [];
    board.cells.forEach(function (cell) {
      grid[cell.r][cell.c] = cell;
      allCells.push(cell);
    });

    // 按"从上到下、从左到右"给单词编号，释义列表也跟着这个顺序，读起来更顺
    var words = board.words.slice().sort(function (a, b) {
      return a.startR - b.startR || a.startC - b.startC;
    });
    words.forEach(function (w, i) {
      w.num = i + 1;
      w.cells = w.cells.slice().sort(function (a, b) { return a.r - b.r || a.c - b.c; });
      w.row = w.startR + 1;
      w.col = w.startC + 1;
      w.len = w.lw.length;
      w.cellPos = w.cells.map(function (c) { return [c.r, c.c]; });
    });

    var hints = pickHints(allCells, hintRatio == null ? 0.15 : hintRatio);

    return {
      rows: rows,
      cols: cols,
      grid: grid,
      cells: allCells,
      words: words,
      letterCount: allCells.length,
      hintCount: hints,
      crossings: allCells.filter(function (c) { return c.words.length > 1; }).length
    };
  }

  /* ---------- 6. 对外接口 ---------- */
  /** 盘面质量打分：交点越多越"交错"，格子越少越紧凑，太狭长要扣分 */
  function layoutScore(board) {
    var crossings = 0;
    board.cells.forEach(function (c) { if (c.words.length > 1) crossings++; });
    var rows = board.maxR - board.minR + 1;
    var cols = board.maxC - board.minC + 1;
    var aspect = Math.max(rows, cols) / Math.max(1, Math.min(rows, cols));
    return crossings * 6 - board.cells.size * 0.5 - Math.max(0, aspect - 1.35) * 12;
  }

  function attemptBoard(usable, count) {
    var board = makeBoard();
    var picks = pickWords(usable, count);
    var left = fill(board, picks, count);
    if (left.length) {
      // 补位：从整个词库里继续找能塞下的词，凑满 count
      var rest = usable.filter(function (it) { return picks.indexOf(it) < 0; });
      fill(board, rest, count);
    }
    return board;
  }

  /**
   * 生成一局
   * @param {Array} pool  候选词条（来自 VOCAB.pools[levelId]）
   * @param {number} count 需要摆下的单词数
   * @param {number} hintRatio 提示字母比例
   */
  function generate(pool, count, hintRatio) {
    var usable = (pool || []).filter(function (it) { return /^[a-z]{3,10}$/.test(it.lw); });
    if (usable.length < 3) return null;
    count = Math.min(count || 10, usable.length);

    var bestFull = null;
    var bestFullScore = -Infinity;
    var bestPartial = null;
    var fullTries = 0;

    // 反复随机重排，收集若干"整盘摆满"的方案，挑交叉最密的那个
    for (var attempt = 0; attempt < 800; attempt++) {
      var board = attemptBoard(usable, count);
      if (board.words.length >= count) {
        var s = layoutScore(board);
        if (s > bestFullScore) { bestFullScore = s; bestFull = board; }
        if (++fullTries >= 60) break;
      } else if (!bestPartial || board.words.length > bestPartial.words.length) {
        bestPartial = board;
      }
    }
    var chosen = bestFull || bestPartial;
    if (!chosen || !chosen.words.length) return null;
    var puzzle = finalize(chosen, hintRatio);
    puzzle.quality = Math.round(bestFullScore * 100) / 100;
    return puzzle;
  }

  /** 自检：返回问题列表，空数组表示这盘是合法的 */
  function validate(puzzle) {
    var problems = [];
    if (!puzzle || !puzzle.words) return ['空棋盘'];

    puzzle.words.forEach(function (w) {
      var spelled = w.cells.map(function (c) { return c.ch; }).join('');
      if (spelled !== w.lw) problems.push(w.w + ' 排布字母为 ' + spelled);
      var rows = {}, cols = {};
      w.cells.forEach(function (c) { rows[c.r] = 1; cols[c.c] = 1; });
      if (Object.keys(rows).length > 1 && Object.keys(cols).length > 1) {
        problems.push(w.w + ' 不在同一直线上');
      }
      w.cells.forEach(function (c) {
        if (c.r < 0 || c.c < 0 || c.r >= puzzle.rows || c.c >= puzzle.cols) {
          problems.push(w.w + ' 有格子越界');
        }
        if (c.words.indexOf(w) < 0) problems.push(w.w + ' 的格子未登记该单词');
      });
    });

    for (var r = 0; r < puzzle.rows; r++) {
      for (var c = 0; c < puzzle.cols; c++) {
        var cell = puzzle.grid[r][c];
        if (!cell) continue;
        if (!cell.words.length) problems.push('(' + r + ',' + c + ') 有字母却不属于任何单词');
        cell.words.forEach(function (w) {
          var idx = w.dir === 'v' ? cell.r - w.startR : cell.c - w.startC;
          if (w.lw[idx] !== cell.ch) problems.push('(' + r + ',' + c + ') 与 ' + w.w + ' 冲突');
        });
        // 横向相邻的两个字母格必须属于同一个单词（否则是两个词并排紧贴）
        var right = c + 1 < puzzle.cols ? puzzle.grid[r][c + 1] : null;
        if (right) {
          var shared = cell.words.some(function (a) { return right.words.indexOf(a) >= 0; });
          if (!shared) problems.push('(' + r + ',' + c + ') 与其右侧出现无交点的紧贴');
        }
        var down = r + 1 < puzzle.rows ? puzzle.grid[r + 1][c] : null;
        if (down) {
          var shared2 = cell.words.some(function (a) { return down.words.indexOf(a) >= 0; });
          if (!shared2) problems.push('(' + r + ',' + c + ') 与其下方出现无交点的紧贴');
        }
      }
    }

    var hints = puzzle.cells.filter(function (c) { return c.revealed; }).length;
    if (hints < 2) problems.push('提示字母过少');
    return problems;
  }

  return {
    generate: generate,
    validate: validate,
    shuffle: shuffle,
    DIR_H: H,
    DIR_V: V
  };
})();
