/* BIW Field Tools — device registration + PDF archive capture.
   - First launch on a device: pick your name once (or enter as guest).
   - Guest can browse but cannot generate any PDF.
   - Every generated PDF is queued on the device and uploaded when online. */
(function () {
  'use strict';
  if (window.BIWArchive) return;

  var ENGINEERS = ['Mohammed Mujaini', 'Said Mujaini', 'Hamed Sadi', 'Mohammed Busaidi'];
  var KEY = 'biw_identity';
  var GUEST = 'guest';
  var TOOLS = { 'timesheet': 1, 'empty-timesheet': 1, 'month-timesheet': 1, 'report': 1, 'checklist': 1, 'delivery-note': 1, 'expenses': 1 };
  var page = (location.pathname.split('/').pop() || 'index').replace(/\.html$/i, '') || 'index';
  var TOOL = TOOLS[page] ? page : null;
  var GEN_SELECTOR = '[onclick*="downloadPDF"],[onclick*="sharePDF"],[onclick*="previewPdf"],[onclick*="generateAndSharePdf"],[onclick*="savePdf"]';

  /* ---------- الهوية ---------- */
  function identity() {
    var v = null;
    try { v = localStorage.getItem(KEY); } catch (e) {}
    if (v === GUEST) return GUEST;
    return ENGINEERS.indexOf(v) !== -1 ? v : null;
  }
  function setIdentity(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function isEngineer() { var id = identity(); return !!id && id !== GUEST; }

  /* أسماء الفورمات مكتوبة بأكثر من شكل — نوحّدها على الأسماء الأربعة */
  function mapName(raw) {
    var s = String(raw || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    if (s.indexOf('busaidi') !== -1 || s === 'b mohammed') return 'Mohammed Busaidi';
    if (/\bsaid\b/.test(s)) return 'Said Mujaini';
    if (s.indexOf('hamed') !== -1) return 'Hamed Sadi';
    if (s.indexOf('mujaini') !== -1 || s === 'm mohammed') return 'Mohammed Mujaini';
    return null;
  }

  /* ---------- قراءة بيانات الفورم لحظة التوليد ---------- */
  function val(id) {
    var el = document.getElementById(id);
    if (!el) return '';
    var v = (typeof el.value === 'string') ? el.value : el.textContent;
    return String(v || '').trim();
  }
  function first(ids) {
    for (var i = 0; i < ids.length; i++) { var v = val(ids[i]); if (v) return v; }
    return '';
  }
  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + '-' + p(d.getMinutes());
  }
  function readMeta() {
    var me = identity();
    var raw = first(['outBiwEngineerName', 'fieldEngineerInput', 'engineerName', 'mName']);
    var names = [];
    raw.split(/[\n\r,;&\/]+/).forEach(function (part) {
      var n = mapName(part);
      if (n && names.indexOf(n) === -1) names.push(n);
    });
    if (!names.length) names.push(me);
    var well = first(['wellInput', 'wellNumber', 'outWell']).replace(/\s+/g, ' ');
    return {
      tool: TOOL,
      engineers: names,
      created_by: me,
      well: well,
      client: first(['clientInput', 'client', 'outClient']).replace(/\s+/g, ' '),
      doc_date: first(['outDate', 'outReportDate', 'reportDateInput', 'dateInput', 'jobDate', 'mMonth']).replace(/\s+/g, ' '),
      filename: (well ? well.replace(/[^A-Za-z0-9_-]+/g, '_') : TOOL) + '_' + stamp() + '.pdf'
    };
  }

  /* ---------- رقم ثابت لكل مستند: نفس الـ PDF مرتين = نسخة وحدة بالأرشيف ---------- */
  function hex(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;
  }
  function asUuid(h) {
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-8' + h.slice(17, 20) + '-' + h.slice(20, 32);
  }
  function contentEnd(bytes) {
    /* جزء المعلومات بآخر الملف (وقت الإنشاء + رقم عشوائي) يتغير كل مرة: نستثنيه من البصمة */
    var mark = [47, 67, 114, 101, 97, 116, 105, 111, 110, 68, 97, 116, 101]; /* "/CreationDate" */
    var stop = Math.max(0, bytes.length - 65536);
    for (var i = bytes.length - mark.length; i >= stop; i--) {
      var hit = true;
      for (var j = 0; j < mark.length; j++) { if (bytes[i + j] !== mark[j]) { hit = false; break; } }
      if (hit) return i;
    }
    return bytes.length;
  }
  function randomId() {
    var b = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(b);
    return asUuid(hex(b.buffer));
  }
  function docId(buf) {
    try {
      if (!window.crypto || !crypto.subtle) return Promise.resolve(randomId());
      var bytes = new Uint8Array(buf);
      return crypto.subtle.digest('SHA-256', bytes.subarray(0, contentEnd(bytes))).then(function (d) {
        return asUuid(hex(d));
      }, function () { return randomId(); });
    } catch (e) { return Promise.resolve(randomId()); }
  }
  function toBuffer(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsArrayBuffer(blob);
    });
  }

  /* ---------- الرفع ---------- */
  var flushTimer = null;
  function flushNow() {
    if (!window.BIWQueue) return;
    BIWQueue.count().then(function (n) {
      if (!n) return;
      /* أندرويد: يكمل الرفع بالخلفية حتى لو انقفل التطبيق */
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.ready) {
          navigator.serviceWorker.ready.then(function (reg) {
            if (reg && reg.sync && reg.sync.register) reg.sync.register('biw-archive-flush').catch(function () {});
          }).catch(function () {});
        }
      } catch (e) {}
      if (navigator.onLine !== false) BIWQueue.flush();
    }).catch(function () {});
  }
  function scheduleFlush(ms) {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(function () { flushTimer = null; flushNow(); }, ms);
  }

  /* ---------- الالتقاط ---------- */
  var last = null;         /* آخر مستند انحفظ بالطابور (ننتظر اسم الملف الحقيقي لحظات) */
  var held = null;         /* معاينة ما نزلت/انشاركت بعد (المصاريف + إثبات العمل) */
  var forceCommit = false;

  function commit(cap) {
    last = cap;
    toBuffer(cap.blob).then(function (buf) {
      return docId(buf).then(function (id) {
        cap.id = id; cap.buf = buf; cap.meta.id = id;
        return BIWQueue.put({ id: id, data: buf, meta: cap.meta, at: Date.now(), tries: 0 });
      });
    }).then(function () {
      cap.stored = true;
      cap.blob = null;
      scheduleFlush(1500);
    }).catch(function () {});
  }
  function rename(name) {
    name = String(name || '').trim();
    if (!name || !last || last.named || Date.now() - last.at > 20000) return;
    last.named = true;
    last.meta.filename = name;
    if (last.stored) {
      BIWQueue.put({ id: last.id, data: last.buf, meta: last.meta, at: Date.now(), tries: 0 }).catch(function () {});
    }
  }
  function capture(blob) {
    if (!TOOL || !window.BIWQueue || !isEngineer()) return;
    var cap = { blob: blob, meta: readMeta(), at: Date.now() };
    if (document.getElementById('pmodal') && !forceCommit) { held = cap; return; }
    forceCommit = false;
    commit(cap);
  }
  function commitHeld() {
    if (!held) return;
    var cap = held; held = null;
    var dl = document.getElementById('dlBtn');
    var nm = dl && dl.getAttribute('download');
    if (nm) { cap.meta.filename = nm; cap.named = true; }
    cap.at = Date.now();
    commit(cap);
  }

  function hookDoc(doc) {
    var orig = doc.output;
    if (typeof orig !== 'function') return;
    doc.output = function (type) {
      if (TOOL && !isEngineer()) throw new Error('Guest mode: register your name to generate PDFs.');
      var out = orig.apply(doc, arguments);
      try { if (type === 'blob' && out && typeof out.size === 'number') capture(out); } catch (e) {}
      return out;
    };
  }
  function wrapJsPDF() {
    var ns = window.jspdf;
    if (!ns || typeof ns.jsPDF !== 'function' || ns.jsPDF.__biw) return;
    var Orig = ns.jsPDF;
    var Wrapped = function () {
      var doc = Reflect.construct(Orig, arguments, Orig);
      try { hookDoc(doc); } catch (e) {}
      return doc;
    };
    Wrapped.prototype = Orig.prototype;
    Object.getOwnPropertyNames(Orig).forEach(function (k) {
      if (k === 'length' || k === 'name' || k === 'prototype' || k === 'arguments' || k === 'caller') return;
      try { Object.defineProperty(Wrapped, k, Object.getOwnPropertyDescriptor(Orig, k)); } catch (e) {}
    });
    Wrapped.__biw = true;
    try { ns.jsPDF = Wrapped; } catch (e) {}
    if (window.jsPDF === Orig) { try { window.jsPDF = Wrapped; } catch (e) {} }
  }
  try { wrapJsPDF(); } catch (e) {}

  /* اسم الملف الحقيقي: من زر التنزيل أو من المشاركة */
  try {
    if (navigator.share) {
      var origShare = navigator.share;
      navigator.share = function (data) {
        try { if (data && data.files && data.files[0] && data.files[0].name) rename(data.files[0].name); } catch (e) {}
        return origShare.apply(navigator, arguments);
      };
    }
  } catch (e) {}

  /* ---------- الواجهة: التسجيل + منع الضيف ---------- */
  var CSS = '' +
    '#biwId{position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483000;display:none;align-items:center;justify-content:center;' +
    'padding:18px;background:rgba(8,5,9,.82);-webkit-backdrop-filter:blur(7px);backdrop-filter:blur(7px);' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Tahoma,Arial,sans-serif;direction:rtl;text-align:center}' +
    '#biwId.on{display:-webkit-box;display:flex}' +
    '#biwId .bx{width:100%;max-width:360px;max-height:92vh;overflow:auto;background:#17121a;border:1px solid rgba(255,196,106,.45);' +
    'border-radius:20px;padding:22px 18px 18px;box-shadow:0 22px 70px rgba(0,0,0,.65);color:#fff;box-sizing:border-box}' +
    '#biwId h2{margin:0 0 6px;font-size:19px;font-weight:800;color:#ffc46a}' +
    '#biwId p{margin:0 0 14px;font-size:13px;line-height:1.7;color:rgba(255,255,255,.78)}' +
    '#biwId button{display:block;width:100%;box-sizing:border-box;margin:8px 0 0;padding:14px 12px;border-radius:13px;font:inherit;font-size:15px;' +
    'font-weight:700;cursor:pointer;-webkit-appearance:none;appearance:none;-webkit-tap-highlight-color:transparent}' +
    '#biwId .nm{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.2);color:#fff;direction:ltr;letter-spacing:.3px}' +
    '#biwId .nm:active{background:rgba(255,196,106,.22);border-color:#ffc46a}' +
    '#biwId .go{background:#ffc46a;border:1px solid #ffc46a;color:#1a1208}' +
    '#biwId .gh{background:transparent;border:1px solid rgba(255,255,255,.16);color:rgba(255,255,255,.72);font-size:13.5px;font-weight:600}' +
    '#biwId .who{margin:4px 0 12px;padding:13px 10px;border-radius:13px;background:rgba(255,196,106,.12);border:1px solid rgba(255,196,106,.4);' +
    'font-size:17px;font-weight:800;color:#ffe0ad;direction:ltr}' +
    '#biwId .sm{margin:12px 0 0;font-size:11.5px;color:rgba(255,255,255,.5)}';
  var box = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }
  function ensureBox() {
    if (box) return box;
    var st = document.createElement('style');
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
    var wrap = el('div');
    wrap.id = 'biwId';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    box = el('div', 'bx');
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    return box;
  }
  function show() { ensureBox().parentNode.classList.add('on'); }
  function hide() { if (box) box.parentNode.classList.remove('on'); }
  function clear() { var b = ensureBox(); while (b.firstChild) b.removeChild(b.firstChild); return b; }

  function showPicker(allowGuest) {
    var b = clear();
    b.appendChild(el('h2', '', 'تسجيل الجهاز'));
    b.appendChild(el('p', '', 'اختر اسمك. التسجيل مرة واحدة فقط لهذا الجهاز.'));
    ENGINEERS.forEach(function (name) {
      var bt = el('button', 'nm', name);
      bt.type = 'button';
      bt.onclick = function () { showConfirm(name, allowGuest); };
      b.appendChild(bt);
    });
    if (allowGuest) {
      var g = el('button', 'gh', 'الدخول كضيف — Guest');
      g.type = 'button';
      g.onclick = function () { setIdentity(GUEST); hide(); };
      b.appendChild(g);
      b.appendChild(el('div', 'sm', 'الضيف يتصفح فقط وما يقدر يولّد أي ملف.'));
    } else {
      var c = el('button', 'gh', 'إلغاء');
      c.type = 'button';
      c.onclick = hide;
      b.appendChild(c);
    }
    show();
  }
  function showConfirm(name, allowGuest) {
    var b = clear();
    b.appendChild(el('h2', '', 'تأكيد الاسم'));
    b.appendChild(el('p', '', 'هذا الجهاز بيتسجل بهذا الاسم وما يتغير بعدين:'));
    b.appendChild(el('div', 'who', name));
    var ok = el('button', 'go', 'تأكيد');
    ok.type = 'button';
    ok.onclick = function () { setIdentity(name); hide(); scheduleFlush(800); };
    b.appendChild(ok);
    var back = el('button', 'gh', 'رجوع');
    back.type = 'button';
    back.onclick = function () { showPicker(allowGuest); };
    b.appendChild(back);
    show();
  }
  function showGuestBlock() {
    var b = clear();
    b.appendChild(el('h2', '', 'وضع الضيف'));
    b.appendChild(el('p', '', 'الضيف ما يقدر يولّد ملفات. سجّل اسمك عشان تكمل.'));
    var reg = el('button', 'go', 'تسجيل الاسم');
    reg.type = 'button';
    reg.onclick = function () { showPicker(false); };
    b.appendChild(reg);
    var c = el('button', 'gh', 'إغلاق');
    c.type = 'button';
    c.onclick = hide;
    b.appendChild(c);
    show();
  }

  function closest(node, selector) {
    while (node && node.nodeType === 1) {
      if ((node.matches || node.webkitMatchesSelector).call(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentNode);
    if (!t || (box && box.contains(t))) return;

    /* الضيف / غير المسجل: ممنوع التوليد */
    if (TOOL && !isEngineer() && closest(t, GEN_SELECTOR)) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      if (identity() === GUEST) showGuestBlock(); else showPicker(true);
      return;
    }
    if (!TOOL || !isEngineer()) return;

    /* المعاينة تنحسب مستند لما تنزل أو تنشارك */
    if (closest(t, '#dlBtn,#shareBtn')) { commitHeld(); return; }

    /* الطباعة: ما تطلع ملف من التطبيق، فناخذ نسخة PDF بعدها */
    if (closest(t, '[onclick*="savePdf"]')) {
      var done = false;
      var after = function () {
        if (done) return;
        done = true;
        window.removeEventListener('afterprint', after);
        var sheet = document.getElementById('sheet');
        if (sheet && typeof window.makePdf === 'function') {
          forceCommit = true;
          try { window.makePdf(sheet, function () {}, function () { forceCommit = false; }); } catch (err) { forceCommit = false; }
        }
      };
      window.addEventListener('afterprint', after);
      setTimeout(after, 8000);
      return;
    }

    var a = closest(t, 'a[download]');
    if (a) rename(a.getAttribute('download'));
  }, true);

  function start() {
    if (!identity()) showPicker(true);
    scheduleFlush(2500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.addEventListener('online', function () { scheduleFlush(600); });
  window.addEventListener('pageshow', function () { scheduleFlush(1500); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) scheduleFlush(1000); });
  setInterval(flushNow, 120000);

  window.BIWArchive = {
    engineers: ENGINEERS.slice(),
    identity: identity,
    reset: function () { try { localStorage.removeItem(KEY); } catch (e) {} },
    flush: flushNow
  };
})();
