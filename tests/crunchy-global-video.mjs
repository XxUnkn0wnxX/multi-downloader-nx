import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import output from 'node:console';
import { setTimeout, clearTimeout, setImmediate } from 'node:timers';
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, URL, URLSearchParams } from 'node:url';
import ts from 'typescript';

const { AbortController, Response, Headers, queueMicrotask, structuredClone } = globalThis;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageMetadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
let statusNow;
class StatusDate extends Date {
	static now() {
		return statusNow ?? Date.now();
	}
}
function statusFixtureDir(prefix) {
	const parent = path.join(root, '.tmp');
	fs.mkdirSync(parent, { recursive: true });
	return fs.mkdtempSync(path.join(parent, prefix));
}
async function within(promise) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(Error('late cleanup did not complete')), 1000);
			})
		]);
	} finally {
		clearTimeout(timer);
	}
}

const require = createRequire(import.meta.url);
function compile(file, deps = {}, overrides = {}) {
	const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
	}).outputText;
	const module = { exports: {} };
	vm.runInNewContext(
		code,
		{
			module,
			exports: module.exports,
			require: (id) => deps[id] ?? require(id),
			URL,
			URLSearchParams,
			AbortController,
			setTimeout,
			clearTimeout,
			Buffer,
			process,
			console: output,
			...overrides
		},
		{ filename: file }
	);
	return module.exports;
}
const messages = [];
const log = { debug: (...args) => messages.push(args) };
const catalog = compile('modules/module.crunchy-video-catalog.ts');
const scheduler = compile('modules/module.crunchy-discovery-scheduler.ts', { './module.crunchy-video-catalog': catalog }, { performance: { now: () => fakeNow } });
let fakeNow = 0;
scheduler.defaultDiscoveryClock.now = () => fakeNow;
scheduler.defaultDiscoveryClock.sleep = async (ms, signal) => {
	if (signal?.aborted) throw Error('discovery cancelled');
	fakeNow += ms;
};
scheduler.defaultDiscoveryClock.random = () => 0;
const statusModule = compile('modules/module.crunchy-playback-status.ts', { './module.crunchy-discovery-scheduler': scheduler });
for (const [milliseconds, expected] of [
	[0, '0s'],
	[1, '1s'],
	[59000, '59s'],
	[60000, '01:00'],
	[476000, '07:56'],
	[3600000, '01:00:00'],
	[36476000, '10:07:56'],
	[90061000, '25:01:01']
])
	assert.equal(statusModule.formatPlaybackDuration(milliseconds), expected);
const localRetryBoundary = new Date(2026, 10, 16, 23, 59, 59, 1);
const roundedLocalRetry = localRetryBoundary.getTime();
const localRetryText = statusModule.formatLocalRetryTime(roundedLocalRetry);
assert.equal(localRetryText, '17:11:2026 - 00:00:00');
assert.match(localRetryText, /^\d{2}:\d{2}:\d{4} - \d{2}:\d{2}:\d{2}$/);
assert(!localRetryText.includes('T') && !localRetryText.includes('Z'));
const recoveryModule = compile('modules/module.crunchy-playback-recovery.ts');
const manifests = compile('modules/module.crunchy-manifests.ts', { './log': { console: log }, './module.transform-mpd': {}, './module.crunchy-video-catalog': catalog });
const { discoverVideoCandidates } = compile('modules/module.crunchy-video-selection.ts', {
	'./log': { console: log },
	'./module.crunchy-video-catalog': catalog,
	'./module.crunchy-discovery-scheduler': scheduler,
	'./module.crunchy-playback-recovery': recoveryModule,
	'./module.crunchy-manifests': manifests
});
const sources = [
	{ guid: 'EN', locale: 'en-US', languageCode: 'eng' },
	{ guid: 'JA', locale: 'ja-JP', languageCode: 'jpn' }
];
const xml = (id, seconds = 4) =>
	`<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT${seconds}S"><BaseURL>https://cdn.example.test/${id}/</BaseURL><Period><AdaptationSet mimeType="video/mp4" frameRate="24"><Representation id="${id}" bandwidth="${id === 'JA' ? 9000000 : 5000000}" width="1920" height="1080"><SegmentTemplate timescale="1" duration="2" initialization="init.mp4" media="seg-$Number$.m4s"/></Representation></AdaptationSet></Period></MPD>`;
async function run({
	mismatch = false,
	ignoreTiming = false,
	failClose = false,
	rateLimited = false,
	oversized = false,
	debug = false,
	duplicateSource = false,
	duplicateTrack = false
} = {}) {
	let active = 0,
		peak = 0;
	const opened = [],
		closed = [],
		requests = [];
	messages.length = 0;
	const input = {
		sources: duplicateSource ? [...sources, sources[0]] : sources,
		requested: ['EN'],
		ordinal: 1,
		ignoreTiming,
		debug,
		headers: {},
		async acquire(source) {
			opened.push(source.guid);
			active++;
			peak = Math.max(active, peak);
			return { token: `token-${source.guid}`, url: `https://example.test/static/${source.guid}/clean/dash/manifest.mpd?sig=one` };
		},
		async close(source, token) {
			closed.push([source.guid, token]);
			active--;
			return !failClose;
		},
		req: {
			async getData(target, options) {
				requests.push([target, options]);
				if (rateLimited) return { ok: false, res: new Response('', { status: 429 }) };
				if (target.includes('/0/clean/') || target.includes('/1/clean/')) return { ok: false, res: new Response('', { status: 404 }) };
				const id = target.includes('/JA/') ? 'JA' : 'EN';
				let body = xml(id, mismatch && id === 'JA' ? 6 : 4);
				if (duplicateTrack) body = body.replace('</AdaptationSet>', `${body.match(/<Representation[\s\S]*?<\/Representation>/)[0]}</AdaptationSet>`);
				return { ok: true, res: new Response(oversized ? 'x'.repeat(catalog.VIDEO_SELECTION_DEFAULTS.maxManifestBytes + 1) : body) };
			}
		}
	};
	const result = await discoverVideoCandidates(input);
	return { result, opened, closed, requests, peak, active, messages: [...messages] };
}
const ok = await run();
assert.equal(ok.result.status, 'ok');
assert.equal(ok.result.entries.length, 2);
assert.equal(ok.result.entries[1].source.guid, 'JA');
assert.equal(ok.peak, 1);
assert.equal(ok.active, 0);
assert.deepEqual(ok.closed, [
	['EN', 'token-EN'],
	['JA', 'token-JA']
]);
assert(ok.requests.every(([, options]) => options.quietErrors && options.signal));
assert(!JSON.stringify(ok.result).includes('sig=one'));
const dedup = await run({ duplicateSource: true, duplicateTrack: true });
assert.equal(dedup.result.status, 'ok');
assert.equal(dedup.result.entries.length, 2);
assert.deepEqual(dedup.opened, ['EN', 'JA']);
const mismatched = await run({ mismatch: true });
assert.equal(mismatched.result.status, 'ok');
assert.deepEqual(
	Array.from(mismatched.result.entries, (entry) => entry.source.guid),
	['EN']
);
assert.equal(mismatched.result.timingFallbackReason, 'timing drift 2.00s');
const forced = await run({ mismatch: true, ignoreTiming: true });
assert.equal(forced.result.entries.length, 2);
assert.equal(forced.result.timingFallbackReason, undefined);
const badClose = await run({ failClose: true });
assert.equal(badClose.result.status, 'unsafe');
assert.deepEqual(badClose.opened, ['EN']);
const limited = await run({ rateLimited: true });
assert.equal(limited.result.status, 'rate-limited');
assert.deepEqual(limited.opened, ['EN']);
assert.deepEqual(limited.closed, [['EN', 'token-EN']]);
const tooLarge = await run({ oversized: true });
assert.equal(tooLarge.result.status, 'fallback');
assert.deepEqual(tooLarge.closed, [['EN', 'token-EN']]);
const debug = await run({ debug: true });
assert(debug.messages.some((entry) => String(entry[0]).includes('manifest request: https://example.test/')));
assert(debug.messages.some((entry) => String(entry[0]).includes('manifest status: 404')));
let declaredCancel = 0,
	oversizedRequests = 0;
const declaredTooLarge = await discoverVideoCandidates({
	sources: [sources[0]],
	requested: ['EN'],
	ordinal: 1,
	ignoreTiming: false,
	debug: false,
	headers: {},
	acquire: async () => ({ token: 'P', url: 'https://example.test/static/EN/clean/dash/manifest.mpd' }),
	close: async () => true,
	req: {
		getData: async () => {
			oversizedRequests++;
			return {
				ok: true,
				res: {
					status: 200,
					headers: { get: () => String(catalog.VIDEO_SELECTION_DEFAULTS.maxManifestBytes + 1) },
					body: {
						cancel: async () => {
							declaredCancel++;
							throw Error('cancel failed');
						}
					}
				}
			};
		}
	}
});
assert.equal(declaredTooLarge.status, 'fallback');
assert.equal(declaredCancel, 1);
assert.equal(oversizedRequests, 1);
const timed = compile(
	'modules/module.crunchy-video-selection.ts',
	{
		'./log': { console: log },
		'./module.crunchy-video-catalog': catalog,
		'./module.crunchy-discovery-scheduler': scheduler,
		'./module.crunchy-playback-recovery': recoveryModule,
		'./module.crunchy-manifests': manifests
	},
	{ setTimeout: (fn) => setTimeout(fn, 0) }
);
let abortSignal;
let timedClosed = 0;
const expired = await timed.discoverVideoCandidates({
	sources: [sources[0]],
	requested: ['EN'],
	ordinal: 1,
	ignoreTiming: false,
	debug: false,
	headers: {},
	acquire: async () => ({ token: 'token-EN', url: 'https://example.test/static/EN/clean/dash/manifest.mpd' }),
	close: async () => {
		timedClosed++;
		return true;
	},
	req: {
		getData: async (_url, opts) => {
			abortSignal = opts.signal;
			return { ok: true, res: { status: 200, headers: { get: () => null }, text: () => new Promise(() => {}) } };
		}
	}
});
assert.equal(expired.status, 'rate-limited');
assert.equal(abortSignal.aborted, true);
assert.equal(timedClosed, 1);
let clockReads = 0;
class ExpiredClock extends Date {
	static now() {
		return clockReads++ === 0 ? 0 : 90001;
	}
}
const expiredBefore = compile(
	'modules/module.crunchy-video-selection.ts',
	{
		'./log': { console: log },
		'./module.crunchy-video-catalog': catalog,
		'./module.crunchy-discovery-scheduler': scheduler,
		'./module.crunchy-playback-recovery': recoveryModule,
		'./module.crunchy-manifests': manifests
	},
	{ Date: ExpiredClock }
);
let began = false;
const noLease = await expiredBefore.discoverVideoCandidates({
	clock: { ...scheduler.defaultDiscoveryClock, now: () => (clockReads++ === 0 ? 0 : 90001) },
	sources: [sources[0]],
	requested: ['EN'],
	ordinal: 1,
	ignoreTiming: false,
	debug: false,
	headers: {},
	req: {},
	acquire: async () => {
		began = true;
		throw Error('must not run');
	},
	close: async () => true
});
assert.equal(noLease.status, 'rate-limited');
assert.equal(began, false);
const unknown = await discoverVideoCandidates({
	sources: [sources[0]],
	requested: ['EN'],
	ordinal: 1,
	ignoreTiming: false,
	debug: false,
	headers: {},
	req: {},
	acquire: async () => {
		throw Error('unknown outcome');
	},
	close: async () => true
});
assert.equal(unknown.status, 'unsafe');

async function androidProbe({ unavailable = false, malformed = false, failClose = false } = {}) {
	const events = [];
	let active = 0;
	let peak = 0;
	const input = {
		sources: [sources[0]],
		requested: ['EN'],
		ordinal: 1,
		ignoreTiming: false,
		debug: false,
		headers: {},
		prepareDownload: async () => {
			events.push('download');
			if (unavailable) return { status: 'unavailable' };
			active++;
			peak = Math.max(peak, active);
			return { status: 'ok', token: 'D', url: malformed ? 'not-a-url' : 'https://example.test/download.mpd' };
		},
		acquire: async () => {
			events.push('play');
			active++;
			peak = Math.max(peak, active);
			return { token: 'P', url: 'https://example.test/static/EN/clean/dash/manifest.mpd' };
		},
		resolve: (_source, lease) => {
			events.push('convert');
			return lease.url;
		},
		close: async (_source, token) => {
			events.push(`close-${token}`);
			active--;
			return !failClose;
		},
		req: {
			getData: async (target) => {
				events.push('manifest');
				return target.includes('/0/clean/') || target.includes('/1/clean/')
					? { ok: false, res: new Response('', { status: 404 }) }
					: { ok: true, res: new Response(xml('EN')) };
			}
		}
	};
	return { result: await discoverVideoCandidates(input), events, peak, active };
}
const sequentialAndroid = await androidProbe();
assert.equal(sequentialAndroid.result.status, 'ok');
assert.deepEqual(sequentialAndroid.events.slice(0, 4), ['download', 'close-D', 'play', 'convert']);
assert.equal(sequentialAndroid.events.at(-1), 'close-P');
assert.equal(sequentialAndroid.peak, 1);
assert.equal(sequentialAndroid.active, 0);
const noDownload = await androidProbe({ unavailable: true });
assert.equal(noDownload.result.status, 'ok');
assert.deepEqual(noDownload.events.slice(0, 2), ['download', 'play']);
const malformedDownload = await androidProbe({ malformed: true });
assert.equal(malformedDownload.result.status, 'unsafe');
assert.deepEqual(malformedDownload.events, ['download', 'close-D']);
const failedDownloadClose = await androidProbe({ failClose: true });
assert.equal(failedDownloadClose.result.status, 'unsafe');
assert.deepEqual(failedDownloadClose.events, ['download', 'close-D']);
let revealLate;
let lateClosed;
let openedLate = false;
const lateClosedPromise = new Promise((resolve) => {
	lateClosed = resolve;
});
const lateRun = timed.discoverVideoCandidates({
	sources: [sources[0]],
	requested: ['EN'],
	ordinal: 1,
	ignoreTiming: false,
	debug: false,
	headers: {},
	req: {},
	prepareDownload: () =>
		new Promise((resolve) => {
			revealLate = resolve;
		}),
	acquire: async () => {
		openedLate = true;
		throw Error('must not play');
	},
	close: async (_source, token) => {
		lateClosed(token);
		return true;
	}
});
assert.equal((await lateRun).status, 'unsafe');
revealLate({ status: 'ok', token: 'late-D', url: 'https://example.test/download.mpd' });
assert.equal(await within(lateClosedPromise), 'late-D');
assert.equal(openedLate, false);
let revealLatePlay;
let latePlayClosed;
let manifestAfterLate = false;
const latePlayClosedPromise = new Promise((resolve) => {
	latePlayClosed = resolve;
});
const latePlayRun = timed.discoverVideoCandidates({
	sources: [sources[0]],
	requested: ['EN'],
	ordinal: 1,
	ignoreTiming: false,
	debug: false,
	headers: {},
	req: {
		getData: async () => {
			manifestAfterLate = true;
			throw Error('must not fetch');
		}
	},
	acquire: () =>
		new Promise((resolve) => {
			revealLatePlay = resolve;
		}),
	close: async (_source, token) => {
		latePlayClosed(token);
		return true;
	}
});
assert.equal((await latePlayRun).status, 'unsafe');
revealLatePlay({ token: 'late-P', url: 'https://example.test/late.mpd' });
assert.equal(await within(latePlayClosedPromise), 'late-P');
assert.equal(manifestAfterLate, false);

// Scheduler contracts use one monotonic fake clock: no real pacing sleeps.
function testClock(random = 0) {
	let now = 0;
	const waits = [];
	return {
		clock: {
			now: () => now,
			wallNow: () => Date.parse('Sun, 06 Nov 1994 08:49:00 GMT'),
			random: () => random,
			sleep: async (ms, signal) => {
				if (signal?.aborted) throw Error('discovery cancelled');
				waits.push(ms);
				now += ms;
			}
		},
		advance: (ms) => {
			now += ms;
		},
		waits
	};
}
{
	const f = testClock();
	const pace = new scheduler.DiscoveryScheduler(50, f.clock);
	for (let i = 0; i < 8; i++) await pace.dispatch();
	assert.deepEqual(f.waits, []);
	f.advance(200);
	await pace.dispatch();
	assert.deepEqual(f.waits, [50]);
	for (let i = 0; i < 7; i++) await pace.dispatch();
	await pace.dispatch(true); // mandatory closure can overrun the batch
	await pace.dispatch();
	assert.deepEqual(f.waits, [50, 250]);
}
for (const maxCalls of [50, 160, 224]) {
	const f = testClock(1);
	const pace = new scheduler.DiscoveryScheduler(maxCalls, f.clock);
	for (let i = 0; i < maxCalls; i++) await pace.dispatch();
	assert(f.waits.reduce((a, b) => a + b, 0) <= 6000.000001);
	assert(f.waits.every((delay) => delay > 0));
}
{
	const f = testClock();
	const pace = new scheduler.DiscoveryScheduler(40, f.clock);
	for (let i = 0; i < 8; i++) await pace.dispatch();
	pace.retry(new Headers({ 'Retry-After': '2' }));
	await pace.dispatch();
	assert.deepEqual(f.waits, [2000]); // max(boundary gap, cooldown)
	pace.retry(new Headers());
	await pace.dispatch();
	pace.retry(new Headers());
	await pace.dispatch();
	assert.deepEqual(f.waits, [2000, 5000, 20000]);
	assert.throws(() => pace.retry(new Headers()), /retries exhausted/);
}
for (const [random, expected] of [
	[0, 250],
	[1, 400]
]) {
	const f = testClock(random);
	const pace = new scheduler.DiscoveryScheduler(20, f.clock);
	for (let i = 0; i < 9; i++) await pace.dispatch();
	assert.deepEqual(f.waits, [expected]);
}
for (const random of [0, 1]) {
	const f = testClock(random);
	const pace = new scheduler.DiscoveryScheduler(80, f.clock, undefined, undefined, 1000);
	for (let i = 0; i < 80; i++) {
		await pace.dispatch();
		f.advance(600);
	}
	assert.equal(f.waits.length, 9);
	assert(
		f.waits.every((wait) => wait === 1000),
		'fixed wait remains exact without response credit or scaling'
	);
	assert.equal(
		f.waits.reduce((a, b) => a + b, 0),
		9000
	);
}
{
	const f = testClock();
	const pace = new scheduler.DiscoveryScheduler(80, f.clock, undefined, undefined, 0);
	for (let i = 0; i < 80; i++) await pace.dispatch();
	assert.deepEqual(f.waits, []);
	pace.retry(new Headers({ 'Retry-After': '2' }));
	await pace.dispatch();
	pace.retry(new Headers());
	await pace.dispatch();
	pace.retry(new Headers());
	await pace.dispatch();
	assert.deepEqual(f.waits, [2000, 5000, 20000]);
	assert.throws(() => pace.retry(new Headers()), /retries exhausted/);
}
for (const value of [null, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '0', false]) {
	assert.throws(() => new scheduler.DiscoveryScheduler(9, testClock().clock, undefined, undefined, value), /nonnegative safe integer/);
}
{
	const f = testClock();
	const pace = new scheduler.DiscoveryScheduler(9, f.clock, undefined, undefined, 90000);
	for (let i = 0; i < 8; i++) await pace.dispatch();
	await assert.rejects(pace.dispatch(), /deadline/);
	assert.deepEqual(f.waits, []);
}
{
	const f = testClock();
	const abort = new AbortController();
	f.clock.sleep = async (_ms, signal) => {
		abort.abort();
		assert(signal.aborted);
		throw Error('discovery cancelled');
	};
	const pace = new scheduler.DiscoveryScheduler(9, f.clock, abort.signal, undefined, 1000);
	for (let i = 0; i < 8; i++) await pace.dispatch();
	await assert.rejects(pace.dispatch(), /cancelled/);
}

{
	const f = testClock();
	const samples = [0, 0.999, 0.5];
	f.clock.random = () => samples.shift() ?? 0;
	let slow = 0;
	const pace = new scheduler.DiscoveryScheduler(10, f.clock, undefined, undefined, undefined, undefined, true, () => slow++);
	await pace.dispatch();
	f.advance(2500); // ordinary response time does not credit the next delay
	await pace.dispatch();
	await pace.dispatch(true);
	await pace.dispatch();
	assert.deepEqual(f.waits, [700, 1100, 900]);
	await pace.playbackSleep(10000);
	await pace.dispatch();
	assert.deepEqual(f.waits, [700, 1100, 900, 10000]);
	f.advance(90000);
	pace.check();
	pace.check();
	assert.equal(slow, 1);
	assert(pace.remaining() > 0);
	f.advance(90000);
	assert.throws(() => pace.check(), /deadline/);
}
for (const fixed of [0, 1200]) {
	const f = testClock();
	const pace = new scheduler.DiscoveryScheduler(10, f.clock, undefined, undefined, fixed, undefined, true);
	await pace.dispatch();
	await pace.dispatch();
	assert.deepEqual(f.waits, fixed ? [fixed, fixed] : []);
}

{
	const f = testClock();
	const pace = new scheduler.DiscoveryScheduler(20, f.clock, undefined, undefined, 0, undefined, true);
	pace.reservePlaybackRetry();
	for (let i = 0; i < 4; i++) await pace.dispatch();
	await pace.dispatch();
	assert.deepEqual(f.waits, [750], 'qall override zero retains the retry batch gap');
}

{
	// Maximum admitted version scan uses the real discovery consumer and one shared fake clock.
	const f = testClock(0.999);
	const many = Array.from({ length: 32 }, (_, i) => ({ guid: `V${i}`, locale: 'en-US', languageCode: 'eng' }));
	let requests = 0,
		closes = 0,
		notices = 0;
	const result = await discoverVideoCandidates({
		sources: many,
		requested: ['V0'],
		ordinal: 1,
		ignoreTiming: false,
		debug: false,
		headers: {},
		clock: f.clock,
		qall: true,
		onSlow: () => notices++,
		acquire: async (source) => {
			requests++;
			return { token: source.guid, url: `https://example.test/static/${source.guid}/clean/dash/manifest.mpd` };
		},
		close: async () => {
			closes++;
			return true;
		},
		req: {
			getData: async (url) => {
				requests++;
				return url.includes('/0/clean/') || url.includes('/1/clean/') ? { ok: false, res: new Response('', { status: 404 }) } : { ok: true, res: new Response(xml('EN')) };
			}
		}
	});
	assert.equal(result.status, 'ok');
	assert.equal(requests, 128);
	assert.equal(closes, 32);
	assert.equal(f.waits.length, 128);
	assert(f.waits.every((ms) => ms === 1100));
	assert.equal(notices, 1);
}

{
	const f = testClock();
	f.advance(179500);
	let acquired = 0;
	const pace = new scheduler.DiscoveryScheduler(5, f.clock, undefined, undefined, undefined, { started: 0, creditedSleep: 0, admittedSleep: 0 }, true);
	const result = await discoverVideoCandidates({
		sources: [sources[0]],
		requested: ['EN'],
		ordinal: 1,
		ignoreTiming: false,
		debug: false,
		headers: {},
		scheduler: pace,
		acquire: async () => {
			acquired++;
			throw Error('must not acquire');
		},
		close: async () => true,
		req: {}
	});
	assert.equal(result.status, 'rate-limited');
	assert.equal(acquired, 0);
	assert.equal(pace.remaining(), 500);
}

