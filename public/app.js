const state = {
  token: localStorage.getItem('stockroom_token') || '',
  user: null,
  view: 'dashboard',
  selectedPoId: null,
  products: [],
  orders: [],
  receiveCounts: {}
};

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const money = (value) => Number(value || 0).toLocaleString();

async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(state.token ? { authorization: `Bearer ${state.token}` } : {}), ...(options.headers || {}) };
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Something went wrong.');
  return payload;
}

function toast(message, type = '') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  $('#toast-region').appendChild(node);
  setTimeout(() => node.remove(), 4500);
}

function badge(status) {
  const style = { COMPLETE: 'green', RECEIVED: 'green', SHORT: 'red', EXCESS: 'amber', 'NOT COUNTED': 'gray', OPEN: 'blue' }[status] || 'gray';
  return `<span class="badge badge-${style}">${escapeHtml(status)}</span>`;
}

function setLoggedIn(user) {
  state.user = user;
  $('#auth-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#user-email').textContent = user.email;
  $('#user-initials').textContent = user.email.slice(0, 1).toUpperCase();
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  document.querySelector('.sidebar')?.classList.remove('open');
  const titles = { dashboard: 'Overview', receive: 'Receive delivery', orders: 'Purchase orders', products: 'Products', import: 'Import catalog', history: 'Receiving history' };
  $('#page-title').textContent = titles[view] || 'Overview';
  renderView().catch((err) => toast(err.message, 'error'));
}

async function renderView() {
  const container = $('#view-container');
  container.innerHTML = '<div class="panel"><div class="empty">Loading workspace…</div></div>';
  if (state.view === 'dashboard') return renderDashboard(container);
  if (state.view === 'receive') return renderReceive(container);
  if (state.view === 'orders') return renderOrders(container);
  if (state.view === 'products') return renderProducts(container);
  if (state.view === 'import') return renderImport(container);
  if (state.view === 'history') return renderHistory(container);
}

