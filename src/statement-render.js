/* ============================================================
   Statement renderer - turns ledger data into the printable HTML
   used by both the on-screen preview and the PDF export.

   Reverse-engineered from "Statement Format Zambia.xlsx": a Tally-style
   Ledger Account on A4 PORTRAIT (the invoice is landscape), where every
   transaction occupies TWO table rows - the figures on the first, the
   narration underneath it in italics. Totals close the table and the
   balancing figure sits below them.
   ============================================================ */
(function (root) {
  'use strict';

  var IR = (typeof module !== 'undefined' && module.exports)
    ? require('./invoice-render')
    : root.InvoiceRender;

  /* Vouchers the accountant actually uses. Editable in Settings. */
  var VCH_TYPES = ['Journal', 'Receipt', 'Payment', 'Sales', 'Purchase',
    'Credit Note', 'Debit Note', 'Contra'];

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* "2026-05-15" -> "15-May-26", the d-mmm-yy the source sheet prints.
     Anything that is not an ISO date is passed straight through, so a
     hand-typed "15-May-26" survives an import untouched. */
  function shortDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    return Number(m[3]) + '-' + MONTHS[Number(m[2]) - 1] + '-' + m[1].slice(2);
  }

  function periodLabel(d) {
    var a = shortDate(d.fromDate), b = shortDate(d.toDate);
    if (a && b) return a + ' to ' + b;
    return a || b || '';
  }

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  /* A side only counts as filled when something was actually typed there.
     An empty string must stay empty: a ledger that prints 0.00 in every
     unused Debit cell is unreadable. */
  function has(v) {
    return v !== '' && v != null && isFinite(Number(v)) && Number(v) !== 0;
  }

  /* The Dr/Cr flag in the narrow second column.

     It marks the CONTRA side, which is why the source sheet reads "Cr" on a
     sale (the value left the Journal ledger) and "Dr" on a receipt. Derived
     rather than typed, so it can never contradict the figures beside it -
     unless the accountant deliberately overrides it on the row. */
  function markerFor(e) {
    if (e.drcr === 'Dr' || e.drcr === 'Cr') return e.drcr;
    if (has(e.debit)) return 'Cr';
    if (has(e.credit)) return 'Dr';
    return '';
  }

  function totals(entries) {
    var debit = 0, credit = 0;
    (entries || []).forEach(function (e) {
      if (has(e.debit)) debit += num(e.debit);
      if (has(e.credit)) credit += num(e.credit);
    });
    return { debit: debit, credit: credit };
  }

  /* Opening balance is optional and only ever shown when it carries a value.
     It behaves as an ordinary entry so it lands inside the totals. */
  function openingEntry(d) {
    if (!has(d.openingBalance)) return null;
    var amount = Math.abs(num(d.openingBalance));
    var isDebit = (d.openingSide || 'Dr') === 'Dr';
    return {
      date: d.fromDate,
      drcr: isDebit ? 'Cr' : 'Dr',
      particulars: 'Opening Balance',
      vch: '',
      debit: isDebit ? amount : '',
      credit: isDebit ? '' : amount,
      narration: ''
    };
  }

  function allEntries(d) {
    var list = (d.entries || []).slice();
    var open = openingEntry(d);
    if (open) list.unshift(open);
    return list;
  }

  /* Closing balance = whatever makes the two columns agree, printed on the
     lighter side. Debits ahead means the client owes us, which reads "Dr"
     even though the figure is typed into the Credit column. */
  function closing(entries) {
    var t = totals(entries);
    var diff = t.debit - t.credit;
    return {
      debit: t.debit,
      credit: t.credit,
      amount: Math.abs(diff),
      side: diff >= 0 ? 'Dr' : 'Cr',
      column: diff >= 0 ? 'credit' : 'debit'   /* which column prints it */
    };
  }

  /* Fallback entries per printed page, used only when nobody has measured.

     A fixed number cannot be right here. Unlike an invoice row, a ledger
     narration is free text — "EEE555 1TRAVELLER/INDIA 000000000..." repeated
     once per passenger — so one transaction can be one line or six. Measured:
     twelve entries fit comfortably at one line each (787px of a 1048px page)
     and overflow at two (1107px). Twelve is therefore the safe default for
     short narrations and the renderer measures the real thing instead. */
  var PAGE_ENTRIES = 12;

  /* Printable height of A4 portrait in CSS pixels: 11.69in at 96dpi, less the
     0.39in top and bottom margins the PDF export asks for. A few pixels are
     held back so a rounding difference between the measuring pass and the
     print pass can never push a sheet over the fold. */
  var PAGE_HEIGHT_PX = 1048;
  var PAGE_SAFETY_PX = 8;

  /**
   * Decide how many entries go on each page from their real measured heights.
   *
   * Greedy, first-fit: fill a page until the next transaction would not fit,
   * then start a new one. The closing block is reserved on whichever pages
   * have to carry it, so the totals can never be orphaned or split.
   *
   * @param {number[]} entryHeights  height of each transaction (both its rows)
   * @param {number}   headerHeight  letterhead + party block + column headings
   * @param {number}   tailHeight    totals + closing balance rows
   * @param {boolean}  tailEveryPage totals repeated on every page
   * @param {number}   [budget]      printable height, for testing
   * @returns {number[]} entries per page
   */
  function planPages(entryHeights, headerHeight, tailHeight, tailEveryPage, budget) {
    var limit = (budget || PAGE_HEIGHT_PX) - PAGE_SAFETY_PX;
    var n = entryHeights.length;
    var counts = [];
    var i = 0;
    while (i < n) {
      var used = headerHeight + (tailEveryPage ? tailHeight : 0);
      var count = 0;
      while (i < n) {
        /* The final transaction has to leave room for the closing block
           underneath it, unless that block is already reserved above. */
        var reserve = (i === n - 1 && !tailEveryPage) ? tailHeight : 0;
        if (count > 0 && used + entryHeights[i] + reserve > limit) break;
        used += entryHeights[i];
        count++;
        i++;
      }
      counts.push(count);
    }
    if (!counts.length) counts.push(0);
    return counts;
  }

  /* Split by measured page counts when the renderer supplied them, otherwise
     fall back to fixed-size chunks. */
  function paginate(list, counts) {
    var out = [], i = 0, k = 0;
    if (counts && counts.length) {
      while (i < list.length && k < counts.length) {
        var take = Math.max(1, counts[k] || 1);
        out.push(list.slice(i, i + take));
        i += take;
        k++;
      }
      /* More entries than the plan covers (the plan went stale between a
         keystroke and a repaint): the remainder still has to be printed. */
      while (i < list.length) {
        out.push(list.slice(i, i + PAGE_ENTRIES));
        i += PAGE_ENTRIES;
      }
      return out;
    }
    for (i = 0; i < list.length; i += PAGE_ENTRIES) out.push(list.slice(i, i + PAGE_ENTRIES));
    return out;
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * @param {object} d    statement data
   * @param {string} base path prefix for assets/ (e.g. "" or "../")
   */
  function buildStatementHTML(d, base) {
    base = base || '';
    var co = d.company || {};
    var code = IR.currency(d.currency).code;
    var entries = allEntries(d);
    if (!entries.length) entries = [{}];
    var pages = paginate(entries, d.pageCounts);
    var sum = closing(allEntries(d));

    function money(v) {
      if (!has(v)) return '&nbsp;';
      return '<div class="amt-wrap"><span class="amt-cur">' + esc(code) +
        '</span><span class="amt-val">' + IR.formatMoney(v, code) + '</span></div>';
    }

    /* Same letterhead component as the invoice, so both documents leave the
       app under one identity and one Settings block. */
    var letterhead = '' +
      '<div class="hdr">' +
        '<div class="hdr-logo"><img src="' + base + 'assets/logo.png" alt=""></div>' +
        '<div class="hdr-info">' +
          '<div class="co-name">' + esc(co.name) + '</div>' +
          '<div class="co-line">' + esc(co.address) + '</div>' +
          '<div class="co-line"><span class="lbl">Contact No.:</span> ' + esc(co.contact) + '</div>' +
          '<div class="co-line"><span class="lbl">Email:</span> ' + esc(co.email) + '</div>' +
          '<div class="co-line"><span class="lbl">Visit our website:</span> ' + esc(co.website) + '</div>' +
        '</div>' +
      '</div>';

    /* "Page 2 of 3" only appears on a multi-page statement, so a single-sheet
       one prints exactly like the source format. */
    function meta(pageNo) {
      var pager = pages.length > 1
        ? '<span class="r">Page ' + pageNo + ' of ' + pages.length + '</span>' : '';
      return '' +
        '<div class="st-party">' + esc(d.clientName) + '</div>' +
        '<div class="st-title">' + esc(d.title || 'Ledger Account') + '</div>' +
        '<div class="st-period"><span class="c">' + esc(periodLabel(d)) + '</span>' +
          pager + '</div>';
    }

    function entryRows(list) {
      return list.map(function (e) {
        var nar = String(e.narration == null ? '' : e.narration).trim();
        /* The narration keeps its own line even when empty: dropping it would
           make alternate transactions sit at different heights and the column
           of dates would stop reading as a column. */
        var narCell = nar ? esc(nar).replace(/\r?\n/g, '<br>') : '&nbsp;';
        return '' +
          '<tr class="st-e">' +
            '<td class="d">' + (shortDate(e.date) || '&nbsp;') + '</td>' +
            '<td class="m">' + (markerFor(e) || '&nbsp;') + '</td>' +
            '<td class="p">' + (esc(e.particulars) || '&nbsp;') + '</td>' +
            '<td class="v">' + (esc(e.vch) || '&nbsp;') + '</td>' +
            '<td class="n">' + money(e.debit) + '</td>' +
            '<td class="n">' + money(e.credit) + '</td>' +
          '</tr>' +
          '<tr class="st-n">' +
            '<td>&nbsp;</td><td>&nbsp;</td>' +
            '<td class="nar">' + narCell + '</td>' +
            '<td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>' +
          '</tr>';
      }).join('');
    }

    var totalRow = '' +
      '<tr class="st-tot">' +
        '<td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>' +
        '<td class="n">' + money(sum.debit) + '</td>' +
        '<td class="n">' + money(sum.credit) + '</td>' +
      '</tr>';

    var balRow = '' +
      '<tr class="st-bal">' +
        '<td>&nbsp;</td>' +
        '<td class="m">' + sum.side + '</td>' +
        '<td class="p">Closing Balance</td>' +
        '<td class="v">&nbsp;</td>' +
        '<td class="n">' + (sum.column === 'debit' ? money(sum.amount) : '&nbsp;') + '</td>' +
        '<td class="n">' + (sum.column === 'credit' ? money(sum.amount) : '&nbsp;') + '</td>' +
      '</tr>';

    /* Totals and the closing balance belong to the whole statement, not to one
       sheet, so they close the last page only. The accountant can switch them
       on for every page from Settings, exactly as on the invoice. */
    var everyPage = d.totalsEveryPage === true;

    var sheets = pages.map(function (list, i) {
      var last = i === pages.length - 1;
      var tail = (last || everyPage) ? (totalRow + balRow) : '';
      return '' +
        '<div class="sheet st-sheet">' +
          letterhead +
          meta(i + 1) +
          '<table class="st-tbl">' +
            '<colgroup>' +
              '<col class="s-date"><col class="s-mark"><col class="s-part">' +
              '<col class="s-vch"><col class="s-dr"><col class="s-cr">' +
            '</colgroup>' +
            '<thead><tr>' +
              '<th>Date</th><th></th><th>Particulars</th>' +
              '<th>Vch Type</th><th>Debit</th><th>Credit</th>' +
            '</tr></thead>' +
            '<tbody>' + entryRows(list) + tail + '</tbody>' +
          '</table>' +
        '</div>';
    }).join('');

    return '<div class="paper st-paper">' + sheets + '</div>';
  }

  var api = {
    VCH_TYPES: VCH_TYPES,
    PAGE_ENTRIES: PAGE_ENTRIES,
    PAGE_HEIGHT_PX: PAGE_HEIGHT_PX,
    planPages: planPages,
    shortDate: shortDate,
    periodLabel: periodLabel,
    markerFor: markerFor,
    hasValue: has,
    totals: totals,
    closing: closing,
    allEntries: allEntries,
    buildStatementHTML: buildStatementHTML
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.StatementRender = api;
})(typeof window !== 'undefined' ? window : globalThis);
