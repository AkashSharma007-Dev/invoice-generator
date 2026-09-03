/* Dev harness: boots the real renderer and drives it, so the form, the live
   preview and the modals are all exercised as the accountant would.

   Store data goes to a throwaway folder rather than the real invoice-data.json,
   and the two file dialogs are replaced by fixtures — everything else is the
   production code path.

   Run with:
     node_modules/electron/dist/electron.exe tools/test-ui.js <shotDir> [width] [height]
   Not shipped — package.json "build.files" only includes src/ and assets/. */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SHOTS = process.argv[2] || path.join(__dirname, 'shots');
const WIDTH = Number(process.argv[3]) || 1366;
const HEIGHT = Number(process.argv[4]) || 768;
const FIXTURE = 'C:/Users/Lenovo/Downloads/Statement Format Zambia.xlsx';

/* A scratch userData dir keeps the developer's own saved invoices out of it. */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'invgen-uitest-'));
app.setPath('userData', DATA);

const store = require('../src/store');
const { readInvoiceItems } = require('../src/xlsx-import');
const { readStatementEntries } = require('../src/statement-import');

ipcMain.handle('store:get', () => store.getState());
ipcMain.handle('store:saveSettings', (e, s) => store.saveSettings(s));
ipcMain.handle('store:peekNo', (e, b, y) => store.peekInvoiceNo(b, y));
ipcMain.handle('store:commitNo', (e, b, y, n) => store.commitInvoiceNo(b, y, n));
ipcMain.handle('store:setCounter', (e, k, v) => store.setCounter(k, v));
ipcMain.handle('store:upsertClient', (e, c) => store.upsertClient(c));
ipcMain.handle('store:deleteClient', (e, n) => store.deleteClient(n));
ipcMain.handle('store:saveInvoice', (e, inv) => store.saveInvoice(inv));
ipcMain.handle('store:deleteInvoice', (e, id) => store.deleteInvoice(id));
ipcMain.handle('store:saveStatement', (e, st) => store.saveStatement(st));
ipcMain.handle('store:deleteStatement', (e, id) => store.deleteStatement(id));
ipcMain.handle('store:clientInvoices', (e, n, f, t) => store.invoicesForClient(n, f, t));
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('update:check', () => ({ ok: true }));
ipcMain.handle('update:install', () => ({ ok: true }));
ipcMain.handle('shell:showItem', () => {});

