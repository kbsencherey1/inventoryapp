# Inventory Receiving MVP

A practical local-first inventory receiving workflow. It includes authentication scaffolding, a product catalog, CSV/XLSX preview + import, purchase orders, barcode/manual lookup, receiving variance statuses, idempotent confirmation, history, and a dashboard.

## Run locally

Requirements: Node.js 18+ and npm.

```powershell
npm install
npm test
npm start
```

Open <http://localhost:3000>. The seeded local account is:

- Email: `admin@example.com`
- Password: `admin123`

The account is intentionally a development scaffold. Replace it with your identity provider before production use.

## Persistence and schema

The app stores data in `data/inventory.json` (created on first start). `src/db.js` owns the versioned schema and migration path. Delete the file to reset the synthetic local dataset. The JSON file is ignored by git so real local data is not committed.

The confirmation endpoint accepts an `idempotencyKey`. Repeating a request with the same key returns the original receipt without incrementing inventory again. Inventory changes happen only in the confirmation transaction; preview and editing are read-only.

## Import format

CSV and XLSX files may use these headers (case-insensitive): `sku`, `barcode`, `name`/`product`, `unit`, and optional `inventory`/`onHand`. Import first shows a preview and row-level errors, then the user explicitly commits valid rows. Inventory columns are preview-only in this MVP; stock changes happen only through confirmed receiving.

## API outline

- `POST /api/auth/login`, `GET /api/auth/me`
- `GET /api/dashboard`
- `GET/POST /api/products`, `GET /api/products/lookup?q=...`
- `POST /api/import/preview`, `POST /api/import/commit`
- `GET/POST /api/purchase-orders`, `GET /api/purchase-orders/:id`
- `POST /api/purchase-orders/:id/receipts/confirm`
- `GET /api/receipts`

AI counting is intentionally not implemented; the receiving screen exposes a disabled future interface rather than fabricating an AI result.
