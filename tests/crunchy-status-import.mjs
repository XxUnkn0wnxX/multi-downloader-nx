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

async function run(args, { exitCode = 1, page, exactMessage, defaults = '', archiveData, allowArchiveReader = false } = {}) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anidl-status-import-'));
	const originalExitCode = process.exitCode;
	const originalStdoutWrite = process.stdout.write;
	let exitFailure;
	const exitTrap = (error) => {
		exitFailure = error;
	};
	try {
		fs.mkdirSync(path.join(directory, 'config'));
		fs.writeFileSync(path.join(directory, 'config', 'dir-path.yml'), 'content: ${wdir}/must-not-create\n');
		fs.writeFileSync(path.join(directory, 'config', 'cli-defaults.yml'), defaults);
		const archivePath = path.join(directory, 'config', 'archive.json');
		if (archiveData !== undefined) fs.writeFileSync(archivePath, JSON.stringify(archiveData, null, 4));
		const originalArchive = fs.existsSync(archivePath) ? fs.readFileSync(archivePath, 'utf8') : undefined;
		const tokenPath = path.join(directory, 'config', 'cr_token.yml');
		const oldSession = 'auth_type: web\nrefresh_token: dummy-old-session\n';
		if (page || exactMessage) fs.writeFileSync(tokenPath, oldSession);
		const otherAccountFiles = ['hd_token.yml', 'adn_token.yml', 'cr_sess.yml', 'hd_sess.yml', 'adn_sess.yml'];
		if (allowArchiveReader) for (const file of otherAccountFiles) fs.writeFileSync(path.join(directory, 'config', file), `fixture-${file}\n`);
		const originalOtherAccounts = allowArchiveReader ? otherAccountFiles.map((file) => fs.readFileSync(path.join(directory, 'config', file), 'utf8')) : [];
		const fakeProcess = Object.create(process);
		Object.defineProperty(fakeProcess, 'exitCode', { value: undefined, writable: true, enumerable: true, configurable: true });
		fakeProcess.exit = (code) => {
			fakeProcess.exitCode = code;
			throw Error(`fixture exit ${code}`);
		};
		fakeProcess.env = { ...process.env, contentDirectory: directory, isGUI: 'false' };
		fakeProcess.argv = ['node', 'aniDL', ...args];
		const cache = new Map();
		const messages = [];
		const capture = (message) => messages.push(String(message));
		process.stdout.write = (message) => (capture(message), true);
		const logger = { ...quiet, info: capture, error: capture, log: capture };
		process.on('unhandledRejection', exitTrap);
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
		if (exitFailure) assert.equal(exitFailure.message, `fixture exit ${exitCode}`);
		assert.equal(process.exitCode, originalExitCode, 'the fixture must not mutate the real process exit code');
		assert.equal(requests, 0);
		assert.equal(fs.existsSync(path.join(directory, 'must-not-create')), false);
		assert.equal(fs.existsSync(path.join(directory, 'config', 'updates.json')), false);
		assert.equal(fs.existsSync(archivePath) ? fs.readFileSync(archivePath, 'utf8') : undefined, originalArchive, 'CLI notice leaves archive data untouched');
		if (page || exactMessage) {
			assert.equal(fs.readFileSync(tokenPath, 'utf8'), oldSession);
			if (allowArchiveReader)
				assert.deepEqual(
					otherAccountFiles.map((file) => fs.readFileSync(path.join(directory, 'config', file), 'utf8')),
					originalOtherAccounts,
					'archive notice leaves all other account files untouched'
				);
			if (page) assert.match(messages.join('\n'), page);
			if (exactMessage) assert.equal(messages.join('\n'), exactMessage);
			for (const file of ['crunchy.ts', 'adn.ts', 'hidive.ts', 'modules/module.updater.ts', 'modules/module.downloadArchive.ts']) {
				if (allowArchiveReader && file === 'modules/module.downloadArchive.ts') continue;
				assert.equal(cache.has(path.join(root, file)), false, `unexpected import on a notice: ${file}`);
			}
		}
	} finally {
		process.off('unhandledRejection', exitTrap);
		process.stdout.write = originalStdoutWrite;
		fs.rmSync(directory, { recursive: true, force: true });
	}
}

await run(['--service', 'crunchy', '--check-status']);
// No arguments and a help flag alone always show general help, regardless of saved defaults.
await run([], { exitCode: 0, page: /Usage:/ });
await run([], { exitCode: 0, page: /Usage:/, defaults: 'service: crunchy\n' });
for (const args of [['-h'], ['--help'], ['-help']]) await run(args, { exitCode: 0, page: /Usage:/, defaults: 'service: crunchy\n' });
for (const args of [['--debug'], ['-debug']])
	await run(args, { exitCode: 0, page: /AniDL[\s\S]*Node v?[\d.]+[\s\S]*To debug a service command, put --service first and add --debug/ });
for (const args of [
	['--help', '--debug'],
	['--debug', '--help'],
	['-h', '--debug'],
	['--debug', '-h'],
	['-help', '--debug']
])
	await run(args, { exitCode: 0, page: /Usage:[\s\S]*AniDL[\s\S]*Node v?[\d.]+[\s\S]*To debug a service command/ });
