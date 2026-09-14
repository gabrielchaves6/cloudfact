#!/usr/bin/env bash
# Instala o cloudfact: deps, binário no PATH, skill /cloudfact e registro do MCP no Claude Code e no Codex.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node)"
cd "$ROOT" && npm install --omit=dev --no-fund --no-audit >/dev/null

mkdir -p ~/.local/bin && ln -sfn "$ROOT/bin/cloudfact.js" ~/.local/bin/cloudfact
echo "bin: ~/.local/bin/cloudfact"

for d in ~/.claude/skills ~/.codex/skills; do
  mkdir -p "$d" && ln -sfn "$ROOT/skill" "$d/cloudfact" && echo "skill: $d/cloudfact"
done

if command -v claude >/dev/null; then
  claude mcp remove -s user cloudfact >/dev/null 2>&1 || true
  claude mcp add -s user cloudfact -- "$NODE" "$ROOT/src/server.js" && echo "mcp: claude (user scope)"
fi
if command -v codex >/dev/null; then
  codex mcp remove cloudfact >/dev/null 2>&1 || true
  codex mcp add cloudfact -- "$NODE" "$ROOT/src/server.js" && echo "mcp: codex"
fi
command -v cloudflared >/dev/null || echo "AVISO: cloudflared não encontrado (necessário para o backend tunnel)"
echo "pronto. teste: cloudfact doctor"
