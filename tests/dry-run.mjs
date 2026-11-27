import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import output from 'node:console';
import process from 'node:process';
import vm from 'node:vm';
import { fileURLToPath, URL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anidl-dry-run-'));
const logs = [];
const fakeConsole = Object.fromEntries(['info', 'warn', 'error', 'debug'].map((method) => [method, (...args) => logs.push([method, args.map(String).join(' ')])]));
const jsonResponse = (value) => ({ ok: true, res: { json: async () => value, text: async () => JSON.stringify(value) } });
const textResponse = (value) => ({ ok: true, res: { text: async () => value, json: async () => JSON.parse(value) } });
const languages = [
	{ code: 'fra', name: 'French', locale: 'fr', new_hd_locale: 'fr-FR' },
	{ code: 'deu', name: 'German', locale: 'de', new_hd_locale: 'de-DE' },
	{ code: 'pol', name: 'Polish', locale: 'pl', new_hd_locale: 'pl-PL' }
];
const effects = { bin: 0, cdm: 0, download: 0, mux: 0, archive: 0, path: 0, files: 0 };
const sideEffect =
	(name) =>
	(...args) => {
		effects[name]++;
		throw new Error(`unexpected ${name} side effect: ${args.map(String).join(' ')}`);
	};

function compile(file, requireFn, extra = {}) {
	const source = fs.readFileSync(file, 'utf8');
	const code = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
	}).outputText;
	const exports = {};
	const module = { exports };
	vm.runInNewContext(code, { exports, module, require: requireFn, process, console: output, Buffer, URL, setTimeout, clearTimeout, ...extra }, { filename: file });
	return module.exports;
}

const forkDisplay = compile(path.join(root, 'modules/module.fork-display.ts'), () => {
	throw new Error('Unexpected fork display helper dependency');
});

function fakeFs() {
	return {
		existsSync: () => false,
		mkdirSync: sideEffect('files'),
		writeFileSync: sideEffect('files'),
		copyFileSync: sideEffect('files'),
		unlinkSync: sideEffect('files'),
		renameSync: sideEffect('files')
	};
}

function loadHidive(mpd = hidiveManifest, canDecrypt = false, cliArgv = {}, archive = sideEffect('archive')) {
	const stubs = {
		'./package.json': { version: 'test' },
		'./modules/module.fork-display': forkDisplay,
		'./modules/log': { console: fakeConsole },
		'./modules/hls-download': {
			default: class {
				download = sideEffect('download');
			},
			__esModule: true
		},
		'./modules/module.fontsData': { assFonts: () => [] },
		'./modules/module.langsData': { languages, dubLanguageCodes: ['fra', 'deu', 'pol'], fixAndFindCrLC: (a) => a, fixLanguageTag: (a) => a },
		'./modules/module.cfg-loader': {
			loadCfg: () => ({ cli: {}, bin: {}, dir: { content: tmp } }),
			loadNewHDToken: () => ({ authorisationToken: 'auth', refreshToken: 'refresh' }),
			loadBinCfg: async () => sideEffect('bin')()
		},
		'./modules/module.app-args': { appArgv: () => cliArgv },
		'./modules/module.merger': {
			default: class {
				constructor() {
					sideEffect('mux')();
				}
			},
			__esModule: true
		},
		'./modules/module.vtt2ass': { default: () => '', __esModule: true },
		'./modules/module.helper': { default: {}, __esModule: true },
		'./modules/module.api-urls': { api: { hd_new_api: 'https://api.hidive.test', hd_new_apiKey: 'k', hd_new_version: 'v' } },
		'./modules/module.fetch': { Req: class {} },
		'./modules/module.filename': { default: () => sideEffect('path')(), __esModule: true },
		'./modules/module.downloadArchive': { downloaded: archive },
		'./modules/module.parseSelect': { default: () => [], __esModule: true },
		'./modules/module.transform-mpd': { parse: async () => mpd },
		'./modules/cdm': { canDecrypt, getKeysWVD: sideEffect('cdm'), getKeysPRD: sideEffect('cdm') },
		path,
		fs: fakeFs()
	};
	const Constructor = compile(path.join(root, 'hidive.ts'), (id) => {
		if (Object.hasOwn(stubs, id)) return stubs[id];
		if (id === 'path' || id === 'fs') return stubs[id];
		throw new Error(`unexpected HIDIVE import ${id}`);
	}).default;
	return new Constructor();
}

