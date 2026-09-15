import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Cria um diretório temporário e devolve o caminho; o chamador remove. */
export function tmpDir(prefix = 'cloudfact-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeSite(root: string): void {
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>home</h1>');
  fs.writeFileSync(path.join(root, 'sub', 'index.html'), '<p>sub</p>');
  fs.writeFileSync(path.join(root, '.secret'), 'nope');
  fs.writeFileSync(path.join(root, 'style.css'), 'body{}');
}
