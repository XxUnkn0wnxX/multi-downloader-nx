import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import output from 'node:console';
import { setTimeout, clearTimeout } from 'node:timers';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import ts from 'typescript';

const { AbortController, Response } = globalThis;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
		{ module, exports: module.exports, require: (id) => deps[id] ?? require(id), URL, AbortController, setTimeout, clearTimeout, Buffer, console: output, ...overrides },
		{ filename: file }
	);
	return module.exports;
}
const messages = [];
const log = { debug: (...args) => messages.push(args) };
const catalog = compile('modules/module.crunchy-video-catalog.ts');
const manifests = compile('modules/module.crunchy-manifests.ts', { './log': { console: log }, './module.transform-mpd': {}, './module.crunchy-video-catalog': catalog });
const { discoverVideoCandidates } = compile('modules/module.crunchy-video-selection.ts', {
	'./log': { console: log },
	'./module.crunchy-video-catalog': catalog,
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
assert.equal(limited.result.status, 'unsafe');
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
	{ './log': { console: log }, './module.crunchy-video-catalog': catalog, './module.crunchy-manifests': manifests },
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
assert.equal(expired.status, 'fallback');
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
	{ './log': { console: log }, './module.crunchy-video-catalog': catalog, './module.crunchy-manifests': manifests },
	{ Date: ExpiredClock }
);
let began = false;
const noLease = await expiredBefore.discoverVideoCandidates({
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
assert.equal(noLease.status, 'fallback');
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
	locale2language: () => languageItems[0]
};
const activeTokens = new Set();
let peakTokens = 0,
	downloadCounter = 0;
const own = (token) => {
	activeTokens.add(token);
	peakTokens = Math.max(peakTokens, activeTokens.size);
	return token;
};
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
	rateFresh: false,
	failLicense: false,
	hls: false,
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
let tokenCounter = 0;
let fastTimers = false;
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
const mediaLogger = { info: (...a) => mediaLogs.push(a), warn: (...a) => mediaLogs.push(a), error: (...a) => mediaLogs.push(a), debug: (...a) => mediaLogs.push(a) };
const selectedHeads = [];
const realTransform = compile('modules/module.transform-mpd.ts', {
	'./module.langsData': langData,
	'./log': { console: mediaLogger },
	'./module.fetch': {
		Req: class {
			async getData(target, options) {
				selectedHeads.push({ target, signal: options.signal });
				if (control.badHead) return { ok: false, res: { status: control.badHead, headers: { get: () => '150' } } };
				if (control.stallHead) return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error('HEAD aborted')), { once: true }));
				throw Error('Unexpected HEAD');
			}
		}
	}
});
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
		'./module.crunchy-manifests': realManifests
	},
	{ setTimeout: (fn, ms) => setTimeout(fn, fastTimers ? 0 : ms) }
);
const mediaDeps = {
	'./package.json': {},
	fs: {
		existsSync: () => true,
		mkdirSync: () => {
			throw Error('unexpected mkdir');
		},
		unlinkSync() {},
		copyFileSync() {}
	},
	'./modules/log': { console: mediaLogger },
	'./modules/module.langsData': langData,
	'./modules/module.transform-mpd': realTransform,
	'./modules/module.crunchy-manifests': realManifests,
	'./modules/module.crunchy-video-catalog': catalog,
	'./modules/module.crunchy-video-selection': realSelection,
	'./modules/module.cfg-loader': { loadBinCfg: async () => ({ ffmpeg: 'fake', mp4decrypt: 'fake' }) },
	'./modules/module.api-urls': { api: { crunchyDefHeader: {}, drm_widevine: 'https://license.invalid/', me: 'https://api.example.test/me' }, domain: {} },
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
	'./modules/module.downloadArchive': { downloaded: (...args) => archiveWrites.push(args) },
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
	'./modules/module.merger',
	'./modules/module.fetch',
	'./modules/module.parseSelect',
	'./modules/module.args',
	'./modules/module.vtt2ass',
	'./modules/module.crunchy-token',
	'./modules/module.crunchy-device-auth',
	'm3u8-parser'
]);
const { default: Crunchy } = compile('crunchy.ts', new Proxy(mediaDeps, { get: (target, key) => (key in target ? target[key] : ignored.has(key) ? {} : undefined) }));
const service = Object.create(Crunchy.prototype);
service.cfg = { bin: { ffmpeg: 'fake', mp4decrypt: 'fake' }, dir: { content: '/synthetic' } };
service.token = { access_token: 'synthetic' };
service.cmsToken = { cms: {} };
service.debug = false;
service.deviceHeaders = () => ({});
service.refreshToken = async () => true;
service.sleep = async () => {};
service.muxStreams = async (data, options) => muxCalls.push({ data, options });
service.req = {
	argv: { debug: false },
	async getData(target, options = {}) {
		mediaRequests.push({ target, method: options.method });
		if (options.method === 'DELETE') {
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
		if (target === 'https://api.example.test/me') return { ok: true, res: new Response(JSON.stringify({ external_id: 'synthetic' })) };
		if (target.includes('/subs/v1/subscriptions/')) return { ok: true, res: new Response(JSON.stringify({ items: [{ benefit: 'offline_viewing' }] })) };
		const download = /\/v3\/(EN|JA2|JA)\/(phone|tablet)\/download$/.exec(target);
		if (download) {
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
						audioLocale: source.startsWith('JA') ? 'ja-JP' : 'en-US',
						subtitles: {},
						captions: {}
					})
				)
			};
		}
		const playback = /\/v3\/(EN|JA2|JA)\/video\/play\?queue=0$/.exec(target);
		if (playback) {
			const source = playback[1];
			if (control.videoReject && source === 'EN' && tokenCounter >= 3) return { ok: false };
			const playbackToken = own(`token-${source}-${++tokenCounter}`);
			if ((control.deferExecDownload || control.stallHead) && source === 'JA' && tokenCounter >= 3) fastTimers = true;
			return {
				ok: true,
				res: new Response(
					JSON.stringify({
						token: playbackToken,
						url: control.hls
							? 'https://example.test/master.m3u8'
							: `https://example.test/v2/manifest/${source}/static/majin/${source}/clean/cenc/dash/manifest.mpd?sig=opaque`,
						hardSubs: control.hard
							? {
									en: {
										url: control.hls
											? 'https://example.test/master.m3u8'
											: `https://example.test/v2/manifest/${source}/static/majin/${source}/clean/cenc/dash/manifest.mpd?sig=opaque`,
										hlang: 'en-US'
									}
								}
							: {},
						audioLocale: source.startsWith('JA') ? 'ja-JP' : 'en-US',
						subtitles: {},
						captions: {}
					})
				)
			};
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
						subtitles: {},
						captions: {}
					})
				)
			};
		if (target === 'https://example.test/master.m3u8')
			return { ok: true, res: new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720\nhttps://cdn.example.test/chunk.m3u8?sig=ok\n') };
		const manifestRequest = /\/manifest\/(EN|JA2|JA)\/static\/(?:majin\/)?(?:EN|JA2|JA)\/(?:([01])\/)?clean\/(?:cenc\/)?dash\//.exec(target);
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
assert.equal(await service.downloadEpisode(mediaData, mediaOptions), true);
assert.equal(mediaLogs.filter((entry) => String(entry[0]).startsWith('Available Video Qualities:')).length, 1);
assert(mediaLogs.some((entry) => String(entry[0]).includes('    1080p\n        [1]')));
assert(mediaLogs.some((entry) => String(entry[0]).includes('[Legacy M] [jpn]')));
assert(mediaLogs.some((entry) => String(entry[0]).includes('[Current M] [eng]')));

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
	selectedHeads.length = 0;
	licenseCalls.length = 0;
	downloads.length = 0;
	mediaRequests.length = 0;
	archiveWrites.length = 0;
	muxCalls.length = 0;
	tokenCounter = 0;
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
			rateFresh: false,
			failLicense: false,
			hls: false,
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
		},
		overrides
	);
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
resetGlobal({ vanish: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), true);
assert(downloads[0].m3u8json.segments[0].uri.includes('/EN/current/'));
assert.equal(mediaLogs.filter((entry) => String(entry[0]) === '[Notice: falling back to eng video — stream changed]').length, 1);
resetGlobal({ mismatch: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), true);
assert(downloads[0].m3u8json.segments[0].uri.includes('/EN/'));
assert.equal(mediaLogs.filter((entry) => String(entry[0]) === '[Notice: falling back to eng video — timing unknown]').length, 1);
resetGlobal({ allUnknown: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, dryRun: true }), true);
assert.equal(mediaLogs.filter((entry) => String(entry[0]) === '[Notice: falling back to eng video — timing unknown]').length, 1);
resetGlobal({ allUnknown: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, q: 1, dryRun: true }), true);
assert(!mediaLogs.some((entry) => String(entry[0]).includes('[Notice: falling back')));
resetGlobal({ fpsMismatch: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), true);
assert.equal(mediaLogs.filter((entry) => String(entry[0]) === '[Notice: falling back to eng video — frame rate differs]').length, 1);
resetGlobal({ durationDrift: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), true);
assert.equal(mediaLogs.filter((entry) => String(entry[0]) === '[Notice: falling back to eng video — timing drift 2.00s]').length, 1);
resetGlobal({ mismatch: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, q: 1 }), true);
assert(!mediaLogs.some((entry) => String(entry[0]).includes('[Notice: falling back')));
resetGlobal({ legacyMissing: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), true);
assert(!mediaLogs.some((entry) => String(entry[0]).includes('[Notice: falling back')));
resetGlobal({ mismatch: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, forcevideo: true }), true);
assert(downloads[0].m3u8json.segments[0].uri.includes('/JA/1/'));
assert.equal(mediaLogs.filter((entry) => String(entry[0]).includes('Forced video timing')).length, 1);
assert(!mediaLogs.some((entry) => String(entry[0]).includes('[Notice: falling back')));
resetGlobal({ mismatch: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, noaudio: true }), true);
assert.equal(downloads.length, 1);
assert.equal(licenseCalls.length, 1);
assert(downloads[0].m3u8json.segments[0].uri.includes('/JA/1/'));
assert(!mediaLogs.some((entry) => String(entry[0]).includes('[Notice: falling back')));
resetGlobal({ lateMismatch: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions }), false);
assert.equal(downloads.length, 1);
assert.equal(licenseCalls.length, 1);
assert.equal(muxCalls.length, 0);
assert.equal(archiveWrites.length, 0);
resetGlobal({ lateMismatch: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, forcevideo: true }), true);
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
	['multi', { forcevideo: true }]
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

