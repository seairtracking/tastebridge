// Runs the Worker-style app on Node: `npm start` (reads .env) or `node local-server.mjs` under systemd.
import http from 'node:http';
import { Readable } from 'node:stream';
import worker from './worker/index.js';

const port = Number(process.env.PORT || 8787);
http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const host = /^[a-z0-9.-]+(:\d+)?$/i.test(req.headers.host || '') ? req.headers.host : '127.0.0.1:' + port;
    const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const request = new Request(proto + '://' + host + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const response = await worker.fetch(request, { QLOO_API_KEY: process.env.QLOO_API_KEY, QLOO_API_URL: process.env.QLOO_API_URL });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body || req.method === 'HEAD') return res.end();
    Readable.fromWeb(response.body).pipe(res); // streams NDJSON progress as it is produced
  } catch {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server error.' }));
  }
}).listen(port, '127.0.0.1', () => console.log('TasteBridge: http://127.0.0.1:' + port));
