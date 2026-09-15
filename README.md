# cloudfact

Publish a folder, a single HTML file, or an app that is already listening on a port (locally or on a machine reachable over SSH) to a public Cloudflare URL with one command. Ships as a **CLI**, an **MCP server** (works with Claude Code, Codex, Cursor, Claude Desktop, Windsurf…) and a `/cloudfact` skill.

```
cloudfact deploy ./report.html                       # → https://xxxx.trycloudflare.com          (no account needed)
cloudfact login --device && cloudfact deploy ./site  # → https://site.<your-sub>.workers.dev     (fixed URL, your account)
cloudfact expose 3000 --ssh ubuntu@my-vm             # → https://xxxx.trycloudflare.com          (app on another machine, over SSH)
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

## Apps with a server (`expose`)

Anything that already listens on a port can be published the same way, with HTTP and WebSocket proxied and the same optional `--private` gate:

```
cloudfact expose 3000                          # app running on this machine (private link by default)
cloudfact expose 3000 --ssh ubuntu@10.0.0.5    # app running on another machine, reached over SSH
cloudfact expose 8080 --ssh myvm --public      # `myvm` = Host alias from ~/.ssh/config; no key gate
```

Apps are **private by default** (key-gated link, see below); pass `--public` to opt out. With `--ssh`, cloudfact opens an `ssh -N -L` port-forward to the remote app and publishes through the local tunnel. Nothing is installed on the remote machine; it only needs key-based SSH access (`--ssh-port`, `--identity`, `--strict-host-key` available). The forward and the tunnel are supervised and reconnect if they drop. MCP tool: `expose`.

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

## Private links

`--private` (the default for `expose`) generates a 256-bit key; the returned URL carries it in `#key=…`, which browsers never send to servers. Without the cookie every route returns only a gate page, which exchanges the fragment for an HttpOnly, Secure cookie via `POST /api/session`. That endpoint is rate-limited per visitor IP (10 attempts/minute) and failures are logged to the deploy's `host.log`.

```
cloudfact deploy ./report --private --expires 24h   # link stops working after 24h
cloudfact rotate report                             # new key now; old link and all sessions die
cloudfact rotate report --expires 2h                # new key with a lifetime
```

`rotate` works on a running deploy without restarting it (and turns a public deploy private). Tunnel backend only, for now. For identity-based access (sign in with Google or a one-time email code) see the roadmap item on Cloudflare Access.

Local server safety: serves only what is inside the published folder, never dotfiles, no path traversal. A single `.html` is served alone (relative assets are not included; publish the folder in that case).

## MCP

Stdio server. Tools: `deploy`, `expose`, `list`, `status`, `rotate`, `stop`, `remove`, `logs`, `doctor` — see [docs/tools.md](docs/tools.md) (generated from the code). Prompt: `cloudfact`. Sign-in is deliberately outside the MCP: run `cloudfact login` in a terminal so the token never enters the agent context.

Skill `/cloudfact <path> [--private] [--name x] [--tunnel|--workers]` lives in `skills/cloudfact/SKILL.md`; the Claude Code plugin ships it, and `install.sh` links it into `~/.codex/skills`.

## CLI

```
cloudfact deploy [path] [--name n] [--private] [--expires 24h] [--backend auto|tunnel|workers] [--restart] [--json]
cloudfact expose <port> [--name n] [--public] [--expires 24h] [--ssh user@host] [--ssh-port 22] [--identity key] [--strict-host-key] [--restart] [--json]
cloudfact rotate <name> [--expires 24h]
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
    tunnel/              static-server.ts · proxy.ts (expose: HTTP + WebSocket) · gate.ts (private mode) · host.ts (detached process → dist/host.js) · index.ts
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

CI fails if `dist/` or `docs/tools.md` are stale, or if the version differs across `package.json`, `server.json` and the plugin manifests. Every push to `main` is released automatically (patch bump by the workflow; `npm run bump` for minor/major). See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Roadmap

- [ ] Cloudflare Access: named tunnel on your own domain + identity-based sign-in (Google, one-time email code) in front of any deploy.
- [ ] `cloudfact run`: rsync a project to an SSH host, start it there, and expose it in one step.
- [ ] `--private` on the workers backend (minimal worker checking the cookie).
- [ ] Named tunnel (fixed URL on your own domain).
- [ ] npm publish (`npx cloudfact`).
- [ ] HTTP transport for remote MCP connectors (claude.ai web).

## License

MIT
