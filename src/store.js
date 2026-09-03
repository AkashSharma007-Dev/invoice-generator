/* Flat-file JSON store kept in the user's AppData folder.
   Small data set (a few thousand invoices at most), so the whole file is
   read once at boot and written back on every mutation. */
const fs = require('fs');
const path = require('path');
const DEFAULTS = require('./defaults');

let FILE = null;
let state = null;

function blank() {
  return {
    version: 1,
    settings: {
      company: Object.assign({}, DEFAULTS.company),
      bank: Object.assign({}, DEFAULTS.bank),
      disclaimer: DEFAULTS.disclaimer.slice(),
      footerNote: DEFAULTS.footerNote,
      branches: DEFAULTS.branches.map(function (b) { return Object.assign({}, b); }),
      services: DEFAULTS.services.slice(),
      showStamp: DEFAULTS.showStamp,
      totalsEveryPage: DEFAULTS.totalsEveryPage,
      statementTitle: DEFAULTS.statementTitle,
      vchTypes: DEFAULTS.vchTypes.slice(),
      defaultParticulars: DEFAULTS.defaultParticulars,
      statementTotalsEveryPage: DEFAULTS.statementTotalsEveryPage
    },
    counters: {},   /* "26LUN" -> highest serial issued */
    clients: [],    /* { name, address } */
    invoices: [],   /* newest first */
    statements: []  /* newest first */
  };
}

function init(userDataDir) {
  FILE = path.join(userDataDir, 'invoice-data.json');
  try {
    state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    // Fill in anything a older file predates.
    var fresh = blank();
    state.settings = Object.assign({}, fresh.settings, state.settings || {});
    state.counters = state.counters || {};
    state.clients = state.clients || [];
    state.invoices = state.invoices || [];
    state.statements = state.statements || [];
    /* Pre-1.1 files stored services as plain strings; recover the field type
       from the factory list so VISA SERVICE keeps its country dropdown. */
    state.settings.services = (state.settings.services || []).map(function (s) {
      if (typeof s !== 'string') return s;
      var known = DEFAULTS.services.find(function (d) {
        return d.name.toLowerCase() === s.trim().toLowerCase();
      });
      return { name: s, field: known ? known.field : 'text' };
    });
  } catch (e) {
    state = blank();
    flush();
  }
  return state;
}

function flush() {
  var tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);   /* atomic-ish: never leave a half-written file */
}

function getState() { return state; }

function saveSettings(settings) {
  state.settings = Object.assign({}, state.settings, settings);
  flush();
  return state.settings;
}

/* "26LUN/INV000157" — two-digit year, branch code, 6-digit serial. */
function peekInvoiceNo(branch, year) {
  var key = String(year) + branch;
  var next = (state.counters[key] || 0) + 1;
  return { key: key, serial: next, invoiceNo: key + '/INV' + String(next).padStart(6, '0') };
}

/* Only bump the counter once an invoice actually gets saved or exported. */
function commitInvoiceNo(branch, year, serial) {
  var key = String(year) + branch;
  if (serial > (state.counters[key] || 0)) { state.counters[key] = serial; flush(); }
  return state.counters[key];
}

function setCounter(key, value) {
  state.counters[key] = Math.max(0, Number(value) || 0);
  flush();
  return state.counters;
}

function upsertClient(client) {
  if (!client || !client.name || !client.name.trim()) return state.clients;
  var name = client.name.trim();
  var i = state.clients.findIndex(function (c) {
    return c.name.toLowerCase() === name.toLowerCase();
  });
  var rec = { name: name, address: (client.address || '').trim() };
  if (i >= 0) state.clients[i] = rec; else state.clients.push(rec);
  state.clients.sort(function (a, b) { return a.name.localeCompare(b.name); });
  flush();
  return state.clients;
}

function deleteClient(name) {
  state.clients = state.clients.filter(function (c) { return c.name !== name; });
  flush();
  return state.clients;
}

function saveInvoice(inv) {
  var rec = Object.assign({}, inv);
  rec.id = rec.id || ('inv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
  rec.savedAt = new Date().toISOString();
  var i = state.invoices.findIndex(function (x) { return x.id === rec.id; });
  if (i >= 0) state.invoices[i] = rec; else state.invoices.unshift(rec);
  flush();
  return rec;
}

function deleteInvoice(id) {
  state.invoices = state.invoices.filter(function (x) { return x.id !== id; });
  flush();
  return state.invoices;
}

/* Statements live beside invoices rather than inside them: a statement is a
   view over a period, not a document that gets numbered or reissued. */
function saveStatement(st) {
  var rec = Object.assign({}, st);
  rec.id = rec.id || ('stm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
  rec.savedAt = new Date().toISOString();
  var i = state.statements.findIndex(function (x) { return x.id === rec.id; });
  if (i >= 0) state.statements[i] = rec; else state.statements.unshift(rec);
  flush();
  return rec;
}

function deleteStatement(id) {
  state.statements = state.statements.filter(function (x) { return x.id !== id; });
  flush();
  return state.statements;
}

/* Every saved invoice for one client inside a date range, oldest first —
   the raw material the statement's "Auto fill" button turns into Debit
   entries. Matching is on the trimmed, case-folded name because the same
   client gets typed half a dozen different ways over a year. */
function invoicesForClient(clientName, fromISO, toISO) {
  var want = String(clientName || '').trim().toLowerCase();
  if (!want) return [];
  return state.invoices.filter(function (inv) {
    if (String(inv.clientName || '').trim().toLowerCase() !== want) return false;
    var d = inv.invoiceDate || '';
    if (fromISO && d < fromISO) return false;
    if (toISO && d > toISO) return false;
    return true;
  }).sort(function (a, b) {
    return String(a.invoiceDate || '').localeCompare(String(b.invoiceDate || ''));
  });
}

module.exports = {
  init: init,
  getState: getState,
  saveSettings: saveSettings,
  peekInvoiceNo: peekInvoiceNo,
  commitInvoiceNo: commitInvoiceNo,
  setCounter: setCounter,
  upsertClient: upsertClient,
  deleteClient: deleteClient,
  saveInvoice: saveInvoice,
  deleteInvoice: deleteInvoice,
  saveStatement: saveStatement,
  deleteStatement: deleteStatement,
  invoicesForClient: invoicesForClient
};
