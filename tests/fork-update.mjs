import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import output from 'node:console';
import { setTimeout, clearTimeout } from 'node:timers';
const { AbortController, AbortSignal } = globalThis;

const require = createRequire(import.meta.url);
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const compileCode = (file) =>
	ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
const displayCode = compileCode('modules/module.fork-display.ts');
const updateCode = compileCode('modules/module.fork-update.ts');
const updaterCode = compileCode('modules/module.updater.ts');
function compile(code, dependencies, extra = {}) {
	const module = { exports: {} };
	vm.runInNewContext(code, {
		module,
		exports: module.exports,
		require: (id) => (id in dependencies ? dependencies[id] : require(id)),
		Buffer,
		process,
		AbortController,
		setTimeout,
		clearTimeout,
		...extra
	});
	return module.exports;
}
const display = compile(displayCode, {});
const sha = 'a'.repeat(40);
const assets = ['windows', 'macos', 'linux', 'alpine'].flatMap((platform) =>
	['x64', 'arm64'].flatMap((arch) => {
		const name = `multi-downloader-nx-${platform}-${arch}-cli.7z`;
		return [name, `${name}.sha256`].map((assetName) => ({ name: assetName, state: 'uploaded', size: 1 }));
	})
);
const sample = { version: '5.8.8', fork: { channel: 'Nightly', revision: 4, repository: manifest.fork.repository, releaseTag: manifest.fork.releaseTag } };
const installed = { ...sample, fork: { ...sample.fork, revision: 3 } };
const now = 1800000000000;
class FakeDate extends Date {
	static now() {
		return now;
	}
}
const release = { published_at: '2026-01-01T00:00:00Z', draft: false, tag_name: 'nightly-fork', target_commitish: sha, assets };
const content = (metadata) => ({ type: 'file', encoding: 'base64', content: Buffer.from(JSON.stringify(metadata)).toString('base64') });
function fixture(options = {}) {
	const calls = [],
		logs = [],
		writes = [],
		debugLogs = [],
		signals = [];
	let timers = 0,
		clears = 0;
	let saved = options.cache;
	let timeout;
	const disk = {
		readFileSync: () => {
			if (saved === undefined) throw Error('missing');
			return saved;
		},
		writeFileSync: (file, value) => {
			if (options.writeFail) throw Error('write failure');
			writes.push(file);
			saved = value;
		},
		renameSync: (from, to) => {
			writes.push([from, to]);
		},
		unlinkSync: () => {}
	};
	class Req {
		constructor(readOnly) {
			assert.equal(readOnly, true);
		}
		async getData(url, params) {
			calls.push(url);
			signals.push(params.signal);
			if (options.reject) throw Error('network failure');
			assert.equal(params.quietErrors, true);
			assert.equal(params.signal instanceof AbortSignal, true);
			if (options.failure)
				return {
					ok: false,
					res: {
						status: 429,
						body: {
							cancel: async () => {
								options.cancelled = true;
							}
						}
					}
				};
			const value = calls.length === 1 ? (options.release ?? release) : (options.content ?? content(options.latest ?? sample));
			return { ok: true, res: { text: options.stall === calls.length ? () => new Promise(() => {}) : async () => JSON.stringify(value) } };
		}
	}
	const helper = compile(
		updateCode,
		{
			fs: disk,
			path,
			'./module.cfg-loader': { workingDir: '/fixture' },
			'./log': { console: { info: (message) => logs.push(message), debug: (message) => debugLogs.push(message) } },
			'./module.app-args': { argvC: { debug: !!options.debug } },
			'./module.fetch': { Req },
			'./module.fork-display': display
		},
		{
			Date: FakeDate,
			setTimeout: (fn, ms) => {
				assert.equal(ms, 5000);
				timers++;
				timeout = fn;
				return 1;
			},
			clearTimeout: (id) => {
				assert.equal(id, 1);
				clears++;
			}
		}
	);
	return {
		...helper,
		calls,
		logs,
		writes,
		debugLogs,
		signals,
		get timers() {
			return timers;
		},
		get clears() {
			return clears;
		},
		fire: () => timeout(),
		get saved() {
			return saved;
		}
	};
}
const api = 'https://api.github.com/repos/XxUnkn0wnxX/multi-downloader-nx';
let f = fixture();
await f.checkForkUpdate(installed);
assert.deepEqual(f.calls, [`${api}/releases/tags/nightly-fork`, `${api}/contents/package.json?ref=${sha}`]);
assert.deepEqual(f.logs, [
	'Fork update available: 5.8.8 (Nightly) [Rev3] -> 5.8.8 (Nightly) [Rev4]\n\tDownload updates: https://github.com/XxUnkn0wnxX/multi-downloader-nx/releases/tag/nightly-fork'
]);
assert.equal(f.timers, 1);
assert.equal(f.clears, 1);
assert.equal(f.signals[0], f.signals[1]);
assert.equal(f.signals[0].aborted, true);
assert.match(f.writes[0], /updates\.json\..+\.tmp$/);
const cached = f.saved;
f = fixture({ cache: cached });
await f.checkForkUpdate(installed);
assert.equal(f.calls.length, 0);
assert.equal(f.logs.length, 1);
for (const cache of [
	'bad',
	JSON.stringify({ lastCheck: now }),
	JSON.stringify({ fork: { ...JSON.parse(cached).fork, checkedAt: now + 10000 } }),
	JSON.stringify({ fork: { ...JSON.parse(cached).fork, installedRevision: 2 } }),
	JSON.stringify({ fork: { ...JSON.parse(cached).fork, repository: 'other/repo' } }),
	JSON.stringify({ fork: { ...JSON.parse(cached).fork, releaseTag: 'other' } }),
	JSON.stringify({ fork: { ...JSON.parse(cached).fork, checkedAt: now - 86400000 } })
]) {
	f = fixture({ cache });
	await f.checkForkUpdate(installed);
	assert.equal(f.calls.length, 2);
}
f = fixture({ cache: JSON.stringify({ legacy: 42 }), writeFail: true });
await f.checkForkUpdate(installed);
assert.equal(f.logs.length, 1);
f = fixture({ cache: JSON.stringify({ legacy: 42 }) });
await f.checkForkUpdate(installed);
assert.equal(JSON.parse(f.saved).legacy, 42);
for (const bad of [
	{ ...release, draft: true },
	{ ...release, published_at: null },
	{ ...release, tag_name: 'other' },
	{ ...release, target_commitish: 'main' },
	{ ...release, assets: assets.slice(1) },
	{ ...release, assets: assets.map((a, i) => (i ? a : { ...a, size: 0 })) }
]) {
	f = fixture({ release: bad });
	await f.checkForkUpdate(installed);
	assert.equal(f.calls.length, 1);
	assert.equal(f.logs.length, 0);
	assert.equal(f.writes.length, 0);
}
for (const bad of [{ type: 'file', encoding: 'base64', content: '???' }, content({ ...sample, version: 'bad' }), content({ ...sample, fork: null })]) {
	f = fixture({ content: bad });
	await f.checkForkUpdate(installed);
	assert.equal(f.logs.length, 0);
	assert.equal(f.writes.length, 0);
}
for (const [version, revision, expected] of [
	['5.8.8', 3, 0],
	['5.8.0', 24, 0],
	['5.8.9', 3, 1],
	['5.8.9', 1, 1],
	['5.8.8+build', 4, 1],
	['5.8.8-rc.1', 99, 0]
]) {
	f = fixture({ latest: { ...sample, version, fork: { ...sample.fork, revision } } });
	await f.checkForkUpdate(installed);
	assert.equal(f.logs.length, expected);
}
f = fixture();
for (const [a, b, expected] of [
	['1.0.0-alpha', '1.0.0-alpha.1', -1],
	['1.0.0-alpha.1', '1.0.0-alpha.beta', -1],
	['1.0.0-rc.1', '1.0.0', -1],
	['1.0.0+one', '1.0.0+two', 0],
	['1.0.0-10', '1.0.0-2', 1]
])
	assert.equal(f.compareVersions(a, b), expected);
