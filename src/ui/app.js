/* ============================================================
   Renderer logic: form  ->  live invoice preview  ->  PDF / Excel
   ============================================================ */
'use strict';

const $ = (id) => document.getElementById(id);
const R = window.InvoiceRender;
const SR = window.StatementRender;
const ASSET_BASE = '../../';          /* src/ui/index.html -> project root */

let state = null;      /* settings + clients + invoices + counters (from main) */
let model = null;      /* the invoice currently on screen                      */
let currentId = null;  /* set once the invoice has been saved to history       */
let manual = false;    /* manual-edit mode: preview is the source of truth     */
let zoom = 1;

/* Which document the whole window is working on: 'invoice' or 'statement'.
   The form, the preview and what Save / Excel / Export PDF do all follow it. */
let docKind = 'invoice';
let stmt = null;         /* the statement currently on screen        */
let currentStmtId = null;/* set once it has been saved to history    */

/* 'page' fits a whole sheet in the canvas, 'width' fills the canvas width.
   Page is the default because the point of the preview is watching the
   invoice while typing, and on a 14" laptop a width-fitted page runs off
   the bottom of the window. */
let fitMode = 'page';
let wideView = false;

/* ------------------------------------------------------------------ *
 *  small helpers
 * ------------------------------------------------------------------ */

function toast(msg, isError) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('err', !!isError);
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3200);
}

const pad2 = (n) => String(n).padStart(2, '0');

/* yyyy-mm-dd (input value)  ->  dd-mm-yyyy (printed) */
function toDisplayDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return d + '-' + m + '-' + y;
}

function todayISO() {
  const t = new Date();
  return t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate());
}

/* Two-digit year taken from the invoice date, matching "26LUN/INV000156". */
function yearKey(iso) {
  return (iso || todayISO()).slice(2, 4);
}

function services() {
  return R.normalizeServices(state.settings.services);
}

function blankItem() {
  const first = services()[0];
  return {
    pax: '', pnr: '', route: '',
    service: first ? first.name : '', ticket: '', days: '', amount: ''
  };
}

const TEXT_PLACEHOLDER = {
  text: 'Ticket no.',
  hotel: 'Hotel name',
  misc: 'Miscellaneous service'
};

function dropdown(options, blankLabel, value) {
  const select = document.createElement('select');
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = blankLabel;
  select.appendChild(blank);
  options.forEach((opt) => {
    const o = document.createElement('option');
    o.value = typeof opt === 'string' ? opt : opt.value;
    o.textContent = typeof opt === 'string' ? opt : opt.label;
    select.appendChild(o);
  });
  /* Keep the previous value only if it is still a valid choice. */
  select.value = Array.from(select.options).some((o) => o.value === String(value || ''))
    ? String(value) : '';
  return select;
}

const DAY_OPTIONS = Array.from({ length: 365 }, (_, i) => ({
  value: String(i + 1), label: (i + 1) + (i === 0 ? ' Day' : ' Days')
}));

/* The detail cell(s) for a row — shape follows the chosen service.
   Returns one control, or two for Travel Insurance (country + days). */
function detailControls(item) {
  const kind = R.fieldFor(item.service, state.settings.services);

  if (TEXT_PLACEHOLDER[kind]) {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = TEXT_PLACEHOLDER[kind];
    input.value = item.ticket || '';
    input.dataset.k = 'ticket';
    return [input];
  }

  if (kind === 'driver') {
    const sel = dropdown(R.DRIVER_OPTIONS, 'Select…', item.ticket);
    sel.dataset.k = 'ticket';
    return [sel];
  }

  const country = dropdown(window.COUNTRIES, 'Select country…', item.ticket);
  country.dataset.k = 'ticket';
  if (kind !== 'country_days') return [country];

  const days = dropdown(DAY_OPTIONS, 'Days…', item.days);
  days.dataset.k = 'days';
  return [country, days];
}

/* ------------------------------------------------------------------ *
 *  model  <->  form
 * ------------------------------------------------------------------ */

function newModel() {
  const s = state.settings;
  return {
    branch: (s.branches[0] || { code: 'LUN' }).code,
    invoiceNo: '',
    invoiceDate: todayISO(),
    clientName: '',
    clientAddress: '',
    lpoNumber: '',
    currency: 'ZMW',
    items: [blankItem()],
    serial: null            /* filled by the auto-numbering */
  };
}

/* Everything the printed page needs: form data + the fixed settings. */
function printModel() {
  const s = state.settings;
  return Object.assign({}, model, {
    invoiceDate: toDisplayDate(model.invoiceDate),
    detailHeader: R.detailHeader(model.items, s.services),
    services: R.normalizeServices(s.services),
    company: s.company,
    bank: s.bank,
    disclaimer: s.disclaimer,
    footerNote: s.footerNote,
    showStamp: s.showStamp !== false,
    totalsEveryPage: s.totalsEveryPage === true
  });
}

function fillForm() {
  $('fBranch').value = model.branch;
  $('fInvoiceNo').value = model.invoiceNo;
  $('fDate').value = model.invoiceDate;
  $('fCurrency').value = model.currency;
  $('fClient').value = model.clientName;
  $('fClientAddress').value = model.clientAddress;
  $('fLpo').value = model.lpoNumber;
  renderItemRows();
}

function readForm() {
  model.branch = $('fBranch').value;
  model.invoiceNo = $('fInvoiceNo').value;
  model.invoiceDate = $('fDate').value;
  model.currency = $('fCurrency').value;
  model.clientName = $('fClient').value;
  model.clientAddress = $('fClientAddress').value;
  model.lpoNumber = $('fLpo').value;
  model.items = Array.from(document.querySelectorAll('.item-row')).map((row) => ({
    pax:     row.querySelector('[data-k=pax]').value,
    pnr:     row.querySelector('[data-k=pnr]').value,
    route:   row.querySelector('[data-k=route]').value,
    service: row.querySelector('[data-k=service]').value,
    ticket:  row.querySelector('[data-k=ticket]').value,
    days:    (row.querySelector('[data-k=days]') || { value: '' }).value,
    amount:  row.querySelector('[data-k=amount]').value
  }));
}

function renderItemRows() {
  const host = $('itemRows');
  host.textContent = '';
  model.items.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    const top = document.createElement('div');
    top.className = 'ir-a';
    const bottom = document.createElement('div');
    bottom.className = 'ir-b';
    row.appendChild(top);
    row.appendChild(bottom);

    const text = (key, placeholder, host) => {
      const input = document.createElement('input');
      input.type = 'text';
      input.dataset.k = key;
      input.placeholder = placeholder;
      input.value = it[key] == null ? '' : it[key];
      input.addEventListener('input', sync);
      host.appendChild(input);
    };
    text('pax', 'Passenger name', top);
    text('pnr', 'PNR', top);

    const svc = document.createElement('select');
    svc.dataset.k = 'service';
    services().forEach((s) => {
      const o = document.createElement('option');
      o.value = s.name;
      o.textContent = s.name;
      svc.appendChild(o);
    });
    /* A service removed from Settings must still show on an old invoice. */
    if (it.service && !services().some((s) => s.name === it.service)) {
      const o = document.createElement('option');
      o.value = it.service;
      o.textContent = it.service;
      svc.appendChild(o);
    }
    svc.value = it.service || '';
    svc.addEventListener('change', () => {
      readForm();
      renderItemRows();      /* the details cell changes shape with the service */
      sync();
    });
    text('route', 'Route', bottom);
    bottom.appendChild(svc);

    const details = detailControls(it);
    bottom.classList.toggle('has-days', details.length > 1);
    details.forEach((el) => {
      el.addEventListener('input', sync);
      el.addEventListener('change', sync);
      bottom.appendChild(el);
    });

    const amount = document.createElement('input');
    amount.type = 'number';
    amount.dataset.k = 'amount';
    amount.className = 'num';
    amount.step = '0.01';
    amount.min = '0';
    amount.placeholder = 'Amount';
    amount.value = it.amount == null ? '' : it.amount;
    amount.addEventListener('input', sync);
    top.appendChild(amount);

    const del = document.createElement('button');
    del.className = 'row-del';
    del.textContent = '×';
    del.title = 'Remove this row';
    del.addEventListener('click', () => {
      readForm();
      model.items.splice(i, 1);
      if (!model.items.length) model.items.push(blankItem());
      renderItemRows();
      sync();
    });
    top.appendChild(del);
    host.appendChild(row);
  });
}