const serviceFirstHelpError = /Choose a service first\. Use --service with exactly one name \(crunchy, hidive, adn\)\.[\s\S]*--service crunchy --help/;
await run(['--auth'], { exactMessage: 'Choose a service first. Use --service with exactly one name (crunchy, hidive, adn).' });
for (const args of [
	['--debug', '--auth'],
	['--debug', '--service', 'crunchy'],
	['--help', '--auth']
])
	await run(args, { page: serviceFirstHelpError });
await run(['--device'], { exactMessage: 'Choose a service first. Use --service with exactly one name (crunchy, hidive, adn). For example:\n  anidl --service crunchy --device' });
await run(['--token'], { exactMessage: 'Choose a service first. Use --service with exactly one name (crunchy, hidive, adn). For example:\n  anidl --service crunchy --token' });
for (const args of [
	['--help', '--token'],
	['--token', '--help'],
	['--debug', '--token']
])
	await run(args, { page: serviceFirstHelpError });

// Every non-empty invocation needs an explicit supported service at the front.
for (const args of [
	['--version'],
	['-v'],
	['--dry-run'],
	['--device'],
	['--token', '--service', 'crunchy'],
	['--token=--service=crunchy'],
	['--', '--service', 'crunchy'],
	['--help', '--service', 'crunchy'],
	['--dry-run', '--service', 'crunchy'],
	['--service', 'unknown', '--help'],
	['--service'],
	['--service=unknown', '--dry-run']
])
	await run(args, { page: /Choose a service first[\s\S]*--service crunchy/ });

// Explicit provider-only arguments fail at the real CLI boundary before provider imports, requests or writes.
for (const [args, error] of [
	[['--service', 'hidive', '--qall'], /--qall is unavailable with --service hidive[\s\S]*Use --service crunchy/],
	[['--service', 'adn', '--tsd'], /--tsd is unavailable with --service adn[\s\S]*Use --service crunchy/],
	[['--service', 'crunchy', '--combineLines'], /--combineLines is unavailable with --service crunchy[\s\S]*Use --service hidive/],
	[['--service', 'adn', '--series', '12345'], /--series is unavailable with --service adn[\s\S]*Use --service crunchy or --service hidive/]
]) {
	await run(args, { page: error });
}

for (const [service, label, foreignArchive] of [
	['crunchy', 'Crunchyroll', { hidive: { s: [{ id: 'foreign', already: [] }] } }],
	['hidive', 'HIDIVE', { crunchy: { s: [{ id: 'foreign', already: [] }], srz: [] } }],
	['adn', 'ADN', { hidive: { s: [{ id: 'foreign', already: [] }] } }]
]) {
	const notice = new RegExp(`No archived entries for ${label}\\.`);
	await run(['--service', service, '--downloadArchive'], { exitCode: 0, page: notice, allowArchiveReader: true });
	await run(['--service', service, '--downloadArchive'], { exitCode: 0, page: notice, archiveData: foreignArchive, allowArchiveReader: true });
}

await run(['--service', 'crunchy', '--check-status', '--help']);
for (const args of [
	['--service', 'crunchy', '--device'],
	['--service=crunchy', '--device']
]) {
	await run(args, { exitCode: 0, page: /--device androidtv/ });
}
for (const args of [
	['--service', 'crunchy', '--token'],
	['--service=crunchy', '--token', '--debug']
]) {
	await run(args, { exitCode: 0, page: /cookies\.txt/ });
}
await run(['--service', 'crunchy', '--auth'], {
	page: /HIDIVE and ADN still use --auth with a username or email and password\.[\s\S]*Run the same command again[\s\S]*--device android/
});
await run(['--auth'], { defaults: 'service: crunchy\n', page: /Choose a service first/ });
await run(['--service', 'crunchy', '--device'], { defaults: 'token: fixture-cookie\n', exitCode: 0, page: /--device androidtv/ });
const invalidTokenDefaults = 'token: 1234\n';
await run(['--service', 'crunchy', '-e', 'FIXTURE01'], { defaults: invalidTokenDefaults, page: /Invalid token in CLI defaults/ });
await run(['--service', 'crunchy', '--token'], { defaults: invalidTokenDefaults, exitCode: 0, page: /Cookies file/ });
await run(['--service', 'crunchy', '--device'], { defaults: invalidTokenDefaults, exitCode: 0, page: /--device androidtv/ });
await run(['--service', 'crunchy', '--auth'], { defaults: 'username: fixture-name\npassword: fixture-password\n', page: /Used --auth/ });
await run(['--service', 'crunchy', '--device', 'bad-selector'], { page: /androidtv/ });
await run(['--service', 'crunchy', '--device', 'android', '--token'], { page: /only one/ });
for (const authFlag of ['--device', '--token']) {
	await run(['--service', 'crunchy', authFlag, '--dry-run', '--addArchive', '-s', 'FIXTURE01'], {
		exactMessage: '--dry-run cannot be combined with --update or --addArchive.'
	});
}
output.log('Crunchy status checks and sign-in notices preserve saved sessions and avoid setup and requests');
