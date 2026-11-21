import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import tailwindcss from '@tailwindcss/vite';
import os from 'node:os';
import { attachSignalingServer } from './server/signaling';
import { createDebugTraceMiddleware } from './server/debugTraces';

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

function spoccoSignalingPlugin(): Plugin {
  const handleDebugTraces = createDebugTraceMiddleware(process.cwd());

  return {
    name: 'spocco-signaling-plugin',
    configureServer(server) {
      const attached = server.httpServer
        ? attachSignalingServer(server.httpServer, '/ws')
        : null;

      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url ?? '/';
        const pathname = rawUrl.split('?')[0];
        if (pathname === '/api/debug/traces') {
          void handleDebugTraces(req, res);
          return;
        }
        if (pathname === '/api/room-info') {
          const parsed = new URL(rawUrl, 'https://localhost');
          const code = (parsed.searchParams.get('code') ?? '').trim().toUpperCase();
          const sport = code && attached ? attached.hub.getRoomSport(code) : null;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ found: Boolean(sport), sport: sport ?? 'bowling' }));
          return;
        }
        next();
      });

      server.middlewares.use('/api/network-info', (_req, res) => {
        const lanIps = getLanIps();
        const address = server.httpServer?.address();
        const port =
          typeof address === 'object' && address !== null ? address.port : 5173;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            lanIps,
            primaryIp: lanIps[0] ?? 'localhost',
            port,
            protocol: 'https',
          })
        );
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl(), spoccoSignalingPlugin()],
  server: {
    host: true,
    port: 5173,
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
