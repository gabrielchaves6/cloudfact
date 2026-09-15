# Security

## Model

- The local static server binds to `127.0.0.1` only and is reachable from the internet solely through the Cloudflare tunnel. It serves files inside the published folder, refuses dotfiles, path traversal and non-GET methods, and never lists `$HOME` or `/`.
- `--private` gates every route behind an HttpOnly cookie obtained from a 256-bit key carried in the URL fragment (`#key=…`), which browsers do not send to servers or logs.
- Quick-tunnel URLs are random and unlisted, but public: anything published without `--private` is reachable by anyone with the link.
- Credentials (API token or wrangler OAuth) stay in `~/.cloudfact/config.json` (0600) or wrangler's own store. Sign-in is deliberately a CLI flow so tokens never pass through an agent's context.
- `workers` uploads a filtered copy (no dotfiles, symlinks or `node_modules`) so a `.env` next to your `index.html` is never published.

## Reporting

Please report vulnerabilities privately through [GitHub security advisories](https://github.com/gabrielchaves6/cloudfact/security/advisories/new) rather than public issues.