/* ------------------------------------------------------------------ *
 *  preview
 * ------------------------------------------------------------------ */

function renderPreview() {
  $('stage').innerHTML = docKind === 'statement'
    ? SR.buildStatementHTML(statementModel(), ASSET_BASE)
    : R.buildInvoiceHTML(printModel(), ASSET_BASE);
  if (manual) enableManualEditing();
  autoFit();
}

function updateTotal() {
  const total = R.itemsTotal(model.items);
  $('fTotal').textContent = model.currency + ' ' + R.formatMoney(total, model.currency);
}

/* Called on every keystroke: form -> model -> paper. */
function sync() {
  if (manual) return;      /* manual edits own the DOM; don't stomp on them */
  if (docKind === 'statement') {
    readStatementForm();
    updateStatementTotals();
  } else {
    readForm();
    updateTotal();
  }
  renderPreview();
}

/* A CSS transform does not change the element's layout box, so a stage
   scaled to 70% still reserves 100% of the room. Left unhandled that makes
   the canvas scroll around empty space and pushes a centred page off to one
   side. Negative margins pull the box back to the size actually drawn. */
function applyZoom() {
  const stage = $('stage');
  const w = stage.offsetWidth || 880;
  const h = stage.offsetHeight || 700;
  stage.style.transform = 'scale(' + zoom + ')';
  /* transform-origin is top center: horizontal shrink is symmetric, so the
     slack is split between the two sides; vertically it all falls below. */
  const sideSlack = -((1 - zoom) * w) / 2;
  stage.style.marginLeft = sideSlack + 'px';
  stage.style.marginRight = sideSlack + 'px';
  stage.style.marginBottom = (-(1 - zoom) * h) + 'px';
  $('zoomVal').textContent = Math.round(zoom * 100) + '%';
}

/* Fit one sheet, not the whole stack: a five-page invoice must still show
   page one at a readable size. */
function computeFit() {
  const canvas = $('canvas');
  const stage = $('stage');
  const sheet = stage.querySelector('.sheet');
  const paperW = stage.offsetWidth || 880;
  let z = (canvas.clientWidth - 34) / paperW;
  if (fitMode === 'page' && sheet) {
    /* .stage carries 10mm of padding above and below the paper. */
    const pageH = sheet.offsetHeight + 76;
    z = Math.min(z, (canvas.clientHeight - 34) / pageH);
  }
  /* Never magnify on its own. Fitting is about getting the page fully into
     view, and blowing a short statement up to 130% only to snap back to 60%
     two rows later makes the preview jump around while you are typing in it.
     The + button is still there for anyone who wants a closer look. */
  return Math.min(1, Math.max(0.25, z));
}

function fitZoom() {
  zoom = computeFit();
  applyZoom();
}

/* Run after every re-render, and deliberately one-directional: it shrinks
   when the page has outgrown the view, and never grows back on its own. That
   keeps the whole page visible while the accountant types — which is the
   entire point of the preview — without the zoom twitching upward on every
   keystroke that shortens a row. The fit button restores it. */
function autoFit() {
  const want = computeFit();
  if (want < zoom - 0.005) { zoom = want; applyZoom(); }
}

function toggleFitMode() {
  fitMode = fitMode === 'page' ? 'width' : 'page';
  $('zoomFit').title = fitMode === 'page'
    ? 'Showing the whole page — click for full width'
    : 'Showing full width — click for the whole page';
  fitZoom();
}

/* Wide view drops the form entirely. On a 14" panel that is the difference
   between a 70% preview and a 100% one. */
function setWideView(on) {
  wideView = on;
  $('formPane').classList.toggle('away', on);
  $('btnWide').classList.toggle('on', on);
  $('btnWide').textContent = on ? 'Show form' : 'Wide view';
  fitZoom();
}

/* ------------------------------------------------------------------ *
 *  manual editing
 * ------------------------------------------------------------------ */

function enableManualEditing() {
  const sheet = $('stage').querySelector('.sheet');
  if (!sheet) return;
  sheet.setAttribute('contenteditable', 'true');
  sheet.setAttribute('spellcheck', 'false');
  $('stage').classList.add('editing');
}

function setManual(on) {
  manual = on;
  $('tglManual').checked = on;
  $('formPane').classList.toggle('locked', on);
  $('manualHint').textContent = on
    ? 'Form is locked — the invoice below is now the master copy'
    : 'Type directly on the invoice';
  if (on) {
    enableManualEditing();
  } else {
    $('stage').classList.remove('editing');
    renderPreview();
  }
}

/* The exported HTML: whatever is on screen when manual edits are in play,
   otherwise a clean re-render from the model. */
function exportHtml() {
  if (!manual) {
    return docKind === 'statement'
      ? SR.buildStatementHTML(statementModel(), ASSET_BASE)
      : R.buildInvoiceHTML(printModel(), ASSET_BASE);
  }
  const clone = $('stage').cloneNode(true);
  clone.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
  return clone.innerHTML;
}

/* ------------------------------------------------------------------ *
 *  numbering
 * ------------------------------------------------------------------ */

async function autoNumber() {
  readForm();
  const peek = await window.api.peekNo(model.branch, yearKey(model.invoiceDate));
  model.serial = peek.serial;
  model.invoiceNo = peek.invoiceNo;
  $('fInvoiceNo').value = peek.invoiceNo;
  sync();
}

/* Reserve the number once the invoice actually leaves the app. */
async function commitNumber() {
  if (model.serial) {
    await window.api.commitNo(model.branch, yearKey(model.invoiceDate), model.serial);
    state = await window.api.getState();
  }
}

/* ------------------------------------------------------------------ *
 *  actions
 * ------------------------------------------------------------------ */

function validate() {
  if (docKind === 'statement') return validateStatement();
  readForm();
  if (!model.invoiceNo.trim()) { toast('Invoice number is empty', true); return false; }
  if (!model.clientName.trim()) { toast('Client name is empty', true); return false; }
  return true;
}

function validateStatement() {
  readStatementForm();
  if (!stmt.clientName.trim()) { toast('Client name is empty', true); return false; }
  const real = SR.allEntries(stmt).filter(
    (e) => SR.hasValue(e.debit) || SR.hasValue(e.credit));
  if (!real.length) { toast('Statement me koi Debit ya Credit nahi hai', true); return false; }
  return true;
}

