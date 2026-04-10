const https = require('https');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const CLOVER_TOKEN = 'cea0b142-7593-6c1e-5e79-f1ae5ddbd603';
const MERCHANT_ID = '536927510109317';
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

function cloverRequest(method, cloverPath, body, callback) {
  const options = {
    hostname: 'api.clover.com',
    path: `/v3/merchants/${MERCHANT_ID}${cloverPath}`,
    method: method,
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
      catch(e) { callback(null, {raw: data}, res.statusCode); }
    });
  });
  req.on('error', callback);
  if (body) req.write(JSON.stringify(body));
  req.end();
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // Serve the main app HTML
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const filePath = path.join(__dirname, 'public', 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('App not found');
        return;
      }
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.end(data);
    });
    return;
  }

  setCORS(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({status: 'ok', store: "Bailey's Market"}));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/summary') {
    const date = parsed.query.date || new Date().toISOString().split('T')[0];
    const start = new Date(date + 'T00:00:00-05:00').getTime();
    const end   = new Date(date + 'T23:59:59-05:00').getTime();
    cloverRequest('GET',
      `/payments?filter=createdTime>=${start}&filter=createdTime<=${end}&expand=tender&limit=1000`,
      null,
      (err, data, status) => {
        if (err) { res.writeHead(500); res.end(JSON.stringify({error: err.message})); return; }
        const payments = (data.elements || []).filter(p => p.result === 'SUCCESS');
        let cash=0, credit=0, debit=0, ebt=0, tax=0, kitchen=0, total=0;
        payments.forEach(p => {
          const amt = (p.amount || 0) / 100;
          const taxAmt = (p.taxAmount || 0) / 100;
          const tender = (p.tender?.label || '').toLowerCase();
          tax += taxAmt;
          total += amt;
          if (tender.includes('cash')) cash += amt;
          else if (tender.includes('debit')) debit += amt;
          else if (tender.includes('credit')) credit += amt;
          else if (tender.includes('ebt') || tender.includes('food')) ebt += amt;
        });
        const summary = {
          date,
          cash: +cash.toFixed(2),
          credit: +credit.toFixed(2),
          debit: +debit.toFixed(2),
          ebt: +ebt.toFixed(2),
          tax: +tax.toFixed(2),
          kitchen: +kitchen.toFixed(2),
          netSales: +total.toFixed(2),
          count: payments.length
        };
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify(summary));
      }
    );
    return;
  }

  if (req.method === 'GET' && pathname === '/api/items') {
    const q = parsed.query.q || '';
    cloverRequest('GET',
      `/items?filter=name%20like%20%22%25${encodeURIComponent(q)}%25%22&limit=20`,
      null,
      (err, data, status) => {
        if (err) { res.writeHead(500); res.end(JSON.stringify({error: err.message})); return; }
        res.writeHead(status || 200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify(data));
      }
    );
    return;
  }

  if (req.method === 'POST' && pathname.match(/^\/api\/items\/[^/]+\/price$/)) {
    const itemId = pathname.split('/')[3];
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { price } = JSON.parse(body);
        cloverRequest('POST', `/items/${itemId}`, { price: Math.round(price * 100) },
          (err, data, status) => {
            if (err) { res.writeHead(500); res.end(JSON.stringify({error: err.message})); return; }
            res.writeHead(status || 200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify(data));
          }
        );
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
