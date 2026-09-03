/* Rebuilds the statement as a real .xlsx mirroring the printed PDF —
   the same six-column Ledger Account as "Statement Format Zambia.xlsx",
   on A4 portrait.

   Shares its fonts, borders and money format with the invoice export, so a
   change to one can never leave the other looking like a different company. */
const path = require('path');
const ExcelJS = require('exceljs');
const { currency } = require('./invoice-render');
const SR = require('./statement-render');
const {
  moneyFmt, edge, outer, FONT, BLUE, ORANGE, BLACK, THIN, BOX
} = require('./xlsx-export');

/* "2026-05-15" -> a real Date, so Excel sorts and filters the column as
   dates rather than as text. Anything else is written through untouched.

   Built in UTC deliberately. ExcelJS turns a Date into a sheet serial from its
   UTC value, so a local-midnight Date on a machine ahead of UTC — this one is
   +05:30 — lands on the previous day and the whole ledger prints one day
   early. Measured: local midnight 15-May-26 came back out of the file as
   14-May-26. */
function toDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/* A figure is only written when the accountant actually put one there —
   a Debit column full of 0.00 in the unused rows is unreadable. */
function amountOrBlank(cell, value, fmt) {
  cell.numFmt = fmt;
  if (!SR.hasValue(value)) { cell.value = null; return; }
  const n = Number(value);
  cell.value = isFinite(n) ? n : 0;   /* always a real number, never text */
}

