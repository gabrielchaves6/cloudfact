#!/usr/bin/env bash
# Plug-and-play installer for cloudfact.
#   curl -fsSL https://raw.githubusercontent.com/gabrielchaves6/cloudfact/master/install.sh | bash
# or, inside a clone: ./install.sh
# Does: code in ~/.cloudfact/app (or the current clone), `cloudfact` on PATH, Claude Code plugin, Codex skill + MCP.
set -euo pipefail
REPO="https://github.com/gabrielchaves6/cloudfact"
command -v node >/dev/null || { echo "Node 20+ is required: https://nodejs.org"; exit 1; }
command -v git  >/dev/null || { echo "git is required"; exit 1; }

if [ -f "$(dirname "${BASH_SOURCE[0]:-x}")/package.json" ] 2>/dev/null && grep -q '"name": "cloudfact"' "$(dirname "${BASH_SOURCE[0]}")/package.json"; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  ROOT="$HOME/.cloudfact/app"
  if [ -d "$ROOT/.git" ]; then git -C "$ROOT" pull -q --ff-only; else mkdir -p "$HOME/.cloudfact" && git clone -q "$REPO" "$ROOT"; fi
fi
NODE="$(command -v node)"
echo "code: $ROOT"

mkdir -p ~/.local/bin && ln -sfn "$ROOT/dist/bin.js" ~/.local/bin/cloudfact && echo "cli: ~/.local/bin/cloudfact"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "  (add ~/.local/bin to your PATH)";; esac

if command -v claude >/dev/null; then
  claude plugin marketplace add "$ROOT" >/dev/null 2>&1 || claude plugin marketplace update cloudfact >/dev/null 2>&1 || true
  claude plugin install cloudfact@cloudfact -s user >/dev/null 2>&1 && echo "claude code: cloudfact plugin (/cloudfact skill + MCP)" || echo "claude code: plugin install failed; try: claude plugin marketplace add $ROOT && claude plugin install cloudfact@cloudfact"
fi
if command -v codex >/dev/null; then
  mkdir -p ~/.codex/skills && ln -sfn "$ROOT/skills/cloudfact" ~/.codex/skills/cloudfact
  codex mcp remove cloudfact >/dev/null 2>&1 || true
  codex mcp add cloudfact -- "$NODE" "$ROOT/dist/server.js" >/dev/null && echo "codex: skill + MCP"
fi
echo "other MCP clients: node $ROOT/dist/server.js"
echo "done. optional next step: cloudfact login --device   (fixed URL on your Cloudflare account)"
