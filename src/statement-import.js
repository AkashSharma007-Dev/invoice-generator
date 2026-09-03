/* Reads ledger transactions out of whatever spreadsheet the accountant
   already has and turns them into statement entries.

   Runs on the same header-hunting engine as the passenger-list importer
   (xlsx-import.js) with a different vocabulary, plus one thing that importer
   never has to deal with: a statement's narration usually lives on its OWN
   ROW, underneath the figures. "Statement Format Zambia.xlsx" is written
   exactly that way, so the file the format came from has to import cleanly. */
const ExcelJS = require('exceljs');
const path = require('path');
const {
  squash, cellText, readGrid, findHeaderRow, mapByHeader, parseAmount
} = require('./xlsx-import');

const FIELD_SYNONYMS = {
  date: ['transactiondate', 'postingdate', 'voucherdate', 'vchdate', 'entrydate',
    'trndate', 'billdate', 'date', 'dt'],
  /* Debit and Credit before the generic Amount, so a sheet carrying all three
     does not hand its Debit column to `amount`. */
  debit: ['debitamount', 'dramount', 'debitzmw', 'debitusd', 'invoiceamount',
    'billamount', 'salesamount', 'debit', 'dr'],
  credit: ['creditamount', 'cramount', 'creditzmw', 'creditusd', 'amountreceived',
    'receiptamount', 'amountpaid', 'credit', 'cr', 'receipt', 'received', 'paid'],
  vch: ['vouchertypename', 'transactiontype', 'vouchertype', 'vchtype', 'trntype',
    'voucher', 'vch', 'type'],
  drcr: ['drcr', 'crdr', 'debitcredit', 'creditdebit', 'side'],
  particulars: ['particulars', 'particular', 'ledgername', 'accountname', 'ledger',
    'account', 'head'],
  amount: ['totalamount', 'netamount', 'grossamount', 'amountzmw', 'amountusd',
    'amount', 'value', 'amt'],
  narration: ['narration', 'remarks', 'remark', 'description', 'details', 'detail',
    'note', 'notes']
};

const FIELD_ORDER = ['date', 'debit', 'credit', 'vch', 'drcr', 'particulars',
  'amount', 'narration'];

const FIELD_LABELS = {
  date: 'Date', debit: 'Debit', credit: 'Credit', vch: 'Vch Type',
  drcr: 'Dr / Cr', particulars: 'Particulars', amount: 'Amount (single column)',
  narration: 'Narration'
};

/* Rows that close a ledger rather than belong to it. Deliberately narrower
   than the invoice importer's list: "Balance" and "Total" are exactly the
   words a closing block uses, and dropping them is the whole point. */
const CLOSING_WORDS = ['total', 'grandtotal', 'subtotal', 'closingbalance',
  'closing', 'balance', 'balancecf', 'balancecarriedforward', 'openingbalance',
  'openingbal', 'balancebf', 'balancebroughtforward', 'sum'];

function isClosingRow(rowTexts) {
  return rowTexts.map(squash).filter(Boolean)
    .some((t) => CLOSING_WORDS.indexOf(t) >= 0);
}

/* Excel gives a date cell back as a Date; a CSV gives back whatever was
   typed. Normalise to the ISO string the app stores, and pass anything
   unrecognisable straight through so it still prints. */
const MONTH_KEYS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12
};

function pad2(n) { return String(n).padStart(2, '0'); }

function iso(y, m, d) {
  if (!(y >= 1900 && y <= 2200) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  return y + '-' + pad2(m) + '-' + pad2(d);
}

function parseDate(cell) {
  if (!cell) return '';
  const v = cell.value;
  if (v instanceof Date) {
    return v.getFullYear() + '-' + pad2(v.getMonth() + 1) + '-' + pad2(v.getDate());
  }
  const text = cellText(cell).trim();
  if (!text) return '';

  /* An ISO timestamp — what ExcelJS produces for a date inside rich text. */
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (m) return iso(+m[1], +m[2], +m[3]) || text;

  /* 15-May-26, 15 May 2026, 15/May/26 — the shape the source sheet prints. */
  m = /^(\d{1,2})[-/\s]+([A-Za-z]{3,9})[-/\s]+(\d{2,4})$/.exec(text);
  if (m) {
    const mon = MONTH_KEYS[m[2].toLowerCase().slice(0, 4)] || MONTH_KEYS[m[2].toLowerCase().slice(0, 3)];
    let y = +m[3];
    if (y < 100) y += 2000;
    const out = mon ? iso(y, mon, +m[1]) : null;
    if (out) return out;
  }

  /* 15/05/2026 and 15-05-26. Day-first: this is a Zambian office, and the
     source sheet's own dates are written day-first. A value over 12 in the
     first slot confirms it; anything ambiguous follows the same rule rather
     than guessing differently row by row. */
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(text);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    const out = iso(y, +m[2], +m[1]);
    if (out) return out;
  }
  return text;
}