const httpBase = Date.parse('Sun, 06 Nov 1994 08:49:00 GMT');
for (const value of ['Sun, 06 Nov 1994 08:49:37 GMT', 'Sunday, 06-Nov-94 08:49:37 GMT', 'Sun Nov  6 08:49:37 1994']) {
	assert.equal(scheduler.retryAfterMs(value, 'Sun, 06 Nov 1994 08:49:00 GMT', 0), 37000);
	assert.equal(scheduler.retryAfterMs(value, '1.5', httpBase), 37000);
}
assert.equal(scheduler.retryAfterMs('12', null, 0), 12000);
const modernDate = Date.UTC(2026, 10, 15);
assert.equal(scheduler.retryAfterMs('Tuesday, 06-Nov-68 08:49:37 GMT', null, modernDate), Date.UTC(2068, 10, 6, 8, 49, 37) - modernDate);
assert.equal(scheduler.retryAfterMs('Sunday, 06-Nov-77 08:49:37 GMT', null, modernDate), 0, 'dates more than fifty years ahead use the previous century');
assert.equal(scheduler.retryAfterMs('9'.repeat(500), null, 0), Infinity);
for (const value of ['1.5', '-1', '+1', '1e3', '1 second', 'garbage']) assert.equal(scheduler.retryAfterMs(value, null, 0), undefined);
{
	const f = testClock();
	const pace = new scheduler.DiscoveryScheduler(5, f.clock);
	assert.throws(() => pace.retry(new Headers({ 'Retry-After': '999999999999999999999999' })), /budget/);
}
async function retryProbe({ failClose = false, stallObserved = false, unsupportedNext = false } = {}) {
	const f = testClock();
	let requests = 0,
		closes = 0;
	const selection = stallObserved ? timed : { discoverVideoCandidates };
	const result = await selection.discoverVideoCandidates({
		sources: unsupportedNext ? sources.slice(0, 2) : [sources[0]],
		requested: ['EN'],
		ordinal: 1,
		ignoreTiming: false,
		debug: false,
		headers: {},
		clock: f.clock,
		acquire: async (source) => ({
			token: 'retry-' + source.guid,
			url: source.guid === sources[0].guid ? 'https://example.test/static/EN/clean/dash/manifest.mpd' : 'https://example.test/master.m3u8'
		}),
		close: async () => {
			closes++;
			return !failClose;
		},
		req: {
			getData: async (url, opts) => {
				requests++;
				if (stallObserved) {
					opts.onResponse(new Response('', { status: 429 }));
					return new Promise(() => {});
				}
				if (requests <= 3) return { ok: false, res: new Response('', { status: 429 }) };
				return url.includes('/0/clean/') || url.includes('/1/clean/') ? { ok: false, res: new Response('', { status: 404 }) } : { ok: true, res: new Response(xml('EN')) };
			}
		}
	});
	return { result, requests, closes, waits: f.waits };
}
{
	const r = await retryProbe();
	assert.equal(r.result.status, 'ok');
	assert.deepEqual(r.waits.slice(0, 3), [1000, 5000, 20000]);
	assert.equal(r.requests, 6);
	assert.equal(r.closes, 1);
	const stalled = await retryProbe({ stallObserved: true });
	assert.equal(stalled.result.status, 'rate-limited');
	assert.equal(stalled.requests, 1);
	assert.equal(stalled.closes, 1);
	const failed = await retryProbe({ failClose: true });
	assert.equal(failed.result.status, 'unsafe');
	assert.equal(failed.result.reason, 'session cleanup failed');
	const recoveredThenUnsupported = await retryProbe({ unsupportedNext: true });
	assert.equal(recoveredThenUnsupported.result.status, 'fallback');
	assert.equal(recoveredThenUnsupported.result.reason, 'unsupported manifest');
	assert.equal(recoveredThenUnsupported.closes, 2, 'both leases close before ordinary metadata fallback after a recovered rate limit');
}
{
	const abort = new AbortController();
	abort.abort();
	let dispatched = 0;
	const r = await discoverVideoCandidates({
		sources: [sources[0]],
		requested: ['EN'],
		ordinal: 1,
		ignoreTiming: false,
		debug: false,
		headers: {},
		signal: abort.signal,
		req: {},
		acquire: async () => {
			dispatched++;
		},
		close: async () => true
	});
	assert.equal(r.status, 'cancelled');
	assert.equal(dispatched, 0);
}
{
	const abort = new AbortController();
	let calls = 0,
		dispatched = 0;
	const f = testClock();
	const originalNow = f.clock.now;
	f.clock.now = () => {
		if (++calls === 3) abort.abort();
		return originalNow();
	};
	const r = await discoverVideoCandidates({
		sources: [sources[0]],
		requested: ['EN'],
		ordinal: 1,
		ignoreTiming: false,
		debug: false,
		headers: {},
		signal: abort.signal,
		clock: f.clock,
		req: {},
		acquire: async () => {
			dispatched++;
		},
		close: async () => true
	});
	assert.equal(r.status, 'cancelled');
	assert.equal(dispatched, 0);
}
{
	const abort = new AbortController();
	let reveal,
		closed = 0;
	const completion = new Promise((resolve) => {
		reveal = resolve;
	});
	let started;
	const startedPromise = new Promise((resolve) => {
		started = resolve;
	});
	const run = discoverVideoCandidates({
		sources: [sources[0]],
		requested: ['EN'],
		ordinal: 1,
		ignoreTiming: false,
		debug: false,
		headers: {},
		signal: abort.signal,
		req: {},
		acquire: () => {
			started();
			return completion;
		},
		close: async () => {
			closed++;
			return true;
		}
	});
	await startedPromise;
	abort.abort();
	assert.equal((await run).status, 'unsafe');
	reveal({ token: 'late', url: 'https://example.test/test.mpd' });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(closed, 1);
}
{
	let callback,
		hook,
		cleared = 0;
	let indicatorNow = 0;
	const writes = [];
	const indicatorModule = compile(
		'modules/module.working-indicator.ts',
		{
			'./log': {
				console: output,
				setOutputClearHook: (value) => {
					hook = value;
				}
			}
		},
		{
			setInterval: (fn, ms) => {
				assert.equal(ms, 100);
				callback = fn;
				return 1;
			},
			clearInterval: () => {
				cleared++;
			},
			Date: { now: () => indicatorNow },
			process
		}
	);
	const indicator = new indicatorModule.WorkingIndicator(true, { write: (s) => writes.push(s) });
	indicator.start();
	assert.equal(writes.length, 0);
	callback();
	assert(writes.join('').includes('Discovering video qualities'));
	indicator.waiting(2, 5000);
	callback();
	assert(writes.at(-1).includes('Retrying video manifest (2/3 in 5s)'));
	indicatorNow += 1000;
	callback();
	assert(writes.at(-1).includes('Retrying video manifest (2/3 in 4s)'));
	indicatorNow += 1000;
	callback();
	assert(writes.at(-1).includes('Retrying video manifest (2/3 in 3s)'));
	indicatorNow += 1000;
	callback();
	assert(writes.at(-1).includes('Retrying video manifest (2/3 in 2s)'));
	indicatorNow += 1000;
	callback();
	assert(writes.at(-1).includes('Retrying video manifest (2/3 in 1s)'));
	indicator.waiting(1, 5000, 'playback', 1, 2);
	callback();
	assert(writes.at(-1).includes('Retrying playback (1/2 in 5s)'));
	indicatorNow += 1000;
	callback();
	assert(writes.at(-1).includes('Retrying playback (1/2 in 4s)'));
	indicator.extraTime();
	callback();
	assert(writes.at(-1).includes('Retrying playback'));
	indicator.waiting(0, 0);
	indicator.slot(2, 2, 5000);
	callback();
	assert(writes.at(-1).includes('Waiting for playback slot'));
	indicator.phase('Checking remaining sessions…');
	callback();
	assert(writes.at(-1).includes('Checking remaining sessions…'));
	indicator.phase('Discovering video qualities');
	callback();
	assert(writes.at(-1).endsWith('Discovering all qualities is taking extra time'));
	hook();
	assert(writes.join('').includes('\x1b[?25h'));
	indicator.stop();
	indicator.stop();
	assert.equal(cleared, 1);
	assert.equal(hook, undefined);
	const resetWrites = [];
	const resetIndicator = new indicatorModule.WorkingIndicator(true, { write: (s) => resetWrites.push(s) }, 'Clearing playback sessions…');
	resetIndicator.start();
	callback();
	assert(resetWrites.join('').includes('Clearing playback sessions…'));
	resetIndicator.stop();
	assert(resetWrites.join('').includes('\x1b[?25h'));
	assert.equal(hook, undefined);
	const disabled = new indicatorModule.WorkingIndicator(false, { write: () => assert.fail('disabled spinner wrote output') });
	disabled.start();
	disabled.stop();
}

{
	// One retry budget spans different manifest families.
	const f = testClock();
	const counts = new Map();
	let closed = 0;
	const r = await discoverVideoCandidates({
		sources: [sources[0]],
		requested: ['EN'],
		ordinal: 1,
		ignoreTiming: false,
		debug: false,
		headers: {},
		clock: f.clock,
		acquire: async () => ({ token: 'P', url: 'https://example.test/static/EN/clean/dash/manifest.mpd' }),
		close: async () => {
			closed++;
			return true;
		},
		req: {
			getData: async (url) => {
				const count = (counts.get(url) ?? 0) + 1;
				counts.set(url, count);
				if (count === 1 || (url.includes('/1/clean/') && count === 2)) return { ok: false, res: new Response('', { status: 429 }) };
				return { ok: true, res: new Response(xml('EN')) };
			}
		}
	});
	assert.equal(r.status, 'rate-limited');
	assert.equal(r.reason, 'manifest rate limited: retries exhausted');
	assert.equal(r.entries, undefined, 'exhausted shared retries return no partial candidate catalogue');
	assert.equal(
		[...counts.values()].reduce((a, b) => a + b, 0),
		6
	);
	assert.equal(closed, 1);
	assert.deepEqual(f.waits.slice(0, 3), [1000, 5000, 20000]);
}
{
	// Cancel a paced boundary while holding a lease; closure must not inherit abort.
	const abort = new AbortController();
	let calls = 0,
		closes = 0;
	const f = testClock();
	f.clock.sleep = async () => {
		abort.abort();
		throw Error('discovery cancelled');
	};
	const r = await discoverVideoCandidates({
		sources: [sources[0], sources[1]],
		requested: ['EN'],
		ordinal: 1,
		ignoreTiming: false,
		debug: false,
		headers: {},
		clock: f.clock,
		signal: abort.signal,
		acquire: async (source) => ({ token: source.guid, url: `https://example.test/static/${source.guid}/clean/dash/manifest.mpd` }),
		close: async (_source, _token, signal) => {
			assert.equal(signal.aborted, false);
			closes++;
			return true;
		},
		req: {
			getData: async (url) => {
				calls++;
				return url.includes('/0/clean/') || url.includes('/1/clean/') ? { ok: false, res: new Response('', { status: 404 }) } : { ok: true, res: new Response(xml('EN')) };
			}
		}
	});
	assert.equal(r.status, 'cancelled');
	assert.equal(calls, 5);
	assert.equal(closes, 2);
}
{
	// A token that settles just before abort still has exactly one cleanup owner.
	const abort = new AbortController();
	let closed = 0;
	const r = await discoverVideoCandidates({
		sources: [sources[0]],
		requested: ['EN'],
		ordinal: 1,
		ignoreTiming: false,
		debug: false,
		headers: {},
		signal: abort.signal,
		req: {},
		acquire: () => {
			const result = Promise.resolve({ token: 'race', url: 'https://example.test/test.mpd' });
			queueMicrotask(() => abort.abort());
			return result;
		},
		close: async () => {
			closed++;
			return true;
		}
	});
	assert.equal(r.status, 'unsafe');
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(closed, 1);
}

{
	// A rate response followed by expiry during cleanup must not fall back.
	const f = testClock();
	let calls = 0;
	const r = await discoverVideoCandidates({
		sources: [sources[0]],
		requested: ['EN'],
		ordinal: 1,
		ignoreTiming: false,
		debug: false,
		headers: {},
		clock: f.clock,
		acquire: async () => ({ token: 'deadline', url: 'https://example.test/static/EN/clean/dash/manifest.mpd' }),
		close: async () => {
			f.advance(90000);
			return true;
		},
		req: {
			getData: async (url) => {
				calls++;
				if (calls === 1) return { ok: false, res: new Response('', { status: 429 }) };
				return url.includes('/0/clean/') || url.includes('/1/clean/') ? { ok: false, res: new Response('', { status: 404 }) } : { ok: true, res: new Response(xml('EN')) };
			}
		}
	});
	assert.equal(r.status, 'rate-limited');
	assert.equal(r.reason, 'discovery timed out');
}
{
	const r = await discoverVideoCandidates({
		sources: [sources[0]],
		requested: ['EN'],
		ordinal: 1,
		ignoreTiming: false,
		debug: false,
		headers: {},
		req: {},
		acquire: async () => {
			throw Error('playback HTTP 429');
		},
		close: async () => true
	});
	assert.equal(r.status, 'unsafe');
	assert.equal(r.reason, 'playback HTTP 429');
}

output.log('Crunchy global metadata discovery contracts passed');

const languageItems = [
	{ code: 'eng', cr_locale: 'en-US', locale: 'en', name: 'English', language: 'English' },
	{ code: 'jpn', cr_locale: 'ja-JP', locale: 'ja', name: 'Japanese', language: 'Japanese' }
];
const langData = {
	languages: languageItems,
	findLang: (locale) => languageItems.find((language) => language.cr_locale === locale) ?? languageItems[0],
	fixLanguageTag: (locale) => locale,
	fixAndFindCrLC: (locale) => languageItems.find((language) => language.cr_locale === locale) ?? languageItems[0],
	sortTags: (items) => items,
	locale2language: () => languageItems[0],
	sortSubtitles: (items) => items,
	subsFile: (base, index, lang, cc, tag, signs, format) => `${base}.${index}.${lang.cr_locale}.${cc ? tag : signs ? 'Signs' : 'Sub'}.${format}`
};
const activeTokens = new Set();
let peakTokens = 0,
	downloadCounter = 0;
const own = (token) => {
	activeTokens.add(token);
	peakTokens = Math.max(peakTokens, activeTokens.size);
	return token;
};
const fileWrites = new Map(),
	fileDeletes = [];
const mediaLogs = [],
	licenseCalls = [],
	downloads = [],
	mediaRequests = [],
	archiveWrites = [],
	muxCalls = [];
