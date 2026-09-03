/* Reads a passenger list out of whatever spreadsheet the accountant already
   has and turns it into invoice line items.

   The whole point is that nobody prepares their sheet for us. Real files carry
   a letterhead above the header row, merged title cells, blank spacer rows, a
   "TOTAL" line at the bottom, amounts typed as "ZMW 1,240,000.50", and column
   names nobody agreed on. So this module never assumes a fixed layout: it
   hunts for the header row, scores each column against a synonym list, and
   hands the UI its guess along with everything it needs to let a human
   override that guess. */
const ExcelJS = require('exceljs');
const path = require('path');

/* Header synonyms, most specific first. Matching is done on a squashed form of
   the text (lowercase, letters and digits only) so "Ticket No.", "TICKET_NO"
   and "ticket  no" all collapse to the same key. */
const FIELD_SYNONYMS = {
  pax: ['passengername', 'passengersname', 'nameofpassenger', 'paxname', 'passenger',
    'travellername', 'travelername', 'traveller', 'traveler', 'guestname', 'guest',
    'pax', 'name'],
  pnr: ['pnrno', 'pnrnumber', 'pnr', 'recordlocator', 'bookingreference', 'bookingref',
    'bookingno', 'booking', 'reference', 'refno', 'ref'],
  route: ['route', 'routing', 'sector', 'sectors', 'itinerary', 'journey', 'travelroute',
    'fromto', 'origindestination', 'destination'],
  service: ['servicetype', 'typeofservice', 'service', 'particulars', 'description',
    'product', 'category', 'type'],
  ticket: ['ticketnumber', 'ticketno', 'tktno', 'tkt', 'eticket', 'eticketnumber',
    'ticket', 'hotelname', 'hotel', 'country', 'voucherno', 'voucher', 'details',
    'detail', 'remarks', 'remark'],
  days: ['numberofdays', 'noofdays', 'days', 'nights', 'duration'],
  amount: ['totalamount', 'grossamount', 'netamount', 'amountzmw', 'amountusd',
    'amount', 'fare', 'totalfare', 'price', 'cost', 'charges', 'charge', 'value',
    'total', 'amt']
};

/* Order matters: the first field to claim a column wins, so the columns people
   are least ambiguous about get first pick. "Total" would otherwise be grabbed
   by `amount` before a plainer "Amount" column further right. */
const FIELD_ORDER = ['pax', 'pnr', 'route', 'service', 'ticket', 'days', 'amount'];

const FIELD_LABELS = {
  pax: 'Passenger Name', pnr: 'PNR', route: 'Route', service: 'Service',
  ticket: 'Details / Ticket No.', days: 'Days', amount: 'Amount'
};

/* Rows that are clearly not passengers. */
const TOTAL_WORDS = ['total', 'grandtotal', 'subtotal', 'gross', 'grossamount',
  'nettopay', 'net', 'balance', 'amountinwords', 'sum'];

