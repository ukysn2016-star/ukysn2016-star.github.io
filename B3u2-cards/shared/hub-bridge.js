/* ==========================================================================
   hub-bridge.js — 跨卡共享层（U2 版）
   作用：让「生词卡」与「词组卡」共用同一份学生名单与"当前学生"，
        学生不必在两张卡里各填一次名字。
   原则：只同步「身份」，不碰各自的学习记录（记录仍按卡分开存放）。
   存储键：u2hub_* 共享；u2fc_* 生词卡；u2gb_p_* 词组卡
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
    LS.setItem('__u2hub_t', '1');
    LS.removeItem('__u2hub_t');
  } catch (e) { LS = null; }

  if (!LS) {
    window.Hub = { available: false, setRoster: function () {}, setCurrent: function () {}, students: [] };
    return;
  }

  var K_ROSTER = ['u2hub_students', 'u2fc_students', 'u2gb_p_students'];
  var K_CUR    = ['u2hub_current', 'u2fc_current', 'u2gb_p_current'];
  var MY_CUR   = CARD === 'phrases' ? 'u2gb_p_current' : (CARD === 'words' ? 'u2fc_current' : null);

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

  /* ---------- 1. 名单合并（三处取并集） ---------- */
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
      if (shared) { try { LS.setItem(MY_CUR, shared); } catch (e) {} }
    } else if (mine && !shared) {
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
      K_CUR.forEach(function (k) { try { LS.setItem(k, n); } catch (e) {} });
      window.Hub.current = n;
      /* 任何入口选过/输过的名字，都自动登记进共享名单 */
      if (n && (window.Hub.students || []).indexOf(n) < 0) {
        var next = norm((window.Hub.students || []).concat([n]));
        K_ROSTER.forEach(function (k) { putJSON(k, next); });
        window.Hub.students = next;
      }
    }
  };

  /* ---------- 4. 申请持久化存储 ---------- */
  try {
    if (navigator.storage && navigator.storage.persist) { navigator.storage.persist(); }
  } catch (e) {}
})();
