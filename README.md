# cloudfact

Publique uma pasta ou um `.html` da sua máquina/VM em uma URL pública na Cloudflare com um comando. Funciona como **CLI**, como **servidor MCP** (qualquer cliente: Claude Code, Codex, Cursor, Claude Desktop, Windsurf…) e como skill `/cloudfact`.

```
cloudfact deploy ./relatorio.html                    # → https://xxxx.trycloudflare.com          (sem conta)
cloudfact login --device && cloudfact deploy ./site  # → https://site.<sua-sub>.workers.dev      (URL fixa, sua conta)
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

Duas formas. A primeira funciona mesmo quando você só tem acesso à máquina por um agente (Claude Code, Codex…): o agente roda o comando, te manda o link e o código, você aprova no navegador de qualquer dispositivo.

```bash
cloudfact login --device        # OAuth pelo navegador (wrangler login --device); nada de token no chat
cloudfact login --token <tok>   # ou token de API: https://dash.cloudflare.com/profile/api-tokens (template "Edit Cloudflare Workers")
```

O token, se usado, fica em `~/.cloudfact/config.json` (0600); o OAuth fica onde o wrangler guarda (`~/.config/.wrangler`). `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` também funcionam. `cloudfact logout` esquece.

Depois do login o backend padrão vira `workers`; `--backend tunnel` continua disponível.

## Backends

| backend | conta? | URL | como |
|---|---|---|---|
| `tunnel` (padrão sem login) | não | `https://<aleatório>.trycloudflare.com` | servidor estático local + `cloudflared` quick tunnel, em processo destacado que sobrevive à sessão e religa se cair |
| `workers` (padrão após login) | sim | `https://<nome>.<sub>.workers.dev` | Cloudflare Workers com assets estáticos, o sucessor do Pages (a Cloudflare não cria mais projetos Pages novos). `wrangler deploy --assets`, baixado via `npx` na primeira vez. Envia uma cópia sem dotfiles/symlinks/node_modules. `remove` apaga o worker |

`--private` gera uma chave; a URL devolvida vem com `#key=…`. Sem o cookie, toda rota devolve só a página de gate, que troca o fragmento por um cookie HttpOnly em `POST /api/session`. Só no backend `tunnel` por enquanto.

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

Skill `/cloudfact <caminho> [--private] [--name x] [--tunnel|--workers]` em `skill/SKILL.md`; o `install.sh` a linka em `~/.claude/skills` e `~/.codex/skills`.

## CLI

```
cloudfact deploy [caminho] [--name n] [--private] [--backend auto|tunnel|workers] [--restart] [--json]
cloudfact list | status <nome> | stop <nome>|--all | rm <nome> | logs <nome> [-n 40]
cloudfact doctor | setup | login --device | login --token T [--account-id ID] | logout
cloudfact config get | set <chave> <valor>
cloudfact mcp                     # servidor MCP via stdio
```

Estado: `~/.cloudfact/deploys/<nome>/` (`state.json`, `host.log`, `tunnel.log`, `wrangler.log`). Outro diretório: `CLOUDFACT_HOME=/x`.

## Teste

`npm test` sobe o MCP, lista as tools e chama `doctor`/`list`.

## Roadmap

- [ ] Aplicações com servidor: `cloudfact expose <porta>` (mesmo host e gate de chave, apontando para a app).
- [ ] `--private` também no backend workers (worker mínimo checando cookie).
- [ ] Túnel nomeado (URL fixa no seu domínio).
- [ ] Publicar no npm (`npx cloudfact`).
