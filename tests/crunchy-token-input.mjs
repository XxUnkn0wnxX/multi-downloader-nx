import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import output from 'node:console';
import process from 'node:process';
import { fileURLToPath, URLSearchParams, URL } from 'node:url';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import ts from 'typescript';

const { AbortController, AbortSignal, Response, setTimeout, clearTimeout, setInterval, clearInterval, atob } = globalThis;
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'anidl-token-input-'));
try {
	const fakeToken = '123e4567-e89b-12d3-a456-426614174000';
	const generatedDeviceId = '123e4567-e89b-12d3-a456-42661412cdef';
	let passed = 0;
	async function test(name, run) {
		await run();
		passed++;
		output.log(`ok ${passed} - ${name}`);
	}
	function compile(file, requireFn, extra = {}) {
		const source = fs.readFileSync(file, 'utf8');
		const code = ts.transpileModule(source, {
			compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
		}).outputText;
		const exports = {};
		const module = { exports };
		vm.runInNewContext(
			code,
			{
				exports,
				module,
				require: requireFn,
				process,
				console: output,
				URL,
				URLSearchParams,
				Error,
				AbortController,
				setTimeout,
				clearTimeout,
				setInterval,
				clearInterval,
				atob,
				...extra
			},
			{ filename: file }
		);
		return module.exports;
	}
	const realHelper = compile(path.join(root, 'modules/module.crunchy-token.ts'), (id) => require(id));
	const { parseCrunchyTokenInput } = realHelper;
	const cliAuthRuntime = {
		argv: ['node', path.join(root, 'index.ts'), '--service', 'crunchy'],
		cwd: () => root,
		platform: process.platform,
		env: { ...process.env, isGUI: 'false' }
	};
	const cliAuth = compile(path.join(root, 'modules/module.crunchy-cli-auth.ts'), (id) => require(id), { process: cliAuthRuntime });
	const requireDeviceDeps = (id) => (id === './module.crunchy-cli-auth' ? cliAuth : require(id));
	const deviceHelper = compile(path.join(root, 'modules/module.crunchy-device-auth.ts'), requireDeviceDeps);
	const sessionStore = compile(path.join(root, 'modules/module.crunchy-session-store.ts'), (id) => require(id));
	const phoneAuth = compile(path.join(root, 'modules/module.crunchy-phone-auth.ts'), (id) => {
		if (id === './module.api-urls') return { domain: { cr_www: 'https://www.crunchyroll.com' } };
		if (id === './module.cfg-loader') return { workingDir: work };
		if (id === './module.crunchy-device-auth') return deviceHelper;
		return require(id);
	});
	const crunchyPhoneAuth = { loginWithPhone: async () => undefined, PHONE_CALLBACK_INVALID: phoneAuth.PHONE_CALLBACK_INVALID };
	const forkDisplay = compile(path.join(root, 'modules/module.fork-display.ts'), (id) => require(id));
	const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
	const sourceError = (input, source, fragment) => {
		try {
			parseCrunchyTokenInput(input);
		} catch (error) {
			assert.equal(error.source, source);
			assert.match(error.message, fragment);
			assert(!error.message.includes(fakeToken));
			return;
		}
		assert.fail('expected token input to fail');
	};
	const rawPath = path.join(work, 'raw token no extension');
	const netscapePath = path.join(work, 'cookies export.anything');
	const unrelatedPath = path.join(work, 'unrelated');
	const malformedPath = path.join(work, 'malformed');
	const conflictPath = path.join(work, 'conflict');
	fs.writeFileSync(rawPath, ` \r\n${fakeToken}\t\r\n`);
	fs.writeFileSync(netscapePath, `# Netscape HTTP Cookie File\r\n#HttpOnly_.crunchyroll.com\tTRUE\t/\tTRUE\t0\tetp_rt\t${fakeToken}\r\n`);
	fs.writeFileSync(unrelatedPath, `.crunchyroll.com\tTRUE\t/\tTRUE\t0\tother\t${fakeToken}\n.evilcrunchyroll.com\tTRUE\t/\tTRUE\t0\tetp_rt\t${fakeToken}\n`);
	fs.writeFileSync(malformedPath, `.crunchyroll.com\tTRUE\t/\tTRUE\t0\tetp_rt\tbad-value\n`);
	fs.writeFileSync(
		conflictPath,
		`.crunchyroll.com\tTRUE\t/\tTRUE\t0\tetp_rt\t${fakeToken}\n.www.crunchyroll.com\tTRUE\t/\tTRUE\t0\tetp_rt\t123e4567-e89b-12d3-a456-426614174001\n`
	);

	await test('accepts direct UUID and optional case-insensitive etp_rt prefix', () => {
		same(parseCrunchyTokenInput(fakeToken), { refreshToken: fakeToken, source: 'direct token' });
		same(parseCrunchyTokenInput(` ETp_RT=${fakeToken} `), { refreshToken: fakeToken, source: 'direct token' });
	});
	await test('accepts raw token in a spaced, extensionless file path', () => {
		same(parseCrunchyTokenInput(rawPath), { refreshToken: fakeToken, source: 'cookies file' });
	});
	await test('accepts Netscape etp_rt row with HttpOnly marker, subdomain, and CRLF', () => {
		same(parseCrunchyTokenInput(netscapePath), { refreshToken: fakeToken, source: 'cookies file' });
	});
	await test('reports malformed direct input without echoing it', () => sourceError('etp_rt=not-a-token', 'direct token', /Invalid etp_rt/));
	await test('reports empty direct input without echoing it', () => sourceError('', 'token input', /Expected a UUID-shaped/));
	await test('reports unresolved input without guessing whether it was a token or file', () => {
		for (const input of [path.join(work, 'missing.txt'), path.join(work, 'cookies'), 'not.a.token']) {
			sourceError(input, 'token input', /Expected a UUID-shaped.*existing readable cookies file/);
		}
	});
	await test('rejects unrelated cookies and unrelated host suffixes', () => sourceError(unrelatedPath, 'cookies file', /no valid/));
	await test('reports malformed matching cookie value', () => sourceError(malformedPath, 'cookies file', /malformed cookie rows/));
	await test('rejects conflicting matching etp_rt rows', () => sourceError(conflictPath, 'cookies file', /conflicting/));

	const logs = [];
	const fakeConsole = Object.fromEntries(['info', 'warn', 'error', 'debug'].map((method) => [method, (...args) => logs.push([method, args.map(String).join(' ')])]));
	const api = { auth: 'auth', profile: 'profile', cms_auth: 'cms', crunchyWebAuthHeader: {}, crunchyDefHeader: {} };
	const saved = [];
	const openedActivationUrls = [];
	let helperPrompts = 0;
	let loadBinCalls = 0;
	let parsedArgv = {};
	const stubs = {
		open: {
			__esModule: true,
			default: async (url) => {
				openedActivationUrls.push(url);
				throw new Error('browser unavailable');
			}
		},
		'./package.json': { version: 'test' },
		'./modules/log': { console: fakeConsole },
		'./modules/module.api-urls': {
			domain: { cr_www: 'https://www.crunchyroll.com', cr_api: 'https://beta-api.crunchyroll.com', cr_playback: 'https://cr-play-service.prd.crunchyrollsvc.com' },
			api
		},
		'./modules/module.cfg-loader': {
			saveCRToken: (token) => saved.push(token),
			saveCRTokenAtomic: (token) => {
				saved.push(token);
				return true;
			},
			loadCRSessions: () => ({ sessions: {} }),
			withCRTokenRefreshLock: (_slot, fn) => fn(),
			loadCfg: () => ({ cli: {} }),
			loadBinCfg: async () => {
				loadBinCalls++;
				return {};
			}
		},
		'./modules/module.app-args': { appArgv: () => parsedArgv },
		'./modules/module.helper': { default: { question: async () => (helperPrompts++, 'prompt input') }, __esModule: true },
		'./modules/module.crunchy-token': realHelper,
		'./modules/module.crunchy-cli-auth': cliAuth,
		'./modules/module.crunchy-device-auth': deviceHelper,
		'./modules/module.crunchy-session-store': sessionStore,
		'./modules/module.crunchy-phone-auth': crunchyPhoneAuth,
		'./@types/enums': compile(path.join(root, '@types/enums.ts'), (id) => require(id)),
		'./modules/module.fork-display': forkDisplay,
		'./modules/module.working-indicator': {
			WorkingIndicator: class {
				start() {}
				stop() {}
				phase() {}
				waiting() {}
				slot() {}
			}
		},
		'./modules/module.crunchy-discovery-scheduler': {
			DiscoveryScheduler: class {
				async dispatch() {}
				remaining() {
					return 90000;
				}
			}
		},
		'./modules/module.crunchy-playback-recovery': { PlaybackRefusal: class extends Error {} },
		'./modules/module.crunchy-playback-status': { accountBinding: () => undefined, observePlaybackWait() {}, readPlaybackWait() {} },
		'./modules/module.crunchy-video-selection': { boundedRequest: async (operation) => operation(new AbortController().signal) },
		'node:crypto': { randomUUID: () => generatedDeviceId }
	};
	const ignoredImports = new Set([
		'./modules/hls-download',
		'./modules/module.helper',
		'm3u8-parser',
		'./modules/module.fontsData',
		'./modules/module.langsData',
		'./modules/module.merger',
		'./modules/cdm',
		'./modules/module.fetch',
		'./modules/module.filename',
		'./modules/module.downloadArchive',
		'./modules/module.parseSelect',
		'./modules/module.args',
		'./modules/module.transform-mpd',
		'./modules/module.crunchy-manifests',
		'./modules/module.crunchy-video-catalog',
		'./modules/module.crunchy-video-selection',
		'./modules/module.crunchy-playback-recovery',
		'./modules/module.crunchy-discovery-scheduler',
		'./modules/module.working-indicator',
		'./modules/module.vtt2ass'
	]);
	function requireCrunchy(id) {
		if (id === 'path' || id === 'fs' || id === 'node:crypto') return id === 'node:crypto' ? stubs[id] : require(id);
		if (Object.hasOwn(stubs, id)) return stubs[id];
		if (ignoredImports.has(id)) return {};
		throw new Error(`Unexpected import ${id}`);
	}
	const { default: Crunchy } = compile(path.join(root, 'crunchy.ts'), requireCrunchy);
	function makeService(responses, existingCms) {
		const service = Object.create(Crunchy.prototype);
		service.token = {};
		service.cmsToken = existingCms ?? {};
		service.cfg = { cli: {} };
		service.locale = 'en-US';
		const calls = [];
		service.req = {
			getData: async (url, options) => {
				calls.push({ url, options });
				return responses[url] ?? { ok: false, res: undefined };
			}
		};
		return { service, calls };
	}
	const jsonResponse = (value) => ({ ok: true, res: { json: async () => value } });
	const successfulResponses = {
		auth: jsonResponse({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600 }),
		profile: jsonResponse({ username: 'test-user', email: 'test@example.invalid' }),
		cms: jsonResponse({ cms: { bucket: '/US/index', policy: 'p', signature: 's', key_pair_id: 'k' } })
	};

	await test('actual loginWithToken sends normalized direct etp_rt and reports success', async () => {
		logs.length = 0;
		const { service, calls } = makeService(successfulResponses);
		assert.equal(await service.loginWithToken(`etp_rt=${fakeToken}`), true);
		assert.equal(calls[0].url, 'auth');
		assert.match(calls[0].options.headers.Cookie, new RegExp(`etp_rt=${fakeToken}`));
		assert.equal(calls[1].url, 'profile');
		assert.equal(calls[2].url, 'cms');
		assert(logs.some(([kind, line]) => kind === 'info' && /signed in with a Crunchyroll browser cookie/i.test(line) && /session saved/i.test(line)));
		assert(!logs.some(([, line]) => line.includes(fakeToken)));
	});
	await test('actual loginWithToken accepts file input and reports source', async () => {
		logs.length = 0;
		const { service, calls } = makeService(successfulResponses);
		assert.equal(await service.loginWithToken(netscapePath), true);
		assert.match(calls[0].options.headers.Cookie, new RegExp(`etp_rt=${fakeToken}`));
		assert(
			logs.some(([kind, line]) => kind === 'info' && /signed in with a Crunchyroll browser cookie/i.test(line) && /cookies file/i.test(line) && /session saved/i.test(line))
		);
	});
	await test('actual loginWithToken fails without profile success', async () => {
		logs.length = 0;
		const responses = { ...successfulResponses, profile: { ok: false } };
		const { service, calls } = makeService(responses);
		assert.equal(await service.loginWithToken(fakeToken), false);
		assert(!calls.some(({ url }) => url === 'cms'));
		assert(logs.some(([kind, line]) => kind === 'error' && line.includes('profile lookup failed')));
		assert(!logs.some(([, line]) => line.includes('succeeded')));
	});
	await test('actual loginWithToken fetches fresh CMS despite cached CMS and fails on CMS error', async () => {
		logs.length = 0;
		const responses = { ...successfulResponses, cms: { ok: false } };
		const { service, calls } = makeService(responses, { cms: { expires: new Date(Date.now() + 3600000).toISOString(), bucket: '/old' } });
		assert.equal(await service.loginWithToken(fakeToken), false);
		assert(calls.some(({ url }) => url === 'cms'));
		assert(logs.some(([kind, line]) => kind === 'error' && line.includes('CMS authentication failed')));
		assert(!logs.some(([, line]) => line.includes('succeeded')));
	});
	await test('actual loginWithToken labels request failure and never logs the input value', async () => {
		logs.length = 0;
		const { service } = makeService({ auth: { ok: false, res: undefined } });
		assert.equal(await service.loginWithToken(fakeToken), false);
		assert(logs.some(([kind, line]) => kind === 'error' && line.includes('direct token')));
		assert(!logs.some(([, line]) => line.includes(fakeToken)));
		assert(!logs.some(([, line]) => line.includes('succeeded')));
	});
	await test('Crunchyroll CLI decision handles deprecated auth, optional help, and malformed/conflicting input', () => {
		const cases = [
			[{ service: 'crunchy', auth: true }, 'error', /now uses --device or --token/],
			[{ service: 'crunchy', device: true }, 'notice', /Android TV[\s\S]*--device androidtv[\s\S]*Android phone or tablet[\s\S]*--device android/],
			[{ service: 'crunchy', device: '' }, 'error', /Missing --device value/],
			[{ service: 'crunchy', token: '' }, 'error', /Missing --token value/],
			[{ service: 'crunchy', device: true, token: true }, 'error', /Choose only one/],
			[{ service: 'crunchy', auth: true, device: 'androidtv' }, 'error', /Choose only one/],
			[{ service: 'hidive', auth: true }, 'continue', undefined],
			[{ service: 'adn', auth: true }, 'continue', undefined],
			[{ service: 'hidive', device: true, crunchyAuthExplicit: true }, 'error', /only supported for Crunchyroll/]
		];
		for (const [argv, kind, message] of cases) {
			const decision = cliAuth.crunchyCliAuthDecision(argv);
			assert.equal(decision.kind, kind, JSON.stringify(argv));
			if (message) assert.match(decision.message, message);
		}
	});
	await test('actual Crunchyroll CLI rejects legacy credential options before prompts or side effects', async () => {
		for (const argv of [{ username: 'legacy-user' }, { password: 'legacy-secret' }, { username: '' }, { password: '' }, { silentAuth: true }]) {
			logs.length = 0;
			parsedArgv = argv;
			process.exitCode = undefined;
			const promptCount = helperPrompts;
			const binLoadCount = loadBinCalls;
			const saveCount = saved.length;
			let authCalls = 0;
			const { service, calls } = makeService({});
			service.doAuth = async () => authCalls++;
			service.loginWithToken = async () => authCalls++;
			service.loginWithDevice = async () => authCalls++;
			assert.equal(await service.cli(), false);
			assert.equal(process.exitCode, 1);
			const error = logs.find(([kind]) => kind === 'error')?.[1];
			assert.match(error, /Crunchyroll CLI sign-in uses --device or --token/);
			assert.match(error, /replace the sign-in options/);
			assert.match(error, /--device[\s\S]*--token/);
			assert.doesNotMatch(error, /--service|anidl|aniDL\.exe|pnpm exec tsx/);
			assert.equal(helperPrompts, promptCount);
			assert.equal(loadBinCalls, binLoadCount);
			assert.equal(saved.length, saveCount);
			assert.equal(authCalls, 0);
			assert.equal(calls.length, 0);
			assert(!logs.some(([, line]) => line.includes('legacy-secret')));
		}
		process.exitCode = undefined;
	});
	await test('actual Crunchyroll CLI keeps valued device and token modes available', async () => {
		for (const [argv, expectedMethod] of [
			[{ device: 'androidtv' }, 'tv'],
			[{ device: 'android' }, 'phone'],
			[{ token: fakeToken }, 'token'],
			[{ token: rawPath }, 'token']
		]) {
			logs.length = 0;
			parsedArgv = argv;
			process.exitCode = undefined;
			let deviceCalls = 0;
			let phoneCalls = 0;
			const tokenValues = [];
			const { service } = makeService({});
			service.loginWithDevice = async () => (deviceCalls++, true);
			service.loginWithAndroidPhone = async () => (phoneCalls++, true);
			service.loginWithToken = async (value) => (tokenValues.push(value), true);
			await service.cli();
			assert.equal(deviceCalls, Number(expectedMethod === 'tv'));
			assert.equal(phoneCalls, Number(expectedMethod === 'phone'));
			assert.equal(tokenValues.length, Number(expectedMethod === 'token'));
			if (expectedMethod === 'token') assert.equal(tokenValues[0], argv.token);
			assert.equal(process.exitCode, undefined);
			assert(!logs.some(([kind]) => kind === 'warn' || kind === 'error'));
		}
	});

	await test('device helper polls milliseconds and sends Android TV identity', async () => {
		let now = 0;
		const messages = [],
			calls = [],
			sleeps = [],
			activationUrls = [];
		const token = { access_token: 'a', refresh_token: 'r', expires_in: 3600 };
		const result = await deviceHelper.requestDeviceToken({
			authUrl: 'https://example.invalid/auth/v1/token',
			headers: { Authorization: 'Basic test' },
			deviceId: 'uuid',
			signal: new AbortController().signal,
			debug: true,
			log: (line) => messages.push(line),
			openActivation: (url) => activationUrls.push(url),
			now: () => now,
			sleep: async (ms) => {
				sleeps.push(ms);
				now += ms;
			},
			request: async (url, options) => {
				calls.push({ url, options });
				if (calls.length === 1) return { ok: true, res: { status: 200, json: async () => ({ user_code: 'AbCd', device_code: 'code', interval: 500, expires_in: 300 }) } };
				if (calls.length === 2) return { ok: true, res: { status: 204 } };
				return { ok: true, res: { status: 200, json: async () => token } };
			}
		});
		assert.equal(result, token);
		same(sleeps, [500, 500]);
		same(JSON.parse(calls[1].options.body), { device_code: 'code', device_id: 'uuid', device_name: 'ANDROIDTV (uuid)', device_type: 'ANDROIDTV' });
		const presentationStart = messages.indexOf('Opening Crunchyroll activation in your browser…');
		assert.deepEqual(messages.slice(presentationStart, presentationStart + 5), [
			'Opening Crunchyroll activation in your browser…',
			'If your browser doesn’t open, open this link manually.',
			'https://crunchyroll.com/activate',
			'Enter Code: ABCD',
			'Expires in 300 seconds. (Waiting for approval)'
		]);
		assert.deepEqual(activationUrls, ['https://crunchyroll.com/activate']);
		assert(messages.some((s) => s.includes('response: 204')));
	});
	await test('device countdown follows the activation deadline and stops on approval, cancellation, and expiry', async () => {
		const createCountdownHelper = (extra = {}) => {
			let tick,
				active = false;
			const helper = compile(path.join(root, 'modules/module.crunchy-device-auth.ts'), requireDeviceDeps, {
				setInterval: (callback, ms) => {
					assert.equal(ms, 1000);
					tick = callback;
					active = true;
					return 1;
				},
				clearInterval: () => (active = false),
				...extra
			});
			return {
				helper,
				get active() {
					return active;
				},
				tick: () => tick?.()
			};
		};
		const token = { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 };
		{
			let now = 0,
				calls = 0;
			const countdown = createCountdownHelper();
			const values = [];
			const states = [];
			const result = await countdown.helper.requestDeviceToken({
				authUrl: 'https://example.invalid/auth/v1/token',
				headers: {},
				deviceId: 'uuid',
				signal: new AbortController().signal,
				debug: false,
				log: () => {},
				onCountdown: (seconds, state) => {
					values.push(seconds);
					states.push(state);
				},
				now: () => now,
				sleep: async (ms) => {
					now += ms;
					countdown.tick();
				},
				request: async () => (++calls === 1 ? jsonResponse({ user_code: 'X', device_code: 'Y', interval: 1000, expires_in: 5 }) : jsonResponse(token))
			});
			assert.equal(result.access_token, 'access');
			assert.deepEqual(values, [5, 4, 4, undefined]);
			assert.deepEqual(states, ['waiting', 'waiting', 'approved', undefined]);
			assert.equal(countdown.active, false);
		}
		{
			let now = 0,
				calls = 0;
			const controller = new AbortController();
			const countdown = createCountdownHelper();
			const values = [];
			const states = [];
			const messages = [];
			await countdown.helper.requestDeviceToken({
				authUrl: 'https://example.invalid/auth/v1/token',
				headers: {},
				deviceId: 'uuid',
				signal: controller.signal,
				debug: false,
				log: (line) => messages.push(line),
				onCountdown: (seconds, state) => {
					values.push(seconds);
					states.push(state);
				},
				now: () => now,
				sleep: async (ms) => {
					now += ms;
					countdown.tick();
					controller.abort();
				},
				request: async () => (++calls === 1 ? jsonResponse({ user_code: 'X', device_code: 'Y', interval: 500, expires_in: 5 }) : jsonResponse(token))
			});
			assert.equal(calls, 1);
			assert.equal(messages.at(-1), 'Device login cancelled.');
			assert.deepEqual(values, [5, 5, undefined]);
			assert.deepEqual(states, ['waiting', 'waiting', undefined]);
			assert.equal(countdown.active, false);
		}
		{
			let now = 0,
				calls = 0;
			const countdown = createCountdownHelper();
			const values = [];
			const states = [];
			const messages = [];
			await countdown.helper.requestDeviceToken({
				authUrl: 'https://example.invalid/auth/v1/token',
				headers: {},
				deviceId: 'uuid',
				signal: new AbortController().signal,
				debug: false,
				log: (line) => messages.push(line),
				onCountdown: (seconds, state) => {
					values.push(seconds);
					states.push(state);
				},
				now: () => now,
				sleep: async (ms) => {
					now += ms;
					countdown.tick();
				},
				request: async () =>
					++calls === 1
						? jsonResponse({ user_code: 'X', device_code: 'Y', interval: 500, expires_in: 5 })
						: { ok: false, res: new Response('{"error":"invalid_grant","error_description":"approval denied"}', { status: 403 }) }
			});
			assert.equal(calls, 2);
			assert.deepEqual(states, ['waiting', 'waiting', 'error', undefined]);
			assert.match(messages.at(-1), /HTTP 403 invalid_grant approval denied/);
			assert.equal(values[2], 5);
			assert.equal(countdown.active, false);
		}
		{
			let now = 0,
				calls = 0;
			const countdown = createCountdownHelper();
			const values = [];
			const states = [];
			const messages = [];
			await countdown.helper.requestDeviceToken({
				authUrl: 'https://example.invalid/auth/v1/token',
				headers: {},
				deviceId: 'uuid',
				signal: new AbortController().signal,
				debug: false,
				log: (line) => messages.push(line),
				onCountdown: (seconds, state) => {
					values.push(seconds);
					states.push(state);
				},
				now: () => now,
				sleep: async (ms) => {
					now += ms;
					countdown.tick();
				},
				request: async () => (++calls === 1 ? jsonResponse({ user_code: 'X', device_code: 'Y', interval: 500, expires_in: 1 }) : { ok: true, res: { status: 204 } })
			});
			assert.equal(calls, 2);
			assert.match(messages.at(-1), /Device code expired\./);
			assert.match(messages.at(-1), /--device androidtv/);
			assert.doesNotMatch(messages.at(-1), /--service|anidl|aniDL\.exe|pnpm exec tsx/);
			assert.deepEqual(values, [1, 1, 0, undefined]);
			assert.deepEqual(states, ['waiting', 'waiting', 'timed-out', undefined]);
			assert.equal(countdown.active, false);
		}
		{
			let now = 0,
				calls = 0,
				expire;
			let expiryTimerCleared = false;
			const countdown = createCountdownHelper({
				setTimeout: (callback, ms) => {
					if (ms === 1000) {
						expire = callback;
						return 'expiry';
					}
					return setTimeout(callback, ms);
				},
				clearTimeout: (timer) => {
					if (timer === 'expiry') expiryTimerCleared = true;
					else clearTimeout(timer);
				}
			});
			const values = [];
			const states = [];
			const messages = [];
			await countdown.helper.requestDeviceToken({
				authUrl: 'https://example.invalid/auth/v1/token',
				headers: {},
				deviceId: 'uuid',
				signal: new AbortController().signal,
				debug: false,
				log: (line) => messages.push(line),
				onCountdown: (seconds, state) => {
					values.push(seconds);
					states.push(state);
				},
				now: () => now,
				sleep: async (ms) => {
					now += ms;
				},
				request: async (_url, options) => {
					if (++calls === 1) return jsonResponse({ user_code: 'X', device_code: 'Y', interval: 500, expires_in: 1 });
					return new Promise((resolve) => {
						options.signal.addEventListener('abort', () => resolve({ ok: false }), { once: true });
						now = 500;
						countdown.tick();
						now = 1000;
						expire();
					});
				}
			});
			assert.equal(calls, 2);
			assert.match(messages.at(-1), /Device code expired\./);
			assert.match(messages.at(-1), /--device androidtv/);
			assert.doesNotMatch(messages.at(-1), /--service|anidl|aniDL\.exe|pnpm exec tsx/);
			assert.deepEqual(values, [1, 1, 0, undefined]);
			assert.deepEqual(states, ['waiting', 'waiting', 'timed-out', undefined]);
			assert.equal(countdown.active, false);
			assert.equal(expiryTimerCleared, true);
		}
	});
	await test('device polling bounds transient errors and supports cancellation', async () => {
		let now = 0,
			calls = 0;
		const messages = [],
			controller = new AbortController();
		const common = {
			authUrl: 'https://example.invalid/auth/v1/token',
			headers: {},
			deviceId: 'uuid',
			signal: controller.signal,
			debug: false,
			log: (line) => messages.push(line),
			now: () => now,
			sleep: async (ms) => {
				now += ms;
			},
			request: async () => (++calls === 1 ? { ok: true, res: { json: async () => ({ user_code: 'X', device_code: 'Y', interval: 500, expires_in: 300 }) } } : { ok: false })
		};
		assert.equal(await deviceHelper.requestDeviceToken(common), undefined);
		assert.equal(calls, 5);
		assert(messages.some((s) => s.includes('repeated temporary')));
		now = 0;
		calls = 0;
		assert.equal(await deviceHelper.requestDeviceToken({ ...common, sleep: async () => controller.abort() }), undefined);
		assert.equal(calls, 1);
	});
	await test('device login stages profile, CMS and disk writes before replacing the previous session', async () => {
		const original = deviceHelper.requestDeviceToken;
		deviceHelper.requestDeviceToken = async (options) => {
			options.onCountdown(300, 'waiting');
			options.onCountdown(200, 'approved');
			options.onCountdown(undefined);
			return { access_token: 'new', refresh_token: 'new-refresh', expires_in: 3600 };
		};
		try {
			for (const failure of ['profile', 'cms', 'disk']) {
				logs.length = 0;
				const { service } = makeService({});
				const old = { access_token: 'old' },
					oldCMS = { cms: { bucket: '/old' } };
				service.token = old;
				service.cmsToken = oldCMS;
				service.getProfile = async () => failure !== 'profile';
				service.getCMStoken = async () => {
					service.cmsToken = { cms: { bucket: '/new' } };
					return failure !== 'cms';
				};
				stubs['./modules/module.cfg-loader'].saveCRTokenAtomic = () => failure !== 'disk';
				assert.equal(await service.loginWithDevice(new AbortController().signal), false);
				assert.equal(service.token, old);
				assert.equal(service.cmsToken, oldCMS);
				const reason = failure === 'profile' ? 'profile validation failed' : failure === 'cms' ? 'CMS validation failed' : 'session could not be saved';
				const approvedIndex = logs.findIndex(([, line]) => line === 'Expires in 200 seconds. (Approved)');
				const failureIndex = logs.findIndex(([kind, line]) => kind === 'error' && line === 'Status: Error');
				const detailsIndex = logs.findIndex(([kind, line]) => kind === 'error' && line === `Device authentication failed: ${reason}.`);
				assert(approvedIndex >= 0 && failureIndex > approvedIndex && detailsIndex > failureIndex);
			}
			const { service } = makeService({});
			service.getProfile = async () => true;
			service.getCMStoken = async () => true;
			stubs['./modules/module.cfg-loader'].saveCRTokenAtomic = () => true;
			assert.equal(await service.loginWithDevice(new AbortController().signal), true);
			assert.equal(service.token.auth_type, 'device');
			assert.equal(service.token.device_name, `ANDROIDTV (${generatedDeviceId.slice(-4)})`);
		} finally {
			deviceHelper.requestDeviceToken = original;
		}
	});
	await test('device approval status is printed before profile output', async () => {
		const original = deviceHelper.requestDeviceToken;
		logs.length = 0;
		deviceHelper.requestDeviceToken = async (options) => {
			options.onCountdown(300, 'waiting');
			options.onCountdown(287, 'approved');
			options.onCountdown(undefined);
			return { access_token: 'new', refresh_token: 'new-refresh', expires_in: 3600 };
		};
		try {
			const { service } = makeService(successfulResponses);
			assert.equal(await service.loginWithDevice(new AbortController().signal), true);
			const approvedIndex = logs.findIndex(([, line]) => line === 'Expires in 287 seconds. (Approved)');
			const profileIndex = logs.findIndex(([, line]) => line.includes('USER: %s (%s) test-user'));
			assert(approvedIndex >= 0);
			assert(profileIndex > approvedIndex);
		} finally {
			deviceHelper.requestDeviceToken = original;
		}
	});
	await test('device timeout status precedes the exact retry instruction', async () => {
		const original = deviceHelper.requestDeviceToken;
		logs.length = 0;
		deviceHelper.requestDeviceToken = async (options) => {
			options.onCountdown(300, 'waiting');
			options.onCountdown(0, 'timed-out');
			options.onCountdown(undefined);
			options.log('Device code expired. To get a new code:\nKeep your Crunchyroll command and replace its options with:\n  --device androidtv');
			return undefined;
		};
		try {
			const { service } = makeService({});
			assert.equal(await service.loginWithDevice(new AbortController().signal), false);
			const timeoutIndex = logs.findIndex(([, line]) => line === 'Expires in 0 seconds. (Timed Out)');
			const instructionIndex = logs.findIndex(
				([, line]) => /Device code expired\./.test(line) && /Keep your Crunchyroll command and replace its options with:[\s\S]*--device androidtv/.test(line)
			);
			assert(!logs.some(([, line]) => /Device code expired\./.test(line) && /--service|anidl|aniDL\.exe/.test(line)));
			assert(timeoutIndex >= 0);
			assert(instructionIndex > timeoutIndex);
			assert(!logs.some(([, line]) => line === 'Expires in 300 seconds. (Approved)'));
		} finally {
			deviceHelper.requestDeviceToken = original;
		}
	});
	await test('device request errors show compact status then provider details', async () => {
		const original = deviceHelper.requestDeviceToken;
		logs.length = 0;
		deviceHelper.requestDeviceToken = async (options) => {
			options.onCountdown(247, 'error');
			options.onCountdown(undefined);
			options.log('Device approval was rejected (HTTP 403 invalid_grant approval denied). Retry the command.');
			return undefined;
		};
		try {
			const { service } = makeService({});
			assert.equal(await service.loginWithDevice(new AbortController().signal), false);
			const statusIndex = logs.findIndex(([, line]) => line === 'Expires in 247 seconds. (Error)');
			const detailsIndex = logs.findIndex(([, line]) => line.includes('HTTP 403 invalid_grant approval denied'));
			assert(statusIndex >= 0);
			assert(detailsIndex > statusIndex);
		} finally {
			deviceHelper.requestDeviceToken = original;
		}
	});
	await test('device login keeps native auth and continues if opening the printed activation URL fails', async () => {
		const original = deviceHelper.requestDeviceToken;
		const previous = { ...api };
		openedActivationUrls.length = 0;
		logs.length = 0;
		let now = 0;
		const requests = [];
		let savedDeviceToken;
		api.auth = 'https://beta-api.crunchyroll.com/auth/v1/token';
		api.basic_auth_token = Buffer.from('tv-client:tv-secret').toString('base64');
		api.crunchyDefUserAgent = 'Crunchyroll/ANDROIDTV/3.76.0_test';
		api.crunchyAuthHeader = { Host: 'www.crunchyroll.com' };
		deviceHelper.requestDeviceToken = (options) =>
			original({
				...options,
				now: () => now,
				sleep: async (ms) => {
					now += ms;
				}
			});
		try {
			const { service } = makeService({});
			service.req.getData = async (url, options) => {
				requests.push({ url, options });
				return requests.length === 1
					? jsonResponse({ user_code: 'AbC', device_code: 'transaction', interval: 500, expires_in: 300 })
					: jsonResponse({ access_token: 'access', refresh_token: 'refresh', expires_in: 300 });
			};
			service.getProfile = async () => true;
			service.getCMStoken = async () => true;
			stubs['./modules/module.cfg-loader'].saveCRTokenAtomic = (token) => {
				savedDeviceToken = { ...token };
				return true;
			};
			assert.equal(await service.loginWithDevice(new AbortController().signal), true);
			assert.deepEqual(openedActivationUrls, ['https://crunchyroll.com/activate']);
			assert(logs.some(([kind, line]) => kind === 'info' && line === openedActivationUrls[0]));
			assert.equal(requests.length, 2);
			assert.equal(requests[0].url, 'https://www.crunchyroll.com/auth/v1/device/code');
			assert.equal(requests[1].url, 'https://www.crunchyroll.com/auth/v1/device/token');
			for (const { options } of requests) {
				assert.equal(options.headers.Authorization, `Basic ${api.basic_auth_token}`);
				assert.equal(options.headers['User-Agent'], deviceHelper.DEVICE_USER_AGENT);
				assert.equal(options.useProxy, true);
				assert.equal(options.headers.Accept, 'application/json');
				assert.equal(
					Object.keys(options.headers).some((key) => key.toLowerCase() === 'host'),
					false
				);
			}
			assert.equal(service.token.device_user_agent, deviceHelper.DEVICE_USER_AGENT);
			const pollBody = JSON.parse(requests[1].options.body);
			assert.equal(pollBody.device_id, generatedDeviceId);
			assert.equal(pollBody.device_name, 'ANDROIDTV (cdef)');
			assert.equal(service.token.device_id, generatedDeviceId);
			assert.equal(service.token.device_name, pollBody.device_name);
			assert.equal(savedDeviceToken.device_id, generatedDeviceId);
			assert.equal(savedDeviceToken.device_name, pollBody.device_name);
			assert.equal(requests[0].options.headers['Content-Type'], undefined);
			assert.equal(requests[1].options.headers['Content-Type'], 'application/json');
		} finally {
			deviceHelper.requestDeviceToken = original;
			for (const key of Object.keys(api)) delete api[key];
			Object.assign(api, previous);
		}
	});
	await test('single-flight rotation is persisted before later CMS failure', async () => {
		const { service } = makeService({});
		service.token = { auth_type: 'device', device_id: 'uuid', device_name: 'ANDROIDTV 3.76.0', refresh_token: 'old', expires: 0 };
		api.basic_auth_token = Buffer.from('client:secret').toString('base64');
		api.crunchyAuthHeader = {};
		let calls = 0,
			savedToken;
		service.req.getData = async () => {
			calls++;
			await Promise.resolve();
			return { ok: true, res: { headers: { get: () => null }, json: async () => ({ access_token: 'new', refresh_token: 'rotated', expires_in: 3600 }) } };
		};
		stubs['./modules/module.cfg-loader'].saveCRTokenAtomic = (token) => {
			savedToken = { ...token };
			return true;
		};
		service.getProfile = async () => true;
		service.getCMStoken = async () => false;
		const results = await Promise.all([service.refreshToken(), service.refreshToken(true)]);
		same(results, [false, false]);
		assert.equal(calls, 1);
		assert.equal(savedToken.refresh_token, 'rotated');
		assert.equal(service.token.refresh_token, 'rotated');
		assert.equal(service.token.auth_type, 'device');
	});
	await test('CLI blocks credential conflicts and legacy auth without a prompt', async () => {
		for (const argv of [
			{ auth: true, username: 'legacy-user' },
			{ device: true, token: 'token' },
			{ silentAuth: true, device: true }
		]) {
			parsedArgv = argv;
			const { service, calls } = makeService({});
			assert.equal(await service.cli(), false);
			assert.equal(calls.length, 0);
		}
		process.exitCode = undefined;
	});

	await test('real transport forwards abort signals and preserves rejected response bodies', async () => {
		logs.length = 0;
		let seen;
		const { Req } = compile(path.join(root, 'modules/module.fetch.ts'), (id) => {
			if (id === './module.cfg-loader') return { loadCfg: () => ({ cli: {} }) };
			if (id === './module.app-args') return { appArgv: () => ({ debug: true }) };
			if (id === './log') return { console: fakeConsole };
			if (id === 'undici')
				return {
					Agent: class {},
					ProxyAgent: class {},
					fetch: async (url, options) => {
						seen = { url, options };
						return new Response('{"error":"invalid_grant"}', { status: 400 });
					}
				};
			throw new Error(`Unexpected transport import ${id}`);
		});
		const controller = new AbortController();
		const result = await new Req().getData('https://example.invalid/auth', { method: 'POST', signal: controller.signal, quietErrors: true });
		assert.equal(seen.options.signal, controller.signal);
		assert.equal((await result.res.json()).error, 'invalid_grant');
		assert(logs.some(([kind, line]) => kind === 'debug' && line.includes('FETCH OPTIONS')));
		assert(logs.some(([kind, line]) => kind === 'error' && line.includes('invalid_grant')));
	});
	await test('manifest opt-in observes 429 before awaiting bounded body disposal', async () => {
		let release;
		let observed;
		let cloneCalled = false;
		const disposed = new Promise((resolve) => {
			release = resolve;
		});
		const response = {
			ok: false,
			status: 429,
			statusText: 'Too Many Requests',
			headers: new globalThis.Headers({ 'retry-after': '3' }),
			body: { cancel: () => disposed },
			clone: () => {
				cloneCalled = true;
				throw Error('unexpected clone');
			}
		};
		const { Req } = compile(path.join(root, 'modules/module.fetch.ts'), (id) => {
			if (id === './module.cfg-loader') return { loadCfg: () => ({ cli: {} }) };
			if (id === './module.app-args') return { appArgv: () => ({ debug: false }) };
			if (id === './log') return { console: fakeConsole };
			if (id === 'undici') return { Agent: class {}, ProxyAgent: class {}, fetch: async () => response };
			throw Error(`Unexpected transport import ${id}`);
		});
		const pending = new Req().getData('https://example.invalid/manifest', {
			quietErrors: true,
			skipErrorBody: true,
			onResponse: (res) => {
				observed = res;
			}
		});
		await new Promise((resolve) => globalThis.setImmediate(resolve));
		assert.equal(observed, response);
		assert.equal(observed.headers.get('retry-after'), '3');
		assert.equal(cloneCalled, false);
		release();
		assert.equal((await pending).res.status, 429);
	});
	await test('playback deferred error body applies only to HTTP 429', async () => {
		let cloned = 0,
			status = 403;
		const { Req } = compile(path.join(root, 'modules/module.fetch.ts'), (id) => {
			if (id === './module.cfg-loader') return { loadCfg: () => ({ cli: {} }) };
			if (id === './module.app-args') return { appArgv: () => ({ debug: false }) };
			if (id === './log') return { console: fakeConsole };
			if (id === 'undici')
				return {
					Agent: class {},
					ProxyAgent: class {},
					fetch: async () => ({
						ok: false,
						status,
						statusText: 'failure',
						clone: () => {
							cloned++;
							return { text: async () => 'error' };
						}
					})
				};
			throw Error(`Unexpected transport import ${id}`);
		});
		assert.equal((await new Req().getData('https://example.invalid/', { quietErrors: true, deferErrorBody: true })).res.status, 403);
		assert.equal(cloned, 1);
		status = 429;
		assert.equal((await new Req().getData('https://example.invalid/', { quietErrors: true, deferErrorBody: true })).res.status, 429);
		assert.equal(cloned, 1);
	});
	await test('device quiet errors hide response bodies outside debug while preserving the response', async () => {
		logs.length = 0;
		const { Req } = compile(path.join(root, 'modules/module.fetch.ts'), (id) => {
			if (id === './module.cfg-loader') return { loadCfg: () => ({ cli: {} }) };
			if (id === './module.app-args') return { appArgv: () => ({ debug: false }) };
			if (id === './log') return { console: fakeConsole };
			if (id === 'undici') return { Agent: class {}, ProxyAgent: class {}, fetch: async () => new Response('{"error":"invalid_grant"}', { status: 400 }) };
			throw new Error(`Unexpected transport import ${id}`);
		});
		const result = await new Req().getData('https://example.invalid/auth', { quietErrors: true });
		assert.equal(result.res.status, 400);
		assert.equal((await result.res.json()).error, 'invalid_grant');
		assert(!logs.some(([, line]) => line.includes('invalid_grant') || line.includes('400:')));
	});
	await test('device profile validation reports concise HTTP details without changing normal caller logging', async () => {
		logs.length = 0;
		const { Req } = compile(path.join(root, 'modules/module.fetch.ts'), (id) => {
			if (id === './module.cfg-loader') return { loadCfg: () => ({ cli: {} }) };
			if (id === './module.app-args') return { appArgv: () => ({ debug: false }) };
			if (id === './log') return { console: fakeConsole };
			if (id === 'undici') {
				return {
					Agent: class {},
					ProxyAgent: class {},
					fetch: async () => new Response('{"error":"invalid_grant","error_description":"profile denied"}', { status: 401 })
				};
			}
			throw new Error(`Unexpected transport import ${id}`);
		});
		const { service } = makeService({});
		service.req = new Req();
		service.token = { access_token: 'candidate', auth_type: 'device' };
		let details = '';
		assert.equal(await service.getProfile(true, undefined, true, (value) => (details = value)), false);
		assert.match(details, /HTTP 401 invalid_grant profile denied/);
		assert(!logs.some(([, line]) => line.includes('invalid_grant') || line === 'Get profile failed!'));
		logs.length = 0;
		assert.equal(await service.getProfile(true), false);
		assert(logs.some(([kind, line]) => kind === 'error' && line.includes('invalid_grant')));
		assert(logs.some(([kind, line]) => kind === 'error' && line === 'Get profile failed!'));
	});
	await test('device flow rejects malformed initiation, expires, and cancels an in-flight request', async () => {
		let calls = 0,
			now = 0,
			messages = [];
		const controller = new AbortController();
		const common = {
			authUrl: 'https://example.invalid/auth/v1/token',
			headers: {},
			deviceId: 'uuid',
			signal: controller.signal,
			debug: false,
			log: (line) => messages.push(line),
			now: () => now,
			sleep: async (ms) => {
				now += ms;
			}
		};
		assert.equal(
			await deviceHelper.requestDeviceToken({
				...common,
				request: async () => {
					calls++;
					return jsonResponse({ user_code: 'bad' });
				}
			}),
			undefined
		);
		assert.equal(calls, 1);
		assert.equal(messages[0], 'Status: Error');
		assert(messages[1].includes('Invalid device code response.'));
		calls = 0;
		const start = () => jsonResponse({ user_code: 'X', device_code: 'Y', interval: 500, expires_in: 1 });
		assert.equal(await deviceHelper.requestDeviceToken({ ...common, request: async () => (++calls === 1 ? start() : { ok: true, res: { status: 204 } }) }), undefined);
		assert.equal(calls, 2);
		assert(messages.some((s) => s.includes('expired')));
		calls = 0;
		now = 0;
		messages = [];
		assert.equal(
			await deviceHelper.requestDeviceToken({
				...common,
				log: (s) => messages.push(s),
				request: async (url, options) => {
					if (++calls === 1) return start();
					return new Promise((resolve) => {
						options.signal.addEventListener('abort', () => resolve({ ok: false }), { once: true });
						controller.abort();
					});
				}
			}),
			undefined
		);
		assert(messages.some((s) => s.includes('cancelled')));
	});
	await test('failed refresh stops actual CLI and list consumers', async () => {
		const { service, calls } = makeService({});
		service.refreshToken = async () => false;
		service.parseSeriesById = async () => {
			throw new Error('protected request reached');
		};
		parsedArgv = { search: 'query', locale: 'en-US' };
		assert.equal(await service.cli(), false);
		assert.deepEqual(JSON.parse(JSON.stringify(await service.listSeriesID('series'))), { data: {}, list: [] });
		assert.equal(calls.length, 0);
	});

	await test('device refresh distinguishes explicit rejection from transient and malformed responses', async () => {
		for (const [response, expected] of [
			[
				{ ok: false, res: { status: 400, json: async () => ({ error: 'invalid_grant' }) } },
				'Keep your Crunchyroll command and replace its options with:\n  --device androidtv'
			],
			[{ ok: false, res: { status: 503, json: async () => ({ error: 'invalid_grant' }) } }, 'retry later'],
			[
				{
					ok: false,
					res: {
						status: 400,
						json: async () => {
							throw new Error('HTML');
						}
					}
				},
				'retry later'
			]
		]) {
			logs.length = 0;
			const { service } = makeService({});
			const old = { auth_type: 'device', device_id: 'uuid', refresh_token: 'old', expires: 0 };
			service.token = old;
			service.req.getData = async () => response;
			assert.equal(await service.refreshToken(), false);
			assert.equal(service.token, old);
			assert(logs.some(([, line]) => line.includes(expected)));
		}
	});
	await test('CLI reports missing endpoint logins per requested stream and preserves season listings', async () => {
		const { service, calls } = makeService({});
		let listings = 0;
		service.refreshToken = async () => true;
		service.getSeasonById = async () => {
			listings++;
			return { isOk: true, value: [] };
		};
		const opts = { s: 'SEASONID1', vstream: 'androidtv', astream: 'android', dubLang: ['eng'] };
		const roleErrors = () => logs.filter(([level, text]) => level === 'error' && text.includes('endpoint "')).map(([, text]) => text);
		const tv =
			/Video endpoint "androidtv" has no valid Android TV session\. Sign in first\.[\s\S]*Keep your Crunchyroll command and replace its options with:[\s\S]*--device androidtv[\s\S]*run your download command again\./i;
		const phone =
			/Audio endpoint "android" has no valid Android phone session\. Sign in first\.[\s\S]*Keep your Crunchyroll command and replace its options with:[\s\S]*--device android[\s\S]*run your download command again\./i;
		logs.length = 0;
		parsedArgv = opts;
		assert.equal(await service.cli(), true);
		assert.deepEqual(roleErrors(), []);
		for (const [flags, expected] of [
			[{}, [tv, phone]],
			[{ noaudio: true }, [tv]],
			[{ novids: true }, [phone]]
		]) {
			logs.length = 0;
			parsedArgv = { ...opts, e: '6', ...flags };
			assert.equal(await service.cli(), false);
			assert.equal(roleErrors().length, expected.length);
			for (const [index, expression] of expected.entries()) assert.match(roleErrors()[index], expression);
		}
		assert.equal(listings, 1);
		assert.equal(calls.length, 0);
	});
	await test('a shared expired login refreshes once and reports the appropriate error for both roles', async () => {
		const opts = { e: 'EPISODE01', vstream: 'androidtv', astream: 'androidtv', dubLang: ['eng'] };
		for (const [status, expected] of [
			[
				400,
				/has no valid Android TV session\. Sign in first\.[\s\S]*Keep your Crunchyroll command and replace its options with:[\s\S]*--device androidtv[\s\S]*run your download command again\./i
			],
			[429, 'could not refresh the saved session. Retry later.']
		]) {
			const auth = 'https://www.crunchyroll.com/auth/v1/token';
			const { service, calls } = makeService({ [auth]: { ok: false, res: Response.json({ error: 'invalid_grant' }, { status }) } });
			service.token = { auth_type: 'device', device_id: 'test-device', access_token: 'expired', refresh_token: 'test-refresh', expires: 0 };
			parsedArgv = opts;
			logs.length = 0;
			assert.equal(await service.cli(), false);
			assert.deepEqual(
				calls.map((call) => call.url),
				[auth]
			);
			const errors = logs.filter(([level]) => level === 'error').map(([, message]) => message);
			assert.equal(errors.length, 2);
			for (const [index, role] of ['Video', 'Audio'].entries()) {
				assert.match(errors[index], new RegExp(`${role} endpoint "androidtv"`));
				assert.match(errors[index], expected instanceof RegExp ? expected : new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
			}
		}
	});
	await test('GUI failures stop requests and always finish download state', async () => {
		let calls = 0,
			finished = 0;
		class FakeCrunchy {
			constructor() {
				this.cfg = { cli: {} };
			}
			async refreshToken() {
				return false;
			}
			async downloadFromSeriesID() {
				calls++;
			}
			async doSearch() {
				calls++;
			}
		}
		class FakeBase {
			initState() {}
			setDownloadQueue() {}
			setDownloading(value) {
				this.states.push(value);
			}
			alertError() {}
			sendMessage(message) {
				if (message.name === 'finish') finished++;
			}
			onFinish() {}
		}
		const { default: Handler } = compile(path.join(root, 'gui/server/services/crunchyroll.ts'), (id) => {
			if (id === '../../../crunchy') return { default: FakeCrunchy, __esModule: true };
			if (id === './base') return { default: FakeBase, __esModule: true };
			if (id === '../../../modules/module.app-args') return { appArgv: () => ({ locale: 'en-US' }) };
			if (id === '../../../modules/module.args') return {};
			if (id === '../../../modules/module.langsData') return {};
			if (id === '../../../modules/log') return { console: fakeConsole };
			throw new Error(`Unexpected GUI import ${id}`);
		});
		const handler = new Handler({});
		handler.states = [];
		assert.equal((await handler.search({})).isOk, false);
		assert.equal(await handler.resolveItems({ id: 'series' }), false);
		await handler.downloadItem({ id: 'series' });
		same(handler.states, [true, false]);
		assert.equal(finished, 1);
		assert.equal(calls, 0);
	});

	await test('device initiation times out without automatically requesting another code', async () => {
		let timer,
			requests = 0;
		const helper = compile(path.join(root, 'modules/module.crunchy-device-auth.ts'), requireDeviceDeps, {
			setTimeout: (fn, ms) => {
				assert.equal(ms, 30000);
				timer = fn;
				return 1;
			},
			clearTimeout: () => {}
		});
		const messages = [];
		const result = await helper.requestDeviceToken({
			authUrl: 'https://example.invalid/auth/v1/token',
			headers: {},
			deviceId: 'uuid',
			signal: new AbortController().signal,
			debug: false,
			log: (s) => messages.push(s),
			request: async (url, options) => {
				requests++;
				return new Promise((resolve) => {
					options.signal.addEventListener('abort', () => resolve({ ok: false }), { once: true });
					timer();
				});
			}
		});
		assert.equal(result, undefined);
		assert.equal(requests, 1);
		assert(messages.some((line) => line.includes('timed out')));
	});

	await test('native refresh retains an omitted refresh token and rejects malformed explicit values', async () => {
		for (const [refresh, expected] of [
			[undefined, true],
			['', false],
			[null, false],
			[42, false]
		]) {
			const { service } = makeService({});
			const old = { auth_type: 'device', device_id: 'uuid', device_name: 'ANDROIDTV 3.76.0', device_type: 'ANDROIDTV', refresh_token: 'old', expires: 0 };
			service.token = old;
			const body = { access_token: 'new', expires_in: 3600 };
			if (refresh !== undefined) body.refresh_token = refresh;
			service.req.getData = async () => ({ ok: true, res: { headers: { get: () => null }, json: async () => body } });
			service.getProfile = async () => true;
			service.getCMStoken = async () => true;
			let saved;
			stubs['./modules/module.cfg-loader'].saveCRTokenAtomic = (token) => {
				saved = { ...token };
				return true;
			};
			assert.equal(await service.refreshToken(), expected);
			if (expected) {
				assert.equal(saved.refresh_token, 'old');
				assert.equal(saved.device_id, 'uuid');
				assert.equal(saved.device_name, 'ANDROIDTV 3.76.0');
			} else assert.equal(service.token, old);
		}
	});
	await test('candidate profile and CMS requests receive cancellation and restore prior state', async () => {
		const original = deviceHelper.requestDeviceToken;
		deviceHelper.requestDeviceToken = async () => ({ access_token: 'new', refresh_token: 'r', expires_in: 3600 });
		try {
			for (const cancelledAt of ['profile', 'cms']) {
				const { service } = makeService({});
				const controller = new AbortController();
				const old = { access_token: 'old' },
					oldCMS = { cms: { bucket: '/old' } };
				service.token = old;
				service.cmsToken = oldCMS;
				service.req.getData = async (url, options) => {
					assert(options.signal);
					if (url === cancelledAt)
						return new Promise((resolve) => {
							options.signal.addEventListener('abort', () => resolve({ ok: false }), { once: true });
							controller.abort();
						});
					return jsonResponse({ username: 'name', email: 'test@example.invalid' });
				};
				assert.equal(await service.loginWithDevice(controller.signal), false);
				assert.equal(service.token, old);
				assert.equal(service.cmsToken, oldCMS);
			}
		} finally {
			deviceHelper.requestDeviceToken = original;
		}
	});
	await test('atomic token replacement preserves existing file after rename failure and owns cleanup', () => {
		const isolated = path.join(work, 'isolated-config');
		fs.mkdirSync(path.join(isolated, 'config'), { recursive: true });
		const target = path.join(isolated, 'config', 'cr_token.yml');
		const original = 'access_token: original\n';
		fs.writeFileSync(target, original);
		let failRename = true,
			collide = false,
			collisionPath;
		const fileApi = {
			...fs,
			openSync: (name, ...args) => {
				if (collide) {
					collisionPath = name;
					fs.writeFileSync(name, 'other owner');
				}
				return fs.openSync(name, ...args);
			},
			renameSync: (...args) => {
				if (failRename) throw new Error('injected rename failure');
				return fs.renameSync(...args);
			}
		};
		const integratedStore = compile(path.join(root, 'modules/module.crunchy-session-store.ts'), (id) => (id === 'node:fs' ? fileApi : require(id)));
		const cfg = compile(
			path.join(root, 'modules/module.cfg-loader.ts'),
			(id) => {
				if (id === 'dotenv/config') return {};
				if (id === 'fs') return fileApi;
				if (id === './module.crunchy-session-store') return integratedStore;
				if (id === './log') return { console: fakeConsole };
				return require(id);
			},
			{ __dirname: root, process: { ...process, pid: process.pid, env: { contentDirectory: isolated } } }
		);
		assert.equal(cfg.saveCRTokenAtomic({ access_token: 'new' }), false);
		assert.equal(fs.readFileSync(target, 'utf8'), original);
		same(fs.readdirSync(path.dirname(target)), ['cr_token.yml']);
		collide = true;
		assert.equal(cfg.saveCRTokenAtomic({ access_token: 'new' }), false);
		assert.equal(fs.readFileSync(collisionPath, 'utf8'), 'other owner');
		fs.unlinkSync(collisionPath);
		collide = false;
		failRename = false;
		assert.equal(cfg.saveCRTokenAtomic({ access_token: 'new' }), true);
		assert.equal(cfg.loadCRToken().access_token, 'new');
		same(fs.readdirSync(path.dirname(target)), ['cr_token.yml']);
	});
	await test('legacy token migration keeps separate TV, phone and web blocks during refresh', async () => {
		const target = path.join(work, 'multi-session', 'cr_token.yml');
		fs.mkdirSync(path.dirname(target));
		fs.writeFileSync(target, 'auth_type: device\nrefresh_token: old-tv\n', { mode: 0o600 });
		assert.equal(sessionStore.loadCrunchySessions(target).active, 'androidtv');
		assert(sessionStore.saveCrunchySession(target, { auth_type: 'android', refresh_token: 'old-phone' }));
		assert(sessionStore.saveCrunchySession(target, { auth_type: 'web', refresh_token: 'old-web' }));
		let finish;
		const held = sessionStore.withCrunchyRefreshLock(
			target,
			'android',
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		assert.equal(
			await sessionStore.withCrunchyRefreshLock(target, 'android', () => {
				throw new Error('concurrent refresh');
			}),
			undefined
		);
		finish();
		await held;
		assert.equal(sessionStore.saveCrunchySession(target, { auth_type: 'android', refresh_token: 'stale' }, { activate: false, expectedRefresh: 'stale-phone' }), false);
		assert(sessionStore.saveCrunchySession(target, { auth_type: 'android', refresh_token: 'new-phone' }, { activate: false, expectedRefresh: 'old-phone' }));
		const savedText = fs.readFileSync(target, 'utf8');
		assert.match(savedText, /^# This file is automatically generated/);
		for (const slot of ['androidtv', 'android', 'web']) assert(savedText.includes(`### ${slot} ###`));
		const updated = sessionStore.loadCrunchySessions(target);
		assert.equal(updated.active, 'web');
		assert.equal(updated.sessions.androidtv.refresh_token, 'old-tv');
		assert.equal(updated.sessions.android.refresh_token, 'new-phone');
		assert.equal(updated.sessions.web.refresh_token, 'old-web');
		if (process.platform !== 'win32') assert.equal(fs.statSync(target).mode & 0o777, 0o600);
		for (const invalid of ['version: 999\nsessions: {}\n', 'private: [']) {
			fs.writeFileSync(target, invalid);
			assert.equal(sessionStore.saveCrunchySession(target, { auth_type: 'device', refresh_token: 'refused' }), false);
			assert.equal(fs.readFileSync(target, 'utf8'), invalid);
		}
	});
	await test('flat tagged web and phone records migrate by auth_type while unknown or absent markers stay legacy', () => {
		const cases = [
			['web', 'web', 'web'],
			['phone', 'android', 'android'],
			['unknown', 'future-login', 'legacy'],
			['unmarked', undefined, 'legacy']
		];
		for (const [name, marker, expectedSlot] of cases) {
			const target = path.join(work, `flat-${name}`, 'cr_token.yml');
			fs.mkdirSync(path.dirname(target));
			const original = `${marker === undefined ? '' : `auth_type: ${marker}\n`}access_token: fixture-${name}\nrefresh_token: refresh-${name}\n`;
			fs.writeFileSync(target, original);
			const loaded = sessionStore.loadCrunchySessions(target);
			assert.equal(loaded.active, expectedSlot, name);
			assert.equal(loaded.sessions[expectedSlot].access_token, `fixture-${name}`);
			assert.equal(fs.readFileSync(target, 'utf8'), original, 'reading a legacy file must not rewrite it');
		}
	});
	await test('Android callback requires correct HTTPS origin, path, state and a single code', () => {
		const url = new URL('https://sso.crunchyroll.com/android/oauth-callback?code=fake%2Bcode&state=fixture');
		assert.equal(phoneAuth.parsePhoneCallback(url.href, 'fixture'), 'fake+code');
		const reordered = new URL(url.href);
		reordered.search = `extra=ignored&state=${encodeURIComponent('fixture')}&code=fake%2Bcode`;
		assert.equal(phoneAuth.parsePhoneCallback(reordered.href, 'fixture'), 'fake+code');
		for (const invalid of [
			url.href.replace('https:', 'http:'),
			url.href.replace('sso.crunchyroll.com', 'wrong.invalid'),
			url.href.replace('/android/oauth-callback', '/android/other'),
			url.href + '&code=duplicate',
			url.href + '&state=fixture',
			url.href + '&error=access_denied',
			url.href + '#',
			url.href.replace('https://sso.crunchyroll.com', 'https://user@sso.crunchyroll.com')
		])
			assert.equal(phoneAuth.parsePhoneCallback(invalid, 'fixture'), undefined);
		assert.equal(phoneAuth.parsePhoneCallback(url.href, 'different state'), undefined);
	});
	function makePhoneFlow(callbackHost = 'sso.crunchyroll.com', code = 'fixture-hidden-code') {
		let outputText = '';
		let launched;
		const terminal = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {} });
		const fixtureProcess = Object.assign(new EventEmitter(), {
			stdin: terminal,
			stdout: {
				isTTY: true,
				write(value) {
					outputText += value;
				}
			},
			env: { CRUNCHYROLL_PHONE_CLIENT_ID: 'fixture-id', CRUNCHYROLL_PHONE_CLIENT_SECRET: 'fixture-secret' }
		});
		const flow = compile(
			path.join(root, 'modules/module.crunchy-phone-auth.ts'),
			(id) => {
				if (id === './module.api-urls') return { domain: { cr_www: 'https://www.crunchyroll.com' } };
				if (id === './module.cfg-loader') return { workingDir: work };
				if (id === './module.crunchy-device-auth') return deviceHelper;
				if (id === 'open')
					return async (url) => {
						launched = new URL(url);
						const callback = new URL(launched.searchParams.get('redirect_uri'));
						callback.hostname = callbackHost;
						callback.searchParams.set('state', launched.searchParams.get('state'));
						callback.searchParams.set('code', code);
						terminal.write(callback.href + '\r');
					};
				return require(id);
			},
			{ process: fixtureProcess, Buffer, AbortSignal }
		);
		return {
			flow,
			get outputText() {
				return outputText;
			},
			get launched() {
				return launched;
			}
		};
	}
	await test('Android CLI browser flow prints its launch URL and keeps the pasted callback hidden', async () => {
		let requests = 0;
		const phoneFixture = makePhoneFlow();
		const { flow } = phoneFixture;
		const session = await flow.loginWithPhone(async (url, options) => {
			requests++;
			assert.equal(url, 'https://www.crunchyroll.com/auth/v1/token');
			assert.equal(options.redirect, 'manual');
			assert.equal(options.quietDebug, true);
			assert.equal(options.body.get('grant_type'), 'authorization_code');
			assert.equal(options.body.get('code'), 'fixture-hidden-code');
			assert.equal(options.body.get('code_verifier'), phoneFixture.launched.searchParams.get('code_challenge'));
			return { ok: true, res: Response.json({ access_token: 'fake-access', refresh_token: 'fake-refresh', expires_in: 60, account_id: 'fixture-account' }) };
		});
		assert.equal(requests, 1);
		assert.equal(session.auth_type, 'android');
		assert(phoneFixture.outputText.includes(phoneFixture.launched.href));
		assert.match(phoneFixture.outputText, /copy the full address from your browser’s address bar/i);
		assert.match(phoneFixture.outputText, /404.*That’s fine/i);
		assert.match(phoneFixture.outputText, /Paste the address here once and press Enter[\s\S]*Nothing will appear as you\s+paste[\s\S]*AniDL hides the address/i);
		assert(!phoneFixture.outputText.includes('fixture-hidden-code'));
		assert(!phoneFixture.outputText.includes('fixture-secret'));
	});
	await test('a valid phone callback with a rejected token exchange does not save or replace the session', async () => {
		const previousPhoneLogin = crunchyPhoneAuth.loginWithPhone;
		let requests = 0;
		const { flow } = makePhoneFlow('sso.crunchyroll.com', 'fixture-rejected-code');
		crunchyPhoneAuth.loginWithPhone = flow.loginWithPhone;
		const priorToken = { auth_type: 'device', refresh_token: 'existing' };
		const { service } = makeService({});
		service.token = priorToken;
		logs.length = 0;
		try {
			service.req.getData = async (_url, options) => {
				requests++;
				assert.equal(options.body.get('grant_type'), 'authorization_code');
				assert.equal(options.body.get('code'), 'fixture-rejected-code');
				assert.equal(options.body.get('state'), null);
				return { ok: false, res: Response.json({ error: 'invalid_grant' }, { status: 401 }) };
			};
			const savedBefore = saved.length;
			assert.equal(await service.loginWithAndroidPhone(), false);
			assert.equal(requests, 1);
			assert.equal(saved.length, savedBefore);
			assert.equal(service.token, priorToken);
			assert(logs.some(([kind, line]) => kind === 'error' && /failed or was cancelled/i.test(line)));
		} finally {
			crunchyPhoneAuth.loginWithPhone = previousPhoneLogin;
		}
	});
	await test('a malformed phone callback is rejected before token exchange without echoing it', async () => {
		const previousPhoneLogin = crunchyPhoneAuth.loginWithPhone;
		let requests = 0;
		const phoneFixture = makePhoneFlow('wrong.invalid', 'fixture-invalid-callback-code');
		const { flow } = phoneFixture;
		crunchyPhoneAuth.loginWithPhone = flow.loginWithPhone;
		const priorToken = { auth_type: 'device', refresh_token: 'existing' };
		const { service } = makeService({});
		service.token = priorToken;
		logs.length = 0;
		try {
			service.req.getData = async () => {
				requests++;
				return { ok: false };
			};
			const savedBefore = saved.length;
			assert.equal(await service.loginWithAndroidPhone(), false);
			assert.equal(requests, 0);
			assert.equal(saved.length, savedBefore);
			assert.equal(service.token, priorToken);
			assert(logs.some(([kind, line]) => kind === 'error' && /could not verify that sign-in address/i.test(line)));
			assert(!phoneFixture.outputText.includes('fixture-invalid-callback-code'));
			assert(!logs.some(([, line]) => line.includes('fixture-invalid-callback-code')));
		} finally {
			crunchyPhoneAuth.loginWithPhone = previousPhoneLogin;
		}
	});
	await test('device initiation rejects unrepresentable timers and pre-aborted calls', async () => {
		let requests = 0;
		const controller = new AbortController();
		const common = { authUrl: 'https://example.invalid/auth/v1/token', headers: {}, deviceId: 'uuid', signal: controller.signal, debug: false, log: () => {} };
		controller.abort();
		assert.equal(
			await deviceHelper.requestDeviceToken({
				...common,
				request: async () => {
					requests++;
					return { ok: false };
				}
			}),
			undefined
		);
		assert.equal(requests, 0);
		for (const values of [
			{ expires_in: 2147483.648, interval: 500 },
			{ expires_in: 300, interval: 2147483648 },
			{ expires_in: 300, interval: 0.5 }
		]) {
			const messages = [];
			assert.equal(
				await deviceHelper.requestDeviceToken({
					...common,
					signal: new AbortController().signal,
					log: (s) => messages.push(s),
					request: async () => jsonResponse({ user_code: 'A', device_code: 'B', ...values })
				}),
				undefined
			);
			assert(!messages.includes('https://crunchyroll.com/activate'));
		}
	});

	await test('candidate validation deadline aborts the in-flight request', async () => {
		let timeout;
		const { default: TimedCrunchy } = compile(path.join(root, 'crunchy.ts'), requireCrunchy, {
			setTimeout: (fn, ms) => {
				assert.equal(ms, 30000);
				timeout = fn;
				return 1;
			},
			clearTimeout: () => {}
		});
		const original = deviceHelper.requestDeviceToken;
		deviceHelper.requestDeviceToken = async () => ({ access_token: 'new', refresh_token: 'r', expires_in: 3600 });
		try {
			const service = Object.create(TimedCrunchy.prototype),
				old = { access_token: 'old' },
				oldCMS = {};
			service.token = old;
			service.cmsToken = oldCMS;
			service.req = {
				getData: async (url, options) =>
					new Promise((resolve) => {
						options.signal.addEventListener('abort', () => resolve({ ok: false }), { once: true });
						timeout();
					})
			};
			assert.equal(await service.loginWithDevice(new AbortController().signal), false);
			assert.equal(service.token, old);
			assert.equal(service.cmsToken, oldCMS);
		} finally {
			deviceHelper.requestDeviceToken = original;
		}
	});

	await test('real GUI queue pauses after authentication failure and retains remaining items', async () => {
		const state = { services: { crunchy: { queue: [{ id: 'first' }, { id: 'second' }, { id: 'third' }] } } };
		let attempts = 0;
		class FakeCrunchy {
			constructor() {
				this.cfg = { cli: {} };
			}
			async refreshToken(ifNeeded) {
				if (ifNeeded) attempts++;
				return false;
			}
		}
		const { default: Base } = compile(path.join(root, 'gui/server/services/base.ts'), (id) => {
			if (id === 'open') return { default: () => {}, __esModule: true };
			if (id === '..') return { cfg: { dir: {} } };
			if (id === 'path') return require(id);
			if (id === '../../../modules/log') return { console: fakeConsole };
			if (id === '../../../modules/module.cfg-loader') return { getState: () => state, setState: () => {} };
			if (id === '../../../package.json') return { version: 'test' };
			throw new Error(`Unexpected Base import ${id}`);
		});
		const { default: Handler } = compile(path.join(root, 'gui/server/services/crunchyroll.ts'), (id) => {
			if (id === '../../../crunchy') return { default: FakeCrunchy, __esModule: true };
			if (id === './base') return { default: Base, __esModule: true };
			if (id === '../../../modules/module.app-args') return { appArgv: () => ({ locale: 'en-US' }) };
			if (id === '../../../modules/module.args' || id === '../../../modules/module.langsData') return {};
			if (id === '../../../modules/log') return { console: fakeConsole };
			throw new Error(`Unexpected GUI import ${id}`);
		});
		const handler = new Handler({ sendMessage: () => {} });
		handler.setDownloadQueue(true);
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal(attempts, 1);
		assert.equal(await handler.getDownloadQueue(), false);
		same(
			(await handler.getQueue()).map((item) => item.id),
			['second', 'third']
		);
		assert.equal(await handler.isDownloading(), false);
	});
	await test('real GUI queue stops on failed Crunchy episode and advances after successful preview', async () => {
		let activeState, scenario;
		const { default: Base } = compile(path.join(root, 'gui/server/services/base.ts'), (id) => {
			if (id === 'open') return { default: () => {}, __esModule: true };
			if (id === '..') return { cfg: { dir: {} } };
			if (id === 'path') return require(id);
			if (id === '../../../modules/log') return { console: fakeConsole };
			if (id === '../../../modules/module.cfg-loader') return { getState: () => activeState, setState: () => {} };
			if (id === '../../../package.json') return { version: 'test' };
			throw new Error(`Unexpected Base import ${id}`);
		});
		class FakeCrunchy {
			constructor() {
				this.cfg = { cli: {} };
			}
			async refreshToken() {
				return true;
			}
			async downloadFromSeriesID(id, options) {
				scenario.seriesRequests.push(id);
				scenario.selectionOptions = options;
				if (scenario.selectionFails) return { isOk: false, reason: new Error('No episodes selected.') };
				return { isOk: true, value: scenario.episodes[id].map((episode) => ({ id: episode.id })) };
			}
			async downloadEpisode(episode, options) {
				scenario.episodeRequests.push({ id: episode.id, dryRun: options.dryRun });
				return scenario.results[episode.id] ?? true;
			}
		}
		const { default: Handler } = compile(path.join(root, 'gui/server/services/crunchyroll.ts'), (id) => {
			if (id === '../../../crunchy') return { default: FakeCrunchy, __esModule: true };
			if (id === './base') return { default: Base, __esModule: true };
			if (id === '../../../modules/module.app-args') return { appArgv: () => ({ locale: 'en-US', dryRun: true }) };
			if (id === '../../../modules/module.args') return { getDefault: () => undefined };
			if (id === '../../../modules/module.langsData') return {};
			if (id === '../../../modules/log') return { console: fakeConsole };
			throw new Error(`Unexpected GUI import ${id}`);
		});
		const queued = (id) => ({ id, e: '1', dubLang: ['jpn'], q: 0, dlsubs: ['none'], fileName: 'test', dlVideoOnce: false, novids: false, noaudio: false });
		const runQueue = async (items, setup) => {
			activeState = { services: { crunchy: { queue: items } } };
			scenario = { episodes: {}, results: {}, seriesRequests: [], episodeRequests: [], ...setup };
			const messages = [],
				errors = [];
			const handler = new Handler({ sendMessage: (message) => messages.push(message) });
			handler.alertError = (error) => errors.push(error);
			handler.setDownloadQueue(true);
			await new Promise((resolve) => setTimeout(resolve, 0));
			return { handler, messages, errors };
		};

		const failed = await runQueue([queued('first-series'), queued('next-series')], {
			episodes: { 'first-series': [{ id: 'first-episode' }, { id: 'later-episode' }] },
			results: { 'first-episode': false }
		});
		same(scenario.seriesRequests, ['first-series']);
		same(scenario.episodeRequests, [{ id: 'first-episode', dryRun: true }]);
		assert.equal(failed.errors.length, 1);
		assert.equal(failed.errors[0].name, 'Download error');
		assert.equal(await failed.handler.getDownloadQueue(), false);
		same(
			(await failed.handler.getQueue()).map((item) => item.id),
			['next-series']
		);
		assert.equal(await failed.handler.isDownloading(), false);
		assert.equal(failed.messages.filter((message) => message.name === 'finish').length, 1);

		const selectionFailed = await runQueue([queued('first-series'), queued('next-series')], { selectionFails: true });
		same(scenario.seriesRequests, ['first-series']);
		same(scenario.selectionOptions.dubLang, ['jpn']);
		assert.equal(selectionFailed.errors.length, 1);
		assert.equal(await selectionFailed.handler.getDownloadQueue(), false);
		same(
			(await selectionFailed.handler.getQueue()).map((item) => item.id),
			['next-series']
		);

		const successful = await runQueue([queued('first-series'), queued('next-series')], {
			episodes: {
				'first-series': [{ id: 'first-preview' }],
				'next-series': [{ id: 'next-preview' }]
			}
		});
		same(scenario.seriesRequests, ['first-series', 'next-series']);
		same(scenario.episodeRequests, [
			{ id: 'first-preview', dryRun: true },
			{ id: 'next-preview', dryRun: true }
		]);
		assert.equal(successful.errors.length, 0);
		assert.equal(await successful.handler.getDownloadQueue(), true);
		assert.deepEqual(await successful.handler.getQueue(), []);
		assert.equal(await successful.handler.isDownloading(), false);
		assert.equal(successful.messages.filter((message) => message.name === 'finish').length, 2);
	});
	await test('actual entry point propagates Crunchy failures, stops archive, and rejects other-provider device before update', async () => {
		const updateDisabledNotice = 'Updates disabled on this fork. Download updates: https://github.com/XxUnkn0wnxX/multi-downloader-nx/releases/tag/nightly-fork';
		for (const scenario of [
			{ status: 'invalid', argv: {}, result: false, expectedCalls: 0, exit: 1, updates: 0, cfgReads: 0 },
			{ status: 'valid', argv: { service: 'crunchy', checkStatus: true }, result: true, expectedCalls: 1, exit: undefined, updates: 0 },
			{ status: 'valid', argv: { service: 'crunchy', checkStatus: true }, result: false, expectedCalls: 1, exit: 1, updates: 0 },
			{ argv: { service: 'crunchy' }, result: false, expectedCalls: 1, exit: 1, updates: 1 },
			{ argv: { service: 'crunchy', skipUpdate: true }, result: true, expectedCalls: 1, exit: undefined, updates: 0 },
			{ argv: { service: 'crunchy', dryRun: true, debug: true }, result: true, expectedCalls: 1, exit: undefined, updates: 0 },
			{ argv: { service: 'hidive', dryRun: true, downloadArchive: true }, result: true, expectedCalls: 2, exit: undefined, updates: 0 },
			{ argv: { service: 'adn', dryRun: true }, result: true, expectedCalls: 1, exit: undefined, updates: 0 },
			{
				argv: { service: 'crunchy', dryRun: true, update: true, auth: true, addArchive: true },
				rawArgs: ['--service', 'crunchy', '--update', '--dry-run', '--auth', '--addArchive'],
				result: true,
				expectedCalls: 0,
				exit: 1,
				updates: 0,
				warning: updateDisabledNotice
			},
			{
				argv: { service: 'crunchy', update: true },
				rawArgs: ['--service', 'crunchy', '--update'],
				result: true,
				expectedCalls: 0,
				exit: 1,
				updates: 0,
				warning: updateDisabledNotice
			},
			{
				argv: { service: 'crunchy', dryRun: true, addArchive: true },
				result: true,
				expectedCalls: 0,
				exit: 1,
				updates: 0,
				error: '--dry-run cannot be combined with --update or --addArchive.'
			},
			{ argv: { service: 'crunchy', addArchive: true, s: 'TEST_SEASON' }, result: true, expectedCalls: 0, exit: undefined, updates: 1, archives: 1 },
			{ argv: { service: 'crunchy', downloadArchive: true }, result: false, expectedCalls: 1, exit: 1, updates: 1 },
			{ argv: { service: 'crunchy', downloadArchive: true }, result: true, expectedCalls: 2, exit: undefined, updates: 1 },
			{ argv: { service: 'crunchy', auth: true }, result: true, expectedCalls: 0, exit: 1, updates: 0, error: /now uses --device or --token/ },
			{ argv: { service: 'crunchy', username: 'legacy-user' }, result: true, expectedCalls: 0, exit: 1, updates: 0, error: /replace the sign-in options/ },
			{ argv: { service: 'crunchy', password: '' }, result: true, expectedCalls: 0, exit: 1, updates: 0, error: /replace the sign-in options/ },
			{ argv: { service: 'crunchy', password: 'entry-secret' }, result: true, expectedCalls: 0, exit: 1, updates: 0, error: /replace the sign-in options/ },
			{ argv: { service: 'crunchy', silentAuth: true }, result: true, expectedCalls: 0, exit: 1, updates: 0, error: /replace the sign-in options/ },
			{
				argv: { service: 'crunchy', auth: true, device: true },
				result: true,
				expectedCalls: 0,
				exit: 1,
				updates: 0,
				error: 'Choose only one of --device, --token, --auth, or --silentAuth.'
			},
			{ argv: { service: 'hidive', downloadArchive: true }, result: false, expectedCalls: 2, exit: undefined, updates: 1 },
			{ argv: { service: 'hidive', username: 'user', password: 'pass' }, result: true, expectedCalls: 1, exit: undefined, updates: 1 },
			{
				argv: { service: 'hidive', device: true, crunchyAuthExplicit: true },
				rawArgs: ['--service', 'hidive', '--device'],
				result: true,
				expectedCalls: 0,
				exit: 1,
				updates: 0,
				error: /only supported for Crunchyroll/
			}
		]) {
			logs.length = 0;
			const budgets = [];
			let calls = 0,
				updates = 0,
				archives = 0,
				cfgReads = 0,
				cfgReadOnly;
			const fakeProcess = {
				argv: ['node', 'index', ...(scenario.rawArgs ?? ['--service', scenario.argv.service])],
				exitCode: undefined,
				exit: () => {
					throw new Error('unexpected exit');
				}
			};
			class Provider {
				constructor(_debug, budget, readOnly) {
					if (scenario.readOnly) assert.equal(readOnly, true);
					if (budget) budgets.push(budget);
				}
				async cli() {
					calls++;
					return scenario.result;
				}
			}
			compile(
				path.join(root, 'index.ts'),
				(id) => {
					if (id === './modules/log') return { console: fakeConsole };
					if (id === './package.json') return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
					if (id === './modules/module.fork-display') return forkDisplay;
					if (id === './modules/module.args') return { cliServices: ['crunchy', 'hidive', 'adn'] };
					if (id === './modules/module.app-args') return { appArgv: () => scenario.argv, overrideArguments: () => {}, statusInvocation: () => scenario.status ?? 'none' };
					if (id === './modules/module.cfg-loader')
						return {
							loadCliCfg: () => ({}),
							loadCfg: (readOnly) => {
								cfgReads++;
								cfgReadOnly = readOnly;
								return { cli: {} };
							}
						};
					if (id === './modules/module.downloadArchive') return { makeCommand: () => ['first', 'second'], addToArchive: () => archives++ };
					if (['./crunchy', './hidive', './adn'].includes(id)) return { default: Provider, __esModule: true };
					if (id === './modules/module.updater')
						return {
							default: async () => {
								updates++;
							},
							__esModule: true
						};
					if (id === './modules/module.crunchy-device-auth') return deviceHelper;
					if (id === './modules/module.crunchy-cli-auth')
						return {
							cliInvocation: cliAuth.cliInvocation,
							crunchyCliAuthDecision: cliAuth.crunchyCliAuthDecision,
							leadingCliService: cliAuth.leadingCliService
						};
					throw new Error(`Unexpected index import ${id}`);
				},
				{ process: fakeProcess, global: { console: fakeConsole } }
			);
			await new Promise((resolve) => setTimeout(resolve, 0));
			assert.equal(calls, scenario.expectedCalls, JSON.stringify(scenario.argv));
			if (scenario.cfgReads !== undefined) assert.equal(cfgReads, scenario.cfgReads);
			if (scenario.cfgReadOnly !== undefined) assert.equal(cfgReadOnly, scenario.cfgReadOnly);
			if (scenario.argv.service === 'crunchy' && calls === 2) {
				assert.equal(budgets.length, 2);
				assert.equal(budgets[0], budgets[1]);
			}
			assert.equal(fakeProcess.exitCode, scenario.exit);
			assert.equal(updates, scenario.updates);
			assert.equal(archives, scenario.archives ?? 0);
			if (scenario.warning)
				assert.deepEqual(
					logs.filter(([kind]) => kind === 'warn'),
					[['warn', scenario.warning]]
				);
			if (scenario.argv.password) assert(!logs.some(([, line]) => line.includes(scenario.argv.password)));
			if (scenario.error) {
				const errors = logs.filter(([kind]) => kind === 'error').map(([, message]) => message);
				assert.equal(errors.length, 1);
				assert.match(errors[0], scenario.error instanceof RegExp ? scenario.error : new RegExp(scenario.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
			}
		}
	});
	await test('device polling stops immediately on rate limit', async () => {
		let calls = 0,
			now = 0;
		const messages = [];
		const result = await deviceHelper.requestDeviceToken({
			authUrl: 'https://example.invalid/auth/v1/token',
			headers: {},
			deviceId: 'uuid',
			signal: new AbortController().signal,
			debug: false,
			log: (s) => messages.push(s),
			now: () => now,
			sleep: async (ms) => {
				now += ms;
			},
			request: async () => (++calls === 1 ? jsonResponse({ user_code: 'A', device_code: 'B', expires_in: 300, interval: 500 }) : { ok: false, res: { status: 429 } })
		});
		assert.equal(result, undefined);
		assert.equal(calls, 2);
		assert(messages.some((message) => message.includes('Retry later')));
	});

	await test('shared transport prefers HTTP/2 for direct and proxied destinations', async () => {
		const agents = [],
			proxies = [],
			dispatched = [];
		let argv = { debug: true };
		const { Req } = compile(path.join(root, 'modules/module.fetch.ts'), (id) => {
			if (id === './module.cfg-loader') return { loadCfg: () => ({ cli: {} }) };
			if (id === './module.app-args') return { appArgv: () => argv };
			if (id === './log') return { console: fakeConsole };
			if (id === 'undici')
				return {
					Agent: class {
						constructor(options) {
							this.options = options;
							agents.push(this);
						}
					},
					ProxyAgent: class {
						constructor(options) {
							this.options = options;
							proxies.push(this);
						}
					},
					fetch: async (url, options) => {
						dispatched.push(options.dispatcher);
						return new Response('ok');
					}
				};
			throw new Error(`Unexpected transport import ${id}`);
		});
		const direct = new Req();
		await direct.getData('https://example.invalid/first');
		await direct.getData('https://example.invalid/second');
		assert.equal(agents.length, 1);
		assert.equal(dispatched[0], agents[0]);
		assert.equal(dispatched[1], agents[0]);
		same(agents[0].options, { connections: 16, connect: { preferH2: true }, allowH2: true });
		argv = { proxy: 'http://proxy.invalid:8080', debug: true };
		const proxy = new Req();
		await proxy.getData('https://example.invalid/direct');
		await proxy.getData('https://example.invalid/proxied', { useProxy: true });
		argv = { ...argv, proxyAll: true };
		await new Req().getData('https://example.invalid/proxied-by-config');
		assert.equal(dispatched[2], agents[0]);
		assert.equal(dispatched[3], proxies[0]);
		assert.equal(dispatched[4], proxies[1]);
		for (const proxyAgent of proxies) {
			same(proxyAgent.options, { uri: argv.proxy, connections: 16, allowH2: true, requestTls: { allowH2: true, preferH2: true } });
		}
	});
	await test('device refresh uses official auth and retained UA for profile CMS and playback', async () => {
		const { service, calls } = makeService({});
		const deviceUA = 'stored device agent';
		service.token = {
			auth_type: 'device',
			device_id: generatedDeviceId,
			device_name: 'ANDROIDTV (cdef)',
			device_type: 'ANDROIDTV',
			device_user_agent: deviceUA,
			refresh_token: 'old',
			expires: 0
		};
		service.cmsToken = {};
		service.cfg.bin = { ffmpeg: 'ffmpeg' };
		api.basic_auth_token = Buffer.from('client:secret').toString('base64');
		api.crunchyDefHeader = { 'User-Agent': 'legacy agent' };
		let persisted;
		stubs['./modules/module.cfg-loader'].saveCRTokenAtomic = (token) => {
			persisted = { ...token };
			return true;
		};
		service.req.getData = async (url, options) => {
			calls.push({ url, options });
			if (url.endsWith('/auth/v1/token')) return { ok: true, res: { json: async () => ({ access_token: 'new', refresh_token: 'rotated', expires_in: 3600 }) } };
			if (url === 'profile') return jsonResponse({ username: 'test', email: 'test@example.invalid' });
			if (url === 'cms') return jsonResponse({ cms: { bucket: '/US', expires: new Date(Date.now() + 3600000).toISOString() } });
			throw new Error('captured playback');
		};
		assert.equal(await service.refreshToken(), true);
		assert.equal(calls[0].url, 'https://www.crunchyroll.com/auth/v1/token');
		assert.equal(calls[0].options.useProxy, true);
		assert.equal(calls[0].options.headers['User-Agent'], deviceUA);
		assert.equal(calls[0].options.headers.Accept, 'application/json');
		assert.equal(calls[0].options.headers['Content-Type'], 'application/x-www-form-urlencoded; charset=UTF-8');
		assert.equal(calls[0].options.headers.Authorization, undefined);
		const form = new URLSearchParams(calls[0].options.body);
		assert.equal(form.get('client_id'), 'client');
		assert.equal(form.get('client_secret'), 'secret');
		assert.equal(form.get('device_id'), generatedDeviceId);
		assert.equal(form.get('device_name'), 'ANDROIDTV (cdef)');
		assert.equal(persisted.device_user_agent, deviceUA);
		assert.equal(service.token.device_user_agent, deviceUA);
		assert.equal(persisted.device_id, generatedDeviceId);
		assert.equal(persisted.device_name, 'ANDROIDTV (cdef)');
		assert.equal(service.token.device_id, generatedDeviceId);
		assert.equal(service.token.device_name, 'ANDROIDTV (cdef)');
		for (const call of calls.slice(1)) {
			assert.equal(call.options.headers['User-Agent'], deviceUA);
		}
		assert.equal(await service.downloadMediaList({ data: [{ mediaId: 'episode', playback: 'available' }] }, { vstream: 'androidtv', astream: 'androidtv' }), undefined);
		const playback = calls.at(-1);
		assert(playback.url.includes('/play?queue=0'));
		assert.equal(playback.options.headers['User-Agent'], deviceUA);
	});
	await test('legacy native and web refresh keep their endpoints and user agents', async () => {
		const previous = { ...api };
		try {
			api.auth = 'https://beta-api.crunchyroll.com/auth/v1/token';
			api.basic_auth_token = Buffer.from('client:secret').toString('base64');
			api.crunchyAuthHeader = { Host: 'legacy', 'User-Agent': 'native' };
			api.crunchyWebAuthHeader = { 'User-Agent': 'web' };
			for (const mode of ['native', 'web']) {
				const { service, calls } = makeService({});
				service.token = { auth_type: mode, device_id: 'uuid', refresh_token: 'old', expires: 0 };
				service.req.getData = async (url, options) => {
					calls.push({ url, options });
					return { ok: true, res: { headers: { get: () => null }, json: async () => ({ access_token: 'a', refresh_token: 'b', expires_in: 3600 }) } };
				};
				service.getProfile = async () => true;
				service.getCMStoken = async () => true;
				assert.equal(await service.refreshToken(), true);
				assert.equal(calls[0].url, api.auth);
				assert.equal(calls[0].options.headers['User-Agent'], mode === 'web' ? 'web' : 'native');
			}
		} finally {
			for (const key of Object.keys(api)) delete api[key];
			Object.assign(api, previous);
		}
	});

	await test('eligible initiation failures use one warned beta attempt and pin polling to the issuer', async () => {
		for (const failure of [
			{ ok: false },
			{ ok: false, res: new Response('failure', { status: 503 }) },
			{ ok: false, res: new Response('<html>Cloudflare challenge cf-chl-test</html>', { status: 403 }) }
		]) {
			let now = 0;
			const calls = [],
				warnings = [],
				messages = [];
			const result = await deviceHelper.requestDeviceToken({
				authUrl: 'https://www.crunchyroll.com/auth/v1/token',
				fallbackAuthUrl: 'https://beta-api.crunchyroll.com/auth/v1/token',
				headers: {},
				deviceId: 'uuid',
				signal: new AbortController().signal,
				debug: false,
				log: (s) => messages.push(s),
				warn: (s) => warnings.push(s),
				now: () => now,
				sleep: async (ms) => {
					now += ms;
				},
				request: async (url, options) => {
					calls.push({ url, options });
					if (calls.length === 1) return failure;
					if (calls.length === 2) return jsonResponse({ user_code: 'AbC', device_code: 'from-beta', expires_in: 300, interval: 500 });
					return jsonResponse({ access_token: 'a', refresh_token: 'r', expires_in: 300 });
				}
			});
			same(warnings, ['Using beta API fallback: beta-api.crunchyroll.com']);
			assert.equal(calls.length, 3);
			assert(calls[0].url.includes('www.crunchyroll.com'));
			assert(calls[1].url.includes('beta-api.crunchyroll.com'));
			assert(calls[2].url.includes('beta-api.crunchyroll.com'));
			assert.equal(JSON.parse(calls[2].options.body).device_code, 'from-beta');
			assert.equal(result.device_auth_origin, 'api');
			assert(messages.includes('Enter Code: ABC'));
		}
	});
	await test('initiation denial, rate limit, malformed success and cancellation never fall back', async () => {
		for (const response of [
			new Response('Forbidden', { status: 403 }),
			new Response('{"error":"invalid_client"}', { status: 401 }),
			new Response('rate limit', { status: 429 }),
			new Response('{"bad":true}', { status: 200 })
		]) {
			let calls = 0,
				warnings = 0;
			await deviceHelper.requestDeviceToken({
				authUrl: 'https://www.crunchyroll.com/auth/v1/token',
				fallbackAuthUrl: 'https://beta-api.crunchyroll.com/auth/v1/token',
				headers: {},
				deviceId: 'uuid',
				signal: new AbortController().signal,
				debug: false,
				log: () => {},
				warn: () => warnings++,
				request: async () => {
					calls++;
					return { ok: response.ok, res: response };
				}
			});
			assert.equal(calls, 1);
			assert.equal(warnings, 0);
		}
		const controller = new AbortController();
		let calls = 0,
			warnings = 0;
		await deviceHelper.requestDeviceToken({
			authUrl: 'https://www.crunchyroll.com/auth/v1/token',
			fallbackAuthUrl: 'https://beta-api.crunchyroll.com/auth/v1/token',
			headers: {},
			deviceId: 'uuid',
			signal: controller.signal,
			debug: false,
			log: () => {},
			warn: () => warnings++,
			request: async () => {
				calls++;
				controller.abort();
				return { ok: false };
			}
		});
		assert.equal(calls, 1);
		assert.equal(warnings, 0);
	});
	await test('timed-out initial request uses a fresh fallback abort signal', async () => {
		let timer,
			calls = 0;
		const signals = [],
			warnings = [];
		const helper = compile(path.join(root, 'modules/module.crunchy-device-auth.ts'), requireDeviceDeps, {
			setTimeout: (fn) => {
				timer = fn;
				return 1;
			},
			clearTimeout: () => {}
		});
		await helper.requestDeviceToken({
			authUrl: 'https://www.crunchyroll.com/auth/v1/token',
			fallbackAuthUrl: 'https://beta-api.crunchyroll.com/auth/v1/token',
			headers: {},
			deviceId: 'uuid',
			signal: new AbortController().signal,
			debug: false,
			log: () => {},
			warn: (s) => warnings.push(s),
			request: async (url, options) => {
				calls++;
				signals.push(options.signal);
				if (calls === 1)
					return new Promise((resolve) => {
						options.signal.addEventListener('abort', () => resolve({ ok: false }), { once: true });
						timer();
					});
				assert.equal(options.signal.aborted, false);
				return { ok: false, res: new Response('denied', { status: 403 }) };
			}
		});
		assert.equal(calls, 2);
		assert.notEqual(signals[0], signals[1]);
		assert.equal(warnings.length, 1);
	});
	await test('refresh fallback persists rotated token and beta origin before CMS failure, and beta origin stays restricted', async () => {
		const { service, calls } = makeService({});
		logs.length = 0;
		service.token = { auth_type: 'device', device_id: 'uuid', device_user_agent: 'saved UA', refresh_token: 'old', expires: 0 };
		api.basic_auth_token = Buffer.from('client:secret').toString('base64');
		let saved;
		stubs['./modules/module.cfg-loader'].saveCRTokenAtomic = (token) => {
			saved = { ...token };
			return true;
		};
		service.req.getData = async (url, options) => {
			calls.push({ url, options });
			return calls.length === 1
				? { ok: false, res: new Response('unavailable', { status: 503 }) }
				: jsonResponse({ access_token: 'new', refresh_token: 'rotated', expires_in: 3600 });
		};
		service.getProfile = async () => true;
		service.getCMStoken = async () => false;
		assert.equal(await service.refreshToken(), false);
		assert.equal(calls.length, 2);
		assert.equal(calls[0].url, 'https://www.crunchyroll.com/auth/v1/token');
		assert.equal(calls[1].url, 'https://beta-api.crunchyroll.com/auth/v1/token');
		assert.equal(calls[0].options.body, calls[1].options.body);
		assert.equal(saved.refresh_token, 'rotated');
		assert.equal(saved.device_auth_origin, 'api');
		assert.equal(logs.filter(([kind, line]) => kind === 'warn' && line === 'Using beta API fallback: beta-api.crunchyroll.com').length, 1);
		calls.length = 0;
		logs.length = 0;
		service.token.expires = 0;
		service.req.getData = async (url, options) => {
			calls.push({ url, options });
			return { ok: false, res: new Response('denied', { status: 403 }) };
		};
		assert.equal(await service.refreshToken(), false);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].url, 'https://beta-api.crunchyroll.com/auth/v1/token');
		assert.equal(logs.filter(([kind, line]) => kind === 'warn' && line === 'Using beta API fallback: beta-api.crunchyroll.com').length, 1);
		service.token.device_auth_origin = 'https://evil.invalid';
		calls.length = 0;
		logs.length = 0;
		assert.equal(await service.refreshToken(), false);
		assert.equal(calls[0].url, 'https://www.crunchyroll.com/auth/v1/token');
	});

	await test('timed-out refresh then rejected beta grant advises new login without asserting revocation', async () => {
		const original = deviceHelper.deviceAuthAttempt;
		const calls = [];
		deviceHelper.deviceAuthAttempt = async (request, url) => {
			calls.push(url);
			return calls.length === 1
				? { timedOut: true, cancelled: false, result: { ok: false } }
				: { timedOut: false, cancelled: false, result: { ok: false, res: new Response('{"error":"invalid_grant"}', { status: 400 }) } };
		};
		try {
			const { service } = makeService({});
			const old = { auth_type: 'device', device_id: 'uuid', refresh_token: 'old', expires: 0 };
			service.token = old;
			logs.length = 0;
			assert.equal(await service.refreshToken(), false);
			assert.equal(calls.length, 2);
			assert.equal(service.token, old);
			assert(logs.some(([, line]) => line.includes('credentials are unusable') && line.includes('--device')));
			assert(!logs.some(([, line]) => /revoked/i.test(line)));
		} finally {
			deviceHelper.deviceAuthAttempt = original;
		}
	});

	await test('actual transport body-read errors preserve terminal status and never trigger fallback', async () => {
		for (const status of [429, 401, 200]) {
			let calls = 0;
			const warnings = [];
			const { Req } = compile(path.join(root, 'modules/module.fetch.ts'), (id) => {
				if (id === './module.cfg-loader') return { loadCfg: () => ({ cli: {} }) };
				if (id === './module.app-args') return { appArgv: () => ({}) };
				if (id === './log') return { console: fakeConsole };
				if (id === 'undici')
					return {
						Agent: class {},
						ProxyAgent: class {},
						fetch: async () => {
							calls++;
							return {
								ok: status === 200,
								status,
								statusText: 'test',
								clone: () => ({
									text: async () => {
										throw new Error('body failed');
									},
									arrayBuffer: async () => {
										throw new Error('body failed');
									}
								})
							};
						}
					};
				throw new Error(`Unexpected transport import ${id}`);
			});
			const req = new Req();
			const result = await deviceHelper.requestDeviceToken({
				authUrl: 'https://www.crunchyroll.com/auth/v1/token',
				fallbackAuthUrl: 'https://beta-api.crunchyroll.com/auth/v1/token',
				headers: {},
				deviceId: 'uuid',
				signal: new AbortController().signal,
				debug: false,
				log: () => {},
				warn: (s) => warnings.push(s),
				request: req.getData.bind(req)
			});
			assert.equal(result, undefined);
			assert.equal(calls, 1);
			assert.equal(warnings.length, 0);
		}
	});
	await test('timeout after terminal response preserves status for initiation and refresh', async () => {
		for (const status of [429, 401, 200]) {
			let timer,
				calls = 0;
			const warnings = [];
			const helper = compile(path.join(root, 'modules/module.crunchy-device-auth.ts'), requireDeviceDeps, {
				setTimeout: (fn) => {
					timer = fn;
					return 1;
				},
				clearTimeout: () => {}
			});
			await helper.requestDeviceToken({
				authUrl: 'https://www.crunchyroll.com/auth/v1/token',
				fallbackAuthUrl: 'https://beta-api.crunchyroll.com/auth/v1/token',
				headers: {},
				deviceId: 'uuid',
				signal: new AbortController().signal,
				debug: false,
				log: () => {},
				warn: (s) => warnings.push(s),
				request: async () => {
					calls++;
					return {
						ok: status === 200,
						res: {
							status,
							clone: () => ({
								arrayBuffer: async () => {
									timer();
									throw new Error('timeout');
								}
							})
						}
					};
				}
			});
			assert.equal(calls, 1);
			assert.equal(warnings.length, 0);
			const original = deviceHelper.deviceAuthAttempt;
			deviceHelper.deviceAuthAttempt = async () => {
				calls++;
				return { timedOut: true, cancelled: false, result: { ok: false, res: { status, json: async () => ({}) } } };
			};
			try {
				const { service } = makeService({});
				service.token = { auth_type: 'device', refresh_token: 'old', device_id: 'uuid', expires: 0 };
				calls = 0;
				logs.length = 0;
				assert.equal(await service.refreshToken(), false);
				assert.equal(calls, 1);
				assert(!logs.some(([kind, line]) => kind === 'warn' && line.includes('beta API fallback')));
			} finally {
				deviceHelper.deviceAuthAttempt = original;
			}
		}
	});

	output.log(`1..${passed}`);
} finally {
	fs.rmSync(work, { recursive: true, force: true });
}