async function writeStatementXlsx(d, filePath, assetsDir) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Invoice Generator';
  wb.created = new Date();

  const ws = wb.addWorksheet('Statement', {
    pageSetup: {
      orientation: 'portrait', paperSize: 9, fitToPage: true,
      fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }
    }
  });

  /* Same proportions as the printed sheet. Debit and Credit are equal: they
     are the same measurement read against each other. */
  ws.columns = [
    { width: 10 }, { width: 3.5 }, { width: 46 },
    { width: 13 }, { width: 16.5 }, { width: 16.5 }
  ];

  const co = d.company || {};
  const cur = currency(d.currency);
  const fmt = moneyFmt(cur.code, cur.decimals, cur.group);
  const entries = SR.allEntries(d);
  const sum = SR.closing(entries);

  /* ---- 1. letterhead ------------------------------------------------ */
  const rt = (label, value) => ({
    richText: [
      { font: { name: FONT, size: 8, bold: true, color: { argb: ORANGE } }, text: label },
      { font: { name: FONT, size: 8, bold: true, color: { argb: BLUE } }, text: ' ' + value }
    ]
  });

  [
    { row: 1, value: co.name, size: 18, height: 26 },
    { row: 2, value: co.address, size: 8, height: 13 },
    { row: 3, value: rt('Contact No.:', co.contact), size: 8, height: 13 },
    { row: 4, value: rt('Email:', co.email), size: 8, height: 13 },
    { row: 5, value: rt('Visit our website:', co.website), size: 8, height: 13 }
  ].forEach((h) => {
    ws.mergeCells(h.row, 2, h.row, 6);
    const cell = ws.getCell(h.row, 2);
    cell.value = h.value;
    cell.font = { name: FONT, size: h.size, bold: true, color: { argb: BLUE } };
    cell.alignment = { horizontal: 'right', vertical: 'middle' };
    ws.getRow(h.row).height = h.height;
  });
  for (let r = 1; r <= 5; r++) outer(ws, r, 1, 6, r === 1 ? { top: THIN } : {});

  /* ---- 2. party / title / period ------------------------------------ */
  ws.mergeCells(6, 1, 6, 6);
  const party = ws.getCell(6, 1);
  party.value = d.clientName || '';
  party.font = { name: FONT, size: 12, bold: true, color: { argb: BLACK } };
  party.alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getRow(6).height = 18;
  outer(ws, 6, 1, 6);

  ws.mergeCells(7, 1, 7, 6);
  const title = ws.getCell(7, 1);
  title.value = d.title || 'Ledger Account';
  title.font = { name: FONT, size: 9, color: { argb: BLACK } };
  title.alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getRow(7).height = 14;
  outer(ws, 7, 1, 6);

  ws.mergeCells(8, 1, 8, 6);
  const period = ws.getCell(8, 1);
  period.value = SR.periodLabel(d);
  period.font = { name: FONT, size: 10, color: { argb: BLACK } };
  period.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(8).height = 16;
  outer(ws, 8, 1, 6, { top: THIN, bottom: THIN });

  /* ---- 3. ledger table ---------------------------------------------- */
  const HEADERS = ['Date', '', 'Particulars', 'Vch Type', 'Debit', 'Credit'];
  const headRow = ws.getRow(9);
  HEADERS.forEach((label, i) => {
    const cell = headRow.getCell(i + 1);
    cell.value = label;
    /* No fill: the source sheet is a Tally print, not the invoice's navy
       band. Bold is the one addition — at this size an unbolded heading is
       indistinguishable from the data directly beneath it. */
    cell.font = { name: FONT, size: 9, bold: true, color: { argb: BLACK } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = BOX;
  });
  headRow.height = 18;

  let r = 10;
  const firstEntry = r;
  entries.forEach((e) => {
    const row = ws.getRow(r);

    const date = row.getCell(1);
    date.value = toDate(e.date);
    date.numFmt = 'd-mmm-yy';
    date.font = { name: FONT, size: 9, color: { argb: BLACK } };
    date.alignment = { horizontal: 'right', vertical: 'top' };
    date.border = BOX;

    const mark = row.getCell(2);
    mark.value = SR.markerFor(e);
    mark.font = { name: FONT, size: 9, color: { argb: BLACK } };
    mark.alignment = { horizontal: 'center', vertical: 'top' };
    mark.border = BOX;

    const part = row.getCell(3);
    part.value = e.particulars || '';
    part.font = { name: FONT, size: 10, bold: true, color: { argb: BLACK } };
    part.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
    part.border = BOX;

    const vch = row.getCell(4);
    vch.value = e.vch || '';
    vch.font = { name: FONT, size: 9, bold: true, color: { argb: BLACK } };
    vch.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
    vch.border = BOX;

    [5, 6].forEach((c) => {
      const cell = row.getCell(c);
      amountOrBlank(cell, c === 5 ? e.debit : e.credit, fmt);
      cell.font = { name: FONT, size: 10, color: { argb: BLACK } };
      cell.alignment = { horizontal: 'right', vertical: 'top' };
      cell.border = BOX;
    });
    r++;

    /* The narration keeps its own row underneath, italic, exactly as the
       source sheet writes it. */
    const nRow = ws.getRow(r);
    for (let c = 1; c <= 6; c++) nRow.getCell(c).border = BOX;
    const nar = nRow.getCell(3);
    nar.value = String(e.narration == null ? '' : e.narration);
    nar.font = { name: FONT, size: 9, italic: true, color: { argb: BLACK } };
    nar.alignment = { horizontal: 'left', vertical: 'top', wrapText: true, indent: 1 };
    r++;
  });
  const lastEntry = r - 1;

  /* ---- 4. totals + closing balance ----------------------------------- */
  /* Live SUM formulas, not baked figures: the accountant edits the sheet
     after export and the totals have to follow. The range covers the
     narration rows too, which are numerically empty. */
  const totalRow = ws.getRow(r);
  for (let c = 1; c <= 4; c++) totalRow.getCell(c).border = BOX;
  [[5, sum.debit], [6, sum.credit]].forEach(([c, value]) => {
    const col = c === 5 ? 'E' : 'F';
    const cell = totalRow.getCell(c);
    cell.value = entries.length
      ? { formula: 'SUM(' + col + firstEntry + ':' + col + lastEntry + ')', result: value }
      : 0;
    cell.numFmt = fmt;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: BLACK } };
    cell.alignment = { horizontal: 'right', vertical: 'top' };
    cell.border = BOX;
  });
  totalRow.height = 16;
  const totalRowNo = r;
  r++;

  const balRow = ws.getRow(r);
  balRow.getCell(1).border = BOX;
  const balMark = balRow.getCell(2);
  balMark.value = sum.side;
  balMark.font = { name: FONT, size: 10, bold: true, color: { argb: BLACK } };
  balMark.alignment = { horizontal: 'center', vertical: 'top' };
  balMark.border = BOX;

  const balLbl = balRow.getCell(3);
  balLbl.value = 'Closing Balance';
  balLbl.font = { name: FONT, size: 10, bold: true, color: { argb: BLACK } };
  balLbl.alignment = { horizontal: 'left', vertical: 'top' };
  balLbl.border = BOX;
  balRow.getCell(4).border = BOX;

  [5, 6].forEach((c) => {
    const cell = balRow.getCell(c);
    const wanted = (c === 5) ? 'debit' : 'credit';
    if (sum.column === wanted) {
      cell.value = {
        formula: 'ABS(E' + totalRowNo + '-F' + totalRowNo + ')',
        result: sum.amount
      };
    } else {
      cell.value = null;
    }
    cell.numFmt = fmt;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: BLACK } };
    cell.alignment = { horizontal: 'right', vertical: 'top' };
    cell.border = BOX;
  });
  balRow.height = 16;
  edge(ws, r, 1, 6, { bottom: THIN });
  const lastRow = r;

  /* ---- 5. logo ------------------------------------------------------
     ExcelJS anchors are ZERO-based; the image floats over column A. */
  const logoId = wb.addImage({ filename: path.join(assetsDir, 'logo.png'), extension: 'png' });
  ws.addImage(logoId, { tl: { col: 0.12, row: 0.3 }, ext: { width: 110, height: 75 } });

  /* Repeat the letterhead and column headings at the top of every printed
     page, so a continuation sheet reads as the same statement. */
  ws.pageSetup.printTitlesRow = '1:9';
  ws.pageSetup.printArea = 'A1:F' + lastRow;

  await wb.xlsx.writeFile(filePath);
  return filePath;
}

module.exports = { writeStatementXlsx };
