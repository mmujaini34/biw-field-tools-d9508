/* BIW Field Tools — time sheets shared between engineers' phones (v3.16.0)
   - The time sheet page queues a well's copy after every real edit; it goes up when there is internet
     (waits offline and retries when the connection is back).
   - The report asks the cloud by well code and keeps a local copy, so it also works offline later.
   - Copies live 3 days after their last edit (on the phone and in the cloud). */
(function (g) {
  'use strict';
  if (g.BIWTsShare) return;
  var FN = 'https://szomlyrlpznrdyewknec.supabase.co/functions/v1/biw-ts-share';
  var TOKEN = 'biw-fss-2026';
  var STORE = 'biw_ts_store', PENDING = 'biw_ts_share_pending', TTL = 3 * 86400000;
  var ENGINEERS = ['Mohammed Mujaini', 'Said Mujaini', 'Hamed Sadi', 'Mohammed Busaidi', 'Omar Al Husaini'];

  function wellKey(v) {
    var s = String(v || '').replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); })
      .replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); }).toUpperCase().replace(/[^A-Z0-9]/g, '');
    var m = s.match(/^([A-Z]+)0*([0-9].*)$/); return m ? m[1] + m[2] : s;
  }
  function getJSON(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function setJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function me() { var v = null; try { v = localStorage.getItem('biw_identity'); } catch (e) {} return ENGINEERS.indexOf(v) !== -1 ? v : null; }
  function post(action, body, ms) {
    var ctl = ('AbortController' in g) ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, ms || 8000) : null;
    return fetch(FN + '?a=' + action, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-app-token': TOKEN },
      body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined, cache: 'no-store'
    }).then(function (r) { if (t) clearTimeout(t); return r.json().then(function (j) { j.__status = r.status; return j; }); },
      function (e) { if (t) clearTimeout(t); throw e; });
  }

  /* ---------- رفع (من التايم شيت) ---------- */
  var timer = null, busy = false;
  function queue(key) {
    if (!key) return;
    var p = getJSON(PENDING, []); if (p.indexOf(key) === -1) { p.push(key); setJSON(PENDING, p); }
    clearTimeout(timer); timer = setTimeout(flush, 2500);
  }
  function flush() {
    if (busy) return Promise.resolve();
    var p = getJSON(PENDING, []); if (!p.length) return Promise.resolve();
    var who = me(); if (!who) return Promise.resolve();               /* ضيف: ما يرفع */
    if (g.navigator && navigator.onLine === false) return Promise.resolve();
    busy = true;
    var store = getJSON(STORE, {});
    var chain = Promise.resolve();
    p.slice().forEach(function (key) {
      chain = chain.then(function () {
        var e = store[key];
        var drop = function () { var q = getJSON(PENDING, []); var i = q.indexOf(key); if (i !== -1) { q.splice(i, 1); setJSON(PENDING, q); } };
        if (!e || !e.state || e.fromCloud || Date.now() - (e.savedAt || 0) > TTL) { drop(); return; }
        return post('put', { by: who, edited_at: e.savedAt, state: e.state }).then(function (j) {
          if (j && (j.ok || (j.__status >= 400 && j.__status < 500))) drop();   /* نجح، أو مرفوض نهائيًا */
        }, function () { /* بدون نت أو انقطع: يبقى بالطابور */ });
      });
    });
    return chain.then(function () { busy = false; }, function () { busy = false; });
  }
  g.addEventListener('online', function () { setTimeout(flush, 800); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') setTimeout(flush, 1200); });
  setTimeout(flush, 2000);

  /* ---------- قراءة (للتقرير) ---------- */
  function fetchCloud(key) {
    if (!key || (g.navigator && navigator.onLine === false)) return Promise.resolve(null);
    return post('get', { well_key: key }, 7000).then(function (j) {
      if (!j || !j.ok || !j.found || !j.state) return null;
      if (Date.now() - (j.edited_at || 0) > TTL) return null;
      return { well: j.well || j.state.well || '', state: j.state, by: j.by || '', savedAt: j.edited_at, fromCloud: true };
    }, function () { return null; });
  }
  /* يجيب الأحدث بين نسخة الجهاز ونسخة السحابة، ويحفظ نسخة السحابة بالجهاز (تشتغل بعدين بدون نت) */
  function lookup(key) {
    var store = getJSON(STORE, {}), local = store[key] || null;
    return fetchCloud(key).then(function (cloud) {
      if (cloud && (!local || (cloud.savedAt || 0) > (local.savedAt || 0) + 1000)) {
        var s = getJSON(STORE, {}); s[key] = cloud; setJSON(STORE, s);
        return cloud;
      }
      return local;
    });
  }

  g.BIWTsShare = { wellKey: wellKey, queue: queue, flush: flush, lookup: lookup, fetchCloud: fetchCloud, me: me };
})(window);
