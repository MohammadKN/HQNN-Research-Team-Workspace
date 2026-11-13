/**
 * Google Apps Script backend: turns the Google Sheet this script is attached to into the database.
 * Setup is in README.md. Tabs "papers", "gaps", "qs", "_meta" and "_edits" are created automatically.
 */
var TOKEN = "CHANGE_ME_SECRET"; // must match TOKEN in config.js
var USERS = ["Mustafa", "Zaid", "Saleem", "Moe", "MKN"];

function doGet() { return out({ ok: true, message: "HQNN workspace API is running." }); }
function allowedUser(name) {
  var normalized = String(name || "").trim().toLowerCase();
  return USERS.some(function (user) { return user.toLowerCase() === normalized; });
}

function doPost(e) {
  var lock = LockService.getScriptLock(), locked = false;
  try {
    var r = JSON.parse(e.postData.contents);
    if (r.token !== TOKEN) return out({ error: "Bad token" });
    var fn = A[r.action];
    if (!fn) return out({ error: "Unknown action" });
    if (!allowedUser(r.by)) return out({ error: "Enter an approved team member name to view or edit the workspace." });
    if (r.action !== "getAll") { lock.waitLock(20000); locked = true; }
    return out(fn(SpreadsheetApp.getActiveSpreadsheet(), r));
  } catch (err) {
    return out({ error: String(err) });
  } finally {
    if (locked) lock.releaseLock();
  }
}
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function editsTab(ss) {
  var t = ss.getSheetByName("_edits");
  if (!t) {
    t = ss.insertSheet("_edits");
    t.getRange(1, 1, 1, 4).setValues([["_at", "_sheet", "_row", "_by"]]);
    t.setFrozenRows(1);
  }
  return t;
}
function recordEdit(ss, sheet, rowId, by) {
  editsTab(ss).appendRow([Date.now(), sheet, rowId, by || ""]);
}
function editHistory(ss) {
  var t = ss.getSheetByName("_edits"), history = {};
  if (!t || t.getLastRow() < 2) return history;
  var rows = t.getRange(2, 1, t.getLastRow() - 1, 4).getValues();
  for (var i = rows.length - 1; i >= 0; i--) {
    var key = rows[i][1] + "|" + rows[i][2];
    if (!history[key]) history[key] = [];
    if (history[key].length < 10) history[key].push({ by: rows[i][3], at: rows[i][0] });
  }
  return history;
}

// Column definitions (id, name, type) live in the "_meta" tab: A = sheet key, B = JSON.
function metaTab(ss) { return ss.getSheetByName("_meta") || ss.insertSheet("_meta"); }
function getCols(ss, key) {
  var v = metaTab(ss).getDataRange().getValues();
  for (var i = 0; i < v.length; i++) if (v[i][0] === key) return JSON.parse(v[i][1]);
  return null;
}
function setCols(ss, key, cols) {
  var s = metaTab(ss), v = s.getDataRange().getValues();
  for (var i = 0; i < v.length; i++) if (v[i][0] === key) { s.getRange(i + 1, 2).setValue(JSON.stringify(cols)); return; }
  s.appendRow([key, JSON.stringify(cols)]);
}
function writeHeader(t, cols) {
  var hdr = ["_id", "_by", "_at"].concat(cols.map(function (c) { return c.name; }));
  t.getRange(1, 1, 1, hdr.length).setValues([hdr]);
}
function tab(ss, key, cols) {
  var t = ss.getSheetByName(key);
  if (!t) { t = ss.insertSheet(key); writeHeader(t, cols); t.setFrozenRows(1); }
  return t;
}
function rowIndex(t, id) {
  var n = t.getLastRow(); if (n < 2) return -1;
  return t.getRange(2, 1, n - 1, 1).getValues().map(function (x) { return x[0]; }).indexOf(id);
}
function newRow(cols, id, by, vals) {
  return [id, by || "", Date.now()].concat(cols.map(function (c) { return (vals && vals[c.id]) || ""; }));
}
function appendRows(t, rows) {
  var at = t.getLastRow() + 1;
  t.getRange(at, 1, rows.length, rows[0].length).setNumberFormat("@").setValues(rows);
}

