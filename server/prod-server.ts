import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import selfsigned from 'selfsigned';
import { attachSignalingServer } from './signaling';
import { createDebugTraceMiddleware } from './debugTraces';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(__dirname, '../dist');
const CERT_DIR = path.resolve(__dirname, '../.cert');
const PORT = Number(process.env.PORT ?? 8443);
const handleDebugTraces = createDebugTraceMiddleware(PROJECT_ROOT);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ico': 'image/x-icon',
};

function getLanIps(): string[] {
  const nets = os.networkInterfaces();
  const ips: string[] = [];
  for (const iface of Object.values(nets)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        ips.push(addr.address);
      }
    }
  }
  return ips;
}

function getOrCreateCert(): { key: string; cert: string } {
  const keyPath = path.join(CERT_DIR, 'key.pem');
  const certPath = path.join(CERT_DIR, 'cert.pem');
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return {
      key: fs.readFileSync(keyPath, 'utf8'),
      cert: fs.readFileSync(certPath, 'utf8'),
    };
  }

  fs.mkdirSync(CERT_DIR, { recursive: true });
  const lanIps = getLanIps();
  const altNames: Array<{ type: number; value?: string; ip?: string }> = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    ...lanIps.map((ip) => ({ type: 7, ip })),
  ];

  const pems = selfsigned.generate(
    [{ name: 'commonName', value: 'Spocco Bowling LAN' }],
    {
      days: 365,
      keySize: 2048,
      extensions: [{ name: 'subjectAltName', altNames }],
    }
  );

  fs.writeFileSync(keyPath, pems.private, 'utf8');
  fs.writeFileSync(certPath, pems.cert, 'utf8');
  return { key: pems.private, cert: pems.cert };
}

const creds = getOrCreateCert();

let signalingHub: ReturnType<typeof attachSignalingServer>['hub'] | null = null;

const server = https.createServer(creds, (req, res) => {
  const rawUrl = req.url ?? '/';
  const urlPath = rawUrl.split('?')[0];

  if (urlPath === '/api/debug/traces') {
    void handleDebugTraces(req, res);
    return;
  }

  if (urlPath === '/api/room-info') {
    const parsed = new URL(rawUrl, 'https://localhost');
    const code = (parsed.searchParams.get('code') ?? '').trim().toUpperCase();
    const sport = code && signalingHub ? signalingHub.getRoomSport(code) : null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ found: Boolean(sport), sport: sport ?? 'bowling' }));
    return;
  }

  if (urlPath === '/api/network-info') {
    const lanIps = getLanIps();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        lanIps,
        primaryIp: lanIps[0] ?? 'localhost',
        port: PORT,
        protocol: 'https',
      })
    );
    return;
  }

  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(DIST_DIR, safePath === '/' ? 'index.html' : safePath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Build not found. Run `npm run build` first.');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

signalingHub = attachSignalingServer(server, '/ws').hub;

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLanIps();
  console.log(`\n🎳 Spocco Square Bowling HTTPS + WSS Server running:`);
  console.log(`   Local:   https://localhost:${PORT}`);
  for (const ip of ips) {
    console.log(`   Network: https://${ip}:${PORT}`);
  }
  console.log('');
});
