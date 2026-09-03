/* Rebuilds the invoice as a real .xlsx that mirrors the printed PDF —
   same fonts, colours, merges and borders as "Invoice Format Zambia.xlsx". */
const path = require('path');
const ExcelJS = require('exceljs');
const { currency, amountInWords, itemsTotal, detailText } = require('./invoice-render');

const FONT = 'Aptos';
const BLUE = 'FF0070C0';
const ORANGE = 'FFED7D31';
const NAVY = 'FF000066';
const WHITE = 'FFFFFFFF';
const BLACK = 'FF000000';

const THIN = { style: 'thin', color: { argb: BLACK } };
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };

/* Accounting style: code hard left, figure hard right, never abbreviated.
   `decimals` is 0 for JPY-style currencies and 3 for the Gulf dinars, and
   `group` is 'in' for the four currencies that use Indian 2,2,3 grouping.

   The amount cell stays a real NUMBER — never a pre-formatted string — so the
   Gross/Net SUM keeps working and the accountant can still edit the figure.
   That does mean Excel, not us, renders the digits: it reads digit grouping
   from the PC's own regional settings. Measured on an en-IN machine, all nine
   format codes tried (plain, accounting, [$-409], [$-en-US], explicit 3-3
   patterns) rendered 1,24,00,000.50 — Excel simply overrides them. So the
   Indian pattern below is the best available lever and nothing more.

   The PDF does not depend on any of this: invoice-render.js groups the digits
   itself, so an INR invoice reads 12,40,000.50 and a ZMW one 1,240,000.50 on
   every machine. The PDF is what reaches the client. */
function moneyFmt(code, decimals, group) {
  const sym = '[$' + code + ']';
  const digits = group === 'in' ? '#,##,##0' : '#,##0';
  const dp = decimals > 0 ? '.' + '0'.repeat(decimals) : '';
  const dash = decimals > 0 ? '"-"' + '?'.repeat(decimals) : '"-"';
  return '_ ' + sym + '\\ * ' + digits + dp + '_ ;_ ' + sym + '\\ * \\-' + digits + dp + '_ ;' +
         '_ ' + sym + '\\ * ' + dash + '_ ;_ @_ ';
}

/* Apply a single border edge across a merged span so the outer box stays closed. */
function edge(ws, row, fromCol, toCol, sides) {
  for (let c = fromCol; c <= toCol; c++) {
    const cell = ws.getCell(row, c);
    cell.border = Object.assign({}, cell.border, sides);
  }
}

function outer(ws, row, fromCol, toCol, extra) {
  for (let c = fromCol; c <= toCol; c++) {
    const cell = ws.getCell(row, c);
    const b = Object.assign({}, cell.border, extra || {});
    if (c === fromCol) b.left = THIN;
    if (c === toCol) b.right = THIN;
    cell.border = b;
  }
}