async function doSave(quiet) {
  if (docKind === 'statement') return doSaveStatement(quiet);
  if (!validate()) return null;
  await window.api.upsertClient({ name: model.clientName, address: model.clientAddress });
  const rec = await window.api.saveInvoice(Object.assign({}, model, {
    id: currentId,
    gross: R.itemsTotal(model.items),
    manualHtml: manual ? exportHtml() : null
  }));
  currentId = rec.id;
  await commitNumber();
  state = await window.api.getState();
  refreshClientList();
  if (!quiet) toast('Saved — invoice ' + model.invoiceNo);
  return rec;
}

async function doExportPdf() {
  if (!validate()) return;
  const statement = docKind === 'statement';
  const res = await window.api.exportPdf({
    html: exportHtml(),
    kind: docKind,
    invoiceNo: statement ? 'Statement' : model.invoiceNo,
    clientName: statement ? stmt.clientName : model.clientName
  });
  if (res.canceled) return;
  if (!res.ok) { toast('PDF failed: ' + res.error, true); return; }
  await doSave(true);
  toast('PDF saved');
  window.api.showItem(res.filePath);
}

async function doExportXlsx() {
  if (!validate()) return;
  if (manual) toast('Note: Excel export uses the form data, not the manual edits');
  if (docKind === 'statement') {
    const st = await window.api.exportStmtXlsx({
      data: statementModel(), clientName: stmt.clientName
    });
    if (st.canceled) return;
    if (!st.ok) { toast('Excel failed: ' + st.error, true); return; }
    await doSave(true);
    toast('Excel saved');
    window.api.showItem(st.filePath);
    return;
  }
  const res = await window.api.exportXlsx({
    data: printModel(), invoiceNo: model.invoiceNo, clientName: model.clientName
  });
  if (res.canceled) return;
  if (!res.ok) { toast('Excel failed: ' + res.error, true); return; }
  await doSave(true);
  toast('Excel saved');
  window.api.showItem(res.filePath);
}

async function doNew() {
  setManual(false);
  if (docKind === 'statement') {
    currentStmtId = null;
    stmt = newStatement();
    fillStatementForm();
    sync();
    toast('New statement');
    return;
  }
  currentId = null;
  model = newModel();
  fillForm();
  await autoNumber();
  toast('New invoice');
}

/* ------------------------------------------------------------------ *
 *  Excel / CSV import
 * ------------------------------------------------------------------ */

/* The last parse returned by the main process. Re-reading the file on every
   mapping change keeps one source of truth: the preview is literally what
   would be imported, never a renderer-side approximation of it. */
let imp = null;

function renderImportMapping() {
  const host = $('impMap');
  host.innerHTML = '';
  imp.fields.forEach((f) => {
    const lab = el('label', 'field span2');
    lab.appendChild(el('span', null, f.label));
    const sel = document.createElement('select');
    sel.dataset.field = f.key;
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '\u2014 not in my file \u2014';
    sel.appendChild(none);
    imp.columns.forEach((c) => {
      const o = document.createElement('option');
      o.value = String(c.index);
      o.textContent = c.label + (c.sample ? '   (' + c.sample.slice(0, 22) + ')' : '');
      sel.appendChild(o);
    });
    const cur = imp.mapping[f.key];
    sel.value = (cur == null) ? '' : String(cur);
    sel.addEventListener('change', reparseImport);
    lab.appendChild(sel);
    host.appendChild(lab);
  });
}

/* Whatever the invoice is billed in, falling back to the app default rather
   than assuming the model has loaded. */
function previewCurrency() {
  return (typeof model !== 'undefined' && model && model.currency) || 'ZMW';
}

function renderImportPreview() {
  const t = $('impTable');
  t.innerHTML = '';
  const head = t.insertRow();
  ['#'].concat(imp.fields.map((f) => f.label)).forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h;
    head.appendChild(th);
  });
  imp.items.slice(0, 40).forEach((it, i) => {
    const tr = t.insertRow();
    tr.insertCell().textContent = String(i + 1);
    imp.fields.forEach((f) => {
      const v = it[f.key];
      const td = tr.insertCell();
      td.textContent = (f.key === 'amount' && v !== '' && v != null)
        ? R.formatMoney(v, previewCurrency()) : String(v == null ? '' : v);
      if (f.key === 'amount') td.className = 'num';
    });
  });

  const sk = imp.skipped || { blank: 0, totals: 0 };
  const extra = [];
  if (sk.totals) extra.push(sk.totals + ' total row' + (sk.totals > 1 ? 's' : ''));
  if (sk.blank) extra.push(sk.blank + ' blank row' + (sk.blank > 1 ? 's' : ''));
  $('impCount').textContent = imp.items.length + ' row' + (imp.items.length === 1 ? '' : 's') +
    ' mili' + (extra.length ? '  \u2014  ' + extra.join(' aur ') + ' chhoda gaya' : '') +
    (imp.items.length > 40 ? '   (neeche pehli 40 dikha rahe hain)' : '');

  const noAmount = imp.items.filter((it) => it.amount === '' || it.amount == null).length;
  $('impFile').textContent = imp.fileName + '  \u2014  sheet "' + imp.sheet + '"' +
    (imp.headerRow >= 0 ? ', header row ' + (imp.headerRow + 1) : ', koi header row nahi mili') +
    (noAmount ? '   \u26a0 ' + noAmount + ' row me amount nahi mila' : '');
}

async function reparseImport() {
  const mapping = {};
  Array.from($('impMap').querySelectorAll('select')).forEach((s) => {
    if (s.value !== '') mapping[s.dataset.field] = Number(s.value);
  });
  const res = await window.api.importReread({
    file: imp.file, sheet: $('impSheet').value,
    mapping: mapping, headerRow: Number($('impHeader').value)
  });
  if (!res.ok) { toast(res.error || 'File dobara padhi nahi ja saki', true); return; }
  imp = res.result;
  renderImportPreview();
}

/* Sheet or header-row change invalidates the mapping, so let the parser guess
   again from scratch rather than forcing old column numbers onto new columns. */
async function reguessImport() {
  const res = await window.api.importReread({
    file: imp.file, sheet: $('impSheet').value, headerRow: Number($('impHeader').value)
  });
  if (!res.ok) { toast(res.error || 'File dobara padhi nahi ja saki', true); return; }
  imp = res.result;
  renderImportMapping();
  renderImportPreview();
}

async function openImport() {
  const res = await window.api.importPick();
  if (res.canceled) return;
  if (!res.ok) { toast(res.error || 'Ye file padhi nahi ja saki', true); return; }
  imp = res.result;

  const sheetSel = $('impSheet');
  sheetSel.innerHTML = '';
  imp.sheetNames.forEach((n) => {
    const o = document.createElement('option');
    o.value = n; o.textContent = n;
    sheetSel.appendChild(o);
  });
  sheetSel.value = imp.sheet;

  const hdrSel = $('impHeader');
  hdrSel.innerHTML = '';
  const noHdr = document.createElement('option');
  noHdr.value = '-1'; noHdr.textContent = 'No header row';
  hdrSel.appendChild(noHdr);
  for (let r = 0; r < 40; r++) {
    const o = document.createElement('option');
    o.value = String(r); o.textContent = 'Row ' + (r + 1);
    hdrSel.appendChild(o);
  }
  hdrSel.value = String(imp.headerRow);

  $('impReplace').checked = false;
  renderImportMapping();
  renderImportPreview();
  openModal('mImport');
}

