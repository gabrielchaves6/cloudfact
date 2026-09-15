# Tools

_Generated from `src/mcp/tools` by `npm run docs`. Do not edit by hand._

## `deploy` — Publicar página estática

Publica uma pasta (ou um único .html) da máquina em uma URL pública na Cloudflare. Backend "tunnel" (padrão sem login): servidor local + cloudflared quick tunnel, URL *.trycloudflare.com; o processo fica em background e sobrevive ao fim da sessão. Backend "workers" (padrão quando logado): Cloudflare Workers com assets estáticos, URL fixa https://<nome>.<sub>.workers.dev; republicar atualiza no mesmo endereço. No tunnel é idempotente: se o mesmo caminho já está no ar, devolve a URL existente (reused=true). Devolve JSON com url e, quando private=true, privateUrl (já inclui #key=...).

_mutating, idempotent_

| parameter | type                            | required | description                                                                                    |
| --------- | ------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `path`    | string                          | yes      | Caminho absoluto da pasta ou do arquivo .html a publicar                                       |
| `name`    | string                          | no       | Nome do deploy (slug). Padrão: nome da pasta/arquivo                                           |
| `private` | boolean                         | no       | Protege com chave: só quem abrir o privateUrl (#key=...) vê o conteúdo. Força o backend tunnel |
| `backend` | `auto` \| `tunnel` \| `workers` | no       | auto = workers se logado na Cloudflare, senão tunnel                                           |
| `restart` | boolean                         | no       | Força reiniciar mesmo se já estiver no ar (gera URL nova no tunnel)                            |

## `list` — Listar deploys

Lista todos os deploys do cloudfact com backend, status e URL.

_read-only_

No parameters.

## `status` — Status de um deploy

Estado de um deploy, incluindo checagem HTTP da URL pública (reachable/httpStatus).

_read-only_

| parameter | type   | required | description    |
| --------- | ------ | -------- | -------------- |
| `name`    | string | yes      | Nome do deploy |

## `stop` — Parar deploy

Encerra o servidor local e o túnel de um deploy (ou de todos com all=true). O registro fica para consulta. Não se aplica ao backend workers.

_mutating_

| parameter | type    | required | description           |
| --------- | ------- | -------- | --------------------- |
| `name`    | string  | no       | Nome do deploy        |
| `all`     | boolean | no       | Parar todos os túneis |

## `remove` — Remover deploy

Para (se estiver rodando) e apaga o registro e logs do deploy. No backend workers, apaga também o worker na Cloudflare.

_mutating, destructive_

| parameter | type   | required | description    |
| --------- | ------ | -------- | -------------- |
| `name`    | string | yes      | Nome do deploy |

## `logs` — Logs de um deploy

Últimas linhas dos logs do deploy: host (servidor local), cloudflared e wrangler.

_read-only_

| parameter | type   | required | description                      |
| --------- | ------ | -------- | -------------------------------- |
| `name`    | string | yes      | Nome do deploy                   |
| `lines`   | number | no       | Quantidade de linhas (padrão 40) |

## `doctor` — Diagnóstico

Diagnóstico: cloudflared, login na Cloudflare, backend padrão e deploys ativos. Rode antes de deploy quando algo falhar.

_read-only_

No parameters.
