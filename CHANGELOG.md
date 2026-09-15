# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
