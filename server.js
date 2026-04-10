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

function fetchAllPayments(startMs, endMs, callback) {
  let allPayments = [];
  let offset = 0;
  const limit = 1000;
  const MAX_PAGES = 20;
  let page = 0;
  function fetchPage() {
    if (page >= MAX_PAGES) { callback(null, allPayments); return; }
    page++;
    const apiPath = `/v3/merchants/${MERCHANT_ID}/payments?filter=createdTime>=${startMs}&filter=createdTime<=${endMs}&expand=tender,device&limit=${limit}&offset=${offset}`;
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
    fetchDevices((devErr, devList) => {
      const kitchenDev = (devList||[]).find(d => (d.name||'').toLowerCase() === 'kitchen');
      const kitchenId = kitchenDev ? kitchenDev.id : null;
      console.log('Devices:', (devList||[]).map(d=>d.name+':'+d.id.slice(0,8)).join(', '));
      fetchAllPayments(startMs, endMs, (err, payments) => {
        if (err) { json({error: err.message}, 500); return; }
        const pmnts = payments.filter(p => p.result === 'SUCCESS' || p.result === 'REFUND');
        let cash=0, credit=0, debit=0, ebt=0, tax=0, total=0;
        let kCash=0, kCredit=0, kDebit=0, kEbt=0, kTax=0, kTotal=0;
        pmnts.forEach(p => {
          const amt = (p.amount||0)/100;
          const taxAmt = (p.taxAmount||0)/100;
          const tender = (p.tender?.label||'').toLowerCase();
          const tKey = (p.tender?.labelKey||'').toLowerCase();
          tax += taxAmt; total += amt;
          if(tKey.includes('cash')||tender.includes('cash')) cash += amt;
          else if(tKey.includes('debit')||tender.includes('debit')) debit += amt;
          else if(tKey.includes('credit')||tender.includes('credit')) credit += amt;
          else if(tKey.includes('ebt')||tender.includes('ebt')) ebt += amt;
          const dId = p.device?.id || '';
          if(kitchenId && dId === kitchenId) {
            kTax += taxAmt; kTotal += amt;
            if(tKey.includes('cash')||tender.includes('cash')) kCash += amt;
            else if(tKey.includes('debit')||tender.includes('debit')) kDebit += amt;
            else if(tKey.includes('credit')||tender.includes('credit')) kCredit += amt;
            else if(tKey.includes('ebt')||tender.includes('ebt')) kEbt += amt;
          }
        });
        json({
          date, count: pmnts.length, kitchenDeviceFound: !!kitchenId,
          cash:+cash.toFixed(2), credit:+credit.toFixed(2), debit:+debit.toFixed(2),
          ebt:+ebt.toFixed(2), tax:+tax.toFixed(2), netSales:+total.toFixed(2),
          kitchen:{cash:+kCash.toFixed(2), credit:+kCredit.toFixed(2), debit:+kDebit.toFixed(2),
            ebt:+kEbt.toFixed(2), tax:+kTax.toFixed(2), total:+kTotal.toFixed(2)}
        });
      });
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