for (const stall of [1, 2]) {
	f = fixture({ stall, fakeTimer: true });
	const pending = f.checkForkUpdate(installed);
	for (let i = 0; i < 10; i++) await Promise.resolve();
	f.fire();
	await pending;
	assert.equal(f.logs.length, 0);
	assert.equal(f.writes.length, 0);
	assert.equal(f.timers, 1);
	assert.equal(f.clears, 1);
	assert.equal(f.signals[0].aborted, true);
	if (stall === 2) assert.equal(f.signals[0], f.signals[1]);
}
const fail = { failure: true };
f = fixture(fail);
await f.checkForkUpdate(installed);
assert.equal(fail.cancelled, true);
assert.equal(f.writes.length, 0);
for (const fork of [
	null,
	{},
	{ ...installed.fork, revision: 0 },
	...[undefined, null, 123, '', '.', '..'].map((releaseTag) => ({ ...installed.fork, releaseTag })),
	...[undefined, null, 123, '', './repo', 'owner/..', '/repo', 'owner/'].map((repository) => ({ ...installed.fork, repository }))
]) {
	f = fixture();
	await f.checkForkUpdate({ ...installed, fork });
	assert.equal(f.calls.length, 0);
}
f = fixture({ reject: true, debug: true });
await f.checkForkUpdate(installed);
assert.equal(f.logs.length, 0);
assert.deepEqual(f.debugLogs, ['[DEBUG] Fork update: metadata lookup failed']);
assert.equal(f.writes.length, 0);
f = fixture({ failure: true, debug: true });
await f.checkForkUpdate(installed);
assert.deepEqual(f.debugLogs, ['[DEBUG] Fork update: metadata lookup failed']);
f = fixture({ debug: true, writeFail: true });
await f.checkForkUpdate(installed);
assert.equal(f.logs.length, 1);
assert.deepEqual(f.debugLogs, ['[DEBUG] Fork update: could not persist cache']);
f = fixture({ debug: true });
await f.checkForkUpdate({ ...installed, fork: null });
assert.deepEqual(f.debugLogs, ['[DEBUG] Fork update: invalid installed metadata']);
// Exercise the actual upstream wrapper: a fork field always returns before the packaged guard and legacy path.
for (const fork of [null, {}, installed.fork])
	for (const mode of ['source', 'pkg', 'contentDirectory']) {
		let routed = 0;
		const proc = { env: mode === 'contentDirectory' ? { contentDirectory: 'yes' } : {}, ...(mode === 'pkg' ? { pkg: {} } : {}) };
		const updater = compile(
			updaterCode,
			{
				'../package.json': { ...installed, fork },
				'./module.fork-update': {
					checkForkUpdate: async () => {
						routed++;
						throw Error('failure');
					}
				},
				'./module.cfg-loader': { workingDir: '/fixture' },
				'./log': { console: {} },
				'./module.helper': {},
				'./module.fetch': {
					Req: class {
						constructor() {
							throw Error('legacy request');
						}
					}
				}
			},
			{ process: proc }
		);
		await updater.default();
		assert.equal(routed, 1);
	}
