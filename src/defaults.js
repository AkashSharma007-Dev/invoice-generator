/* Default letterhead / bank / footer text.
   Placeholder values only - every field is editable inside the app under Settings. */
(function (root) {
  'use strict';

  var DEFAULTS = {
    company: {
      name: 'Example Travel & Tours Ltd',
      address: '1 Sample Street, Example Business Park, Lusaka, Zambia.',
      contact: '+260 000 000000',
      email: 'accounts@example.com',
      website: 'www.example.com'
    },
    bank: {
      beneficiary: 'EXAMPLE TRAVEL AND TOURS LIMITED',
      bankName: 'Example Bank Plc',
      branchCode: '000000',
      swift: 'EXAMPLEX',
      accZMW: '0000000000000',
      accUSD: '0000000000000'
    },
    disclaimer: [
      'Example Travel & Tours acts only as an agent for the companies it represents and accepts no responsibility for accidents , damage , baggage loss and /or',
      'delays due to strikes or to the fault of any company used to carry out the designated travel arrangements.'
    ],
    footerNote: '"It is computer generated invoice, so signature is not required"',
    branches: [
      { code: 'LUN', label: 'LUN - Lusaka' },
      { code: 'HRE', label: 'HRE - Harare' }
    ],
    /* `field` decides what the detail column becomes for that service —
       see FIELD_HEADERS in invoice-render.js for the full set. */
    services: [
      { name: 'AIR TICKET', field: 'text' },          /* ticket no.            */
      { name: 'HOTEL BOOKING', field: 'hotel' },      /* hotel name            */
      { name: 'VISA SERVICE', field: 'country' },     /* country dropdown      */
      { name: 'TRAVEL INSURANCE', field: 'country_days' }, /* country + days   */
      { name: 'SERVICE CHARGE', field: 'misc' },      /* miscellaneous service */
      { name: 'CAR RENTAL', field: 'driver' },        /* with/without driver   */
      { name: 'PACKAGE', field: 'package' }           /* package country       */
    ],
    showStamp: true,
    /* Gross Amount / Net To Pay on every page of a multi-page invoice.
       Off by default: they total the whole invoice, not one sheet. */
    totalsEveryPage: false,

    /* ---- statement (Ledger Account) ----
       Lifted from "Statement Format Zambia.xlsx". The heading the source
       sheet prints under the party name, the voucher types its Vch Type
       column uses, and the counter-ledger its Particulars column names. */
    statementTitle: 'Ledger Account',
    vchTypes: ['Journal', 'Receipt', 'Payment', 'Sales', 'Purchase',
      'Credit Note', 'Debit Note', 'Contra'],
    defaultParticulars: 'Journal',
    /* Totals + Closing Balance on every page of a multi-page statement.
       Off by default, for the same reason as the invoice. */
    statementTotalsEveryPage: false
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = DEFAULTS;
  root.INVOICE_DEFAULTS = DEFAULTS;
})(typeof window !== 'undefined' ? window : globalThis);