function applyImport() {
  if (!imp || !imp.items.length) { toast('Import karne ke liye koi row nahi mili', true); return; }
  readForm();
  const rows = imp.items.map((it) => ({
    pax: it.pax || '', pnr: it.pnr || '', route: it.route || '',
    service: it.service || '', ticket: it.ticket || '', days: it.days || '',
    amount: it.amount === '' || it.amount == null ? '' : it.amount
  }));
  if ($('impReplace').checked) {
    model.items = rows;
  } else {
    /* A fresh invoice starts with one empty row; drop it rather than leaving
       a blank line above the imported list. */
    const existing = model.items.filter((it) =>
      (it.pax || it.pnr || it.route || it.ticket || it.amount !== ''));
    model.items = existing.concat(rows);
  }
  renderItemRows();
  sync();
  closeModal();
  toast(rows.length + ' row import ho gayi');
}

/* ------------------------------------------------------------------ *
 *  updates
 * ------------------------------------------------------------------ */

function showUpdate(status) {
  const box = $('updBox'), txt = $('updText'), btn = $('updBtn');
  const show = (message, showBtn) => {
    txt.textContent = message;
    btn.hidden = !showBtn;
    box.hidden = false;
  };
  switch (status.state) {
    case 'checking': break;
    case 'available': show('Naya version ' + status.version + ' mila, download ho raha hai\u2026', false); break;
    case 'downloading': show('Update download ' + status.percent + '%', false); break;
    case 'ready': show('Version ' + status.version + ' taiyar hai', true); break;
    case 'none':
      if (!status.silent) toast('Aap already latest version pe ho');
      break;
    case 'error':
      /* Startup checks fail silently \u2014 no internet is not the accountant\u2019s
         problem to solve mid-invoice. Only a manual check reports. */
      if (!status.silent) toast('Update check nahi ho paya: ' + status.message, true);
      break;
  }
}

/* ------------------------------------------------------------------ *
 *  modals
 * ------------------------------------------------------------------ */

function openModal(id) {
  $('overlay').hidden = false;
  ['mHistory', 'mClients', 'mSettings', 'mImport', 'mStmtImport', 'mAuto']
    .forEach((m) => { $(m).hidden = m !== id; });
}
function closeModal() { $('overlay').hidden = true; }

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function renderHistory() {
  if (docKind === 'statement') return renderStatementHistory();
  const host = $('historyList');
  host.textContent = '';
  if (!state.invoices.length) {
    host.appendChild(el('div', 'empty', 'No invoices saved yet.'));
    return;
  }
  state.invoices.forEach((inv) => {
    const li = el('div', 'li');
    const main = el('div', 'li-main');
    main.appendChild(el('div', 'li-title', inv.invoiceNo + '  ·  ' + inv.clientName));
    main.appendChild(el('div', 'li-sub',
      toDisplayDate(inv.invoiceDate) + '  ·  ' + (inv.items || []).length + ' item(s)'));
    li.appendChild(main);
    li.appendChild(el('div', 'li-amt',
      inv.currency + ' ' + R.formatMoney(inv.gross || 0, inv.currency)));

    const open = el('button', 'mini', 'Open');
    open.addEventListener('click', () => {
      setManual(false);
      currentId = inv.id;
      model = Object.assign(newModel(), inv);
      fillForm();
      sync();
      closeModal();
      toast('Loaded ' + inv.invoiceNo);
    });
    li.appendChild(open);

    const del = el('button', 'mini', 'Delete');
    del.addEventListener('click', async () => {
      if (!confirm('Delete invoice ' + inv.invoiceNo + '?')) return;
      await window.api.deleteInvoice(inv.id);
      state = await window.api.getState();
      renderHistory();
    });
    li.appendChild(del);
    host.appendChild(li);
  });
}

function refreshClientList() {
  const dl = $('clientList');
  dl.textContent = '';
  state.clients.forEach((c) => {
    const o = document.createElement('option');
    o.value = c.name;
    dl.appendChild(o);
  });
}

function renderClients() {
  const host = $('clientsList');
  host.textContent = '';
  if (!state.clients.length) {
    host.appendChild(el('div', 'empty', 'No clients saved yet.'));
    return;
  }
  state.clients.forEach((c) => {
    const li = el('div', 'li');
    const main = el('div', 'li-main');
    main.appendChild(el('div', 'li-title', c.name));
    main.appendChild(el('div', 'li-sub', c.address || '—'));
    li.appendChild(main);

    const use = el('button', 'mini', 'Use');
    use.addEventListener('click', () => {
      $('fClient').value = c.name;
      $('fClientAddress').value = c.address || '';
      sync();
      closeModal();
    });
    li.appendChild(use);

    const del = el('button', 'mini', 'Delete');
    del.addEventListener('click', async () => {
      await window.api.deleteClient(c.name);
      state = await window.api.getState();
      renderClients();
      refreshClientList();
    });
    li.appendChild(del);
    host.appendChild(li);
  });
}

/* "VISA SERVICE | country" — the field part is optional and defaults to text. */
function servicesToText(list) {
  return R.normalizeServices(list)
    .map((s) => (s.field === 'text' ? s.name : s.name + ' | ' + s.field))
    .join('\n');
}
function textToServices(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, field] = l.split('|');
    const kind = (field || '').trim().toLowerCase();
    return {
      name: name.trim(),
      field: R.FIELD_HEADERS[kind] ? kind : 'text'
    };
  }).filter((s) => s.name);
}

function branchesToText(list) {
  return list.map((b) => b.code + ' | ' + b.label).join('\n');
}
function textToBranches(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [code, ...rest] = l.split('|');
    const c = code.trim().toUpperCase();
    return { code: c, label: (rest.join('|').trim() || c) };
  });
}

function fillSettings() {
  const s = state.settings;
  $('sName').value = s.company.name;
  $('sAddress').value = s.company.address;
  $('sContact').value = s.company.contact;
  $('sEmail').value = s.company.email;
  $('sWebsite').value = s.company.website;
  $('sBeneficiary').value = s.bank.beneficiary;
  $('sBankName').value = s.bank.bankName;
  $('sBranchCode').value = s.bank.branchCode;
  $('sSwift').value = s.bank.swift;
  $('sAccZMW').value = s.bank.accZMW;
  $('sAccUSD').value = s.bank.accUSD;
  $('sDisclaimer').value = s.disclaimer.join('\n');
  $('sFooterNote').value = s.footerNote;
  $('sShowStamp').checked = s.showStamp !== false;
  $('sTotalsEveryPage').checked = s.totalsEveryPage === true;
  $('sStatementTitle').value = s.statementTitle || 'Ledger Account';
  $('sDefaultParticulars').value = s.defaultParticulars || 'Journal';
  $('sVchTypes').value = (s.vchTypes || SR.VCH_TYPES).join('\n');
  $('sStmtTotalsEveryPage').checked = s.statementTotalsEveryPage === true;
  $('sBranches').value = branchesToText(s.branches);
  $('sServices').value = servicesToText(s.services);

  const host = $('counterList');
  host.textContent = '';
  const keys = Object.keys(state.counters).sort();
  if (!keys.length) {
    host.appendChild(el('div', 'empty', 'Nothing issued yet.'));
    return;
  }
  keys.forEach((key) => {
    const li = el('div', 'li');
    const main = el('div', 'li-main');
    main.appendChild(el('div', 'li-title', key));
    main.appendChild(el('div', 'li-sub', 'next: ' + key + '/INV' +
      String(state.counters[key] + 1).padStart(6, '0')));
    li.appendChild(main);
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.value = state.counters[key];
    input.dataset.key = key;
    li.appendChild(input);
    host.appendChild(li);
  });
}

