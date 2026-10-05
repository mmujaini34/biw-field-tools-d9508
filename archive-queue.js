/* BIW Field Tools — offline upload queue.
   Shared by the pages and the service worker: generated PDFs wait here (IndexedDB)
   until there is a connection, then go up to the management archive. */
(function (g) {
  'use strict';
  var FN = 'https://szomlyrlpznrdyewknec.supabase.co/functions/v1/biw-archive';
  var TOKEN = 'biw-fss-2026';
  var DB = 'biw-archive', STORE = 'queue';

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req;
      try { req = g.indexedDB.open(DB, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('idb blocked')); };
    });
  }

  function run(mode, work) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx, req;
        try { tx = db.transaction(STORE, mode); req = work(tx.objectStore(STORE)); }
        catch (e) { db.close(); reject(e); return; }
        tx.oncomplete = function () { var out = req ? req.result : undefined; db.close(); resolve(out); };
        tx.onerror = tx.onabort = function () { var err = tx.error; db.close(); reject(err || new Error('idb failed')); };
      });
    });
  }

  function put(item) { return run('readwrite', function (s) { return s.put(item); }); }
  function del(id) { return run('readwrite', function (s) { return s.delete(id); }); }
  function all() { return run('readonly', function (s) { return s.getAll(); }).then(function (r) { return r || []; }); }
  function count() { return run('readonly', function (s) { return s.count(); }).then(function (n) { return n || 0; }); }

  function b64url(text) {
    var bytes = new TextEncoder().encode(text), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function sendOne(item) {
    return fetch(FN + '?a=upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf', 'x-app-token': TOKEN, 'x-biw-meta': b64url(JSON.stringify(item.meta)) },
      body: item.data
    }).then(function (res) {
      if (res.ok) return del(item.id).then(function () { return true; });
      /* مرفوض نهائيًا من السيرفر (بيانات غلط / حجم): نحاول كم مرة ثم نشيله عشان ما يعلق الطابور */
      if (res.status === 400 || res.status === 413 || res.status === 415) {
        item.tries = (item.tries || 0) + 1;
        if (item.tries >= 5) return del(item.id).then(function () { return true; });
        return put(item).then(function () { return false; });
      }
      return false;
    }, function () { return false; });
  }

  var running = null;
  /* يرجّع عدد الملفات اللي باقي ما ارتفعت */
  function flush() {
    if (running) return running;
    running = all().then(function (items) {
      var left = 0;
      return items.reduce(function (chain, item) {
        return chain.then(function () { return sendOne(item); }).then(function (done) { if (!done) left++; });
      }, Promise.resolve()).then(function () { return left; });
    }).then(function (left) { running = null; return left; }, function () { running = null; return -1; });
    return running;
  }

  g.BIWQueue = { put: put, del: del, all: all, count: count, flush: flush, url: FN, token: TOKEN };
})(self);
