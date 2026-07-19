import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import cron from 'node-cron';
import { openDb, makeD1 } from './d1-shim.mjs';
import Worker from './index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'isp-monitor.sqlite');
const SCHEMA = path.join(__dirname, 'schema.sql');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

// Init DB
fs.mkdirSync(DATA_DIR, { recursive: true });
const sqlite = openDb(DB_PATH);
const schema = fs.readFileSync(SCHEMA, 'utf8');
sqlite.exec(schema);
const d1 = makeD1(sqlite);

// Env proxy — ngambil dari process.env, DB dari D1 shim
function buildEnv() {
  return new Proxy({}, {
    get(_, key) {
      if (key === 'DB') return d1;
      return process.env[key] ?? undefined;
    },
  });
}

// Worker's scheduled (cron + seed)
async function runCron() {
  const env = buildEnv();
  globalThis.__ENV = env;
  try {
    await Worker.scheduled({}, env, {});
  } catch (e) {
    console.error('[cron] error:', e.message);
  }
}

// Scheduler
const SCHEDULE = process.env.CRON_SCHEDULE || '*/10 * * * *';
cron.schedule(SCHEDULE, runCron);

// Seed on first start
runCron();

// HTTP server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // API routes — forward ke Worker
  if (url.pathname.startsWith('/api/') || url.pathname === '/api') {
    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = await new Promise((resolve) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
      });
    }
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k === 'host') continue;
      headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
    }
    const fullUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const request = new Request(fullUrl.href, {
      method: req.method,
      headers,
      body: body || undefined,
    });

    const env = buildEnv();
    globalThis.__ENV = env;
    let response;
    try {
      response = await Worker.fetch(request, env, {});
    } catch (e) {
      console.error('[api] error:', req.url, e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }

    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      for await (const chunk of response.body) res.write(chunk);
    }
    res.end();
    return;
  }

  // Static files
  let filePath = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback + clean URL: /admin → /admin.html
    const htmlPath = filePath + '.html';
    if (fs.existsSync(htmlPath)) {
      filePath = htmlPath;
    } else {
      filePath = path.join(PUBLIC, 'index.html');
    }
  }
  try {
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    const ct = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

const PORT = parseInt(process.env.PORT || '3000', 10);
server.listen(PORT, () => {
  console.log(`ISP Monitor running on http://localhost:${PORT}`);
  console.log(`DB: ${DB_PATH}`);
  console.log(`Cron schedule: ${SCHEDULE}`);
});
