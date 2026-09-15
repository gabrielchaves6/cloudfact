---
name: cloudfact
description: Publish a folder, an HTML file, or a running app (local port, or a port on a machine reachable over SSH) to a public Cloudflare URL with one command (/cloudfact <path> [--public] [--name x] [--tunnel|--workers] | /cloudfact expose <port> [--ssh user@host] [--public]). Use whenever the user asks to "host", "publish", "put online", "expose", "open in a browser" or "give me a link" for an HTML file, a static site or a server app.
argument-hint: <folder or file.html> [--public] [--name name] [--tunnel|--workers] [--restart]  |  expose <port> [--ssh user@host] [--public]
---

# /cloudfact — publish a static page to Cloudflare

The `cloudfact` MCP server is available (tools `deploy`, `expose`, `list`, `status`, `stop`, `remove`, `logs`, `doctor`).
If the MCP tools are not loaded in this session, use the equivalent CLI through the shell:
`cloudfact deploy <path> [--public] [--name n] [--backend tunnel|workers] [--restart] --json`.

## Apps with a server

If the argument starts with `expose`, or the user wants to publish something that runs as a server (API, dashboard with a backend, dev server, WebSocket app):

- App running on this machine: `expose` tool with `port` (start the app first if needed, in the background, and confirm it answers on 127.0.0.1:<port>).
- App running on another machine: `expose` with `port` and `ssh: "user@host"` (plus `sshPort`/`identity` when given). The machine only needs key-based SSH access from here; nothing is installed there. If SSH fails, run `ssh -o BatchMode=yes user@host true` in the shell to show the real error.
- Apps are private by default; pass `public: true` only when the user explicitly wants it open. Use `expires` (e.g. `"24h"`) for temporary links. Then reply with the URL exactly as in step 3 below.

## Static pages

1. **Resolve the path.** Arguments: `$ARGUMENTS`.
   - No argument: use the last HTML file or folder you generated in this conversation; otherwise look for `index.html` in the current directory. If it is still ambiguous, ask.
   - A single `.html` is served alone (relative assets are NOT included). If the page depends on local css/js/images, publish the **folder**.
   - Convert to an absolute path.
2. **Publish** with the `deploy` tool:
   - `path`: absolute path.
   - Deploys are private by default (key-gated link). Pass `public: true` only when the user explicitly asks for an open page. `expires` (e.g. `"24h"`) for temporary links.
   - When the user has several deploys and asks what is online, answer from `catalog` and, if no catalog page exists yet, offer once to publish it with `catalog` + `publish: true` (one page with every site, behind a sign-in). Do not insist.
   - `credentials` stores the login of the app behind a deploy so the catalog page can show it. Never repeat a stored password back to the user in chat; point at the catalog page instead.
   - To answer "what do I have published?", use `catalog` (the Cloudflare account, not just this machine): it groups by project and says, per deploy, whether it is public, a private link or behind sign-in, and whether it is static or an app with its own server. `catalog` with `publish: true` turns it into a page, which asks for Access sign-in by default. Use `project` to file a deploy under a project without redeploying, and pass `project` on `deploy`/`expose` when the user names one.
   - When the user wants sign-in by identity ("only me", "only these people", "login"), use `access: [emails]` with `backend: "workers"`. It needs an API-token login; if `doctor` shows `source: "wrangler"`, explain the token steps from the error message instead of asking for the token in chat.
   - `name`: from `--name`, otherwise keep the default.
   - `backend`: `"tunnel"` for `--tunnel`, `"workers"` for `--workers`; otherwise `auto` (workers with a fixed URL when signed in, quick tunnel otherwise; `doctor` shows which).
   - `restart: true` for `--restart`.
3. **Reply** briefly:
   - The clickable URL (use `privateUrl` when present; it already carries the key in `#key=`).
   - One line saying whether it is a quick tunnel (URL changes on restart; the process keeps running in the background) or Workers (fixed URL; redeploying updates it in place).
   - How to stop: `cloudfact stop <name>` or the `stop` tool.
4. **On failure**, run `doctor` and `logs` for the deploy, explain the cause and the fix. If the user wants a fixed URL and is not signed in, run `cloudfact login --device` in the background (shell), read the link and the code from its output, show them to the user and wait for approval (valid for 5 minutes). Never ask for the token in the chat.

## Rules

- Never copy the private key into the user's project files; it already lives in `~/.cloudfact/deploys/<name>/state.json` (0600).
- Do not republish in a loop: `deploy` is idempotent and returns the existing URL when the same path is already live (`reused: true`).
- To revoke a shared link without taking the site down, use the `rotate` tool and hand over the new `privateUrl`.
- Never serve `/` or `$HOME` as a whole; if asked, point at a specific subfolder.
