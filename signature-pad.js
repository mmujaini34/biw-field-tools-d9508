/* BIW Field Tools — optional ESP engineer signature (v3.16.0)
   - A button under the ESP engineer / receiver name opens a full white signing screen (phone or iPad).
   - The signature is trimmed to its ink, saved as a transparent PNG in the same navy ink as the
     engineers' signatures, and shown in the PDF signature spot with the same box styling.
   - The signature belongs to the name it was signed for: change the name and it is not printed.
   - Saved on this device only (localStorage), cleared with the tool's Reset. */
(function () {
  'use strict';
  if (window.BIWSign) return;

  var INK = 'rgb(31,45,110)';            /* نفس لون حبر تواقيع المهندسين تقريبًا */
  var EXPORT_H = 160;                    /* نفس ارتفاع صور تواقيع المهندسين */

  function norm(v) { return String(v || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function el(tag, css, html) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------------- شاشة التوقيع ---------------- */
  function open(opts) {
    opts = opts || {};
    var strokes = [], cur = null, drawing = false;
    var prevOverflow = document.documentElement.style.overflow, prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden'; document.body.style.overflow = 'hidden';

    /* الشاشة داخل Shadow DOM: كود الصفحة (مثل حفظ التقرير اللي ياخذ أول canvas) ما يشوفها، وستايلات الصفحة ما تأثر عليها */
    var hostEl = el('div', 'position:fixed;inset:0;z-index:2147483000');
    var root = hostEl.attachShadow ? hostEl.attachShadow({ mode: 'open' }) : hostEl;
    var ov = el('div', 'position:absolute;inset:0;background:#fff;display:flex;flex-direction:column;box-sizing:border-box;' +
      'font-family:-apple-system,"Segoe UI",Roboto,Tahoma,Arial,sans-serif;direction:rtl;touch-action:none;-webkit-user-select:none;user-select:none;' +
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)');
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    var head = el('div', 'flex:none;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;border-bottom:1px solid #e2e8f0');
    head.appendChild(el('div', 'min-width:0', '<div style="font-weight:900;font-size:17px;color:#0f172a">' + esc(opts.title || 'التوقيع') + '</div>' +
      (opts.name ? '<div style="font-size:14px;color:#334155;direction:ltr;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(opts.name) + '</div>' : '') +
      '<div style="font-size:12.5px;color:#64748b">وقّع بإصبعك أو بالقلم في المساحة البيضاء</div>'));
    var bCancel = el('button', 'flex:none;font:inherit;font-size:15px;font-weight:700;padding:10px 14px;border-radius:12px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;min-height:44px', 'إلغاء');
    bCancel.type = 'button'; head.appendChild(bCancel);

    var area = el('div', 'flex:1 1 auto;position:relative;min-height:0;background:#fff');
    var guide = el('div', 'position:absolute;left:8%;right:8%;top:64%;border-top:2px dashed #cbd5e1;pointer-events:none');
    var hint = el('div', 'position:absolute;left:0;right:0;top:40%;text-align:center;color:#cbd5e1;font-size:22px;font-weight:700;pointer-events:none', 'وقّع هنا');
    var cv = el('canvas', 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:crosshair');
    area.appendChild(guide); area.appendChild(hint); area.appendChild(cv);

    var foot = el('div', 'flex:none;display:flex;gap:10px;padding:10px 14px;border-top:1px solid #e2e8f0;background:#f8fafc');
    var bUndo = el('button', 'flex:1;font:inherit;font-size:15px;font-weight:700;padding:12px;border-radius:12px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;min-height:48px', 'تراجع');
    var bClear = el('button', 'flex:1;font:inherit;font-size:15px;font-weight:700;padding:12px;border-radius:12px;border:1px solid #fecaca;background:#fff;color:#b91c1c;min-height:48px', 'مسح');
    var bSave = el('button', 'flex:2;font:inherit;font-size:16px;font-weight:900;padding:12px;border-radius:12px;border:0;background:#0f766e;color:#fff;min-height:48px', 'حفظ التوقيع');
    [bUndo, bClear, bSave].forEach(function (b) { b.type = 'button'; foot.appendChild(b); });
    ov.appendChild(head); ov.appendChild(area); ov.appendChild(foot);
    root.appendChild(ov);
    document.body.appendChild(hostEl);

    var ctx = cv.getContext('2d'), dpr = 1;
    function lineW(p) { return Math.max(1.6, 3.4 - Math.min(p.v || 0, 2.2) * 0.75); }
    function seg(c, a, b, m0, m1, w) {            /* منحنى ناعم بين نقاط المنتصف */
      c.lineWidth = w; c.beginPath(); c.moveTo(m0.x, m0.y); c.quadraticCurveTo(a.x, a.y, m1.x, m1.y); c.stroke();
    }
    function drawStroke(c, s, k, ox, oy) {
      k = k || 1; ox = ox || 0; oy = oy || 0;
      var P = s.map(function (p) { return { x: (p.x - ox) * k, y: (p.y - oy) * k, v: p.v }; });
      c.strokeStyle = INK; c.fillStyle = INK; c.lineCap = 'round'; c.lineJoin = 'round';
      if (P.length === 1) { c.beginPath(); c.arc(P[0].x, P[0].y, lineW(P[0]) * k / 2, 0, Math.PI * 2); c.fill(); return; }
      var prevMid = P[0];
      for (var i = 1; i < P.length; i++) {
        var mid = { x: (P[i - 1].x + P[i].x) / 2, y: (P[i - 1].y + P[i].y) / 2 };
        seg(c, P[i - 1], P[i], prevMid, mid, lineW(P[i]) * k);
        prevMid = mid;
      }
      c.lineWidth = lineW(P[P.length - 1]) * k; c.beginPath(); c.moveTo(prevMid.x, prevMid.y); c.lineTo(P[P.length - 1].x, P[P.length - 1].y); c.stroke();
    }
    function redraw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
      strokes.forEach(function (s) { drawStroke(ctx, s); });
      var has = strokes.length > 0;
      hint.style.display = has ? 'none' : 'block';
      bSave.disabled = !has; bSave.style.opacity = has ? '1' : '.45';
      bUndo.disabled = !has; bClear.disabled = !has;
    }
    function fit() {
      var r = cv.getBoundingClientRect(); dpr = Math.max(1, window.devicePixelRatio || 1);
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); redraw();
    }
    function pt(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp || Date.now() }; }
    function addPoint(p) {
      var last = cur[cur.length - 1];
      if (last) {
        var d = Math.hypot(p.x - last.x, p.y - last.y); if (d < 0.6) return;
        var dt = Math.max(1, p.t - last.t); p.v = (last.v || 0) * 0.6 + (d / dt) * 0.4;
      }
      cur.push(p);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawStroke(ctx, cur.slice(-3));
    }
    cv.addEventListener('pointerdown', function (e) {
      e.preventDefault(); drawing = true; try { cv.setPointerCapture(e.pointerId); } catch (x) {}
      cur = [pt(e)]; strokes.push(cur); hint.style.display = 'none'; drawStroke(ctx, cur);
    });
    cv.addEventListener('pointermove', function (e) {
      if (!drawing) return; e.preventDefault();
      var list = (e.getCoalescedEvents && e.getCoalescedEvents()) || [e];
      if (!list.length) list = [e];
      list.forEach(function (ce) { addPoint(pt(ce)); });
    });
    function up(e) { if (!drawing) return; drawing = false; cur = null; redraw(); }
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('pointerleave', up);
    ov.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
    window.addEventListener('resize', fit);

    function exportPng() {
      var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      strokes.forEach(function (s) { s.forEach(function (p) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }); });
      var pad = 6, w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
      var k = Math.min(4, (EXPORT_H - pad * 2) / Math.max(h, 24));
      var out = document.createElement('canvas');
      out.width = Math.max(20, Math.round(w * k + pad * 2)); out.height = Math.max(20, Math.round(h * k + pad * 2));
      var c = out.getContext('2d');
      strokes.forEach(function (s) { drawStroke(c, s, k, minX - pad / k, minY - pad / k); });
      return out.toDataURL('image/png');
    }
    function close(result) {
      window.removeEventListener('resize', fit);
      document.documentElement.style.overflow = prevOverflow; document.body.style.overflow = prevBodyOverflow;
      hostEl.remove();
      if (typeof opts.onDone === 'function') opts.onDone(result);
    }
    bCancel.onclick = function () { close(null); };
    bUndo.onclick = function () { strokes.pop(); redraw(); };
    bClear.onclick = function () { strokes = []; redraw(); };
    bSave.onclick = function () { if (strokes.length) close(exportPng()); };
    requestAnimationFrame(fit);
  }

  /* ---------------- ربطه بأداة ---------------- */
  /* cfg: {tool, nameInputId, imgId, title, label, resetFns:[...]} */
  function attach(cfg) {
    var KEY = 'biw_sig_' + cfg.tool;
    var input = document.getElementById(cfg.nameInputId), img = document.getElementById(cfg.imgId);
    if (!input || !img) return;
    function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
    function save(v) { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) {} }

    var box = el('div', 'margin-top:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;direction:rtl');
    var btn = el('button', 'font:inherit;font-size:14px;font-weight:800;padding:10px 14px;border-radius:12px;border:1.5px solid #0f766e;background:#ecfdf5;color:#0b3b33;cursor:pointer;min-height:44px');
    btn.type = 'button';
    var thumb = el('div', 'display:none;width:150px;height:54px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;align-items:center;justify-content:center;padding:4px');
    var timg = el('img', 'max-width:100%;max-height:100%;object-fit:contain;display:block'); timg.alt = '';
    thumb.appendChild(timg);
    var del = el('button', 'display:none;font:inherit;font-size:13px;font-weight:700;padding:8px 12px;border-radius:10px;border:1px solid #fecaca;background:#fff;color:#b91c1c;cursor:pointer;min-height:40px', 'مسح التوقيع');
    del.type = 'button';
    var note = el('div', 'flex-basis:100%;font-size:12.5px;color:#b45309;font-weight:700;display:none');
    box.appendChild(btn); box.appendChild(thumb); box.appendChild(del); box.appendChild(note);
    var host = input.closest('.field, .form-field, .modal-field, .form-group, label') || input.parentNode;
    if (host === input.parentNode) input.insertAdjacentElement('afterend', box); else host.appendChild(box);

    function render() {
      var s = load(), name = input.value;
      var valid = !!(s && s.sig && norm(s.name) === norm(name) && norm(name));
      if (valid) { img.src = s.sig; img.style.display = 'block'; }
      else { img.removeAttribute('src'); img.style.display = 'none'; }
      btn.textContent = s && s.sig ? '✍️ وقّع من جديد' : '✍️ توقيع ' + (cfg.label || 'ESP Engineer') + ' (اختياري)';
      thumb.style.display = s && s.sig ? 'flex' : 'none'; if (s && s.sig) timg.src = s.sig;
      del.style.display = s && s.sig ? 'inline-block' : 'none';
      note.style.display = 'none';
      if (s && s.sig && !valid) {
        note.style.display = 'block';
        note.textContent = norm(name) ? 'التوقيع محفوظ لاسم «' + s.name + '». الاسم تغيّر، فما بيطلع في الملف. وقّع من جديد إذا تبي.' : 'اكتب الاسم عشان يطلع التوقيع في الملف.';
      }
    }
    btn.addEventListener('click', function () {
      var name = input.value.trim();
      if (!name) { note.style.display = 'block'; note.textContent = 'اكتب اسم ' + (cfg.label || 'ESP Engineer') + ' أول.'; input.focus(); return; }
      open({ title: cfg.title || ('توقيع ' + (cfg.label || 'ESP Engineer')), name: name, onDone: function (png) {
        if (!png) return;
        save({ name: name, sig: png, at: Date.now() }); render();
        if (typeof cfg.onChange === 'function') { try { cfg.onChange(); } catch (e) {} }
      } });
    });
    del.addEventListener('click', function () { save(null); render(); if (typeof cfg.onChange === 'function') { try { cfg.onChange(); } catch (e) {} } });
    input.addEventListener('input', render); input.addEventListener('change', render);

    (cfg.resetFns || []).forEach(function (fn) {
      function hook() {
        var f = window[fn]; if (typeof f !== 'function' || f['__biwSig_' + cfg.tool]) return;
        var w = function () { var r = f.apply(this, arguments); setTimeout(function () { if (!String(input.value || '').trim()) { save(null); } render(); }, 0); return r; };
        w['__biwSig_' + cfg.tool] = true; window[fn] = w;
      }
      hook(); setTimeout(hook, 500);
    });
    render(); setTimeout(render, 400); setTimeout(render, 1500);   /* بعد ما الأداة تسترجع المسودة */
    return { render: render };
  }

  window.BIWSign = { open: open, attach: attach };
})();
