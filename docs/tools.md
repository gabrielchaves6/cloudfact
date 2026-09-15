# Tools

_Generated from `src/mcp/tools` by `npm run docs`. Do not edit by hand._

## `deploy` — Publish static site

Publish a folder (or a single .html file) from this machine to a public Cloudflare URL. "tunnel" backend (default when signed out): local static server + cloudflared quick tunnel, *.trycloudflare.com URL; the process runs in the background and outlives the session. "workers" backend (default when signed in): Cloudflare Workers with static assets, fixed URL https://<name>.<sub>.workers.dev; redeploying updates the same address. Idempotent on tunnel: if the same path is already live, returns the existing URL (reused=true). Returns JSON with url and, when private=true, privateUrl (already includes #key=...).

_mutating, idempotent_

| parameter | type | required | description |
| --- | --- | --- | --- |
| `path` | string | yes | Absolute path of the folder or .html file to publish |
| `name` | string | no | Deploy name (slug). Defaults to the folder/file name |
| `private` | boolean | no | Key-protected: only whoever opens privateUrl (#key=...) sees the content. Forces the tunnel backend |
| `backend` | `auto` \| `tunnel` \| `workers` | no | auto = workers when signed in to Cloudflare, otherwise tunnel |
| `restart` | boolean | no | Restart even if already live (yields a new URL on tunnel) |

## `expose` — Expose a running app

Publish an app that is already listening on a port to a public *.trycloudflare.com URL (tunnel backend). Without ssh, the port is on this machine. With ssh (user@host), the app runs on another machine: cloudfact opens an SSH port-forward to it and publishes through here — nothing to install remotely (key-based SSH access required). HTTP and WebSocket traffic is proxied. private=true adds the same #key gate as static deploys. Idempotent: the same port/host already live returns the existing URL (reused=true).

_mutating, idempotent_

| parameter | type | required | description |
| --- | --- | --- | --- |
| `port` | number | yes | Port the app listens on (locally, or on the SSH host) |
| `name` | string | no | Deploy name (slug). Defaults to port-<port> or <host>-<port> |
| `private` | boolean | no | Key-protected: only whoever opens privateUrl (#key=...) reaches the app |
| `ssh` | string | no | SSH destination of the machine running the app, e.g. ubuntu@10.0.0.5 or a Host alias from ~/.ssh/config |
| `sshPort` | number | no | SSH port (default 22) |
| `identity` | string | no | Path to the SSH private key (default: ssh agent / ~/.ssh/config) |
| `restart` | boolean | no | Restart even if already live (yields a new URL) |

## `list` — List deploys

List every cloudfact deploy with backend, status and URL.

_read-only_

No parameters.

## `status` — Deploy status

State of one deploy, including an HTTP check of its public URL (reachable/httpStatus).

_read-only_

| parameter | type | required | description |
| --- | --- | --- | --- |
| `name` | string | yes | Deploy name |

## `stop` — Stop deploy

Stop the local server and tunnel of one deploy (or all of them with all=true). The record is kept for inspection. Not applicable to the workers backend.

_mutating_

| parameter | type | required | description |
| --- | --- | --- | --- |
| `name` | string | no | Deploy name |
| `all` | boolean | no | Stop every tunnel |

## `remove` — Remove deploy

Stop (if running) and delete the deploy record and logs. On the workers backend, also deletes the worker on Cloudflare.

_mutating, destructive_

| parameter | type | required | description |
| --- | --- | --- | --- |
| `name` | string | yes | Deploy name |

## `logs` — Deploy logs

Last lines of the deploy logs: host (local server), cloudflared and wrangler.

_read-only_

| parameter | type | required | description |
| --- | --- | --- | --- |
| `name` | string | yes | Deploy name |
| `lines` | number | no | Number of lines (default 40) |

## `doctor` — Diagnostics

Diagnostics: cloudflared, Cloudflare sign-in, default backend and active deploys. Run it before deploy when something fails.

_read-only_

No parameters.

