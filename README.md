# cloudfact

Publish a folder or a single HTML file from your machine to a public Cloudflare URL with one command. Ships as a **CLI**, an **MCP server** (works with Claude Code, Codex, Cursor, Claude Desktop, Windsurf…) and a `/cloudfact` skill.

```
cloudfact deploy ./report.html                       # → https://xxxx.trycloudflare.com          (no account needed)
cloudfact login --device && cloudfact deploy ./site  # → https://site.<your-sub>.workers.dev     (fixed URL, your account)
```

## Install

**Claude Code** — two commands, no clone, no `npm install` (skill `/cloudfact` + MCP server):

```
claude plugin marketplace add gabrielchaves6/cloudfact
claude plugin install cloudfact@cloudfact
```

**Everything at once** (CLI on PATH, Claude Code plugin, Codex skill + MCP). Requires Node 20+ and git:

```
curl -fsSL https://raw.githubusercontent.com/gabrielchaves6/cloudfact/main/install.sh | bash
```

**Any other MCP client** (Cursor, Windsurf, Claude Desktop…): clone and point at the bundled, dependency-free server:

```json
{ "mcpServers": { "cloudfact": { "command": "node", "args": ["/path/to/cloudfact/dist/server.js"] } } }
```

It works without any login through the quick tunnel. `cloudflared` is downloaded automatically on the first deploy (Linux/macOS, x64/arm64) into `~/.cloudfact/bin`; if you already have it on PATH, yours is used.

## Sign in to your Cloudflare account (optional, for a fixed URL)

Two options. The first works even when you only reach the machine through an agent (Claude Code, Codex…): the agent runs the command, relays the link and the code, and you approve in a browser on any device.

```bash
cloudfact login --device        # browser OAuth (wrangler login --device); no token ever goes through the chat
cloudfact login --token <tok>   # or an API token: https://dash.cloudflare.com/profile/api-tokens ("Edit Cloudflare Workers" template)
```

Tokens are stored in `~/.cloudfact/config.json` (0600); OAuth credentials live where wrangler keeps them (`~/.config/.wrangler`). `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` also work. `cloudfact logout` forgets.

After signing in the default backend becomes `workers`; `--backend tunnel` remains available.

## Backends

| backend                        | account? | URL                                  | how                                                                                                                                                                                                                                                             |
| ------------------------------ | -------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tunnel` (default, signed out) | no       | `https://<random>.trycloudflare.com` | local static server + `cloudflared` quick tunnel in a detached process that outlives the agent session and reconnects if the tunnel drops                                                                                                                       |
| `workers` (default, signed in) | yes      | `https://<name>.<sub>.workers.dev`   | Cloudflare Workers with static assets, the successor of Pages (Cloudflare no longer creates new Pages projects). `wrangler deploy --assets`, fetched via `npx` on first use. Uploads a copy without dotfiles/symlinks/node_modules. `remove` deletes the worker |

`--private` generates a key; the returned URL carries `#key=…`. Without the cookie every route returns only a gate page, which exchanges the fragment for an HttpOnly cookie via `POST /api/session`. Tunnel backend only, for now.

Local server safety: serves only what is inside the published folder, never dotfiles, no path traversal. A single `.html` is served alone (relative assets are not included; publish the folder in that case).

## MCP

Stdio server. Tools: `deploy`, `list`, `status`, `stop`, `remove`, `logs`, `doctor` — see [docs/tools.md](docs/tools.md) (generated from the code). Prompt: `cloudfact`. Sign-in is deliberately outside the MCP: run `cloudfact login` in a terminal so the token never enters the agent context.

Skill `/cloudfact <path> [--private] [--name x] [--tunnel|--workers]` lives in `skills/cloudfact/SKILL.md`; the Claude Code plugin ships it, and `install.sh` links it into `~/.codex/skills`.

## CLI

```
cloudfact deploy [path] [--name n] [--private] [--backend auto|tunnel|workers] [--restart] [--json]
cloudfact list | status <name> | stop <name>|--all | rm <name> | logs <name> [-n 40]
cloudfact doctor | setup | login --device | login --token T [--account-id ID] | logout
cloudfact config get | set <key> <value>
cloudfact mcp                     # MCP server over stdio
```

State: `~/.cloudfact/deploys/<name>/` (`state.json`, `host.log`, `tunnel.log`, `wrangler.log`). Different directory: `CLOUDFACT_HOME=/x`.

## Development

TypeScript. Runtime dependencies (MCP SDK and zod) are bundled into `dist/`.

```
src/
  bin.ts                 CLI entry              → dist/bin.js
  server.ts              MCP entry (stdio)      → dist/server.js
  index.ts               public API (library)   → dist/index.js + .d.ts
  cloudfact.ts           use cases: deploy, stop, remove, status, doctor
  config.ts  types.ts  logger.ts
  mcp/
    server.ts            createServer(): registers tools and prompt
    define-tool.ts       typed defineTool() with annotations (readOnlyHint, destructiveHint)
    tools/               tool definitions
  backends/
    tunnel/              static-server.ts · host.ts (detached process → dist/host.js) · index.ts
    workers/             wrangler deploy --assets
  services/              state (atomic on disk) · cloudflared (lookup/download) · wrangler · auth (token / device)
tests/                   vitest: static server, state, MCP in-memory, workers with a fake wrangler, CLI
scripts/                 generate-docs (docs/tools.md from the tool definitions) · verify-versions
skills/cloudfact/        the /cloudfact skill
.claude-plugin/          plugin and marketplace manifests
server.json              MCP registry manifest
```

```
npm run check      # typecheck + lint + test + build + docs + version sync (what CI runs)
npm test           # vitest
npm run build      # tsup → dist/ (committed on purpose: the plugin works straight from git, no npm install)
npm run docs       # regenerate docs/tools.md
npm run inspect    # MCP Inspector against dist/server.js
```

CI fails if `dist/` or `docs/tools.md` are stale, or if the version differs across `package.json`, `server.json` and the plugin manifests. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Roadmap

- [ ] Apps with a server: `cloudfact expose <port>` (same host and key gate, pointing at the app).
- [ ] `--private` on the workers backend (minimal worker checking the cookie).
- [ ] Named tunnel (fixed URL on your own domain).
- [ ] npm publish (`npx cloudfact`).
- [ ] HTTP transport for remote MCP connectors (claude.ai web).

## License

MIT
