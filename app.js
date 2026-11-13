(function () {
"use strict";
var CFG = window.CONFIG || {};
var STATUS = ["Not started", "In progress", "Done"];
function mk(a) { return a.map(function (c) { return { id: c[0], name: c[1], type: c[2] || "text" }; }); }
var SHEETS = {
  papers: { label: "Papers", cols: mk([["c1","Paper (Authors, Year)"],["c2","Venue / DOI"],["c3","Architecture"],["c4","Dataset(s)"],["c5","Baseline (classical, parameter-matched?)"],["c6","Noise Model (ideal / simulated / hardware)"],["c7","Qubit Count"],["c8","Code Released? (link)"],["c9","Key Result"],["c10","Limitations Noted by Authors"],["c11","My Notes / Possible Gap"],["c12","Assigned to"],["c13","Status","status"]]) },
  gaps: { label: "Gap Summary", cols: mk([["c1","Criterion"],["c2","Papers weak or missing"],["c3","Observation"]]),
    starter: ["Baseline matched and tuned","Realistic noise model","Real-world dataset","Code released","Qubit count beyond toy sizes","Data encoding studied systematically"] },
  qs: { label: "Research Questions", cols: mk([["c1","Research question"],["c2","Why it matters"],["c3","Owner"],["c4","Status","status"]]) }
};
var KEYS = Object.keys(SHEETS), S = {}, timers = {}, dirty = {}, pending = 0, loading = false;
var statusEl = $("#status"), meEl = $("#me");
KEYS.forEach(function (k) { S[k] = { cols: SHEETS[k].cols.slice(), rows: [], sig: "", got: false }; });

function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function h(tag, a, kids) {
  var e = document.createElement(tag); a = a || {};
  for (var k in a) {
    if (k === "class") e.className = a[k]; else if (k === "text") e.textContent = a[k];
    else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), a[k]); else e.setAttribute(k, a[k]);
  }
  (kids || []).forEach(function (c) { e.append(c); }); return e;
}
function note(m, err) { statusEl.textContent = m; statusEl.className = err ? "err" : ""; }
function fail(e) { note("Couldn’t save that change (" + ((e && e.message) || e) + ").", true); }
function size(t) { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }
function me() { return (meEl.value || "").trim() || "Someone"; }
function canEdit() {
  var name = me().toLowerCase();
  return (CFG.USERS || []).some(function (user) { return user.toLowerCase() === name; });
}
function editable(e) { e.disabled = !canEdit(); return e; }
function requireEditor() {
  if (canEdit()) return true;
  note("Enter one of the approved team member names to edit.", true);
  meEl.focus();
  return false;
}

function api(action, data) {
  var body = Object.assign({ token: CFG.TOKEN, action: action }, data || {});
  // No headers on purpose: a plain text/plain POST avoids a CORS preflight on Apps Script.
  return fetch(CFG.API_URL, { method: "POST", body: JSON.stringify(body) })
    .then(function (r) { return r.json(); })
    .then(function (j) { if (j.error) throw new Error(j.error); return j; });
}
function arm(btn, label, fn) {
  var on = false, t, orig = btn.textContent;
  btn.addEventListener("click", function () {
    if (!on) { on = true; btn.textContent = label; btn.classList.add("arm"); t = setTimeout(function () { on = false; btn.textContent = orig; btn.classList.remove("arm"); }, 3000); }
    else { clearTimeout(t); on = false; fn(); }
  });
}
// Debounced save; "pending" pauses polling so a refresh never overwrites unsaved typing.
function later(key, fn, ms) {
  var old = timers[key];
  if (old && old.timer) { clearTimeout(old.timer); pending--; }
  var job = { timer: null };
  timers[key] = job;
  pending++;
  job.timer = setTimeout(function () {
    job.timer = null;
    Promise.resolve().then(fn).catch(function (e) { fail(e); }).then(function () {
      pending--;
      if (timers[key] === job) delete timers[key];
    });
  }, ms);
}
function saveCols(k) { return api("saveCols", { sheet: k, cols: S[k].cols, by: me() }); }
function saveCell(k, rid, cid, val, ms) {
  var key = k + "|" + rid + "|" + cid;
  var row = S[k].rows.find(function (r) { return r.id === rid; }); if (row) row.v[cid] = val;
  dirty[key] = { value: val, at: Date.now() };
  later(key, function () {
    return api("updateCell", { sheet: k, rowId: rid, colId: cid, value: val, by: me() }).catch(function (e) {
      if (dirty[key] && dirty[key].value === val) delete dirty[key];
      throw e;
    });
  }, ms);
}
function fmt(r) {
  var edits = r.edits && r.edits.length ? r.edits : (r.by || r.at ? [{ by: r.by, at: r.at }] : []);
  return edits.map(function (edit) {
    var d = edit.at ? new Date(Number(edit.at)).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    return edit.by && d ? edit.by + " · " + d : (edit.by || d);
  }).join("\n");
}

