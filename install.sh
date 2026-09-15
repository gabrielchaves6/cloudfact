#!/usr/bin/env bash
# Instalação plug and play do cloudfact.
#   curl -fsSL https://raw.githubusercontent.com/gabrielchaves6/cloudfact/master/install.sh | bash
# ou, dentro de um clone: ./install.sh
# Faz: código em ~/.cloudfact/app (ou o clone atual), `cloudfact` no PATH, plugin no Claude Code, skill + MCP no Codex.
set -euo pipefail
REPO="https://github.com/gabrielchaves6/cloudfact"
command -v node >/dev/null || { echo "precisa de Node 20+: https://nodejs.org"; exit 1; }
command -v git  >/dev/null || { echo "precisa de git"; exit 1; }

if [ -f "$(dirname "${BASH_SOURCE[0]:-x}")/package.json" ] 2>/dev/null && grep -q '"name": "cloudfact"' "$(dirname "${BASH_SOURCE[0]}")/package.json"; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  ROOT="$HOME/.cloudfact/app"
  if [ -d "$ROOT/.git" ]; then git -C "$ROOT" pull -q --ff-only; else mkdir -p "$HOME/.cloudfact" && git clone -q "$REPO" "$ROOT"; fi
fi
NODE="$(command -v node)"
echo "código: $ROOT"

mkdir -p ~/.local/bin && ln -sfn "$ROOT/dist/cloudfact.js" ~/.local/bin/cloudfact && echo "cli: ~/.local/bin/cloudfact"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "  (adicione ~/.local/bin ao PATH)";; esac

if command -v claude >/dev/null; then
  claude plugin marketplace add "$ROOT" >/dev/null 2>&1 || claude plugin marketplace update cloudfact >/dev/null 2>&1 || true
  claude plugin install cloudfact@cloudfact -s user >/dev/null 2>&1 && echo "claude code: plugin cloudfact (skill /cloudfact + MCP)" || echo "claude code: falha ao instalar o plugin; tente: claude plugin marketplace add $ROOT && claude plugin install cloudfact@cloudfact"
fi
if command -v codex >/dev/null; then
  mkdir -p ~/.codex/skills && ln -sfn "$ROOT/skills/cloudfact" ~/.codex/skills/cloudfact
  codex mcp remove cloudfact >/dev/null 2>&1 || true
  codex mcp add cloudfact -- "$NODE" "$ROOT/dist/server.js" >/dev/null && echo "codex: skill + MCP"
fi
echo "outros clientes MCP: node $ROOT/dist/server.js"
echo "pronto. próximo passo opcional: cloudfact login --device   (URL fixa na sua conta Cloudflare)"