function squash(v) {
  return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* ExcelJS hands back rich text, hyperlinks, formula results and dates as
   objects. Flatten anything to the string a human would see in the cell. */
function cellText(cell) {
  if (!cell) return '';
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
  if (v.text != null) return String(v.text);
  if (v.result != null) return String(v.result);
  if (v.hyperlink && v.text) return String(v.text);
  if (v.error) return '';
  return '';
}

/* Numbers are the one field we cannot afford to guess wrong.

   A real numeric cell is used as-is. Text is harder: "ZMW 1,240,000.50",
   "1.240.000,50", "(1,234.00)" and "K 8 750" all turn up. Strip everything
   that is not a digit or a separator, then decide which separator is the
   decimal point by looking at whichever comes last — that rule gets both
   1,240,000.50 and 1.240.000,50 right without knowing the source locale. */
function parseAmount(cell) {
  if (!cell) return null;
  const v = cell.value;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v && typeof v === 'object' && typeof v.result === 'number') {
    return isFinite(v.result) ? v.result : null;
  }

  let s = cellText(cell).trim();
  if (!s) return null;

  const negative = /^\(.*\)$/.test(s) || /-/.test(s.replace(/^[^\d(-]*/, ''));
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let decimalAt = -1;
  if (lastDot >= 0 && lastComma >= 0) {
    decimalAt = Math.max(lastDot, lastComma);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const only = Math.max(lastDot, lastComma);
    const after = s.length - only - 1;
    /* One separator: it is a decimal point only when it leaves 1-3 digits
       behind it and does not look like thousands grouping (1,240 / 1.240). */
    if (after > 0 && after <= 3 && !(after === 3 && s.replace(/[.,]/g, '').length > 3)) {
      decimalAt = only;
    }
  }

  let out;
  if (decimalAt >= 0) {
    out = s.slice(0, decimalAt).replace(/[.,]/g, '') + '.' + s.slice(decimalAt + 1).replace(/[.,]/g, '');
  } else {
    out = s.replace(/[.,]/g, '');
  }

  const n = Number(out);
  if (!isFinite(n)) return null;
  return negative ? -n : n;
}

/* Grid of plain strings, plus the raw cells so amounts keep their numeric type. */
function readGrid(ws) {
  const grid = [];
  const cells = [];
  const width = Math.max(ws.columnCount || 0, 1);
  ws.eachRow({ includeEmpty: true }, (row, rowNo) => {
    const texts = [];
    const raws = [];
    for (let c = 1; c <= width; c++) {
      const cell = row.getCell(c);
      texts.push(cellText(cell).trim());
      raws.push(cell);
    }
    grid[rowNo - 1] = texts;
    cells[rowNo - 1] = raws;
  });
  for (let i = 0; i < grid.length; i++) {
    if (!grid[i]) { grid[i] = []; cells[i] = []; }
  }
  return { grid, cells, width };
}

/* Score a row on how much it looks like a set of column headings.
   The field list is a parameter so the statement importer can score against
   its own vocabulary ("Vch Type", "Debit") through the same engine. */
function headerScore(rowTexts, order, syn) {
  order = order || FIELD_ORDER;
  syn = syn || FIELD_SYNONYMS;
  let hits = 0;
  const claimed = new Set();
  rowTexts.forEach((t) => {
    const k = squash(t);
    if (!k) return;
    for (const field of order) {
      if (claimed.has(field)) continue;
      if (syn[field].indexOf(k) >= 0) { hits++; claimed.add(field); return; }
    }
  });
  return hits;
}

/* The header is the best-scoring row in the first stretch of the sheet. Two
   recognised headings is the floor — one is far too easy to hit by accident on
   a title row that happens to say "Details". */
function findHeaderRow(grid, order, syn) {
  const limit = Math.min(grid.length, 40);
  let best = -1, bestScore = 1;
  for (let r = 0; r < limit; r++) {
    const score = headerScore(grid[r], order, syn);
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

/* Map each field to a column index, by heading when there is a header row. */
function mapByHeader(headerTexts, order, syn) {
  order = order || FIELD_ORDER;
  syn = syn || FIELD_SYNONYMS;
  const mapping = {};
  const taken = new Set();
  order.forEach((field) => {
    const syns = syn[field];
    /* Walk the synonym list in order so an exact "ticketno" beats a loose
       "details" sitting further left. */
    for (const syn of syns) {
      for (let c = 0; c < headerTexts.length; c++) {
        if (taken.has(c)) continue;
        if (squash(headerTexts[c]) === syn) { mapping[field] = c; taken.add(c); return; }
      }
    }
    /* Nothing matched exactly — allow a heading that merely contains the word,
       which catches "Passenger Name (as in passport)". */
    for (const syn of syns) {
      if (syn.length < 4) continue;
      for (let c = 0; c < headerTexts.length; c++) {
        if (taken.has(c)) continue;
        if (squash(headerTexts[c]).indexOf(syn) >= 0) { mapping[field] = c; taken.add(c); return; }
      }
    }
  });
  return mapping;
}

/* No usable header: fall back to what the data itself looks like. The amount
   is whichever column parses as a number most often; the passenger name is the
   wordiest text column left of it. */
function mapByContent(grid, cells, width, startRow) {
  const numeric = new Array(width).fill(0);
  const wordy = new Array(width).fill(0);
  let sampled = 0;
  for (let r = startRow; r < grid.length && sampled < 40; r++) {
    const row = grid[r];
    if (!row || !row.join('').trim()) continue;
    sampled++;
    for (let c = 0; c < width; c++) {
      if (parseAmount(cells[r][c]) != null) numeric[c]++;
      const t = (row[c] || '').trim();
      if (t && !/^[\d.,\s]+$/.test(t)) wordy[c] += t.length;
    }
  }
  const mapping = {};
  let amountCol = -1, bestNum = 0;
  for (let c = width - 1; c >= 0; c--) {
    if (numeric[c] > bestNum) { bestNum = numeric[c]; amountCol = c; }
  }
  if (amountCol >= 0 && bestNum > 0) mapping.amount = amountCol;

  let paxCol = -1, bestWords = 0;
  for (let c = 0; c < width; c++) {
    if (c === amountCol) continue;
    if (wordy[c] > bestWords) { bestWords = wordy[c]; paxCol = c; }
  }
  if (paxCol >= 0 && bestWords > 0) mapping.pax = paxCol;
  return mapping;
}

function isTotalsRow(rowTexts) {
  const joined = rowTexts.map(squash).filter(Boolean);
  if (!joined.length) return false;
  return joined.some((t) => TOTAL_WORDS.indexOf(t) >= 0);
}

/**
 * Pull line items out of a spreadsheet.
 *
 * @param {string} filePath  .xlsx or .csv
 * @param {object} [opts]    { sheet, mapping, headerRow } to override the guess
 * @returns {Promise<object>} everything the UI needs to show a preview
 */
async function readInvoiceItems(filePath, opts) {
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
    ? opts.headerRow : findHeaderRow(grid);
  const firstDataRow = headerRow >= 0 ? headerRow + 1 : 0;

  const mapping = opts.mapping || (headerRow >= 0
    ? mapByHeader(grid[headerRow])
    : mapByContent(grid, cells, width, firstDataRow));

  const at = (row, field) => {
    const c = mapping[field];
    return (c == null || c < 0) ? '' : (row[c] || '').trim();
  };

  const items = [];
  let skippedBlank = 0, skippedTotals = 0;
  for (let r = firstDataRow; r < grid.length; r++) {
    const row = grid[r];
    if (!row || !row.join('').trim()) { skippedBlank++; continue; }
    if (isTotalsRow(row)) { skippedTotals++; continue; }

    const amountCol = mapping.amount;
    const amount = amountCol == null ? null : parseAmount(cells[r][amountCol]);
    const item = {
      pax: at(row, 'pax'),
      pnr: at(row, 'pnr'),
      route: at(row, 'route'),
      service: at(row, 'service'),
      ticket: at(row, 'ticket'),
      days: at(row, 'days').replace(/[^\d]/g, ''),
      amount: amount == null ? '' : amount
    };
    /* A row with neither a name nor a figure carries nothing worth importing —
       usually a stray note or a spacer that was not quite blank. */
    if (!item.pax && !item.route && item.amount === '') { skippedBlank++; continue; }
    items.push(item);
  }

  /* Column headings to show in the mapping dropdowns. Falls back to
     "Column A / B / C" when the sheet has no header row. */
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
    items: items,
    skipped: { blank: skippedBlank, totals: skippedTotals },
    fields: FIELD_ORDER.map((f) => ({ key: f, label: FIELD_LABELS[f] }))
  };
}

module.exports = {
  readInvoiceItems,
  parseAmount,
  FIELD_ORDER,
  FIELD_LABELS,
  FIELD_SYNONYMS,
  /* Shared with statement-import.js: one header-hunting engine, two
     vocabularies. */
  squash,
  cellText,
  readGrid,
  findHeaderRow,
  mapByHeader,
  isTotalsRow,
  TOTAL_WORDS
};
