# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- README documents the Zero Trust Free limit for `--access`: 50 seats per Cloudflare account, shared by all deploys.

## [0.7.1] - 2026-09-15

### Changed

- Cloudflare Access (`deploy --access`) verified end-to-end on a real Cloudflare account: team, one-time PIN provider and application created through the API with no Zero Trust checkout, and the `*.workers.dev` URL redirects to the team sign-in page. Docs updated accordingly.

## [0.7.0] - 2026-09-15

### Added

- `deploy --access <emails>` (workers backend): Cloudflare Access sign-in in front of the site with a one-time email code, no domain required. cloudfact creates the Zero Trust team and the one-time PIN provider on first use, one Access application per deploy (updated on redeploy, deleted on `remove`), and the generated Worker fails closed when a request did not come through Access. Requires `cloudfact login --token` with Access permissions.

## [0.6.0] - 2026-09-15

### Security

- Every deploy is private by default (`--public` to opt out), on both backends.
- Private mode on the `workers` backend: a generated gate Worker runs in front of the assets, the key is a Worker secret, sessions are rate-limited with Cloudflare's rate-limit binding, and `rotate` works without a redeploy.

## [0.5.0] - 2026-09-15

### Security

- `expose` is private by default (`--public` to opt out).
- Private key expiry (`--expires 30m|24h|7d`) and runtime rotation (`cloudfact rotate <name>` / MCP tool `rotate`) without restarting the deploy.
- `POST /api/session` rate-limited per visitor IP (10/min) with failures logged; expired links get a distinct message.
- Reverse proxy sets `X-Forwarded-For`/`X-Real-IP` from `CF-Connecting-IP` and drops client-supplied forwarding headers.
- `expose --ssh --strict-host-key` requires the host key to be known already.

## [0.4.0] - 2026-09-15

### Added

- `cloudfact expose <port>` / MCP tool `expose`: publish an app that already listens on a port, with HTTP and WebSocket proxied and the optional `--private` gate.
- `expose --ssh user@host`: the app runs on another machine; cloudfact opens a supervised SSH port-forward and publishes through the local tunnel. Nothing to install remotely.

### Changed

- Private-mode gate extracted into `gate.ts`, shared by the static server and the proxy.

## [0.3.2] - 2026-09-15

### Changed

- Continuous deployment: every push to `main` is released. The workflow bumps the patch version itself when the push did not; `npm run bump` for minor/major; `[skip release]` to only run CI.

## [0.3.1] - 2026-09-15

### Changed

- Default branch renamed to `main`. Releases are now continuous: a version bump pushed to `main` creates the tag, the GitHub release and the npm publish automatically (`npm run bump`).

## [0.3.0] - 2026-09-15

First public release.

### Changed

- Rewritten in TypeScript following the structure of the reference MCP servers: `src/mcp/tools`, `backends/`, `services/`, typed `defineTool()` with annotations, tsup bundle, vitest, eslint + prettier, GitHub Actions CI, `server.json` for the MCP registry.
- `pages` backend replaced by `workers` (Cloudflare Workers static assets); `pages` remains accepted as an alias.

### Added

- `cloudfact login --device`: browser OAuth via `wrangler login --device`, usable from agent-only sessions.
- Claude Code plugin (`.claude-plugin/`) with the `/cloudfact` skill and the MCP server; `install.sh` runnable via curl.
- Automatic `cloudflared` download into `~/.cloudfact/bin`.

## [0.1.0] - 2026-09-14

### Added

- First version: quick-tunnel backend, private mode, MCP server, CLI and skill.
