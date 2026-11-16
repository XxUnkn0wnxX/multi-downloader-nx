import assert from 'node:assert/strict';
import fs from 'node:fs';
import output from 'node:console';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageMetadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const modulePath = path.join(root, 'modules/module.fork-display.ts');
const code = ts.transpileModule(fs.readFileSync(modulePath, 'utf8'), {
	compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(code, { module, exports: module.exports, console: output }, { filename: modulePath });
const { displayVersion, forkReleaseUrl } = module.exports;

assert.equal(typeof packageMetadata.version, 'string');
assert.equal(packageMetadata.fork.channel, 'Nightly');
assert.ok(Number.isSafeInteger(packageMetadata.fork.revision) && packageMetadata.fork.revision > 0);
assert.equal(displayVersion(packageMetadata), `${packageMetadata.version} (Nightly) [Rev${packageMetadata.fork.revision}]`);
assert.equal(displayVersion({ version: '5.8.8', fork: { channel: 'Nightly', revision: 3 } }), '5.8.8 (Nightly) [Rev3]');
assert.equal(displayVersion({ version: '5.8.8' }), '5.8.8');
for (const fork of [
	{ channel: '', revision: 3 },
	{ channel: 'Nightly', revision: 0 },
	{ channel: 'Nightly', revision: 1.5 },
	{ channel: 'Nightly', revision: Number.MAX_SAFE_INTEGER + 1 }
]) {
	assert.throws(() => displayVersion({ version: '5.8.8', fork }), /Invalid fork display metadata/);
}

assert.equal(forkReleaseUrl(packageMetadata.fork), 'https://github.com/XxUnkn0wnxX/multi-downloader-nx/releases/tag/nightly-fork');
for (const value of [undefined, null, 123, '', '.', '..']) {
	assert.throws(() => forkReleaseUrl({ ...packageMetadata.fork, releaseTag: value }), /Invalid fork release metadata/);
}
for (const value of [undefined, null, 123, '', './repo', 'owner/..', '/repo', 'owner/']) {
	assert.throws(() => forkReleaseUrl({ ...packageMetadata.fork, repository: value }), /Invalid fork release metadata/);
}
output.log('fork-display fixtures passed');