async function writeInvoiceXlsx(d, filePath, assetsDir) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Invoice Generator';
  wb.created = new Date();

  const ws = wb.addWorksheet('Invoice', {
    pageSetup: {
      orientation: 'landscape', paperSize: 9, fitToPage: true,
      fitToWidth: 1, fitToHeight: 1, horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }
    }
  });

  ws.columns = [
    { width: 30.11 }, { width: 9.11 }, { width: 21.66 },
    { width: 15.43 }, { width: 18.66 }, { width: 23.0 }
  ];

  const co = d.company, bk = d.bank;
  const cur = currency(d.currency);
  const code = cur.code;
  const rows = (d.items && d.items.length) ? d.items : [{}];
  const gross = itemsTotal(rows);
  const fmt = moneyFmt(code, cur.decimals, cur.group);

  /* ---- 1. letterhead ------------------------------------------------ */
  const rt = (label, value) => ({
    richText: [
      { font: { name: FONT, size: 9, bold: true, color: { argb: ORANGE } }, text: label },
      { font: { name: FONT, size: 9, bold: true, color: { argb: BLUE } }, text: ' ' + value }
    ]
  });

  const head = [
    { row: 1, value: co.name, size: 22, height: 30 },
    { row: 2, value: co.address, size: 9, height: 15 },
    { row: 3, value: rt('Contact No.:', co.contact), size: 9, height: 15 },
    { row: 4, value: rt('Email:', co.email), size: 9, height: 15 },
    { row: 5, value: rt('Visit our website:', co.website), size: 9, height: 15 }
  ];
  head.forEach((h) => {
    ws.mergeCells(h.row, 2, h.row, 6);
    const cell = ws.getCell(h.row, 2);
    cell.value = h.value;
    cell.font = { name: FONT, size: h.size, bold: true, color: { argb: BLUE } };
    cell.alignment = { horizontal: 'right', vertical: 'middle' };
    ws.getRow(h.row).height = h.height;
  });

  ws.mergeCells(6, 2, 6, 3);
  const invNoCell = ws.getCell(6, 2);
  invNoCell.value = d.invoiceNo;
  invNoCell.font = { name: FONT, size: 10, bold: true, color: { argb: BLACK } };
  invNoCell.alignment = { horizontal: 'center', vertical: 'bottom' };
  ws.getRow(6).height = 20;

  for (let r = 1; r <= 6; r++) outer(ws, r, 1, 6, r === 1 ? { top: THIN } : {});
  edge(ws, 6, 1, 6, { bottom: THIN });

  /* ---- 2. client / date --------------------------------------------- */
  const bold10 = { name: FONT, size: 10, bold: true, color: { argb: BLACK } };

  ws.mergeCells(7, 1, 7, 6);
  ws.getCell(7, 1).value = 'Client Name : ' + (d.clientName || '');
  ws.getCell(7, 1).font = bold10;
  ws.getCell(7, 1).alignment = { horizontal: 'left', vertical: 'middle' };

  ws.mergeCells(8, 1, 8, 4);
  ws.getCell(8, 1).value = 'Address : ' + (d.clientAddress || '');
  ws.getCell(8, 1).font = bold10;
  ws.getCell(8, 1).alignment = { horizontal: 'left', vertical: 'middle' };
  ws.mergeCells(8, 5, 8, 6);
  ws.getCell(8, 5).value = 'Invoice Date: ' + (d.invoiceDate || '');
  ws.getCell(8, 5).font = bold10;
  ws.getCell(8, 5).alignment = { horizontal: 'right', vertical: 'middle' };

  ws.mergeCells(9, 1, 9, 6);
  ws.getCell(9, 1).value = 'LPO Number : ' + (d.lpoNumber || '');
  ws.getCell(9, 1).font = bold10;
  ws.getCell(9, 1).alignment = { horizontal: 'left', vertical: 'middle' };

  for (let r = 7; r <= 9; r++) { ws.getRow(r).height = 15; outer(ws, r, 1, 6); }

  /* ---- 3. line items ------------------------------------------------ */
  const HEADERS = ['PASSENGER NAME', 'PNR', 'ROUTE', 'SERVICE',
    d.detailHeader || 'TICKET NO.', 'AMOUNT'];
  const headRow = ws.getRow(10);
  HEADERS.forEach((label, i) => {
    const cell = headRow.getCell(i + 1);
    cell.value = label;
    cell.font = { name: FONT, size: 10, color: { argb: WHITE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = BOX;
  });
  headRow.height = 15;

  let r = 11;
  rows.forEach((it) => {
    const row = ws.getRow(r);
    /* Every text cell wraps — nothing in this table may be clipped. */
    [it.pax, it.pnr, it.route, it.service, detailText(it, d.services)].forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v || '';
      cell.font = { name: FONT, size: 10, color: { argb: BLACK } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = BOX;
    });
    const amt = row.getCell(6);
    /* Always a real number, never a string: the Gross/Net SUM depends on it,
       and `|| 0` alone would let Infinity through and produce a broken cell. */
    const n = Number(it.amount);
    amt.value = isFinite(n) ? n : 0;
    amt.numFmt = fmt;
    amt.font = { name: FONT, size: 10, color: { argb: BLACK } };
    amt.alignment = { vertical: 'middle' };
    amt.border = BOX;
    /* No explicit height: Excel auto-fits the row around wrapped text. */
    r++;
  });

  const firstItem = 11, lastItem = r - 1;

  [['Gross Amount', false], ['Net To Pay', true]].forEach(([label, isBold]) => {
    ws.mergeCells(r, 1, r, 5);
    const lbl = ws.getCell(r, 1);
    lbl.value = label;
    lbl.font = bold10;
    lbl.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
    for (let c = 1; c <= 5; c++) ws.getCell(r, c).border = BOX;
    const amt = ws.getCell(r, 6);
    amt.value = { formula: 'SUM(F' + firstItem + ':F' + lastItem + ')', result: gross };
    amt.numFmt = fmt;
    amt.font = { name: FONT, size: 10, bold: isBold, color: { argb: BLACK } };
    amt.alignment = { vertical: 'middle' };
    amt.border = BOX;
    ws.getRow(r).height = 15;
    r++;
  });

  /* ---- 4. words + bank details -------------------------------------- */
  const bankStart = r;
  [
    'Amount ( In Words ) : ' + amountInWords(gross, code),
    'Beneficiary Name : ' + (bk.beneficiary || ''),
    'Bank Name : ' + (bk.bankName || ''),
    'Branch Code : ' + (bk.branchCode || ''),
    'Swift Code : ' + (bk.swift || ''),
    'Account Number (ZMW) : ' + (bk.accZMW || ''),
    'Account Number (USD) : ' + (bk.accUSD || '')
  ].forEach((line, i) => {
    /* The amount-in-words line can run long, so it gets the full width;
       the stamp starts on the row below it. */
    ws.mergeCells(r, 1, r, i === 0 ? 6 : 4);
    const cell = ws.getCell(r, 1);
    cell.value = line;
    cell.font = bold10;
    cell.alignment = { horizontal: 'left', vertical: 'middle' };
    ws.getRow(r).height = 15;
    outer(ws, r, 1, 6);
    r++;
  });
  const bankEnd = r - 1;
  edge(ws, bankEnd, 1, 6, { bottom: THIN });

  /* ---- 5. disclaimer ------------------------------------------------ */
  const discRow = r;
  ws.mergeCells(r, 1, r, 6);
  const disc = ws.getCell(r, 1);
  disc.value = (d.disclaimer || []).join(' ').replace(/\s+/g, ' ').trim();
  disc.font = { name: FONT, size: 9.5, color: { argb: BLACK } };
  disc.alignment = { horizontal: 'justify', vertical: 'middle', wrapText: true };
  ws.getRow(r).height = 30;
  outer(ws, r, 1, 6, { bottom: THIN });
  r++;

  /* ---- 6. footer strip ---------------------------------------------- */
  ws.mergeCells(r, 1, r, 6);
  const foot = ws.getCell(r, 1);
  foot.value = d.footerNote || '';
  foot.font = { name: FONT, size: 11, color: { argb: BLACK } };
  foot.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(r).height = 30;
  outer(ws, r, 1, 6, { bottom: THIN });
  const footRow = r;

  /* ---- 7. images -----------------------------------------------------
     ExcelJS anchors are ZERO-based, so a 1-based row number needs -1. */
  const logoId = wb.addImage({ filename: path.join(assetsDir, 'logo.png'), extension: 'png' });
  ws.addImage(logoId, { tl: { col: 0.25, row: 0.35 }, ext: { width: 143, height: 97 } });

  if (d.showStamp !== false) {
    const stampId = wb.addImage({ filename: path.join(assetsDir, 'stamp.jpeg'), extension: 'jpeg' });
    ws.addImage(stampId, {
      tl: { col: 4.3, row: bankStart + 0.15 }, ext: { width: 95, height: 95 }
    });
  }

  const iataId = wb.addImage({ filename: path.join(assetsDir, 'iata.jpg'), extension: 'jpeg' });
  ws.addImage(iataId, { tl: { col: 0.06, row: footRow - 1 + 0.25 }, ext: { width: 44, height: 21 } });

  ws.pageSetup.printArea = 'A1:F' + footRow;
  void discRow;

  await wb.xlsx.writeFile(filePath);
  return filePath;
}

/* Shared with xlsx-statement.js so both workbooks are built from one set of
   fonts, borders and money formats and cannot drift apart. */
module.exports = {
  writeInvoiceXlsx,
  moneyFmt, edge, outer,
  FONT, BLUE, ORANGE, NAVY, WHITE, BLACK, THIN, BOX
};
