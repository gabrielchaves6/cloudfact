#!/usr/bin/env node
import { parseArgs } from 'node:util';
import * as cf from '../src/lib.js';

const HELP = `cloudfact ${cf.VERSION} — publica páginas estáticas da VM na Cloudflare

uso:
  cloudfact deploy [caminho] [--name n] [--private] [--backend auto|tunnel|pages] [--restart] [--json]
  cloudfact list [--json]
  cloudfact status <nome> [--json]
  cloudfact stop <nome> | --all
  cloudfact rm <nome>
  cloudfact logs <nome> [-n 40]
  cloudfact doctor
  cloudfact config get | set <chave> <valor>
  cloudfact mcp            (inicia o servidor MCP via stdio)

caminho = pasta (serve tudo, index.html na raiz) ou um único .html.
backend auto = pages se houver CLOUDFLARE_API_TOKEN, senão túnel rápido (trycloudflare.com, sem conta).`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' }, private: { type: 'boolean', default: false },
    backend: { type: 'string', default: 'auto' }, restart: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false }, all: { type: 'boolean', default: false },
    n: { type: 'string', default: '40' }, help: { type: 'boolean', short: 'h', default: false },
  },
});
const [cmd, ...rest] = positionals;
const print = (o) => console.log(values.json ? JSON.stringify(o, null, 2) : typeof o === 'string' ? o : JSON.stringify(o, null, 2));

try {
  if (!cmd || values.help) { console.log(HELP); process.exit(0); }
  switch (cmd) {
    case 'deploy': {
      const r = await cf.deploy({ path: rest[0], name: values.name, private: values.private, backend: values.backend, restart: values.restart });
      if (values.json) print(r);
      else {
        console.log(`${r.reused ? 'já no ar' : 'publicado'}: ${r.name} (${r.backend})`);
        console.log(`URL: ${r.privateUrl || r.url}`);
        if (r.local) console.log(`local: ${r.local}`);
      }
      break;
    }
    case 'list': case 'ls': {
      const l = cf.listDeploys().map(({ key, ...s }) => s);
      if (values.json) print(l);
      else if (!l.length) console.log('nenhum deploy');
      else for (const s of l) console.log(`${s.name.padEnd(24)} ${s.backend.padEnd(7)} ${s.status.padEnd(12)} ${s.privateUrl || s.url || '-'}`);
      break;
    }
    case 'status': print(await cf.status(need(rest[0]))); break;
    case 'stop': print(values.all ? await cf.stopAll() : await cf.stop(need(rest[0]))); break;
    case 'rm': case 'remove': print(await cf.remove(need(rest[0]))); break;
    case 'logs': { const l = cf.logs(need(rest[0]), Number(values.n)); for (const [f, t] of Object.entries(l)) console.log(`== ${f}\n${t}\n`); break; }
    case 'doctor': print(await cf.doctor()); break;
    case 'config': {
      const c = cf.readConfig();
      if (rest[0] === 'set') { c[need(rest[1])] = need(rest[2]); cf.writeConfig(c); print({ saved: rest[1] }); }
      else print(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, /token|secret/i.test(k) ? '***' : v])));
      break;
    }
    case 'mcp': await import('../src/server.js'); break;
    default: console.error(`comando desconhecido: ${cmd}\n\n${HELP}`); process.exit(2);
  }
} catch (e) {
  console.error(`erro: ${e.message}`);
  process.exit(1);
}

function need(v) { if (!v) { console.error(HELP); process.exit(2); } return v; }