const fakePssh = Buffer.from('synthetic-pssh').toString('base64');
const control = {
	mismatch: false,
	reorder: false,
	vanish: false,
	failClose: false,
	sharedAudio: false,
	distinctAudio: false,
	hard: false,
	reorderBase: false,
	lateMismatch: false,
	audioClear: false,
	videoClear: false,
	playbackReject: undefined,
	playbackRefusals: undefined,
	refusalAfter: 0,
	refusalBody: undefined,
	refusalTransportError: false,
	downloadUnknown: false,
	downloadErrorStatus: false,
	refusalRetryAfter: undefined,
	nonzeroVerification: false,
	failRecoveryClose: false,
	downloadRefusals: 0,
	audioRefusals: 0,
	benefitDelayMs: 0,
	capacityLimit: 1,
	benefitsPayload: undefined,
	sessionSequence: undefined,
	rateFresh: false,
	rateDiscovery: false,
	failLicense: false,
	hls: false,
	hlsMany: false,
	downloadReject: false,
	downloadRate: false,
	downloadMalformed: false,
	downloadMissingToken: false,
	close202: false,
	deferExecDownload: false,
	close202ExecOnly: false,
	failAudioClose: false,
	failFirstDubClose: false,
	audioReject: '',
	videoReject: false,
	stallHead: false,
	badHead: 0,
	freshStructure: '',
	durationDrift: false,
	legacyMissing: false,
	allUnknown: false,
	fpsMismatch: false
};
let oldSessionActive = true;
let tokenCounter = 0;
let fastTimers = false;
let boundedTimers = 0;
let releaseExecutionDownload;
let notifyLateClose;
const mediaMpd = (source, family) => {
	const bandwidth = source === 'JA2' && family === '1' ? 14000000 : source === 'JA' && family === '1' ? 13000000 : source.startsWith('JA') ? 9000000 : 5000000;
	const locale = source.startsWith('JA') ? 'ja-JP' : 'en-US';
	const duration = control.durationDrift && source === 'JA' ? 'PT6S' : 'PT4S';
	const fps =
		control.allUnknown || (control.mismatch && source === 'JA') || (control.lateMismatch && source === 'EN' && tokenCounter >= 4)
			? ''
			: control.fpsMismatch && source === 'JA'
				? ' frameRate="23.5"'
				: ' frameRate="24"';
	const fresh = source === 'JA' && family === '1' && tokenCounter >= 3;
	const other =
		fresh && control.reorder
			? '<Representation id="other" bandwidth="1000000" width="640" height="360"><SegmentTemplate timescale="1" duration="2" initialization="other.mp4" media="other-$Number$.m4s"/></Representation>'
			: '';
	const id = fresh && control.vanish ? 'vanished' : 'video';
	const protection = `<ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"><cenc:pssh>${fakePssh}</cenc:pssh></ContentProtection>`;
	const videoAddress =
		(control.stallHead || control.badHead) && source === 'JA' && family === '1'
			? '<BaseURL>selected.mp4?sig=head</BaseURL><SegmentBase indexRange="100-120"><Initialization range="0-99"/></SegmentBase>'
			: '<SegmentTemplate timescale="1" duration="2" initialization="init.mp4" media="seg-$Number$.m4s"/>';
	const videoProtection = control.videoClear ? '' : protection;
	const audioProtection = control.audioClear ? '' : protection;
	const alternatives = [`<BaseURL>https://cdn.example.test/${source}/${family}/branch-a/</BaseURL>`, `<BaseURL>https://cdn.example.test/${source}/${family}/branch-b/</BaseURL>`];
	const bases =
		control.reorderBase && source === 'JA' && family === '1'
			? fresh
				? alternatives.reverse().join('')
				: alternatives.join('')
			: `<BaseURL>https://cdn.example.test/${source}/${family}/</BaseURL>`;
	const result = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:cenc="urn:mpeg:cenc:2013" type="static" mediaPresentationDuration="${duration}">${bases}<Period><AdaptationSet mimeType="video/mp4"${fps}>${videoProtection}${other}<Representation id="${id}" bandwidth="${bandwidth}" width="1920" height="1080">${videoAddress}</Representation></AdaptationSet><AdaptationSet mimeType="audio/mp4" lang="${locale}">${audioProtection}<Representation id="low" bandwidth="128000"><SegmentTemplate timescale="1" duration="2" initialization="low-init.mp4" media="low-$Number$.m4s"/></Representation><Representation id="high" bandwidth="192000"><SegmentTemplate timescale="1" duration="2" initialization="high-init.mp4" media="high-$Number$.m4s"/></Representation></AdaptationSet></Period></MPD>`;
	if (fresh && control.freshStructure === 'dynamic') return result.replace('type="static"', 'type="dynamic"');
	if (fresh && control.freshStructure === 'multi')
		return result.replace(
			'</MPD>',
			'<Period><AdaptationSet mimeType="video/mp4"><Representation id="tail" bandwidth="1000000" width="640" height="360"><SegmentTemplate timescale="1" duration="2" initialization="tail-init.mp4" media="tail-$Number$.m4s"/></Representation></AdaptationSet></Period></MPD>'
		);
	return result;
};
const mediaLogger = {
	info: (...a) => mediaLogs.push(Object.assign(a, { licenseCount: licenseCalls.length, downloadCount: downloads.length })),
	warn: (...a) => mediaLogs.push(a),
	error: (...a) => mediaLogs.push(a),
	debug: (...a) => mediaLogs.push(a)
};
const selectedHeads = [];
let selectedReqInstances = 0;
const realTransform = compile('modules/module.transform-mpd.ts', {
	'./module.langsData': langData,
	'./log': { console: mediaLogger },
	'./module.fetch': {
		Req: class {
			constructor() {
				selectedReqInstances++;
			}
			async getData(target, options) {
				selectedHeads.push({ target, signal: options.signal });
				if (control.badHead) return { ok: false, res: { status: control.badHead, headers: { get: () => '150' } } };
				if (control.stallHead) return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error('HEAD aborted')), { once: true }));
				throw Error('Unexpected HEAD');
			}
		}
	}
});
assert.equal(selectedReqInstances, 0, 'manifest import does not construct a request client');
const realManifests = compile('modules/module.crunchy-manifests.ts', {
	'./module.transform-mpd': realTransform,
	'./log': { console: mediaLogger },
	'./module.crunchy-video-catalog': catalog
});
const realSelection = compile(
	'modules/module.crunchy-video-selection.ts',
	{
		'./log': { console: mediaLogger },
		'./module.crunchy-video-catalog': catalog,
		'./module.crunchy-discovery-scheduler': scheduler,
		'./module.crunchy-playback-recovery': recoveryModule,
		'./module.crunchy-manifests': realManifests
	},
	{
		setTimeout: (fn, ms) => {
			boundedTimers++;
			return setTimeout(fn, fastTimers ? 0 : ms);
		}
	}
);
let cliArgs = {};
const indicatorWaits = [];
let sessionBarrier;
let indicatorStarts = 0,
	indicatorStops = 0;
let stopAtCliArguments = false;
const cliBannerSentinel = new Error('stop after CLI banner');
let fakeMergeResult = false;
let fakeMuxerPresent = true;
let muxCleanupCount = 0;
let muxTimingCount = 0;
let observedMerger;
class MergerFixture {
	constructor(options) {
		observedMerger = options;
	}
	static makeFontsList() {
		return [];
	}
	static checkMerger() {
		return fakeMuxerPresent ? { FFmpeg: 'fake' } : {};
	}
	async createDelays() {
		muxTimingCount++;
	}
	async merge() {
		return fakeMergeResult;
	}
	cleanUp() {
		muxCleanupCount++;
	}
}
const mediaDeps = {
	'./modules/module.app-args': {
		appArgv: () => {
			if (stopAtCliArguments) throw cliBannerSentinel;
			return cliArgs;
		}
	},
	'./modules/module.crunchy-device-auth': {},
	'./modules/module.crunchy-cli-auth': {
		cliInvocation: () => 'aniDL',
		crunchyCliAuthDecision: () => ({ kind: 'continue' }),
		crunchyLoginInstruction: (options) => `Keep your Crunchyroll command and replace its options with:\n  ${options}`
	},
	'./modules/module.crunchy-phone-auth': {},
	'./modules/module.crunchy-session-store': compile('modules/module.crunchy-session-store.ts'),
	'./package.json': packageMetadata,
	'./modules/module.fork-display': compile('modules/module.fork-display.ts'),
	fs: {
		existsSync: () => true,
		mkdirSync: () => {
			throw Error('unexpected mkdir');
		},
		unlinkSync(file) {
			fileDeletes.push(file);
			fileWrites.delete(file);
		},
		writeFileSync(file, body) {
			fileWrites.set(file, body);
		},
		copyFileSync() {}
	},
	'./modules/log': { console: mediaLogger },
	'./modules/module.langsData': langData,
	'./modules/module.fontsData': { assFonts: () => [] },
	'./modules/module.vtt2ass': { default: () => '[Script Info]\nPlayResX: 1920\nPlayResY: 1080', __esModule: true },
	'./modules/module.transform-mpd': realTransform,
	'./modules/module.crunchy-manifests': realManifests,
	'./modules/module.crunchy-video-catalog': catalog,
	'./modules/module.crunchy-video-selection': realSelection,
	'./modules/module.crunchy-playback-recovery': recoveryModule,
	'./modules/module.crunchy-playback-status': statusModule,
	'./modules/module.crunchy-discovery-scheduler': scheduler,
	'./modules/module.working-indicator': {
		WorkingIndicator: class {
			start() {
				indicatorStarts++;
			}
			stop() {
				indicatorStops++;
			}
			extraTime() {}
			phase() {}
			slot() {}
			waiting(...args) {
				indicatorWaits.push(args);
			}
		}
	},
	'./modules/module.cfg-loader': {
		workingDir: '',
		loadBinCfg: async () => ({ ffmpeg: 'fake', mp4decrypt: 'fake' }),
		loadCRSessions: () => ({ sessions: {} }),
		withCRTokenRefreshLock: (_slot, fn) => fn()
	},
	'./modules/module.api-urls': {
		api: { crunchyDefHeader: {}, drm_widevine: 'https://license.invalid/', me: 'https://api.example.test/me', streaming_sessions: 'https://api.example.test/sessions' },
		domain: { cr_www: 'https://www.crunchyroll.com', cr_playback: 'https://cr-play-service.prd.crunchyrollsvc.com' }
	},
	'./@types/enums': {
		CrunchyVideoPlayStreams: { androidtv: 'video', chrome: 'video', android: 'phone', androidtab: 'tablet' },
		CrunchyAudioPlayStreams: { androidtv: 'audio', chrome: 'audio', android: 'phone', androidtab: 'tablet' }
	},
	'./modules/cdm': {
		canDecrypt: true,
		cdm: 'widevine',
		getKeysWVD: async (pssh, _url, headers) => {
			licenseCalls.push({ pssh, headers });
			mediaRequests.push({ method: 'LICENSE', target: headers['x-cr-video-token'] });
			return control.failLicense ? [] : [{ kid: 'synthetic', key: 'synthetic' }];
		}
	},
	'./modules/hls-download': {
		default: class {
			constructor(options) {
				mediaRequests.push({ target: options.output, method: 'MEDIA' });
				downloads.push(options);
			}
			async download() {
				return { ok: true };
			}
		},
		__esModule: true
	},
	'./modules/module.parseSelect': compile('modules/module.parseSelect.ts', { './log': { console: output } }),
	'./modules/module.downloadArchive': { downloaded: (...args) => archiveWrites.push(args) },
	'./modules/module.merger': { default: MergerFixture, __esModule: true },
	'./modules/module.filename': {
		default: (name, variables) => [name.replace('${height}', String(variables.find((item) => item.name === 'height')?.replaceWith))],
		__esModule: true
	},
	'./modules/module.helper': { default: { exec: () => ({ isOk: true }) }, __esModule: true },
	'm3u8-parser': require('m3u8-parser')
};
const ignored = new Set([
	'./modules/module.fontsData',
	'./modules/module.app-args',
	'./modules/module.fetch',
	'./modules/module.parseSelect',
	'./modules/module.args',
	'./modules/module.vtt2ass',
	'./modules/module.crunchy-token',
	'./modules/module.crunchy-device-auth',
	'm3u8-parser'
]);
const { default: Crunchy } = compile('crunchy.ts', new Proxy(mediaDeps, { get: (target, key) => (key in target ? target[key] : ignored.has(key) ? {} : undefined) }), {
	Date: StatusDate
});
const service = Object.create(Crunchy.prototype);
service.cfg = { bin: { ffmpeg: 'fake', mp4decrypt: 'fake' }, dir: { content: '/synthetic' } };
service.token = { access_token: 'synthetic' };
service.cmsToken = { cms: {} };
service.debug = false;
const bannerLogStart = mediaLogs.length;
stopAtCliArguments = true;
await assert.rejects(service.cli(), (error) => error === cliBannerSentinel);
stopAtCliArguments = false;
assert.equal(mediaLogs[bannerLogStart][0], `\n=== Multi Downloader NX ${packageMetadata.version} (Nightly) [Rev${packageMetadata.fork.revision}] ===\n`);
service.deviceHeaders = () => ({});
service.refreshToken = async () => true;
service.sleep = async () => {};
service.muxStreams = async (data, options) => muxCalls.push({ data, options });
service.req = {
	argv: { debug: false },
	async getData(target, options = {}) {
		mediaRequests.push({ target, method: options.method });
		const hlsUrl = control.hls === 'opaque' ? 'https://example.test/master' : 'https://example.test/master.m3u8';
		if (control.subtitleFixture && target.startsWith('https://subtitle.example.test/'))
			return control.failSubtitle && target.endsWith('/full') ? { ok: false } : { ok: true, res: new Response('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nText') };
		if (control.subtitleFixture && target.includes('skip-events/production/'))
			return { ok: true, res: new Response(JSON.stringify({ intro: { type: 'intro', start: 1, end: 2 } })) };
		if (control.subtitleFixture && target.includes('/objects/'))
			return { ok: true, res: new Response(JSON.stringify({ data: [{ episode_metadata: { duration_ms: 10000 } }] })) };
		if (target === 'https://api.example.test/sessions') {
			if (sessionBarrier && mediaRequests.filter((r) => r.target === target).length === 2) {
				sessionBarrier.verifyStarted();
				await sessionBarrier.verify;
			}
			return {
				ok: true,
				res: new Response(
					JSON.stringify({
						items: control.sessionSequence?.length
							? control.sessionSequence.shift()
							: oldSessionActive
								? [{ contentId: 'old', token: 'old-token' }]
								: control.nonzeroVerification
									? [{ contentId: 'linger', token: 'linger' }]
									: []
					})
				)
			};
		}
		if (options.method === 'DELETE') {
			if (sessionBarrier && target.endsWith('/other/other-token')) {
				sessionBarrier.deleteStarted();
				await sessionBarrier.delete;
			}
			if (target.endsWith('/old/old-token')) oldSessionActive = false;
			if (control.failRecoveryClose && /token-EN-1$/.test(target)) return { ok: false, res: new Response('', { status: 503 }) };
			if (control.failFirstDubClose && target.endsWith('/EN/token-EN-4')) return { ok: false, res: new Response('', { status: 503 }) };
			if (target.endsWith('/late-D')) notifyLateClose?.();
			if (
				(control.close202 || (control.close202ExecOnly && tokenCounter >= 3) || (control.failAudioClose && target.endsWith('/EN/download-EN-4'))) &&
				target.includes('/download-')
			)
				return { ok: true, res: new Response('', { status: 202 }) };
			activeTokens.delete(target.split('/').at(-1));
			return { ok: !(control.failClose && target.includes('/JA/token-JA-3')), res: new Response('', { status: 200 }) };
		}
		if (options.method === 'PATCH') return { ok: true, res: new Response('', { status: 200 }) };
		if (target === 'https://api.example.test/me') {
			fakeNow += control.benefitDelayMs;
			return { ok: true, res: new Response(JSON.stringify({ external_id: 'synthetic' })) };
		}
		if (target.includes('/subs/v1/subscriptions/'))
			return {
				ok: true,
				res: new Response(
					JSON.stringify(control.benefitsPayload ?? { items: [{ benefit: 'offline_viewing' }, { benefit: `concurrent_streams.${control.capacityLimit}` }] })
				)
			};
		const download = /\/v3\/(EN|JA2|JA)\/(phone|tablet)\/download$/.exec(target);
		if (download) {
			if (control.downloadRefusals) {
				control.downloadRefusals--;
				const res = new Response(JSON.stringify({ error: 4294, reason: 'Too many requests' }), {
					status: 429,
					headers: control.refusalRetryAfter ? { 'Retry-After': control.refusalRetryAfter } : {}
				});
				options.onResponse?.(res);
				return { ok: false, res };
			}
			if (control.downloadUnknown) return { ok: false };
			if (control.downloadErrorStatus) return { ok: false, error: Error('truncated body'), res: new Response('', { status: 403 }) };
			if (control.downloadReject) return { ok: false, res: new Response('', { status: 404 }) };
			if (control.downloadRate) return { ok: false, res: new Response('', { status: 429 }) };
			const source = download[1];
			if (control.deferExecDownload && tokenCounter >= 3)
				return new Promise((resolve) => {
					releaseExecutionDownload = () => resolve({ ok: true, res: new Response(JSON.stringify({ token: own('late-D'), url: 'https://example.test/late.mpd' })) });
				});
			const token = own(`download-${source}-${++downloadCounter}`);
			return {
				ok: true,
				res: new Response(
					JSON.stringify({
						token: control.downloadMissingToken ? undefined : token,
						url: control.downloadMalformed
							? 'invalid-url'
							: `https://example.test/v2/manifest/download/${source}/static/majin/${source}/clean/cenc/dash/manifest.mpd?downloadGuid=synthetic`,
						hardSubs: {},
						audioLocale: control.audioLocale ?? (source.startsWith('JA') ? 'ja-JP' : 'en-US'),
						subtitles: control.subtitleFixture?.subtitles ?? {},
						captions: control.subtitleFixture?.captions ?? {}
					})
				)
			};
		}
		const playback = /\/v3\/(EN|JA2|JA)\/video\/play\?queue=0$/.exec(target);
		if (playback) {
			const source = playback[1];
			if (control.playbackRefusals?.[source] && tokenCounter >= control.refusalAfter) {
				control.playbackRefusals[source]--;
				const res = new Response(control.refusalBody ?? JSON.stringify({ error: 4294, reason: 'Too many requests' }), {
					status: 429,
					headers: control.refusalRetryAfter ? { 'Retry-After': control.refusalRetryAfter } : {}
				});
				options.onResponse?.(res);
				return { ok: false, error: control.refusalTransportError ? Error('synthetic transport error') : undefined, res };
			}
			if (control.playbackReject) return control.playbackReject === '429' ? { ok: false, res: new Response('', { status: 429 }) } : { ok: false };
			if (control.videoReject && source === 'EN' && tokenCounter >= 3) return { ok: false };
			const playbackToken = own(`token-${source}-${++tokenCounter}`);
			if ((control.deferExecDownload || control.stallHead) && source === 'JA' && tokenCounter >= 3) fastTimers = true;
			return {
				ok: true,
				res: new Response(
					JSON.stringify({
						token: playbackToken,
						url: control.hls ? hlsUrl : `https://example.test/v2/manifest/${source}/static/majin/${source}/clean/cenc/dash/manifest.mpd?sig=opaque`,
						hardSubs: control.hard
							? {
									en: {
										url: control.hls ? hlsUrl : `https://example.test/v2/manifest/${source}/static/majin/${source}/clean/cenc/dash/manifest.mpd?sig=opaque`,
										hlang: 'en-US'
									}
								}
							: {},
						audioLocale: control.audioLocale ?? (source.startsWith('JA') ? 'ja-JP' : 'en-US'),
						subtitles: control.subtitleFixture?.subtitles ?? {},
						captions: control.subtitleFixture?.captions ?? {}
					})
				)
			};
		}
		if (control.audioRefusals && /\/v3\/EN\/audio\/play\?queue=1$/.test(target)) {
			control.audioRefusals--;
			return { ok: false, res: new Response(JSON.stringify({ error: 4294, reason: 'Too many requests' }), { status: 429 }) };
		}
		if (control.audioReject && /\/v3\/EN\/audio\/play\?queue=1$/.test(target))
			return control.audioReject === '429' ? { ok: false, res: new Response('', { status: 429 }) } : { ok: false };
		if ((control.sharedAudio || control.distinctAudio) && /\/v3\/EN\/audio\/play\?queue=1$/.test(target))
			return {
				ok: true,
				res: new Response(
					JSON.stringify({
						token: own(control.distinctAudio ? 'token-EN-audio' : `token-EN-${tokenCounter}`),
						url: 'https://example.test/v2/manifest/EN/static/majin/EN/clean/cenc/dash/manifest.mpd?sig=opaque',
						hardSubs: {},
						audioLocale: 'en-US',
						subtitles: control.subtitleFixture?.subtitles ?? {},
						captions: control.subtitleFixture?.captions ?? {}
					})
				)
			};
		if (target === hlsUrl)
			return {
				ok: true,
				res: new Response(
					'#EXTM3U\n' +
						(control.hlsMany ? [5000000, 1000000, 4000000, 3000000, 2000000] : [1000000])
							.map((bandwidth) => `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=1280x720\nhttps://cdn.example.test/chunk.m3u8?sig=ok\n`)
							.join('')
				)
			};
		if (target === 'https://cdn.example.test/chunk.m3u8?sig=ok')
			return { ok: true, res: new Response('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nhttps://cdn.example.test/english.ts\n#EXT-X-ENDLIST\n') };
		const manifestRequest = /\/manifest\/(EN|JA2|JA)\/static\/(?:majin\/)?(?:EN|JA2|JA)\/(?:([01])\/)?clean\/(?:cenc\/)?dash\//.exec(target);
		if (manifestRequest && control.rateDiscovery && tokenCounter === 1) return { ok: false, res: new Response('', { status: 429 }) };
		if (manifestRequest && manifestRequest[2] && control.legacyMissing) return { ok: false, res: new Response('', { status: 404 }) };
		if (manifestRequest && control.rateFresh && manifestRequest[1] === 'JA' && manifestRequest[2] === '1' && tokenCounter >= 3)
			return { ok: false, res: new Response('', { status: 429 }) };
		if (manifestRequest) return { ok: true, res: new Response(mediaMpd(manifestRequest[1], manifestRequest[2] ?? 'current')) };
		throw Error(`Unexpected synthetic request ${target}`);
	}
};
const versions = [
	{ guid: 'EN', media_guid: 'media-en', audio_locale: 'en-US', original: false },
	{ guid: 'JA', media_guid: 'media-ja', audio_locale: 'ja-JP', original: true }
];
const mediaData = {
	data: [{ mediaId: 'EN', versions, lang: languageItems[0], playback: 'yes', isSubbed: false, isDubbed: true, durationMs: 4000 }],
	episodeNumber: '1',
	episodeTitle: 'Test',
	seasonTitle: 'Test',
	seasonID: 'season',
	showID: 'show',
	e: '1'
};
const mediaOptions = {
	qall: true,
	q: 0,
	x: 1,
	hslang: 'none',
	vstream: 'androidtv',
	astream: 'androidtv',
	cstream: false,
	dubLang: ['eng'],
	chapters: false,
	novids: false,
	noaudio: false,
	skipsubs: true,
	nosubs: true,
	dlsubs: ['none'],
	dlVideoOnce: true,
	fileName: 'show-${height}',
	numbers: 1,
	override: [],
	partsize: 2,
	fsRetryTime: 0,
	timeout: 1,
	force: 'y',
	nocleanup: false,
	waittime: 0,
	skipmux: false
};
function selectedVideoRows() {
	return mediaLogs
		.filter((entry) => String(entry[0]).startsWith('Available Video Qualities:'))
		.flatMap((entry) =>
			String(entry[0])
				.split('\n')
				.filter((line) => line.includes('<-- Selected'))
		);
}
assert.equal(await service.downloadEpisode(mediaData, mediaOptions), true);
assert.equal(mediaLogs.filter((entry) => String(entry[0]).startsWith('Available Video Qualities:')).length, 1);
const compactGlobalQualities = String(mediaLogs.find((entry) => String(entry[0]).startsWith('Available Video Qualities:'))[0]);
assert(compactGlobalQualities.includes('[3]') && compactGlobalQualities.includes('[5]'), 'current rows retain their original indices when compact display leaves gaps');
assert.equal((compactGlobalQualities.match(/\[Legacy M\]/g) ?? []).length, 4, 'four legacy rows remain visible');
assert.doesNotMatch(compactGlobalQualities, /qualit(?:y|ies) hidden|use --qall/);
assert.equal(selectedVideoRows().length, 1);
assert(mediaLogs.some((entry) => String(entry[0]).includes('[6]') && String(entry[0]).includes('[Legacy M] [V:jpn] <-- Selected')));
assert(mediaLogs.some((entry) => String(entry[0]).includes('Selected video:') && String(entry[0]).includes('[V:jpn]')));
const globalAudioQualities = mediaLogs.find((entry) => String(entry[0]).startsWith('Available Audio Qualities:'));
assert(globalAudioQualities);
const globalAudioLines = String(globalAudioQualities[0]).split('\n');
const globalSelectedAudioIndex = globalAudioLines.findIndex((line) => line.includes('<-- Selected'));
assert.equal(globalAudioLines[globalSelectedAudioIndex], '    [1] 192 kb/s [A:eng] <-- Selected');
assert.equal(globalAudioLines[globalSelectedAudioIndex + 1], '        Audio Server: cdn.example.test');
assert.equal(mediaLogs.filter((entry) => String(entry[0]).startsWith('Available Audio Qualities:')).length, 1);
assert.equal(mediaLogs.filter((entry) => String(entry[0]).includes('Audio Server:')).length, 1);
assert(!mediaLogs.some((entry) => String(entry[0]).includes('Selected audio:')));
assert(mediaLogs.some((entry) => String(entry[0]).includes('[Legacy M] [V:jpn]')));
assert(mediaLogs.some((entry) => String(entry[0]).includes('[Current M] [V:eng]')));

assert.deepEqual(
	licenseCalls.map((call) => [call.pssh, call.headers['x-cr-content-id'], call.headers['x-cr-video-token']]),
	[
		[fakePssh, 'JA', 'token-JA-3'],
		[fakePssh, 'EN', 'token-EN-4']
	]
);
assert.equal(downloads.length, 2);
assert(downloads[0].m3u8json.segments[0].uri.includes('/JA/1/'));
assert(downloads[1].m3u8json.segments[0].uri.includes('/EN/current/high-'));
assert(muxCalls[0].data.every((item) => item.path.includes('show-1080.English')));
assert.equal(muxCalls.length, 1);
assert(muxCalls[0].options.output.includes('show-1080'));
assert.equal(archiveWrites.length, 1);
assert.equal(mediaRequests.filter((request) => request.method === 'DELETE').length, 4);
assert(!mediaLogs.some((entry) => String(entry[0]).includes('[Notice: falling back')));
const encryptedVideoClose = mediaRequests.findIndex((request) => request.method === 'DELETE' && request.target.endsWith('/JA/token-JA-3'));
const encryptedVideoMedia = mediaRequests.findIndex((request) => request.method === 'MEDIA' && request.target.includes('.video.enc.m4s'));
const encryptedAudioClose = mediaRequests.findIndex((request) => request.method === 'DELETE' && request.target.endsWith('/EN/token-EN-4'));
const encryptedAudioMedia = mediaRequests.findIndex((request) => request.method === 'MEDIA' && request.target.includes('.audio.enc.m4s'));
assert(mediaRequests.findIndex((request) => request.method === 'LICENSE' && request.target === 'token-JA-3') < encryptedVideoClose);
assert(encryptedVideoClose >= 0 && encryptedVideoClose < encryptedVideoMedia);
assert(mediaRequests.findIndex((request) => request.method === 'LICENSE' && request.target === 'token-EN-4') < encryptedAudioClose);
assert(encryptedAudioClose >= 0 && encryptedAudioClose < encryptedAudioMedia);

