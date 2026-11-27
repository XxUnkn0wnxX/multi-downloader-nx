import assert from 'node:assert/strict';
import process from 'node:process';
import output from 'node:console';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout, setInterval, clearInterval, setImmediate } from 'node:timers';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const { URL, URLSearchParams, AbortController, Headers, Response, TextEncoder, TextDecoder } = globalThis;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeRequire = createRequire(import.meta.url);
const transformed = new Map();
const quiet = { info() {}, warn() {}, error() {}, debug() {}, log() {} };

async function run(args, { exitCode = 1, page, defaults = '' } = {}) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anidl-status-import-'));
	const originalExitCode = process.exitCode;
	try {
		fs.mkdirSync(path.join(directory, 'config'));
		fs.writeFileSync(path.join(directory, 'config', 'dir-path.yml'), 'content: ${wdir}/must-not-create\n');
		fs.writeFileSync(path.join(directory, 'config', 'cli-defaults.yml'), defaults);
		const tokenPath = path.join(directory, 'config', 'cr_token.yml');
		const oldSession = 'auth_type: web\nrefresh_token: dummy-old-session\n';
		if (page) fs.writeFileSync(tokenPath, oldSession);
		const fakeProcess = Object.create(process);
		Object.defineProperty(fakeProcess, 'exitCode', { value: undefined, writable: true, enumerable: true, configurable: true });
		fakeProcess.env = { ...process.env, contentDirectory: directory, isGUI: 'false' };
		fakeProcess.argv = ['node', 'aniDL', ...args];
		const cache = new Map();
		const messages = [];
		const capture = (message) => messages.push(String(message));
		const logger = { ...quiet, info: capture, error: capture };
		let requests = 0;
		function load(filename) {
			if (cache.has(filename)) return cache.get(filename).exports;
			const module = { exports: {} };
			cache.set(filename, module);
			if (!transformed.has(filename))
				transformed.set(
					filename,
					ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
						compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, resolveJsonModule: true }
					}).outputText
				);
			const localRequire = (id) => {
				if (id === './log' || id === './modules/log') return { console: logger };
				if (id === 'undici')
					return {
						Agent: class {},
						ProxyAgent: class {},
						fetch: async () => {
							requests++;
							throw Error('unexpected network request');
						}
					};
				if (id.startsWith('.')) {
					const base = path.resolve(path.dirname(filename), id);
					if (base.endsWith('.json') && fs.existsSync(base)) return JSON.parse(fs.readFileSync(base, 'utf8'));
					if (fs.existsSync(`${base}.ts`)) return load(`${base}.ts`);
					if (fs.existsSync(`${base}.json`)) return JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
				}
				return nativeRequire(id);
			};
			vm.runInNewContext(
				transformed.get(filename),
				{
					module,
					exports: module.exports,
					require: localRequire,
					process: fakeProcess,
					__dirname: path.dirname(filename),
					__filename: filename,
					console: logger,
					Buffer,
					URL,
					URLSearchParams,
					AbortController,
					Headers,
					Response,
					setTimeout,
					clearTimeout,
					setInterval,
					clearInterval,
					performance,
					global: { ...globalThis, console: logger },
					TextEncoder,
					TextDecoder
				},
				{ filename }
			);
			return module.exports;
		}
		load(path.join(root, 'index.ts'));
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(fakeProcess.exitCode ?? 0, exitCode);
		assert.equal(process.exitCode, originalExitCode, 'the fixture must not mutate the real process exit code');
		assert.equal(requests, 0);
		assert.equal(fs.existsSync(path.join(directory, 'must-not-create')), false);
		assert.equal(fs.existsSync(path.join(directory, 'config', 'updates.json')), false);
		if (page) {
			assert.equal(fs.readFileSync(tokenPath, 'utf8'), oldSession);
			assert.match(messages.join('\n'), page);
			for (const file of ['crunchy.ts', 'adn.ts', 'hidive.ts', 'modules/module.updater.ts', 'modules/module.downloadArchive.ts']) {
				assert.equal(cache.has(path.join(root, file)), false, `unexpected import on a notice: ${file}`);
			}
		}
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
}

await run(['--service', 'crunchy', '--check-status']);
await run(['--service', 'crunchy', '--check-status', '--help']);
for (const args of [['--device'], ['--device', '--service=crunchy'], ['--service', 'crunchy', '--device']]) {
	await run(args, { exitCode: 0, page: /--service crunchy --device androidtv/ });
}
for (const args of [['--token'], ['--service=crunchy', '--token', '--debug']]) {
	await run(args, { exitCode: 0, page: /cookies\.txt/ });
}
await run(['--auth', '--service', 'crunchy'], { page: /--service crunchy --device android/ });
await run(['--auth'], { defaults: 'service: crunchy\n', page: /--service crunchy --device android/ });
await run(['--service', 'crunchy', '--device'], { defaults: 'token: fixture-cookie\n', exitCode: 0, page: /--device androidtv/ });
await run(['--service', 'crunchy', '--auth'], { defaults: 'username: fixture-name\npassword: fixture-password\n', page: /Used --auth/ });
await run(['--service', 'crunchy', '--device', 'bad-selector'], { page: /androidtv/ });
await run(['--service', 'crunchy', '--device', 'android', '--token'], { page: /only one/ });
output.log('Crunchy status checks and sign-in notices preserve saved sessions and avoid setup and requests');
