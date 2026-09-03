/* ============================================================
   Invoice renderer - turns invoice data into the printable HTML
   used by both the on-screen preview and the PDF export.
   ============================================================ */
(function (root) {
  'use strict';

  var CURRENCIES = (typeof module !== 'undefined' && module.exports)
    ? require('./currencies')
    : root.CURRENCIES;
  var CURRENCY = CURRENCIES.map;

  function currency(code) {
    return CURRENCY[code] || CURRENCY.ZMW;
  }

  /* What the last detail column is called, per service field type. */
  var FIELD_HEADERS = {
    text: 'TICKET NO.',
    hotel: 'HOTEL NAME',
    country: 'COUNTRY',
    package: 'PACKAGE COUNTRY',
    country_days: 'COUNTRY & DAYS',
    misc: 'MISCELLANEOUS SERVICE',
    driver: 'DRIVER'
  };
  /* Which field types are a country dropdown in the form. */
  var COUNTRY_FIELDS = ['country', 'package', 'country_days'];
  /* Kept to one short word: the column is only ~136px wide, so anything
     longer gets ellipsised in the header band. */
  var MIXED_HEADER = 'DETAILS';
  var DRIVER_OPTIONS = ['With Driver', 'Without Driver'];

  /* Settings may still hold the pre-1.1 shape (plain strings). */
  function normalizeServices(list) {
    return (list || []).map(function (s) {
      if (typeof s === 'string') return { name: s, field: 'text' };
      return { name: s.name, field: FIELD_HEADERS[s.field] ? s.field : 'text' };
    }).filter(function (s) { return s.name; });
  }

  function fieldFor(serviceName, services) {
    var want = String(serviceName || '').trim().toLowerCase();
    var list = normalizeServices(services);
    for (var i = 0; i < list.length; i++) {
      if (list[i].name.trim().toLowerCase() === want) return list[i].field;
    }
    return 'text';
  }

  /* One heading has to cover every row, so it only gets specific when all
     the rows agree; a mixed invoice falls back to the generic label. */
  function detailHeader(items, services) {
    var seen = [];
    (items || []).forEach(function (it) {
      var f = fieldFor(it.service, services);
      if (seen.indexOf(f) < 0) seen.push(f);
    });
    if (seen.length === 1) return FIELD_HEADERS[seen[0]] || FIELD_HEADERS.text;
    return MIXED_HEADER;
  }

  var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'];
  var TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function underThousand(n) {
    var out = '';
    if (n >= 100) { out = ONES[Math.floor(n / 100)] + ' Hundred'; n %= 100; if (n) out += ' '; }
    if (n >= 20) { out += TENS[Math.floor(n / 10)]; if (n % 10) out += ' ' + ONES[n % 10]; }
    else if (n > 0) { out += ONES[n]; }
    return out;
  }

  /* 8750 -> "Eight Thousand Seven Hundred Fifty" (international scale) */
  function wholeToWords(n) {
    if (n === 0) return 'Zero';
    var groups = ['', ' Thousand', ' Million', ' Billion', ' Trillion'];
    var parts = [], i = 0;
    while (n > 0 && i < groups.length) {
      var chunk = n % 1000;
      if (chunk) parts.unshift(underThousand(chunk) + groups[i]);
      n = Math.floor(n / 1000);
      i++;
    }
    return parts.join(' ');
  }

  /* 1240000 -> "Twelve Lakh Forty Thousand".
     A currency grouped 12,40,000 has to read in lakh and crore too — writing
     the figure the Indian way and the words the international way ("One
     Million Two Hundred Forty Thousand") makes the two lines contradict each
     other on the same invoice. Same split as groupDigits: the bottom three
     digits are the thousands part, everything above is taken two at a time. */
  function wholeToWordsIndian(n) {
    if (n === 0) return 'Zero';
    var parts = [];
    var low = n % 1000;
    n = Math.floor(n / 1000);
    var scales = [' Thousand', ' Lakh', ' Crore', ' Arab', ' Kharab'];
    if (n > 0) {
      var i = 0;
      /* The thousands slot is only two digits wide here: 12,40,000 splits as
         12 lakh | 40 thousand | 000, so hundreds never appear above the low
         three digits and underThousand's 100s branch stays unused. */
      while (n > 0 && i < scales.length) {
        var chunk = n % 100;
        if (chunk) parts.unshift(underThousand(chunk) + scales[i]);
        n = Math.floor(n / 100);
        i++;
      }
    }
    if (low) parts.push(underThousand(low));
    return parts.join(' ');
  }

  /* "Eight Thousand Seven Hundred Fifty Zambian Kwacha Only" */
  function amountInWords(amount, currencyCode) {
    var cur = currency(currencyCode);
    var scale = Math.pow(10, cur.decimals);
    var value = Math.round((Number(amount) || 0) * scale) / scale;
    var whole = Math.floor(value);
    var minor = Math.round((value - whole) * scale);
    var words = cur.group === 'in' ? wholeToWordsIndian : wholeToWords;
    var text = words(whole) + ' ' + cur.major;
    if (minor > 0 && cur.minor) text += ' and ' + underThousand(minor) + ' ' + cur.minor;
    return text + ' Only';
  }

  /* Digit grouping, done by hand rather than through toLocaleString.

     Two reasons. First, the invoice must never inherit the grouping of
     whichever PC it happens to run on — an INR invoice reads 12,40,000.50
     and a ZMW one reads 1,240,000.50, on every machine. Second, toLocaleString
     will happily hand back Arabic-Indic digits (١٢٤٠) for some locales; an
     amount that is not plain 0-9 digits is a broken invoice, so the digits
     here come straight from toFixed and are only ever split with commas. */
  function groupDigits(intStr, style) {
    if (style !== 'in') return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    /* Indian: the last three digits stay together, everything above them
       is split in twos — 1240000 -> 12,40,000 and 12400000 -> 1,24,00,000. */
    if (intStr.length <= 3) return intStr;
    return intStr.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + intStr.slice(-3);
  }

  /* 8750 -> "8,750.00" (JPY and friends carry no decimals) */
  function formatMoney(amount, currencyCode) {
    var cur = currency(currencyCode);
    var n = Number(amount);
    if (!isFinite(n)) n = 0;
    var fixed = Math.abs(n).toFixed(cur.decimals).split('.');
    return (n < 0 ? '-' : '') + groupDigits(fixed[0], cur.group) +
      (fixed[1] ? '.' + fixed[1] : '');
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* Blank fields must not collapse the row height */
  function cell(v) { var s = esc(v).trim(); return s === '' ? '&nbsp;' : s; }

  function money(amount, code) {
    return '<div class="amt-wrap"><span class="amt-cur">' + esc(code) +
      '</span><span class="amt-val">' + formatMoney(amount, code) + '</span></div>';
  }

  /* What the detail column prints for a row. Travel Insurance carries two
     values (country + days), everything else is a single field. */
  function detailText(it, services) {
    if (fieldFor(it.service, services) !== 'country_days') return it.ticket || '';
    var parts = [];
    if (it.ticket) parts.push(it.ticket);
    if (it.days) parts.push(it.days + ' Day' + (Number(it.days) === 1 ? '' : 's'));
    return parts.join(' - ');
  }

  /* The source text writes " ," and " ." with a leading space, which lets a line
     break start with an orphan comma. Glue the punctuation to the word before it. */
  function disclaimerText(lines) {
    var text = (lines || []).join(' ').replace(/\s+/g, ' ').trim();
    return esc(text).replace(/ ([,.])/g, ' $1');
  }

  function itemsTotal(items) {
    return (items || []).reduce(function (sum, it) {
      var n = Number(it.amount);
      return sum + (isFinite(n) ? n : 0);
    }, 0);
  }

  /* Line items per printed page.

     Five is a measured limit, not a round number: five rows plus the closing
     block (totals, bank details, disclaimer, footer) is exactly what fits on
     one A4 landscape page once every cell is allowed to wrap. Going over it
     used to push the bank block across the page boundary and leave the box
     cut open at the bottom — so instead the invoice starts a fresh page. */
  var PAGE_ROWS = 5;

  function chunk(list, size) {
    var out = [];
    for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  /**
   * @param {object} d    invoice data
   * @param {string} base path prefix for assets/ (e.g. "" or "../")
   */
  function buildInvoiceHTML(d, base) {
    base = base || '';
    var co = d.company, bk = d.bank;
    var code = currency(d.currency).code;
    var rows = (d.items && d.items.length) ? d.items : [{}];
    var gross = itemsTotal(rows);
    var pages = chunk(rows, PAGE_ROWS);

    function itemRows(list) {
      return list.map(function (it) {
        return '' +
          '<tr>' +
            '<td>' + cell(it.pax) + '</td>' +
            '<td>' + cell(it.pnr) + '</td>' +
            '<td>' + cell(it.route) + '</td>' +
            '<td>' + cell(it.service) + '</td>' +
            '<td>' + cell(detailText(it, d.services)) + '</td>' +
            '<td class="amt">' + money(it.amount, code) + '</td>' +
          '</tr>';
      }).join('');
    }

    var bankLines = [
      'Amount ( In Words ) : ' + amountInWords(gross, code),
      'Beneficiary Name : ' + (bk.beneficiary || ''),
      'Bank Name : ' + (bk.bankName || ''),
      'Branch Code : ' + (bk.branchCode || ''),
      'Swift Code : ' + (bk.swift || ''),
      'Account Number (ZMW) : ' + (bk.accZMW || ''),
      'Account Number (USD) : ' + (bk.accUSD || '')
    ].map(function (l) { return '<div class="pay-line">' + esc(l) + '</div>'; }).join('');

    /* Repeated at the top of every page: a continuation sheet has to read as
       the same invoice, not as a loose list of names. */
    var letterhead = '' +
      '<div class="hdr">' +
        '<div class="hdr-logo"><img src="' + base + 'assets/logo.png" alt=""></div>' +
        '<div class="hdr-invno">' + esc(d.invoiceNo) + '</div>' +
        '<div class="hdr-info">' +
          '<div class="co-name">' + esc(co.name) + '</div>' +
          '<div class="co-line">' + esc(co.address) + '</div>' +
          '<div class="co-line"><span class="lbl">Contact No.:</span> ' + esc(co.contact) + '</div>' +
          '<div class="co-line"><span class="lbl">Email:</span> ' + esc(co.email) + '</div>' +
          '<div class="co-line"><span class="lbl">Visit our website:</span> ' + esc(co.website) + '</div>' +
        '</div>' +
      '</div>';

    /* "Page 2 of 3" only ever appears on a multi-page invoice — a single-page
       one renders exactly as before, so the approved format is untouched. */
    function meta(pageNo) {
      var pager = pages.length > 1
        ? '<span class="r">Page ' + pageNo + ' of ' + pages.length + '</span>' : '';
      return '' +
        '<div class="meta">' +
          '<div class="meta-row"><span class="l">Client Name : ' + esc(d.clientName) + '</span></div>' +
          '<div class="meta-row">' +
            '<span class="l">Address : ' + esc(d.clientAddress) + '</span>' +
            '<span class="r">Invoice Date: ' + esc(d.invoiceDate) + '</span>' +
          '</div>' +
          '<div class="meta-row"><span class="l">LPO Number : ' + esc(d.lpoNumber) + '</span>' +
            pager + '</div>' +
        '</div>';
    }

    var totals = '' +
      '<tr class="total"><td class="total-lbl" colspan="5">Gross Amount</td>' +
        '<td class="amt">' + money(gross, code) + '</td></tr>' +
      '<tr class="total net"><td class="total-lbl" colspan="5">Net To Pay</td>' +
        '<td class="amt">' + money(gross, code) + '</td></tr>';

    /* The amount in words, bank details, stamp, disclaimer and footer close
       EVERY page. A client who pays off page 1 must not have to hunt for the
       account number on the last sheet, and a page that ends bare under the
       table reads as an unfinished document. */
    var closing = '' +
      '<div class="pay">' +
        (d.showStamp === false ? '' :
          '<div class="pay-stamp"><img src="' + base + 'assets/stamp.jpeg" alt=""></div>') +
        bankLines +
      '</div>' +
      '<div class="disc">' + disclaimerText(d.disclaimer) + '</div>' +
      '<div class="foot">' +
        '<img src="' + base + 'assets/iata.jpg" alt="">' +
        '<span>' + esc(d.footerNote) + '</span>' +
      '</div>';

    /* Gross Amount / Net To Pay land on the final page by default — they are
       the total for the whole invoice, not for the rows on one sheet. The
       accountant can switch them on for every page in Settings. */
    var totalsEveryPage = d.totalsEveryPage === true;

    var sheets = pages.map(function (list, i) {
      var last = i === pages.length - 1;
      return '' +
        '<div class="sheet">' +
          letterhead +
          meta(i + 1) +
          '<table class="items">' +
            '<colgroup>' +
              '<col class="c-pax"><col class="c-pnr"><col class="c-route">' +
              '<col class="c-svc"><col class="c-tkt"><col class="c-amt">' +
            '</colgroup>' +
            '<thead><tr>' +
              '<th>PASSENGER NAME</th><th>PNR</th><th>ROUTE</th>' +
              '<th>SERVICE</th><th>' + esc(d.detailHeader || FIELD_HEADERS.text) +
              '</th><th>AMOUNT</th>' +
            '</tr></thead>' +
            '<tbody>' + itemRows(list) +
              ((last || totalsEveryPage) ? totals : '') + '</tbody>' +
          '</table>' +
          closing +
        '</div>';
    }).join('');

    return '<div class="paper">' + sheets + '</div>';
  }

  var api = {
    CURRENCY: CURRENCY,
    CURRENCY_ORDER: CURRENCIES.order,
    FIELD_HEADERS: FIELD_HEADERS,
    COUNTRY_FIELDS: COUNTRY_FIELDS,
    DRIVER_OPTIONS: DRIVER_OPTIONS,
    currency: currency,
    normalizeServices: normalizeServices,
    fieldFor: fieldFor,
    detailHeader: detailHeader,
    detailText: detailText,
    amountInWords: amountInWords,
    groupDigits: groupDigits,
    formatMoney: formatMoney,
    itemsTotal: itemsTotal,
    PAGE_ROWS: PAGE_ROWS,
    buildInvoiceHTML: buildInvoiceHTML
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.InvoiceRender = api;
})(typeof window !== 'undefined' ? window : globalThis);