function resetGlobal(overrides = {}) {
	mediaLogs.length = 0;
	fileWrites.clear();
	fileDeletes.length = 0;
	indicatorWaits.length = 0;
	sessionBarrier = undefined;
	selectedHeads.length = 0;
	licenseCalls.length = 0;
	downloads.length = 0;
	mediaRequests.length = 0;
	archiveWrites.length = 0;
	muxCalls.length = 0;
	tokenCounter = 0;
	oldSessionActive = true;
	downloadCounter = 0;
	fastTimers = false;
	releaseExecutionDownload = undefined;
	notifyLateClose = undefined;
	peakTokens = 0;
	activeTokens.clear();
	Object.assign(
		control,
		{
			mismatch: false,
			reorder: false,
			vanish: false,
			failClose: false,
			sharedAudio: false,
			distinctAudio: false,
			hard: false,
			reorderBase: false,
			lateMismatch: false,
			audioClear: false,
			videoClear: false,
			playbackReject: undefined,
			playbackRefusals: undefined,
			refusalAfter: 0,
			refusalBody: undefined,
			refusalTransportError: false,
			downloadUnknown: false,
			downloadErrorStatus: false,
			refusalRetryAfter: undefined,
			nonzeroVerification: false,
			failRecoveryClose: false,
			downloadRefusals: 0,
			audioRefusals: 0,
			benefitDelayMs: 0,
			capacityLimit: 1,
			benefitsPayload: undefined,
			sessionSequence: undefined,
			rateFresh: false,
			rateDiscovery: false,
			failLicense: false,
			hls: false,
			hlsMany: false,
			downloadReject: false,
			downloadRate: false,
			downloadMalformed: false,
			downloadMissingToken: false,
			close202: false,
			deferExecDownload: false,
			close202ExecOnly: false,
			failAudioClose: false,
			failFirstDubClose: false,
			audioReject: '',
			videoReject: false,
			stallHead: false,
			badHead: 0,
			freshStructure: '',
			durationDrift: false,
			legacyMissing: false,
			allUnknown: false,
			fpsMismatch: false,
			subtitleFixture: undefined,
			failSubtitle: false,
			audioLocale: undefined
		},
		overrides
	);
}
// Failed or missing mux results must not trigger source cleanup; valid output may clean up.
{
	const originalMux = service.muxStreams;
	service.muxStreams = Crunchy.prototype.muxStreams.bind(service);
	const source = [{ type: 'Video', path: '/synthetic/source.mp4', lang: languageItems[0] }];
	const options = {
		...mediaOptions,
		output: '/synthetic/output',
		defaultAudio: languageItems[0],
		defaultSub: languageItems[0],
		ffmpegOptions: [],
		mkvmergeOptions: []
	};
	muxCleanupCount = 0;
	fakeMuxerPresent = true;
	fakeMergeResult = false;
	assert.equal(await service.muxStreams(source, options), false);
	assert.equal(muxCleanupCount, 0, 'failed mux preserves source tracks');
	fakeMergeResult = true;
	assert.equal(await service.muxStreams(source, options), true);
	assert.equal(muxCleanupCount, 1, 'successful mux cleans source tracks');
	fakeMuxerPresent = false;
	assert.equal(await service.muxStreams(source, options), false);
	assert.equal(muxCleanupCount, 1, 'missing muxer preserves source tracks');
	service.muxStreams = originalMux;
}
// A failed mux leaves downloaded tracks recoverable and never records the episode as complete.
{
	resetGlobal();
	const originalMux = service.muxStreams;
	service.muxStreams = async () => false;
	assert.equal(await service.downloadEpisode(mediaData, mediaOptions), false);
	assert(downloads.length > 0, 'media was downloaded before mux failure');
	assert.equal(archiveWrites.length, 0, 'mux failure is not recorded in the download archive');
	service.muxStreams = originalMux;
}
// Actual Crunchyroll mux wiring uses explicit stream layout even without separate audio.
{
	const originalMux = service.muxStreams;
	service.muxStreams = Crunchy.prototype.muxStreams.bind(service);
	try {
		resetGlobal();
		fakeMuxerPresent = true;
		fakeMergeResult = true;
		assert.equal(
			await service.muxStreams([{ type: 'Video', path: '/synthetic/split.m4s', lang: languageItems[0], layout: 'split' }], {
				...mediaOptions,
				output: '/synthetic/out',
				noaudio: true,
				muxAudioLanguages: [languageItems[1], languageItems[0]]
			}),
			true
		);
		assert.equal(observedMerger.onlyVid.length, 1);
		assert.equal(observedMerger.videoAndAudio.length, 0);
		assert.deepEqual(
			Array.from(observedMerger.crunchy.languages, (lang) => lang.code),
			['jpn', 'eng']
		);
		assert.equal(observedMerger.crunchy.noaudio, true);
		assert.equal(
			await service.muxStreams([{ type: 'Video', path: '/synthetic/combined.ts', lang: languageItems[0], layout: 'combined' }], {
				...mediaOptions,
				output: '/synthetic/out',
				noaudio: true,
				allDubs: true
			}),
			true
		);
		assert.equal(observedMerger.onlyVid.length, 0);
		assert.equal(observedMerger.videoAndAudio.length, 1);
		assert.equal(observedMerger.crunchy.allDubs, true);
		const regional = { ...languageItems[0], cr_locale: 'en-IN', locale: 'en-IN', name: 'English (India)' };
		assert.equal(
			await service.muxStreams(
				[
					{ type: 'Video', path: '/synthetic/split.m4s', lang: languageItems[0], layout: 'split' },
					{ type: 'Audio', path: '/synthetic/audio.m4s', lang: languageItems[0], muxLang: regional }
				],
				{ ...mediaOptions, output: '/synthetic/out' }
			),
			true
		);
		assert.equal(observedMerger.onlyAudio[0].lang.cr_locale, 'en-US', 'existing source language remains unchanged');
		assert.equal(observedMerger.onlyAudio[0].orderLang.cr_locale, 'en-IN', 'mux grouping retains the actual regional locale');
		muxTimingCount = 0;
		assert.equal(
			await service.muxStreams(
				[
					{ type: 'Video', path: '/synthetic/split.m4s', lang: languageItems[0], layout: 'split' },
					{ type: 'Video', path: '/synthetic/combined.ts', lang: languageItems[1], layout: 'combined' },
					{ type: 'Audio', path: '/synthetic/audio.m4s', lang: languageItems[0] }
				],
				{ ...mediaOptions, output: '/synthetic/out', syncTiming: true }
			),
			true
		);
		assert.equal(muxTimingCount, 0, 'mixed inputs with separate audio retain the previous timing no-op');
		assert.equal(observedMerger.onlyVid[0].sourceIndex, 0);
		assert.equal(observedMerger.videoAndAudio[0].sourceIndex, 1);
		assert.equal(
			await service.muxStreams([{ type: 'Video', path: '/synthetic/combined.ts', lang: languageItems[0], layout: 'combined' }], {
				...mediaOptions,
				output: '/synthetic/out',
				syncTiming: true
			}),
			true
		);
		assert.equal(muxTimingCount, 1, 'unmixed combined input retains the existing timing call');
	} finally {
		service.muxStreams = originalMux;
	}
}
// Real subtitle collection and subtitle-only chapter cleanup use isolated in-memory files.
{
	const originalMux = service.muxStreams;
	const regional = { code: 'eng', cr_locale: 'en-IN', locale: 'en-IN', name: 'English (India)', language: 'English (India)' };
	languageItems.push(regional);
	const subtitles = {
		signs: { language: 'en-US', format: 'vtt', url: 'https://subtitle.example.test/signs' },
		full: { language: 'en-IN', format: 'vtt', url: 'https://subtitle.example.test/full' }
	};
	const captions = { cc: { language: 'en-US', format: 'vtt', url: 'https://subtitle.example.test/cc' } };
	const fixture = { subtitles, captions };
	const subtitleOptions = {
		...mediaOptions,
		novids: true,
		noaudio: true,
		chapters: true,
		qall: false,
		skipsubs: false,
		nosubs: false,
		dlsubs: ['all'],
		ccTag: 'CC',
		noSubFix: true,
		fileName: 'subtitle-test'
	};
	try {
		service.muxStreams = Crunchy.prototype.muxStreams.bind(service);
		for (const mode of [{}, { CC: false }, { noASSConv: true }, { nocleanup: true }, { skipmux: true }, { failSubtitle: true }]) {
			resetGlobal({ subtitleFixture: fixture, failSubtitle: !!mode.failSubtitle });
			fileWrites.set('/synthetic/unrelated.txt', 'keep');
			const { failSubtitle, ...options } = mode;
			assert.equal(await service.downloadEpisode(mediaData, { ...subtitleOptions, ...options }), true);
			const subtitleFiles = [...fileWrites.keys()].filter((name) => /\.(?:ass|vtt)$/.test(name));
			assert.equal(subtitleFiles.length, mode.CC === false || mode.failSubtitle ? 2 : 3);
			assert(subtitleFiles.some((name) => name.includes('en-US.Signs.')));
			if (!mode.failSubtitle)
				assert(
					subtitleFiles.some((name) => name.includes('en-IN.Sub.')),
					'regional English full subtitles are not signs'
				);
			assert.equal(
				subtitleFiles.some((name) => name.includes('en-US.CC.')),
				mode.CC !== false
			);
			assert(subtitleFiles.every((name) => name.endsWith(mode.noASSConv ? '.vtt' : '.ass')));
			assert.equal(
				mediaRequests.some((request) => request.target.endsWith('/cc')),
				mode.CC !== false
			);
			assert.equal(fileWrites.get('/synthetic/unrelated.txt'), 'keep');
			assert.equal(fileDeletes.length, mode.nocleanup || mode.skipmux || mode.failSubtitle ? 0 : 1);
			assert.equal([...fileWrites.keys()].filter((name) => name.endsWith('.txt')).length, mode.nocleanup || mode.skipmux || mode.failSubtitle ? 2 : 1);
		}
		resetGlobal();
		fileWrites.set('/synthetic/chapter.txt', 'keep');
		const chapters = [{ type: 'Chapters', path: '/synthetic/chapter.txt', lang: languageItems[0] }];
		await service.muxStreams(chapters, { ...subtitleOptions, dryRun: true });
		assert.equal(fileWrites.get('/synthetic/chapter.txt'), 'keep', 'dry-run preserves recorded chapters');
		await service.muxStreams([...chapters, ...chapters], subtitleOptions);
		assert.deepEqual(fileDeletes, ['/synthetic/chapter.txt'], 'recorded chapter paths are deduplicated');
		resetGlobal({ subtitleFixture: fixture, audioLocale: 'xx-YY' });
		assert.equal(await service.downloadEpisode(mediaData, { ...subtitleOptions, chapters: false }), true);
		assert(![...fileWrites.keys()].some((name) => name.includes('.Signs.')), 'unknown audio locales cannot produce signs');
		resetGlobal({ subtitleFixture: fixture });
		service.muxStreams = originalMux;
		assert.equal(await service.downloadEpisode(mediaData, { ...subtitleOptions, novids: false, noaudio: false, chapters: false }), true);
		assert.equal(
			mediaRequests.filter((request) => request.target.startsWith('https://subtitle.example.test/')).length,
			3,
			'global video pass does not duplicate subtitle fetching'
		);
		const globalSubs = muxCalls[0].data.filter((item) => item.type === 'Subtitle');
		assert.equal(globalSubs.length, 3);
		assert(globalSubs.every((item) => item.file.endsWith('.ass') && item.path.endsWith('.ass') && fileWrites.has(item.path)));
		assert(globalSubs.some((item) => item.language.cr_locale === 'en-US' && item.signs && !item.cc));
		assert(globalSubs.some((item) => item.language.cr_locale === 'en-IN' && !item.signs && !item.cc));
		assert(globalSubs.some((item) => item.cc && !item.signs));
	} finally {
		service.muxStreams = originalMux;
		languageItems.pop();
	}
}
resetGlobal();
const japaneseMediaData = { ...mediaData, data: [{ ...mediaData.data[0], lang: languageItems[1] }] };
const originalFindLang = langData.findLang;
langData.findLang = (locale) => languageItems.find((language) => language.cr_locale === locale) ?? { code: 'und', cr_locale: 'und', locale: 'un', name: 'Undetermined' };
try {
	assert.equal(await service.downloadEpisode(japaneseMediaData, { ...mediaOptions, dubLang: ['jpn'], dryRun: true }), true);
	const japaneseAudioQualities = mediaLogs.find((entry) => String(entry[0]).startsWith('Available Audio Qualities:'));
	assert(japaneseAudioQualities);
	assert(String(japaneseAudioQualities[0]).includes('[A:jpn] <-- Selected'));
	assert(mediaLogs.some((entry) => String(entry[0]).includes('Selected video:') && String(entry[0]).includes('[V:jpn]')));
} finally {
	langData.findLang = originalFindLang;
}

resetGlobal({ reorder: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), true);
assert(downloads[0].m3u8json.segments[0].uri.includes('/JA/1/seg-'));
resetGlobal({ reorderBase: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), true);
assert(downloads[0].m3u8json.segments[0].uri.includes('/JA/1/branch-b/'));
resetGlobal({ vanish: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, q: 6 }), false);
assert.equal(downloads.length, 0);
assert.equal(archiveWrites.length, 0);
assert.equal(muxCalls.length, 0);
resetGlobal();
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, q: 999 }), false);
assert.equal(mediaLogs.filter((entry) => String(entry[0]).includes('<-- Selected')).length, 0);
resetGlobal({ vanish: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), true);
assert(downloads[0].m3u8json.segments[0].uri.includes('/EN/current/'));
assert.equal(mediaLogs.filter((entry) => String(entry[0]).startsWith('Available Video Qualities:')).length, 1);
const discardedRow = mediaLogs.findIndex((entry) => String(entry[0]).includes('<-- Discarded'));
const reselectedRow = mediaLogs.findIndex((entry) => String(entry[0]).includes('<-- Re-selected'));
assert(discardedRow >= 0 && reselectedRow > discardedRow);
assert(mediaLogs[discardedRow].join(' ').includes('[Legacy M] [V:jpn]'));
assert(mediaLogs[reselectedRow].join(' ').includes('[Current M] [V:eng]'));
const originalQualityRows = mediaLogs.find((entry) => String(entry[0]).startsWith('Available Video Qualities:'))[0].split('\n');
assert.equal(mediaLogs[discardedRow][0], originalQualityRows.find((row) => row.endsWith('<-- Selected')).replace('<-- Selected', '<-- Discarded'));
assert(originalQualityRows.includes(mediaLogs[reselectedRow][0].replace(' <-- Re-selected', '')));
assert.equal(mediaLogs[reselectedRow].licenseCount, 0);
assert.equal(mediaLogs[reselectedRow].downloadCount, 0);
assert.equal(mediaLogs.filter((entry) => String(entry[0]) === '[Notice: falling back to eng video — stream changed]').length, 1);
assert(mediaLogs.findIndex((entry) => String(entry[0]) === '[Notice: falling back to eng video — stream changed]') > reselectedRow);
assert.equal(selectedVideoRows().length, 1);
resetGlobal({ mismatch: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), true);
assert(downloads[0].m3u8json.segments[0].uri.includes('/EN/'));
assert.equal(mediaLogs.filter((entry) => String(entry[0]) === '[Notice: falling back to eng video — timing unknown]').length, 1);
resetGlobal({ allUnknown: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, dryRun: true }), true);
assert.equal(mediaLogs.filter((entry) => String(entry[0]) === '[Notice: falling back to eng video — timing unknown]').length, 1);
assert.equal(mediaLogs.filter((entry) => String(entry[0]).startsWith('Available Video Qualities:')).length, 0);
assert.equal(mediaLogs.filter((entry) => String(entry[0]).includes('<-- Discarded')).length, 0);
assert.equal(mediaLogs.filter((entry) => String(entry[0]).includes('<-- Re-selected')).length, 1);
assert(mediaLogs.findIndex((entry) => String(entry[0]).includes('[Notice: falling back')) < mediaLogs.findIndex((entry) => String(entry[0]).includes('<-- Re-selected')));
resetGlobal({ allUnknown: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, q: 1, dryRun: true }), true);
assert(!mediaLogs.some((entry) => String(entry[0]).includes('[Notice: falling back')));
assert.equal(selectedVideoRows().length, 1);
resetGlobal({ fpsMismatch: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), true);
assert.equal(mediaLogs.filter((entry) => String(entry[0]) === '[Notice: falling back to eng video — frame rate differs]').length, 1);
resetGlobal({ durationDrift: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), true);
assert.equal(mediaLogs.filter((entry) => String(entry[0]) === '[Notice: falling back to eng video — timing drift 2.00s]').length, 1);
const timingReplacement = mediaLogs.find((entry) => String(entry[0]).includes('<-- Re-selected'));
assert(timingReplacement?.[0].includes('[Current M] [V:eng]'));
assert.equal(timingReplacement.licenseCount, 0);
assert.equal(timingReplacement.downloadCount, 0);
assert.equal(mediaLogs.filter((entry) => String(entry[0]).includes('<-- Discarded')).length, 0);
assert.equal(mediaLogs.filter((entry) => String(entry[0]).startsWith('Available Video Qualities:')).length, 1);
resetGlobal({ mismatch: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, q: 1 }), true);
assert(!mediaLogs.some((entry) => String(entry[0]).includes('[Notice: falling back')));
assert.equal(selectedVideoRows().length, 1);
resetGlobal({ legacyMissing: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), true);
assert(!mediaLogs.some((entry) => String(entry[0]).includes('[Notice: falling back')));
resetGlobal({ mismatch: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, bypasssync: true }), true);
assert(downloads[0].m3u8json.segments[0].uri.includes('/JA/1/'));
assert.equal(mediaLogs.filter((entry) => String(entry[0]).includes('Forced video timing')).length, 1);
assert(!mediaLogs.some((entry) => String(entry[0]).includes('[Notice: falling back')));
resetGlobal({ mismatch: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, noaudio: true }), true);
assert.equal(downloads.length, 1);
assert.equal(licenseCalls.length, 1);
assert(downloads[0].m3u8json.segments[0].uri.includes('/JA/1/'));
assert(!mediaLogs.some((entry) => String(entry[0]).includes('[Notice: falling back')));
const noaudioQualityList = mediaLogs.find((entry) => String(entry[0]).startsWith('Available Audio Qualities:'));
if (noaudioQualityList) assert(!String(noaudioQualityList[0]).includes('<-- Selected'));
assert(!mediaLogs.some((entry) => String(entry[0]).includes('Audio Server:')));
assert(!mediaLogs.some((entry) => String(entry[0]).includes('Selected audio:')));
resetGlobal({ lateMismatch: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), false);
assert.equal(downloads.length, 1);
assert.equal(licenseCalls.length, 1);
assert.equal(muxCalls.length, 0);
assert.equal(archiveWrites.length, 0);
resetGlobal({ lateMismatch: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, bypasssync: true }), true);
assert.equal(mediaLogs.filter((entry) => String(entry[0]).includes('Forced video timing')).length, 1);
resetGlobal({ audioClear: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), true);
assert.equal(licenseCalls.length, 1);
assert(downloads[1].output.endsWith('show-1080.English.audio.m4s'));
resetGlobal({ videoClear: true, audioClear: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), true);
const clearVideoClose = mediaRequests.findIndex((request) => request.method === 'DELETE' && request.target.endsWith('/JA/token-JA-3'));
const clearVideoMedia = mediaRequests.findIndex((request) => request.method === 'MEDIA' && request.target.endsWith('.video.m4s'));
const clearAudioClose = mediaRequests.findIndex((request) => request.method === 'DELETE' && request.target.endsWith('/EN/token-EN-4'));
const clearAudioMedia = mediaRequests.findIndex((request) => request.method === 'MEDIA' && request.target.endsWith('.audio.m4s'));
assert(clearVideoClose >= 0 && clearVideoClose < clearVideoMedia);
assert(clearAudioClose >= 0 && clearAudioClose < clearAudioMedia);
assert.equal(licenseCalls.length, 0);
resetGlobal({ videoClear: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), true);
assert.equal(licenseCalls.length, 1);
assert(downloads[0].output.endsWith('show-1080.English.video.m4s'));
assert(downloads[1].output.endsWith('.audio.enc.m4s'));
resetGlobal();
const originalDownloadMediaList = service.downloadMediaList;
service.downloadMediaList = async function (...args) {
	const result = await originalDownloadMediaList.apply(this, args);
	if (args[2]?.kind === 'audio') args[1].subdlfailed = true;
	return result;
};
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, skipMuxOnSubFail: true }), true);
assert.equal(muxCalls[0].options.subdlfailed, true);
delete service.downloadMediaList;
resetGlobal({ failLicense: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), false);
assert.equal(tokenCounter, 3);
assert.equal(downloads.length, 0);
assert(mediaRequests.some((request) => request.method === 'DELETE' && request.target.endsWith('/JA/token-JA-3')));
assert.equal(archiveWrites.length, 0);
for (const [freshStructure, bypass] of [
	['dynamic', { noaudio: true }],
	['multi', { bypasssync: true }]
]) {
	resetGlobal({ freshStructure });
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, ...bypass }), true);
	assert(downloads[0].m3u8json.segments[0].uri.includes('/EN/current/'));
	assert(!downloads.some((download) => download.m3u8json.segments.some((segment) => segment.uri.includes('/JA/1/'))));
}
for (const badHead of [403, 429]) {
	resetGlobal({ badHead });
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), false);
	assert.equal(selectedHeads.length, 1);
	assert.equal(tokenCounter, 3);
	assert.equal(licenseCalls.length, 0);
	assert.equal(downloads.length, 0);
	assert(mediaRequests.some((request) => request.method === 'DELETE' && request.target.endsWith('/JA/token-JA-3')));
	assert.equal(muxCalls.length, 0);
	assert.equal(archiveWrites.length, 0);
}
assert.equal(selectedReqInstances, 1, 'HEAD requests reuse one lazily created client');
resetGlobal({ stallHead: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, q: 6 }), false);
assert.equal(selectedHeads.length, 1);
assert(selectedHeads[0].target.includes('/JA/1/selected.mp4?sig=head'));
assert.equal(selectedHeads[0].signal.aborted, true);
assert.equal(tokenCounter, 3);
assert.equal(licenseCalls.length, 0);
assert.equal(downloads.length, 0);
assert(mediaRequests.some((request) => request.method === 'DELETE' && request.target.endsWith('/JA/token-JA-3')));
assert.equal(muxCalls.length, 0);
assert.equal(archiveWrites.length, 0);
fastTimers = false;
resetGlobal({ rateFresh: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), false);
assert.equal(tokenCounter, 3);
assert.equal(downloads.length, 0);
assert.equal(archiveWrites.length, 0);
resetGlobal({ rateDiscovery: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), false);
assert.equal(tokenCounter, 1);
assert.equal(
	mediaRequests.filter((request) => request.target.includes('/clean/cenc/dash/')).length,
	4,
	'initial discovery request and three retries stop at shared-budget exhaustion'
);
assert.equal(mediaRequests.filter((request) => request.method === 'DELETE').length, 1, 'the playback lease closes once after retry exhaustion');
assert(mediaLogs.some((entry) => String(entry[0]).includes('Video discovery stopped: manifest rate limited: retries exhausted')));
assert(!mediaLogs.some((entry) => String(entry[0]).startsWith('Available Video Qualities:')));
assert(!mediaLogs.some((entry) => String(entry[0]).includes('[Notice: falling back')));
assert.equal(downloads.length, 0);
assert.equal(licenseCalls.length, 0);
assert(!mediaRequests.some((request) => request.method === 'MEDIA' || request.method === 'LICENSE'));
assert(!mediaRequests.some((request) => request.target.includes('/subs/')));
assert(!mediaLogs.some((entry) => ['Video first media segment URL:', 'Audio first media segment URL:'].includes(entry[0])));
assert.equal(muxCalls.length, 0);
assert.equal(archiveWrites.length, 0);
resetGlobal();
mediaDeps['./modules/cdm'].cdm = 'playready';
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), false);
assert.equal(downloads.length, 0);
assert.equal(muxCalls.length, 0);
assert.equal(archiveWrites.length, 0);
mediaDeps['./modules/cdm'].cdm = 'widevine';
resetGlobal({ vanish: true, failClose: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), false);
assert.equal(tokenCounter, 3);
assert.equal(downloads.length, 0);
resetGlobal({ failClose: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), false);
assert.equal(downloads.length, 0);
assert.equal(archiveWrites.length, 0);
assert.equal(muxCalls.length, 0);
resetGlobal();
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, dryRun: true }), true);
assert.equal(downloads.length, 0);
assert.equal(licenseCalls.length, 0);
assert.equal(archiveWrites.length, 0);
assert.equal(muxCalls.length, 0);
assert(mediaLogs.some((entry) => entry[0] === 'Video first media segment URL:' && String(entry[1]).includes('/JA/1/')));
assert(mediaLogs.some((entry) => entry[0] === 'Audio first media segment URL:' && String(entry[1]).includes('/EN/current/high-')));
for (const [fixedPause, expectedWait] of [
	[undefined, 5600],
	[0, 0],
	[50, 400],
	[750, 6000]
]) {
	resetGlobal();
	const before = fakeNow;
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, discoveryTimmer: fixedPause, dryRun: true }), true);
	assert.equal(fakeNow - before, expectedWait, 'real Crunchy consumer passes the fixed timer to discovery');
	assert.equal(mediaRequests.filter((request) => request.method === 'DELETE').length, 4);
}
resetGlobal();
service.debug = true;
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, dryRun: true }), true);
assert(mediaLogs.some((entry) => String(entry[0]).includes('Selected manifest request: https://')));
assert(mediaLogs.some((entry) => String(entry[0]).includes('Selected manifest status: 200')));
assert(mediaLogs.some((entry) => String(entry[0]).includes('parsed and matched representation')));
service.debug = false;

resetGlobal();
const variantVersions = [...versions, { guid: 'JA2', media_guid: 'media-ja2', audio_locale: 'ja-JP', original: true }];
const variantData = { ...mediaData, data: [{ ...mediaData.data[0], versions: variantVersions }] };
assert.equal(await service.downloadEpisode(variantData, { ...mediaOptions }), true);
assert.equal(licenseCalls[0].headers['x-cr-content-id'], 'JA2');
assert(downloads[0].m3u8json.segments[0].uri.includes('/JA2/1/'));

