# Minimal Invoice App

A minimal, frictionless invoice web app built with React + Vite. Create invoices with client details, line items, tax/discount, a clean preview, and print/export to PDF via the browser.

## Run locally

```
npm install
npm run dev
```

Open the URL shown in the terminal.

## Features

- Minimal UI with clear left-to-right flow
- Your details, client details, invoice metadata
- Line items (description, qty, price) with live totals
- Tax percent and discount support
- Clean preview panel with print stylesheet
- Auto-save to localStorage

## Export

- Click “Print / PDF” to open the browser print dialog and save as PDF. The form is hidden; only the preview prints.

## Notes

- Currency formatting uses your locale and a chosen currency code.
- “New” clears the invoice to a fresh template.
# billora
