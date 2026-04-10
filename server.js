const https = require('https');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const CLOVER_TOKEN = 'cea0b142-7593-6c1e-5e79-f1ae5ddbd603';
const MERCHANT_ID = 'J5D10DJ83FVD1';
const PORT = process.env.PORT || 3000;

// Supabase config
const SUPABASE_URL = 'https://wntikhzvhybqhocqizuc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndudGlraHp2aHlicWhvY3FpenVjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTgzODgwOCwiZXhwIjoyMDkxNDE0ODA4fQ.jdW3GBVsC6pmQUWq1450W2jB1MiyJEcaMnLunHBcOic';

const ALLOWED_ORIGINS = [
  'https://daily.soldierfitclarksburg.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

function setCORS(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Supabase REST API helper
function supabase(method, table, query, body, callback) {
  const bodyStr = body ? JSON.stringify(body) : null;
  const options = {
    hostname: 'wntikhzvhybqhocqizuc.supabase.co',
    path: `/rest/v1/${table}${query || ''}`,
    method: method,
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'apikey': SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=representation'
    }
  };
  if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try { callback(null, JSON.parse(data || '[]'), res.statusCode); }
      catch(e) { callback(null, data, res.statusCode); }
    });
  });
  req.on('error', callback);
  if (bodyStr) req.write(bodyStr);
  req.end();
}

