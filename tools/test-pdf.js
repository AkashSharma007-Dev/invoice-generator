/* Dev harness: exercises the real PDF path outside the UI.
   Run with:  node_modules/electron/dist/electron.exe tools/test-pdf.js <out.pdf>
   Not shipped — package.json "build.files" only includes src/ and assets/. */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const D = require('../src/defaults');
const R = require('../src/invoice-render');
const { renderPdf } = require('../src/pdf-export');

const OUT = process.argv[2] || path.join(__dirname, 'test.pdf');
const CUR = process.argv[3] || 'ZMW';        /* second arg: currency code    */
const ROWS = Number(process.argv[4]) || 0;   /* third arg: keep only N rows  */

const data = {
  invoiceNo: '26LUN/INV000157',
  invoiceDate: '23-08-2026',
  clientName: 'ACME GENERAL INSURANCE',
  clientAddress: 'Plot 100, Example Road, Lusaka',
  lpoNumber: 'LPO-2026-0417',
  currency: CUR,
  items: [
    { pax: 'TRAVELLER/ALPHA MR', pnr: 'AAA111', route: 'HRE LUN JNB CPT JNB LUN HRE', service: 'AIR TICKET', ticket: '000-0000000001', amount: 8750 },
    { pax: 'TRAVELLER/BRAVO MR', pnr: 'BBB222', route: 'LUN NBO DXB BOM DEL BOM DXB NBO LUN', service: 'AIR TICKET', ticket: '000-0000000002', amount: 1240000.5 },
    { pax: 'TRAVELLER/CHARLIE MR', pnr: 'CCC333', route: 'LUN JNB', service: 'VISA SERVICE', ticket: 'United Arab Emirates', amount: 3299.99 },
    { pax: 'TRAVELLER/DELTA MR', pnr: '', route: 'LUSAKA CITY', service: 'CAR RENTAL', ticket: 'With Driver', amount: 1850 },
    { pax: 'TRAVELLER/ECHO MR', pnr: '', route: 'LUSAKA', service: 'HOTEL BOOKING', ticket: 'Example Hotel Lusaka', amount: 4200 },
    { pax: 'TRAVELLER/FOXTROT MRS', pnr: '', route: 'LUN NBO', service: 'TRAVEL INSURANCE', ticket: 'Kenya', days: '30', amount: 990 },
    { pax: 'TRAVELLER/GOLF MR', pnr: '', route: 'BOM LUN', service: 'PACKAGE', ticket: 'South Africa', amount: 22500 },
    { pax: 'OFFICE', pnr: '', route: '', service: 'SERVICE CHARGE', ticket: 'Amendment and reissue handling', amount: 350 }
  ],
  company: D.company, bank: D.bank,
  disclaimer: D.disclaimer, footerNote: D.footerNote, showStamp: true
};
/* Fewer rows than the sample: slice. More: keep the sample and top it up with
   synthetic passengers, so the harness can push the layout to 100+ rows. */
if (ROWS && ROWS <= data.items.length) {
  data.items = data.items.slice(0, ROWS);
} else if (ROWS) {
  const SVC = ['AIR TICKET', 'HOTEL BOOKING', 'VISA SERVICE', 'TRAVEL INSURANCE', 'SERVICE CHARGE'];
  const DET = ['000-0000000000', 'Example Hotel Lusaka', 'United Arab Emirates', 'Kenya', 'Amendment handling'];
  for (let i = data.items.length; i < ROWS; i++) {
    const k = i % SVC.length;
    data.items.push({
      pax: 'SURNAME' + (i + 1) + '/GIVENNAME MR',
      pnr: 'PNR' + String(i + 1).padStart(3, '0'),
      route: i % 3 === 0 ? 'LUN NBO DXB BOM DEL BOM DXB NBO LUN' : 'LUN JNB CPT JNB LUN',
      service: SVC[k],
      ticket: DET[k],
      days: SVC[k] === 'TRAVEL INSURANCE' ? '30' : '',
      amount: 1000 + i * 137.55
    });
  }
}
data.services = D.services;
data.detailHeader = R.detailHeader(data.items, D.services);

app.whenReady().then(async () => {
  try {
    const html = R.buildInvoiceHTML(data, '../../');
    fs.writeFileSync(OUT, await renderPdf(html));
    console.log('PDF_OK ' + OUT);
    app.exit(0);
  } catch (err) {
    console.error('PDF_FAIL ' + err.stack);
    app.exit(1);
  }
});