resetGlobal();
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, novids: true, dryRun: true }), true);
assert(!mediaLogs.some((entry) => String(entry[0]).includes('[Notice: falling back')));
assert.equal(tokenCounter, 1);
resetGlobal();
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, keepAllVideos: true, dryRun: true }), true);
assert(!mediaLogs.some((entry) => String(entry[0]).includes('[Notice: falling back')));
assert.equal(tokenCounter, 1);
resetGlobal({ hls: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, dryRun: true }), true);
assert.equal(mediaLogs.filter((entry) => String(entry[0]) === '[Notice: falling back to eng video — unsupported manifest]').length, 1);
assert.equal(tokenCounter, 2);
assert.equal(mediaRequests.filter((request) => request.method === 'DELETE').length, 2);
assert.equal(downloads.length, 0);
resetGlobal({ hls: true });
const noLangData = { ...mediaData, data: [{ ...mediaData.data[0], lang: undefined }] };
assert.equal(await service.downloadEpisode(noLangData, { ...mediaOptions, dryRun: true }), true);
assert.equal(mediaLogs.filter((entry) => String(entry[0]) === '[Notice: falling back to eng video — unsupported manifest]').length, 1);
resetGlobal({ hard: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, hslang: 'en', dryRun: true }), true);
assert(!mediaLogs.some((entry) => String(entry[0]).includes('[Notice: falling back')));
assert.equal(tokenCounter, 1);
resetGlobal();
const noVersionData = { ...mediaData, data: [{ ...mediaData.data[0], versions: null }] };
assert.equal(await service.downloadEpisode(noVersionData, { ...mediaOptions, dryRun: true }), true);
assert.equal(tokenCounter, 1);
resetGlobal({ sharedAudio: true });
assert.equal(await service.downloadEpisode(mediaData, { ...mediaOptions, astream: 'chrome' }), true);
assert.equal(mediaRequests.filter((request) => request.method === 'DELETE').length, 4);
assert.equal(licenseCalls[1].headers['x-cr-video-token'], 'token-EN-4');
const multiDubData = { ...mediaData, data: [...mediaData.data, { ...mediaData.data[0], mediaId: 'JA', lang: languageItems[1] }] };
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
for (const bypass of [{ forcevideo: true }, { noaudio: true }]) {
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
output.log('Crunchy global two-pass consumer contract passed');
