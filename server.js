const https = require('https');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const CLOVER_TOKEN = 'cea0b142-7593-6c1e-5e79-f1ae5ddbd603';
const MERCHANT_ID = 'J5D10DJ83FVD1';
const PORT = process.env.PORT || 3000;

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function cloverGet(path, callback) {
  const options = {
    hostname: 'api.clover.com',
    path: path,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${CLOVER_TOKEN}`,
      'Content-Type': 'application/json'
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

// Fetch ALL payments for a date using pagination
function fetchAllPayments(startMs, endMs, callback) {
  let allPayments = [];
  let offset = 0;
  const limit = 100;

  function fetchPage() {
    // Use createdTime range - Clover uses milliseconds
    const apiPath = `/v3/merchants/${MERCHANT_ID}/payments?` +
      `filter=createdTime>=${startMs}&filter=createdTime<=${endMs}` +
      `&expand=tender&limit=${limit}&offset=${offset}`;

    cloverGet(apiPath, (err, data, status) => {
      if (err) { callback(err, null); return; }
      const elements = data.elements || [];
      allPayments = allPayments.concat(elements);

      // If we got a full page, there might be more
      if (elements.length === limit) {
        offset += limit;
        fetchPage();
      } else {
        callback(null, allPayments);
      }
    });
  }
  fetchPage();
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // Serve the main app HTML
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

  // Health check
  if (pathname === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'ok', store: "Bailey's Market", time: new Date().toISOString()}));
    return;
  }

  // GET /api/summary?date=2026-04-09
  if (req.method === 'GET' && pathname === '/api/summary') {
    const date = parsed.query.date || new Date().toISOString().split('T')[0];

    // Use EDT (UTC-4) for Maryland - covers full business day
    // Go slightly wider: 3am UTC day before to 3am UTC next day (covers midnight-midnight ET)
    const [yyyy, mm, dd] = date.split('-').map(Number);
    // Start: midnight Eastern = 04:00 UTC (EDT) or 05:00 UTC (EST)
    // Use 04:00 UTC to cover EDT (April-November), which is what April uses
    const startMs = Date.UTC(yyyy, mm-1, dd, 4, 0, 0);  // midnight EDT
    const endMs   = Date.UTC(yyyy, mm-1, dd+1, 3, 59, 59); // 11:59pm EDT

    fetchAllPayments(startMs, endMs, (err, payments) => {
      if (err) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: err.message}));
        return;
      }

      const successful = payments.filter(p => p.result === 'SUCCESS');
      let cash=0, credit=0, debit=0, ebt=0, tax=0, kitchen=0, total=0;

      successful.forEach(p => {
        const amt = (p.amount || 0) / 100;
        const taxAmt = (p.taxAmount || 0) / 100;
        const tender = (p.tender?.label || '').toLowerCase();
        const tenderKey = (p.tender?.labelKey || '').toLowerCase();

        tax += taxAmt;
        total += amt;

        if (tenderKey.includes('cash') || tender.includes('cash')) cash += amt;
        else if (tenderKey.includes('debit') || tender.includes('debit')) debit += amt;
        else if (tenderKey.includes('credit') || tender.includes('credit')) credit += amt;
        else if (tenderKey.includes('ebt') || tender.includes('ebt') || tender.includes('food')) ebt += amt;
      });

      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({
        date,
        startMs, endMs,
        cash: +cash.toFixed(2),
        credit: +credit.toFixed(2),
        debit: +debit.toFixed(2),
        ebt: +ebt.toFixed(2),
        tax: +tax.toFixed(2),
        kitchen: +kitchen.toFixed(2),
        netSales: +total.toFixed(2),
        count: successful.length,
        totalFetched: payments.length
      }));
    });
    return;
  }


  // DEBUG - returns raw Clover data for troubleshooting
  if (req.method === 'GET' && pathname === '/api/debug') {
    const date = parsed.query.date || '2026-04-09';
    const [yyyy, mm, dd] = date.split('-').map(Number);
    const startMs = Date.UTC(yyyy, mm-1, dd, 4, 0, 0);
    const endMs   = Date.UTC(yyyy, mm-1, dd+1, 3, 59, 59);
    const apiPath = `/v3/merchants/${MERCHANT_ID}/payments?filter=createdTime>=${startMs}&filter=createdTime<=${endMs}&expand=tender&limit=5`;
    cloverGet(apiPath, (err, data, status) => {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({startMs, endMs, startDate: new Date(startMs).toISOString(), endDate: new Date(endMs).toISOString(), httpStatus: status, error: err?.message, data}, null, 2));
    });
    return;
  }

  // DEBUG - get most recent 5 payments regardless of date
  if (req.method === 'GET' && pathname === '/api/debug-recent') {
    const apiPath = `/v3/merchants/${MERCHANT_ID}/payments?expand=tender&limit=5&orderBy=createdTime&order=DESC`;
    cloverGet(apiPath, (err, data, status) => {
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({httpStatus: status, error: err?.message, data}, null, 2));
    });
    return;
  }

  // GET /api/items?q=milk
  if (req.method === 'GET' && pathname === '/api/items') {
    const q = parsed.query.q || '';
    const apiPath = `/v3/merchants/${MERCHANT_ID}/items?` +
      `filter=name%20like%20%22%25${encodeURIComponent(q)}%25%22&limit=20`;
    cloverGet(apiPath, (err, data, status) => {
      if (err) { res.writeHead(500); res.end(JSON.stringify({error: err.message})); return; }
      res.writeHead(status || 200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(data));
    });
    return;
  }

  // POST /api/items/:id/price
  if (req.method === 'POST' && pathname.match(/^\/api\/items\/[^/]+\/price$/)) {
    const itemId = pathname.split('/')[3];
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { price } = JSON.parse(body);
        cloverPost(`/items/${itemId}`, { price: Math.round(price * 100) }, (err, data, status) => {
          if (err) { res.writeHead(500); res.end(JSON.stringify({error: err.message})); return; }
          res.writeHead(status || 200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify(data));
        });
      } catch(e) {
        res.writeHead(400); res.end(JSON.stringify({error: 'Invalid body'}));
      }
    });
    return;
  }

  res.writeHead(404, {'Content-Type': 'application/json'});
  res.end(JSON.stringify({error: 'Not found'}));
});

server.listen(PORT, () => {
  console.log(`Bailey's Market API server running on port ${PORT}`);
});