// Clover helpers
function cloverGet(apiPath, callback) {
  const options = {
    hostname: 'api.clover.com',
    path: apiPath,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${CLOVER_TOKEN}`, 'Content-Type': 'application/json' }
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try { callback(null, JSON.parse(data), res.statusCode); }
      catch(e) { callback(e, null, res.statusCode); }
    });
  });
  req.on('error', callback);
  req.end();
}

function cloverPost(cloverPath, body, callback) {
  const bodyStr = JSON.stringify(body);
  const options = {
    hostname: 'api.clover.com',
    path: `/v3/merchants/${MERCHANT_ID}${cloverPath}`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CLOVER_TOKEN}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr)
    }
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try { callback(null, JSON.parse(data), res.statusCode); }
      catch(e) { callback(e, null, res.statusCode); }
    });
  });
  req.on('error', callback);
  req.write(bodyStr);
  req.end();
}

function fetchDevices(callback) {
  cloverGet(`/v3/merchants/${MERCHANT_ID}/devices?limit=50`, (err, data) => {
    if(err) { callback(err, []); return; }
    callback(null, data.elements || []);
  });
}


// Fetch category sales from orders for a date range
function fetchOrderCategories(startMs, endMs, callback) {
  let allOrders = [];
  let offset = 0;
  const limit = 500;
  const MAX_PAGES = 10;
  let page = 0;

  function fetchPage() {
    if (page >= MAX_PAGES) { callback(null, allOrders); return; }
    page++;
    const apiPath = `/v3/merchants/${MERCHANT_ID}/orders?` +
      `filter=createdTime>=${startMs}&filter=createdTime<=${endMs}` +
      `&expand=lineItems&limit=${limit}&offset=${offset}`;
    cloverGet(apiPath, (err, data) => {
      if (err) { callback(err, null); return; }
      const elements = data.elements || [];
      allOrders = allOrders.concat(elements);
      if (elements.length === limit) { offset += limit; fetchPage(); }
      else { callback(null, allOrders); }
    });
  }
  fetchPage();
}

function aggregateCategories(orders) {
  const cats = {};
  orders.forEach(order => {
    if (order.state === 'OPEN' || !order.lineItems) return;
    (order.lineItems.elements || []).forEach(item => {
      if (item.refunded) return;
      const catName = item.itemGroup?.name || 'Uncategorized';
      const netAmt = ((item.price || 0) * (item.quantity || 1) - (item.discountAmount || 0)) / 100;
      if (!cats[catName]) cats[catName] = { name: catName, netSales: 0, qty: 0 };
      cats[catName].netSales += netAmt;
      cats[catName].qty += (item.quantity || 1);
    });
  });
  return Object.values(cats)
    .filter(c => c.netSales > 0)
    .sort((a, b) => b.netSales - a.netSales)
    .map(c => ({ ...c, netSales: +c.netSales.toFixed(2) }));
}



function fetchCategoryMap(callback) {
  let allCats = [];
  let offset = 0;
  const limit = 200;
  function fetchPage() {
    cloverGet(`/v3/merchants/${MERCHANT_ID}/categories?expand=items&limit=${limit}&offset=${offset}`, (err, data) => {
      if (err) { callback(err, null); return; }
      const elements = data.elements || [];
      allCats = allCats.concat(elements);
      if (elements.length === limit) { offset += limit; fetchPage(); }
      else {
        const map = {};
        allCats.forEach(cat => {
          (cat.items?.elements||[]).forEach(item => { if(!map[item.id]) map[item.id] = cat.name; });
        });
        callback(null, map);
      }
    });
  }
  fetchPage();
}

function fetchOrderCategories(startMs, endMs, callback) {
  let allOrders = [];
  let offset = 0;
  const limit = 500;
  let page = 0;
  function fetchPage() {
    if(page >= 10) { callback(null, allOrders); return; }
    page++;
    cloverGet(`/v3/merchants/${MERCHANT_ID}/orders?filter=createdTime>=${startMs}&filter=createdTime<=${endMs}&expand=lineItems&limit=${limit}&offset=${offset}`, (err, data) => {
      if(err) { callback(err, null); return; }
      const elements = data.elements || [];
      allOrders = allOrders.concat(elements);
      if(elements.length === limit) { offset += limit; fetchPage(); }
      else { callback(null, allOrders); }
    });
  }
  fetchPage();
}

function aggregateCategories(orders, catMap) {
  const cats = {};
  orders.forEach(order => {
    if(order.state === 'OPEN' || !order.lineItems) return;
    (order.lineItems.elements||[]).forEach(item => {
      if(item.refunded || item.exchanged) return;
      const itemId = item.item?.id || '';
      const catName = (itemId && catMap[itemId]) ? catMap[itemId] : 'Uncategorized';
      const netAmt = ((item.price||0)/100 * (item.quantity||1)) - ((item.discountAmount||0)/100);
      if(netAmt <= 0) return;
      if(!cats[catName]) cats[catName] = {name:catName, netSales:0, qty:0};
      cats[catName].netSales += netAmt;
      cats[catName].qty += (item.quantity||1);
    });
  });
  return Object.values(cats)
    .filter(c => c.netSales > 0)
    .sort((a,b) => b.netSales - a.netSales)
    .map(c => ({...c, netSales:+c.netSales.toFixed(2), qty:+c.qty.toFixed(2)}));
}

function buildSummaryResponse(date, startMs, endMs, done) {
  const KITCHEN_ID = 'cc044434-defb-0585-8547-a52227f9f17c';
  // Step 1: fetch payments
  fetchAllPayments(startMs, endMs, (err, payments) => {
    if (err) { done(err, null); return; }
    const pmnts = payments.filter(p => p.result === 'SUCCESS');
    let cash=0, credit=0, debit=0, ebt=0, tax=0, total=0;
    let kCash=0, kCredit=0, kDebit=0, kEbt=0, kTax=0, kTotal=0;
    pmnts.forEach(p => {
      const amt = (p.amount||0)/100;
      const refunded = (p.refunds?.elements||[]).reduce((s,r)=>(s+(r.amount||0)/100),0);
      const netAmt = amt - refunded;
      const taxAmt = (p.taxAmount||0)/100;
      const tender = (p.tender?.label||'').toLowerCase();
      const tKey = (p.tender?.labelKey||'').toLowerCase();
      tax += Math.round(taxAmt*100); total += netAmt;
      if(tKey.includes('cash')||tender.includes('cash')) cash += netAmt;
      else if(tKey.includes('debit')||tender.includes('debit')) debit += netAmt;
      else if(tKey.includes('credit')||tender.includes('credit')) credit += netAmt;
      else if(tKey.includes('ebt')||tender.includes('ebt')) ebt += netAmt;
      if(p.device?.id === KITCHEN_ID) {
        kTax += Math.round(taxAmt*100); kTotal += netAmt;
        if(tKey.includes('cash')||tender.includes('cash')) kCash += netAmt;
        else if(tKey.includes('debit')||tender.includes('debit')) kDebit += netAmt;
        else if(tKey.includes('credit')||tender.includes('credit')) kCredit += netAmt;
        else if(tKey.includes('ebt')||tender.includes('ebt')) kEbt += netAmt;
      }
    });
    const taxAmt = +(tax/100).toFixed(2);
    const kTaxAmt = +(kTax/100).toFixed(2);
    // Step 2: fetch category map
    fetchCategoryMap((mapErr, catMap) => {
      const cMap = mapErr ? {} : (catMap||{});
      // Step 3: fetch orders for category breakdown
      fetchOrderCategories(startMs, endMs, (catErr, orders) => {
        const categories = catErr ? [] : aggregateCategories(orders||[], cMap);
        done(null, {
          date, count: pmnts.length,
          cash:+cash.toFixed(2), credit:+credit.toFixed(2),
          debit:+debit.toFixed(2), ebt:+ebt.toFixed(2),
          tax: taxAmt, netSales: +(total - taxAmt).toFixed(2), grossSales: +total.toFixed(2),
          kitchen:{
            cash:+kCash.toFixed(2), credit:+kCredit.toFixed(2),
            debit:+kDebit.toFixed(2), ebt:+kEbt.toFixed(2),
            tax: kTaxAmt, total:+kTotal.toFixed(2), netSales:+(kTotal-kTaxAmt).toFixed(2)
          },
          categories: categories
        });
      });
    });
  });
}

function fetchAllPayments(startMs, endMs, callback) {
  let allPayments = [];
  let offset = 0;
  const limit = 1000;
  const MAX_PAGES = 20;
  let page = 0;
  function fetchPage() {
    if (page >= MAX_PAGES) { callback(null, allPayments); return; }
    page++;
    const apiPath = `/v3/merchants/${MERCHANT_ID}/payments?filter=createdTime>=${startMs}&filter=createdTime<=${endMs}&expand=tender,device,refunds&limit=${limit}&offset=${offset}`;
    cloverGet(apiPath, (err, data, status) => {
      if (err) { callback(err, null); return; }
      const elements = data.elements || [];
      allPayments = allPayments.concat(elements);
      if (elements.length === limit) { offset += limit; fetchPage(); }
      else { callback(null, allPayments); }
    });
  }
  fetchPage();
}

function getBody(req, callback) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try { callback(null, JSON.parse(body || '{}')); }
    catch(e) { callback(e, null); }
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // Serve main app
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const filePath = path.join(__dirname, 'public', 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('App not found'); return; }
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.end(data);
    });
    return;
  }

  setCORS(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const json = (data, status) => {
    res.writeHead(status || 200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(data));
  };

  if (req.method === 'GET' && pathname === '/api/debug-devices') {
    fetchDevices((err, devices) => {
      if(err) { json({error: err.message}, 500); return; }
      json({devices: devices.map(d => ({id:d.id, name:d.name, model:d.model}))});
    });
    return;
  }

  // ---- HEALTH ----
  if (pathname === '/health') {
    json({status: 'ok', store: "Bailey's Market", time: new Date().toISOString()});
    return;
  }

  // ---- CLOVER SUMMARY ----
  if (req.method === 'GET' && pathname === '/api/summary') {
    const date = parsed.query.date || new Date().toISOString().split('T')[0];
    const [yyyy, mm, dd] = date.split('-').map(Number);
    const startMs = Date.UTC(yyyy, mm-1, dd, 4, 0, 0);
    const endMs   = Date.UTC(yyyy, mm-1, dd+1, 3, 59, 59);
    buildSummaryResponse(date, startMs, endMs, (err, result) => {
      if (err) { json({error: err.message}, 500); return; }
      json(result);
    });
    return;
  }

  // ---- CLOVER ITEMS ----
  if (req.method === 'GET' && pathname === '/api/items') {
    const q = parsed.query.q || '';
    cloverGet(`/v3/merchants/${MERCHANT_ID}/items?filter=name%20like%20%22%25${encodeURIComponent(q)}%25%22&limit=20`, (err, data, status) => {
      if (err) { json({error: err.message}, 500); return; }
      json(data, status);
    });
    return;
  }

  // ---- UPDATE PRICE ----
  if (req.method === 'POST' && pathname.match(/^\/api\/items\/[^/]+\/price$/)) {
    const itemId = pathname.split('/')[3];
    getBody(req, (err, body) => {
      if (err) { json({error: 'Invalid body'}, 400); return; }
      cloverPost(`/items/${itemId}`, {price: Math.round(body.price * 100)}, (err, data, status) => {
        if (err) { json({error: err.message}, 500); return; }
        json(data, status);
      });
    });
    return;
  }

  // ---- DAILY REPORTS ----
  // GET /api/daily?month=2026-04  or  GET /api/daily/:date
  if (req.method === 'GET' && pathname === '/api/daily') {
    const month = parsed.query.month;
    const date = parsed.query.date;
    let query = '?store=eq.baileys&order=report_date.desc';
    if (date) query = `?store=eq.baileys&report_date=eq.${date}`;
    else if (month) query = `?store=eq.baileys&report_date=gte.${month}-01&report_date=lte.${month}-31&order=report_date.desc`;
    supabase('GET', 'daily_reports', query, null, (err, data, status) => {
      if (err) { json({error: err.message}, 500); return; }
      json(data, status);
    });
    return;
  }

  // POST /api/daily — save or update daily report
  if (req.method === 'POST' && pathname === '/api/daily') {
    getBody(req, (err, body) => {
      if (err) { json({error: 'Invalid body'}, 400); return; }
      // Upsert by report_date
      supabase('POST', 'daily_reports', '?on_conflict=report_date', body, (err, data, status) => {
        if (err) { json({error: err.message}, 500); return; }
        json(data, status);
      });
    });
    return;
  }

  // ---- MACHINE REPORTS ----
  if (req.method === 'GET' && pathname === '/api/machines') {
    const month = parsed.query.month;
    let query = '?store=eq.baileys&order=report_date.desc';
    if (month) query = `?store=eq.baileys&report_date=gte.${month}-01&report_date=lte.${month}-31&order=report_date.desc`;
    supabase('GET', 'machine_reports', query, null, (err, data, status) => {
      if (err) { json({error: err.message}, 500); return; }
      json(data, status);
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/machines') {
    getBody(req, (err, body) => {
      if (err) { json({error: 'Invalid body'}, 400); return; }
      supabase('POST', 'machine_reports', '?on_conflict=report_date', body, (err, data, status) => {
        if (err) { json({error: err.message}, 500); return; }
        json(data, status);
      });
    });
    return;
  }

  // ---- INVOICES ----
  if (req.method === 'GET' && pathname === '/api/invoices') {
    const vendor = parsed.query.vendor;
    const status = parsed.query.status;
    let query = '?store=eq.baileys&order=created_at.desc';
    if (vendor) query += `&vendor=ilike.*${vendor}*`;
    if (status && status !== 'all') query += `&status=eq.${status}`;
    supabase('GET', 'invoices', query, null, (err, data, status2) => {
      if (err) { json({error: err.message}, 500); return; }
      json(data, status2);
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/invoices') {
    getBody(req, (err, body) => {
      if (err) { json({error: 'Invalid body'}, 400); return; }
      supabase('POST', 'invoices', '', body, (err, data, status) => {
        if (err) { json({error: err.message}, 500); return; }
        json(data, status);
      });
    });
    return;
  }

  if (req.method === 'PUT' && pathname.match(/^\/api\/invoices\/[^/]+$/)) {
    const invId = pathname.split('/')[3];
    getBody(req, (err, body) => {
      if (err) { json({error: 'Invalid body'}, 400); return; }
      supabase('PATCH', 'invoices', `?id=eq.${invId}`, body, (err, data, status) => {
        if (err) { json({error: err.message}, 500); return; }
        json(data, status);
      });
    });
    return;
  }

  // ---- SPECIALTY CATEGORIES ----
  if (req.method === 'GET' && pathname === '/api/categories') {
    supabase('GET', 'specialty_categories', '?store=eq.baileys&active=eq.true&order=id', null, (err, data, status) => {
      if (err) { json({error: err.message}, 500); return; }
      json(data, status);
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/categories') {
    getBody(req, (err, body) => {
      if (err) { json({error: 'Invalid body'}, 400); return; }
      supabase('POST', 'specialty_categories', '', {store: 'baileys', name: body.name}, (err, data, status) => {
        if (err) { json({error: err.message}, 500); return; }
        json(data, status);
      });
    });
    return;
  }

  if (req.method === 'DELETE' && pathname.match(/^\/api\/categories\/[^/]+$/)) {
    const catId = pathname.split('/')[3];
    supabase('PATCH', 'specialty_categories', `?id=eq.${catId}`, {active: false}, (err, data, status) => {
      if (err) { json({error: err.message}, 500); return; }
      json(data, status);
    });
    return;
  }

  // 404
  json({error: 'Not found'}, 404);
});

server.listen(PORT, () => {
  console.log(`Bailey's Market server running on port ${PORT}`);
});