ipcMain.handle('import:pick', async () => {
  try { return { ok: true, result: await readInvoiceItems(FIXTURE) }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('import:reread', async (e, o) => {
  try { return { ok: true, result: await readInvoiceItems(o.file, o) }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('stmtImport:pick', async () => {
  try { return { ok: true, result: await readStatementEntries(FIXTURE) }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('stmtImport:reread', async (e, o) => {
  try { return { ok: true, result: await readStatementEntries(o.file, o) }; }
  catch (err) { return { ok: false, error: err.message }; }
});

const errors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

setTimeout(() => { console.log('TIMEOUT — forcing exit'); app.exit(2); }, 90000);

app.whenReady().then(async () => {
  store.init(app.getPath('userData'));
  fs.mkdirSync(SHOTS, { recursive: true });

  const win = new BrowserWindow({
    width: WIDTH, height: HEIGHT, show: false,
    webPreferences: {
      preload: path.join(__dirname, '../src/preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      /* Offscreen: capturePage on a real window returns an empty image when
         the desktop has it occluded, which makes the harness silently useless. */
      offscreen: true
    }
  });
  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) errors.push(message);
  });
  win.webContents.on('preload-error', (e, f, err) => errors.push('PRELOAD ' + err.message));

  await win.loadFile(path.join(__dirname, '../src/ui/index.html'));
  await wait(1400);

  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(SHOTS, name + '.png'), img.toPNG());
    console.log('SHOT ' + name);
  };

  const run = async (label, code) => {
    try {
      const out = await win.webContents.executeJavaScript(code);
      if (out !== undefined) console.log(label + ': ' + JSON.stringify(out));
      return out;
    } catch (err) {
      errors.push(label + ' threw: ' + err.message);
      return null;
    }
  };

  /* ---- 1. invoice, as the accountant first sees it ---- */
  await run('invoice size', `(() => {
    const c = document.getElementById('canvas');
    const sheet = document.querySelector('#stage .sheet');
    return { canvasW: c.clientWidth, canvasH: c.clientHeight,
             sheetW: sheet && sheet.offsetWidth, sheetH: sheet && sheet.offsetHeight,
             zoom: document.getElementById('zoomVal').textContent };
  })()`);
  await shot('01-invoice');

  /* ---- 2. statement, typed by hand ---- */
  await run('switch', `setDocMode('statement')`);
  await wait(300);
  await run('manual entry', `(() => {
    document.getElementById('tClient').value = 'Example Commodities Exchange';
    document.getElementById('tFrom').value = '2026-05-15';
    document.getElementById('tTo').value = '2026-08-24';
    stmt.entries = [
      { date:'2026-05-15', particulars:'Journal', vch:'Journal', debit:22755, credit:'',
        narration:'DDD444 1TRAVELLER/HOTEL 000-0000000003-004 LUN DOD LUN' },
      { date:'2026-05-15', particulars:'Journal', vch:'Receipt', debit:'', credit:22755,
        narration:'Amount Received From Example Limited  ZMW 22,755.00' }
    ];
    renderEntryRows();
    sync();
    return { debit: document.getElementById('tDebit').textContent,
             credit: document.getElementById('tCredit').textContent,
             balance: document.getElementById('tBalance').textContent,
             zoom: document.getElementById('zoomVal').textContent };
  })()`);
  await wait(300);
  await shot('02-statement-manual');

  /* ---- 3. import the source statement back in ---- */
  await run('open import', `openStmtImport()`);
  await wait(1200);
  await run('import state', `(() => ({
    open: !document.getElementById('mStmtImport').hidden,
    file: document.getElementById('tImpFile').textContent,
    count: document.getElementById('tImpCount').textContent,
    map: Array.from(document.querySelectorAll('#tImpMap select'))
      .map(s => s.dataset.field + '=' + (s.value === '' ? 'none' : s.options[s.selectedIndex].textContent)),
    rows: document.querySelectorAll('#tImpTable tr').length - 1
  }))()`);
  await shot('03-statement-import');

  await run('apply import', `(() => { document.getElementById('tImpReplace').checked = true; applyStmtImport(); })()`);
  await wait(600);
  await run('after import', `(() => ({
    entries: stmt.entries.length,
    debit: document.getElementById('tDebit').textContent,
    credit: document.getElementById('tCredit').textContent,
    balance: document.getElementById('tBalance').textContent,
    pages: document.querySelectorAll('#stage .st-sheet').length,
    zoom: document.getElementById('zoomVal').textContent
  }))()`);
  await shot('04-statement-imported');

  /* ---- 4. wide view, the 14-inch escape hatch ---- */
  await run('wide', `setWideView(true)`);
  await wait(300);
  await run('wide zoom', `(() => ({ zoom: document.getElementById('zoomVal').textContent }))()`);
  await shot('05-wide-view');
  await run('unwide', `setWideView(false)`);
  await wait(200);

  /* ---- 5. auto fill from a saved invoice ---- */
  await run('seed invoice', `(async () => {
    await window.api.saveInvoice({
      invoiceNo: '26LUN/INV000201', invoiceDate: '2026-06-11',
      clientName: 'Example Commodities Exchange', currency: 'ZMW', gross: 8430,
      items: [{ pnr:'FFF666', pax:'TRAVELLER/KILO', ticket:'000-0000000005',
                route:'LUN NLA LUN', service:'AIR TICKET', amount:8430 }]
    });
    state = await window.api.getState();
    return state.invoices.length;
  })()`);
  await wait(400);
  await run('open auto', `openAutoFill()`);
  await wait(700);
  await run('auto state', `(() => ({
    open: !document.getElementById('mAuto').hidden,
    note: document.getElementById('autoNote').textContent,
    rows: document.querySelectorAll('#autoList .li').length
  }))()`);
  await shot('06-auto-fill');
  await run('apply auto', `applyAutoFill()`);
  await wait(500);
  await run('after auto', `(() => ({
    entries: stmt.entries.length,
    balance: document.getElementById('tBalance').textContent
  }))()`);
  await shot('07-after-auto');

  /* ---- 6. pagination with a long ledger ---- */
  await run('many entries', `(() => {
    const rows = [];
    for (let i = 0; i < 40; i++) {
      rows.push({ date:'2026-06-' + String((i % 28) + 1).padStart(2,'0'),
        particulars:'Journal', vch: i % 3 === 2 ? 'Receipt' : 'Journal',
        debit: i % 3 === 2 ? '' : 1000 + i * 213.45,
        credit: i % 3 === 2 ? 1000 + i * 213.45 : '',
        narration: 'EEE555 1SURNAME' + (i+1) + '/GIVENNAME MR 00000000000' + (10+i) + '-' + (11+i) + ' LUN HKG NRT HKG LUN\\nEEE555 1OTHER' + (i+1) + '/GIVENNAME MR 00000000000' + (30+i) + '-' + (31+i) + ' LUN HKG NRT HKG LUN' });
    }
    stmt.entries = rows;
    renderEntryRows();
    sync();
    const sheets = Array.from(document.querySelectorAll('#stage .st-sheet'));
    return { pages: sheets.length,
             /* offsetHeight, not getBoundingClientRect: the stage is CSS-scaled and
               a scaled rect would not be comparable with the print budget. */
            heights: sheets.map(s => s.offsetHeight),
             budget: 1048 };
  })()`);
  await wait(400);
  await shot('08-statement-paginated');

  /* ---- 6b. worst case: narrations long enough to blow a fixed row count ---- */
  for (const lines of [1, 3, 6]) {
    const out = await run('narration x' + lines, `(() => {
      const rows = [];
      for (let i = 0; i < 26; i++) {
        const nar = [];
        for (let k = 0; k < ${lines}; k++) {
          nar.push('EEE555 1SURNAME' + (i+1) + 'PAX' + (k+1) + '/GIVENNAME MR 000000000' + (9400+i*6+k) + '-' + (9401+i*6+k) + ' LUN HKG NRT HKG LUN');
        }
        rows.push({ date:'2026-06-' + String((i % 28) + 1).padStart(2,'0'),
          particulars:'Journal', vch:'Journal', debit: 10000 + i * 137.5, credit:'',
          narration: nar.join('\\n') });
      }
      stmt.entries = rows;
      renderEntryRows();
      sync();
      const sheets = Array.from(document.querySelectorAll('#stage .st-sheet'));
      const h = sheets.map(s => s.offsetHeight);
      return { pages: sheets.length, max: Math.max.apply(null, h),
               over: h.filter(x => x > 1048).length };
    })()`);
    if (out && out.over) errors.push('PAGE OVERFLOW with ' + lines + '-line narrations: ' + JSON.stringify(out));
  }
  /* ---- 7. settings ---- */
  await run('settings', `(() => { fillSettings(); openModal('mSettings'); })()`);
  await wait(400);
  await shot('09-settings');
  await run('close', `closeModal()`);

  if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'));
  else console.log('NO CONSOLE ERRORS');
  app.exit(errors.length ? 1 : 0);
});