function render(k) {
  var st = S[k], pane = $("#wrap-" + k); if (!st.got) return;
  var sig = st.cols.map(function (c) { return c.id + c.type; }).join() + "|" + st.rows.map(function (r) { return r.id; }).join();
  $("#empty-" + k).style.display = st.rows.length ? "none" : "block";
  if (sig === st.sig) { patch(k); return; }
  st.sig = sig;
  var ae = document.activeElement;
  var fo = ae && pane.contains(ae) && ae.dataset ? { r: ae.dataset.r, c: ae.dataset.c, hc: ae.dataset.hc, s: ae.selectionStart } : null;
  var head = h("tr", {}, [h("th", { class: "n", text: "#" })]);
  st.cols.forEach(function (c) {
    var inp = editable(h("input", { class: "h", "data-hc": c.id, "aria-label": "Column name" })); inp.value = c.name;
    inp.addEventListener("input", function () { c.name = inp.value; later(k + "cols", function () { return saveCols(k); }, 600); });
    var x = editable(h("button", { class: "mini", title: "Delete column", text: "✕" }));
    arm(x, "Sure?", function () { st.cols = st.cols.filter(function (z) { return z.id !== c.id; }); render(k); saveCols(k).catch(fail); });
    head.append(h("th", {}, [h("div", { class: "hc" }, [inp, x])]));
  });
  head.append(h("th", { text: "Last edit" }), h("th", { class: "x" }));
  var body = h("tbody");
  st.rows.forEach(function (r, i) {
    var tr = h("tr", {}, [h("td", { class: "n", text: String(i + 1) })]);
    st.cols.forEach(function (c) {
      var f;
      if (c.type === "status") {
        f = editable(h("select", { "data-r": r.id, "data-c": c.id, "aria-label": c.name }));
        [""].concat(STATUS).forEach(function (o) { f.append(h("option", { value: o, text: o || "—" })); });
        f.value = r.v[c.id] || "";
        f.addEventListener("change", function () { saveCell(k, r.id, c.id, f.value, 0); });
      } else {
        f = editable(h("textarea", { rows: "2", "data-r": r.id, "data-c": c.id, "aria-label": c.name })); f.value = r.v[c.id] || "";
        f.addEventListener("input", function () { size(f); saveCell(k, r.id, c.id, f.value, 600); });
      }
      tr.append(h("td", {}, [f]));
    });
    tr.append(h("td", { class: "l", "data-by": r.id, text: fmt(r) }));
    var del = editable(h("button", { class: "mini", "data-delete": r.id, text: "Delete" }));
    arm(del, "Sure?", function () {
      st.rows = st.rows.filter(function (z) { return z.id !== r.id; }); render(k);
      api("deleteRow", { sheet: k, rowId: r.id, by: me() }).catch(fail);
    });
    tr.append(h("td", { class: "x" }, [del])); body.append(tr);
  });
  pane.replaceChildren(h("table", {}, [h("thead", {}, [head]), body]));
  $$("textarea", pane).forEach(size);
  if (fo) {
    var t = pane.querySelector(fo.hc ? '[data-hc="' + fo.hc + '"]' : '[data-r="' + fo.r + '"][data-c="' + fo.c + '"]');
    if (t) { t.focus(); try { t.setSelectionRange(fo.s, fo.s); } catch (e) {} }
  }
}
function patch(k) {
  var st = S[k], pane = $("#wrap-" + k), ae = document.activeElement;
  st.cols.forEach(function (c) {
    var i = $('[data-hc="' + c.id + '"]', pane);
    if (i) { i.disabled = !canEdit(); if (i !== ae && i.value !== c.name) i.value = c.name; }
  });
  st.rows.forEach(function (r) {
    st.cols.forEach(function (c) {
      var f = $('[data-r="' + r.id + '"][data-c="' + c.id + '"]', pane), v = r.v[c.id] || "";
      if (f) { f.disabled = !canEdit(); if (f !== ae && f.value !== v) { f.value = v; if (f.tagName === "TEXTAREA") size(f); } }
    });
    var del = $('[data-delete="' + r.id + '"]', pane); if (del) del.disabled = !canEdit();
    var l = $('[data-by="' + r.id + '"]', pane); if (l) l.textContent = fmt(r);
  });
  $$(".mini", pane).forEach(function (button) { button.disabled = !canEdit(); });
}
function refresh() {
  if (loading || pending > 0 || document.hidden) return Promise.resolve();
  loading = true;
  var d = {}; KEYS.forEach(function (k) { d[k] = SHEETS[k].cols; });
  return api("getAll", { defaults: d }).then(function (j) {
    KEYS.forEach(function (k) {
      var s = j.sheets[k]; if (!s) return;
      s.rows.forEach(function (r) {
        s.cols.forEach(function (c) {
          var key = k + "|" + r.id + "|" + c.id, local = dirty[key];
          if (!local) return;
          var remote = r.v[c.id] || "";
          if (remote === local.value) delete dirty[key];
          else if (Date.now() - local.at < 30000) r.v[c.id] = local.value;
          else delete dirty[key];
        });
      });
      S[k].cols = s.cols; S[k].rows = s.rows; S[k].got = true; render(k);
    });
    note("Synced " + new Date().toLocaleTimeString() + " · refreshes every " + Math.round(CFG.POLL_MS / 1000) + "s");
  }).catch(function (e) { note("Can’t reach Google Sheets: " + e.message, true); })
    .then(function () { loading = false; });
}
function csv(k) {
  var st = S[k], e = function (v) { return '"' + String(v || "").replace(/"/g, '""') + '"'; };
  var L = [st.cols.map(function (c) { return e(c.name); }).join(",")];
  st.rows.forEach(function (r) { L.push(st.cols.map(function (c) { return e(r.v[c.id]); }).join(",")); });
  return "\ufeff" + L.join("\r\n");
}
function show(id) {
  $$(".pane").forEach(function (p) { p.classList.toggle("on", p.id === "pane-" + id); });
  $$("#tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.t === id); });
  $$("#pane-" + id + " textarea").forEach(size);
}

var tabs = $("#tabs"), panes = $("#panes");
KEYS.concat("guide").forEach(function (k) {
  tabs.append(h("button", { "data-t": k, text: k === "guide" ? "Column Guide" : SHEETS[k].label, onclick: function () { show(k); } }));
});
KEYS.forEach(function (k) {
  var bar = h("div", { class: "bar" }, [
    editable(h("button", { class: "btn", text: "+ Add row", onclick: function () { if (!requireEditor()) return; api("addRow", { sheet: k, by: me() }).then(refresh).catch(fail); } })),
    editable(h("button", { class: "btn alt", text: "+ Add column", onclick: function () {
      if (!requireEditor()) return;
      var c = { id: "c" + Date.now().toString(36), name: "New column", type: "text" };
      S[k].cols.push(c); render(k); saveCols(k).catch(fail);
      var i = $('[data-hc="' + c.id + '"]'); if (i) { i.focus(); i.select(); }
    } }))
  ]);
  if (SHEETS[k].starter) bar.append(editable(h("button", { class: "btn alt", text: "Add starter criteria", onclick: function () {
    if (!requireEditor()) return;
    api("addRows", { sheet: k, by: me(), rows: SHEETS[k].starter.map(function (s) { return { c1: s }; }) }).then(refresh).catch(fail);
  } })));
  bar.append(h("button", { class: "btn alt", text: "Export CSV", onclick: function () {
    var a = h("a", { href: URL.createObjectURL(new Blob([csv(k)], { type: "text/csv" })), download: "hqnn_" + k + ".csv" });
    document.body.append(a); a.click(); a.remove();
  } }));
  panes.append(h("div", { class: "pane", id: "pane-" + k }, [bar, h("div", { class: "wrap", id: "wrap-" + k }),
    h("div", { class: "empty", id: "empty-" + k, text: "No rows yet. Click “Add row” to start." })]));
  $("#empty-" + k).style.display = "none";
});
show("papers");

meEl.value = localStorage.getItem("hqnn_name") || "";
meEl.addEventListener("input", function () {
  try { localStorage.setItem("hqnn_name", meEl.value); } catch (e) {}
  KEYS.forEach(function (k) { render(k); });
  note(canEdit() ? "Ready to edit as " + me() + "." : "Enter an approved team member name to edit.", !canEdit());
});

if (!CFG.API_URL || CFG.API_URL.indexOf("PASTE_") === 0) {
  note("Not connected yet. Open config.js and paste your Apps Script web app URL (see README.md).", true);
} else {
  refresh(); setInterval(refresh, CFG.POLL_MS || 8000);
  document.addEventListener("visibilitychange", refresh);
}
})();
