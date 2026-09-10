const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const XLSX = require('xlsx');
const { load, save, createId, now, verifyPassword } = require('./src/db');
const { calculateStatus, normalizeCount, summarizeLines } = require('./src/calculations');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const db = load();
const sessions = new Map();

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function error(res, status, message, details) {
  json(res, status, { error: message, ...(details ? { details } : {}) });
}

function body(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 7_000_000) {
        reject(new Error('Request is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Request body must be valid JSON.')); }
    });
    req.on('error', reject);
  });
}

function userFor(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const userId = sessions.get(token);
  return db.users.find((user) => user.id === userId);
}

function requireUser(req, res) {
  const user = userFor(req);
  if (!user) {
    error(res, 401, 'Sign in is required.');
    return null;
  }
  return user;
}

function parseCsv(input) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === ',' && !quoted) { row.push(cell.trim()); cell = ''; continue; }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell.trim()); cell = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows.shift().map((header) => header.toLowerCase().replace(/[\s_-]+/g, ''));
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function importRows(filename, raw, encoded) {
  if (/\.xlsx?$/i.test(filename)) {
    const workbook = XLSX.read(encoded ? Buffer.from(raw, 'base64') : raw, { type: encoded ? 'buffer' : 'string' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(firstSheet, { defval: '' }).map((row) => {
      const normalized = {};
      for (const [key, value] of Object.entries(row)) {
        normalized[key.toLowerCase().replace(/[\s_-]+/g, '')] = String(value);
      }
      return normalized;
    });
  }
  return parseCsv(raw);
}

function normalizeImport(rows) {
  return rows.map((row, index) => {
    const sku = String(row.sku || '').trim();
    const name = String(row.name || row.product || row.productname || '').trim();
    const barcode = String(row.barcode || '').trim();
    const unit = String(row.unit || 'each').trim() || 'each';
    const inventoryRaw = row.inventory || row.onhand || row.stock || '';
    const inventoryOnHand = inventoryRaw === '' ? 0 : Number(inventoryRaw);
    const errors = [];
    if (!sku) errors.push('SKU is required');
    if (!name) errors.push('Product name is required');
    if (inventoryRaw !== '' && (!Number.isFinite(inventoryOnHand) || inventoryOnHand < 0)) errors.push('Inventory must be a non-negative number');
    return { rowNumber: index + 2, sku, barcode, name, unit, inventoryOnHand, hasInventory: inventoryRaw !== '', errors };
  });
}

function productView(product) {
  return { ...product };
}

function routeKey(method, pathname) {
  return `${method} ${pathname}`;
}

async function api(req, res, pathname) {
  const method = req.method;
  if (routeKey(method, pathname) === 'POST /api/auth/login') {
    try {
      const input = await body(req);
      const user = db.users.find((candidate) => candidate.email.toLowerCase() === String(input.email || '').toLowerCase());
      if (!user || !verifyPassword(String(input.password || ''), user.passwordHash)) return error(res, 401, 'Email or password is incorrect.');
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, user.id);
      return json(res, 200, { token, user: { id: user.id, email: user.email, role: user.role } });
    } catch (err) { return error(res, 400, err.message); }
  }
  if (routeKey(method, pathname) === 'POST /api/auth/logout') {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    sessions.delete(token);
    return json(res, 200, { ok: true });
  }
  if (routeKey(method, pathname) === 'GET /api/auth/me') {
    const user = requireUser(req, res);
    return user ? json(res, 200, { user: { id: user.id, email: user.email, role: user.role } }) : undefined;
  }
  const user = requireUser(req, res);
  if (!user) return undefined;

  if (routeKey(method, pathname) === 'GET /api/dashboard') {
    const today = new Date().toISOString().slice(0, 10);
    const recentReceipts = [...db.receipts].sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt)).slice(0, 5);
    return json(res, 200, {
      products: db.products.length,
      unitsOnHand: db.products.reduce((sum, product) => sum + Number(product.inventoryOnHand || 0), 0),
      openPurchaseOrders: db.purchaseOrders.filter((po) => po.status === 'OPEN').length,
      receivedToday: db.receipts.filter((receipt) => receipt.confirmedAt.startsWith(today)).length,
      recentReceipts: recentReceipts.map((receipt) => ({ ...receipt, poNumber: db.purchaseOrders.find((po) => po.id === receipt.poId)?.number || receipt.poId }))
    });
  }

  if (method === 'GET' && (pathname === '/api/products' || pathname === '/api/products/lookup')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const query = (url.searchParams.get('q') || '').toLowerCase();
    const products = db.products.filter((product) => !query || [product.sku, product.barcode, product.name].some((value) => String(value).toLowerCase().includes(query)));
    return json(res, 200, { products: products.map(productView) });
  }

  if (routeKey(method, pathname) === 'GET /api/purchase-orders') {
    return json(res, 200, { purchaseOrders: db.purchaseOrders.map((po) => ({ ...po, lineCount: po.lines.length, totalOrdered: po.lines.reduce((sum, line) => sum + line.orderedQty, 0) })) });
  }

  const poMatch = pathname.match(/^\/api\/purchase-orders\/([^/]+)$/);
  if (method === 'GET' && poMatch) {
    const po = db.purchaseOrders.find((item) => item.id === poMatch[1]);
    return po ? json(res, 200, { purchaseOrder: po }) : error(res, 404, 'Purchase order not found.');
  }

  if (routeKey(method, pathname) === 'POST /api/purchase-orders') {
    try {
      const input = await body(req);
      const lines = Array.isArray(input.lines) ? input.lines : [];
      if (!String(input.supplier || '').trim() || lines.length === 0) return error(res, 400, 'Supplier and at least one line are required.');
      const normalizedLines = lines.map((line) => {
        const product = db.products.find((item) => item.id === line.productId);
        const orderedQty = Number(line.orderedQty);
        if (!product || !Number.isFinite(orderedQty) || orderedQty <= 0) throw new Error('Each line needs a valid product and quantity.');
        return { id: createId('pol'), productId: product.id, sku: product.sku, productName: product.name, orderedQty, receivedQty: 0 };
      });
      const nextNumber = `PO-${1001 + db.purchaseOrders.length}`;
      const po = { id: createId('po'), number: String(input.number || nextNumber), supplier: String(input.supplier).trim(), status: 'OPEN', createdAt: now(), lines: normalizedLines };
      db.purchaseOrders.push(po); save(db);
      return json(res, 201, { purchaseOrder: po });
    } catch (err) { return error(res, 400, err.message); }
  }

  if (routeKey(method, pathname) === 'POST /api/import/preview') {
    try {
      const input = await body(req);
      if (!input.filename || (!input.content && !input.base64)) return error(res, 400, 'A CSV or XLSX file is required.');
      const rows = importRows(input.filename, input.base64 || input.content, Boolean(input.base64));
      const normalized = normalizeImport(rows);
      return json(res, 200, { rows: normalized, validCount: normalized.filter((row) => row.errors.length === 0).length, errorCount: normalized.filter((row) => row.errors.length > 0).length });
    } catch (err) { return error(res, 400, `Import preview failed: ${err.message}`); }
  }

  if (routeKey(method, pathname) === 'POST /api/import/commit') {
    try {
      const input = await body(req);
      const rows = Array.isArray(input.rows) ? input.rows : [];
      if (rows.length === 0) return error(res, 400, 'No valid rows to import.');
      let imported = 0;
      for (const row of rows) {
        if (Array.isArray(row.errors) && row.errors.length) continue;
        const existing = db.products.find((product) => product.sku.toLowerCase() === String(row.sku).toLowerCase());
        if (existing) {
          existing.name = row.name; existing.barcode = row.barcode; existing.unit = row.unit;
        } else {
          db.products.push({ id: createId('prd'), sku: row.sku, barcode: row.barcode, name: row.name, unit: row.unit || 'each', inventoryOnHand: 0, createdAt: now() });
        }
        imported += 1;
      }
      save(db);
      return json(res, 200, { imported });
    } catch (err) { return error(res, 400, err.message); }
  }

  const confirmMatch = pathname.match(/^\/api\/purchase-orders\/([^/]+)\/receipts\/confirm$/);
  if (method === 'POST' && confirmMatch) {
    try {
      const input = await body(req);
      const po = db.purchaseOrders.find((item) => item.id === confirmMatch[1]);
      if (!po) return error(res, 404, 'Purchase order not found.');
      const idempotencyKey = String(input.idempotencyKey || '').trim();
      if (!idempotencyKey) return error(res, 400, 'An idempotency key is required.');
      const already = db.receipts.find((receipt) => receipt.poId === po.id && receipt.idempotencyKey === idempotencyKey);
      if (already) return json(res, 200, { receipt: already, idempotentReplay: true, summary: summarizeLines(already.lines) });
      const submitted = new Map((Array.isArray(input.lines) ? input.lines : []).map((line) => [line.lineId, normalizeCount(line.countedQty)]));
      const lines = po.lines.map((poLine) => {
        const countedQty = submitted.has(poLine.id) ? submitted.get(poLine.id) : null;
        return { lineId: poLine.id, productId: poLine.productId, sku: poLine.sku, productName: poLine.productName, expectedQty: poLine.orderedQty, countedQty, status: calculateStatus(poLine.orderedQty, countedQty) };
      });
      if (lines.some((line) => line.status === 'NOT COUNTED')) return error(res, 400, 'Count every line before confirming.', { lines });
      for (const line of lines) {
        const product = db.products.find((item) => item.id === line.productId);
        if (product) product.inventoryOnHand = Number(product.inventoryOnHand || 0) + line.countedQty;
        const poLine = po.lines.find((item) => item.id === line.lineId);
        poLine.receivedQty = Number(poLine.receivedQty || 0) + line.countedQty;
      }
      po.status = 'RECEIVED';
      const receipt = { id: createId('rcv'), poId: po.id, poNumber: po.number, idempotencyKey, confirmedAt: now(), confirmedBy: user.email, lines };
      db.receipts.push(receipt); save(db);
      return json(res, 201, { receipt, summary: summarizeLines(lines) });
    } catch (err) { return error(res, 400, err.message); }
  }

  if (routeKey(method, pathname) === 'GET /api/receipts') {
    const receipts = [...db.receipts].sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));
    return json(res, 200, { receipts });
  }

  return error(res, 404, 'API route not found.');
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!file.startsWith(`${PUBLIC_DIR}${path.sep}`) && file !== PUBLIC_DIR) return error(res, 403, 'Forbidden.');
  fs.readFile(file, (err, data) => {
    if (err) return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (fallbackErr, fallback) => {
      if (fallbackErr) return error(res, 404, 'Not found.');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fallback);
    });
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname.startsWith('/api/')) {
    try { await api(req, res, pathname); } catch (err) { error(res, 500, err.message); }
  } else if (req.method === 'GET') serveStatic(req, res, pathname);
  else error(res, 405, 'Method not allowed.');
});

if (require.main === module) server.listen(PORT, () => console.log(`Inventory Receiving running at http://localhost:${PORT}`));

module.exports = { server, db, parseCsv, normalizeImport };
