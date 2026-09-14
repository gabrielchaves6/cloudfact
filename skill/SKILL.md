---
name: cloudfact
description: Publica uma pasta ou um .html gerado na VM em uma URL pública na Cloudflare com um comando (/cloudfact <caminho> [--private] [--name x] [--pages]). Use quando o usuário pedir para "subir", "hospedar", "publicar", "abrir no navegador" ou "me dá um link" de um HTML/site estático.
argument-hint: <pasta ou arquivo.html> [--private] [--name nome] [--pages] [--restart]
---

# /cloudfact — publicar página estática na Cloudflare

Você tem o MCP `cloudfact` disponível (tools `deploy`, `list`, `status`, `stop`, `remove`, `logs`, `doctor`).
Se as tools MCP não estiverem carregadas nesta sessão, use o CLI equivalente via shell:
`cloudfact deploy <caminho> [--private] [--name n] [--backend pages] [--restart] --json`.

## Passos

1. **Resolver o caminho.** Argumentos: `$ARGUMENTS`.
   - Sem argumento: use o último HTML/pasta que você gerou nesta conversa; se não houver, procure `index.html` no diretório atual. Se ainda assim for ambíguo, pergunte.
   - Um `.html` isolado é servido sozinho (assets relativos NÃO vão junto). Se a página depende de css/js/imagens locais, publique a **pasta**.
   - Converta para caminho absoluto.
2. **Publicar** com a tool `deploy`:
   - `path`: caminho absoluto.
   - `private: true` se `--private` foi passado ou se o conteúdo é sensível (dados internos, credenciais, painéis). Em dúvida com dados de negócio, prefira privado.
   - `name`: de `--name`, senão deixe o padrão.
   - `backend: "pages"` só se `--pages` foi pedido (exige token do Cloudflare configurado; `doctor` mostra). Padrão `auto` = túnel rápido sem conta.
   - `restart: true` se `--restart`.
3. **Responder** de forma curta:
   - A URL clicável (use `privateUrl` quando existir, ela já carrega a chave no `#key=`).
   - Uma linha dizendo que é túnel rápido (URL muda se reiniciar; processo segue vivo em background) ou Pages (URL fixa).
   - Como parar: `cloudfact stop <nome>` ou a tool `stop`.
4. **Se falhar**, rode `doctor` e `logs` do deploy, explique a causa e o que fazer. Se for falta de credencial do Pages, peça ao usuário para rodar `cloudfact login` no terminal (não peça o token no chat) ou use `backend: "tunnel"`.

## Regras

- Nunca copie a chave privada para arquivos do projeto do usuário; ela já está em `~/.cloudfact/deploys/<nome>/state.json` (0600).
- Não republique em loop: `deploy` é idempotente e devolve a URL existente se o mesmo caminho já estiver no ar (`reused: true`).
- Não sirva `/` ou `$HOME` inteiros; se o usuário pedir, aponte para uma subpasta específica.
