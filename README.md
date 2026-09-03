# Invoice Generator

A Windows desktop app (Electron) that produces **invoices** and **Tally-style ledger
statements** for a travel agency, replacing a hand-maintained Excel workbook.

Built by [Akash Sharma](mailto:akashsharma.htb@gmail.com). This repository is the
sanitised source: the company details, bank details, logo and stamp that the working
build uses have been replaced with placeholders.

---

## What it does

- **Invoices** — A4 landscape, multi-line, with amount in words, bank block, stamp,
  disclaimer and footer.
- **Ledger statements** — A4 portrait, Tally conventions: two rows per transaction
  (figures, then narration in italics), Dr/Cr marking the contra side, and a closing
  balance printed in whichever column squares the two.
- **Excel / CSV import** — finds the header row itself, scores each column against a
  synonym list, skips blank and TOTAL rows, and parses amounts in any shape
  (`ZMW 8 750`, `1.240.000,50`, `(1,234.00)`). Always shows a correctable preview,
  because column detection should never be trusted silently.
- **Export** — PDF and Excel, plus a live on-screen preview. All three render from the
  same stylesheet and the same renderer, so they cannot drift apart.
- **Auto-update** from a GitHub release feed.

## The two decisions worth knowing about

**Pagination is measured, not counted.** A ledger narration is free text — one line per
passenger — so "rows per page" is wrong by construction. The renderer lays every entry
out in an offscreen probe, reads the real heights, and fills pages against the printable
height. Verified at 100 line items across 20 pages, and confirmed row-for-row identical
between screen and print.

**Money is grouped, never re-punctuated.** Digit grouping follows the currency
(`12,40,000.50` for INR, `1,240,000.50` otherwise) but the comma and the point never
swap places. On an English invoice, full local convention reads as a typo. The Excel
amount cell is always a real number so that totals still sum.

## Layout

```
src/
  main.js               Electron main process
  preload.js            IPC bridge
  defaults.js           letterhead, bank and service defaults (placeholders here)
  invoice-render.js     invoice DOM, shared by preview / PDF / Excel
  invoice.css           invoice paper stylesheet
  statement-render.js   statement DOM and page planner
  statement.css         statement paper stylesheet
  xlsx-import.js        header hunting and column scoring
  statement-import.js   ledger import (narration on its own row)
  xlsx-export.js        invoice workbook
  xlsx-statement.js     statement workbook
  pdf-export.js         print-to-PDF
  store.js              settings and saved documents
  updater.js            GitHub release check
  ui/                   app shell, form, preview
tools/                  layout and render checks
assets/                 placeholder logo, stamp and IATA images
```

## Running it

```
npm install
npm start
```

`assets/` ships with placeholder images. Point the app at your own logo and stamp under
Settings, and replace the company and bank fields there too — nothing in `defaults.js`
is baked into the build.

## A note on what is not here

The production build carries a real company's letterhead, stamp and bank details. Those
are deliberately absent from this repository, along with any saved documents. If you are
evaluating this as work samples, the code and the layout engine are the interesting part.
