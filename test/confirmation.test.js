const test = require('node:test');
const assert = require('node:assert/strict');
const { server, db } = require('../server');

test('receiving confirmation is idempotent for the same key', async (t) => {
  const snapshot = JSON.parse(JSON.stringify(db));
  const listener = await new Promise((resolve) => {
    const instance = server.listen(0, () => resolve(instance));
  });
  t.after(() => {
    server.close();
    db.users = snapshot.users; db.products = snapshot.products; db.purchaseOrders = snapshot.purchaseOrders; db.receipts = snapshot.receipts; db.version = snapshot.version;
    require('../src/db').save(db);
  });
  const base = `http://127.0.0.1:${listener.address().port}`;
  const request = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' }) });
  const { token } = await login.json();
  const auth = { authorization: `Bearer ${token}` };
  const productsResponse = await request('/api/products', { headers: auth });
  const product = (await productsResponse.json()).products[0];
  const poResponse = await request('/api/purchase-orders', { method: 'POST', headers: auth, body: JSON.stringify({ supplier: 'Idempotency test', lines: [{ productId: product.id, orderedQty: 3 }] }) });
  const po = (await poResponse.json()).purchaseOrder;
  const key = 'test-receiving-key';
  const firstResponse = await request(`/api/purchase-orders/${po.id}/receipts/confirm`, { method: 'POST', headers: auth, body: JSON.stringify({ idempotencyKey: key, lines: [{ lineId: po.lines[0].id, countedQty: 3 }] }) });
  assert.equal(firstResponse.status, 201);
  const first = await firstResponse.json();
  const onHandAfterFirst = db.products.find((item) => item.id === product.id).inventoryOnHand;
  const secondResponse = await request(`/api/purchase-orders/${po.id}/receipts/confirm`, { method: 'POST', headers: auth, body: JSON.stringify({ idempotencyKey: key, lines: [{ lineId: po.lines[0].id, countedQty: 3 }] }) });
  assert.equal(secondResponse.status, 200);
  const second = await secondResponse.json();
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.receipt.id, first.receipt.id);
  assert.equal(db.products.find((item) => item.id === product.id).inventoryOnHand, onHandAfterFirst);
  assert.equal(db.receipts.filter((receipt) => receipt.id === first.receipt.id).length, 1);
});