async function renderDashboard(container) {
  const [dashboard, orders] = await Promise.all([api('/api/dashboard'), api('/api/purchase-orders')]);
  state.orders = orders.purchaseOrders;
  const open = state.orders.filter((po) => po.status === 'OPEN');
  container.innerHTML = `
    <div class="grid metrics-grid">
      <div class="metric"><div class="metric-label">Products in catalog</div><div class="metric-value">${money(dashboard.products)}</div><div class="metric-note">Ready to receive</div></div>
      <div class="metric"><div class="metric-label">Units on hand</div><div class="metric-value">${money(dashboard.unitsOnHand)}</div><div class="metric-note">Across all products</div></div>
      <div class="metric"><div class="metric-label">Open purchase orders</div><div class="metric-value">${money(dashboard.openPurchaseOrders)}</div><div class="metric-note">Waiting for a count</div></div>
      <div class="metric"><div class="metric-label">Received today</div><div class="metric-value">${money(dashboard.receivedToday)}</div><div class="metric-note">Confirmed sessions</div></div>
    </div>
    <div class="section-heading"><h3>Ready to receive</h3><button class="button button-quiet" data-view-action="orders">View all orders →</button></div>
    <div class="panel">${open.length ? `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Supplier</th><th>Lines</th><th>Ordered units</th><th>Status</th><th></th></tr></thead><tbody>${open.map((po) => `<tr><td><strong>${escapeHtml(po.number)}</strong></td><td>${escapeHtml(po.supplier)}</td><td>${po.lineCount}</td><td>${money(po.totalOrdered)}</td><td>${badge(po.status)}</td><td><button class="button button-secondary" data-receive-po="${po.id}">Open count</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No open purchase orders. Create one when the next delivery is expected.</div>'}</div>
    <div class="section-heading"><h3>Recent confirmations</h3><button class="button button-quiet" data-view-action="history">See history →</button></div>
    <div class="panel">${dashboard.recentReceipts.length ? `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Confirmed</th><th>By</th><th>Lines</th></tr></thead><tbody>${dashboard.recentReceipts.map((receipt) => `<tr><td><strong>${escapeHtml(receipt.poNumber)}</strong></td><td>${new Date(receipt.confirmedAt).toLocaleString()}</td><td>${escapeHtml(receipt.confirmedBy)}</td><td>${receipt.lines.length}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Confirmed receiving sessions will appear here.</div>'}</div>
  `;
  wireViewActions();
}

async function renderReceive(container) {
  const result = await api('/api/purchase-orders');
  state.orders = result.purchaseOrders;
  if (!state.selectedPoId || !state.orders.some((po) => po.id === state.selectedPoId)) state.selectedPoId = state.orders.find((po) => po.status === 'OPEN')?.id || state.orders[0]?.id;
  const po = state.orders.find((item) => item.id === state.selectedPoId);
  if (!po) {
    container.innerHTML = '<div class="panel"><div class="empty">There are no purchase orders yet. <button class="button button-quiet" data-view-action="orders">Create a purchase order →</button></div></div>'; wireViewActions(); return;
  }
  const detail = await api(`/api/purchase-orders/${po.id}`);
  state.receiveCounts = Object.fromEntries(detail.purchaseOrder.lines.map((line) => [line.id, '']));
  renderReceiveDetail(container, detail.purchaseOrder);
}

function renderReceiveDetail(container, po) {
  const lines = po.lines;
  const rows = lines.map((line) => {
    const value = state.receiveCounts[line.id] ?? '';
    const counted = value === '' ? null : Number(value);
    const status = counted === null || !Number.isFinite(counted) ? 'NOT COUNTED' : counted === line.orderedQty ? 'COMPLETE' : counted < line.orderedQty ? 'SHORT' : 'EXCESS';
    const variance = counted === null || !Number.isFinite(counted) ? '—' : counted - line.orderedQty;
    const varianceClass = variance === '—' ? '' : variance === 0 ? 'variance-zero' : variance < 0 ? 'variance-negative' : 'variance-positive';
    return `<tr><td><strong>${escapeHtml(line.productName)}</strong><br><small class="muted">${escapeHtml(line.sku)}</small></td><td>${money(line.orderedQty)}</td><td><input class="count-input" inputmode="numeric" min="0" type="number" value="${value}" data-count-line="${line.id}" aria-label="Count for ${escapeHtml(line.productName)}"></td><td class="variance ${varianceClass}">${variance}</td><td class="status-cell" data-status-line="${line.id}">${badge(status)}</td></tr>`;
  }).join('');
  const countedAll = lines.every((line) => state.receiveCounts[line.id] !== '' && Number.isFinite(Number(state.receiveCounts[line.id])) && Number(state.receiveCounts[line.id]) >= 0);
  container.innerHTML = `
    <div class="receive-head"><div><div class="receive-title"><button class="button button-quiet back" data-view-action="dashboard" aria-label="Back to overview">←</button><div><h3>${escapeHtml(po.number)}</h3><p class="muted">${escapeHtml(po.supplier)} · ${lines.length} line${lines.length === 1 ? '' : 's'}</p></div></div></div><div class="receive-actions"><div class="future-control" title="AI counting is not available in this MVP"><span>FUTURE INTERFACE</span>AI count assist</div><button class="button button-secondary" data-view-action="orders">Change order</button></div></div>
    <div class="panel"><div class="panel-header"><div><h3>Count delivery</h3><p class="muted" style="margin:5px 0 0;font-size:12px">Scan a barcode or enter the physical quantity for every line.</p></div><label style="min-width:210px"><span class="sr-only">Lookup product</span><input id="receive-lookup" placeholder="⌕  Barcode or SKU lookup" aria-label="Barcode or SKU lookup"></label></div><div class="table-wrap"><table><thead><tr><th>Product</th><th>Ordered</th><th>Counted</th><th>Variance</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div></div>
    <div class="confirm-bar"><p><strong>Inventory stays unchanged until confirmation.</strong><br>${countedAll ? 'All lines are counted. Review variances, then confirm this delivery.' : 'Count every line to enable confirmation. NOT COUNTED lines cannot update inventory.'}</p><button id="confirm-receipt" class="button button-primary" ${countedAll ? '' : 'disabled'}>Confirm receiving →</button></div>
  `;
  document.querySelectorAll('[data-count-line]').forEach((input) => input.addEventListener('input', () => {
    state.receiveCounts[input.dataset.countLine] = input.value;
    renderReceiveDetail(container, po);
  }));
  $('#confirm-receipt').addEventListener('click', () => confirmReceipt(po));
  $('#receive-lookup').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const query = event.target.value.trim().toLowerCase();
    const found = po.lines.find((line) => line.sku.toLowerCase() === query);
    if (!found) return toast('No matching line on this purchase order.', 'error');
    document.querySelector(`[data-count-line="${found.id}"]`)?.focus();
  });
}

async function confirmReceipt(po) {
  const idempotencyKey = crypto.randomUUID();
  try {
    const result = await api(`/api/purchase-orders/${po.id}/receipts/confirm`, { method: 'POST', body: JSON.stringify({ idempotencyKey, lines: Object.entries(state.receiveCounts).map(([lineId, countedQty]) => ({ lineId, countedQty })) }) });
    toast(`Receiving confirmed · ${result.summary.COMPLETE} complete, ${result.summary.SHORT + result.summary.EXCESS} with variance.`);
    state.selectedPoId = null; setView('dashboard');
  } catch (err) { toast(err.message, 'error'); }
}

async function renderOrders(container) {
  const [orders, products] = await Promise.all([api('/api/purchase-orders'), api('/api/products')]);
  state.orders = orders.purchaseOrders; state.products = products.products;
  container.innerHTML = `
    <div class="toolbar"><div><p class="muted" style="margin:0;font-size:13px">Create and track supplier deliveries.</p></div><button id="new-order-toggle" class="button button-primary">+ New purchase order</button></div>
    <div id="new-order-form" class="panel hidden" style="margin-bottom:20px"><div class="panel-header"><h3>New purchase order</h3></div><form id="order-form" style="padding:20px"><div class="form-grid"><label>Supplier<input name="supplier" placeholder="Supplier name" required></label><label>Order reference <span class="muted">(optional)</span><input name="number" placeholder="PO-1002"></label><div class="full"><div class="section-heading" style="margin-top:5px"><h3>First line</h3></div><div class="inline-form"><label>Product<select name="productId" required>${state.products.map((p) => `<option value="${p.id}">${escapeHtml(p.sku)} · ${escapeHtml(p.name)}</option>`).join('')}</select></label><label style="max-width:170px">Ordered quantity<input name="orderedQty" type="number" min="1" value="1" required></label><button class="button button-primary" type="submit">Create order</button></div></div></div><p id="order-form-error" class="form-error"></p></form></div>
    <div class="panel">${state.orders.length ? `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Supplier</th><th>Created</th><th>Lines</th><th>Units</th><th>Status</th><th></th></tr></thead><tbody>${state.orders.map((po) => `<tr><td><strong>${escapeHtml(po.number)}</strong></td><td>${escapeHtml(po.supplier)}</td><td>${new Date(po.createdAt).toLocaleDateString()}</td><td>${po.lineCount}</td><td>${money(po.totalOrdered)}</td><td>${badge(po.status)}</td><td><button class="button button-secondary" data-receive-po="${po.id}">${po.status === 'OPEN' ? 'Receive' : 'View'}</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No purchase orders yet.</div>'}</div>
  `;
  $('#new-order-toggle').addEventListener('click', () => $('#new-order-form').classList.toggle('hidden'));
  $('#order-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const form = new FormData(event.target);
    try { await api('/api/purchase-orders', { method: 'POST', body: JSON.stringify({ supplier: form.get('supplier'), number: form.get('number'), lines: [{ productId: form.get('productId'), orderedQty: form.get('orderedQty') }] }) }); toast('Purchase order created.'); renderOrders(container); }
    catch (err) { $('#order-form-error').textContent = err.message; }
  });
  wireViewActions();
}

async function renderProducts(container) {
  const result = await api('/api/products'); state.products = result.products;
  container.innerHTML = `<div class="toolbar"><div><p class="muted" style="margin:0;font-size:13px">Search by SKU, barcode, or product name.</p></div><label class="search-label search"><span>⌕</span><input id="product-search" placeholder="Search products" aria-label="Search products"></label></div><div id="products-panel" class="panel"></div>`;
  const renderRows = (products) => { $('#products-panel').innerHTML = products.length ? `<div class="table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th>Barcode</th><th>Unit</th><th>On hand</th></tr></thead><tbody>${products.map((p) => `<tr><td><strong>${escapeHtml(p.name)}</strong></td><td>${escapeHtml(p.sku)}</td><td>${escapeHtml(p.barcode || '—')}</td><td>${escapeHtml(p.unit)}</td><td>${money(p.inventoryOnHand)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No products match that lookup.</div>'; };
  renderRows(state.products);
  $('#product-search').addEventListener('input', (event) => { const query = event.target.value.toLowerCase(); renderRows(state.products.filter((p) => [p.name, p.sku, p.barcode].some((v) => String(v).toLowerCase().includes(query)))); });
}

async function renderImport(container) {
  container.innerHTML = `<div class="toolbar"><div><p class="muted" style="margin:0;font-size:13px">Bring in a catalog without changing inventory.</p></div></div><div class="panel"><div class="panel-header"><div><h3>Catalog file</h3><p class="muted" style="margin:5px 0 0;font-size:12px">CSV or XLSX · required columns: SKU and name · stock columns are preview-only</p></div></div><div style="padding:20px"><label class="dropzone" for="catalog-file"><strong>Choose a CSV or XLSX file</strong><p>Preview rows and errors before anything is saved.</p><input id="catalog-file" type="file" accept=".csv,.xlsx"></label><p id="import-note" class="progress-note"></p><div id="import-preview"></div></div></div>`;
  $('#catalog-file').addEventListener('change', previewImport);
}

async function previewImport(event) {
  const file = event.target.files[0]; if (!file) return;
  $('#import-note').textContent = `Reading ${file.name}…`;
  try {
    const isXlsx = /\.xlsx?$/i.test(file.name);
    let payload;
    if (isXlsx) { const buffer = await file.arrayBuffer(); let binary = ''; new Uint8Array(buffer).forEach((byte) => { binary += String.fromCharCode(byte); }); payload = { filename: file.name, base64: btoa(binary) }; }
    else payload = { filename: file.name, content: await file.text() };
    const result = await api('/api/import/preview', { method: 'POST', body: JSON.stringify(payload) });
    window.lastImportRows = result.rows;
    $('#import-note').textContent = `${result.validCount} valid row${result.validCount === 1 ? '' : 's'} · ${result.errorCount} with errors`;
    $('#import-preview').innerHTML = `<div class="panel" style="margin-top:18px"><div class="panel-header"><div><h3>Preview</h3><p class="muted" style="margin:5px 0 0;font-size:12px">Only valid rows can be committed.</p></div><button id="commit-import" class="button button-primary" ${result.validCount ? '' : 'disabled'}>Commit ${result.validCount} rows</button></div><div class="table-wrap"><table><thead><tr><th>Row</th><th>SKU</th><th>Product</th><th>Barcode</th><th>On hand</th><th>Validation</th></tr></thead><tbody>${result.rows.map((row) => `<tr><td>${row.rowNumber}</td><td>${escapeHtml(row.sku || '—')}</td><td>${escapeHtml(row.name || '—')}</td><td>${escapeHtml(row.barcode || '—')}</td><td>${row.hasInventory ? row.inventoryOnHand : '—'}</td><td>${row.errors.length ? `<span class="badge badge-red">${escapeHtml(row.errors.join(', '))}</span>` : '<span class="badge badge-green">Ready</span>'}</td></tr>`).join('')}</tbody></table></div></div>`;
    $('#commit-import').addEventListener('click', async () => { try { const committed = await api('/api/import/commit', { method: 'POST', body: JSON.stringify({ rows: window.lastImportRows }) }); toast(`${committed.imported} product${committed.imported === 1 ? '' : 's'} imported.`); setView('products'); } catch (err) { toast(err.message, 'error'); } });
  } catch (err) { $('#import-note').textContent = err.message; toast(err.message, 'error'); }
}

async function renderHistory(container) {
  const result = await api('/api/receipts');
  container.innerHTML = `<div class="toolbar"><div><p class="muted" style="margin:0;font-size:13px">Every confirmed session is recorded with its line-level variance.</p></div></div><div class="panel">${result.receipts.length ? `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Confirmed</th><th>By</th><th>Lines</th><th>Outcome</th></tr></thead><tbody>${result.receipts.map((receipt) => { const summary = receipt.lines.reduce((acc, line) => { acc[line.status] = (acc[line.status] || 0) + 1; return acc; }, {}); return `<tr><td><strong>${escapeHtml(receipt.poNumber)}</strong></td><td>${new Date(receipt.confirmedAt).toLocaleString()}</td><td>${escapeHtml(receipt.confirmedBy)}</td><td>${receipt.lines.length}</td><td>${summary.SHORT || summary.EXCESS ? badge('SHORT') : badge('COMPLETE')} <span class="muted" style="font-size:11px">${summary.SHORT || 0} short · ${summary.EXCESS || 0} excess</span></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">No receiving history yet. Confirm a delivery to create the first record.</div>'}</div>`;
}

function wireViewActions() {
  document.querySelectorAll('[data-view-action]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.viewAction)));
  document.querySelectorAll('[data-receive-po]').forEach((button) => button.addEventListener('click', () => { state.selectedPoId = button.dataset.receivePo; setView('receive'); }));
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#login-error').textContent = '';
  try { const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('#login-email').value, password: $('#login-password').value }) }); state.token = result.token; localStorage.setItem('stockroom_token', state.token); setLoggedIn(result.user); setView('dashboard'); }
  catch (err) { $('#login-error').textContent = err.message; }
});
$('#logout-button').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST' }); } catch {} localStorage.removeItem('stockroom_token'); state.token = ''; $('#app-view').classList.add('hidden'); $('#auth-view').classList.remove('hidden'); });
document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
$('[data-view-action="receive"]').addEventListener('click', () => setView('receive'));
$('#mobile-menu').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));

(async function boot() {
  if (!state.token) return;
  try { const result = await api('/api/auth/me'); setLoggedIn(result.user); setView('dashboard'); }
  catch { localStorage.removeItem('stockroom_token'); state.token = ''; }
})();
