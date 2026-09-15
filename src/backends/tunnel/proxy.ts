/**
 * Reverse proxy for app deploys (`expose`): forwards HTTP and WebSocket traffic to a local port
 * (the app itself, or an SSH port-forward to another machine), behind the optional private-mode gate.
 */
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { gateRequest, hasAccessCookie } from './gate.js';

export interface ProxyOptions {
  targetPort: number;
  targetHost?: string;
  key?: string | null;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function createProxy(opts: ProxyOptions): {
  handler: (req: IncomingMessage, res: ServerResponse) => void;
  upgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
} {
  const host = opts.targetHost ?? '127.0.0.1';
  const port = opts.targetPort;

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    if (gateRequest(req, res, opts.key)) return;
    const headers: Record<string, string | string[] | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k)) headers[k] = v;
    headers['x-forwarded-proto'] = 'https';
    headers['x-forwarded-host'] = req.headers.host;
    headers['x-forwarded-for'] = req.socket.remoteAddress ?? '';
    const upstream = http.request({ host, port, method: req.method, path: req.url, headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(`cloudfact: upstream ${host}:${port} is not reachable`);
    });
    req.pipe(upstream);
  };

  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (opts.key && !hasAccessCookie(req, opts.key)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    const target = net.connect(port, host, () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      target.write(lines.join('\r\n') + '\r\n\r\n');
      if (head.length) target.write(head);
      socket.pipe(target).pipe(socket);
    });
    const drop = () => {
      socket.destroy();
      target.destroy();
    };
    target.on('error', drop);
    socket.on('error', drop);
  };

  return { handler, upgrade };
}
