/* Dev harness: screenshots the printable HTML at true A4 size.

   printToPDF gives a file nobody in this toolchain can open, so this renders
   the same document into a window sized to a real A4 sheet (96dpi, margins
   included) and captures it. What comes out is what the PDF looks like.

   Run with:
     node_modules/electron/dist/electron.exe tools/test-shot.js <invoice|statement> <out.png> [count] [scale]
   Not shipped — package.json "build.files" only includes src/ and assets/. */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const D = require('../src/defaults');
const IR = require('../src/invoice-render');
const SR = require('../src/statement-render');
const { printDocument } = require('../src/pdf-export');

const KIND = process.argv[2] || 'statement';
const OUT = process.argv[3] || path.join(__dirname, 'shot.png');
const COUNT = Number(process.argv[4]) || 0;
const SCALE = Number(process.argv[5]) || 2;

/* A4 at 96dpi, with the PDF export's own margins (0.39in / 0.47in). */
const A4 = KIND === 'statement' ? { w: 794, h: 1123 } : { w: 1123, h: 794 };
const PAD = { v: Math.round(0.39 * 96), h: Math.round(0.47 * 96) };

function statementData() {
  const d = {
    clientName: 'Example Commodities Exchange',
    title: 'Ledger Account',
    fromDate: '2026-05-15',
    toDate: '2026-08-24',
    currency: 'ZMW',
    openingBalance: '',
    openingSide: 'Dr',
    company: D.company,
    totalsEveryPage: false,
    entries: [
      { date: '2026-05-15', particulars: 'Journal', vch: 'Journal', debit: 22755, credit: '',
        narration: 'DDD444 1TRAVELLER/HOTEL 000-0000000003-004 LUN DOD LUN' },
      { date: '2026-05-15', particulars: 'Journal', vch: 'Receipt', debit: '', credit: 22755,
        narration: 'Amount Received From Example Limited  ZMW 22,755.00' },
      { date: '2026-05-20', particulars: 'Journal', vch: 'Receipt', debit: '', credit: 1470,
        narration: 'Amount Received From Example Limited  ZMW 1,470.00' },
      { date: '2026-05-21', particulars: 'Journal', vch: 'Journal', debit: 1470, credit: '',
        narration: '* Example Boutique Hotel - Taipei Branch 3Star* ( Dummy Hotel Booking )' },
      { date: '2026-05-27', particulars: 'Journal', vch: 'Journal', debit: 69370, credit: '',
        narration: 'EEE555 1TRAVELLER/INDIA   0000000000001-002 LUN HKG LUN\nEEE555 1TRAVELLER/JULIET 0000000000003-004 LUN HKG LUN' },
      { date: '2026-05-30', particulars: 'Journal', vch: 'Journal', debit: 12630, credit: '',
        narration: 'EEE555 1TRAVELLER/INDIA 0000000000005-006 REISSUED\nEEE555 1TRAVELLER/JULIET 0000000000007-008 REISSUED' },
      { date: '2026-07-02', particulars: 'Journal', vch: 'Journal', debit: 8430, credit: '',
        narration: 'FFF666 659 Proflight Zambia TRAVELLER/KILO 000-0000000005 LUN NLA LUN' },
      { date: '2026-07-02', particulars: 'Journal', vch: 'Journal', debit: 8790, credit: '',
        narration: 'GGG777 659 Proflight Zambia TRAVELLER/INDIA 000-0000000006 LUN NLA LUN' },
      { date: '2026-07-14', particulars: 'Journal', vch: 'Receipt', debit: '', credit: 69370,
        narration: 'Amount Received From Example Limited  ZMW 69,370.00' },
      { date: '2026-07-16', particulars: 'Journal', vch: 'Receipt', debit: '', credit: 8790,
        narration: 'Amount Received From Example Limited  ZMW 8,790.00' }
    ]
  };
  if (COUNT && COUNT <= d.entries.length) {
    d.entries = d.entries.slice(0, COUNT);
  } else if (COUNT) {
    for (let i = d.entries.length; i < COUNT; i++) {
      const receipt = i % 3 === 2;
      const amount = 1000 + i * 213.45;
      d.entries.push({
        date: '2026-0' + (6 + (i % 3)) + '-' + String((i % 27) + 1).padStart(2, '0'),
        particulars: 'Journal',
        vch: receipt ? 'Receipt' : 'Journal',
        debit: receipt ? '' : amount,
        credit: receipt ? amount : '',
        narration: receipt
          ? 'Amount Received From Example Limited  ZMW ' + amount.toFixed(2)
          : 'EEE555 1SURNAME' + (i + 1) + '/GIVENNAME 000000000' + (9400 + i) + ' LUN JNB LUN'
      });
    }
  }
  return d;
}

app.commandLine.appendSwitch('force-device-scale-factor', String(SCALE));

app.whenReady().then(async () => {
  const data = statementData();
  const body = KIND === 'statement'
    ? SR.buildStatementHTML(data, '../../')
    : IR.buildInvoiceHTML(Object.assign({}, data, {
        items: [], bank: D.bank, disclaimer: D.disclaimer, footerNote: D.footerNote
      }), '../../');

  /* The sheet gap becomes a page break in print; on screen it separates the
     sheets so each capture shows one page's worth of paper. */
  const doc = printDocument(body, KIND).replace(
    '</head>',
    '<style>body{padding:' + PAD.v + 'px ' + PAD.h + 'px;width:' + A4.w + 'px;' +
    'box-sizing:border-box;background:#fff;}</style></head>');

  const win = new BrowserWindow({
    width: A4.w, height: A4.h, show: false,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false }
  });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(doc));
    await new Promise((r) => setTimeout(r, 500));

    const box = await win.webContents.executeJavaScript(`(() => {
      const sheets = Array.from(document.querySelectorAll('.sheet'));
      return {
        pages: sheets.length,
        docHeight: document.documentElement.scrollHeight,
        heights: sheets.map((s) => Math.round(s.getBoundingClientRect().height)),
        printable: ${A4.h - PAD.v * 2}
      };
    })()`);
    console.log(JSON.stringify(box));

    /* Grow the window to the whole document so every page lands in one image. */
    win.setContentSize(A4.w, Math.min(16000, Math.max(A4.h, box.docHeight + PAD.v)));
    await new Promise((r) => setTimeout(r, 400));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(OUT, img.toPNG());
    console.log('SHOT ' + OUT + '  ' + img.getSize().width + 'x' + img.getSize().height);
    app.exit(0);
  } catch (err) {
    console.error('SHOT_FAIL ' + err.stack);
    app.exit(1);
  }
});