/**
 * Pull ledger entries out of a spreadsheet.
 *
 * @param {string} filePath  .xlsx, .xlsm or .csv
 * @param {object} [opts]    { sheet, mapping, headerRow } to override the guess
 * @returns {Promise<object>} everything the UI needs to show a preview
 */
async function readStatementEntries(filePath, opts) {
  opts = opts || {};
  const ext = path.extname(filePath).toLowerCase();
  const wb = new ExcelJS.Workbook();

  if (ext === '.csv') {
    await wb.csv.readFile(filePath);
  } else if (ext === '.xlsx' || ext === '.xlsm') {
    await wb.xlsx.readFile(filePath);
  } else if (ext === '.xls') {
    throw new Error('.xls is the old Excel format and cannot be read directly. ' +
      'Open it in Excel and use File > Save As > Excel Workbook (.xlsx), then import again.');
  } else {
    throw new Error('Unsupported file type "' + ext + '". Use .xlsx or .csv.');
  }

  const sheetNames = wb.worksheets.map((w) => w.name);
  if (!sheetNames.length) throw new Error('This workbook has no sheets.');

  const ws = (opts.sheet && wb.getWorksheet(opts.sheet)) || wb.worksheets[0];
  const { grid, cells, width } = readGrid(ws);
  if (!grid.length) throw new Error('Sheet "' + ws.name + '" is empty.');

  const headerRow = (opts.headerRow != null && opts.headerRow >= -1)
    ? opts.headerRow
    : findHeaderRow(grid, FIELD_ORDER, FIELD_SYNONYMS);
  const firstDataRow = headerRow >= 0 ? headerRow + 1 : 0;

  const mapping = opts.mapping || (headerRow >= 0
    ? mapByHeader(grid[headerRow], FIELD_ORDER, FIELD_SYNONYMS)
    : guessByContent(grid, cells, width, firstDataRow));

  const text = (row, field) => {
    const c = mapping[field];
    return (c == null || c < 0) ? '' : (row[c] || '').trim();
  };
  const amountAt = (r, field) => {
    const c = mapping[field];
    if (c == null || c < 0) return null;
    return parseAmount(cells[r][c]);
  };

  const entries = [];
  let skippedBlank = 0, skippedTotals = 0, attachedNarrations = 0;

  for (let r = firstDataRow; r < grid.length; r++) {
    const row = grid[r];
    if (!row || !row.join('').trim()) { skippedBlank++; continue; }
    if (isClosingRow(row)) { skippedTotals++; continue; }

    const dateCol = mapping.date;
    const date = dateCol == null || dateCol < 0 ? '' : parseDate(cells[r][dateCol]);
    let debit = amountAt(r, 'debit');
    let credit = amountAt(r, 'credit');
    const drcr = text(row, 'drcr');

    /* A sheet with one Amount column instead of two: the Dr/Cr marker decides
       the side, and failing that the voucher type does — a Receipt is money
       coming in. */
    if (debit == null && credit == null) {
      const single = amountAt(r, 'amount');
      if (single != null) {
        const vch = squash(text(row, 'vch'));
        const marker = squash(drcr);
        const isCredit = marker === 'cr' || marker === 'credit' ||
          (!marker && (vch === 'receipt' || vch === 'payment' || vch === 'creditnote'));
        if (isCredit) credit = single; else debit = single;
      }
    }

    const particulars = text(row, 'particulars');
    const narration = text(row, 'narration');
    const hasFigures = debit != null || credit != null;

    /* The two-row layout: a row carrying neither a date nor a figure, but
       carrying text, is the narration belonging to the transaction above it.
       That is precisely how the source statement is written. */
    if (!hasFigures && !date && entries.length) {
      const carried = narration || particulars;
      if (carried) {
        const prev = entries[entries.length - 1];
        prev.narration = prev.narration ? prev.narration + '\n' + carried : carried;
        attachedNarrations++;
        continue;
      }
      skippedBlank++;
      continue;
    }

    if (!hasFigures && !date && !particulars) { skippedBlank++; continue; }

    /* Figures with no date, no ledger name and no narration are not a
       transaction — that is the unlabelled totals strip the source sheet
       puts under the last entry, and importing it would double the ledger. */
    if (hasFigures && !date && !particulars && !narration) { skippedTotals++; continue; }

    entries.push({
      date: date,
      drcr: drcr === 'Dr' || drcr === 'Cr' ? drcr : '',
      particulars: particulars,
      vch: text(row, 'vch'),
      debit: debit == null ? '' : debit,
      credit: credit == null ? '' : credit,
      narration: narration
    });
  }

  /* Last line of defence against a totals row that carried a date, or a label
     nobody in CLOSING_WORDS anticipated: if the final row is exactly the sum
     of everything above it, on both sides, it is a total and not a
     transaction. Only ever applied to the last row, because two ordinary
     entries can coincidentally add up that way in the middle of a ledger. */
  if (entries.length > 2) {
    const last = entries[entries.length - 1];
    const prior = entries.slice(0, -1).reduce((acc, e) => ({
      debit: acc.debit + (Number(e.debit) || 0),
      credit: acc.credit + (Number(e.credit) || 0)
    }), { debit: 0, credit: 0 });
    const near = (a, b) => Math.abs((Number(a) || 0) - b) < 0.005;
    if (prior.debit > 0 && prior.credit > 0 &&
        near(last.debit, prior.debit) && near(last.credit, prior.credit)) {
      entries.pop();
      skippedTotals++;
    }
  }

  const columns = [];
  for (let c = 0; c < width; c++) {
    const head = headerRow >= 0 ? (grid[headerRow][c] || '').trim() : '';
    columns.push({
      index: c,
      label: head || ('Column ' + String.fromCharCode(65 + (c % 26))),
      sample: (function () {
        for (let r = firstDataRow; r < Math.min(grid.length, firstDataRow + 12); r++) {
          const t = grid[r] && (grid[r][c] || '').trim();
          if (t) return t;
        }
        return '';
      })()
    });
  }

  return {
    file: filePath,
    fileName: path.basename(filePath),
    sheet: ws.name,
    sheetNames: sheetNames,
    headerRow: headerRow,
    mapping: mapping,
    columns: columns,
    entries: entries,
    skipped: { blank: skippedBlank, totals: skippedTotals, narrations: attachedNarrations },
    fields: FIELD_ORDER.map((f) => ({ key: f, label: FIELD_LABELS[f] }))
  };
}

