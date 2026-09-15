import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mergeMcpToml, skillForCodex } from '../src/services/codex.js';
import { tmpDir } from './helpers.js';

describe('setting up Codex', () => {
  it('drops the frontmatter keys Codex refuses, keeping the rest of the skill intact', () => {
    const source = fs.readFileSync(path.resolve('skills/cloudfact/SKILL.md'), 'utf8');
    expect(source).toContain('argument-hint:'); // Claude Code's, and not in Codex's allow list
    const out = skillForCodex(source);
    expect(out).not.toContain('argument-hint:');
    expect(out).toContain('name: cloudfact');
    expect(out).toContain('description:');
    expect(out).toContain('# /cloudfact');
    expect(out.split('---\n').length).toBe(source.split('---\n').length); // still one frontmatter block
  });

  it('leaves a skill alone when it has no frontmatter', () => {
    expect(skillForCodex('# just a heading\n')).toBe('# just a heading\n');
  });

  it('adds the server to an empty config', () => {
    const out = mergeMcpToml('', '/usr/bin/node', ['/app/dist/server.js']);
    expect(out).toContain('[mcp_servers.cloudfact]');
    expect(out).toContain('command = "/usr/bin/node"');
    expect(out).toContain('args = ["/app/dist/server.js"]');
  });

  it('never disturbs the settings or the other servers already in the file', () => {
    const before = [
      'model = "gpt-5"',
      '',
      '[mcp_servers.outro]',
      'command = "python"',
      'args = ["outro.py"]',
      '',
      '[history]',
      'persistence = "save-all"',
      '',
    ].join('\n');
    const out = mergeMcpToml(before, 'node', ['server.js']);
    expect(out).toContain('model = "gpt-5"');
    expect(out).toContain('[mcp_servers.outro]');
    expect(out).toContain('command = "python"');
    expect(out).toContain('persistence = "save-all"');
    expect(out).toContain('[mcp_servers.cloudfact]');
  });

  it('replaces its own entry instead of piling up copies', () => {
    const once = mergeMcpToml('', 'node', ['old.js']);
    const twice = mergeMcpToml(once, 'node', ['new.js']);
    expect(twice.match(/\[mcp_servers\.cloudfact\]/g)).toHaveLength(1);
    expect(twice).toContain('args = ["new.js"]');
    expect(twice).not.toContain('old.js');
    const withNeighbour = mergeMcpToml(`${once}\n[mcp_servers.z]\ncommand = "z"\n`, 'node', ['newer.js']);
    expect(withNeighbour).toContain('[mcp_servers.z]');
    expect(withNeighbour).toContain('args = ["newer.js"]');
  });
});

describe('installing the skill into Codex', () => {
  let home: string;
  beforeEach(() => {
    home = tmpDir();
    process.env.CODEX_HOME = home;
  });
  afterEach(() => {
    delete process.env.CODEX_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('writes a real copy, because Windows does not hand out symlinks', async () => {
    const { setupCodex } = await import('../src/services/codex.js');
    const r = setupCodex();
    const skill = path.join(r.skillPath, 'SKILL.md');
    expect(fs.lstatSync(r.skillPath).isDirectory()).toBe(true);
    expect(fs.lstatSync(skill).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(skill, 'utf8')).not.toContain('argument-hint:');
  });
});
