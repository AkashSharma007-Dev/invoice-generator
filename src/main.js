const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { writeInvoiceXlsx } = require('./xlsx-export');
const { renderPdf, ASSETS } = require('./pdf-export');
const { readInvoiceItems } = require('./xlsx-import');
const { writeStatementXlsx } = require('./xlsx-statement');
const { readStatementEntries } = require('./statement-import');
const { initUpdates, checkForUpdates, quitAndInstall } = require('./updater');

let win = null;

function createWindow() {
  /* Never open bigger than the screen actually is. On the accountant's 14"
     laptop a fixed 1480x940 window opened taller than the desktop, so the
     bottom of the preview — and the bottom of the invoice with it — sat off
     the edge of the panel where it could not be scrolled to. The work area
     already excludes the taskbar. */
  const work = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1480, work.width);
  const height = Math.min(940, work.height);

  win = new BrowserWindow({
    width: width,
    height: height,
    minWidth: Math.min(980, width),
    minHeight: Math.min(620, height),
    backgroundColor: '#eef1f6',
    show: false,
    autoHideMenuBar: true,
    title: 'Invoice Generator',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => {
    win.show();
    /* Give the window a moment to paint before touching the network. */
    initUpdates(win);
    setTimeout(() => checkForUpdates(false), 4000);
  });
}

app.whenReady().then(() => {
  store.init(app.getPath('userData'));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ *
 *  IPC
 * ------------------------------------------------------------------ */

ipcMain.handle('store:get', () => store.getState());
ipcMain.handle('store:saveSettings', (e, s) => store.saveSettings(s));
ipcMain.handle('store:peekNo', (e, branch, year) => store.peekInvoiceNo(branch, year));
ipcMain.handle('store:commitNo', (e, branch, year, serial) => store.commitInvoiceNo(branch, year, serial));
ipcMain.handle('store:setCounter', (e, key, value) => store.setCounter(key, value));
ipcMain.handle('store:upsertClient', (e, c) => store.upsertClient(c));
ipcMain.handle('store:deleteClient', (e, name) => store.deleteClient(name));
ipcMain.handle('store:saveInvoice', (e, inv) => store.saveInvoice(inv));
ipcMain.handle('store:deleteInvoice', (e, id) => store.deleteInvoice(id));
ipcMain.handle('store:saveStatement', (e, st) => store.saveStatement(st));
ipcMain.handle('store:deleteStatement', (e, id) => store.deleteStatement(id));
ipcMain.handle('store:clientInvoices', (e, name, from, to) =>
  store.invoicesForClient(name, from, to));

/* One handler for both documents: "kind" decides the page orientation and
   which stylesheets the print window is given. */
ipcMain.handle('export:pdf', async (e, { html, invoiceNo, clientName, kind }) => {
  const suggested = safeName(invoiceNo + ' ' + (clientName || '')) + '.pdf';
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: kind === 'statement' ? 'Save statement PDF' : 'Save invoice PDF',
    defaultPath: path.join(app.getPath('documents'), suggested),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(filePath, await renderPdf(html, kind));
    return { ok: true, filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('export:xlsx', async (e, { data, invoiceNo, clientName }) => {
  const suggested = safeName(invoiceNo + ' ' + (clientName || '')) + '.xlsx';
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save invoice Excel',
    defaultPath: path.join(app.getPath('documents'), suggested),
    filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    await writeInvoiceXlsx(data, filePath, ASSETS);
    return { ok: true, filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* Import: pick a spreadsheet, then re-read it whenever the user corrects the
   column mapping in the preview. Parsing lives in the main process because
   ExcelJS needs real file access. */
ipcMain.handle('import:pick', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import passenger list',
    properties: ['openFile'],
    filters: [
      { name: 'Spreadsheet', extensions: ['xlsx', 'xlsm', 'csv'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (canceled || !filePaths || !filePaths.length) return { ok: false, canceled: true };
  try {
    return { ok: true, result: await readInvoiceItems(filePaths[0]) };
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

ipcMain.handle('export:statementXlsx', async (e, { data, clientName }) => {
  const suggested = safeName('Statement ' + (clientName || '')) + '.xlsx';
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save statement Excel',
    defaultPath: path.join(app.getPath('documents'), suggested),
    filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    await writeStatementXlsx(data, filePath, ASSETS);
    return { ok: true, filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* The statement importer is a separate vocabulary over the same engine, so it
   gets its own pair of channels rather than a mode flag on the invoice one. */
ipcMain.handle('stmtImport:pick', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import ledger entries',
    properties: ['openFile'],
    filters: [
      { name: 'Spreadsheet', extensions: ['xlsx', 'xlsm', 'csv'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (canceled || !filePaths || !filePaths.length) return { ok: false, canceled: true };
  try {
    return { ok: true, result: await readStatementEntries(filePaths[0]) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('stmtImport:reread', async (e, { file, sheet, mapping, headerRow }) => {
  try {
    return { ok: true, result: await readStatementEntries(file, { sheet, mapping, headerRow }) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('update:check', () => checkForUpdates(true));
ipcMain.handle('update:install', () => quitAndInstall());

ipcMain.handle('shell:showItem', (e, filePath) => { shell.showItemInFolder(filePath); });
ipcMain.handle('app:version', () => app.getVersion());
