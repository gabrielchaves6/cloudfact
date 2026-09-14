# cloudfact

MCP + CLI para publicar páginas estáticas geradas na VM em uma URL pública na Cloudflare com um comando.

```
/cloudfact ./relatorio.html            # no Claude Code / Codex
cloudfact deploy ./site --private      # no shell
```

## Como funciona

| backend | quando | URL | precisa de conta? |
|---|---|---|---|
| `tunnel` (padrão) | sempre disponível | `https://<aleatório>.trycloudflare.com` | não |
| `pages` | com `CLOUDFLARE_API_TOKEN` | `https://<nome>.pages.dev` (fixa) | sim |

**tunnel**: um processo `host` destacado sobe um servidor estático em `127.0.0.1:<porta livre>` (sem dotfiles, sem path traversal, sem listagem de `$HOME`) e um `cloudflared tunnel --url ... --protocol http2`. Ele sobrevive ao fim da sessão do agente, religa o cloudflared se cair, e guarda estado em `~/.cloudfact/deploys/<nome>/state.json`. A URL muda a cada `--restart`.

**pages**: `wrangler pages deploy` (via `npx wrangler@4`) com o token; cria o projeto se não existir. Não testado ainda nesta VM porque não há token configurado.

`--private`: gera uma chave; a URL devolvida vem com `#key=...`. Sem o cookie, qualquer rota devolve só a página de gate, que troca o fragmento por um cookie HttpOnly em `POST /api/session`.

Um `.html` isolado é servido sozinho (só ele). Para páginas com css/js/imagens relativas, publique a pasta.

## Instalar

```
git clone https://github.com/gabrielchaves6/cloudfact ~/rc/cloudfact
~/rc/cloudfact/install.sh
```

O `install.sh` instala deps, linka `~/.local/bin/cloudfact`, a skill `/cloudfact` em `~/.claude/skills` e `~/.codex/skills`, e registra o MCP (`claude mcp add -s user`, `codex mcp add`). Requer `cloudflared` no PATH para o backend tunnel.

Para o Pages: `cloudfact config set cloudflareApiToken <token>` e `cloudfact config set cloudflareAccountId <id>` (ou variáveis de ambiente).

## CLI

```
cloudfact deploy [caminho] [--name n] [--private] [--backend auto|tunnel|pages] [--restart] [--json]
cloudfact list
cloudfact status <nome>
cloudfact stop <nome> | --all
cloudfact rm <nome>
cloudfact logs <nome> [-n 40]
cloudfact doctor
cloudfact mcp             # servidor MCP via stdio (o mesmo que src/server.js)
```

## MCP

Servidor stdio em `src/server.js`. Tools: `deploy`, `list`, `status`, `stop`, `remove`, `logs`, `doctor`. Prompt: `cloudfact`.

```
claude mcp add -s user cloudfact -- node /caminho/cloudfact/src/server.js
```

## Teste

`npm test` sobe o MCP, lista as tools e chama `doctor`/`list`.

## Roadmap

- [ ] Aplicações com servidor (proxy de uma porta local: `cloudfact expose 3000`).
- [ ] Validar o backend Pages com token real.
- [ ] Túnel nomeado (URL fixa sem Pages) quando houver conta.
