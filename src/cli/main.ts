import { parseArgs } from 'node:util';
import * as cf from '../cloudfact.js';

const HELP = `cloudfact ${cf.VERSION} — publica páginas estáticas da máquina na Cloudflare

uso:
  cloudfact deploy [caminho] [--name n] [--private] [--backend auto|tunnel|workers] [--restart] [--json]
  cloudfact list [--json]
  cloudfact status <nome> [--json]
  cloudfact stop <nome> | --all
  cloudfact rm <nome>
  cloudfact logs <nome> [-n 40]
  cloudfact doctor
  cloudfact setup                                (baixa o cloudflared para ~/.cloudfact/bin se faltar)
  cloudfact login --device                       (autoriza no navegador de qualquer dispositivo; sem colar token)
  cloudfact login [--token T] [--account-id ID]  (token de API da Cloudflare)
  cloudfact logout
  cloudfact mcp                                  (servidor MCP via stdio)

caminho = pasta (serve tudo, index.html na raiz) ou um único .html.
backend auto = workers (URL fixa *.workers.dev) se logado na Cloudflare, senão túnel rápido (trycloudflare.com, sem conta).`;

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
    },
  });
  const [cmd, ...rest] = positionals;
  const print = (value: unknown) => console.log(typeof value === 'string' && !values.json ? value : JSON.stringify(value, null, 2));
  const need = (v: string | undefined, what: string): string => {
    if (!v) throw new Error(`faltou ${what}\n\n${HELP}`);
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
        console.log(`${r.reused ? 'já no ar' : 'publicado'}: ${r.name} (${r.backend})`);
        console.log(`URL: ${r.privateUrl ?? r.url}`);
        if (r.local) console.log(`local: ${r.local}`);
      }
      return 0;
    }
    case 'list':
    case 'ls': {
      const all = cf.listDeploys().map(cf.summarize);
      if (values.json) print(all);
      else if (!all.length) console.log('nenhum deploy');
      else
        for (const s of all)
          console.log(`${s.name.padEnd(24)} ${s.backend.padEnd(8)} ${s.status.padEnd(12)} ${s.privateUrl ?? s.url ?? '-'}`);
      return 0;
    }
    case 'status':
      print(await cf.status(need(rest[0], 'o nome')));
      return 0;
    case 'stop':
      print(values.all ? await cf.stopAll() : await cf.stop(need(rest[0], 'o nome (ou --all)')));
      return 0;
    case 'rm':
    case 'remove':
      print(await cf.remove(need(rest[0], 'o nome')));
      return 0;
    case 'logs':
      for (const [file, text] of Object.entries(cf.readLogs(need(rest[0], 'o nome'), Number(values.n))))
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
            : 'autenticado via wrangler (OAuth). backend padrão agora é "workers" (URL fixa); --backend tunnel continua disponível.',
        );
        return 0;
      }
      const r = await cf.loginWithToken({ token: values.token ?? process.env.CLOUDFLARE_API_TOKEN, accountId: values['account-id'] });
      print(
        values.json ? r : `autenticado. conta: ${r.accountName ?? '?'} (${r.accountId ?? 'sem id'}). backend padrão agora é "workers".`,
      );
      return 0;
    }
    case 'logout':
      print(cf.logout());
      return 0;
    case 'mcp':
      await import('../server.js');
      return 0;
    default:
      console.error(`comando desconhecido: ${cmd}\n\n${HELP}`);
      return 2;
  }
}
