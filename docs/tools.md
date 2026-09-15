# Tools

_Generated from `src/mcp/tools` by `npm run docs`. Do not edit by hand._

## `deploy` — Publish static site

Publish a folder (or a single .html file) from this machine to a public Cloudflare URL. "tunnel" backend (default when signed out): local static server + cloudflared quick tunnel, *.trycloudflare.com URL; the process runs in the background and outlives the session. "workers" backend (default when signed in): Cloudflare Workers with static assets, fixed URL https://<name>.<sub>.workers.dev; redeploying updates the same address. Idempotent on tunnel: if the same path is already live, returns the existing URL (reused=true). Deploys are PRIVATE by default on both backends (key-gated link; on workers a gate Worker runs in front of the files); pass public=true to publish openly. access=[emails] (workers backend, API-token login) puts Cloudflare Access in front instead: visitors sign in with a one-time email code and only listed emails get in. Returns JSON with url and, when private, privateUrl (already includes #key=...).

_mutating, idempotent_

| parameter | type | required | description |
| --- | --- | --- | --- |
| `path` | string | yes | Absolute path of the folder or .html file to publish |
| `name` | string | no | Deploy name (slug). Defaults to the folder/file name |
| `public` | boolean | no | Publish without the key gate (default false: private) |
| `backend` | `auto` \| `tunnel` \| `workers` | no | auto = workers when signed in to Cloudflare, otherwise tunnel |
| `expires` | string | no | Private key lifetime, e.g. "30m", "24h", "7d" (default: never expires) |
| `access` | array | no | Emails allowed to sign in through Cloudflare Access (identity gate instead of the key link; workers backend) |
| `restart` | boolean | no | Restart even if already live (yields a new URL on tunnel) |

## `expose` — Expose a running app

Publish an app that is already listening on a port to a public *.trycloudflare.com URL (tunnel backend). Without ssh, the port is on this machine. With ssh (user@host), the app runs on another machine: cloudfact opens an SSH port-forward to it and publishes through here — nothing to install remotely (key-based SSH access required). HTTP and WebSocket traffic is proxied. Apps are PRIVATE by default (same #key gate as static deploys, with rate limiting and optional expiry); pass public=true to publish without the gate. Idempotent: the same port/host already live returns the existing URL (reused=true).

_mutating, idempotent_

| parameter | type | required | description |
| --- | --- | --- | --- |
| `port` | number | yes | Port the app listens on (locally, or on the SSH host) |
| `name` | string | no | Deploy name (slug). Defaults to port-<port> or <host>-<port> |
| `public` | boolean | no | Publish without the key gate (default false: private) |
| `expires` | string | no | Private key lifetime, e.g. "30m", "24h", "7d" (default: never expires) |
| `ssh` | string | no | SSH destination of the machine running the app, e.g. ubuntu@10.0.0.5 or a Host alias from ~/.ssh/config |
| `sshPort` | number | no | SSH port (default 22) |
| `identity` | string | no | Path to the SSH private key (default: ssh agent / ~/.ssh/config) |
| `strictHostKey` | boolean | no | Require the SSH host key to be in known_hosts already (no first-connection trust) |
| `restart` | boolean | no | Restart even if already live (yields a new URL) |

## `list` — List deploys

List every cloudfact deploy with backend, status and URL.

_read-only_

No parameters.

## `catalog` — Account catalog

Every cloudfact in the user's Cloudflare account, grouped by project, as the account itself sees them (so deploys made from another machine show up too). Each entry says whether it is public, a private key link or behind Cloudflare Access sign-in, and whether it serves static files or an app with its own server. Quick tunnels have no account-side resource and appear only when this machine still has their record (inAccount=false). publish=true turns the catalog into a browsable page and returns its URL; that page asks for Cloudflare Access sign-in by default, for the email that owns the account.

_mutating_

| parameter | type | required | description |
| --- | --- | --- | --- |
| `project` | string | no | Only deploys filed under this project |
| `publish` | boolean | no | Publish the catalog as a page and return its URL |
| `access` | array | no | With publish: emails allowed to sign in to the catalog page (default: the account owner) |

## `project` — Set project

File a deploy under a project in the account catalog (or pass project=null to clear it). Takes effect without redeploying.

_mutating, idempotent_

| parameter | type | required | description |
| --- | --- | --- | --- |
| `name` | string | yes | Deploy name |
| `project` | string | yes | Project name, or null to clear |

## `status` — Deploy status

State of one deploy, including an HTTP check of its public URL (reachable/httpStatus).

_read-only_

| parameter | type | required | description |
| --- | --- | --- | --- |
| `name` | string | yes | Deploy name |

## `rotate` — Rotate private key

Issue a new private key for a live tunnel deploy without restarting it: the previous link and all sessions stop working at once. Optionally set an expiry. On a public deploy this turns it private. Returns the new privateUrl.

_mutating_

| parameter | type | required | description |
| --- | --- | --- | --- |
| `name` | string | yes | Deploy name |
| `expires` | string | no | New key lifetime, e.g. "24h" (default: never) |

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