{
	const budget = { used: false };
	resetGlobal();
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, queueRecovery: budget, dryRun: true }), true);
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, queueRecovery: budget, dryRun: true }), true);
	assert.equal(mediaLogs.filter((entry) => String(entry[0]).includes('Full stream discovery scans')).length, 1);
}
// Default video scope follows selected item languages, not stale GUI dub options or other versions.
resetGlobal();
assert.equal(await service.downloadEpisode(variantData, { ...mediaOptions, qall: false, dryRun: true }), true);
assert(mediaRequests.some((r) => r.target.includes('/EN/video/play')));
assert(!mediaRequests.some((r) => r.target.includes('/JA/video/play') || r.target.includes('/JA2/video/play')));
resetGlobal();
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, qall: false }), true);
assert.equal(licenseCalls[0].headers['x-cr-content-id'], 'EN', 'q=0 selects video from the requested English source');
assert.equal(licenseCalls[1].headers['x-cr-content-id'], 'EN', 'English audio remains independently selected');
resetGlobal({ capacityLimit: 4 });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, qall: false, tsd: true, dryRun: true }), true);
assert(!mediaRequests.some((r) => r.target.includes('/JA/video/play')), 'TSD preflight uses only selected video sources');
assert.equal(mediaRequests.filter((r) => r.target === 'https://api.example.test/sessions').length, 1);

const japaneseData = { ...variantData, data: [{ ...variantData.data[0], mediaId: 'JA', lang: languageItems[1] }] };
resetGlobal();
assert.equal(await service.downloadEpisode(japaneseData, { ...mediaOptions, qall: false, dubLang: ['en'], dryRun: true }), true);
assert(mediaRequests.some((r) => r.target.includes('/JA/video/play')));
assert(mediaRequests.some((r) => r.target.includes('/JA2/video/play')));
assert(!mediaRequests.some((r) => r.target.includes('/EN/video/play')));
assert(mediaLogs.some((entry) => String(entry[0]).includes('14000 kb/s')));
assert(
	selectedVideoRows().some((row) => row.includes('14000 kb/s')),
	'q=0 picks the late same-language variant'
);
for (const pause of [0, 50]) {
	resetGlobal();
	const before = fakeNow;
	assert.equal(await service.downloadEpisode(japaneseData, { ...mediaOptions, qall: false, discoveryTimmer: pause, dryRun: true }), true);
	assert.equal(fakeNow - before, pause);
}
const unknownLanguage = { ...mediaData, data: [{ ...mediaData.data[0], lang: undefined }] };
const soleJapaneseVersion = [{ ...versions[1] }];
const missingSelectedEnglish = { ...mediaData, data: [{ ...mediaData.data[0], versions: soleJapaneseVersion }] };
for (const mode of [
	{},
	{ dryRun: true },
	{ qall: true, dryRun: true },
	{ novids: true, dryRun: true },
	{ tsd: true, dryRun: true },
	{ keepAllVideos: true, dryRun: true },
	{ hslang: 'en', dryRun: true }
]) {
	resetGlobal();
	assert.equal(await service.downloadEpisode(missingSelectedEnglish, { ...mediaOptions, ...mode }), false);
	assert(
		mediaLogs.some((entry) => /eng|English/i.test(String(entry[0]))),
		'error names the selected audio language'
	);
	assert.equal(mediaRequests.length, 0, 'missing selected version fails before requests or discovery');
	assert.equal(licenseCalls.length, 0);
	assert.equal(downloads.length, 0);
	assert.equal(muxCalls.length, 0);
	assert.equal(archiveWrites.length, 0);
	assert.equal(selectedVideoRows().length, 0);
	assert(!mediaLogs.some((entry) => /Available (?:Video|Audio) Qualities:/i.test(String(entry[0]))));
}
resetGlobal();
const missingSelectedEnglishNoLang = { ...missingSelectedEnglish, data: [{ ...missingSelectedEnglish.data[0], lang: undefined }] };
assert.equal(await service.downloadEpisode(missingSelectedEnglishNoLang, { ...mediaOptions, qall: false, dubLang: ['eng'], dryRun: true }), false);
assert.equal(mediaRequests.length, 0, 'configured single-language fallback is also strict');
resetGlobal();
assert.equal(await service.downloadEpisode(unknownLanguage, { ...mediaOptions, qall: false, dubLang: ['unknown'], dryRun: true }), false);
assert.equal(mediaRequests.length, 0, 'an unavailable explicit fallback does not use an unrelated sole version');
resetGlobal();
const missingMediaGuid = { ...mediaData, data: [{ ...mediaData.data[0], versions: [{ ...versions[0], media_guid: '' }] }] };
assert.equal(await service.downloadEpisode(missingMediaGuid, { ...mediaOptions, dryRun: true }), false);
assert.equal(mediaRequests.length, 0, 'selected version without media_guid fails before requests');
resetGlobal();
const missingSelectedJapanese = { ...mediaData, data: [{ ...mediaData.data[0], lang: languageItems[1], versions: [versions[0]] }] };
assert.equal(await service.downloadEpisode(missingSelectedJapanese, { ...mediaOptions, dubLang: ['jpn'], dryRun: true }), false);
assert(mediaLogs.some((entry) => /jpn|Japanese/i.test(String(entry[0]))));
assert.equal(mediaRequests.length, 0, 'Japanese selection is required before video discovery too');
resetGlobal();
resetGlobal();
assert.equal(await service.downloadEpisode({ ...missingSelectedEnglish, requiredDubLang: [] }, { ...mediaOptions, tsd: true }), false);
assert(mediaLogs.some((entry) => String(entry[0]) === 'Selected audio languages were not found: English'));
assert.equal(mediaRequests.length, 0, 'empty required list cannot bypass the selected version guard');
const mixedSelection = { ...mediaData, data: [mediaData.data[0], { ...mediaData.data[0], mediaId: 'JA', lang: languageItems[1], versions: [versions[0]] }] };
assert.equal(await service.downloadEpisode(mixedSelection, { ...mediaOptions }), false);
assert.equal(mediaRequests.length, 0, 'one missing item stops the batch before any download');
resetGlobal();
assert.equal(await service.downloadEpisode(missingSelectedEnglish, { ...mediaOptions, noaudio: true, qall: false, keepAllVideos: true }), true);
assert.equal(downloads.length, 1, 'noaudio uses a valid version for the video download');
assert.equal(licenseCalls.length, 1);
assert(downloads[0].m3u8json.segments[0].uri.includes('/JA/'));
assert(!mediaLogs.some((entry) => /Selected language not found in versions/i.test(String(entry[0]))));
resetGlobal();

// Exercise the real series selector and download guard together, including stale GUI defaults.
const episode = (id, episodeNumber, episodeVersions = versions) => ({
	id,
	episode_number: episodeNumber,
	episode: String(episodeNumber),
	series_title: 'Test',
	season_title: 'Test',
	title: 'Test',
	season_id: 'season',
	season_number: 1,
	series_id: 'show',
	playback: 'yes',
	versions: episodeVersions,
	is_subbed: true,
	is_dubbed: true,
	duration_ms: 4000
});
const seriesEpisodes = (items, langs) => ({ E1: { items, langs }, E2: { items: [episode('JA', 2)], langs: [languageItems[1]] } });
service.listSeriesID = async () => ({ data: seriesEpisodes([episode('JA', 1)], [languageItems[1]]) });
async function selectSeries(dubLang, extra = {}) {
	return service.downloadFromSeriesID('series', { e: '1', dubLang, ...extra });
}
async function captureDiscoveryWarning(selection, extraOptions = {}, repeat = 1) {
	const originalDownloadMediaList = service.downloadMediaList;
	service.downloadMediaList = async () => ({ data: [], fileName: 'warning-fixture', error: false });
	try {
		resetGlobal();
		for (let i = 0; i < repeat; i++)
			assert.equal(
				await service.downloadEpisode(selection, {
					...mediaOptions,
					qall: false,
					keepAllVideos: true,
					dryRun: true,
					...extraOptions
				}),
				true
			);
		return mediaLogs.map((entry) => String(entry[0])).filter((message) => message.includes('discovery scans more sources'));
	} finally {
		service.downloadMediaList = originalDownloadMediaList;
	}
}
for (const codes of [['eng', 'jpn'], ['eng']]) {
	resetGlobal();
	const selected = await selectSeries(codes);
	assert.equal(selected.isOk, true);
	assert.equal(selected.value.length, 1, 'episode filter excludes the other episode');
	assert.equal(await service.downloadEpisode(selected.value[0], { ...mediaOptions, dubLang: ['jpn'], tsd: true }), false);
	assert.equal(mediaRequests.length, 0, 'partial and zero matches fail before provider requests');
	assert.equal(selectedVideoRows().length, 0);
	assert.equal(downloads.length, 0);
}
for (const keepAllVideos of [false, true]) {
	resetGlobal();
	const selected = await selectSeries(['eng']);
	assert.equal(await service.downloadEpisode(selected.value[0], { ...mediaOptions, qall: false, noaudio: true, keepAllVideos }), true);
	assert.equal(downloads.length, 1, 'noaudio can use the fallback episode for video');
}
resetGlobal();
const allAvailable = await selectSeries(['eng', 'jpn', 'hin'], { allDubs: true });
assert.equal(allAvailable.value[0].data.length, 1, 'the fixture exposes one available dub for allDubs');
assert.equal(allAvailable.value[0].allDubs, true, 'the real series selector preserves allDubs intent');
assert.equal(allAvailable.value[0].requiredDubLang, undefined);
assert.deepEqual(await captureDiscoveryWarning(allAvailable.value[0]), [
	'Multi-stream discovery scans more sources, is slower, and can trigger rate limits affecting normal viewing.'
]);
assert.deepEqual(
	await captureDiscoveryWarning(mediaData, { allDubs: true }),
	['Multi-stream discovery scans more sources, is slower, and can trigger rate limits affecting normal viewing.'],
	'direct allDubs option warns even when this episode has one selected audio track'
);
const savedAllDubsListSeriesID = service.listSeriesID;
service.listSeriesID = async () => ({ data: seriesEpisodes([episode('EN', 1)], [languageItems[0]]) });
try {
	const allDubsEnglishOnly = await selectSeries(['eng'], { allDubs: true });
	assert.equal(allDubsEnglishOnly.value[0].allDubs, true);
	assert.equal(allDubsEnglishOnly.value[0].data.length, 1);
	resetGlobal();
	assert.equal(await service.downloadEpisode(allDubsEnglishOnly.value[0], { ...mediaOptions, qall: false, dryRun: true }), true);
	assert(mediaRequests.some((request) => request.target.includes('/EN/video/play')));
	assert(!mediaRequests.some((request) => request.target.includes('/JA/video/play')), 'allDubs discovers only audio tracks selected for this episode');
} finally {
	service.listSeriesID = savedAllDubsListSeriesID;
}
assert.equal(await service.downloadEpisode(allAvailable.value[0], { ...mediaOptions, qall: false, dryRun: true }), true);
service.listSeriesID = async () => ({ data: seriesEpisodes([episode('EN', 1), episode('JA', 1)], languageItems) });
resetGlobal();
const allWithStaleOptions = await selectSeries(['eng'], { allDubs: true });
assert.equal(allWithStaleOptions.value[0].data.length, 2, 'allDubs selects all available audio despite a limited input list');
resetGlobal();
assert.equal(await service.downloadEpisode(allWithStaleOptions.value[0], { ...mediaOptions, qall: false, dryRun: true }), true);
assert(mediaRequests.some((r) => r.target.includes('/EN/video/play')) && mediaRequests.some((r) => r.target.includes('/JA/video/play')));
const combinedBudget = { used: false };
const combinedWarnings = await captureDiscoveryWarning(allWithStaleOptions.value[0], { qall: true, queueRecovery: combinedBudget }, 2);
assert.deepEqual(
	combinedWarnings,
	['Full stream discovery scans more sources, is slower, and can trigger rate limits affecting normal viewing.'],
	'qall wins when combined with allDubs and warning suppression is shared across the command'
);
const fullSelection = await selectSeries(['eng', 'jpn']);
assert.equal(fullSelection.value[0].data.length, 2);
assert.deepEqual(await captureDiscoveryWarning(fullSelection.value[0]), [], 'two explicitly selected dubs do not trigger the broad-scan warning');
const savedListSeriesID = service.listSeriesID;
const hindi = { code: 'hin', cr_locale: 'hi-IN', locale: 'hi', name: 'Hindi', language: 'Hindi' };
const hindiVersion = { guid: 'HI', media_guid: 'media-hi', audio_locale: 'hi-IN', original: false };
languageItems.push(hindi);
try {
	// Aggregate missing names in requested order, deduplicate, and retain available Japanese.
	service.listSeriesID = async () => ({ data: seriesEpisodes([episode('JA', 1, [versions[1]])], [languageItems[1]]) });
	const missing = await selectSeries(['eng', 'jpn', 'hin', 'eng']);
	resetGlobal();
	assert.equal(await service.downloadEpisode(missing.value[0], { ...mediaOptions, tsd: true }), false);
	assert.deepEqual(
		mediaLogs.map((entry) => String(entry[0])).filter((line) => line.startsWith('Selected audio languages')),
		['Selected audio languages were not found: English, Hindi']
	);
	assert.equal(mediaRequests.length, 0);
	const unavailableFallback = { ...missing.value[0], data: [{ ...missing.value[0].data[0], versions: [{ ...versions[1], media_guid: '' }] }] };
	resetGlobal();
	assert.equal(await service.downloadEpisode(unavailableFallback, mediaOptions), false);
	assert.deepEqual(
		mediaLogs.map((entry) => String(entry[0])).filter((line) => line.startsWith('Selected audio languages')),
		['Selected audio languages were not found: English, Japanese, Hindi']
	);
	resetGlobal();
	assert.equal(await service.downloadEpisode({ ...unavailableFallback, requiredDubLang: ['eng'] }, mediaOptions), false);
	assert.deepEqual(
		mediaLogs.map((entry) => String(entry[0])).filter((line) => line.startsWith('Selected audio languages')),
		['Selected audio languages were not found: English']
	);
	const brokenVersions = [{ ...versions[0], media_guid: '' }, versions[1], { ...hindiVersion, guid: '' }];
	service.listSeriesID = async () => ({
		data: seriesEpisodes([episode('EN', 1, brokenVersions), episode('JA', 1, brokenVersions), episode('HI', 1, brokenVersions)], languageItems)
	});
	const broken = await selectSeries(['eng', 'jpn', 'hin']);
	resetGlobal();
	assert.equal(await service.downloadEpisode(broken.value[0], mediaOptions), false);
	assert.deepEqual(
		mediaLogs.map((entry) => String(entry[0])).filter((line) => line.startsWith('Selected audio languages')),
		['Selected audio languages were not found: English, Hindi']
	);
	assert.equal(mediaRequests.length, 0);
	const savedGetObject = service.getObjectById;
	service.getObjectById = async () => [{ ...missingSelectedEnglish }];
	try {
		resetGlobal();
		cliArgs = { ...mediaOptions, e: 'ABCDEFGHI', locale: 'en-US', dubLang: ['eng', 'jpn', 'hin'], tsd: true };
		assert.equal(await service.cli(), false);
		assert.deepEqual(
			mediaLogs.map((entry) => String(entry[0])).filter((line) => line.startsWith('Selected audio languages')),
			['Selected audio languages were not found: English, Hindi']
		);
		assert.equal(mediaRequests.length, 0);
		resetGlobal();
		service.getObjectById = async () => [mediaData];
		cliArgs = { ...mediaOptions, e: 'ABCDEFGHI', locale: 'en-US', dubLang: ['eng', 'jpn', 'hin'], dryRun: true, qall: false };
		assert.equal(await service.cli(), true, 'direct episode first-dub success does not require discarded dubs');
	} finally {
		service.getObjectById = savedGetObject;
	}
	// The actual season builder consumes three metadata responses, then shares the series selection guard.
	const savedReq = service.req;
	const savedLogObject = service.logObject;
	service.logObject = async () => {};
	let seasonRows, seasonCalls;
	function seasonFixture(rows) {
		seasonRows = rows;
		seasonCalls = 0;
		service.req = {
			...savedReq,
			getData: async (target, opts) => {
				if (seasonCalls < 3) {
					const position = seasonCalls++;
					const data =
						position === 0
							? { data: [{}] }
							: position === 1
								? { total: seasonRows.length, items: structuredClone(seasonRows) }
								: { total: seasonRows.length, data: structuredClone(seasonRows) };
					return { ok: true, res: { json: async () => data } };
				}
				return savedReq.getData(target, opts);
			}
		};
	}
	try {
		const jpOnly = episode('JA', 1, [versions[1]]);
		seasonFixture([jpOnly]);
		resetGlobal();
		cliArgs = { ...mediaOptions, s: 'ABCDEFGHI', e: '1', locale: 'en-US', dubLang: ['eng', 'jpn', 'hin'], tsd: true };
		assert.equal(await service.cli(), false);
		assert.equal(seasonCalls, 3);
		assert.equal(mediaRequests.length, 0, 'missing season audio fails before playback');
		assert(mediaLogs.some((entry) => String(entry[0]) === 'Selected audio languages were not found: English, Hindi'));
		seasonFixture([episode('EN', 1)]);
		resetGlobal();
		cliArgs = { ...mediaOptions, s: 'ABCDEFGHI', e: '1', locale: 'en-US', dubLang: ['eng', 'jpn'], qall: false };
		assert.equal(await service.cli(), true);
		assert.equal(seasonCalls, 3);
		assert.equal(downloads.length, 3, 'season CLI downloads one video and both requested audio tracks');
		for (const mode of [{ noaudio: true }, { novids: true, dryRun: true, qall: true }]) {
			seasonFixture([jpOnly]);
			const selected = await service.getSeasonById('ABCDEFGHI', 1, '1', false, false, { dubLang: ['eng', 'jpn'] });
			resetGlobal();
			assert.equal(await service.downloadEpisode(selected.value[0], { ...mediaOptions, ...mode }), !!mode.noaudio);
		}
		seasonFixture([episode('EN', 1, [...versions, hindiVersion, { ...versions[1], guid: 'JA2' }])]);
		const three = await service.getSeasonById('ABCDEFGHI', 1, '1', false, false, { dubLang: ['hin', 'eng', 'jpn'] });
		assert.deepEqual(
			Array.from(three.value[0].data, (entry) => entry.lang.code),
			['hin', 'eng', 'jpn'],
			'season audio ordering follows the requested languages'
		);
		assert.equal(three.value[0].data[0].versions.length, 4, 'same-language video variants remain available');
		seasonFixture([episode('JA', 1, [versions[1]]), episode('EN', 2)]);
		const available = await service.getSeasonById('ABCDEFGHI', 1, undefined, false, true, { dubLang: ['eng'], allDubs: true });
		assert.deepEqual(
			Array.from(available.value, (entry) => entry.data.length),
			[1, 2]
		);
		assert(available.value.every((entry) => entry.allDubs && entry.requiredDubLang === undefined));
		seasonFixture([episode('EN', 1), { ...episode('JA', 2), episode: 'special' }]);
		const special = await service.getSeasonById('ABCDEFGHI', 1, 'S1', false, false, { dubLang: ['jpn'] });
		assert.equal(special.value.length, 1);
		assert.equal(special.value[0].e, 'S1');
		assert.equal(special.value[0].episodeNumber, 'special');
		seasonFixture([{ ...episode('JA', 1, null), audio_locale: 'ja-JP' }]);
		const legacy = await service.getSeasonById('ABCDEFGHI', 1, '1', false, false, { dubLang: ['jpn'] });
		assert.equal(legacy.value[0].data[0].versions, null);
		assert.equal(legacy.value[0].data[0].lang.code, 'jpn');
		resetGlobal();
		assert.equal(await service.downloadEpisode(legacy.value[0], { ...mediaOptions, dubLang: ['jpn'], novids: true, dryRun: true }), true);
		seasonFixture([episode('EN', 1)]);
		const single = await service.getSeasonById('ABCDEFGHI', 1, '1', false, false, { dubLang: ['eng'] });
		assert.deepEqual(
			Array.from(single.value[0].data, (entry) => entry.lang.code),
			['eng']
		);
		service.req = { ...savedReq, getData: async () => ({ ok: false }) };
		cliArgs = { ...mediaOptions, s: 'ABCDEFGHI', e: '1', locale: 'en-US', dubLang: ['eng'] };
		assert.equal(await service.cli(), false, 'season metadata failure propagates to CLI');
	} finally {
		service.req = savedReq;
		service.logObject = savedLogObject;
	}
	const threeDubVersions = [...versions, hindiVersion];
	service.listSeriesID = async () => ({
		data: seriesEpisodes([episode('EN', 1, threeDubVersions), episode('JA', 1, threeDubVersions), episode('HI', 1, threeDubVersions)], languageItems)
	});
	const threeDubs = await selectSeries(['eng', 'jpn', 'hin']);
	assert.equal(threeDubs.value[0].data.length, 3);
	assert.deepEqual(Array.from(threeDubs.value[0].requiredDubLang), ['eng', 'jpn', 'hin']);
	const englishHindi = await selectSeries(['eng', 'hin']);
	const originalDiscovery = realSelection.discoverVideoCandidates;
	const originalDownloadMediaList = service.downloadMediaList;
	let observedLocales;
	realSelection.discoverVideoCandidates = async (input) => {
		observedLocales = input.sources.map((source) => source.locale);
		return { status: 'fallback', reason: 'capture selected source pool' };
	};
	service.downloadMediaList = async () => ({ data: [], fileName: 'warning-fixture', error: false });
	try {
		resetGlobal();
		assert.equal(await service.downloadEpisode(englishHindi.value[0], { ...mediaOptions, dubLang: ['hin'], qall: false, dryRun: true }), true);
		assert.deepEqual(Array.from(observedLocales), ['en-US', 'hi-IN'], 'multi-language English selections do not add an unselected Japanese source');
	} finally {
		realSelection.discoverVideoCandidates = originalDiscovery;
		service.downloadMediaList = originalDownloadMediaList;
	}
	const threeDubBudget = { used: false };
	const multiWarnings = await captureDiscoveryWarning(threeDubs.value[0], { dubLang: ['hin'], queueRecovery: threeDubBudget }, 2);
	assert.deepEqual(
		multiWarnings,
		['Multi-stream discovery scans more sources, is slower, and can trigger rate limits affecting normal viewing.'],
		'three required languages warn once despite stale GUI dub options and repeated episode calls'
	);
} finally {
	service.listSeriesID = savedListSeriesID;
	languageItems.pop();
}
assert.equal(await service.downloadEpisode(fullSelection.value[0], { ...mediaOptions, dubLang: ['hin'], qall: false }), true);
assert.equal(downloads.length, 3, 'one video and both selected audio tracks are downloaded');
assert.deepEqual(
	Array.from(muxCalls.at(-1).options.muxAudioLanguages, (language) => language.code),
	['eng', 'jpn'],
	'effective selected languages override stale GUI options'
);
assert(
	muxCalls
		.at(-1)
		.data.filter((item) => item.type === 'Video')
		.every((item) => item.layout === 'split')
);
for (const tsd of [false, true]) {
	for (const discoveryTimmer of [undefined, 0]) {
		const elapsed = [];
		for (const qall of [false, true]) {
			resetGlobal();
			const before = fakeNow;
			assert.equal(await service.downloadEpisode(fullSelection.value[0], { ...mediaOptions, qall, tsd, discoveryTimmer, dryRun: true }), true);
			elapsed.push(fakeNow - before);
		}
		assert.equal(elapsed[0], elapsed[1], 'multi-audio uses qall pacing including TSD and fixed overrides');
		if (discoveryTimmer === 0) assert.equal(elapsed[0], 0);
		else assert(elapsed[0] > 0, 'default per-request pacing is active');
	}
}