async function saveSettings() {
  const settings = {
    company: {
      name: $('sName').value, address: $('sAddress').value, contact: $('sContact').value,
      email: $('sEmail').value, website: $('sWebsite').value
    },
    bank: {
      beneficiary: $('sBeneficiary').value, bankName: $('sBankName').value,
      branchCode: $('sBranchCode').value, swift: $('sSwift').value,
      accZMW: $('sAccZMW').value, accUSD: $('sAccUSD').value
    },
    disclaimer: $('sDisclaimer').value.split('\n').map((l) => l.trim()).filter(Boolean),
    footerNote: $('sFooterNote').value,
    showStamp: $('sShowStamp').checked,
    totalsEveryPage: $('sTotalsEveryPage').checked,
    statementTitle: $('sStatementTitle').value.trim() || 'Ledger Account',
    defaultParticulars: $('sDefaultParticulars').value.trim() || 'Journal',
    vchTypes: $('sVchTypes').value.split('\n').map((l) => l.trim()).filter(Boolean),
    statementTotalsEveryPage: $('sStmtTotalsEveryPage').checked,
    branches: textToBranches($('sBranches').value),
    services: textToServices($('sServices').value)
  };
  if (!settings.branches.length) settings.branches = state.settings.branches;
  if (!settings.services.length) settings.services = R.normalizeServices(state.settings.services);
  if (!settings.vchTypes.length) settings.vchTypes = SR.VCH_TYPES.slice();

  await window.api.saveSettings(settings);
  for (const input of $('counterList').querySelectorAll('input[data-key]')) {
    await window.api.setCounter(input.dataset.key, input.value);
  }
  state = await window.api.getState();
  fillLists();
  closeModal();
  sync();
  toast('Settings saved');
}

/* Every ISO currency, with ZMW and USD pinned to the top and shown bold. */
function fillCurrencies() {
  ['fCurrency', 'tCurrency'].forEach((id) => {
    const sel = $(id);
    const keep = sel.value;
    sel.textContent = '';
    R.CURRENCY_ORDER.forEach((code) => {
      const cur = R.CURRENCY[code];
      const o = document.createElement('option');
      o.value = code;
      o.textContent = cur.name;
      if (cur.pinned) o.className = 'pinned';
      sel.appendChild(o);
    });
    sel.value = keep && R.CURRENCY[keep] ? keep : 'ZMW';
  });
}

function fillLists() {
  const branch = $('fBranch');
  const keep = branch.value;
  branch.textContent = '';
  state.settings.branches.forEach((b) => {
    const o = document.createElement('option');
    o.value = b.code;
    o.textContent = b.label;
    branch.appendChild(o);
  });
  branch.value = state.settings.branches.some((b) => b.code === keep)
    ? keep : state.settings.branches[0].code;
  model.branch = branch.value;

  refreshClientList();
}

/* ------------------------------------------------------------------ *
 *  wiring
 * ------------------------------------------------------------------ */

function bind() {
  ['fInvoiceNo', 'fDate', 'fCurrency', 'fClient', 'fClientAddress', 'fLpo']
    .forEach((id) => $(id).addEventListener('input', sync));
  $('fCurrency').addEventListener('change', sync);

  $('fBranch').addEventListener('change', autoNumber);
  $('btnAutoNo').addEventListener('click', autoNumber);

  /* Picking a saved client fills its address too. */
  $('fClient').addEventListener('change', () => {
    const hit = state.clients.find(
      (c) => c.name.toLowerCase() === $('fClient').value.trim().toLowerCase());
    if (hit && !$('fClientAddress').value.trim()) $('fClientAddress').value = hit.address || '';
    sync();
  });

  $('btnAddRow').addEventListener('click', () => {
    readForm();
    model.items.push(blankItem());
    renderItemRows();
    sync();
  });

  $('btnImport').addEventListener('click', openImport);
  $('btnDoImport').addEventListener('click', applyImport);
  $('impSheet').addEventListener('change', reguessImport);
  $('impHeader').addEventListener('change', reguessImport);
  $('updBtn').addEventListener('click', () => window.api.installUpdate());
  if (window.api.onUpdate) window.api.onUpdate(showUpdate);

  $('btnNew').addEventListener('click', doNew);
  $('btnSave').addEventListener('click', () => doSave(false));
  $('btnPdf').addEventListener('click', doExportPdf);
  $('btnXlsx').addEventListener('click', doExportXlsx);

  $('btnHistory').addEventListener('click', () => { renderHistory(); openModal('mHistory'); });
  $('btnClients').addEventListener('click', () => { renderClients(); openModal('mClients'); });
  $('btnSettings').addEventListener('click', () => { fillSettings(); openModal('mSettings'); });
  $('btnSaveSettings').addEventListener('click', saveSettings);

  $('btnAddClient').addEventListener('click', async () => {
    const name = $('cName').value.trim();
    if (!name) { toast('Enter a client name', true); return; }
    await window.api.upsertClient({ name: name, address: $('cAddr').value });
    state = await window.api.getState();
    $('cName').value = ''; $('cAddr').value = '';
    renderClients();
    refreshClientList();
  });

  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
  $('overlay').addEventListener('mousedown', (e) => { if (e.target === $('overlay')) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('overlay').hidden) closeModal();
    if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(false); }
    if (e.ctrlKey && e.key.toLowerCase() === 'p') { e.preventDefault(); doExportPdf(); }
  });

  $('tglManual').addEventListener('change', (e) => {
    if (!e.target.checked &&
        !confirm('Turn off manual editing?\n\nThe invoice will be rebuilt from the form and any typing done directly on the page will be lost.')) {
      e.target.checked = true;
      return;
    }
    setManual(e.target.checked);
  });

  $('zoomIn').addEventListener('click', () => { zoom = Math.min(2, zoom + 0.1); applyZoom(); });
  $('zoomOut').addEventListener('click', () => { zoom = Math.max(0.25, zoom - 0.1); applyZoom(); });
  $('zoomFit').addEventListener('click', toggleFitMode);
  $('btnWide').addEventListener('click', () => setWideView(!wideView));
  window.addEventListener('resize', fitZoom);

  bindStatement();
}

async function boot() {
  state = await window.api.getState();
  model = newModel();
  stmt = newStatement();
  bind();
  fillCurrencies();
  fillLists();
  fillForm();
  fillStatementForm();
  await autoNumber();
  fitZoom();
  window.api.version().then((v) => { $('verTag').textContent = 'Example Travel & Tours · v' + v; });
}

/* ================================================================== *
 *  Statement (Ledger Account)
 *
 *  Same three ways in as the invoice: type it, let the app build it
 *  from invoices already saved, or import a spreadsheet.
 * ================================================================== */

function vchTypes() {
  const list = (state.settings.vchTypes || []).filter(Boolean);
  return list.length ? list : SR.VCH_TYPES.slice();
}

