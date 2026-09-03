/* Dev harness: drives the real import modal without the native file dialog.

   Loads the actual renderer, swaps window.api.importPick for one that returns a
   parse of a fixture file, then opens the modal and screenshots it. This is the
   only way to exercise the mapping dropdowns and preview table end to end —
   the OS file picker cannot be automated.

   Run with:
     node_modules/electron/dist/electron.exe tools/test-import-ui.js <fixture> <out.png>
   Not shipped — package.json "build.files" only includes src/ and assets/. */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { readInvoiceItems } = require('../src/xlsx-import');

const FIXTURE = process.argv[2];
const OUT = process.argv[3] || path.join(__dirname, 'import-ui.png');

/* The renderer talks to the same IPC names as production; only the picker is
   replaced, so everything downstream is the real code path. */
ipcMain.handle('import:pick', async () => {
  try {
    return { ok: true, result: await readInvoiceItems(FIXTURE) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('import:reread', async (e, { file, sheet, mapping, headerRow }) => {
  try {
    return { ok: true, result: await readInvoiceItems(file, { sheet, mapping, headerRow }) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

const store = require('../src/store');
ipcMain.handle('store:get', () => store.getState());
ipcMain.handle('store:peekNo', (e, b, y) => store.peekInvoiceNo(b, y));
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('update:check', () => ({ ok: true }));
ipcMain.handle('update:install', () => ({ ok: true }));

/* Never let a rejected promise leave the harness hanging with no output. */
setTimeout(() => { console.log('TIMEOUT — forcing exit'); app.exit(2); }, 45000);

app.whenReady().then(async () => {
  store.init(app.getPath('userData'));

  const win = new BrowserWindow({
    width: 1480, height: 940, show: true,
    webPreferences: { preload: path.join(__dirname, '../src/preload.js'), contextIsolation: true }
  });

  const errors = [];
  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) errors.push(message);
  });
  win.webContents.on('preload-error', (e, f, err) => errors.push('PRELOAD ' + err.message));

  await win.loadFile(path.join(__dirname, '../src/ui/index.html'));
  await new Promise((r) => setTimeout(r, 1500));

  try {
    await win.webContents.executeJavaScript('openImport()');
  } catch (err) {
    errors.push('openImport() threw: ' + err.message);
  }
  await new Promise((r) => setTimeout(r, 900));

  const report = await win.webContents.executeJavaScript(`(() => ({
    modalOpen: !document.getElementById('mImport').hidden,
    overlayOpen: !document.getElementById('overlay').hidden,
    file: document.getElementById('impFile').textContent,
    count: document.getElementById('impCount').textContent,
    mapSelects: Array.from(document.querySelectorAll('#impMap select'))
      .map((s) => s.dataset.field + '=' + (s.value === '' ? 'none' : s.options[s.selectedIndex].textContent)),
    previewRows: document.querySelectorAll('#impTable tr').length - 1,
    firstRow: Array.from((document.querySelectorAll('#impTable tr')[1] || { cells: [] }).cells)
      .map((c) => c.textContent),
    headerSel: document.getElementById('impHeader').value,
    sheetSel: document.getElementById('impSheet').value
  }))()`);

  console.log(JSON.stringify(report, null, 2));
  if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.join('\n'));

  const img = await win.webContents.capturePage();
  fs.writeFileSync(OUT, img.toPNG());
  console.log('SHOT ' + OUT);
  app.exit(errors.length ? 1 : 0);
});
