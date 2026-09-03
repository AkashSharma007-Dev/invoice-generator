/* Turns the invoice or statement HTML into a PDF using an offscreen Chromium
   window, so the printed page is laid out by the same engine as the live
   preview. */
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');

const ASSETS = path.join(__dirname, '..', 'assets');
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

/* Assets become data: URIs so the print window never resolves a relative
   path — those break once the app is packed into app.asar. */
function inlineAssets(html) {
  return html.replace(/src="(?:\.\.\/)*assets\/([^"]+)"/g, (whole, file) => {
    const full = path.join(ASSETS, path.basename(file));
    try {
      const mime = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
      return 'src="data:' + mime + ';base64,' + fs.readFileSync(full).toString('base64') + '"';
    } catch (e) {
      return whole;
    }
  });
}

/* A statement needs invoice.css too — it reuses the letterhead component and
   the :root colour variables — but statement.css has to come second so its
   @page portrait rule wins over the invoice's landscape one. */
const SHEETS = {
  invoice: ['invoice.css'],
  statement: ['invoice.css', 'statement.css']
};

function printDocument(bodyHtml, kind) {
  const css = (SHEETS[kind] || SHEETS.invoice)
    .map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8'))
    .join('\n');
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<style>html,body{margin:0;padding:0;background:#fff;}' + css + '</style>' +
    '</head><body>' + inlineAssets(bodyHtml) + '</body></html>';
}

/**
 * @param {string} bodyHtml
 * @param {string} [kind]  "invoice" (A4 landscape) or "statement" (A4 portrait)
 */
async function renderPdf(bodyHtml, kind) {
  const hidden = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false }
  });
  try {
    await hidden.loadURL('data:text/html;charset=utf-8,' +
      encodeURIComponent(printDocument(bodyHtml, kind)));
    /* Let Chromium lay out the embedded images before capture. */
    await new Promise((r) => setTimeout(r, 250));
    return await hidden.webContents.printToPDF({
      pageSize: 'A4',
      landscape: kind !== 'statement',
      printBackground: true,
      margins: { marginType: 'custom', top: 0.39, bottom: 0.39, left: 0.47, right: 0.47 }
    });
  } finally {
    hidden.destroy();
  }
}

module.exports = { renderPdf, printDocument, inlineAssets, ASSETS };