/* First of the current month to today: the period an accountant almost
   always wants, and still one click away from any other. */
function monthStartISO() {
  const t = new Date();
  return t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-01';
}

function blankEntry() {
  return {
    date: todayISO(),
    drcr: '',
    particulars: state.settings.defaultParticulars || 'Journal',
    vch: vchTypes()[0] || 'Journal',
    debit: '', credit: '', narration: ''
  };
}

function newStatement() {
  return {
    clientName: '',
    title: state.settings.statementTitle || 'Ledger Account',
    fromDate: monthStartISO(),
    toDate: todayISO(),
    currency: 'ZMW',
    openingBalance: '',
    openingSide: 'Dr',
    entries: [blankEntry()]
  };
}

/* Everything the printed sheet needs: form data plus the fixed settings. */
function statementModel() {
  const s = state.settings;
  const d = Object.assign({}, stmt, {
    company: s.company,
    totalsEveryPage: s.statementTotalsEveryPage === true
  });
  d.pageCounts = measureStatementPages(d);
  return d;
}

/* ------------------------------------------------------------------ *
 *  measured pagination
 * ------------------------------------------------------------------ */

/* A fixed number of entries per page cannot work here. An invoice row is one
   line; a ledger narration is free text and can be one line or six, so the
   only honest way to know where a page ends is to lay the entries out and
   measure them. This renders every entry onto one continuous sheet offscreen,
   reads the real height of each transaction, and hands those to planPages.
   The preview and the exported PDF are built from the same plan, so what is
   on screen is what prints. */
let stmtProbe = null;

function measureStatementPages(d) {
  const all = SR.allEntries(d);
  if (all.length < 2) return null;
  if (!stmtProbe) {
    stmtProbe = document.createElement('div');
    stmtProbe.setAttribute('aria-hidden', 'true');
    stmtProbe.style.cssText =
      'position:absolute;left:-20000px;top:0;visibility:hidden;pointer-events:none;';
    document.body.appendChild(stmtProbe);
  }
  /* One sheet holding the lot, so each row is measured at the width it will
     really print at. pageCounts is passed explicitly to stop this recursing. */
  stmtProbe.innerHTML = SR.buildStatementHTML(
    Object.assign({}, d, { pageCounts: [all.length] }), ASSET_BASE);

  const sheet = stmtProbe.querySelector('.st-sheet');
  const tbody = stmtProbe.querySelector('.st-tbl tbody');
  if (!sheet || !tbody) return null;

  const rows = Array.from(tbody.rows);
  if (rows.length < all.length * 2) return null;

  const heights = [];
  for (let i = 0; i < all.length; i++) {
    heights.push(rows[i * 2].offsetHeight + rows[i * 2 + 1].offsetHeight);
  }
  /* Whatever follows the entry pairs is the closing block. */
  const tailH = rows.slice(all.length * 2)
    .reduce((sum, r) => sum + r.offsetHeight, 0);
  /* Letterhead + party block + column headings, measured rather than assumed:
     a long company address makes the header taller. +4 covers the sheet's own
     bottom border and sub-pixel rounding. */
  const headerH = tbody.getBoundingClientRect().top -
    sheet.getBoundingClientRect().top + 4;

  return SR.planPages(heights, headerH, tailH, d.totalsEveryPage === true);
}

/* ------------------------------------------------------------------ *
 *  form  <->  model
 * ------------------------------------------------------------------ */

function fillStatementForm() {
  $('tClient').value = stmt.clientName;
  $('tTitle').value = stmt.title;
  $('tFrom').value = stmt.fromDate;
  $('tTo').value = stmt.toDate;
  $('tCurrency').value = stmt.currency;
  $('tOpening').value = stmt.openingBalance;
  $('tOpeningSide').value = stmt.openingSide || 'Dr';
  renderEntryRows();
}

function readStatementForm() {
  stmt.clientName = $('tClient').value;
  stmt.title = $('tTitle').value;
  stmt.fromDate = $('tFrom').value;
  stmt.toDate = $('tTo').value;
  stmt.currency = $('tCurrency').value;
  stmt.openingBalance = $('tOpening').value;
  stmt.openingSide = $('tOpeningSide').value;
  stmt.entries = Array.from(document.querySelectorAll('.entry-row')).map((row) => ({
    date:        row.querySelector('[data-k=date]').value,
    vch:         row.querySelector('[data-k=vch]').value,
    debit:       row.querySelector('[data-k=debit]').value,
    credit:      row.querySelector('[data-k=credit]').value,
    particulars: row.querySelector('[data-k=particulars]').value,
    narration:   row.querySelector('[data-k=narration]').value,
    drcr:        row.dataset.drcr || ''
  }));
}

/* Debit and Credit are mutually exclusive on a ledger line. Rather than wiping
   what was typed, the unused side greys back so the eye lands on the one
   carrying the figure. */
function markMoneySides(row) {
  const dr = row.querySelector('[data-k=debit]');
  const cr = row.querySelector('[data-k=credit]');
  const hasDr = SR.hasValue(dr.value);
  const hasCr = SR.hasValue(cr.value);
  dr.classList.toggle('off', !hasDr && hasCr);
  cr.classList.toggle('off', !hasCr && hasDr);
}

function renderEntryRows() {
  const host = $('entryRows');
  host.textContent = '';
  stmt.entries.forEach((e, i) => {
    const row = el('div', 'entry-row');
    if (e.drcr) row.dataset.drcr = e.drcr;
    const a = el('div', 'er-a');
    const b = el('div', 'er-b');
    row.appendChild(a);
    row.appendChild(b);

    const date = document.createElement('input');
    date.type = 'date';
    date.dataset.k = 'date';
    date.value = e.date || '';
    date.addEventListener('input', sync);
    a.appendChild(date);

    ['debit', 'credit'].forEach((key) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '0.01';
      input.className = 'num';
      input.dataset.k = key;
      input.placeholder = key === 'debit' ? 'Debit' : 'Credit';
      input.value = e[key] == null ? '' : e[key];
      input.addEventListener('input', () => { markMoneySides(row); sync(); });
      a.appendChild(input);
    });

    const del = el('button', 'row-del', '×');
    del.title = 'Remove this entry';
    del.addEventListener('click', () => {
      readStatementForm();
      stmt.entries.splice(i, 1);
      if (!stmt.entries.length) stmt.entries.push(blankEntry());
      renderEntryRows();
      sync();
    });
    a.appendChild(del);

    const vch = document.createElement('select');
    vch.dataset.k = 'vch';
    const types = vchTypes().slice();
    /* A voucher type removed from Settings must still show on an old
       statement, exactly as a retired service does on an old invoice. */
    if (e.vch && types.indexOf(e.vch) < 0) types.push(e.vch);
    types.forEach((t) => {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = t;
      vch.appendChild(o);
    });
    vch.value = e.vch || types[0] || '';
    vch.addEventListener('change', sync);
    b.appendChild(vch);

    const part = document.createElement('input');
    part.type = 'text';
    part.dataset.k = 'particulars';
    part.placeholder = 'Particulars';
    part.value = e.particulars == null ? '' : e.particulars;
    part.addEventListener('input', sync);
    b.appendChild(part);

    const nar = document.createElement('textarea');
    nar.dataset.k = 'narration';
    nar.rows = 2;
    nar.placeholder = 'Narration — ek passenger per line';
    nar.spellcheck = false;
    nar.value = e.narration == null ? '' : e.narration;
    nar.addEventListener('input', sync);
    row.appendChild(nar);

    markMoneySides(row);
    host.appendChild(row);
  });
}