// The wrapper reaches the real notice helper in both source and packaged modes.
for (const mode of ['source', 'pkg', 'contentDirectory']) {
	f = fixture();
	const proc = { env: mode === 'contentDirectory' ? { contentDirectory: 'yes' } : {}, ...(mode === 'pkg' ? { pkg: {} } : {}) };
	const actual = compile(
		updaterCode,
		{
			'../package.json': installed,
			'./module.fork-update': f,
			'./module.cfg-loader': { workingDir: '/fixture' },
			'./log': { console: {} },
			'./module.helper': {},
			'./module.fetch': {
				Req: class {
					constructor() {
						throw Error('legacy request');
					}
				}
			}
		},
		{ process: proc }
	);
	await actual.default();
	assert.equal(f.calls.length, 2);
	assert.equal(f.logs.length, 1);
}
let legacyRequests = 0,
	legacyWrites = 0;
const sourceUpdater = compile(
	updaterCode,
	{
		'../package.json': { version: '1.0.0' },
		'./module.fork-update': {
			checkForkUpdate: () => {
				throw Error('fork route');
			}
		},
		'./module.cfg-loader': { workingDir: '/fixture' },
		'./log': { console: { info: () => {} } },
		'./module.helper': {},
		fs: {
			existsSync: () => false,
			writeFileSync: () => {
				legacyWrites++;
			}
		},
		'./module.fetch': {
			Req: class {
				async getData(url) {
					legacyRequests++;
					assert.equal(url, 'https://api.github.com/repos/anidl/multi-downloader-nx/tags');
					return { ok: false };
				}
			}
		}
	},
	{ process: { env: {} } }
);
await sourceUpdater.default();
assert.equal(legacyRequests, 1);
assert.equal(legacyWrites, 1);
const updater = compile(
	updaterCode,
	{
		'../package.json': { version: '1.0.0' },
		'./module.fork-update': {
			checkForkUpdate: () => {
				throw Error('fork route');
			}
		},
		'./module.cfg-loader': { workingDir: '/fixture' },
		'./log': { console: {} },
		'./module.helper': {},
		'./module.fetch': {}
	},
	{ process: { env: {}, pkg: {} } }
);
await updater.default();
output.log('fork update fixtures passed');