var A = {
  getAll: function (ss, r) {
    var res = {}, history = editHistory(ss);
    Object.keys(r.defaults).forEach(function (key) {
      var cols = getCols(ss, key);
      if (!cols) { cols = r.defaults[key]; setCols(ss, key, cols); }
      var t = tab(ss, key, cols), rows = [], n = t.getLastRow();
      if (n > 1) {
        t.getRange(2, 1, n - 1, 3 + cols.length).getValues().forEach(function (row) {
          if (!row[0]) return;
          var historyKey = key + "|" + row[0];
          var o = { id: row[0], by: row[1], at: row[2], edits: history[historyKey] || [], v: {} };
          if (!o.edits.length && (row[1] || row[2])) o.edits.push({ by: row[1], at: row[2] });
          cols.forEach(function (c, i) { o.v[c.id] = row[3 + i] === "" ? "" : String(row[3 + i]); });
          rows.push(o);
        });
      }
      res[key] = { cols: cols, rows: rows };
    });
    return { sheets: res };
  },
  addRow: function (ss, r) {
    var cols = getCols(ss, r.sheet), t = tab(ss, r.sheet, cols), id = Utilities.getUuid().slice(0, 8);
    appendRows(t, [newRow(cols, id, r.by, r.values)]);
    recordEdit(ss, r.sheet, id, r.by);
    return { id: id };
  },
  addRows: function (ss, r) {
    var cols = getCols(ss, r.sheet), t = tab(ss, r.sheet, cols);
    var ids = r.rows.map(function (v) { return Utilities.getUuid().slice(0, 8); });
    appendRows(t, r.rows.map(function (v, i) { return newRow(cols, ids[i], r.by, v); }));
    ids.forEach(function (id) { recordEdit(ss, r.sheet, id, r.by); });
    return { ok: true };
  },
  updateCell: function (ss, r) {
    var cols = getCols(ss, r.sheet), t = tab(ss, r.sheet, cols);
    var i = rowIndex(t, r.rowId), c = cols.map(function (x) { return x.id; }).indexOf(r.colId);
    if (i < 0) throw new Error("Row no longer exists");
    if (c < 0) throw new Error("Column no longer exists");
    t.getRange(i + 2, 4 + c).setNumberFormat("@").setValue(r.value);
    t.getRange(i + 2, 2, 1, 2).setValues([[r.by || "", Date.now()]]);
    recordEdit(ss, r.sheet, r.rowId, r.by);
    return { ok: true };
  },
  deleteRow: function (ss, r) {
    var t = tab(ss, r.sheet, getCols(ss, r.sheet)), i = rowIndex(t, r.rowId);
    if (i >= 0) t.deleteRow(i + 2);
    return { ok: true };
  },
  saveCols: function (ss, r) {
    var old = getCols(ss, r.sheet), nu = r.cols, t = tab(ss, r.sheet, nu);
    var same = old && old.length === nu.length && old.every(function (c, i) { return c.id === nu[i].id; });
    if (!same) {
      var n = t.getLastRow();
      var data = n > 1 ? t.getRange(2, 1, n - 1, 3 + old.length).getValues() : [];
      var moved = data.map(function (row) {
        var m = [row[0], row[1], row[2]];
        nu.forEach(function (c) { var i = old.findIndex(function (o) { return o.id === c.id; }); m.push(i < 0 ? "" : row[3 + i]); });
        return m;
      });
      t.clear(); t.setFrozenRows(1);
      if (moved.length) t.getRange(2, 1, moved.length, 3 + nu.length).setNumberFormat("@").setValues(moved);
    }
    writeHeader(t, nu); setCols(ss, r.sheet, nu);
    return { ok: true };
  }
};