service.listSeriesID = async () => ({ data: seriesEpisodes([episode('EN', 1, null), episode('JA', 1, null)], languageItems) });
const legacySelection = await selectSeries(['eng', 'jpn']);
resetGlobal();
assert.equal(await service.downloadEpisode(legacySelection.value[0], { ...mediaOptions, novids: true, dryRun: true }), true, 'legacy null versions pass selection preflight');
service.listSeriesID = async () => ({ data: seriesEpisodes([episode('JA', 1)], [languageItems[1]]) });
assert.equal((await selectSeries(['jpn'], { e: '99' })).isOk, false, 'empty episode selection fails');
delete service.listSeriesID;
resetGlobal();
assert.equal(await service.downloadEpisode(missingSelectedEnglish, { ...mediaOptions, noaudio: true, qall: false }), true);
assert.equal(downloads.length, 1, 'global noaudio discovery uses an available video version');

resetGlobal();
assert.equal(
	await service.downloadEpisode(
		{ ...mediaData, data: [...mediaData.data, { ...mediaData.data[0], mediaId: 'JA', lang: languageItems[1] }] },
		{ ...mediaOptions, qall: false, dryRun: true }
	),
	true
);
assert(mediaRequests.some((r) => r.target.includes('/EN/video/play')) && mediaRequests.some((r) => r.target.includes('/JA/video/play')));

resetGlobal();
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, novids: true, dryRun: true }), true);
assert(!mediaLogs.some((entry) => String(entry[0]).includes('[Notice: falling back')));
assert.equal(selectedVideoRows().length, 0, 'qall with novids skips the video quality comparison');
assert(
	mediaLogs.some((entry) => String(entry[0]).startsWith('Available Audio Qualities:')),
	'novids still plans audio'
);
assert.equal(tokenCounter, 1);
resetGlobal();
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, keepAllVideos: true, dryRun: true, q: 1 }), true);
assert(!mediaLogs.some((entry) => String(entry[0]).includes('[Notice: falling back')));
const localAudioQualities = mediaLogs.find((entry) => String(entry[0]).startsWith('Available Audio Qualities:'));
assert(localAudioQualities);
const localAudioLines = String(localAudioQualities[0]).split('\n');
const localSelectedAudioIndex = localAudioLines.findIndex((line) => line.includes('<-- Selected'));
assert.equal(localAudioLines[localSelectedAudioIndex], '    [1] 128 kb/s [A:eng] <-- Selected');
assert.equal(localAudioLines[localSelectedAudioIndex + 1], '        Audio Server: cdn.example.test');
assert.equal(localAudioLines[localSelectedAudioIndex + 2], '    [2] 192 kb/s [A:eng]');
assert.equal(mediaLogs.filter((entry) => String(entry[0]).includes('Audio Server:')).length, 1);
assert(!mediaLogs.some((entry) => String(entry[0]).includes('Selected audio:')));
assert.equal(tokenCounter, 1);
resetGlobal();
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, keepAllVideos: true, dryRun: true, q: 999 }), true);
const cappedAudioQualities = mediaLogs.find((entry) => String(entry[0]).startsWith('Available Audio Qualities:'));
assert(cappedAudioQualities);
assert(String(cappedAudioQualities[0]).includes('    [2] 192 kb/s [A:eng] <-- Selected\n        Audio Server: cdn.example.test'));
assert.equal(mediaLogs.filter((entry) => String(entry[0]).includes('Audio Server:')).length, 1);
assert.equal(tokenCounter, 1);
resetGlobal({ hls: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, dryRun: true }), true);
assert.equal(mediaLogs.filter((entry) => String(entry[0]) === '[Notice: falling back to eng video — unsupported manifest]').length, 1);
assert.equal(mediaLogs.filter((entry) => String(entry[0]).startsWith('Available qualities:')).length, 0);
assert.equal(mediaLogs.filter((entry) => String(entry[0]).includes('<-- Re-selected')).length, 1);
assert.equal(mediaLogs.filter((entry) => String(entry[0]).includes('<-- Discarded')).length, 0);
assert.equal(tokenCounter, 2);
assert.equal(mediaRequests.filter((request) => request.method === 'DELETE').length, 2);
assert.equal(downloads.length, 0);
resetGlobal({ hls: 'opaque' });
assert.equal(await service.downloadEpisode(mediaData, mediaOptions), true);
assert.equal(downloads.length, 1, 'a full HLS fallback downloads the selected playlist');
assert.equal(downloads[0].m3u8json.segments[0].uri, 'https://cdn.example.test/english.ts');
assert.equal(muxCalls.length, 1);
assert.equal(muxCalls[0].data[0].layout, 'combined');
const hlsClose = mediaRequests.findIndex((request) => request.method === 'DELETE' && request.target.endsWith('/EN/token-EN-2'));
const hlsTransfer = mediaRequests.findIndex((request) => request.method === 'MEDIA');
assert(hlsClose >= 0 && hlsClose < hlsTransfer, 'release the HLS playback session before transferring media');
resetGlobal({ hls: true, hlsMany: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, qall: false, keepAllVideos: true, dryRun: true }), true);
const hlsRows = String(mediaLogs.find((entry) => String(entry[0]).startsWith('Available qualities:'))[0]);
assert(hlsRows.includes('[1] 1280x720 (5000 kb/s)'));
assert(!hlsRows.includes('[2] 1280x720 (1000 kb/s)'));
assert(hlsRows.includes('[5] 1280x720 (2000 kb/s)'));
assert.doesNotMatch(hlsRows, /qualit(?:y|ies) hidden|use --qall/);
resetGlobal({ hls: true });
const noLangSoleVersion = { ...mediaData, data: [{ ...mediaData.data[0], lang: undefined, versions: soleJapaneseVersion }] };
assert.equal(await service.downloadEpisode(noLangSoleVersion, { ...mediaOptions, dubLang: [], qall: false, dryRun: true }), true);
resetGlobal({ hls: true });
const noLangData = { ...mediaData, data: [{ ...mediaData.data[0], lang: undefined }] };
assert.equal(await service.downloadEpisode(noLangData, { ...mediaOptions, dryRun: true }), true);
assert.equal(mediaLogs.filter((entry) => String(entry[0]) === '[Notice: falling back to eng video — unsupported manifest]').length, 1);
resetGlobal({ hard: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, hslang: 'en', dryRun: true }), true);
assert(!mediaLogs.some((entry) => String(entry[0]).includes('[Notice: falling back')));
assert.equal(tokenCounter, 1);
resetGlobal({ audioReject: '429' });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, keepAllVideos: true, vstream: 'android', astream: 'chrome' }), false);
const playback429Close = mediaRequests.filter((request) => request.method === 'DELETE');
assert.equal(playback429Close.filter((request) => request.target.endsWith('/EN/token-EN-1')).length, 1);
assert.equal(playback429Close.filter((request) => request.target.endsWith('/EN/download-EN-1')).length, 1);
assert.equal(mediaRequests.filter((request) => request.target.includes('/video/play?queue=0')).length, 1);
assert.equal(downloads.length, 0);
assert.equal(muxCalls.length, 0);
assert.equal(archiveWrites.length, 0);
resetGlobal();
const noVersionData = { ...mediaData, data: [{ ...mediaData.data[0], versions: null }] };
assert.equal(await service.downloadEpisode(noVersionData, { ...mediaOptions, dryRun: true }), true);
assert.equal(tokenCounter, 1);
resetGlobal({ sharedAudio: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, astream: 'chrome' }), true);
assert.equal(mediaRequests.filter((request) => request.method === 'DELETE').length, 4);
assert.equal(licenseCalls[1].headers['x-cr-video-token'], 'token-EN-4');
const multiDubData = { ...mediaData, data: [...mediaData.data, { ...mediaData.data[0], mediaId: 'JA', lang: languageItems[1] }] };
resetGlobal();
assert.equal(await service.downloadEpisode(multiDubData, { ...mediaOptions, qall: false }), true);
assert(licenseCalls.some((call) => call.headers['x-cr-content-id'] === 'EN'));
assert(licenseCalls.some((call) => call.headers['x-cr-content-id'] === 'JA'));
assert.equal(mediaLogs.filter((entry) => String(entry[0]).startsWith('Available Video Qualities:')).length, 1);
resetGlobal();
assert.equal(await service.downloadEpisode(multiDubData, { ...mediaOptions, keepAllVideos: true, dryRun: true }), true);
assert.equal(selectedVideoRows().length, 1);
resetGlobal({ failFirstDubClose: true });
assert.equal(await service.downloadEpisode(multiDubData, { ...mediaOptions }), false);
assert.equal(tokenCounter, 4);
assert.equal(mediaRequests.filter((request) => request.target.includes('/v3/JA/video/play')).length, 2);
assert.equal(muxCalls.length, 0);
assert.equal(archiveWrites.length, 0);
for (const audioReject of ['429', 'network']) {
	resetGlobal({ audioReject });
	assert.equal(await service.downloadEpisode(multiDubData, { ...mediaOptions, astream: 'chrome' }), false);
	assert.equal(tokenCounter, 4);
	assert.equal(downloads.length, 1);
	assert.equal(licenseCalls.length, 1);
	assert(mediaRequests.some((request) => request.method === 'DELETE' && request.target.endsWith('/EN/token-EN-4')));
	assert.equal(muxCalls.length, 0);
	assert.equal(archiveWrites.length, 0);
}
resetGlobal({ videoReject: true });
assert.equal(await service.downloadEpisode(multiDubData, { ...mediaOptions }), false);
assert.equal(tokenCounter, 3);
assert.equal(downloads.length, 1);
assert.equal(licenseCalls.length, 1);
assert.equal(muxCalls.length, 0);
assert.equal(archiveWrites.length, 0);
resetGlobal({ distinctAudio: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, astream: 'chrome' }), true);
assert.equal(mediaRequests.filter((request) => request.method === 'DELETE').length, 5);
assert.equal(licenseCalls[1].headers['x-cr-video-token'], 'token-EN-audio');
assert(
	mediaRequests.findIndex((request) => request.method === 'DELETE' && request.target.endsWith('/JA/token-JA-3')) <
		mediaRequests.findIndex((request) => request.target.includes('/v3/EN/video/') && request.target.includes('queue=0') && mediaRequests.indexOf(request) > 0)
);
resetGlobal({ distinctAudio: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, vstream: 'android', astream: 'chrome', dryRun: true }), true);
assert.equal(peakTokens, 2);
assert.equal(activeTokens.size, 0);
const enDownload = mediaRequests.findIndex((request) => request.target.includes('/v3/EN/phone/download'));
const enDownloadClose = mediaRequests.findIndex((request) => request.method === 'DELETE' && request.target.endsWith('/EN/download-EN-1'));
const enProbePlay = mediaRequests.findIndex((request) => request.target.includes('/v3/EN/video/play'));
assert(enDownload < enDownloadClose && enDownloadClose < enProbePlay);
assert.equal(mediaRequests.filter((request) => request.target.includes('/v3/EN/phone/download')).length, 1);
resetGlobal();
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, vstream: 'androidtab', astream: 'androidtab', dryRun: true }), true);
assert.equal(peakTokens, 2);
assert.equal(activeTokens.size, 0);
assert.equal(mediaRequests.filter((request) => request.target.includes('/v3/EN/tablet/download')).length, 2);
resetGlobal();
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, vstream: 'android', astream: 'androidtab' }), true);
assert.equal(peakTokens, 2);
assert.equal(activeTokens.size, 0);
assert.equal(licenseCalls[0].headers['x-cr-video-token'], 'token-JA-3');
assert.equal(licenseCalls[1].headers['x-cr-video-token'], 'token-EN-4');
const audioDownloadClose = mediaRequests.findIndex((request) => request.method === 'DELETE' && request.target.endsWith('/EN/download-EN-4'));
const audioKeepalive = mediaRequests.findIndex((request) => request.method === 'PATCH' && request.target.includes('/EN/token-EN-4/keepAlive'));
assert(audioDownloadClose >= 0 && audioDownloadClose < audioKeepalive);
assert(!mediaRequests.some((request) => request.method === 'PATCH' && request.target.includes('/EN/download-EN-4/keepAlive')));
assert.equal(mediaRequests.filter((request) => request.target.includes('/v3/EN/phone/download')).length, 1);
assert.equal(mediaRequests.filter((request) => request.target.includes('/v3/EN/tablet/download')).length, 1);
resetGlobal({ failAudioClose: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, vstream: 'android', astream: 'androidtab' }), false);
assert.equal(downloads.length, 1);
assert.equal(licenseCalls.length, 1);
assert.equal(muxCalls.length, 0);
assert.equal(archiveWrites.length, 0);
assert(mediaRequests.some((request) => request.method === 'DELETE' && request.target.endsWith('/EN/token-EN-4')));
assert(!mediaRequests.some((request) => request.method === 'PATCH' && request.target.includes('/EN/token-EN-4/keepAlive')));
resetGlobal({ downloadReject: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, vstream: 'android', astream: 'android', dryRun: true }), true);
assert.equal(activeTokens.size, 0);
resetGlobal({ downloadReject: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, vstream: 'android', astream: 'androidtab', dryRun: true }), true);
assert.equal(activeTokens.size, 0);
assert(mediaLogs.some((entry) => entry[0] === 'Audio first media segment URL:' && String(entry[1]).includes('/EN/current/high-')));
resetGlobal({ downloadRate: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, vstream: 'android', astream: 'android', dryRun: true }), false);
assert.equal(tokenCounter, 0);
resetGlobal({ downloadMalformed: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, vstream: 'android', astream: 'android', dryRun: true }), false);
assert.equal(tokenCounter, 0);
assert.equal(activeTokens.size, 0);
resetGlobal({ downloadMissingToken: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, vstream: 'android', astream: 'android', dryRun: true }), false);
assert.equal(tokenCounter, 0);
resetGlobal({ close202: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, vstream: 'android', astream: 'android', dryRun: true }), false);
assert.equal(tokenCounter, 0);
assert.equal(activeTokens.size, 1);
for (const bypass of [{ bypasssync: true }, { noaudio: true }]) {
	resetGlobal({ close202: true });
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, ...bypass, vstream: 'android', astream: 'android', dryRun: true }), false);
	assert.equal(tokenCounter, 0);
}
resetGlobal({ close202ExecOnly: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, vstream: 'android', astream: 'chrome', dryRun: true }), false);
assert.equal(tokenCounter, 3);
assert.equal(downloads.length, 0);
assert.equal(archiveWrites.length, 0);
assert.equal(muxCalls.length, 0);
assert.equal(activeTokens.size, 1);
resetGlobal({ deferExecDownload: true });
const executionLateClosed = new Promise((resolve) => {
	notifyLateClose = resolve;
});
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, vstream: 'android', astream: 'chrome', dryRun: true }), false);
assert.equal(tokenCounter, 3);
assert.equal(activeTokens.size, 0);
releaseExecutionDownload();
await within(executionLateClosed);
assert.equal(activeTokens.size, 0);
assert.equal(tokenCounter, 3);
assert.equal(downloads.length, 0);
fastTimers = false;
// Reset is explicit, precedes discovery, and is consumed once per episode.
resetGlobal();
const sharedOptions = { ...mediaOptions, tsd: true, dryRun: true };
assert.equal(await service.downloadEpisode(mediaData, sharedOptions), true);
assert.equal(sharedOptions.tsd, true);
assert.equal(mediaRequests.filter((r) => r.target === 'https://api.example.test/sessions').length, 2);
assert(mediaRequests.findIndex((r) => r.target.endsWith('/old/old-token')) < mediaRequests.findIndex((r) => r.target.includes('/v3/')));
assert.equal(downloads.length, 0);
assert.equal(licenseCalls.length, 0);
assert.equal(archiveWrites.length, 0);
assert(!mediaLogs.some((line) => String(line[0]).includes('Closed ')));
assert.equal(await service.downloadEpisode(mediaData, sharedOptions), true);
assert.equal(mediaRequests.filter((r) => r.target === 'https://api.example.test/sessions').length, 3);
resetGlobal();
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, dryRun: true }), true);
assert(!mediaRequests.some((r) => r.target === 'https://api.example.test/sessions'));
for (const [reason, tsd] of [
	['429', false],
	['network', false],
	['429', true]
]) {
	resetGlobal({ playbackReject: reason });
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, tsd }), false);
	assert.equal(mediaRequests.filter((r) => r.target.includes('/video/play?queue=0')).length, 1);
	const notices = mediaLogs.filter((r) => /Rate limit/.test(String(r[0])));
	assert.equal(notices.length, reason === '429' ? 1 : 0);
	if (reason === '429') assert.equal(String(notices[0][0]).includes('--tsd'), !tsd);
}
{
	const savedReq = service.req;
	const headers = { headers: { Authorization: 'synthetic' } };
	const pair = (id, token = id) => ({ contentId: id, token });
	async function checkReset(items, deleteStatuses = [], verifyLists) {
		let gets = 0,
			deletes = 0;
		service.req = {
			argv: {},
			getData: async (_target, options = {}) => {
				if (options.method === 'DELETE') {
					const status = deleteStatuses[deletes++] ?? 204;
					return { ok: status === 200 || status === 204, res: { status } };
				}
				const body = verifyLists ? verifyLists[gets++] : gets++ === 0 ? items : [];
				if (body === null) return { ok: false };
				return { ok: true, res: { json: async () => (Array.isArray(body) ? { items: body } : body) } };
			}
		};
		const result = await service.resetPlaybackSessions(headers);
		return { result, gets, deletes };
	}
	let r = await checkReset([]);
	assert.equal(r.result.ok, true);
	assert.equal(r.result.closed, 0);
	assert.equal(r.deletes, 0);
	r = await checkReset([pair('A'), pair('A'), pair('B')]);
	assert.equal(r.result.ok, true);
	assert.equal(r.result.closed, 2);
	assert.equal(r.deletes, 2);
	for (const bad of [[pair('A'), { contentId: 'B' }], Array.from({ length: 33 }, (_, i) => pair(String(i)))]) {
		r = await checkReset(bad);
		assert.equal(r.result.ok, false);
		assert.equal(r.deletes, 0);
	}
	r = await checkReset([], [], [{ items: [], total: 1 }]);
	assert.equal(r.result.ok, false);
	assert.equal(r.deletes, 0);
	r = await checkReset([], [], [[pair('A')], { items: [], pagination: { next: 'more' } }]);
	assert.equal(r.result.ok, false);
	assert.equal(r.result.remaining, undefined);
	r = await checkReset([pair('A'), pair('B')], [204, 500]);
	assert.equal(r.result.ok, false);
	assert.equal(r.result.closed, 1);
	assert.equal(r.deletes, 2);
	r = await checkReset([], [], [[pair('A')], []]);
	assert.equal(r.result.ok, true);
	assert.equal(r.result.closed, 1);
	assert.equal(r.result.remaining, 0);
	assert.equal(r.gets, 2);
	r = await checkReset([], [], [[pair('A')], [pair('B')]]);
	assert.equal(r.result.ok, false);
	assert.equal(r.result.remaining, 1);
	assert.equal(r.deletes, 1);
	r = await checkReset([], [], [[pair('A')], null]);
	assert.equal(r.result.ok, false);
	assert.equal(r.result.closed, 1);
	assert.equal(r.result.remaining, undefined);
	service.req = {
		argv: {},
		getData: async () => ({
			ok: true,
			res: {
				json: async () => {
					throw Error('private parser details');
				}
			}
		})
	};
	assert.equal((await service.resetPlaybackSessions(headers)).reason, 'invalid session list');
	let verificationLists = 0;
	service.req = {
		argv: {},
		getData: async (_target, options = {}) => {
			if (options.method === 'DELETE') return { ok: true, res: { status: 204 } };
			if (++verificationLists === 1) return { ok: true, res: { json: async () => ({ items: [pair('A')] }) } };
			return new Promise(() => {});
		}
	};
	const timerCount = boundedTimers;
	fastTimers = true;
	const verifyTimeout = await service.resetPlaybackSessions(headers);
	fastTimers = false;
	assert.equal(verifyTimeout.ok, false);
	assert.equal(verifyTimeout.reason, 'session reset timed out');
	assert.equal(verifyTimeout.closed, 1);
	assert.equal(verifyTimeout.remaining, undefined);
	assert.equal(verificationLists, 2);
	assert.equal(boundedTimers - timerCount, 1, 'one timer bounds list, deletes and verification');

	let resolveLate,
		lateDeletes = 0;
	service.req = {
		argv: {},
		getData: async (_target, options = {}) => {
			if (options.method === 'DELETE') {
				lateDeletes++;
				return { ok: true, res: { status: 204 } };
			}
			return new Promise((resolve) => {
				resolveLate = resolve;
			});
		}
	};
	fastTimers = true;
	const timedReset = await service.resetPlaybackSessions(headers);
	assert.equal(timedReset.ok, false);
	resolveLate({ ok: true, res: { json: async () => ({ items: [pair('late')] }) } });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(lateDeletes, 0, 'late list cannot dispatch a delete after timeout');
	fastTimers = false;
	let resolveDelete,
		deleteCalls = 0,
		listCalls = 0;
	service.req = {
		argv: {},
		getData: async (_target, options = {}) => {
			if (options.method !== 'DELETE') {
				listCalls++;
				return { ok: true, res: { json: async () => ({ items: [pair('A'), pair('B')] }) } };
			}
			deleteCalls++;
			return new Promise((resolve) => {
				resolveDelete = resolve;
			});
		}
	};
	fastTimers = true;
	const timedDelete = await service.resetPlaybackSessions(headers);
	assert.equal(timedDelete.ok, false);
	assert.equal(timedDelete.closed, 0);
	resolveDelete({ ok: true, res: { status: 204 } });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(deleteCalls, 1);
	assert.equal(listCalls, 1, 'timeout forbids further deletions and verification');
	fastTimers = false;
	let begun;
	const started = new Promise((resolve) => {
		begun = resolve;
	});
	service.req = {
		argv: {},
		getData: async () => {
			begun();
			return new Promise(() => {});
		}
	};
	const cancelled = service.resetPlaybackSessions(headers);
	await started;
	process.emit('SIGINT');
	const cancelResult = await cancelled;
	assert.equal(cancelResult.ok, false);
	assert.equal(cancelResult.reason, 'session reset cancelled');
	service.req = savedReq;
}

