// Sets the version in every manifest at once: npm run bump 1.2.3
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  console.error('usage: npm run bump <semver>');
  process.exit(2);
}
const edit = (file, fn) => {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  fn(data);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
};
edit('package.json', (d) => (d.version = version));
edit('package-lock.json', (d) => {
  d.version = version;
  d.packages[''].version = version;
});
edit('server.json', (d) => {
  d.version = version;
  d.packages[0].version = version;
});
edit('.claude-plugin/plugin.json', (d) => (d.version = version));
edit('.claude-plugin/marketplace.json', (d) => (d.plugins[0].version = version));
// keep the manifests in the repo's prettier style so CI's format check stays green
spawnSync('npx', ['prettier', '--write', 'package.json', 'server.json', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json'], {
  stdio: 'ignore',
});
console.log(`version set to ${version} in package.json, package-lock.json, server.json and the plugin manifests`);
