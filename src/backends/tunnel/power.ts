/**
 * The on/off switch of a tunnel deploy. While it is off, the local server answers every request with a
 * short "this page is off" page and refuses WebSocket upgrades, but cloudflared keeps its hostname, so
 * turning the deploy back on brings the very same link back, key and all.
 *
 * `/.cloudfact/power` flips it from outside (the catalog page does, through its Worker) with the deploy's
 * control key. That key is not the private key: whoever holds a shared link can open the page, not turn
 * it off.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { OFF_HTML, clientIp, timingEqual } from './gate.js';

export const POWER_PATH = '/.cloudfact/power';
const MAX_BODY = 1024;

export interface PowerOptions {
  /** Current switch position and control key (the host re-reads them from state.json). */
  get: () => { off: boolean; controlKey: string | null };
  /** Records a flip made through `/.cloudfact/power`. */
  set: (off: boolean) => void;
  log?: (message: string) => void;
}

export interface PowerSwitch {
  /** True when the request was answered here (the switch itself, or the off page); the caller must stop. */
  handle(req: IncomingMessage, res: ServerResponse): boolean;
  isOff(): boolean;
}

function send(res: ServerResponse, code: number, body: string, type: string): void {
  const buf = Buffer.from(body);
  res.writeHead(code, {
    'Content-Type': type,
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  res.end(buf);
}

const json = (res: ServerResponse, code: number, body: unknown): void => send(res, code, JSON.stringify(body), 'application/json');

export function createPowerSwitch(opts: PowerOptions): PowerSwitch {
  const log = opts.log ?? (() => {});

  const control = (req: IncomingMessage, res: ServerResponse, key: string): void => {
    const auth = req.headers.authorization ?? '';
    if (!timingEqual(auth.startsWith('Bearer ') ? auth.slice(7) : '', key)) {
      log(`power: refused a request without the control key from ${clientIp(req)}`);
      return json(res, 401, { error: 'unauthorized' });
    }
    if (req.method === 'GET') return json(res, 200, { on: !opts.get().off });
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on('end', () => {
      let on: unknown;
      try {
        on = (JSON.parse(body) as { on?: unknown }).on;
      } catch {
        on = undefined;
      }
      if (typeof on !== 'boolean') return json(res, 400, { error: 'bad_request' });
      opts.set(!on);
      log(`power: turned ${on ? 'on' : 'off'} from ${clientIp(req)}`);
      json(res, 200, { on });
    });
  };

  return {
    handle(req, res) {
      const { off, controlKey } = opts.get();
      // a deploy started before the switch existed has no control key: the path is the app's, as before
      if (controlKey && new URL(req.url ?? '/', 'http://localhost').pathname === POWER_PATH) {
        control(req, res, controlKey);
        return true;
      }
      if (!off) return false;
      send(res, 503, OFF_HTML, 'text/html; charset=utf-8');
      return true;
    },
    isOff: () => opts.get().off,
  };
}
