import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB cap per trace

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Trace payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

export function createDebugTraceMiddleware(projectRoot: string) {
  const tracesDir = path.join(projectRoot, 'debug-traces');

  return async function handleDebugTraceRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<boolean> {
    const urlPath = (req.url ?? '/').split('?')[0];
    if (urlPath !== '/api/debug/traces') return false;

    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'GET') {
      fs.mkdirSync(tracesDir, { recursive: true });
      const files = fs
        .readdirSync(tracesDir)
        .filter((f) => f.endsWith('.json') && f !== 'latest.json')
        .sort();
      res.statusCode = 200;
      res.end(JSON.stringify({ count: files.length, files }));
      return true;
    }

    if (req.method === 'POST') {
      try {
        const payload = await readJsonBody(req);
        fs.mkdirSync(tracesDir, { recursive: true });

        const existing = fs
          .readdirSync(tracesDir)
          .filter((f) => f.startsWith('trace-') && f.endsWith('.json'));
        const seq = String(existing.length + 1).padStart(3, '0');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `trace-${seq}-${stamp}.json`;
        const fullPath = path.join(tracesDir, filename);
        const latestPath = path.join(tracesDir, 'latest.json');

        const serialized = JSON.stringify(payload, null, 2);
        fs.writeFileSync(fullPath, serialized, 'utf8');
        fs.writeFileSync(latestPath, serialized, 'utf8');

        console.log(`📊 Saved IMU debug trace -> debug-traces/${filename}`);

        res.statusCode = 200;
        res.end(
          JSON.stringify({
            ok: true,
            seq: existing.length + 1,
            file: `debug-traces/${filename}`,
            latest: 'debug-traces/latest.json',
          })
        );
      } catch (err) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : 'Failed to save trace',
          })
        );
      }
      return true;
    }

    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return true;
  };
}
