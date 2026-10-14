/* 生词本 + 战绩统计（全部存在浏览器 localStorage，不上传任何数据） */
window.WordBook = (function () {
  'use strict';

  var KEY = 'wordcross.book.v1';
  var STAT_KEY = 'wordcross.stats.v1';
  var items = [];
  var stats = { played: 0, wins: 0, best: {}, sound: true };

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* 隐私模式下写入会失败，忽略即可，不影响游戏 */
    }
  }

  items = read(KEY, []);
  if (!Array.isArray(items)) items = [];
  var saved = read(STAT_KEY, null);
  if (saved && typeof saved === 'object') {
    stats.played = saved.played || 0;
    stats.wins = saved.wins || 0;
    stats.best = saved.best || {};
    stats.sound = saved.sound !== false;
  }

  function saveBook() { write(KEY, items); }
  function saveStats() { write(STAT_KEY, stats); }

  function normalize(item) {
    var lw = String(item.w || '').toLowerCase();
    return {
      w: item.w,
      lw: lw,
      p: item.p || '',
      c: item.c || '',
      levels: item.levels || [],
      at: item.at || Date.now()
    };
  }

  function has(word) {
    var lw = String(word).toLowerCase();
    return items.some(function (it) { return it.lw === lw; });
  }

  function add(item) {
    var rec = normalize(item);
    if (!rec.lw || has(rec.lw)) return false;
    items.unshift(rec);
    saveBook();
    return true;
  }

  function remove(word) {
    var lw = String(word).toLowerCase();
    var n = items.length;
    items = items.filter(function (it) { return it.lw !== lw; });
    if (items.length !== n) { saveBook(); return true; }
    return false;
  }

  function clear() {
    items = [];
    saveBook();
  }

  function all() { return items; }
  function count() { return items.length; }

  function addStat(field, delta) {
    stats[field] = (stats[field] || 0) + (delta == null ? 1 : delta);
    saveStats();
  }

  function bestTime(levelId) { return stats.best[levelId] || 0; }
  function setBestTime(levelId, seconds) {
    var cur = stats.best[levelId] || 0;
    var isNew = !cur || seconds < cur;
    if (isNew) { stats.best[levelId] = seconds; saveStats(); }
    return isNew;
  }
  function getStats() { return stats; }
  function setSound(on) { stats.sound = !!on; saveStats(); }

  function exportCsv() {
    var lines = ['单词,词性,中文释义,所属阶段,加入时间'];
    items.forEach(function (it) {
      var row = [it.w, it.p, it.c, (it.levels || []).join('/'), new Date(it.at).toLocaleString()];
      lines.push(row.map(function (f) { return '"' + String(f).replace(/"/g, '""') + '"'; }).join(','));
    });
    return '\ufeff' + lines.join('\r\n');
  }

  return {
    add: add,
    remove: remove,
    clear: clear,
    has: has,
    all: all,
    count: count,
    exportCsv: exportCsv,
    addStat: addStat,
    getStats: getStats,
    bestTime: bestTime,
    setBestTime: setBestTime,
    setSound: setSound
  };
})();