function hidiveOptions(overrides = {}) {
	return {
		dryRun: true,
		bypasssync: true, // Crunchyroll-only settings must not affect this provider.
		q: 0,
		x: 1,
		dubLang: ['fra', 'deu'],
		noaudio: false,
		novids: false,
		originalFontSize: false,
		fontSize: 24,
		fileName: '{title}',
		numbers: 1,
		override: [],
		...overrides
	};
}

function selectedHidiveEpisode() {
	return {
		id: 55,
		titleId: 55,
		title: 'Episode title',
		nameLong: 'Episode title',
		seasonTitle: 'Season',
		seriesTitle: 'Series',
		episodeInformation: { episodeNumber: 1, seasonNumber: 1 },
		offlinePlaybackLanguages: ['fra', 'deu'],
		jwtToken: 'jwt'
	};
}

const hidiveManifest = {
	cdn: {
		video: [
			{ bandwidth: 900000, quality: { width: 640, height: 360 }, segments: [{ map: { uri: 'https://video.example/360/init.mp4?token=full-video-360' } }] },
			{ bandwidth: 3200000, quality: { width: 1280, height: 720 }, segments: [{ map: { uri: 'https://video.example/720/init.mp4?token=full-video-720' } }] }
		],
		audio: [
			{ bandwidth: 192000, language: { code: 'fra', name: 'French' }, segments: [{ map: { uri: 'https://audio.example/fra/init.mp4?token=full-audio-fra' } }] },
			{ bandwidth: 128000, language: { code: 'deu', name: 'German' }, segments: [{ map: { uri: 'https://audio.example/deu/init.mp4?token=full-audio-deu' } }] }
		]
	}
};

const adnManifests = {
	masterEmpty: { playlists: [] },
	masterFra: {
		playlists: [
			{ uri: 'https://cdn.example/fra/360.m3u8?cdn=fra', attributes: { RESOLUTION: { width: 640, height: 360 }, BANDWIDTH: 850000, CODECS: 'avc1.640028,mp4a.40.2' } },
			{ uri: 'https://cdn.example/fra/720.m3u8?cdn=fra', attributes: { RESOLUTION: { width: 1280, height: 720 }, BANDWIDTH: 2750000, CODECS: 'avc1.640028,mp4a.40.2' } }
		]
	},
	masterDeu: {
		playlists: [
			{ uri: 'https://cdn.example/deu/360.m3u8?cdn=deu', attributes: { RESOLUTION: { width: 640, height: 360 }, BANDWIDTH: 900000, CODECS: 'avc1.640028,mp4a.40.2' } },
			{ uri: 'https://cdn.example/deu/720.m3u8?cdn=deu', attributes: { RESOLUTION: { width: 1280, height: 720 }, BANDWIDTH: 2800000, CODECS: 'avc1.640028,mp4a.40.2' } }
		]
	}
};

function loadAdn(allowOutputPath = false, archive = sideEffect('archive')) {
	const stubs = {
		'./package.json': { version: 'test' },
		'./modules/module.fork-display': forkDisplay,
		'./modules/log': { console: fakeConsole },
		'./modules/hls-download': {
			default: class {
				download = sideEffect('download');
			},
			__esModule: true
		},
		'./modules/module.fontsData': { assFonts: () => [] },
		'./modules/module.langsData': { languages, dubLanguageCodes: ['fra', 'deu', 'pol'], subsFile: () => 'sub.ass' },
		'./modules/module.cfg-loader': {
			loadCfg: () => ({ cli: {}, bin: {}, dir: { content: tmp } }),
			loadADNToken: () => ({ accessToken: 'saved-access' }),
			loadBinCfg: async () => sideEffect('bin')()
		},
		'./modules/module.app-args': { appArgv: () => ({}) },
		'./modules/module.fetch': { Req: class {} },
		'./modules/module.merger': {
			default: class {
				constructor() {
					sideEffect('mux')();
				}
			},
			__esModule: true
		},
		'./modules/module.parseSelect': { default: () => [], __esModule: true },
		'./modules/module.filename': {
			default: () => {
				effects.path++;
				if (allowOutputPath) return ['normal-output'];
				throw new Error('unexpected output path construction');
			},
			__esModule: true
		},
		'./modules/module.downloadArchive': { downloaded: archive },
		'./modules/module.helper': { default: {}, __esModule: true },
		'm3u8-parser': {
			Parser: class {
				push(body) {
					this.body = body;
				}
				end() {
					this.manifest = adnManifests[this.body];
				}
			}
		},
		crypto: { constants: { RSA_PKCS1_PADDING: 1 }, publicEncrypt: () => Buffer.from('test') },
		path,
		fs: fakeFs()
	};
	const Constructor = compile(path.join(root, 'adn.ts'), (id) => {
		if (Object.hasOwn(stubs, id)) return stubs[id];
		if (id === 'path' || id === 'fs') return stubs[id];
		throw new Error(`unexpected ADN import ${id}`);
	}).default;
	const service = new Constructor();
	service.refreshToken = async () => ({ isOk: true });
	service.sleep = async () => {};
	return service;
}