function updateStatementTotals() {
  const sum = SR.closing(SR.allEntries(stmt));
  const code = stmt.currency;
  $('tDebit').textContent = R.formatMoney(sum.debit, code);
  $('tCredit').textContent = R.formatMoney(sum.credit, code);
  $('tBalance').textContent = sum.side + ' ' + code + ' ' + R.formatMoney(sum.amount, code);
}

/* ------------------------------------------------------------------ *
 *  switching between the two documents
 * ------------------------------------------------------------------ */

function setDocMode(kind) {
  if (kind === docKind) return;
  setManual(false);
  docKind = kind;
  const statement = kind === 'statement';
  $('invoiceForm').hidden = statement;
  $('statementForm').hidden = !statement;
  Array.from(document.querySelectorAll('#docMode .dm')).forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === kind);
  });
  /* Manual editing is an invoice-only affordance; hide the switch rather than
     leave a control that silently does nothing. */
  $('tglManual').closest('.switch').hidden = statement;
  $('manualHint').hidden = statement;
  $('btnXlsx').textContent = 'Excel';
  if (statement) { readStatementForm(); updateStatementTotals(); } else { readForm(); updateTotal(); }
  renderPreview();
  fitZoom();
}

/* ------------------------------------------------------------------ *
 *  save / history
 * ------------------------------------------------------------------ */

async function doSaveStatement(quiet) {
  if (!validateStatement()) return null;
  await window.api.upsertClient({ name: stmt.clientName, address: '' });
  const sum = SR.closing(SR.allEntries(stmt));
  const rec = await window.api.saveStatement(Object.assign({}, stmt, {
    id: currentStmtId,
    debit: sum.debit, credit: sum.credit,
    balance: sum.amount, balanceSide: sum.side,
    manualHtml: manual ? exportHtml() : null
  }));
  currentStmtId = rec.id;
  state = await window.api.getState();
  refreshClientList();
  if (!quiet) toast('Saved — statement for ' + stmt.clientName);
  return rec;
}

function renderStatementHistory() {
  const host = $('historyList');
  host.textContent = '';
  const list = state.statements || [];
  if (!list.length) {
    host.appendChild(el('div', 'empty', 'No statements saved yet.'));
    return;
  }
  list.forEach((st) => {
    const li = el('div', 'li');
    const main = el('div', 'li-main');
    main.appendChild(el('div', 'li-title', st.clientName || '(no client)'));
    main.appendChild(el('div', 'li-sub',
      SR.periodLabel(st) + '  ·  ' + (st.entries || []).length + ' entries'));
    li.appendChild(main);
    li.appendChild(el('div', 'li-amt',
      (st.balanceSide || 'Dr') + ' ' + st.currency + ' ' +
      R.formatMoney(st.balance || 0, st.currency)));

    const open = el('button', 'mini', 'Open');
    open.addEventListener('click', () => {
      setManual(false);
      currentStmtId = st.id;
      stmt = Object.assign(newStatement(), st);
      if (!stmt.entries || !stmt.entries.length) stmt.entries = [blankEntry()];
      fillStatementForm();
      sync();
      closeModal();
      toast('Loaded statement for ' + (st.clientName || ''));
    });
    li.appendChild(open);

    const del = el('button', 'mini', 'Delete');
    del.addEventListener('click', async () => {
      if (!confirm('Delete this statement for ' + (st.clientName || '') + '?')) return;
      await window.api.deleteStatement(st.id);
      state = await window.api.getState();
      renderStatementHistory();
    });
    li.appendChild(del);
    host.appendChild(li);
  });
}

/* ------------------------------------------------------------------ *
 *  Auto fill — build the ledger from invoices the app already holds
 * ------------------------------------------------------------------ */

/* The source statement writes each ticket as PNR, passenger, ticket number,
   route, one line per passenger. The invoice already holds every one of those
   fields, so the narration can be rebuilt rather than retyped. */
function narrationForInvoice(inv) {
  return (inv.items || []).map((it) => {
    return [it.pnr, it.pax, it.ticket, it.route]
      .map((v) => String(v == null ? '' : v).trim())
      .filter(Boolean).join(' ');
  }).filter(Boolean).join('\n');
}

let autoHits = [];

async function openAutoFill() {
  readStatementForm();
  if (!stmt.clientName.trim()) {
    toast('Pehle client name daalo, phir Auto fill', true);
    return;
  }
  autoHits = await window.api.clientInvoices(
    stmt.clientName, stmt.fromDate, stmt.toDate);

  const host = $('autoList');
  host.textContent = '';
  $('autoNote').textContent = autoHits.length
    ? autoHits.length + ' invoice mili "' + stmt.clientName + '" ke liye, ' +
      SR.periodLabel(stmt) + ' me. Jo nahi chahiye uska tick hata do.'
    : 'Is client ke liye is period me koi saved invoice nahi mili. ' +
      'Period badal kar dekho, ya entries khud add karo.';

  autoHits.forEach((inv, i) => {
    const li = el('div', 'li');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.dataset.i = String(i);
    box.style.width = 'auto';
    li.appendChild(box);
    const main = el('div', 'li-main');
    main.appendChild(el('div', 'li-title', inv.invoiceNo));
    main.appendChild(el('div', 'li-sub',
      toDisplayDate(inv.invoiceDate) + '  ·  ' + (inv.items || []).length + ' item(s)'));
    li.appendChild(main);
    li.appendChild(el('div', 'li-amt',
      inv.currency + ' ' + R.formatMoney(inv.gross || 0, inv.currency)));
    host.appendChild(li);
  });

  $('autoReplace').checked = false;
  $('btnDoAuto').disabled = !autoHits.length;
  openModal('mAuto');
}

function applyAutoFill() {
  const picked = Array.from($('autoList').querySelectorAll('input[type=checkbox]'))
    .filter((b) => b.checked)
    .map((b) => autoHits[Number(b.dataset.i)])
    .filter(Boolean);
  if (!picked.length) { toast('Koi invoice select nahi ki', true); return; }

  readStatementForm();
  /* A sale puts the client in debt, so it lands in the Debit column and the
     contra marker reads Cr — the same convention as the source sheet. */
  const rows = picked.map((inv) => ({
    date: inv.invoiceDate,
    drcr: '',
    particulars: state.settings.defaultParticulars || 'Journal',
    vch: 'Journal',
    debit: Number(inv.gross) || 0,
    credit: '',
    narration: narrationForInvoice(inv)
  }));

  stmt.entries = $('autoReplace').checked
    ? rows
    : keptEntries().concat(rows);
  /* An invoice-built ledger is billed in the invoices' own currency. */
  if (picked[0] && picked[0].currency) {
    stmt.currency = picked[0].currency;
    $('tCurrency').value = stmt.currency;
  }
  renderEntryRows();
  sync();
  closeModal();
  toast(rows.length + ' entry add ho gayi');
}

/* A fresh statement starts with one empty row; drop it rather than leaving a
   blank line above what was just added. */
function keptEntries() {
  return stmt.entries.filter((e) =>
    SR.hasValue(e.debit) || SR.hasValue(e.credit) || (e.narration || '').trim());
}

