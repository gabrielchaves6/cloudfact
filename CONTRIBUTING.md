# Contributing

Thanks for helping. Keep it small and testable.

## Setup

```
git clone https://github.com/gabrielchaves6/cloudfact && cd cloudfact
npm ci
npm run check        # typecheck + lint + test + build + docs + version sync
```

Node 20.19+ (see `.nvmrc`). `npm run inspect` opens the MCP Inspector against `dist/server.js`.

## Rules

- **Tools** live in `src/mcp/tools/`, one `defineTool()` each, with `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`) and a `describe()` on every parameter. `docs/tools.md` is generated from them: run `npm run docs` and commit the result.
- **`dist/` is committed.** The Claude Code plugin runs straight from git. Run `npm run build` before committing; CI rejects a stale `dist/`.
- **Versions** must match in `package.json`, `server.json` and `.claude-plugin/*.json` (`npm run verify`).
- **Never** touch stdout in the MCP process except through the protocol; log to stderr (`src/logger.ts`).
- Secrets never enter the repo or the agent context: sign-in is a CLI-only flow.
- Commit messages: [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`…).

## Releasing

Releases are continuous from `main`: bump the version and push.

1. `npm run bump x.y.z` (updates `package.json`, `server.json` and the plugin manifests) and add a `CHANGELOG.md` entry.
2. `npm run check`, commit, push to `main`.
3. The `release` workflow sees the new version, runs the full check, publishes to npm (when the `NPM_TOKEN` secret exists), creates the `vx.y.z` tag and the GitHub release with generated notes. Pushes that do not change the version only run CI.
