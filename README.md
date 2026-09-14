# cloudfact

Publique uma pasta ou um `.html` da sua máquina/VM em uma URL pública na Cloudflare com um comando. Funciona como **CLI**, como **servidor MCP** (qualquer cliente: Claude Code, Codex, Cursor, Claude Desktop, Windsurf…) e como skill `/cloudfact`.

```
cloudfact deploy ./relatorio.html          # → https://xxxx.trycloudflare.com  (sem conta)
cloudfact login && cloudfact deploy ./site  # → https://site.pages.dev          (URL fixa, sua conta)
```

## Instalação (3 passos)

Requisito: Node 20+.

```bash
git clone https://github.com/gabrielchaves6/cloudfact ~/cloudfact
~/cloudfact/install.sh        # deps, `cloudfact` no PATH, skill e MCP (Claude Code / Codex, se existirem)
cloudfact doctor              # confere tudo
```

O `cloudflared` é baixado sozinho no primeiro deploy (Linux/macOS, x64/arm64) para `~/.cloudfact/bin`. Se já tiver no PATH, usa o seu.

## Autenticar na sua conta (opcional, para URL fixa)

```bash
cloudfact login
```

Ele mostra o link para criar um token (template **Edit Cloudflare Workers**, ou custom com `Account · Cloudflare Pages · Edit`), pede o token, valida na API, descobre sua conta e salva em `~/.cloudfact/config.json` (0600). Sem terminal interativo: `cloudfact login --token <token> [--account-id <id>]`. Variáveis `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` também funcionam. `cloudfact logout` apaga.

Depois do login o backend padrão vira `pages`; `--backend tunnel` continua disponível.

## Backends

| backend | conta? | URL | como |
|---|---|---|---|
| `tunnel` (padrão sem login) | não | `https://<aleatório>.trycloudflare.com` | servidor estático local + `cloudflared` quick tunnel, em processo destacado que sobrevive à sessão e religa se cair |
| `pages` (padrão após login) | sim | `https://<nome>.pages.dev` | `wrangler pages deploy` (baixado via `npx` na primeira vez); cria o projeto se não existir |

`--private` gera uma chave; a URL devolvida vem com `#key=…`. Sem o cookie, toda rota devolve só a página de gate, que troca o fragmento por um cookie HttpOnly em `POST /api/session`. Só no backend `tunnel`.

Segurança do servidor local: só serve o que está dentro da pasta publicada, nunca dotfiles, sem path traversal. Um `.html` isolado é servido sozinho (assets relativos não vão junto; publique a pasta nesse caso).

## Usar por MCP (qualquer cliente)

Servidor stdio. Configuração genérica:

```json
{
  "mcpServers": {
    "cloudfact": { "command": "node", "args": ["/caminho/para/cloudfact/src/server.js"] }
  }
}
```

- Claude Code: `claude mcp add -s user cloudfact -- node /caminho/para/cloudfact/src/server.js`
- Codex: `codex mcp add cloudfact -- node /caminho/para/cloudfact/src/server.js`
- Claude Desktop / Cursor / Windsurf: cole o JSON acima no arquivo de MCP do cliente.

Tools: `deploy`, `list`, `status`, `stop`, `remove`, `logs`, `doctor`. Prompt: `cloudfact`. O login fica fora do MCP de propósito: rode `cloudfact login` no terminal para o token nunca passar pelo contexto do agente.

Skill `/cloudfact <caminho> [--private] [--name x] [--pages]` em `skill/SKILL.md`; o `install.sh` a linka em `~/.claude/skills` e `~/.codex/skills`.

## CLI

```
cloudfact deploy [caminho] [--name n] [--private] [--backend auto|tunnel|pages] [--restart] [--json]
cloudfact list | status <nome> | stop <nome>|--all | rm <nome> | logs <nome> [-n 40]
cloudfact doctor | setup | login [--token T] [--account-id ID] | logout
cloudfact config get | set <chave> <valor>
cloudfact mcp                     # servidor MCP via stdio
```

Estado: `~/.cloudfact/deploys/<nome>/` (`state.json`, `host.log`, `tunnel.log`, `pages.log`). Outro diretório: `CLOUDFACT_HOME=/x`.

## Teste

`npm test` sobe o MCP, lista as tools e chama `doctor`/`list`.

## Roadmap

- [ ] Aplicações com servidor: `cloudfact expose <porta>` (mesmo host e gate de chave, apontando para a app).
- [ ] Validar o backend Pages com token real.
- [ ] Túnel nomeado (URL fixa sem Pages) quando houver conta.
- [ ] Publicar no npm (`npx cloudfact`).
