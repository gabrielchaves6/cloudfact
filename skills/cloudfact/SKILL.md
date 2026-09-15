---
name: cloudfact
description: Publish a folder or an HTML file generated on this machine to a public Cloudflare URL with one command (/cloudfact <path> [--private] [--name x] [--tunnel|--workers]). Use whenever the user asks to "host", "publish", "put online", "open in a browser" or "give me a link" for an HTML file or static site.
argument-hint: <folder or file.html> [--private] [--name name] [--tunnel|--workers] [--restart]
---

# /cloudfact — publish a static page to Cloudflare

The `cloudfact` MCP server is available (tools `deploy`, `list`, `status`, `stop`, `remove`, `logs`, `doctor`).
If the MCP tools are not loaded in this session, use the equivalent CLI through the shell:
`cloudfact deploy <path> [--private] [--name n] [--backend tunnel|workers] [--restart] --json`.

## Steps

1. **Resolve the path.** Arguments: `$ARGUMENTS`.
   - No argument: use the last HTML file or folder you generated in this conversation; otherwise look for `index.html` in the current directory. If it is still ambiguous, ask.
   - A single `.html` is served alone (relative assets are NOT included). If the page depends on local css/js/images, publish the **folder**.
   - Convert to an absolute path.
2. **Publish** with the `deploy` tool:
   - `path`: absolute path.
   - `private: true` if `--private` was passed or the content is sensitive (internal data, credentials, dashboards). When in doubt with business data, prefer private. Private forces `backend: "tunnel"`.
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
- Never serve `/` or `$HOME` as a whole; if asked, point at a specific subfolder.
