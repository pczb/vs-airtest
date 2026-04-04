import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, spawnSync } from 'child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const vsixName = `${packageJson.name}-${packageJson.version}.vsix`;
const vsixPath = path.join(rootDir, vsixName);

console.log('Building extension bundle...');
execFileSync('npm', ['run', 'package'], {
    cwd: rootDir,
    stdio: 'inherit'
});

console.log('Packaging fresh VSIX...');
execFileSync('npx', ['@vscode/vsce', 'package'], {
    cwd: rootDir,
    stdio: 'inherit'
});

if (!fs.existsSync(vsixPath)) {
    console.error(`VSIX not found: ${vsixPath}`);
    process.exit(1);
}

const codeBin = findCodeBinary();
if (!codeBin) {
    console.log(`Built ${vsixName}, but could not find the VS Code CLI.`);
    console.log('Install the "code" command in your PATH, then run:');
    console.log(`  code --install-extension ${vsixPath}`);
    process.exit(0);
}

console.log(`Installing ${vsixName} into VS Code...`);
const install = spawnSync(codeBin, ['--install-extension', vsixPath, '--force'], {
    cwd: rootDir,
    stdio: 'inherit'
});

if (install.status !== 0) {
    process.exit(install.status ?? 1);
}

console.log('Extension installed successfully.');

function findCodeBinary() {
    const candidates = ['code', 'code-insiders'];
    for (const candidate of candidates) {
        const probe = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
        if (!probe.error && probe.status === 0) {
            return candidate;
        }
    }
    return null;
}
