# Security

## Model

- The local static server binds to `127.0.0.1` only and is reachable from the internet solely through the Cloudflare tunnel. It serves files inside the published folder, refuses dotfiles, path traversal and non-GET methods, and never lists `$HOME` or `/`.
- `--private` (default for `expose`) gates every route behind an HttpOnly, Secure cookie obtained from a 256-bit key carried in the URL fragment (`#key=…`), which browsers do not send to servers or logs. Keys are compared in constant time, can expire (`--expires`) and can be rotated at runtime (`cloudfact rotate`), which invalidates the old link and every session at once. `POST /api/session` is rate-limited per visitor IP (`CF-Connecting-IP`) and failures are logged.
- The reverse proxy (`expose`) discards client-supplied `X-Forwarded-*`/`X-Real-IP` and sets them from Cloudflare's `CF-Connecting-IP`, so the app sees the real visitor IP. WebSocket upgrades go through the same gate.
- SSH forwards bind to loopback on both ends and run with `BatchMode`; `--strict-host-key` requires the host key to be in `known_hosts` already instead of trusting it on first connection.
- A private link is still a bearer link: anyone who obtains it can open the site until it is rotated or expires. For identity-based access use Cloudflare Access (roadmap).
- Quick-tunnel URLs are random and unlisted, but public: anything published without `--private` is reachable by anyone with the link.
- Credentials (API token or wrangler OAuth) stay in `~/.cloudfact/config.json` (0600) or wrangler's own store. Sign-in is deliberately a CLI flow so tokens never pass through an agent's context.
- `workers` uploads a filtered copy (no dotfiles, symlinks or `node_modules`) so a `.env` next to your `index.html` is never published.

## Reporting

Please report vulnerabilities privately through [GitHub security advisories](https://github.com/gabrielchaves6/cloudfact/security/advisories/new) rather than public issues.
