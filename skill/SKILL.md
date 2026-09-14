---
name: cloudfact
description: Publica uma pasta ou um .html gerado na VM em uma URL pública na Cloudflare com um comando (/cloudfact <caminho> [--private] [--name x] [--tunnel|--workers]). Use quando o usuário pedir para "subir", "hospedar", "publicar", "abrir no navegador" ou "me dá um link" de um HTML/site estático.
argument-hint: <pasta ou arquivo.html> [--private] [--name nome] [--tunnel|--workers] [--restart]
---

# /cloudfact — publicar página estática na Cloudflare

Você tem o MCP `cloudfact` disponível (tools `deploy`, `list`, `status`, `stop`, `remove`, `logs`, `doctor`).
Se as tools MCP não estiverem carregadas nesta sessão, use o CLI equivalente via shell:
`cloudfact deploy <caminho> [--private] [--name n] [--backend tunnel|workers] [--restart] --json`.

## Passos

1. **Resolver o caminho.** Argumentos: `$ARGUMENTS`.
   - Sem argumento: use o último HTML/pasta que você gerou nesta conversa; se não houver, procure `index.html` no diretório atual. Se ainda assim for ambíguo, pergunte.
   - Um `.html` isolado é servido sozinho (assets relativos NÃO vão junto). Se a página depende de css/js/imagens locais, publique a **pasta**.
   - Converta para caminho absoluto.
2. **Publicar** com a tool `deploy`:
   - `path`: caminho absoluto.
   - `private: true` se `--private` foi passado ou se o conteúdo é sensível (dados internos, credenciais, painéis). Em dúvida com dados de negócio, prefira privado. Privado força `backend: "tunnel"`.
   - `name`: de `--name`, senão deixe o padrão.
   - `backend`: `"tunnel"` se `--tunnel`, `"workers"` se `--workers`; senão `auto` (workers com URL fixa se estiver logado, túnel rápido caso contrário; `doctor` mostra).
   - `restart: true` se `--restart`.
3. **Responder** de forma curta:
   - A URL clicável (use `privateUrl` quando existir, ela já carrega a chave no `#key=`).
   - Uma linha dizendo que é túnel rápido (URL muda se reiniciar; processo segue vivo em background) ou Workers (URL fixa, republicar atualiza no mesmo endereço).
   - Como parar: `cloudfact stop <nome>` ou a tool `stop`.
4. **Se falhar**, rode `doctor` e `logs` do deploy, explique a causa e o que fazer. Se o usuário quiser URL fixa e não estiver logado, rode `cloudfact login --device` em background (shell), leia o link e o código da saída, mostre ao usuário e espere a aprovação (vale 5 min). Nunca peça o token no chat.

## Regras

- Nunca copie a chave privada para arquivos do projeto do usuário; ela já está em `~/.cloudfact/deploys/<nome>/state.json` (0600).
- Não republique em loop: `deploy` é idempotente e devolve a URL existente se o mesmo caminho já estiver no ar (`reused: true`).
- Não sirva `/` ou `$HOME` inteiros; se o usuário pedir, aponte para uma subpasta específica.
