/* Dev harness: exercises the real statement PDF path outside the UI.
   Run with:
     node_modules/electron/dist/electron.exe tools/test-statement.js <out.pdf> [currency] [entryCount]
   The sample data is lifted straight from "Statement Format Zambia.xlsx", so a
   render can be compared against the source sheet line for line.
   Not shipped — package.json "build.files" only includes src/ and assets/. */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const D = require('../src/defaults');
const S = require('../src/statement-render');
const { renderPdf } = require('../src/pdf-export');

const OUT = process.argv[2] || path.join(__dirname, 'statement.pdf');
const CUR = process.argv[3] || 'ZMW';
const COUNT = Number(process.argv[4]) || 0;

const data = {
  clientName: 'Example Commodities Exchange',
  title: 'Ledger Account',
  fromDate: '2026-05-15',
  toDate: '2026-08-24',
  currency: CUR,
  openingBalance: '',
  openingSide: 'Dr',
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
  ],
  company: D.company,
  totalsEveryPage: false
};

/* Fewer than the sample: slice. More: top up with synthetic transactions so
   the harness can push pagination to 100+ entries. */
if (COUNT && COUNT <= data.entries.length) {
  data.entries = data.entries.slice(0, COUNT);
} else if (COUNT) {
  for (let i = data.entries.length; i < COUNT; i++) {
    const receipt = i % 3 === 2;
    const amount = 1000 + i * 213.45;
    data.entries.push({
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

app.whenReady().then(async () => {
  try {
    const html = S.buildStatementHTML(data, '../../');
    fs.writeFileSync(OUT, await renderPdf(html, 'statement'));
    const sum = S.closing(S.allEntries(data));
    console.log('entries=' + data.entries.length +
      '  debit=' + sum.debit.toFixed(2) +
      '  credit=' + sum.credit.toFixed(2) +
      '  closing=' + sum.side + ' ' + sum.amount.toFixed(2));
    console.log('PDF_OK ' + OUT);
    app.exit(0);
  } catch (err) {
    console.error('PDF_FAIL ' + err.stack);
    app.exit(1);
  }
});