{
	// The next stage cannot begin while session enumeration remains pending.
	resetGlobal();
	const saved = service.req;
	let finishList,
		began,
		resetListCount = 0;
	const started = new Promise((resolve) => {
		began = resolve;
	});
	service.req = {
		...saved,
		getData: async (target, options) => {
			if (target === 'https://api.example.test/sessions') {
				if (++resetListCount > 1) return { ok: true, res: new Response(JSON.stringify({ items: [] })) };
				began();
				return new Promise((resolve) => {
					finishList = resolve;
				});
			}
			return saved.getData(target, options);
		}
	};
	const pending = service.downloadEpisode(mediaData, { ...mediaOptions, tsd: true, dryRun: true });
	await started;
	assert(!mediaRequests.some((r) => r.target.includes('/v3/')));
	finishList({ ok: true, res: new Response(JSON.stringify({ items: [] })) });
	assert.equal(await pending, true);
	service.req = saved;
}
{
	// Standalone summaries follow one verification list and set CLI failure status.
	const saved = service.req;
	service.cfg.cli = {};
	let refreshCalled = 0,
		requestCalled = 0;
	const savedRefresh = service.refreshToken;
	service.refreshToken = async () => {
		refreshCalled++;
		return true;
	};
	service.req = {
		argv: {},
		getData: async () => {
			requestCalled++;
			throw Error('unexpected');
		}
	};
	service.token = { access_token: 'synthetic' };
	cliArgs = { tsd: true, tsdExplicit: true, dubLang: [], locale: 'en-US' };
	process.exitCode = undefined;
	mediaLogs.length = 0;
	assert.equal(await service.cli(), false);
	assert.equal(process.exitCode, 1);
	assert.equal(refreshCalled, 0);
	assert.equal(requestCalled, 0);
	assert(mediaLogs.some((line) => String(line[0]).includes('Login required')));
	assert(!mediaLogs.some((line) => String(line[0]).startsWith('Closed ')));
	service.refreshToken = savedRefresh;
	service.token = { access_token: 'synthetic', refresh_token: 'synthetic-refresh' };
	for (const [remaining, failure, expected] of [
		[0, false, true],
		[1, false, false],
		[0, true, false]
	]) {
		resetGlobal();
		let lists = 0,
			deletes = 0;
		service.req = {
			argv: {},
			getData: async (_target, options = {}) => {
				if (options.method === 'DELETE') {
					deletes++;
					return { ok: true, res: { status: 204 } };
				}
				lists++;
				if (lists === 2 && failure) return { ok: false };
				const items = lists === 1 ? [{ contentId: 'A', token: 'A' }] : Array.from({ length: remaining }, () => ({ contentId: 'B', token: 'B' }));
				return { ok: true, res: { json: async () => ({ items }) } };
			}
		};
		cliArgs = { tsd: true, tsdExplicit: true, dryRun: true, debug: true, dubLang: [], locale: 'en-US' };
		process.exitCode = undefined;
		assert.equal(await service.cli(), expected);
		assert.equal(lists, 2);
		assert.equal(deletes, 1);
		const summary = mediaLogs.find((line) => String(line[0]).startsWith('Closed 1 playback sessions.'));
		assert(summary && String(summary[0]).includes(`remaining: ${failure ? 'unknown' : remaining}`));
		assert.equal(process.exitCode, expected ? undefined : 1);
	}
	process.exitCode = undefined;
	for (const extra of [{ tsdExplicit: false }, { search: 'ab' }, { series: 'bad' }, { s: '' }, { _: ['unexpected'] }, { requestedActionOrSelector: true }, { all: true }]) {
		let called = false;
		service.req = {
			argv: {},
			getData: async () => {
				called = true;
				throw Error('unexpected reset');
			}
		};
		cliArgs = { tsd: true, tsdExplicit: true, dubLang: [], locale: 'en-US', ...extra };
		await service.cli();
		assert.equal(called, false);
	}
	service.req = saved;
	service.debug = false;
	process.exitCode = undefined;
}

{
	// The real serial series loop finishes muxing before the next episode reset.
	resetGlobal();
	const originalMux = service.muxStreams;
	let releaseMux,
		reachedMux,
		muxCount = 0;
	const firstMux = new Promise((resolve) => {
		reachedMux = resolve;
	});
	service.muxStreams = async () => {
		muxCount++;
		if (muxCount === 1) {
			reachedMux();
			await new Promise((resolve) => {
				releaseMux = resolve;
			});
		}
		return true;
	};
	service.logSeriesById = async () => {};
	service.downloadFromSeriesID = async () => ({ isOk: true, value: [mediaData, mediaData] });
	cliArgs = { ...mediaOptions, tsd: true, series: 'ABCDEFGHI', locale: 'en-US', requestedActionOrSelector: true };
	const batch = service.cli();
	await firstMux;
	assert.equal(mediaRequests.filter((r) => r.target === 'https://api.example.test/sessions').length, 2);
	releaseMux();
	assert.equal(await batch, true);
	assert.equal(muxCount, 2);
	assert.equal(mediaRequests.filter((r) => r.target === 'https://api.example.test/sessions').length, 3);
	assert.equal(cliArgs.tsd, true);
	service.muxStreams = originalMux;
	delete service.logSeriesById;
	delete service.downloadFromSeriesID;
}

for (const [status, body, expected] of [
	[429, '{"error":4294,"reason":"Too many requests"}', true],
	[429, '{"error":4294,"reason":"Too many requests","token":"x"}', false],
	[429, '{"error":"4294","reason":"Too many requests"}', false],
	[429, '{"error":4294,"reason":"other"}', false],
	[429, '{', false],
	[503, '{"error":4294,"reason":"Too many requests"}', false]
])
	assert.equal(recoveryModule.isPlaybackRefusal(status, body), expected);
for (const body of ['{', '{"error":4294,"reason":"Too many requests","token":"x"}']) {
	resetGlobal({ playbackRefusals: { EN: 1 }, refusalBody: body });
	const budget = { used: false };
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, tsd: false, queueRecovery: budget, dryRun: true }), false);
	assert.equal(budget.used, false);
	assert(!mediaRequests.some((r) => r.target === 'https://api.example.test/sessions'));
}
resetGlobal({ playbackRefusals: { EN: 1 }, refusalRetryAfter: '61', capacityLimit: 2 });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, tsd: false, queueRecovery: { used: false }, dryRun: true }), false);
assert.equal(mediaRequests.filter((r) => r.target === 'https://api.example.test/sessions').length, 1);
resetGlobal({ playbackRefusals: { EN: 1 }, nonzeroVerification: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, tsd: true, queueRecovery: { used: false }, dryRun: true }), false);
assert.equal(mediaRequests.filter((r) => r.target.includes('/video/play?queue=0')).length, 0);
{
	// The complete clear must precede fresh verification and a non-four allowance can admit a nonzero count.
	resetGlobal({ capacityLimit: 2 });
	const full = [
		{ contentId: 'old', token: 'old-token' },
		{ contentId: 'other', token: 'other-token' }
	];
	control.sessionSequence = [full, [{ contentId: 'new', token: 'new-token' }]];
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, tsd: true, queueRecovery: { used: false }, dryRun: true }), true);
	const operations = mediaRequests.filter(
		(r) =>
			r.target === 'https://api.example.test/sessions' ||
			r.target.endsWith('/old/old-token') ||
			r.target.endsWith('/other/other-token') ||
			r.target.includes('/video/play?queue=0')
	);
	assert.deepEqual(
		operations.slice(0, 5).map((r) => (r.target === 'https://api.example.test/sessions' ? 'list' : r.method === 'DELETE' ? 'delete' : 'acquire')),
		['list', 'delete', 'delete', 'list', 'acquire']
	);
}
{
	// A preflight clear owns the next complete group; an unchanged free refusal cannot replay blindly.
	resetGlobal({ playbackRefusals: { EN: 1 } });
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, tsd: true, queueRecovery: { used: false }, dryRun: true }), false);
	assert.equal(mediaRequests.filter((r) => r.target.includes('/EN/video/play?queue=0')).length, 1);
}
{
	// A successful video subrequest does not release preflight ownership before dependent audio acquisition.
	resetGlobal({ audioRefusals: 1, distinctAudio: true });
	assert.equal(
		await service.downloadEpisode(mediaData, {
			...mediaOptions,
			keepAllVideos: true,
			vstream: 'androidtv',
			astream: 'chrome',
			tsd: true,
			queueRecovery: { used: false },
			dryRun: true
		}),
		false
	);
	assert.equal(mediaRequests.filter((r) => r.target.includes('/EN/audio/play?queue=1')).length, 1);
}
{
	// An impossible server delay is rejected before clearing a full account.
	resetGlobal({ playbackRefusals: { EN: 1 }, refusalRetryAfter: '61', capacityLimit: 2 });
	control.sessionSequence = [
		[],
		[
			{ contentId: 'old', token: 'old-token' },
			{ contentId: 'other', token: 'other-token' }
		]
	];
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, tsd: true, queueRecovery: { used: false }, dryRun: true }), false);
	assert(!mediaRequests.some((r) => r.target.endsWith('/old/old-token')));
}
{
	// A spent-clear preflight that polls a full account must establish a known free slot.
	resetGlobal();
	control.sessionSequence = [[{ contentId: 'old', token: 'old-token' }], null];
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, tsd: true, queueRecovery: { used: true }, dryRun: true }), false);
	assert(!mediaRequests.some((r) => r.target.includes('/video/play?queue=0') || r.method === 'DELETE'));
}
{
	// Suspend the final DELETE and then verification, independently, to establish the barrier.
	resetGlobal({ capacityLimit: 2 });
	control.sessionSequence = [
		[
			{ contentId: 'old', token: 'old-token' },
			{ contentId: 'other', token: 'other-token' }
		],
		[]
	];
	let releaseDelete, releaseVerify, markDelete, markVerify;
	const deleteStarted = new Promise((resolve) => {
		markDelete = resolve;
	});
	const verifyStarted = new Promise((resolve) => {
		markVerify = resolve;
	});
	sessionBarrier = {
		delete: new Promise((resolve) => {
			releaseDelete = resolve;
		}),
		verify: new Promise((resolve) => {
			releaseVerify = resolve;
		}),
		deleteStarted: markDelete,
		verifyStarted: markVerify
	};
	const operation = service.downloadEpisode(mediaData, { ...mediaOptions, tsd: true, queueRecovery: { used: false }, dryRun: true });
	await within(deleteStarted);
	assert.equal(mediaRequests.filter((r) => r.method === 'DELETE').length, 2);
	assert.equal(mediaRequests.filter((r) => r.target === 'https://api.example.test/sessions').length, 1);
	assert(!mediaRequests.some((r) => r.target.includes('/video/play?queue=0')));
	releaseDelete();
	await within(verifyStarted);
	assert(!mediaRequests.some((r) => r.target.includes('/video/play?queue=0')));
	releaseVerify();
	assert.equal(await within(operation), true);
	sessionBarrier = undefined;
}
{
	// Independent owned incidents restart their display sequence, but not the cumulative cap.
	resetGlobal({ playbackRefusals: { EN: 1, JA: 2 }, refusalRetryAfter: '10' });
	control.sessionSequence = [[{ contentId: 'old', token: 'old-token' }], [], [], [{ contentId: 'new', token: 'new-token' }], [], []];
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, discoveryTimmer: 0, tsd: true, queueRecovery: { used: false }, dryRun: true }), false);
	assert.deepEqual(
		indicatorWaits.filter((a) => a[0] && a[2] === 'playback').map((a) => [a[3], a[4]]),
		[
			[1, 2],
			[1, 2]
		]
	);
	assert.equal(mediaRequests.filter((r) => r.target.includes('/JA/video/play?queue=0')).length, 2);
}
{
	// Two refusals within one owned incident show retry 1 then 2 when Retry-After authorizes replay.
	resetGlobal({ playbackRefusals: { EN: 2 }, refusalRetryAfter: '10' });
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, discoveryTimmer: 0, tsd: true, queueRecovery: { used: false }, dryRun: true }), true);
	assert.deepEqual(
		indicatorWaits.filter((a) => a[0] && a[2] === 'playback').map((a) => [a[3], a[4]]),
		[
			[1, 2],
			[2, 2]
		]
	);
}
{
	// Successful download preparation is only a dependent subrequest, so the same owned incident keeps retry 2.
	resetGlobal({ playbackRefusals: { EN: 2 }, refusalRetryAfter: '10' });
	const partialResult = await service.downloadEpisode(mediaData, {
		...mediaOptions,
		discoveryTimmer: 0,
		vstream: 'android',
		astream: 'android',
		tsd: true,
		queueRecovery: { used: false },
		dryRun: true
	});
	assert.equal(partialResult, true);
	assert.deepEqual(
		indicatorWaits.filter((a) => a[0] && a[2] === 'playback').map((a) => [a[3], a[4]]),
		[
			[1, 2],
			[2, 2]
		]
	);
	assert(mediaRequests.filter((r) => r.target.includes('/EN/phone/download')).length >= 3);
}
{
	// Precreated scheduler reports a two-retry maximum after full-slot polling without a clear.
	resetGlobal({ playbackRefusals: { EN: 1 }, refusalRetryAfter: '10' });
	control.sessionSequence = [[{ contentId: 'old', token: 'old-token' }], [], []];
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, discoveryTimmer: 0, tsd: true, queueRecovery: { used: true }, dryRun: true }), true);
	assert.deepEqual(
		indicatorWaits.filter((a) => a[0] && a[2] === 'playback').map((a) => [a[3], a[4]]),
		[[1, 2]]
	);
}
resetGlobal({ downloadRefusals: 1, failRecoveryClose: true });
assert.equal(
	await service.downloadEpisode(mediaData, { ...mediaOptions, keepAllVideos: true, vstream: 'android', astream: 'chrome', tsd: false, queueRecovery: { used: false } }),
	false
);
assert(!mediaRequests.some((r) => r.target === 'https://api.example.test/sessions'));

{
	// Both known tokens get one close attempt even when the first fails; the finalizer must not replay either DELETE.
	resetGlobal({ audioRefusals: 1, failRecoveryClose: true });
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, keepAllVideos: true, vstream: 'android', astream: 'chrome', tsd: false }), false);
	assert.equal(mediaRequests.filter((r) => r.method === 'DELETE' && r.target.endsWith('/EN/token-EN-1')).length, 1);
	assert.equal(mediaRequests.filter((r) => r.method === 'DELETE' && r.target.endsWith('/EN/download-EN-1')).length, 1);
	assert.equal(mediaRequests.filter((r) => r.target === 'https://api.example.test/sessions').length, 0);
	assert.equal(mediaRequests.filter((r) => r.target.includes('/EN/audio/play?queue=1')).length, 1);
}
{
	// Both playback tokens remain live until finalization. A failed video close must not skip the audio close.
	resetGlobal({ distinctAudio: true, failRecoveryClose: true });
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, keepAllVideos: true, vstream: 'androidtv', astream: 'chrome', dryRun: true }), false);
	assert.equal(peakTokens, 2);
	assert(mediaRequests.findIndex((r) => r.target.includes('/EN/audio/play?queue=1')) < mediaRequests.findIndex((r) => r.method === 'DELETE'));
	assert.equal(mediaRequests.filter((r) => r.method === 'DELETE' && r.target.endsWith('/EN/token-EN-1')).length, 1);
	assert.equal(mediaRequests.filter((r) => r.method === 'DELETE' && r.target.endsWith('/EN/token-EN-audio')).length, 1);
	assert.equal(downloads.length, 0);
	assert.equal(muxCalls.length, 0);
	assert.equal(archiveWrites.length, 0);
}
{
	// Direct requested-version preflight reuses the existing validated Android benefits response.
	resetGlobal({ capacityLimit: 2 });
	await service.downloadMediaList(mediaData, { ...mediaOptions, keepAllVideos: true, vstream: 'android', astream: 'chrome', tsd: true, dryRun: true });
	assert.equal(mediaRequests.filter((r) => r.target === 'https://api.example.test/me').length, 1);
	assert.equal(mediaRequests.filter((r) => r.target.includes('/subs/v1/subscriptions/')).length, 1);
	assert.equal(mediaRequests.filter((r) => r.target === 'https://api.example.test/sessions').length, 1);
	assert(mediaRequests.some((r) => r.target.includes('/EN/video/play?queue=0')));
}

{
	const originalEpisode = service.downloadEpisode;
	const budget = { used: false };
	service.commandRecovery = budget;
	service.logSeriesById = async () => {};
	for (const [count, enabled] of [
		[4, true],
		[5, true],
		[5, false]
	]) {
		const seen = [];
		service.downloadFromSeriesID = async () => ({ isOk: true, value: Array.from({ length: count }, () => mediaData) });
		service.downloadEpisode = async (_item, options) => {
			seen.push(options.queueRecovery);
			return true;
		};
		cliArgs = { ...mediaOptions, tsd: enabled, series: 'ABCDEFGHI', locale: 'en-US', requestedActionOrSelector: true };
		assert.equal(await service.cli(), true);
		assert.equal(seen.length, count);
		assert(seen.every((entry) => entry === budget));
	}
	service.downloadEpisode = originalEpisode;
	delete service.downloadFromSeriesID;
	delete service.logSeriesById;
	delete service.commandRecovery;
}

{
	// Manifest and acquisition retries consume the same three-stage budget.
	const f = testClock();
	let enManifest = 0,
		jaAcquire = 0,
		closes = 0;
	const stages = [];
	const result = await discoverVideoCandidates({
		sources,
		requested: ['EN'],
		ordinal: 1,
		ignoreTiming: false,
		debug: false,
		headers: {},
		clock: f.clock,
		recoveryBudget: { used: false },
		onWaiting: (retry, _ms, kind, playbackRetry) => {
			if (retry) stages.push([retry, kind, playbackRetry]);
		},
		recover: async (attempt, pace, _signal, headers, refusedAt) => {
			await pace.waitPlayback(headers, attempt, refusedAt);
			return true;
		},
		acquire: async (source) => {
			if (source.guid === 'JA' && jaAcquire++ < 2) throw new recoveryModule.PlaybackRefusal(new Headers());
			return { token: source.guid, url: `https://example.test/static/${source.guid}/clean/dash/manifest.mpd` };
		},
		close: async () => {
			closes++;
			return true;
		},
		req: {
			getData: async (url) => {
				if (url.includes('/EN/') && !url.includes('/0/clean/') && !url.includes('/1/clean/') && enManifest++ === 0)
					return { ok: false, res: new Response('', { status: 429 }) };
				if (url.includes('/0/clean/') || url.includes('/1/clean/')) return { ok: false, res: new Response('', { status: 404 }) };
				return { ok: true, res: new Response(xml(url.includes('/JA/') ? 'JA' : 'EN')) };
			}
		}
	});
	assert.equal(result.status, 'ok');
	assert.equal(result.entries.length, 2);
	assert.equal(jaAcquire, 3);
	assert.equal(closes, 2);
	assert.deepEqual(
		stages.map((x) => [x[0], x[1], x[2]]),
		[
			[1, 'manifest', 0],
			[2, 'playback', 1],
			[3, 'playback', 2]
		]
	);
	assert(f.waits.includes(1000) && f.waits.includes(10000) && f.waits.includes(30000));
}
{
	const f = testClock();
	const abort = new AbortController();
	f.clock.sleep = async () => {
		abort.abort();
		throw Error('discovery cancelled');
	};
	let acquires = 0,
		resets = 0;
	const result = await discoverVideoCandidates({
		sources: [sources[0]],
		requested: ['EN'],
		ordinal: 1,
		ignoreTiming: false,
		debug: false,
		headers: {},
		clock: f.clock,
		signal: abort.signal,
		recoveryBudget: { used: false },
		recover: async (attempt, pace, _signal, headers, refusedAt) => {
			await pace.waitPlayback(headers, attempt, refusedAt);
			resets++;
			return true;
		},
		acquire: async () => {
			acquires++;
			throw new recoveryModule.PlaybackRefusal(new Headers());
		},
		close: async () => true,
		req: {}
	});
	assert.equal(result.status, 'unsafe');
	assert.equal(acquires, 1);
	assert.equal(resets, 0);
}

{
	resetGlobal({ playbackRefusals: { JA: 3 }, capacityLimit: 2 });
	const before = fakeNow;
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, tsd: false, dryRun: true }), true);
	assert(fakeNow - before >= 100000 && fakeNow - before <= 107000, `three waits with pacing credit: ${fakeNow - before}`);
	assert.equal(mediaRequests.filter((r) => r.target.endsWith('/old/old-token')).length, 0);
}
{
	resetGlobal({ playbackRefusals: { EN: 1 }, refusalTransportError: true, capacityLimit: 2 });
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, tsd: false, dryRun: true }), false);
	assert.equal(mediaRequests.filter((r) => r.target === 'https://api.example.test/sessions').length, 0, 'transport error with a 429 body is not replayed');
	resetGlobal({ downloadUnknown: true });
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, keepAllVideos: true, vstream: 'android', astream: 'chrome' }), false);
	assert.equal(downloads.length, 0);
	assert.equal(muxCalls.length, 0);
	resetGlobal({ downloadErrorStatus: true });
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, keepAllVideos: true, vstream: 'android', astream: 'chrome' }), false);
	assert.equal(downloads.length, 0);
}

{
	// Playback ordinal belongs to discovery, even when separate sources refuse.
	resetGlobal({ playbackRefusals: { EN: 1, JA: 1 }, capacityLimit: 2 });
	const before = fakeNow;
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, tsd: false, dryRun: true }), true);
	assert(fakeNow - before >= 40000 && fakeNow - before < 46000);
}
{
	// A late full result cannot spend the one clear on the third discovery replay.
	resetGlobal({ playbackRefusals: { JA: 3 } });
	control.sessionSequence = [[], [], [], [{ contentId: 'old', token: 'old-token' }]];
	const budget = { used: false };
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, tsd: true, queueRecovery: budget, dryRun: true }), false);
	assert.equal(budget.used, false);
	assert.equal(mediaRequests.filter((r) => r.target.endsWith('/old/old-token')).length, 0);
}
{
	// Unknown during polling does not restart its deadline on a later refusal.
	resetGlobal({ playbackRefusals: { EN: 2 } });
	control.sessionSequence = [[{ contentId: 'old', token: 'old-token' }], null, [{ contentId: 'old', token: 'old-token' }]];
	const before = fakeNow;
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, tsd: false, dryRun: true }), false);
	assert(fakeNow - before >= 60000 && fakeNow - before < 63000, `slot interval restarted: ${fakeNow - before}`);
}
// Exact 4294 permits one incident and resumes the failing discovery source only.
for (const failures of [1, 2, 3]) {
	resetGlobal({ playbackRefusals: { JA: failures } });
	const budget = { used: false };
	const result = await service.downloadEpisode(mediaData, { ...mediaOptions, tsd: true, queueRecovery: budget, dryRun: true });
	assert.equal(result, failures < 3);
	assert.equal(budget.used, true);
	assert.equal(mediaRequests.filter((r) => r.target === 'https://api.example.test/sessions').length, failures === 1 ? 3 : 4);
	assert.equal(mediaRequests.filter((r) => r.target.endsWith('/old/old-token')).length, 1);
	const playbackEvents = mediaRequests.filter((r) => r.target.includes('/video/play?queue=0'));
	assert.equal(playbackEvents.filter((r) => r.target.includes('/EN/')).length, failures === 3 ? 1 : 2);
	assert.equal(playbackEvents.filter((r) => r.target.includes('/JA/')).length, failures === 3 ? 3 : failures + 2);
}
resetGlobal({ benefitDelayMs: 120000, distinctAudio: true });
const freshWindowResult = await service.downloadEpisode(mediaData, {
	...mediaOptions,
	tsd: false,
	queueRecovery: { used: false },
	vstream: 'android',
	astream: 'chrome',
	dryRun: true
});
assert.equal(freshWindowResult, true, 'execution deadline starts after unrelated pre-acquisition metadata');
resetGlobal({ playbackRefusals: { JA: 1 }, refusalAfter: 2 });
const executionBudget = { used: false };
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, tsd: true, queueRecovery: executionBudget }), true);
assert.equal(executionBudget.used, true);
assert.equal(downloads.length, 2);
assert.equal(muxCalls.length, 1);
assert.equal(archiveWrites.length, 1);
assert.equal(mediaRequests.filter((r) => r.target === 'https://api.example.test/sessions').length, 3);