/* No usable header row. Ledgers are recognisable by shape even without one:
   the date column is whatever parses as a date most often, the two money
   columns are the rightmost numeric ones, and the widest text column is the
   Particulars. */
function guessByContent(grid, cells, width, startRow) {
  const dates = new Array(width).fill(0);
  const numeric = new Array(width).fill(0);
  const wordy = new Array(width).fill(0);
  let sampled = 0;

  for (let r = startRow; r < grid.length && sampled < 60; r++) {
    const row = grid[r];
    if (!row || !row.join('').trim()) continue;
    sampled++;
    for (let c = 0; c < width; c++) {
      const cell = cells[r][c];
      if (cell && /^\d{4}-\d{2}-\d{2}$/.test(parseDate(cell))) dates[c]++;
      if (parseAmount(cell) != null) numeric[c]++;
      const t = (row[c] || '').trim();
      if (t && !/^[\d.,\s/-]+$/.test(t)) wordy[c] += t.length;
    }
  }

  const mapping = {};
  let best = 0;
  for (let c = 0; c < width; c++) {
    if (dates[c] > best) { best = dates[c]; mapping.date = c; }
  }

  /* Two money columns side by side read as Debit then Credit, left to right —
     the order every ledger in the world prints them in. */
  const moneyCols = [];
  for (let c = 0; c < width; c++) {
    if (c !== mapping.date && numeric[c] > 0) moneyCols.push(c);
  }
  moneyCols.sort((a, b) => numeric[b] - numeric[a]);
  const pair = moneyCols.slice(0, 2).sort((a, b) => a - b);
  if (pair.length === 2) { mapping.debit = pair[0]; mapping.credit = pair[1]; }
  else if (pair.length === 1) { mapping.amount = pair[0]; }

  let bestWords = 0;
  for (let c = 0; c < width; c++) {
    if (c === mapping.debit || c === mapping.credit || c === mapping.amount) continue;
    if (wordy[c] > bestWords) { bestWords = wordy[c]; mapping.particulars = c; }
  }
  return mapping;
}

module.exports = {
  readStatementEntries,
  parseDate,
  FIELD_ORDER,
  FIELD_LABELS,
  FIELD_SYNONYMS
};
