import { parseArgs } from 'node:util';
import * as cf from '../cloudfact.js';

const HELP = `cloudfact ${cf.VERSION} — publish static pages from this machine to Cloudflare

usage:
  cloudfact deploy [path] [--name n] [--private] [--backend auto|tunnel|workers] [--restart] [--json]
  cloudfact expose <port> [--name n] [--private] [--ssh user@host] [--ssh-port 22] [--identity key] [--restart] [--json]
  cloudfact list [--json]
  cloudfact status <name> [--json]
  cloudfact stop <name> | --all
  cloudfact rm <name>
  cloudfact logs <name> [-n 40]
  cloudfact doctor
  cloudfact setup                                (download cloudflared into ~/.cloudfact/bin if missing)
  cloudfact login --device                       (approve in a browser on any device; no token pasting)
  cloudfact login [--token T] [--account-id ID]  (Cloudflare API token)
  cloudfact logout
  cloudfact mcp                                  (MCP server over stdio)

path = a folder (served whole, index.html at the root) or a single .html file.
expose = publish an app already listening on a port, here or on a machine reachable over SSH (HTTP + WebSocket).
backend auto = workers (fixed *.workers.dev URL) when signed in to Cloudflare, otherwise quick tunnel (trycloudflare.com, no account).`;

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      private: { type: 'boolean', default: false },
      backend: { type: 'string', default: 'auto' },
      restart: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      n: { type: 'string', default: '40' },
      help: { type: 'boolean', short: 'h', default: false },
      token: { type: 'string' },
      'account-id': { type: 'string' },
      device: { type: 'boolean', default: false },
      ssh: { type: 'string' },
      'ssh-port': { type: 'string' },
      identity: { type: 'string' },
    },
  });
  const [cmd, ...rest] = positionals;
  const print = (value: unknown) => console.log(typeof value === 'string' && !values.json ? value : JSON.stringify(value, null, 2));
  const need = (v: string | undefined, what: string): string => {
    if (!v) throw new Error(`missing ${what}\n\n${HELP}`);
    return v;
  };

  if (!cmd || values.help) {
    console.log(HELP);
    return 0;
  }
  switch (cmd) {
    case 'deploy': {
      const r = await cf.deploy({
        path: rest[0],
        name: values.name,
        private: values.private,
        backend: values.backend as cf.BackendChoice,
        restart: values.restart,
      });
      if (values.json) print(r);
      else {
        console.log(`${r.reused ? 'already live' : 'published'}: ${r.name} (${r.backend})`);
        console.log(`URL: ${r.privateUrl ?? r.url}`);
        if (r.local) console.log(`local: ${r.local}`);
      }
      return 0;
    }
    case 'expose': {
      const port = Number(need(rest[0], 'the port'));
      const r = await cf.expose({
        port,
        name: values.name,
        private: values.private,
        restart: values.restart,
        ssh: values.ssh
          ? { destination: values.ssh, port: values['ssh-port'] ? Number(values['ssh-port']) : undefined, identity: values.identity }
          : null,
      });
      if (values.json) print(r);
      else {
        console.log(
          `${r.reused ? 'already live' : 'published'}: ${r.name} → ${r.ssh ? `${r.ssh.destination}:` : 'localhost:'}${r.targetPort}`,
        );
        console.log(`URL: ${r.privateUrl ?? r.url}`);
      }
      return 0;
    }
    case 'list':
    case 'ls': {
      const all = cf.listDeploys().map(cf.summarize);
      if (values.json) print(all);
      else if (!all.length) console.log('no deploys');
      else
        for (const s of all)
          console.log(`${s.name.padEnd(24)} ${s.backend.padEnd(8)} ${s.status.padEnd(12)} ${s.privateUrl ?? s.url ?? '-'}`);
      return 0;
    }
    case 'status':
      print(await cf.status(need(rest[0], 'the deploy name')));
      return 0;
    case 'stop':
      print(values.all ? await cf.stopAll() : await cf.stop(need(rest[0], 'the deploy name (or --all)')));
      return 0;
    case 'rm':
    case 'remove':
      print(await cf.remove(need(rest[0], 'the deploy name')));
      return 0;
    case 'logs':
      for (const [file, text] of Object.entries(cf.readLogs(need(rest[0], 'the deploy name'), Number(values.n))))
        console.log(`== ${file}\n${text}\n`);
      return 0;
    case 'doctor':
      print(await cf.doctor());
      return 0;
    case 'setup':
      print({ cloudflared: await cf.installCloudflared(console.error) });
      return 0;
    case 'login': {
      if (values.device) {
        const r = await cf.loginWithDevice();
        print(
          values.json
            ? r
            : 'signed in via wrangler (OAuth). Default backend is now "workers" (fixed URL); --backend tunnel is still available.',
        );
        return 0;
      }
      const r = await cf.loginWithToken({ token: values.token ?? process.env.CLOUDFLARE_API_TOKEN, accountId: values['account-id'] });
      print(values.json ? r : `signed in. account: ${r.accountName ?? '?'} (${r.accountId ?? 'no id'}). Default backend is now "workers".`);
      return 0;
    }
    case 'logout':
      print(cf.logout());
      return 0;
    case 'mcp':
      await import('../server.js');
      return 0;
    default:
      console.error(`unknown command: ${cmd}\n\n${HELP}`);
      return 2;
  }
}