for (const failures of [2, 3]) {
	resetGlobal({ playbackRefusals: { JA: failures }, refusalAfter: 2 });
	const budget = { used: false };
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, tsd: true, queueRecovery: budget }), failures === 2);
	assert.equal(mediaRequests.filter((r) => r.target === 'https://api.example.test/sessions').length, 4);
	assert.equal(mediaRequests.filter((r) => r.target.endsWith('/old/old-token')).length, 1);
	assert.equal(mediaRequests.filter((r) => r.target.includes('/JA/video/play?queue=0')).length, 4);
	assert.equal(muxCalls.length, failures === 2 ? 1 : 0);
}
resetGlobal({ audioRefusals: 1, distinctAudio: true });
const audioBudget = { used: false };
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, vstream: 'androidtv', astream: 'chrome', tsd: true, queueRecovery: audioBudget }), true);
assert.equal(audioBudget.used, true);
assert.equal(downloads.length, 2);
assert.equal(muxCalls.length, 1);
assert.equal(archiveWrites.length, 1);
const ownCloseIndex = mediaRequests.findIndex((r) => r.target.endsWith('/EN/token-EN-4'));
const resetIndex = mediaRequests.findLastIndex((r) => r.target === 'https://api.example.test/sessions');
assert(ownCloseIndex >= 0 && ownCloseIndex < resetIndex);
assert.equal(mediaRequests.filter((r) => r.target.includes('/EN/audio/play?queue=1')).length, 2);
resetGlobal({ playbackRefusals: { JA: 1 }, refusalAfter: 1 });
const laterDubBudget = { used: false };
assert.equal(await service.downloadEpisode(multiDubData, { ...mediaOptions, keepAllVideos: true, tsd: true, queueRecovery: laterDubBudget }), true);
assert.equal(laterDubBudget.used, true);
assert.equal(muxCalls.length, 1);
assert.equal(archiveWrites.length, 1);
assert.equal(mediaRequests.filter((r) => r.target.includes('/EN/video/play?queue=0')).length, 1);
assert.equal(mediaRequests.filter((r) => r.target.includes('/JA/video/play?queue=0')).length, 2);
assert.equal(mediaRequests.filter((r) => r.target === 'https://api.example.test/sessions').length, 3);

{
	const entitlement = recoveryModule.concurrentStreamLimit;
	assert.equal(entitlement({ items: [{ benefit: 'concurrent_streams.4' }, { benefit: 'concurrent_streams.4' }] }), 4);
	for (const items of [
		[],
		[{ benefit: 'concurrent_streams.0' }],
		[{ benefit: 'concurrent_streams.x' }],
		[{ benefit: 'concurrent_streams.1' }, { benefit: 'concurrent_streams.2' }]
	])
		assert.equal(entitlement({ items }), undefined);
	assert.equal(
		recoveryModule.playbackSessions({
			items: [
				{ contentId: 'a', token: 'b' },
				{ contentId: 'a', token: 'b' }
			]
		}).length,
		1
	);
	assert.equal(recoveryModule.playbackSessions({ items: [{ contentId: 'a' }] }), undefined);
	assert.equal(recoveryModule.playbackSessions({ items: [], total: 1 }), undefined);
	assert.equal(recoveryModule.playbackSessions({ items: [], next: 'more' }), undefined);
	assert.equal(recoveryModule.playbackSessions({ items: [], has_more: true }), undefined);
	assert.equal(recoveryModule.playbackSessions({ items: [], pagination: { next: 'more' } }), undefined);
}
{
	// One-episode free capacity is checked without deleting; the same applies to multiple dubs.
	resetGlobal({ capacityLimit: 2 });
	const budget = { used: false };
	assert.equal(await service.downloadEpisode(multiDubData, { ...mediaOptions, keepAllVideos: true, tsd: true, queueRecovery: budget, dryRun: true }), true);
	assert.equal(budget.used, false);
	assert.equal(mediaRequests.filter((r) => r.target === 'https://api.example.test/sessions').length, 1);
	assert.equal(mediaRequests.filter((r) => r.target.endsWith('/old/old-token')).length, 0);
}
{
	// A spent command budget waits for a free slot without a second account-wide clear.
	resetGlobal();
	const full = [{ contentId: 'old', token: 'old-token' }];
	control.sessionSequence = [full, []];
	const budget = { used: true };
	const before = fakeNow;
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, tsd: true, queueRecovery: budget, dryRun: true }), true);
	assert(fakeNow - before >= 5000);
	assert.equal(mediaRequests.filter((r) => r.target.endsWith('/old/old-token')).length, 0);
}
{
	// No-TSD success has no proactive capacity request; an exact refusal polls a full account.
	resetGlobal({ playbackRefusals: { EN: 1 } });
	const full = [{ contentId: 'old', token: 'old-token' }];
	control.sessionSequence = [full, []];
	const before = fakeNow;
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, tsd: false, queueRecovery: { used: false }, dryRun: true }), true);
	assert(fakeNow - before >= 5000);
	assert.equal(mediaRequests.filter((r) => r.target.endsWith('/old/old-token')).length, 0);
	assert.equal(mediaRequests.filter((r) => r.target === 'https://api.example.test/sessions').length, 2);
	resetGlobal({ playbackRefusals: { EN: 1 } });
	const expiredAt = fakeNow;
	assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, tsd: false, queueRecovery: { used: false }, dryRun: true }), false);
	assert(fakeNow - expiredAt >= 60000 && fakeNow - expiredAt < 63000);
	assert.equal(mediaRequests.filter((r) => r.target.includes('/EN/video/play?queue=0')).length, 1);
	assert.equal(mediaRequests.filter((r) => r.target.endsWith('/old/old-token')).length, 0);
}
{
	// Missing or conflicting entitlement is unknown; no account reset is authorized.
	for (const benefitsPayload of [{ items: [] }, { items: [{ benefit: 'concurrent_streams.1' }, { benefit: 'concurrent_streams.2' }] }]) {
		resetGlobal({ benefitsPayload });
		const budget = { used: false };
		assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, tsd: true, queueRecovery: budget, dryRun: true }), true);
		assert.equal(budget.used, false);
		assert.equal(mediaRequests.filter((r) => r.target.endsWith('/old/old-token')).length, 0);
	}
}
{
	const f = testClock();
	const pace = new scheduler.DiscoveryScheduler(8, f.clock, undefined, undefined, 0);
	f.advance(89999);
	await pace.playbackSleep(60000);
	assert.equal(pace.remaining(), 1);
	f.advance(2);
	await assert.rejects(pace.playbackSleep(1), /deadline/, 'expired work cannot be revived by a later sleep');
	const g = testClock();
	const ordinary = new scheduler.DiscoveryScheduler(8, g.clock, undefined, undefined, 0);
	for (let i = 1; i <= 3; i++) {
		ordinary.reservePlaybackRetry();
		await ordinary.waitPlayback(new Headers(), i);
	}
	assert.deepEqual(g.waits, [10000, 30000, 60000]);
	assert.equal(ordinary.remaining(), 90000);
	await assert.rejects(ordinary.playbackSleep(21000), /required 21s; 20s remaining of the 120s allowance/);
	const diagnostic = testClock();
	const bounded = new scheduler.DiscoveryScheduler(8, diagnostic.clock);
	await assert.rejects(bounded.waitPlayback(new Headers({ 'Retry-After': '61' }), 1), /server Retry-After requested 61s; maximum 60s per wait/);
	await assert.rejects(bounded.waitServerDelay(new Headers({ 'Retry-After': '70' }), 0), /server Retry-After requested 70s; maximum 60s per wait/);
	await assert.rejects(bounded.waitPlayback(new Headers({ 'Retry-After': '9'.repeat(400) }), 1), /more than 60s \(too large to represent\)/);
	await assert.rejects(bounded.waitPlayback(new Headers(), 4), /invalid retry ordinal/);
	assert.deepEqual(diagnostic.waits, [], 'invalid waits never sleep');
	const exhausted = new scheduler.DiscoveryScheduler(8, diagnostic.clock, undefined, undefined, 0, { started: 0, creditedSleep: 0, admittedSleep: 115000 });
	await assert.rejects(exhausted.waitPlayback(new Headers(), 1), /required 10s; 5s remaining of the 120s allowance/);
	assert.deepEqual(diagnostic.waits, [], 'exhausted allowance never sleeps');
	const h = testClock();
	const paced = new scheduler.DiscoveryScheduler(16, h.clock, undefined, undefined, 70000);
	for (let i = 0; i < 8; i++) await paced.dispatch();
	await assert.rejects(paced.dispatch(false, 60000), /slot wait timed out/);
	assert.equal(h.clock.now(), 60000);
}

{
	// An observed header is informational even when the refusal body is ineligible.
	const dir = statusFixtureDir('status-fixture-');
	try {
		fs.mkdirSync(path.join(dir, 'config'));
		mediaDeps['./modules/module.cfg-loader'].workingDir = dir;
		service.token.account_id = 'synthetic-account';
		const binding = statusModule.accountBinding('synthetic-account');
		const directory = path.join(dir, 'config');
		const early = new Response('', { status: 429, headers: { 'Retry-After': '120' } });
		statusModule.observePlaybackWait(directory, binding, early, 1000);
		statusModule.observePlaybackWait(directory, binding, new Response('', { status: 429, headers: { 'Retry-After': '5' } }), 2000);
		assert.equal(statusModule.readPlaybackWait(directory, binding).deadline, 121000);
		statusModule.observePlaybackWait(directory, binding, new Response('', { status: 429, headers: { 'Retry-After': '5' } }), 122000);
		assert.equal(statusModule.readPlaybackWait(directory, binding).observed, 122000, 'expired longer record can be replaced');
		assert.equal(statusModule.readPlaybackWait(directory, binding).deadline, 127000);

		assert.equal(statusModule.readPlaybackWait(directory, statusModule.accountBinding('different')), undefined);
		assert.equal(fs.statSync(path.join(directory, 'cr_playback_status.json')).mode & 0o777, 0o600);
		assert(!fs.readFileSync(path.join(directory, 'cr_playback_status.json'), 'utf8').includes('synthetic-account'));
		statusModule.observePlaybackWait('/missing/path', binding, early, 1000);
		fs.writeFileSync(path.join(directory, 'cr_playback_status.json'), '{invalid');
		assert.equal(statusModule.readPlaybackWait(directory, binding), undefined);
		resetGlobal({ playbackRefusals: { EN: 1 }, refusalBody: '{partial', refusalRetryAfter: '61' });
		assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, qall: false, dryRun: true }), false);
		const record = statusModule.readPlaybackWait(directory, binding);
		assert(record && record.deadline - record.observed === 61000);
		assert.equal(mediaRequests.filter((r) => r.target === 'https://api.example.test/sessions').length, 0);
		fs.unlinkSync(path.join(directory, 'cr_playback_status.json'));
		resetGlobal({ downloadRefusals: 1, refusalRetryAfter: '61' });
		await service.downloadEpisode(mediaData, { ...mediaOptions, keepAllVideos: true, vstream: 'android', astream: 'chrome', dryRun: true });
		const downloadRecord = statusModule.readPlaybackWait(directory, binding);
		assert(downloadRecord && downloadRecord.deadline - downloadRecord.observed === 61000);
	} finally {
		delete service.token.account_id;
		delete mediaDeps['./modules/module.cfg-loader'].workingDir;
		fs.rmSync(dir, { recursive: true, force: true });
	}
}
{
	// Read-only status keeps partial account data, reports a current 429, and always stops the indicator.
	const originalReq = service.req,
		originalToken = service.token,
		originalArgs = cliArgs;
	const originalRefresh = service.refreshToken;
	const originalStatusNow = statusNow;
	statusNow = new Date(2026, 10, 16, 12, 0, 0, 250).getTime();
	const dir = statusFixtureDir('status-output-');
	try {
		fs.mkdirSync(path.join(dir, 'config'));
		mediaDeps['./modules/module.cfg-loader'].workingDir = dir;
		statusModule.observePlaybackWait(
			path.join(dir, 'config'),
			statusModule.accountBinding('status-account'),
			new Response('', { status: 429, headers: { 'Retry-After': '1' } }),
			statusNow - 5000
		);
		resetGlobal();
		service.token = { access_token: 'synthetic', refresh_token: 'synthetic', account_id: 'status-account' };
		cliArgs = { checkStatus: true, debug: false };
		const calls = [];
		service.req = {
			argv: {},
			getData: async (target, options) => {
				calls.push({ target, method: options.method });
				let res;
				if (target === 'https://api.example.test/me') res = new Response(JSON.stringify({ external_id: 'synthetic' }));
				else if (target.includes('/benefits')) res = new Response(JSON.stringify({ items: [{ benefit: 'concurrent_streams.4' }] }));
				else res = new Response('', { status: 429, headers: { 'Retry-After': '476' } });
				options.onResponse?.(res);
				return { ok: res.ok, res };
			}
		};
		const starts = indicatorStarts,
			stops = indicatorStops;
		assert.equal(await service.cli(), false);
		assert.equal(indicatorStarts - starts, 1);
		assert.equal(indicatorStops - stops, 1);
		assert(mediaLogs.some((entry) => String(entry[0]).includes('allowance: 4')));
		assert(mediaLogs.some((entry) => String(entry[0]).includes('sessions: unknown')));
		assert(mediaLogs.some((entry) => String(entry[0]).includes('Retry-After 07:56')));
		const elapsedStatus = mediaLogs.find((entry) => String(entry[0]).includes('playback wait elapsed'));
		assert.equal(String(elapsedStatus?.[0]), 'Last observed playback wait elapsed; current playback is unverified.');
		assert(!String(elapsedStatus?.[0]).includes('T') && !String(elapsedStatus?.[0]).includes('Z'));
		assert(calls.every((call) => !call.method && !call.target.includes('/play')));
		assert.equal(calls.length, 3);
		const observed = statusNow;
		const binding = statusModule.accountBinding('status-account');
		statusModule.observePlaybackWait(path.join(dir, 'config'), binding, new Response('', { status: 429, headers: { 'Retry-After': '61' } }), observed);
		const activeWait = statusModule.readPlaybackWait(path.join(dir, 'config'), binding);
		assert(activeWait);
		mediaLogs.length = 0;
		cliArgs = { checkStatus: true, debug: true };
		assert.equal(await service.cli(), false);
		const activeStatus = mediaLogs.map((entry) => String(entry[0])).find((line) => line.includes('Earliest suggested retry'));
		assert(activeStatus);
		assert(activeStatus.includes(`Earliest suggested retry (local time): ${statusModule.formatLocalRetryTime(activeWait.deadline)}`));
		assert(activeStatus.includes('Last observed playback wait: 01:01 remaining.'));
		assert(mediaLogs.some((entry) => String(entry[0]).includes('[DEBUG] Status sessions: HTTP 429, Retry-After 07:56')));
		assert(!activeStatus.includes('T') && !activeStatus.includes('Z'));
		service.req.getData = async (target, options) => {
			if (target === 'https://api.example.test/me') return { ok: false };
			assert.equal(target, 'https://api.example.test/sessions');
			return { ok: true, res: new Response(JSON.stringify({ items: [] })) };
		};
		mediaLogs.length = 0;
		assert.equal(await service.cli(), false);
		assert(mediaLogs.some((entry) => String(entry[0]).includes('allowance: unknown')));
		assert(mediaLogs.some((entry) => String(entry[0]).includes('sessions: 0')));
		let pendingStart;
		const started = new Promise((resolve) => {
			pendingStart = resolve;
		});
		service.req.getData = async (_target, options) => {
			pendingStart();
			return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true }));
		};
		const cancelled = service.cli();
		await started;
		process.emit('SIGINT');
		assert.equal(await cancelled, false);
		assert.equal(indicatorStarts - starts, indicatorStops - stops);
		let finishLate,
			count = 0;
		service.req.getData = async () => {
			count++;
			return new Promise((resolve) => {
				finishLate = resolve;
			});
		};
		const timers = boundedTimers;
		fastTimers = true;
		assert.equal(await service.cli(), false);
		fastTimers = false;
		assert.equal(boundedTimers - timers, 1, 'one deadline bounds the whole snapshot');
		finishLate({ ok: true, res: new Response(JSON.stringify({ external_id: 'late' })) });
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(count, 1, 'late completion starts no new status request');
		assert.equal(indicatorStarts - starts, indicatorStops - stops);
	} finally {
		fastTimers = false;
		service.req = originalReq;
		service.token = originalToken;
		service.refreshToken = originalRefresh;
		statusNow = originalStatusNow;
		cliArgs = originalArgs;
		delete mediaDeps['./modules/module.cfg-loader'].workingDir;
		fs.rmSync(dir, { recursive: true, force: true });
	}
}
{
	// Read-only config does not create media directories; normal setup retains its existing creation.
	let created = 0;
	const cfg = compile(
		'modules/module.cfg-loader.ts',
		{
			'dotenv/config': {},
			'./module.crunchy-session-store': mediaDeps['./modules/module.crunchy-session-store'],
			fs: {
				existsSync: () => false,
				mkdirSync: () => {
					created++;
				}
			},
			'./log': { console: mediaLogger }
		},
		{ __dirname: path.join(root, 'modules'), process: { env: { contentDirectory: '/synthetic' } } }
	);
	cfg.loadCfg(true);
	assert.equal(created, 0);
	cfg.loadCfg();
	assert.equal(created, 1);
	const ignored = require('ignore')().add(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'));
	assert(ignored.ignores('config/cr_playback_status.json'));
	assert(ignored.ignores('config/cr_playback_status.json.synthetic.tmp'));
	assert(fs.readFileSync(path.join(root, 'tsc.ts'), 'utf8').includes("'./config/cr_playback_status.json*'"));
	const builder = fs.readFileSync(path.join(root, 'modules/build.ts'), 'utf8');
	assert(!builder.includes("copyFileSync('./config/cr_playback_status"));
}
{
	const previous = { request: service.req, token: service.token, cms: service.cmsToken, loader: mediaDeps['./modules/module.cfg-loader'].loadCRSessions };
	const tv = { auth_type: 'device', device_id: 'test-tv', account_id: 'same-account', access_token: 'fake-tv-bearer', refresh_token: 'fake-tv-refresh', expires: new Date(4e12) };
	const phone = {
		auth_type: 'android',
		device_id: 'test-phone',
		account_id: 'same-account',
		access_token: 'fake-phone-bearer',
		refresh_token: 'fake-phone-refresh',
		expires: new Date(4e12)
	};
	const manifest = 'https://cr-play-service.prd.crunchyrollsvc.com/fixture.mpd';
	const observed = [];
	let reject;
	try {
		resetGlobal();
		mediaDeps['./modules/module.cfg-loader'].loadCRSessions = () => ({ sessions: { androidtv: tv, android: phone } });
		service.token = tv;
		service.cmsToken = { cms: {} };
		service.req = {
			argv: { debug: false },
			async getData(url, options = {}) {
				observed.push({ url, method: options.method, bearer: options.headers?.Authorization });
				if (options.method === 'DELETE') return { ok: true, res: new Response(null, { status: 204 }) };
				if (url === manifest) return { ok: true, res: new Response(mediaMpd('EN', 'current')) };
				if (url.includes('/play?queue=')) {
					if (reject === 'video' && options.headers?.Authorization === 'Bearer fake-tv-bearer') {
						return { ok: false, res: Response.json({ code: 40016 }, { status: 400 }) };
					}
					if (reject === 'audio' && options.headers?.Authorization === 'Bearer fake-phone-bearer') {
						return { ok: false, res: Response.json({ error: 'unauthorized' }, { status: 401 }) };
					}
					return { ok: true, res: new Response(JSON.stringify({ token: 'same-playback-token', url: manifest, hardSubs: {}, audioLocale: 'en-US' })) };
				}
				throw Error(`Unexpected fixture URL ${url}`);
			}
		};
		const opts = { ...mediaOptions, vstream: 'androidtv', astream: 'android', dryRun: true };
		const result = await service.downloadMediaList(mediaData, opts);
		assert.equal(result?.error, false);
		assert.deepEqual(
			observed.filter((item) => item.url.includes('/play?')).map((item) => item.bearer),
			['Bearer fake-tv-bearer', 'Bearer fake-phone-bearer']
		);
		assert.deepEqual(
			observed.filter((item) => item.url === manifest).map((item) => item.bearer),
			['Bearer fake-tv-bearer', 'Bearer fake-phone-bearer']
		);
		assert.deepEqual(
			observed.filter((item) => item.method === 'DELETE').map((item) => [new URL(item.url).hostname, item.bearer]),
			[
				['cr-play-service.prd.crunchyrollsvc.com', 'Bearer fake-tv-bearer'],
				['www.crunchyroll.com', 'Bearer fake-phone-bearer']
			]
		);
		const roleErrors = () => mediaLogs.map(([message]) => String(message)).filter((message) => message.includes('has no valid'));
		reject = 'audio';
		observed.length = mediaLogs.length = 0;
		assert.equal(await service.downloadMediaList(mediaData, opts), undefined);
		assert.equal(roleErrors().length, 1);
		assert.match(roleErrors()[0], /Audio endpoint "android" has no valid Android phone session\. Sign in first\./);
		assert.match(roleErrors()[0], /Keep your Crunchyroll command and replace its options with:[\s\S]*--device android/);
		assert.doesNotMatch(roleErrors()[0], /--service|aniDL|anidl/);
		assert.match(roleErrors()[0], /run your download command again\./i);
		assert.deepEqual(
			observed.filter((item) => item.method === 'DELETE').map((item) => item.bearer),
			['Bearer fake-tv-bearer']
		);
		reject = 'video';
		observed.length = mediaLogs.length = 0;
		assert.equal(await service.downloadEpisode(mediaData, opts), false);
		assert.equal(roleErrors().length, 1);
		assert.match(roleErrors()[0], /Video endpoint "androidtv" has no valid Android TV session\. Sign in first\./);
		assert.match(roleErrors()[0], /Keep your Crunchyroll command and replace its options with:[\s\S]*--device androidtv/);
		assert.doesNotMatch(roleErrors()[0], /--service|aniDL|anidl/);
		assert.match(roleErrors()[0], /run your download command again\./i);
		assert.equal(observed.filter((item) => item.url.includes('/play?')).length, 1);
		reject = undefined;
		phone.account_id = 'different-account';
		observed.length = 0;
		assert.equal(await service.downloadMediaList(mediaData, opts), undefined);
		assert.deepEqual(observed, []);
	} finally {
		service.req = previous.request;
		service.token = previous.token;
		service.cmsToken = previous.cms;
		mediaDeps['./modules/module.cfg-loader'].loadCRSessions = previous.loader;
	}
}
output.log('Crunchy global two-pass consumer contract passed');
