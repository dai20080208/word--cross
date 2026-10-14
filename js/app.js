/* 主逻辑：页面切换、棋盘渲染与输入、检查答案、词汇查阅、生词本 */
(function () {
  'use strict';

  /* ================= 小工具 ================= */
  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  var actx = null;
  function beep(freq, dur, type) {
    if (!WordBook.getStats().sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var o = actx.createOscillator();
      var g = actx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      var t = actx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.15, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(t); o.stop(t + dur + 0.03);
    } catch (e) { /* 忽略音频异常 */ }
  }
  function fanfare() {
    [523, 659, 784, 1047].forEach(function (f, i) {
      setTimeout(function () { beep(f, 0.22, 'triangle'); }, i * 120);
    });
  }
  function speak(text) {
    if (!WordBook.getStats().sound) return;
    if (!window.speechSynthesis) return;
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.88;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { /* 部分浏览器不支持，静默跳过 */ }
  }

  /* ================= 全局状态 ================= */
  var DIFFS = [
    { id: 'easy', name: '简单', emoji: '🌱', ratio: 0.26, tip: '留 26% 提示字母 + 每个单词首字母' },
    { id: 'normal', name: '普通', emoji: '🌼', ratio: 0.15, tip: '留 15% 提示字母，推荐' },
    { id: 'hard', name: '挑战', emoji: '🔥', ratio: 0.08, tip: '只留 8% 提示字母，硬核玩家' }
  ];
  var COUNT = 10;

  var state = {
    screen: 'home',
    levelId: (VOCAB.levels[0] || {}).id,
    diffId: 'normal',
    puzzle: null,
    active: null,
    word: null,
    dir: 'h',
    hintsUsed: 0,
    viewed: 0,
    startTime: 0,
    timerId: null,
    finished: false,
    source: 'level',
    dictLevel: 'all',
    dictShown: 60
  };
  var els = {};      // "r,c" -> 格子 DOM
  var numMap = {};   // "r,c" -> 单词编号

  function diff() {
    return DIFFS.filter(function (d) { return d.id === state.diffId; })[0] || DIFFS[1];
  }
  function levelName(id) {
    var lv = VOCAB.levelById(id);
    return lv ? lv.name : '生词本';
  }
  function levelEmoji(id) {
    var lv = VOCAB.levelById(id);
    return lv ? lv.emoji : '📒';
  }

  /* ================= 页面切换 ================= */
  function show(screen) {
    state.screen = screen;
    $$('.screen').forEach(function (s) { s.classList.toggle('active', s.id === 'screen-' + screen); });
    $$('.tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-screen') === screen);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (screen === 'book') renderBook();
    if (screen === 'dict') renderDict();
    if (screen !== 'game') stopTimer();
  }

  /* ================= 首页 ================= */
  function renderLevels() {
    var box = $('#levelList');
    box.innerHTML = '';
    VOCAB.levels.forEach(function (lv) {
      var btn = document.createElement('button');
      btn.className = 'level-card' + (lv.id === state.levelId ? ' active' : '');
      btn.setAttribute('data-level', lv.id);
      btn.style.setProperty('--lv-color', lv.color);
      btn.innerHTML =
        '<span class="lv-emoji">' + lv.emoji + '</span>' +
        '<span class="lv-name">' + lv.name + '</span>' +
        '<span class="lv-desc">' + lv.desc + '</span>' +
        '<span class="lv-count">' + lv.words.length + ' 词</span>';
      box.appendChild(btn);
    });
  }

  function renderDiffs() {
    var box = $('#diffList');
    box.innerHTML = '';
    DIFFS.forEach(function (d) {
      var btn = document.createElement('button');
      btn.className = 'diff-card' + (d.id === state.diffId ? ' active' : '');
      btn.setAttribute('data-diff', d.id);
      btn.innerHTML =
        '<span class="df-emoji">' + d.emoji + '</span>' +
        '<span class="df-name">' + d.name + '</span>' +
        '<span class="df-tip">' + d.tip + '</span>';
      box.appendChild(btn);
    });
  }

  function renderBestLine() {
    var st = WordBook.getStats();
    var parts = [];
    DIFFS.forEach(function () {});
    VOCAB.levels.forEach(function (lv) {
      var t = WordBook.bestTime(lv.id);
      if (t) parts.push(lv.emoji + ' ' + lv.name + ' ' + fmtTime(t));
    });
    var txt = parts.length ? '🏆 我的最佳用时：' + parts.join('　') : '🏆 还没有记录，快去挑战一局吧！';
    txt += '　|　累计通关 ' + st.wins + ' 局';
    $('#bestLine').textContent = txt;
  }

  function fmtTime(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ================= 生成新一局 ================= */
  function startGame(source) {
    var pool;
    state.source = source || 'level';
    if (state.source === 'book') {
      pool = WordBook.all().map(function (it) {
        return { w: it.w, lw: it.lw, p: it.p, c: it.c, levels: ['生词本'], levelIds: ['book'] };
      }).filter(function (it) { return /^[a-z]{3,10}$/.test(it.lw); });
      // 生词本里可能有很多长单词，顺便去重
      var seen = {};
      pool = pool.filter(function (it) {
        if (seen[it.lw]) return false;
        seen[it.lw] = 1;
        return true;
      });
      if (pool.length < 10) {
        toast('生词本里够不上棋盘的单词还不到 10 个（当前 ' + pool.length + ' 个），先按当前阶段出题啦');
        state.source = 'level';
        pool = null;
      }
    }
    if (!pool) pool = VOCAB.pools[state.levelId];

    var puzzle = Crossword.generate(pool, COUNT, diff().ratio);
    if (!puzzle) { toast('这一个阶段暂时凑不出棋盘，换个阶段试试～'); return; }

    // 简单模式：额外把每个单词的首字母送给玩家
    if (state.diffId === 'easy') {
      puzzle.words.forEach(function (w) {
        var first = w.cells[0];
        if (!first.revealed) { first.revealed = true; puzzle.hintCount++; }
      });
    }

    state.puzzle = puzzle;
    state.active = null;
    state.word = null;
    state.dir = 'h';
    state.hintsUsed = 0;
    state.viewed = 0;
    state.finished = false;
    state.startTime = Date.now();

    $('#gameLevel').textContent = state.source === 'book' ? '生词本出题' : levelName(state.levelId);
    $('#gameDiff').textContent = diff().emoji + ' ' + diff().name;
    $('#clueCount').textContent = puzzle.words.length;
    $('#totalCount').textContent = puzzle.letterCount;

    // 先切到游戏页，棋盘才有真实宽度可以量（fitBoard 依赖可见时的宽度）
    show('game');
    renderGrid();
    renderClues();
    updateProgress();
    startTimer();
    toast('本局提示字母 ' + puzzle.hintCount + ' 个，加油！');
  }

  function renderGrid() {
    var p = state.puzzle;
    var grid = $('#grid');
    grid.innerHTML = '';
    els = {};
    numMap = {};
    p.words.forEach(function (w) { numMap[w.startR + ',' + w.startC] = w.num; });

    var frag = document.createDocumentFragment();
    for (var r = 0; r < p.rows; r++) {
      for (var c = 0; c < p.cols; c++) {
        var cell = p.grid[r][c];
        var d = document.createElement('div');
        if (!cell) {
          d.className = 'cell gap';
        } else {
          d.className = 'cell';
          d.setAttribute('data-r', r);
          d.setAttribute('data-c', c);
          var ch = document.createElement('span');
          ch.className = 'ch';
          d.appendChild(ch);
          var num = numMap[r + ',' + c];
          if (num) {
            var b = document.createElement('i');
            b.className = 'num';
            b.textContent = num;
            d.appendChild(b);
          }
          els[r + ',' + c] = d;
        }
        frag.appendChild(d);
      }
    }
    grid.appendChild(frag);
    grid.style.setProperty('--cols', p.cols);
    fitBoard();
    paint();
  }

  /** 根据容器宽度算出格子大小，让棋盘尽量铺满又不用横向滚动 */
  function fitBoard() {
    var p = state.puzzle;
    if (!p) return;
    var wrap = document.querySelector('.board-scroll');
    if (!wrap) return;
    var gap = 4;
    var avail = wrap.clientWidth - 8;
    var size = Math.floor((avail - gap * (p.cols - 1)) / p.cols);
    size = Math.max(22, Math.min(48, size));
    var grid = $('#grid');
    // 16:10 左右的格子更好看
    grid.style.setProperty('--cell', size + 'px');
    grid.style.setProperty('--gap', gap + 'px');
    grid.classList.toggle('narrow', size < 30);
  }

  function paint() {
    var p = state.puzzle;
    if (!p) return;
    p.cells.forEach(function (cell) {
      var el = els[cell.r + ',' + cell.c];
      if (!el) return;
      var cls = 'cell';
      if (cell.revealed) cls += ' hint';
      else if (cell.hinted) cls += ' hinted';
      else if (cell.value) cls += ' filled';
      if (cell.state === 'ok') cls += ' ok';
      if (cell.state === 'bad') cls += ' bad';
      if (state.word && state.word.cells.indexOf(cell) >= 0) cls += ' inword';
      if (state.active === cell) cls += ' active';
      if (el.className !== cls) el.className = cls;

      var span = el.firstChild;
      // 未填且被"查看过释义"的格子，用淡淡的幽灵字母提示答案
      var isGhost = !cell.revealed && !cell.value && cell.ghost;
      span.className = isGhost ? 'ch ghost' : 'ch';
      var txt = '';
      if (cell.revealed) txt = cell.ch.toUpperCase();
      else if (cell.value) txt = cell.value;
      else if (isGhost) txt = cell.ch.toUpperCase();
      if (span.textContent !== txt) span.textContent = txt;
    });
  }

  function updateProgress() {
    var p = state.puzzle;
    if (!p) return;
    var filled = p.cells.filter(function (c) { return c.revealed || c.value; }).length;
    $('#filledCount').textContent = filled;
    $('#totalCount').textContent = p.letterCount;
  }

  /* ================= 选格子 / 输入 ================= */
  function selectCell(cell, preferWord) {
    if (!cell || !cell.words.length) return;
    if (preferWord && cell.words.indexOf(preferWord) >= 0) {
      state.word = preferWord;
    } else {
      var same = cell.words.filter(function (w) { return w.dir === state.dir; });
      state.word = same[0] || cell.words[0];
    }
    state.dir = state.word.dir;
    state.active = cell;
    paint();
    highlightClue(state.word.num);
  }

  function onCellClick(cell) {
    if (state.active === cell) {
      var other = cell.words.filter(function (w) { return w !== state.word; });
      if (other.length) { selectCell(cell, other[0]); return; }
    }
    selectCell(cell);
    focusKeyboard();
  }

  function advance() {
    var w = state.word;
    if (!w) return;
    var idx = w.cells.indexOf(state.active);
    if (idx < 0) return;
    if (idx < w.cells.length - 1) {
      state.active = w.cells[idx + 1];
    }
    paint();
    updateProgress();
    autoCheck();
  }

  function stepBack() {
    var w = state.word;
    if (!w) return;
    var idx = w.cells.indexOf(state.active);
    if (idx > 0) state.active = w.cells[idx - 1];
    paint();
  }

  function typeLetter(ch) {
    if (!state.active) {
      var first = state.puzzle.cells.filter(function (c) { return !c.revealed && !c.value; })[0];
      if (!first) return;
      selectCell(first);
    }
    var cell = state.active;
    if (cell.revealed) { advance(); return; }
    cell.value = ch.toUpperCase();
    cell.state = '';
    cell.ghost = false;
    cell.hinted = false;
    beep(620 + Math.random() * 60, 0.05, 'square');
    advance();
  }

  function moveArrow(dr, dc) {
    if (!state.active) return;
    var wantDir = dc !== 0 ? 'h' : 'v';
    var p = state.puzzle;
    var r = state.active.r + dr;
    var c = state.active.c + dc;
    var cell = (r >= 0 && r < p.rows && c >= 0 && c < p.cols) ? p.grid[r][c] : null;
    // 沿着一条空白带一直找到有字母的格子
    while (!cell && r >= 0 && r < p.rows && c >= 0 && c < p.cols) {
      r += dr; c += dc;
      cell = (r >= 0 && r < p.rows && c >= 0 && c < p.cols) ? p.grid[r][c] : null;
    }
    if (!cell) return;
    var w = cell.words.filter(function (x) { return x.dir === wantDir; })[0];
    selectCell(cell, w || null);
  }

  function nextWord() {
    var p = state.puzzle;
    if (!p) return;
    var idx = state.word ? p.words.indexOf(state.word) : -1;
    var next = p.words[(idx + 1) % p.words.length];
    var target = next.cells.filter(function (c) { return !c.revealed && !c.value; })[0] || next.cells[0];
    selectCell(target, next);
    highlightClue(next.num);
  }

  /* ================= 检查 / 提示 / 清空 ================= */
  function checkAnswers(silent) {
    var p = state.puzzle;
    if (!p || state.finished) return;
    var ok = 0, bad = 0, empty = 0;
    p.cells.forEach(function (cell) {
      if (cell.revealed) { cell.state = 'ok'; ok++; return; }
      var v = (cell.value || '').trim();
      if (!v) { cell.state = ''; empty++; return; }
      if (v === cell.ch.toUpperCase()) { cell.state = 'ok'; ok++; }
      else { cell.state = 'bad'; bad++; }
    });
    paint();
    if (bad === 0 && empty === 0) { win(); return; }
    if (silent) return;
    if (bad > 0) {
      beep(190, 0.2, 'sawtooth');
      toast('有 ' + bad + ' 个字母还不太对，再看看释义 👀');
    } else {
      beep(300, 0.12, 'triangle');
      toast('还剩 ' + empty + ' 个格子没填哦～');
    }
  }

  function autoCheck() {
    var p = state.puzzle;
    if (!p) return;
    var allFilled = p.cells.every(function (c) { return c.revealed || c.value; });
    if (allFilled) checkAnswers(true);
  }

  function useHint() {
    var p = state.puzzle;
    if (!p || state.finished) return;
    var target = null;
    var w = state.word;
    if (w) {
      target = w.cells.filter(function (c) {
        return !c.revealed && (!c.value || c.value !== c.ch.toUpperCase());
      })[0];
    }
    if (!target) {
      target = p.cells.filter(function (c) {
        return !c.revealed && (!c.value || c.value !== c.ch.toUpperCase());
      })[0];
    }
    if (!target) { toast('棋盘已经填满啦，点「检查答案」看看对不对～'); return; }
    target.value = target.ch.toUpperCase();
    target.state = 'ok';
    target.hinted = true;
    target.ghost = false;
    state.hintsUsed++;
    beep(880, 0.1, 'sine');
    selectCell(target, w || null);
    paint();
    updateProgress();
    autoCheck();
  }

  function clearBoard() {
    var p = state.puzzle;
    if (!p) return;
    p.cells.forEach(function (c) {
      if (c.revealed) return;
      c.value = '';
      c.state = '';
      c.hinted = false;
      c.ghost = false;
    });
    state.finished = false;
    paint();
    updateProgress();
    toast('已清空，重新来过～');
  }

  /* ================= 计时 ================= */
  function startTimer() {
    stopTimer();
    state.timerId = setInterval(function () {
      $('#gameTimer').textContent = fmtTime(elapsed());
    }, 500);
    $('#gameTimer').textContent = fmtTime(0);
  }
  function stopTimer() {
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
  }
  function elapsed() {
    return Math.max(0, Math.round((Date.now() - state.startTime) / 1000));
  }

  /* ================= 过关 ================= */
  function win() {
    state.finished = true;
    stopTimer();
    var sec = elapsed();
    var isNew = WordBook.setBestTime(state.source === 'book' ? 'book' : state.levelId, sec);
    WordBook.addStat('played');
    WordBook.addStat('wins');
    fanfare();
    var p = state.puzzle;
    var totalLetters = p.cells.filter(function (c) { return !c.revealed; }).length;
    var stars = state.hintsUsed + state.viewed === 0 ? '⭐⭐⭐'
      : (state.hintsUsed + state.viewed <= 3 ? '⭐⭐' : '⭐');

    var body =
      '<div class="win-grid">' +
      '<div class="win-item"><span>用时</span><b>' + fmtTime(sec) + '</b></div>' +
      '<div class="win-item"><span>单词</span><b>' + p.words.length + ' 个</b></div>' +
      '<div class="win-item"><span>填空</span><b>' + totalLetters + ' 格</b></div>' +
      '<div class="win-item"><span>提示</span><b>' + state.hintsUsed + ' 次</b></div>' +
      '<div class="win-item"><span>查看释义</span><b>' + state.viewed + ' 次</b></div>' +
      '<div class="win-item"><span>评级</span><b>' + stars + '</b></div>' +
      '</div>' +
      (isNew ? '<p class="win-new">🎊 新纪录！这是你在该阶段的最快一局</p>' : '') +
      '<p class="win-tip">本局单词：' + p.words.map(function (w) {
        return '<b>' + w.w + '</b>';
      }).join('、') + '</p>';

    openModal('🎉', '恭喜过关！', body, [
      { text: '🔄 再来一局', cls: 'btn-primary', action: function () { closeModal(); startGame(state.source); } },
      { text: '📒 看生词本', cls: '', action: function () { closeModal(); show('book'); } },
      { text: '🏠 回首页', cls: 'btn-ghost', action: function () { closeModal(); show('home'); } }
    ]);
    renderBestLine();
    updateBookBadge();
  }

  /* ================= 弹窗 ================= */
  function openModal(emoji, title, bodyHtml, actions) {
    $('#modalEmoji').textContent = emoji;
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHtml;
    var box = $('#modalActions');
    box.innerHTML = '';
    (actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.className = 'btn ' + (a.cls || '');
      b.textContent = a.text;
      b.addEventListener('click', a.action);
      box.appendChild(b);
    });
    $('#modal').classList.remove('hidden');
  }
  function closeModal() { $('#modal').classList.add('hidden'); }

  /* ================= 释义列表 ================= */
  function renderClues() {
    var p = state.puzzle;
    var ol = $('#clueList');
    ol.innerHTML = '';
    p.words.forEach(function (w) {
      var li = document.createElement('li');
      li.className = 'clue' + (w.revealedByPlayer ? ' seen' : '');
      li.setAttribute('data-num', w.num);
      var dirTxt = w.dir === 'h' ? '横向' : '纵向';
      li.innerHTML =
        '<span class="clue-num">' + w.num + '</span>' +
        '<span class="clue-body">' +
          '<span class="clue-meta">' + dirTxt + ' · ' + w.len + ' 个字母' +
            '<span class="clue-pos">' + w.p + '</span></span>' +
          '<span class="clue-cn">' + w.c + '</span>' +
          '<span class="clue-word">' + (w.revealedByPlayer ? w.w : '') +
            (w.revealedByPlayer ? '<button class="icon-btn" data-speak="' + w.w + '" title="朗读">🔊</button>' : '') +
          '</span>' +
        '</span>' +
        '<button class="clue-btn">' + (w.revealedByPlayer ? '✓ 已查看' : '👁 查看') + '</button>';
      ol.appendChild(li);
    });
  }

  function highlightClue(num) {
    $$('#clueList .clue').forEach(function (li) {
      li.classList.toggle('hi', Number(li.getAttribute('data-num')) === num);
    });
  }

  function revealWordByNum(num) {
    var w = state.puzzle.words.filter(function (x) { return x.num === num; })[0];
    if (!w) return;
    var isNew = !w.revealedByPlayer;
    if (isNew) { w.revealedByPlayer = true; state.viewed++; }
    w.cells.forEach(function (c) {
      if (!c.revealed && (!c.value || c.value !== c.ch.toUpperCase())) c.ghost = true;
    });
    var added = WordBook.add({ w: w.w, p: w.p, c: w.c, levels: ['生词本'].concat(w.levels || []) });
    if (isNew) {
      toast(added ? '「' + w.w + '」已收进生词本 📒' : '「' + w.w + '」已在生词本里 📒');
    } else {
      toast('「' + w.w + '」' + (added ? '已收进生词本 📒' : '已在生词本里 📒'));
    }
    speak(w.w);
    renderClues();
    highlightClue(num);
    paint();
    updateBookBadge();
  }

  /* ================= 词汇查阅 ================= */
  function renderDictLevels() {
    var box = $('#dictLevels');
    box.innerHTML = '';
    var opts = [{ id: 'all', name: '全部', emoji: '🌈' }].concat(VOCAB.levels);
    opts.forEach(function (lv) {
      var b = document.createElement('button');
      b.className = 'chip-btn' + (state.dictLevel === lv.id ? ' active' : '');
      b.setAttribute('data-level', lv.id);
      b.textContent = lv.emoji + ' ' + lv.name;
      box.appendChild(b);
    });
  }

  function renderDict() {
    renderDictLevels();
    var q = $('#dictInput').value;
    var list = VOCAB.search(q, state.dictLevel);
    var lvName = state.dictLevel === 'all' ? '全部阶段' : levelName(state.dictLevel);
    $('#dictCount').textContent =
      '共找到 ' + list.length + ' 个词条（' + lvName + '）' +
      (q ? '，关键词「' + q + '」' : '') +
      (list.length > state.dictShown ? '，当前显示前 ' + state.dictShown + ' 个' : '');
    var show = list.slice(0, state.dictShown);
    $('#dictList').innerHTML = show.map(wordCard).join('');
    $('#dictMore').classList.toggle('hidden', list.length <= state.dictShown);
  }

  function wordCard(it) {
    var inBook = WordBook.has(it.w);
    var levels = (it.levels || []).map(function (n) { return '<span class="wc-level">' + n + '</span>'; }).join('');
    return '' +
      '<div class="word-card' + (inBook ? ' in-book' : '') + '">' +
        '<div class="wc-left">' +
          '<div class="wc-head">' +
            '<b class="wc-word">' + it.w + '</b>' +
            '<button class="icon-btn" data-speak="' + it.w + '" title="朗读">🔊</button>' +
            '<span class="wc-pos">' + it.p + '</span>' +
          '</div>' +
          '<div class="wc-cn">' + it.c + '</div>' +
          '<div class="wc-levels">' + levels + '</div>' +
        '</div>' +
        '<button class="btn btn-sm ' + (inBook ? 'btn-ghost' : '') + '" data-add="' + it.w + '">' +
          (inBook ? '✓ 已收藏' : '＋ 生词本') +
        '</button>' +
      '</div>';
  }

  function quickAdd(wordText) {
    var it = VOCAB.map.get(String(wordText).toLowerCase());
    if (!it) return;
    var added = WordBook.add(it);
    toast(added ? '已把「' + it.w + '」收进生词本 📒' : '「' + it.w + '」已经在生词本里啦');
    updateBookBadge();
    if (state.screen === 'dict') renderDict();
    if (state.screen === 'book') renderBook();
  }

  /* ================= 生词本 ================= */
  function renderBook() {
    var items = WordBook.all();
    var usable = items.filter(function (it) { return /^[a-z]{3,10}$/.test(it.lw); }).length;
    $('#bookTip').textContent = items.length
      ? '共 ' + items.length + ' 个词（其中 ' + usable + ' 个可以直接出题）'
      : '点释义查看过的单词会自动收进来';
    $('#bookList').innerHTML = items.length
      ? items.map(function (it) {
          var levels = (it.levels || []).map(function (n) { return '<span class="wc-level">' + n + '</span>'; }).join('');
          return '' +
            '<div class="word-card in-book">' +
              '<div class="wc-left">' +
                '<div class="wc-head">' +
                  '<b class="wc-word">' + it.w + '</b>' +
                  '<button class="icon-btn" data-speak="' + it.w + '" title="朗读">🔊</button>' +
                  '<span class="wc-pos">' + it.p + '</span>' +
                '</div>' +
                '<div class="wc-cn">' + it.c + '</div>' +
                '<div class="wc-levels">' + levels + '</div>' +
              '</div>' +
              '<button class="btn btn-sm btn-ghost" data-remove="' + it.lw + '">🗑 移除</button>' +
            '</div>';
        }).join('')
      : '<div class="empty-box">📒 生词本还是空的。<br />在游戏里点一下释义，或者在「词汇查阅」里点「＋ 生词本」，单词就会存到这里。</div>';
    updateBookBadge();
  }

  function updateBookBadge() {
    var n = WordBook.count();
    var b = $('#bookBadge');
    b.textContent = n;
    b.classList.toggle('zero', n === 0);
  }

  function downloadCsv() {
    if (!WordBook.count()) { toast('生词本是空的，先收藏几个单词吧～'); return; }
    var blob = new Blob([WordBook.exportCsv()], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'my-words.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('已导出 my-words.csv');
  }

  /* ================= 手机键盘输入 ================= */
  function focusKeyboard() {
    var kb = $('#kbInput');
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) {
      try { kb.focus(); } catch (e) {}
    }
  }

  /* ================= 事件绑定 ================= */
  function bind() {
    // 顶部导航
    $$('[data-screen]').forEach(function (el) {
      if (el.classList.contains('screen')) return;
      el.addEventListener('click', function () { show(el.getAttribute('data-screen')); });
    });

    // 首页：选阶段 / 选难度
    $('#levelList').addEventListener('click', function (e) {
      var card = e.target.closest('.level-card');
      if (!card) return;
      state.levelId = card.getAttribute('data-level');
      renderLevels();
      beep(700, 0.06, 'square');
    });
    $('#diffList').addEventListener('click', function (e) {
      var card = e.target.closest('.diff-card');
      if (!card) return;
      state.diffId = card.getAttribute('data-diff');
      renderDiffs();
      beep(760, 0.06, 'square');
    });
    $('#btnStart').addEventListener('click', function () { startGame('level'); });
    $('#btnStartBook').addEventListener('click', function () {
      if (!WordBook.count()) { toast('生词本还是空的，先去收藏几个单词吧～'); show('book'); return; }
      startGame('book');
    });

    // 游戏页
    $('#btnCheck').addEventListener('click', function () { checkAnswers(false); });
    $('#btnHint').addEventListener('click', useHint);
    $('#btnClear').addEventListener('click', clearBoard);
    $('#btnNew').addEventListener('click', function () { startGame(state.source); });

    $('#grid').addEventListener('click', function (e) {
      var d = e.target.closest('.cell');
      if (!d || d.classList.contains('gap')) return;
      var r = Number(d.getAttribute('data-r'));
      var c = Number(d.getAttribute('data-c'));
      var cell = state.puzzle.grid[r][c];
      if (cell) onCellClick(cell);
    });

    // 释义列表：点「查看」查看单词并收入生词本；悬停高亮
    $('#clueList').addEventListener('click', function (e) {
      var li = e.target.closest('.clue');
      if (!li) return;
      var num = Number(li.getAttribute('data-num'));
      if (e.target.closest('[data-speak]')) {
        speak(e.target.closest('[data-speak]').getAttribute('data-speak'));
        return;
      }
      revealWordByNum(num);
    });
    $('#clueList').addEventListener('mouseover', function (e) {
      var li = e.target.closest('.clue');
      if (li) highlightClue(Number(li.getAttribute('data-num')));
    });

    // 弹窗关闭
    $('#modal').addEventListener('click', function (e) {
      if (e.target.id === 'modal') closeModal();
    });

    // 词汇查阅
    var dictTimer = null;
    $('#dictInput').addEventListener('input', function () {
      clearTimeout(dictTimer);
      dictTimer = setTimeout(function () { state.dictShown = 60; renderDict(); }, 160);
    });
    $('#dictClear').addEventListener('click', function () {
      $('#dictInput').value = '';
      state.dictShown = 60;
      renderDict();
      $('#dictInput').focus();
    });
    $('#dictLevels').addEventListener('click', function (e) {
      var b = e.target.closest('.chip-btn');
      if (!b) return;
      state.dictLevel = b.getAttribute('data-level');
      state.dictShown = 60;
      renderDict();
    });
    $('#dictMore').addEventListener('click', function () {
      state.dictShown += 120;
      renderDict();
    });

    // 列表里的朗读 / 收藏 / 移除（事件委托，两个列表共用）
    document.addEventListener('click', function (e) {
      var sp = e.target.closest('[data-speak]');
      if (sp && !e.target.closest('#clueList')) { speak(sp.getAttribute('data-speak')); return; }
      var ad = e.target.closest('[data-add]');
      if (ad) { quickAdd(ad.getAttribute('data-add')); return; }
      var rm = e.target.closest('[data-remove]');
      if (rm) {
        WordBook.remove(rm.getAttribute('data-remove'));
        toast('已从生词本移除');
        renderBook();
      }
    });

    // 生词本工具
    $('#bookPlay').addEventListener('click', function () {
      if (WordBook.count() < 3) { toast('生词本里的单词太少啦，先去收藏几个～'); return; }
      startGame('book');
    });
    $('#bookExport').addEventListener('click', downloadCsv);
    $('#bookClear').addEventListener('click', function () {
      if (!WordBook.count()) { toast('生词本本来就是空的～'); return; }
      openModal('🗑', '确定清空生词本？', '<p class="win-tip">会删掉全部 ' + WordBook.count() + ' 个收藏单词，此操作不可撤销。</p>', [
        { text: '确定清空', cls: '', action: function () { WordBook.clear(); closeModal(); renderBook(); toast('生词本已清空'); } },
        { text: '再想想', cls: 'btn-ghost', action: closeModal }
      ]);
    });

    // 音效开关
    $('#btnSound').addEventListener('click', function () {
      var on = !WordBook.getStats().sound;
      WordBook.setSound(on);
      updateSoundBtn();
      if (on) beep(880, 0.1);
      toast(on ? '音效已打开 🔊' : '音效已关闭 🔇');
    });

    // 键盘
    document.addEventListener('keydown', function (e) {
      if (state.screen !== 'game' || !state.puzzle) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (state.finished && e.key !== 'Enter') return;
      var k = e.key;
      if (/^[a-zA-Z]$/.test(k)) { typeLetter(k); e.preventDefault(); return; }
      if (k === 'Backspace') {
        if (state.active && !state.active.revealed) {
          if (state.active.value) {
            state.active.value = '';
            state.active.state = '';
            state.active.hinted = false;
          } else {
            stepBack();
            if (state.active && !state.active.revealed) {
              state.active.value = '';
              state.active.state = '';
              state.active.hinted = false;
            }
          }
          paint(); updateProgress();
        }
        e.preventDefault();
        return;
      }      if (k === 'ArrowLeft') { moveArrow(0, -1); e.preventDefault(); return; }
      if (k === 'ArrowRight') { moveArrow(0, 1); e.preventDefault(); return; }
      if (k === 'ArrowUp') { moveArrow(-1, 0); e.preventDefault(); return; }
      if (k === 'ArrowDown') { moveArrow(1, 0); e.preventDefault(); return; }
      if (k === 'Tab') { nextWord(); e.preventDefault(); return; }
      if (k === 'Enter') { checkAnswers(false); e.preventDefault(); return; }
      if (k === 'Escape') { closeModal(); }
    });

    // 手机隐藏输入框
    $('#kbInput').addEventListener('input', function (e) {
      var v = e.target.value;
      if (!v) return;
      var last = v[v.length - 1];
      e.target.value = '';
      if (/[a-zA-Z]/.test(last)) typeLetter(last);
    });
    $('#kbInput').addEventListener('keydown', function (e) {
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (state.active && !state.active.revealed) {
          if (state.active.value) {
            state.active.value = '';
            state.active.state = '';
          } else {
            stepBack();
            if (state.active && !state.active.revealed) {
              state.active.value = '';
              state.active.state = '';
            }
          }
          paint(); updateProgress();
        }
      }
    });

    window.addEventListener('resize', function () {
      if (state.screen === 'game') fitBoard();
    });
  }

  function updateSoundBtn() {
    var on = WordBook.getStats().sound;
    $('#btnSound').innerHTML = '<i>' + (on ? '🔊' : '🔇') + '</i><span>音效</span>';
    $('#btnSound').classList.toggle('off', !on);
  }

  /* ================= 启动 ================= */
  function init() {
    if (!VOCAB.levels.length) {
      document.body.innerHTML = '<p style="padding:40px;font-size:18px">词库加载失败，请确认 js/data 目录下的文件都在。</p>';
      return;
    }
    state.levelId = VOCAB.levels[0].id;
    renderLevels();
    renderDiffs();
    renderBestLine();
    renderDict();
    renderBook();
    updateSoundBtn();
    bind();
    updateBookBadge();
    // 进度数字初始化
    $('#filledCount').textContent = '0';
    $('#totalCount').textContent = '0';

    // 支持用链接直达某个页面：#play 直接开一局，#dict / #book 打开对应页面
    var hash = (location.hash || '').replace(/^#/, '').toLowerCase();
    if (hash === 'play' || hash === 'game') startGame('level');
    else if (hash === 'dict' || hash === 'book') show(hash);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
