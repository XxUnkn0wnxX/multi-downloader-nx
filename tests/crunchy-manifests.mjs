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

const { AbortController } = globalThis;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const logs = [];
const log = {
	info() {},
	warn(...args) {
		logs.push(args);
	},
	debug(...args) {
		logs.push(args);
	}
};
function compile(file, deps, overrides = {}) {
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
const lang = { findLang: () => ({ code: 'en' }), languages: [] };
const mpd = compile('modules/module.transform-mpd.ts', { './module.langsData': lang, './log': { console: log }, './module.fetch': { Req: class {} } });
const catalogModule = compile('modules/module.crunchy-video-catalog.ts', {});
const helper = compile('modules/module.crunchy-manifests.ts', {
	'./module.transform-mpd': mpd,
	'./log': { console: log },
	'./module.langsData': lang,
	'./module.crunchy-video-catalog': catalogModule
});
const manifest = (id, bandwidth = 8000000) =>
	`<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:cenc="urn:mpeg:cenc:2013" type="static" mediaPresentationDuration="PT4S" minBufferTime="PT1S"><BaseURL>https://cdn.example.test/${id}/</BaseURL><Period><AdaptationSet mimeType="video/mp4"><ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"><cenc:pssh>${Buffer.from(`fake-${id}`).toString('base64')}</cenc:pssh></ContentProtection><Representation id="v" bandwidth="${bandwidth}" width="1920" height="1080"><SegmentTemplate timescale="1" duration="2" initialization="init.mp4" media="seg-$Number$.m4s" startNumber="1"/></Representation></AdaptationSet></Period></MPD>`;
const defaultManifest = manifest('default').replace(
	'</Period>',
	'<AdaptationSet mimeType="audio/mp4" lang="en"><Representation id="a" bandwidth="128000"><SegmentTemplate timescale="1" duration="2" initialization="audio-init.mp4" media="audio-$Number$.m4s" startNumber="1"/></Representation></AdaptationSet></Period>'
);
const defaultParsed = await mpd.parse(defaultManifest);
const fakePssh = Buffer.from('fake-default').toString('base64');
assert.equal(defaultParsed['cdn.example.test'].video[0].pssh_wvd, fakePssh);
assert.equal(defaultParsed['cdn.example.test'].audio[0].pssh_wvd, fakePssh);
const selectedVideo = await mpd.parse(defaultManifest, undefined, undefined, { selection: { kind: 'video', period: 1, adaptation: 1, representation: 1 } });
assert.equal(selectedVideo['cdn.example.test'].video.length, 1);
assert.equal(selectedVideo['cdn.example.test'].audio.length, 0);
const relativeManifest = defaultManifest.replace('https://cdn.example.test/default/', 'video/');
const selectedRelative = await mpd.parse(relativeManifest, undefined, undefined, {
	selection: { kind: 'video', period: 1, adaptation: 1, representation: 1, baseUrlOrdinals: [1, 0, 0, 0], manifestUrl: 'https://example.test/episode/manifest.mpd?sig=source' }
});
assert.equal(selectedRelative['example.test'].video[0].segments[0].map.uri, 'https://example.test/episode/video/init.mp4');

const selectedAudio = await mpd.parse(defaultManifest, undefined, undefined, { selection: { kind: 'audio' } });
assert.equal(selectedAudio['cdn.example.test'].audio.length, 1);
assert.equal(selectedAudio['cdn.example.test'].video.length, 0);
const multiAudioManifest = defaultManifest
	.replace(
		'</Representation></AdaptationSet></Period>',
		'</Representation><Representation id="a-high" bandwidth="192000"><SegmentTemplate timescale="1" duration="2" initialization="high-init.mp4" media="high-$Number$.m4s"/></Representation></AdaptationSet></Period>'
	)
	.replace(
		'</Period>',
		'<AdaptationSet mimeType="audio/mp4" lang="ja"><Representation id="other" bandwidth="256000"><SegmentTemplate timescale="1" duration="2" initialization="other-init.mp4" media="other-$Number$.m4s"/></Representation></AdaptationSet></Period>'
	);
const requestedAudio = await mpd.parse(multiAudioManifest, undefined, undefined, { selection: { kind: 'audio', language: 'en' } });
assert.equal(requestedAudio['cdn.example.test'].audio.length, 1);
assert.equal(requestedAudio['cdn.example.test'].audio[0].bandwidth, 192000);
assert.match(requestedAudio['cdn.example.test'].audio[0].segments[0].map.uri, /high-init\.mp4$/);

const heads = [];
let headResult = { ok: true, res: { headers: { get: () => '150' } } };
const mpdWithHeads = compile('modules/module.transform-mpd.ts', {
	'./module.langsData': lang,
	'./log': { console: log },
	'./module.fetch': {
		Req: class {
			async getData(target, options) {
				heads.push([target, options.method]);
				return headResult;
			}
		}
	}
});
const twoBases = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT4S"><BaseURL>http://[broken</BaseURL><BaseURL>https://cdn.example.test/chosen/</BaseURL><Period><AdaptationSet mimeType="video/mp4"><Representation id="other" bandwidth="1000000" width="1280" height="720"><BaseURL>other.mp4</BaseURL><SegmentBase indexRange="100-120"><Initialization range="0-99"/></SegmentBase></Representation><Representation id="selected" bandwidth="8000000" width="1920" height="1080"><BaseURL>selected.mp4?sig=good</BaseURL><SegmentBase indexRange="100-120"><Initialization range="0-99"/></SegmentBase></Representation></AdaptationSet></Period></MPD>`;
const selection = { kind: 'video', period: 1, adaptation: 1, representation: 2, baseUrlOrdinals: [2, 0, 0, 1] };
const selectedBase = await mpdWithHeads.parse(twoBases, undefined, undefined, { selection });
assert.equal(heads.length, 1);
assert.deepEqual(heads[0], ['https://cdn.example.test/chosen/selected.mp4?sig=good', 'head']);
assert.equal(selectedBase['cdn.example.test'].video.length, 1);
heads.length = 0;
await assert.rejects(mpdWithHeads.parse(twoBases, undefined, undefined, { selection: { ...selection, baseUrlOrdinals: [3, 0, 0, 1] } }), /BaseURL locator/);
assert.equal(heads.length, 0);
await assert.rejects(mpdWithHeads.parse(twoBases.replace('</MPD>', '<Period/></MPD>'), undefined, undefined, { selection }), /single static Period/);
await assert.rejects(mpdWithHeads.parse(twoBases.replace('type="static"', 'type="dynamic"'), undefined, undefined, { selection }), /single static Period/);
await assert.rejects(mpdWithHeads.parse(twoBases.replace('type="static"', 'type=""'), undefined, undefined, { selection: { kind: 'audio' } }), /single static Period/);
assert.equal(heads.length, 0);
const twoTemplates = twoBases.replace(
	'<BaseURL>selected.mp4?sig=good</BaseURL><SegmentBase indexRange="100-120"><Initialization range="0-99"/></SegmentBase>',
	'<BaseURL>selected/</BaseURL><SegmentTemplate timescale="1" duration="2" initialization="init.mp4?sig=good" media="seg-$Number$.m4s?sig=good"/>'
);
const selectedTemplate = await mpdWithHeads.parse(twoTemplates, undefined, undefined, { selection });
assert.equal(heads.length, 0);
assert.equal(selectedTemplate['cdn.example.test'].video[0].segments[0].map.uri, 'https://cdn.example.test/chosen/selected/init.mp4?sig=good');
assert.equal(selectedTemplate['cdn.example.test'].video[0].segments[0].uri, 'https://cdn.example.test/chosen/selected/seg-1.m4s?sig=good');
const audioBase = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT4S"><BaseURL>https://first.example.test/a/</BaseURL><BaseURL>https://second.example.test/a/</BaseURL><Period><AdaptationSet mimeType="audio/mp4" lang="en-US"><Representation id="low" bandwidth="128000"><BaseURL>low.mp4</BaseURL><SegmentBase indexRange="100-120"><Initialization range="0-99"/></SegmentBase></Representation><Representation id="high" bandwidth="192000"><BaseURL>high.mp4?sig=audio</BaseURL><SegmentBase indexRange="100-120"><Initialization range="0-99"/></SegmentBase></Representation></AdaptationSet></Period></MPD>`;
const audioSelected = await mpdWithHeads.parse(audioBase, undefined, undefined, {
	selection: { kind: 'audio', language: 'en-US', serverOrdinal: 2, manifestUrl: 'https://example.test/audio.mpd' }
});
assert.equal(heads.length, 1);
assert.deepEqual(heads[0], ['https://second.example.test/a/high.mp4?sig=audio', 'head']);
assert.equal(audioSelected['second.example.test'].audio[0].bandwidth, 192000);
heads.length = 0;
for (const [ok, length] of [
	[false, '150'],
	[true, '0'],
	[true, '-1'],
	[true, '9007199254740992'],
	[true, '150junk'],
	[true, '']
]) {
	headResult = { ok, res: { status: ok ? 200 : 403, headers: { get: () => length } } };
	await assert.rejects(mpdWithHeads.parse(twoBases, undefined, undefined, { selection }), /Selected SIDX HEAD/);
	await assert.rejects(
		mpdWithHeads.parse(audioBase, undefined, undefined, { selection: { kind: 'audio', language: 'en-US', serverOrdinal: 2, manifestUrl: 'https://example.test/audio.mpd' } }),
		/Selected SIDX HEAD/
	);
}
headResult = { ok: false, res: { status: 403, headers: { get: () => '150' } } };
const legacyHeadManifest = twoBases
	.replace('<BaseURL>http://[broken</BaseURL>', '')
	.replace(
		'</Period>',
		'<AdaptationSet mimeType="audio/mp4" lang="en"><Representation id="audio" bandwidth="128000"><SegmentTemplate timescale="1" duration="2" initialization="audio-init.mp4" media="audio-$Number$.m4s"/></Representation></AdaptationSet></Period>'
	);
const defaultHeadParsed = await mpdWithHeads.parse(legacyHeadManifest);
assert(
	defaultHeadParsed['cdn.example.test'].video.some((track) => track.segments.length > 0),
	'default parser retains its legacy HEAD handling'
);
logs.length = 0;
heads.length = 0;
headResult = { ok: true, res: { headers: { get: () => '150' } } };

const url = 'https://example.test/static/majin/7/clean/cenc/dash/movie.mpd?x=%2f&x=+&sig=a%3Db';
assert.deepEqual(
	[...helper.legacyUrls(url)],
	['https://example.test/static/7/0/clean/dash/movie.mpd?x=%2f&x=+&sig=a%3Db', 'https://example.test/static/7/1/clean/dash/movie.mpd?x=%2f&x=+&sig=a%3Db']
);
const realShape = 'https://example.test/v2/manifest/GE00384054ENUS/static/majin/e00384054a00384700enus/clean/cenc/dash/manifest.mpd?x=%2f&x=+&sig=a%3Db';
assert.deepEqual(
	[...helper.legacyUrls(realShape)],
	[
		'https://example.test/v2/manifest/GE00384054ENUS/static/e00384054a00384700enus/0/clean/dash/manifest.mpd?x=%2f&x=+&sig=a%3Db',
		'https://example.test/v2/manifest/GE00384054ENUS/static/e00384054a00384700enus/1/clean/dash/manifest.mpd?x=%2f&x=+&sig=a%3Db'
	]
);
assert.deepEqual(
	[...helper.legacyUrls('https://example.test/v2/static/123456/0/clean/dash/manifest.mpd?sig=%2B')],
	['https://example.test/v2/static/123456/1/clean/dash/manifest.mpd?sig=%2B']
);
assert.deepEqual([...helper.legacyUrls('https://example.test/hardsub/en/movie.mpd?clean/dash/')], []);
const current = await mpd.parse(manifest('current'), undefined, undefined, { videoOnly: true });
const calls = [];
const req = {
	async getData(candidate, options) {
		calls.push([candidate, options]);
		return { ok: true, res: { status: 200, text: async () => manifest(candidate.includes('/0/') ? 'zero' : 'one', 9000000) } };
	}
};
const extra = await helper.optionalManifests(req, url, {}, { code: 'en' }, false);
assert.equal(calls.length, 2);
assert(calls.every(([, options]) => options.quietErrors && options.signal));
const qualities = helper.videoQualities(current, extra, 1);
assert.equal(qualities.length, 3);
assert.equal(qualities[2].family, 'Legacy 0');
assert.equal(qualities[2].pssh_wvd, Buffer.from('fake-zero').toString('base64'));
assert.equal(qualities[2].segments.length, 2);
assert.match(qualities[2].segments[0].map.uri, /zero\/init\.mp4$/);
assert.match(qualities[2].resolutionText, /9000 kb\/s/);
assert.match(helper.videoQualities(current, extra, 1, false, 'jpn')[2].resolutionText, /\[Legacy M\] \[V:jpn\]$/);
assert.match(helper.videoQualities(current, [], 1, false, 'eng')[0].resolutionText, /\[Current M\] \[V:eng\]$/);
const same = await mpd.parse(manifest('zero', 9000000), undefined, undefined, { videoOnly: true });
assert.equal(
	helper.videoQualities(
		current,
		[
			{ family: 'Legacy 0', playlists: same },
			{ family: 'Legacy 1', playlists: same }
		],
		5
	).length,
	2
);
for (const response of [
	{ ok: false, res: { status: 404 } },
	{ ok: false, res: { status: 403 } },
	{ ok: true, res: { status: 200, text: async () => '<MPD><bad></MPD>' } },
	{ ok: true, res: { status: 200, text: async () => '<MPD />' } }
]) {
	assert.equal((await helper.optionalManifests({ getData: async () => response }, url, {}, { code: 'en' }, false)).length, 0);
}
assert.equal(logs.length, 0);
await helper.optionalManifests({ getData: async () => ({ ok: false, res: { status: 403 } }) }, url, {}, { code: 'en' }, true);
assert(logs.some((args) => String(args[0]).includes('403')));
const sidx = `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT4S"><BaseURL>https://cdn.example.test/</BaseURL><Period><AdaptationSet mimeType="video/mp4"><Representation id="v" bandwidth="8000000" width="1920" height="1080"><BaseURL>video.mp4</BaseURL><SegmentBase indexRange="100-200"><Initialization range="0-99"/></SegmentBase></Representation></AdaptationSet></Period></MPD>`;
assert.equal((await helper.optionalManifests({ getData: async () => ({ ok: true, res: { status: 200, text: async () => sidx } }) }, url, {}, { code: 'en' }, false)).length, 0);

const timedHelper = compile(
	'modules/module.crunchy-manifests.ts',
	{ './module.transform-mpd': mpd, './log': { console: log }, './module.langsData': lang, './module.crunchy-video-catalog': catalogModule },
	{ setTimeout: (fn) => setTimeout(fn, 0) }
);
const timedSignals = [];
const expired = await timedHelper.optionalManifests(
	{
		getData: async (_, options) => {
			timedSignals.push(options.signal);
			return { ok: true, res: { status: 200, text: () => new Promise(() => {}) } };
		}
	},
	url,
	{},
	{ code: 'en' },
	false
);
assert.equal(expired.length, 0);
assert.equal(timedSignals.length, 2);
assert(timedSignals.every((signal) => signal.aborted));

const originalTrack = current['cdn.example.test'].video[0];
const makeFamily = (name, count, baseBandwidth, server) => ({
	[server]: {
		audio: [],
		video: Array.from({ length: count }, (_, i) => ({
			...originalTrack,
			bandwidth: baseBandwidth + i * 1000,
			quality: { width: 640 + i * 320, height: 360 + i * 180 },
			segments: originalTrack.segments.map((segment) => ({ ...segment, uri: `https://${server}/${name}/${i}/${segment.number}` })),
			pssh_wvd: `${name}-${i}`
		}))
	}
});
const fourteen = helper.videoQualities(
	makeFamily('current', 4, 1000000, 'current.example.test'),
	[
		{ family: 'Legacy 0', playlists: makeFamily('legacy0', 5, 2000000, 'zero.example.test') },
		{ family: 'Legacy 1', playlists: makeFamily('legacy1', 5, 3000000, 'one.example.test') }
	],
	2
);
assert.equal(fourteen.length, 14);
assert.equal(fourteen[13].family, 'Legacy 1');
assert.equal(fourteen[11].family, 'Legacy 1');
assert.equal(fourteen[13].server, 'one.example.test');
assert.equal(fourteen[13].pssh_wvd, 'legacy1-4');
assert.match(fourteen[13].segments[0].uri, /legacy1\/4/);

const invalidTracks = [
	{ ...originalTrack, quality: { width: 0, height: 1080 } },
	{ ...originalTrack, quality: { width: 1920, height: -1 } },
	{ ...originalTrack, quality: { width: NaN, height: 1080 } },
	{ ...originalTrack, bandwidth: 0 },
	{ ...originalTrack, bandwidth: Infinity }
];
const invalidMap = { 'invalid.example.test': { audio: [], video: invalidTracks } };
logs.length = 0;
assert.equal(helper.videoQualities(current, [{ family: 'Legacy 0', playlists: invalidMap }], 1).length, 1);
assert.equal(logs.length, 0);
assert.equal(helper.videoQualities(current, [{ family: 'Legacy 0', playlists: invalidMap }], 1, true).length, 1);
assert.equal(logs.filter((entry) => String(entry[0]).includes('invalid video metadata')).length, invalidTracks.length);

const selectedLogs = [];
const sideEffects = [];
let optionalCalls = 0;
let optionalDebug = false;
const optionalUrls = [];
const keyInputs = [];
const downloaderInputs = [];
let parseError = false;
let currentAudioId = '';
const fullLang = { code: 'eng', name: 'English', locale: 'en', language: 'English' };
const currentMap = makeFamily('current', 4, 1000000, 'current.example.test');
const originalAudio = {
	bandwidth: 128000,
	language: fullLang,
	default: true,
	pssh_wvd: 'original-audio',
	segments: [{ uri: 'https://audio.example.test/media?x=1', map: { uri: 'https://audio.example.test/init?x=1' }, duration: 2, timeline: 0 }]
};
function dubFamily(family, bandwidth, server, sourceUrl) {
	const id = /\/manifest\/(ID\d+)\//.exec(sourceUrl)?.[1] || 'unknown';
	const playlists = makeFamily(family, 5, bandwidth, server);
	for (const video of playlists[server].video) {
		video.segments = video.segments.map((segment) => ({ ...segment, uri: `${segment.uri}?dub=${id}` }));
	}
	return playlists;
}
const audioMap = { 'audio.example.test': { video: [], audio: [originalAudio] } };
currentMap['current.example.test'].audio = [originalAudio];
const deps = {
	'./package.json': {},
	'./modules/module.crunchy-video-catalog': catalogModule,
	'./modules/module.crunchy-video-selection': { discoverVideoCandidates: async () => ({ status: 'fallback' }) },
	fs: {
		existsSync: () => true,
		mkdirSync: () => {
			throw Error('unexpected file creation');
		}
	},
	'./modules/module.fontsData': { root: 'https://fonts.example.test/', fontFamilies: { a: ['one.ttf', 'two.ttf'] } },
	'./modules/log': {
		console: { info: (...a) => selectedLogs.push(a), warn: (...a) => selectedLogs.push(a), error: (...a) => selectedLogs.push(a), debug: (...a) => selectedLogs.push(a) }
	},
	'./modules/module.langsData': {
		languages: [fullLang],
		findLang: () => fullLang,
		fixLanguageTag: (v) => v,
		sortTags: (v) => v,
		fixAndFindCrLC: () => fullLang,
		locale2language: () => fullLang
	},
	'./modules/module.transform-mpd': {
		parse: async (body) => {
			if (parseError) throw Error('parse failed');
			return body === 'VIDEO MPD'
				? currentMap
				: {
						'audio.example.test': {
							...audioMap['audio.example.test'],
							audio: [{ ...originalAudio, segments: originalAudio.segments.map((segment) => ({ ...segment, uri: `${segment.uri}&id=${currentAudioId}` })) }]
						}
					};
		}
	},
	'm3u8-parser': require('m3u8-parser'),
	'./modules/module.crunchy-manifests': {
		...helper,
		legacyUrls: helper.legacyUrls,
		optionalManifests: async (_req, _url, _headers, _lang, debug) => (
			optionalUrls.push(_url),
			optionalCalls++,
			(optionalDebug = debug),
			[
				{ family: 'Legacy 0', playlists: dubFamily('legacy0', 2000000, 'zero.example.test', _url) },
				{ family: 'Legacy 1', playlists: dubFamily('legacy1', 3000000, 'one.example.test', _url) }
			]
		)
	},
	'./modules/module.cfg-loader': {
		loadBinCfg: async () => {
			sideEffects.push('loadBin');
			return {};
		}
	},
	'./modules/module.api-urls': { api: { crunchyDefHeader: {}, streaming_sessions: 'https://example.test/sessions' }, domain: {} },
	'./@types/enums': { CrunchyVideoPlayStreams: { androidtv: 'video' }, CrunchyAudioPlayStreams: { web: 'audio' } },
	'./modules/cdm': {
		canDecrypt: false,
		cdm: 'widevine',
		getKeysWVD: async (pssh) => {
			keyInputs.push(pssh);
			return [{ kid: 'fake', key: 'fake' }];
		}
	},
	'./modules/hls-download': {
		default: class {
			constructor(options) {
				sideEffects.push('downloader');
				downloaderInputs.push(options);
			}
			async download() {
				throw Error('intentional downloader stop');
			}
		},
		__esModule: true
	},
	'./modules/module.downloadArchive': { downloaded: () => sideEffects.push('archive') },
	'./modules/module.filename': { default: () => ['test'], __esModule: true },
	'./modules/module.helper': { default: {}, __esModule: true }
};
const other = new Set([
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
const { default: Crunchy } = compile('crunchy.ts', new Proxy(deps, { get: (target, key) => (key in target ? target[key] : other.has(key) ? {} : undefined) }));
async function preview(q, sameToken = false, failAudio = false, count = 1, extraOptions = {}) {
	selectedLogs.length = 0;
	sideEffects.length = 0;
	optionalCalls = 0;
	optionalUrls.length = 0;
	keyInputs.length = 0;
	downloaderInputs.length = 0;
	deps['./modules/cdm'].canDecrypt = !!extraOptions.testNormal;
	optionalDebug = false;
	parseError = !!extraOptions.testParseFailure;
	let videoUrl = extraOptions.testHls ? 'https://example.test/video.m3u8' : url;
	const audioUrl = extraOptions.testHls ? 'https://audio.example.test/audio.m3u8' : 'https://audio.example.test/audio.mpd';
	const requests = [];
	const service = Object.create(Crunchy.prototype);
	service.cfg = { bin: extraOptions.testNormal ? { ffmpeg: 'fake', mp4decrypt: 'fake' } : {}, dir: { content: '/unused' } };
	service.token = { access_token: 'test' };
	service.cmsToken = { cms: {} };
	service.debug = !extraOptions.testGuiDebug;
	service.deviceHeaders = () => ({});
	service.refreshToken = async () => true;
	service.muxStreams = async () => sideEffects.push('mux');
	service.req = {
		argv: { debug: !!extraOptions.testGuiDebug },
		async getData(target, opts = {}) {
			requests.push([target, opts.method]);
			if (opts.method === 'DELETE' || opts.method === 'PATCH') return { ok: true };
			if (target.includes('/v3/') && target.includes('/video/')) {
				if (!extraOptions.testHls) videoUrl = url.replace('/static/', `/v2/manifest/${target.match(/\/v3\/(ID\d+)\//)?.[1]}/static/`);
				return {
					ok: true,
					res: {
						json: async () => ({
							url: videoUrl,
							token: 'video-token',
							hardSubs: extraOptions.hslang === 'en' ? { en: { url: videoUrl, hlang: 'en' } } : {},
							audioLocale: 'en',
							subtitles: {},
							captions: {}
						})
					}
				};
			}
			if (target.includes('/v3/') && target.includes('/audio/')) {
				currentAudioId = target.match(/\/v3\/(ID\d+)\//)?.[1] ?? '';
				return failAudio
					? { ok: false }
					: {
							ok: true,
							res: {
								json: async () => ({
									url: audioUrl,
									token: sameToken ? 'video-token' : 'audio-token',
									hardSubs: {},
									audioLocale: 'en',
									subtitles: {},
									captions: {}
								})
							}
						};
			}
			if (target === videoUrl)
				return {
					ok: true,
					res: {
						text: async () =>
							extraOptions.testHls ? '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720\nhttps://cdn.example.test/chunk.m3u8?sig=123\n' : 'VIDEO MPD'
					}
				};
			if (target === audioUrl) return { ok: true, res: { text: async () => (extraOptions.testHls ? '#EXTM3U' : 'AUDIO MPD') } };
			throw Error(`Unexpected request ${target}`);
		}
	};
	const data = { episodeNumber: '1', episodeTitle: 'Episode', seasonTitle: 'Season', data: Array.from({ length: count }, (_, i) => ({ mediaId: `ID${i}`, playback: true })) };
	const options = {
		dryRun: true,
		vstream: 'androidtv',
		astream: 'web',
		cstream: false,
		dubLang: [],
		chapters: false,
		q,
		x: 2,
		hslang: 'none',
		novids: false,
		noaudio: false,
		tsd: true,
		dlsubs: ['all'],
		...extraOptions
	};
	let result;
	let error;
	try {
		result = await service.downloadEpisode(data, options);
	} catch (caught) {
		error = caught;
	}
	return {
		result,
		error,
		requests,
		logs: [...selectedLogs],
		effects: [...sideEffects],
		optionalCalls,
		optionalDebug,
		optionalUrls: [...optionalUrls],
		keyInputs: [...keyInputs],
		downloaderInputs: [...downloaderInputs]
	};
}
const high = await preview(0, false, false, 2);
assert.equal(high.result, true);
assert.equal(high.requests.filter(([, method]) => method === 'DELETE').length, 4);
assert.equal(high.effects.length, 0);
assert(high.logs.some((entry) => entry.join(' ').includes('one.example.test/legacy1/4')));
assert(high.logs.some((entry) => entry.join(' ').includes('audio.example.test/media?x=1')));
assert(!high.requests.some(([target]) => target.includes('/sessions')));
assert.equal(high.optionalUrls.length, 2);
assert(high.optionalUrls[0].includes('/v2/manifest/ID0/'));
assert(high.optionalUrls[1].includes('/v2/manifest/ID1/'));
assert(high.logs.some((entry) => entry[0] === 'Video first media segment URL:' && entry[1].includes('dub=ID0')));
assert(high.logs.some((entry) => entry[0] === 'Video first media segment URL:' && entry[1].includes('dub=ID1')));
const explicit = await preview(12, true);
assert.equal(explicit.result, true);
assert.equal(explicit.requests.filter(([, method]) => method === 'DELETE').length, 1);
assert(explicit.logs.some((entry) => entry.join(' ').includes('one.example.test/legacy1/3')));
const failure = await preview(0, false, true);
assert.equal(failure.result, false);
assert.equal(failure.requests.filter(([, method]) => method === 'DELETE').length, 1);
assert.equal(failure.effects.length, 0);

const once = await preview(0, false, false, 2, { dlVideoOnce: true });
assert.equal(once.result, true);
assert.equal(once.optionalCalls, 1);
assert(once.optionalUrls[0].includes('/v2/manifest/ID0/'));
assert.deepEqual(
	once.logs.filter((entry) => entry[0] === 'Audio first media segment URL:').map((entry) => entry[1]),
	['https://audio.example.test/media?x=1&id=ID0', 'https://audio.example.test/media?x=1&id=ID1']
);
assert(once.logs.some((entry) => entry.join(' ').includes('128 kb/s')));
const guiDebug = await preview(0, false, false, 1, { testGuiDebug: true });
assert.equal(guiDebug.result, true);
assert.equal(guiDebug.optionalDebug, true);
const noVideo = await preview(0, false, false, 1, { novids: true });
assert.equal(noVideo.result, true);
assert.equal(noVideo.optionalCalls, 0);
const subtitleOnly = await preview(0, false, false, 1, { novids: true, noaudio: true });
assert.equal(subtitleOnly.result, true);
assert.equal(subtitleOnly.optionalCalls, 0);
assert.equal(subtitleOnly.effects.length, 0);
const hard = await preview(0, false, false, 1, { hslang: 'en' });
assert.equal(hard.result, true);
assert.equal(hard.optionalCalls, 0);
const serviceControl = Object.create(Crunchy.prototype);
serviceControl.downloadMediaList = async () => ({ error: false, data: [], fileName: 'unused' });
serviceControl.muxStreams = async () => sideEffects.push('mux');
sideEffects.length = 0;
assert.equal(await serviceControl.downloadEpisode({ e: '1', seasonID: 'test' }, { skipmux: false }), true);
assert.deepEqual(sideEffects, ['mux', 'archive']);
selectedLogs.length = 0;
await serviceControl.getFonts(true);
assert.equal(selectedLogs.filter((entry) => entry[0] === 'Font URL:').length, 2);

const malformed = await preview(0, false, false, 1, { testParseFailure: true });
assert.match(String(malformed.error), /parse failed/);
assert.equal(malformed.requests.filter(([, method]) => method === 'DELETE').length, 2);
const hls = await preview(0, false, false, 1, { testHls: true });
if (hls.error) throw hls.error;
assert.equal(hls.result, true);
assert(hls.logs.some((entry) => entry.join(' ').includes('720p\n        [1] 1280x720 (1000 kb/s) [Current M] [V:eng]')));
assert(hls.logs.some((entry) => entry.join(' ').includes('[1] 1280x720 (1000 kb/s) [Current M] [V:eng] <-- Selected')));
assert(hls.logs.some((entry) => entry.join(' ').includes('Selected quality: 1280x720 [Current M] [V:eng]')));
assert(!hls.logs.some((entry) => entry.join(' ').includes('KiB/s')));
assert(hls.logs.some((entry) => entry.join(' ').includes('https://cdn.example.test/chunk.m3u8?sig=123')));
assert(!hls.requests.some(([target]) => target.includes('chunk.m3u8')));
assert.equal(hls.requests.filter(([, method]) => method === 'DELETE').length, 2);

const fractionalHls = await preview(0.5, false, false, 1, { testHls: true });
assert.equal(fractionalHls.error, undefined, 'a fractional HLS quality keeps the existing unavailable-quality path without a display exception');
assert(!fractionalHls.logs.some((entry) => entry.join(' ').includes('<-- Selected')));

const normal = await preview(0, false, false, 1, { testNormal: true, dryRun: false, tsd: false, partsize: 4 });
assert.match(String(normal.error), /intentional downloader stop/);
assert(normal.logs.some((entry) => entry.join(' ').includes('<-- Selected')));
assert.deepEqual(normal.keyInputs, ['legacy1-4', 'original-audio']);
assert.equal(normal.downloaderInputs.length, 1);
const expectedLegacy = dubFamily('legacy1', 3000000, 'one.example.test', normal.optionalUrls[0])['one.example.test'].video[4];
assert.deepEqual(JSON.parse(JSON.stringify(normal.downloaderInputs[0].m3u8json.segments)), JSON.parse(JSON.stringify(expectedLegacy.segments)));
assert.equal(normal.downloaderInputs[0].m3u8json.segments[0].map.uri, expectedLegacy.segments[0].map.uri);
assert(!normal.effects.includes('mux') && !normal.effects.includes('archive'));

output.log('Crunchy manifest and preview contracts passed');