function adnOptions(overrides = {}) {
	return {
		dryRun: true,
		bypasssync: true, // Crunchyroll-only settings must not affect this provider.
		dubLang: ['fra', 'deu'],
		q: 0,
		x: 1,
		novids: false,
		chapters: true,
		dlsubs: ['all'],
		skipsubs: false,
		fileName: '{title}',
		numbers: 1,
		override: [],
		partsize: 1,
		waittime: 0,
		...overrides
	};
}

function adnVideo() {
	return {
		id: 91,
		shortNumber: 'S1E1',
		title: 'Episode title',
		name: 'Episode title',
		season: '1',
		image: 'https://image.example/episode.jpg',
		show: { title: 'Series', shortTitle: 'Series', countryOfOrigin: 'France' }
	};
}

function adnRequests({ failMaster = false, failSelected = false, emptyMaster = false, emptyStreaming = false } = {}) {
	const calls = [];
	const responses = {
		'https://gw.api.animationdigitalnetwork.com/player/video/91/configuration': jsonResponse({
			player: { options: { user: { hasAccess: true, refreshTokenUrl: 'https://api.example/refresh', refreshToken: 'rt' }, video: { url: 'https://api.example/links' } } }
		}),
		'https://api.example/refresh': jsonResponse({ token: 't', accessToken: 'a', refreshToken: 'r' }),
		'https://api.example/links?freeWithAds=true&adaptive=true&withMetadata=true&source=Web': jsonResponse({
			links: { streaming: emptyStreaming ? {} : { vf: { auto: 'https://api.example/auto/fra' }, vde: { auto: 'https://api.example/auto/deu' } }, subtitles: {} },
			video: {}
		}),
		'https://api.example/auto/fra': jsonResponse({ location: 'https://cdn.example/master/fra' }),
		'https://api.example/auto/deu': jsonResponse({ location: 'https://cdn.example/master/deu' }),
		'https://cdn.example/master/fra': failMaster ? { ok: false } : textResponse(emptyMaster ? 'masterEmpty' : 'masterFra'),
		'https://cdn.example/master/deu': textResponse('masterDeu')
	};
	return {
		calls,
		getData: async (url, options) => {
			calls.push({ url, options });
			if (failSelected && url.includes('/720.m3u8')) return { ok: false };
			return responses[url] ?? { ok: false };
		}
	};
}

