const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'inventory.json');
const CURRENT_VERSION = 1;

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const digest = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${digest}`;
}

function verifyPassword(password, encoded) {
  const [salt, expected] = String(encoded || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function emptyDatabase() {
  return { version: CURRENT_VERSION, users: [], products: [], purchaseOrders: [], receipts: [] };
}

function seedDatabase(db) {
  if (db.users.length === 0) {
    db.users.push({
      id: id('usr'),
      email: 'admin@example.com',
      passwordHash: passwordHash('admin123'),
      role: 'admin',
      createdAt: now()
    });
  }
  if (db.products.length === 0) {
    const createdAt = now();
    db.products.push(
      { id: id('prd'), sku: 'COF-12OZ', barcode: '012345678901', name: 'House coffee · 12 oz', unit: 'bag', inventoryOnHand: 42, createdAt },
      { id: id('prd'), sku: 'MUG-WHT', barcode: '012345678902', name: 'Ceramic mug · white', unit: 'each', inventoryOnHand: 18, createdAt },
      { id: id('prd'), sku: 'TEA-EARL', barcode: '012345678903', name: 'Earl Grey tea', unit: 'box', inventoryOnHand: 7, createdAt }
    );
  }
  if (db.purchaseOrders.length === 0) {
    const createdAt = now();
    db.purchaseOrders.push({
      id: id('po'),
      number: 'PO-1001',
      supplier: 'Northstar Supply',
      status: 'OPEN',
      createdAt,
      lines: [
        { id: id('pol'), productId: db.products[0].id, sku: db.products[0].sku, productName: db.products[0].name, orderedQty: 24, receivedQty: 0 },
        { id: id('pol'), productId: db.products[1].id, sku: db.products[1].sku, productName: db.products[1].name, orderedQty: 12, receivedQty: 0 }
      ]
    });
  }
}

function migrate(db) {
  const result = { ...emptyDatabase(), ...db };
  result.version = Number(result.version || 1);
  result.users = Array.isArray(result.users) ? result.users : [];
  result.products = Array.isArray(result.products) ? result.products : [];
  result.purchaseOrders = Array.isArray(result.purchaseOrders) ? result.purchaseOrders : [];
  result.receipts = Array.isArray(result.receipts) ? result.receipts : [];
  // Future schema changes belong here as versioned blocks.
  result.version = CURRENT_VERSION;
  return result;
}

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let db;
  if (fs.existsSync(DB_FILE)) {
    try {
      db = migrate(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
    } catch {
      throw new Error(`Unable to read ${DB_FILE}; fix or remove the file to reset local data.`);
    }
  } else {
    db = emptyDatabase();
  }
  const before = JSON.stringify(db);
  seedDatabase(db);
  if (before !== JSON.stringify(db) || !fs.existsSync(DB_FILE)) save(db);
  return db;
}

function save(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${DB_FILE}.next`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(temp, DB_FILE);
}

function createId(prefix) {
  return id(prefix);
}

module.exports = {
  DB_FILE,
  createId,
  load,
  save,
  now,
  passwordHash,
  verifyPassword
};
