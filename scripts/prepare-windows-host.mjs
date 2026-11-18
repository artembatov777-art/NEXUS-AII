import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Prepare the Windows x64 workspace host on Windows x64.');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const target = 'x86_64-pc-windows-msvc';
const targetDir = join(root, 'workspace-core', 'target');
execFileSync('cargo', [
  'build', '--locked', '--release', '--target', target, '--target-dir', targetDir,
  '--manifest-path', join(root, 'workspace-core', 'Cargo.toml'), '--bin', 'nexus-workspace'
], { cwd: root, stdio: 'inherit' });
const binary = join(targetDir, target, 'release', 'nexus-workspace.exe');
for (const destination of [
  join(root, 'src-tauri', 'binaries', `nexus-workspace-${target}.exe`),
  join(root, 'build-cli', 'bin', 'nexus-workspace.exe')
]) {
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(binary, destination);
}