/* ------------------------------------------------------------------ *
 *  Excel / CSV import
 * ------------------------------------------------------------------ */

let timp = null;

function renderStmtImportMapping() {
  const host = $('tImpMap');
  host.innerHTML = '';
  timp.fields.forEach((f) => {
    const lab = el('label', 'field span2');
    lab.appendChild(el('span', null, f.label));
    const sel = document.createElement('select');
    sel.dataset.field = f.key;
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '— not in my file —';
    sel.appendChild(none);
    timp.columns.forEach((c) => {
      const o = document.createElement('option');
      o.value = String(c.index);
      o.textContent = c.label + (c.sample ? '   (' + c.sample.slice(0, 22) + ')' : '');
      sel.appendChild(o);
    });
    const cur = timp.mapping[f.key];
    sel.value = (cur == null) ? '' : String(cur);
    sel.addEventListener('change', reparseStmtImport);
    lab.appendChild(sel);
    host.appendChild(lab);
  });
}

function renderStmtImportPreview() {
  const t = $('tImpTable');
  t.innerHTML = '';
  const code = (stmt && stmt.currency) || 'ZMW';
  const cols = ['#', 'Date', 'Particulars', 'Vch Type', 'Debit', 'Credit', 'Narration'];
  const head = t.insertRow();
  cols.forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h;
    head.appendChild(th);
  });
  timp.entries.slice(0, 40).forEach((e, i) => {
    const tr = t.insertRow();
    tr.insertCell().textContent = String(i + 1);
    tr.insertCell().textContent = SR.shortDate(e.date);
    tr.insertCell().textContent = e.particulars || '';
    tr.insertCell().textContent = e.vch || '';
    [['debit', e.debit], ['credit', e.credit]].forEach(([, v]) => {
      const td = tr.insertCell();
      td.className = 'num';
      td.textContent = SR.hasValue(v) ? R.formatMoney(v, code) : '';
    });
    /* One line is enough to tell whether the right column was picked. */
    tr.insertCell().textContent = String(e.narration || '').split('\n')[0].slice(0, 48);
  });

  const sk = timp.skipped || { blank: 0, totals: 0, narrations: 0 };
  const extra = [];
  if (sk.totals) extra.push(sk.totals + ' total/balance row');
  if (sk.blank) extra.push(sk.blank + ' blank row');
  $('tImpCount').textContent =
    timp.entries.length + ' entr' + (timp.entries.length === 1 ? 'y' : 'ies') + ' mili' +
    (sk.narrations ? '  —  ' + sk.narrations + ' narration alag row se jodi gayi' : '') +
    (extra.length ? '  —  ' + extra.join(' aur ') + ' chhoda gaya' : '') +
    (timp.entries.length > 40 ? '   (neeche pehli 40 dikha rahe hain)' : '');

  const noAmount = timp.entries.filter(
    (e) => !SR.hasValue(e.debit) && !SR.hasValue(e.credit)).length;
  $('tImpFile').textContent = timp.fileName + '  —  sheet "' + timp.sheet + '"' +
    (timp.headerRow >= 0 ? ', header row ' + (timp.headerRow + 1) : ', koi header row nahi mili') +
    (noAmount ? '   ⚠ ' + noAmount + ' entry me Debit/Credit nahi mila' : '');
}

async function reparseStmtImport() {
  const mapping = {};
  Array.from($('tImpMap').querySelectorAll('select')).forEach((sel) => {
    if (sel.value !== '') mapping[sel.dataset.field] = Number(sel.value);
  });
  const res = await window.api.stmtImportReread({
    file: timp.file, sheet: $('tImpSheet').value,
    mapping: mapping, headerRow: Number($('tImpHeader').value)
  });
  if (!res.ok) { toast(res.error || 'File dobara padhi nahi ja saki', true); return; }
  timp = res.result;
  renderStmtImportPreview();
}

/* Sheet or header-row change invalidates the mapping, so let the parser guess
   again rather than forcing old column numbers onto new columns. */
async function reguessStmtImport() {
  const res = await window.api.stmtImportReread({
    file: timp.file, sheet: $('tImpSheet').value, headerRow: Number($('tImpHeader').value)
  });
  if (!res.ok) { toast(res.error || 'File dobara padhi nahi ja saki', true); return; }
  timp = res.result;
  renderStmtImportMapping();
  renderStmtImportPreview();
}

async function openStmtImport() {
  const res = await window.api.stmtImportPick();
  if (res.canceled) return;
  if (!res.ok) { toast(res.error || 'Ye file padhi nahi ja saki', true); return; }
  timp = res.result;

  const sheetSel = $('tImpSheet');
  sheetSel.innerHTML = '';
  timp.sheetNames.forEach((n) => {
    const o = document.createElement('option');
    o.value = n; o.textContent = n;
    sheetSel.appendChild(o);
  });
  sheetSel.value = timp.sheet;

  const hdrSel = $('tImpHeader');
  hdrSel.innerHTML = '';
  const noHdr = document.createElement('option');
  noHdr.value = '-1'; noHdr.textContent = 'No header row';
  hdrSel.appendChild(noHdr);
  for (let r = 0; r < 40; r++) {
    const o = document.createElement('option');
    o.value = String(r); o.textContent = 'Row ' + (r + 1);
    hdrSel.appendChild(o);
  }
  hdrSel.value = String(timp.headerRow);

  $('tImpReplace').checked = false;
  renderStmtImportMapping();
  renderStmtImportPreview();
  openModal('mStmtImport');
}

function applyStmtImport() {
  if (!timp || !timp.entries.length) {
    toast('Import karne ke liye koi entry nahi mili', true);
    return;
  }
  readStatementForm();
  const fallback = state.settings.defaultParticulars || 'Journal';
  const rows = timp.entries.map((e) => ({
    date: e.date || '',
    drcr: e.drcr || '',
    particulars: e.particulars || fallback,
    vch: e.vch || '',
    debit: SR.hasValue(e.debit) ? e.debit : '',
    credit: SR.hasValue(e.credit) ? e.credit : '',
    narration: e.narration || ''
  }));
  stmt.entries = $('tImpReplace').checked ? rows : keptEntries().concat(rows);
  renderEntryRows();
  sync();
  closeModal();
  toast(rows.length + ' entry import ho gayi');
}

/* ------------------------------------------------------------------ *
 *  wiring
 * ------------------------------------------------------------------ */

function bindStatement() {
  Array.from(document.querySelectorAll('#docMode .dm')).forEach((b) => {
    b.addEventListener('click', () => setDocMode(b.dataset.mode));
  });

  ['tClient', 'tTitle', 'tFrom', 'tTo', 'tOpening']
    .forEach((id) => $(id).addEventListener('input', sync));
  ['tCurrency', 'tOpeningSide']
    .forEach((id) => $(id).addEventListener('change', sync));

  $('btnAddEntry').addEventListener('click', () => {
    readStatementForm();
    stmt.entries.push(blankEntry());
    renderEntryRows();
    sync();
  });

  $('btnAutoFill').addEventListener('click', openAutoFill);
  $('btnDoAuto').addEventListener('click', applyAutoFill);
  $('btnStmtImport').addEventListener('click', openStmtImport);
  $('btnDoStmtImport').addEventListener('click', applyStmtImport);
  $('tImpSheet').addEventListener('change', reguessStmtImport);
  $('tImpHeader').addEventListener('change', reguessStmtImport);
}

boot();
