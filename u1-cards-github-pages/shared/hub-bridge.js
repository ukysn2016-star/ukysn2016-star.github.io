/* ==========================================================================
   hub-bridge.js — 跨卡共享层（v1.0）
   作用：让「生词卡」与「词组卡」共用同一份学生名单与"当前学生"，
        避免学生在两张卡里各填一次名字、或换卡后进度看起来"丢了"。
   原则：只同步「身份」，不碰各自的学习记录（记录仍然按卡分开存放）。
   ========================================================================== */
(function () {
  'use strict';

  var me = document.currentScript || (function () {
    var ss = document.getElementsByTagName('script');
    for (var i = ss.length - 1; i >= 0; i--) { if (/hub-bridge\.js/.test(ss[i].src)) return ss[i]; }
    return null;
  })();
  var CARD = (me && me.getAttribute('data-card')) || '';   // 'words' | 'phrases' | ''

  var LS = null;
  try {
    LS = window.localStorage;
    LS.setItem('__u1hub_t', '1');
    LS.removeItem('__u1hub_t');
  } catch (e) { LS = null; }

  if (!LS) {
    window.Hub = { available: false, setRoster: function () {}, setCurrent: function () {}, students: [] };
    return;
  }

  var K_ROSTER = ['u1atw_hub_students', 'u1atw_students', 'u1atw_p_students'];
  var K_CUR    = ['u1atw_hub_current', 'u1atw_current', 'u1atw_p_current'];
  var MY_CUR   = CARD === 'phrases' ? 'u1atw_p_current' : (CARD === 'words' ? 'u1atw_current' : null);

  function getJSON(k, d) {
    try { var v = JSON.parse(LS.getItem(k)); return (v === null || v === undefined) ? d : v; }
    catch (e) { return d; }
  }
  function putJSON(k, v) { try { LS.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function norm(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (n) {
      n = (typeof n === 'string' ? n : '').trim().slice(0, 30);
      if (!n || seen[n]) return;
      seen[n] = 1; out.push(n);
    });
    return out;
  }

  /* ---------- 1. 名单合并（三处取并集，顺序：共享 > 生词卡 > 词组卡） ---------- */
  var merged = [];
  K_ROSTER.forEach(function (k) { merged = norm(merged.concat(getJSON(k, []))); });
  K_ROSTER.forEach(function (k) { putJSON(k, merged); });

  /* ---------- 2. 当前学生 ---------- */
  var shared = '';
  try { shared = LS.getItem(K_CUR[0]) || ''; } catch (e) {}

  if (MY_CUR) {
    var mine = null;
    try { mine = LS.getItem(MY_CUR); } catch (e) {}
    if (mine === null) {
      /* 本卡从未写过 current：跟随共享值，学生不必重填名字 */
      if (shared) { try { LS.setItem(MY_CUR, shared); } catch (e) {} }
    } else if (mine && !shared) {
      /* 本卡已有名字、共享值为空：把本卡的名字提升为共享值 */
      try { LS.setItem(K_CUR[0], mine); } catch (e) {}
      shared = mine;
    }
  }

  /* ---------- 3. 对外接口 ---------- */
  window.Hub = {
    available: true,
    students: merged,
    current: shared,
    setRoster: function (list) {
      var next = norm(list);
      K_ROSTER.forEach(function (k) { putJSON(k, next); });
      window.Hub.students = next;
    },
    setCurrent: function (n) {
      n = (n == null ? '' : String(n)).trim().slice(0, 30);
      try { LS.setItem(K_CUR[0], n); } catch (e) {}
      try { LS.setItem(K_CUR[1], n); } catch (e) {}
      try { LS.setItem(K_CUR[2], n); } catch (e) {}
      window.Hub.current = n;
    }
  };

  /* ---------- 4. 尽量申请持久化存储，降低被系统清理的概率 ---------- */
  try {
    if (navigator.storage && navigator.storage.persist) { navigator.storage.persist(); }
  } catch (e) {}
})();