try {
	let passed = 0;
	async function test(name, run) {
		logs.length = 0;
		for (const key of Object.keys(effects)) effects[key] = 0;
		await run();
		passed++;
		output.log(`ok ${passed} - ${name}`);
	}

	const hd = loadHidive();
	const playback = { dash: [{ url: 'https://playback.example/manifest/master.mpd?full=1', drm: { jwtToken: 'jwt' }, subtitles: [] }] };
	const episodeData = {
		id: 55,
		title: 'Episode title',
		episodeInformation: { season: 10, seasonNumber: 1, episodeNumber: 1 },
		playerUrlCallback: 'https://playback.example/player',
		offlinePlaybackLanguages: ['fra', 'deu']
	};
	await test('HIDIVE --srz and --series select a numeric series and pass the requested episode through the CLI', async () => {
		for (const [alias, seriesId, episodeId] of [
			['--srz', '12345', '4'],
			['--series', '67890', '7']
		]) {
			const argv = { service: 'hidive', srz: seriesId, series: seriesId, e: episodeId, dryRun: true };
			const service = loadHidive(undefined, false, argv);
			const selectedEpisode = { episodeInformation: { episodeNumber: Number(episodeId) } };
			const selections = [];
			const downloads = [];
			service.selectSeries = async (...args) => {
				selections.push(args);
				return { isOk: true, showData: { id: Number(seriesId) }, value: [selectedEpisode] };
			};
			service.downloadEpisode = async (episode, options) => {
				downloads.push({ episode, options });
				return true;
			};
			assert.equal(await service.cli(), undefined);
			assert.deepEqual(selections, [[Number(seriesId), episodeId, undefined, undefined]]);
			assert.equal(downloads.length, 1);
			assert.equal(downloads[0].episode, selectedEpisode);
			assert.equal(downloads[0].options.e, episodeId);
		}
	});
	hd.apiReq = async () => ({ ok: true, res: { text: async () => JSON.stringify(episodeData) } });
	hd.req = { getData: async (url) => (url === 'https://playback.example/player' ? { ok: true, res: { text: async () => JSON.stringify(playback) } } : textResponse('<MPD/>')) };

	await test('HIDIVE selected episode previews metadata, decimal bitrates and complete selected URLs before IO', async () => {
		const result = await hd.downloadEpisode(selectedHidiveEpisode(), hidiveOptions());
		assert.equal(result.isOk, true);
		assert.equal(result.dryRun, true);
		assert(logs.some(([, line]) => line.includes('1280x720 (3200 kb/s)')));
		assert(logs.some(([, line]) => line.includes('Video Stream URL: https://video.example/720/init.mp4?token=full-video-720')));
		assert(logs.some(([, line]) => line.includes('Audio Stream URL (French): https://audio.example/fra/init.mp4?token=full-audio-fra')));
		assert(logs.some(([, line]) => line.includes('Audio Stream URL (German): https://audio.example/deu/init.mp4?token=full-audio-deu')));
		assert.deepEqual(effects, { bin: 0, cdm: 0, download: 0, mux: 0, archive: 0, path: 0, files: 0 });
	});

	await test('HIDIVE single-episode route returns preview before mux and archive', async () => {
		hd.getSeason = async () => ({ isOk: true, value: { title: 'Season', series: { title: 'Series' } } });
		const result = await hd.downloadSingleEpisode(55, hidiveOptions());
		assert.equal(result.isOk, true);
		assert.equal(result.dryRun, true);
		assert.equal(effects.mux, 0);
		assert.equal(effects.archive, 0);
	});

	await test('HIDIVE no-audio preview works without CDM or binaries', async () => {
		const result = await loadHidive().downloadMPD(hidiveManifest, [], selectedHidiveEpisode(), hidiveOptions({ noaudio: true, novids: true, dubLang: [] }));
		assert.equal(result.dryRun, true);
		assert(logs.some(([, line]) => line.includes('Video Stream URL: https://video.example/720/init.mp4?token=full-video-720')));
		assert.equal(effects.bin, 0);
		assert.equal(effects.cdm, 0);
		assert.equal(effects.download, 0);
	});

	await test('HIDIVE manifest discovery failures do not report a successful preview', async () => {
		const service = loadHidive();
		assert.equal(await service.downloadMPD({}, [], selectedHidiveEpisode(), hidiveOptions()), undefined);
		assert.equal(await service.downloadMPD({ cdn: { video: [], audio: [] } }, [], selectedHidiveEpisode(), hidiveOptions()), undefined);
	});

	await test('HIDIVE normal mode proceeds beyond the preview boundary', async () => {
		const service = loadHidive(hidiveManifest, true);
		service.cfg.bin = { ffmpeg: '/ffmpeg', mp4decrypt: '/decrypt' };
		await assert.rejects(service.downloadMPD(hidiveManifest, [], selectedHidiveEpisode(), hidiveOptions({ dryRun: false })), /unexpected path side effect/);
		assert.equal(effects.path, 1);
	});

	await test('HIDIVE episode and single-episode mux failures do not archive completion', async () => {
		for (const single of [false, true]) {
			const service = loadHidive();
			service.cfg.bin = { ffmpeg: '/ffmpeg' };
			service.apiReq = async () => ({ ok: true, res: { text: async () => JSON.stringify(episodeData) } });
			service.req = hd.req;
			service.downloadMPD = async () => ({ data: [], fileName: 'episode' });
			service.muxStreams = async () => false;
			service.getSeason = async () => ({ isOk: true, value: { title: 'Season', series: { title: 'Series' } } });
			const result = single
				? await service.downloadSingleEpisode(55, hidiveOptions({ dryRun: false }))
				: await service.downloadEpisode(selectedHidiveEpisode(), hidiveOptions({ dryRun: false }));
			assert.equal(result.isOk, false);
			assert.equal(effects.archive, 0);
		}
	});

	await test('HIDIVE completed selected and direct episodes archive by season, and missing parents are skipped', async () => {
		const records = [];
		const service = loadHidive(undefined, false, {}, (...args) => records.push(JSON.parse(JSON.stringify(args))));
		const episode = { ...episodeData, id: 901, episodeInformation: { season: 120, seasonNumber: 1, episodeNumber: 4 } };
		service.apiReq = async () => jsonResponse(episode);
		service.req = { getData: async (url) => (url === episode.playerUrlCallback ? jsonResponse(playback) : textResponse('<MPD/>')) };
		service.getSeason = async (id) => {
			assert.equal(id, 120);
			return { isOk: true, value: { title: 'Season', series: { title: 'Series' } } };
		};
		service.downloadMPD = async () => ({ data: [], fileName: 'episode' });
		service.muxStreams = async () => true;
		const selected = { ...selectedHidiveEpisode(), id: 901, titleId: 901, episodeInformation: episode.episodeInformation };
		assert((await service.downloadEpisode(selected, hidiveOptions({ dryRun: false }))).isOk);
		assert((await service.downloadSingleEpisode(901, hidiveOptions({ dryRun: false }))).isOk);
		assert.deepEqual(records, [
			[{ service: 'hidive', type: 's' }, '120', ['4']],
			[{ service: 'hidive', type: 's' }, '120', ['4']]
		]);
		service.apiReq = async () => jsonResponse({ ...episode, episodeInformation: undefined });
		assert((await service.downloadSingleEpisode(901, hidiveOptions({ dryRun: false }))).isOk);
		assert.equal(records.length, 2);
		assert((await service.downloadEpisode({ ...selected, episodeInformation: { ...episode.episodeInformation, season: 0 } }, hidiveOptions({ dryRun: false }))).isOk);
		assert.equal(records.length, 2);
	});

	await test('ADN completed episodes and listed specials archive by show, and missing parents are skipped', async () => {
		const records = [];
		const service = loadAdn(false, (...args) => records.push(JSON.parse(JSON.stringify(args))));
		service.downloadEpisode = async () => ({ data: [], fileName: 'episode' });
		service.muxStreams = async () => true;
		const episode = { ...adnVideo(), id: 901, shortNumber: '4', show: { ...adnVideo().show, id: 120 } };
		assert((await service.getEpisode(episode, adnOptions({ dryRun: false }))).isOk);
		service.getShow = async () => ({ isOk: true, value: { videos: [{ ...episode, id: 902, shortNumber: '0', number: 'Special' }] } });
		const listed = await service.listShow(120);
		assert.equal(listed.value.videos[0].shortNumber, 'S1');
		assert((await service.getEpisode(listed.value.videos[0], adnOptions({ dryRun: false }))).isOk);
		assert.deepEqual(records, [
			[{ service: 'adn', type: 's' }, '120', ['4']],
			[{ service: 'adn', type: 's' }, '120', ['S1']]
		]);
		assert((await service.getEpisode({ ...episode, show: { ...episode.show, id: 0 } }, adnOptions({ dryRun: false }))).isOk);
		assert((await service.getEpisode({ ...episode, show: undefined }, adnOptions({ dryRun: false }))).isOk);
		assert.equal(records.length, 2);
	});

	await test('ADN preview lists all selected-language quality URLs without fetching rendition playlists', async () => {
		const service = loadAdn();
		const req = adnRequests();
		service.req = req;
		const result = await service.getEpisode(adnVideo(), adnOptions());
		assert.equal(result.isOk, true);
		assert.equal(result.dryRun, true);
		assert(logs.some(([, line]) => line.includes('1280x720 (2750 kb/s)')));
		assert(logs.some(([, line]) => line.includes('1280x720 (2800 kb/s)')));
		assert(logs.some(([, line]) => line.includes('https://cdn.example/fra/720.m3u8?cdn=fra')));
		assert(logs.some(([, line]) => line.includes('https://cdn.example/deu/720.m3u8?cdn=deu')));
		assert.equal(req.calls.filter(({ url }) => url.includes('/720.m3u8')).length, 0);
		assert.deepEqual(effects, { bin: 0, cdm: 0, download: 0, mux: 0, archive: 0, path: 0, files: 0 });
	});

	await test('ADN mux failure does not archive completion', async () => {
		const service = loadAdn();
		service.downloadEpisode = async () => ({ data: [], fileName: 'episode' });
		service.muxStreams = async () => false;
		const result = await service.getEpisode(adnVideo(), adnOptions({ dryRun: false }));
		assert.equal(result.isOk, false);
		assert.equal(effects.archive, 0);
	});

	await test('ADN multi-dub preview simulates video-once selection without fetching variants', async () => {
		const service = loadAdn();
		const req = adnRequests();
		service.req = req;
		const result = await service.getEpisode(adnVideo(), adnOptions({ dlVideoOnce: true }));
		assert.equal(result.dryRun, true);
		assert.deepEqual(
			logs.filter(([, line]) => line.startsWith('Stream URL:')).map(([, line]) => line),
			['Stream URL: https://cdn.example/fra/720.m3u8?cdn=fra', 'Stream URL: https://cdn.example/deu/360.m3u8?cdn=deu']
		);
		assert.equal(req.calls.filter(({ url }) => url.includes('.m3u8')).length, 0);
		assert.deepEqual(effects, { bin: 0, cdm: 0, download: 0, mux: 0, archive: 0, path: 0, files: 0 });
	});

	await test('ADN subtitle-only preview stops before filename and subtitle or chapter writes', async () => {
		const service = loadAdn();
		const req = adnRequests();
		service.req = req;
		const result = await service.getEpisode(adnVideo(), adnOptions({ novids: true, chapters: true, dlsubs: ['all'] }));
		assert.equal(result.dryRun, true);
		assert(logs.some(([, line]) => line.includes('Downloading skipped!')));
		assert.equal(
			req.calls.some(({ url }) => url.includes('/master/')),
			false
		);
		assert.equal(effects.path, 0);
		assert.equal(effects.files, 0);
	});

	await test('ADN discovery failure cannot yield a successful preview', async () => {
		const service = loadAdn();
		service.req = adnRequests({ failMaster: true });
		assert.equal(await service.downloadEpisode(adnVideo(), adnOptions()), undefined);
		service.req = adnRequests({ emptyMaster: true });
		assert.equal(await service.downloadEpisode(adnVideo(), adnOptions({ dubLang: ['fra'] })), undefined);
		service.req = adnRequests();
		assert.equal(await service.downloadEpisode(adnVideo(), adnOptions({ dubLang: ['pol'] })), undefined);
		service.req = adnRequests({ emptyStreaming: true });
		assert.equal(await service.downloadEpisode(adnVideo(), adnOptions()), undefined);
	});

	await test('ADN normal mode proceeds to the selected rendition request', async () => {
		const service = loadAdn(true);
		service.cfg.bin = { ffmpeg: '/ffmpeg' };
		const req = adnRequests({ failSelected: true });
		service.req = req;
		const result = await service.downloadEpisode(adnVideo(), adnOptions({ dryRun: false, chapters: false, skipsubs: true, dlsubs: [] }));
		assert.equal(result.error, true);
		assert.equal(req.calls.filter(({ url }) => url.includes('/720.m3u8')).length, 1);
		assert(effects.path > 0);
	});

	output.log(`# ${passed} dry-run provider checks passed`);
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}
