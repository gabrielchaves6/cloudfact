/**
 * Setting cloudfact up inside Codex, from Node rather than from a shell script, so it works the same on
 * Windows. Two things have to happen: the MCP server has to be registered in Codex's config, and the
 * skill has to be copied into Codex's skills folder. Copied, not symlinked: Windows does not hand out
 * symlinks to ordinary users.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SERVER_SCRIPT, SKILL_DIR } from '../config.js';

export const codexHome = (): string => process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');

/** Codex rejects any frontmatter key outside this set, and a rejected skill is simply not loaded. */
const ALLOWED_FRONTMATTER = new Set(['name', 'description', 'license', 'allowed-tools', 'metadata']);

/** Same skill, minus the keys Codex does not allow (`argument-hint` is Claude Code's). */
export function skillForCodex(markdown: string): string {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  if (!m) return markdown;
  const kept = m[1]
    .split('\n')
    .filter((line) => {
      const key = /^([A-Za-z0-9_-]+):/.exec(line)?.[1];
      return key === undefined ? true : ALLOWED_FRONTMATTER.has(key);
    })
    .join('\n');
  return `---\n${kept}\n---\n` + markdown.slice(m[0].length);
}

function copySkill(target: string): number {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  let n = 0;
  for (const entry of fs.readdirSync(SKILL_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const from = path.join(SKILL_DIR, entry.name);
    const body = fs.readFileSync(from, 'utf8');
    fs.writeFileSync(path.join(target, entry.name), entry.name === 'SKILL.md' ? skillForCodex(body) : body);
    n += 1;
  }
  return n;
}

/** `[mcp_servers.cloudfact]` written by hand, leaving every other server in the file untouched. */
export function mergeMcpToml(toml: string, command: string, args: string[]): string {
  const block = `[mcp_servers.cloudfact]\ncommand = ${JSON.stringify(command)}\nargs = [${args
    .map((a) => JSON.stringify(a))
    .join(', ')}]\n`;
  const header = /^\[mcp_servers\.cloudfact\]\s*$/m;
  const start = header.exec(toml);
  if (!start) return toml.trimEnd() + (toml.trim() ? '\n\n' : '') + block;
  const after = toml.slice(start.index + start[0].length);
  const next = /^\[/m.exec(after);
  const rest = next ? after.slice(next.index) : '';
  return toml.slice(0, start.index) + block + (rest ? '\n' + rest : '');
}

export interface CodexSetup {
  codexHome: string;
  configPath: string;
  skillPath: string;
  files: number;
  registeredWith: 'codex-cli' | 'config.toml';
}

/** Registers the MCP server and installs the skill. Idempotent: run it again after an update. */
export function setupCodex(): CodexSetup {
  const home = codexHome();
  fs.mkdirSync(home, { recursive: true });
  const skillPath = path.join(home, 'skills', 'cloudfact');
  fs.mkdirSync(path.dirname(skillPath), { recursive: true });
  const files = copySkill(skillPath);

  // the Codex CLI owns the config format, so let it write when it is around
  const win = process.platform === 'win32';
  const run = (args: string[]) => spawnSync('codex', args, { encoding: 'utf8', shell: win, stdio: 'ignore' });
  let registeredWith: CodexSetup['registeredWith'] = 'config.toml';
  if (run(['--version']).status === 0) {
    run(['mcp', 'remove', 'cloudfact']);
    if (run(['mcp', 'add', 'cloudfact', '--', process.execPath, SERVER_SCRIPT]).status === 0) registeredWith = 'codex-cli';
  }
  const configPath = path.join(home, 'config.toml');
  if (registeredWith === 'config.toml') {
    const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
    fs.writeFileSync(configPath, mergeMcpToml(current, process.execPath, [SERVER_SCRIPT]));
  }
  return { codexHome: home, configPath, skillPath, files, registeredWith };
}
