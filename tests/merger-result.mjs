import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import consoleOutput from 'node:console';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anidl-merger-result-'));
const require = createRequire(import.meta.url);
const language = { code: 'eng', name: 'English', language: 'English' };
let exec;
const fakeConsole = Object.fromEntries(['info', 'warn', 'error', 'debug'].map((method) => [method, () => {}]));
const helper = { default: { exec: (...args) => exec(...args) }, __esModule: true };
const deps = {
	'iso-639': {},
	'./module.fontsData': { fontFamilies: {}, fontMime: () => '' },
	'./module.langsData': {},
	'./module.args': {},
	'./log': { console: fakeConsole },
	'./module.helper': helper,
	'./module.ffmpegChapter': { convertChaptersToFFmpegFormat: () => '' },
	'mediainfo.js': { mediaInfoFactory: async () => ({}) }
};
const source = fs.readFileSync(path.join(root, 'modules/module.merger.ts'), 'utf8');
const code = ts.transpileModule(source, {
	compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(code, { module, exports: module.exports, require: (id) => deps[id] ?? require(id), console: fakeConsole }, { filename: 'module.merger.ts' });
const Merger = module.exports.default;

function makeMerger(output) {
	return new Merger({
		videoAndAudio: [],
		onlyVid: [],
		onlyAudio: [],
		subtitles: [],
		chapters: [],
		ccTag: '',
		output,
		options: { ffmpeg: [], mkvmerge: [] },
		defaults: { audio: language, sub: language }
	});
}

let output = path.join(tmp, 'success.mkv');
exec = () => {
	fs.writeFileSync(output, 'valid mux output');
	return { isOk: true, out: '', err: { code: 0 } };
};
assert.equal(await makeMerger(output).merge('ffmpeg', '/fake/ffmpeg'), true, 'exit zero with nonempty output succeeds');

output = path.join(tmp, 'warning.mkv');
exec = () => {
	fs.writeFileSync(output, 'valid mux output');
	return { isOk: false, out: '', err: { code: 1 } };
};
assert.equal(await makeMerger(output).merge('mkvmerge', '/fake/mkvmerge'), true, 'mkvmerge warning exit succeeds when output exists');

output = path.join(tmp, 'fatal-partial.mkv');
exec = () => {
	fs.writeFileSync(output, 'partial');
	return { isOk: false, out: '', err: { code: 2 } };
};
assert.equal(await makeMerger(output).merge('ffmpeg', '/fake/ffmpeg'), false, 'fatal exit fails even when a partial output exists');

output = path.join(tmp, 'missing.mkv');
exec = () => ({ isOk: false, out: '', err: { code: 1 } });
assert.equal(await makeMerger(output).merge('mkvmerge', '/fake/mkvmerge'), false, 'warning exit without output fails');

output = path.join(tmp, 'empty.mkv');
exec = () => {
	fs.writeFileSync(output, '');
	return { isOk: true, out: '', err: { code: 0 } };
};
assert.equal(await makeMerger(output).merge('ffmpeg', '/fake/ffmpeg'), false, 'empty output fails');

output = path.join(tmp, 'throw.mkv');
exec = () => {
	throw new Error('interrupted');
};
assert.equal(await makeMerger(output).merge('ffmpeg', '/fake/ffmpeg'), false, 'helper interruption fails');

output = path.join(tmp, 'stale.mkv');
fs.writeFileSync(output, 'existing output');
const staleMtime = new Date('2020-01-01T00:00:00.000Z');
fs.utimesSync(output, staleMtime, staleMtime);
const originalStat = fs.statSync(output);
exec = () => ({ isOk: false, out: '', err: { code: 1 } });
assert.equal(await makeMerger(output).merge('mkvmerge', '/fake/mkvmerge'), false, 'unchanged stale output does not count as a mux result');
assert.deepEqual(fs.statSync(output).size, originalStat.size, 'mux failure preserves existing output');

// Crunchyroll output maps retain the selected video while reordering only output tracks.
const en = { code: 'eng', name: 'English', locale: 'en', cr_locale: 'en-US' };
const enIndia = { code: 'eng', name: 'English (India)', locale: 'en-IN', cr_locale: 'en-IN' };
const ja = { code: 'jpn', name: 'Japanese', locale: 'ja', cr_locale: 'ja-JP' };
const fr = { code: 'fra', name: 'French', language: 'Français', locale: 'fr', cr_locale: 'fr-FR' };
const hi = { code: 'hin', name: 'Hindi', language: 'हिन्दी', locale: 'hi', cr_locale: 'hi-IN' };
const vi = (name, lang, delay) => ({ path: `/fake/${name}`, lang, delay });
const sub = (name, language, flags = {}) => ({ file: `/fake/${name}`, language, ...flags });
const layout = {
	videoAndAudio: [],
	onlyVid: [vi('video', en)],
	onlyAudio: [vi('ja-audio', ja), vi('en-audio', en), { ...vi('india-audio', en), orderLang: enIndia }],
	subtitles: [
		sub('en-cc', en, { closedCaption: true, signs: true }),
		sub('ja-full', ja),
		sub('en-full', en),
		sub('ja-signs', ja, { signs: true }),
		sub('en-signs', en, { signs: true }),
		sub('fr-full', fr)
	],
	chapters: [],
	fonts: [],
	ccTag: 'CC',
	output: '/fake/result.mkv',
	options: { ffmpeg: [], mkvmerge: [] },
	defaults: { audio: fr, sub: fr },
	crunchy: { languages: [enIndia, en, ja], allDubs: false, noaudio: false }
};
const orderMerger = new Merger(layout);
const mkv = orderMerger.MkvMerge();
assert(mkv.includes('--track-order 0:0,3:0,2:0,1:0,8:0,6:0,4:0,7:0,5:0,9:0'), mkv);
assert(mkv.includes('--default-track-flag 0:1'));
assert.equal((mkv.match(/--forced-display-flag 0:1/g) ?? []).length, 2, 'only the two signs are forced, including malformed CC/signs');
assert(mkv.includes('English CC') && !mkv.includes('English CC Signs'));
const ff = orderMerger.FFmpeg();
assert.deepEqual(
	[...ff.matchAll(/-map (\d+):([vas]):0/g)].map((match) => `${match[1]}:${match[2]}`),
	['0:v', '3:a', '2:a', '1:a', '8:s', '6:s', '4:s', '7:s', '5:s', '9:s']
);
assert.equal((ff.match(/\+default\+forced/g) ?? []).length, 2);
assert.equal((ff.match(/\+default-forced/g) ?? []).length, 8);
assert(ff.includes('-metadata:s:a:0 title="English (India)"'));
assert(ff.includes('-disposition:s:2 +default-forced'), 'CC marked signs cannot be forced');
const combined = new Merger({
	...layout,
	onlyVid: [],
	onlyAudio: [],
	subtitles: [],
	videoAndAudio: [vi('short-ja', ja), vi('long-en', en, 1.25)],
	crunchy: { languages: [en, ja], allDubs: false, noaudio: false }
});
assert(combined.MkvMerge().includes('--track-order 0:0,1:1,0:1'), 'retained shortest video stays first while requested English audio is first');
assert(combined.MkvMerge().includes('--sync 1:-1250'), 'combined audio offset remains on its original input');
const combinedFF = combined.FFmpeg();
assert.deepEqual(
	[...combinedFF.matchAll(/-map (\d+):([va]):0/g)].map((match) => `${match[1]}:${match[2]}`),
	['0:v', '1:a', '0:a']
);
assert(combinedFF.includes('-itsoffset -1250ms -i "/fake/long-en"'));
const noAudio = new Merger({
	...layout,
	onlyVid: [],
	onlyAudio: [],
	subtitles: [],
	videoAndAudio: [vi('combined', en)],
	crunchy: { languages: [en], allDubs: false, noaudio: true }
});
assert(noAudio.MkvMerge().includes('--no-audio') && noAudio.MkvMerge().includes('--track-order 0:0'));
assert(!/-map \d+:a:0/.test(noAudio.FFmpeg()));
// Mixed DASH/HLS descriptors retain the original source-first video even though inputs use different arrays.
for (const splitFirst of [true, false]) {
	const split = { ...vi('mixed-split', en), sourceIndex: splitFirst ? 0 : 1 };
	const joined = { ...vi('mixed-combined', ja), sourceIndex: splitFirst ? 1 : 0 };
	const mixed = new Merger({
		...layout,
		onlyVid: [split],
		videoAndAudio: [joined],
		onlyAudio: [vi('mixed-audio', en)],
		subtitles: [],
		crunchy: { languages: [en, ja], allDubs: false, noaudio: false }
	});
	const mkvMixed = mixed.MkvMerge();
	assert(mkvMixed.includes(splitFirst ? '--track-order 0:0,2:0,1:1' : '--track-order 0:0,1:0,0:1'), mkvMixed);
	const ffMixed = mixed.FFmpeg();
	const mappedVideo = [...ffMixed.matchAll(/-map (\d+):v:0/g)].map((match) => match[1]);
	assert.deepEqual(mappedVideo, [splitFirst ? '1' : '0']);
	const allMixed = new Merger({
		...layout,
		onlyVid: [split],
		videoAndAudio: [joined],
		onlyAudio: [vi('mixed-audio', en)],
		subtitles: [],
		keepAllVideos: true,
		crunchy: { languages: [en, ja], allDubs: false, noaudio: false }
	});
	const outputVideos = [...allMixed.FFmpeg().matchAll(/-map (\d+):v:0/g)].map((match) => match[1]);
	assert.deepEqual(outputVideos, splitFirst ? ['1', '0'] : ['0', '1']);
	assert(allMixed.MkvMerge().includes(splitFirst ? '--track-order 0:0,1:0,2:0,1:1' : '--track-order 1:0,0:0,2:0,1:1'), 'mixed MKV keeps videos in original source order');
}
const splitVideo = new Merger({
	...layout,
	onlyVid: [vi('one', en), vi('two', ja)],
	onlyAudio: [],
	videoAndAudio: [],
	subtitles: [],
	keepAllVideos: true,
	crunchy: { languages: [], allDubs: false, noaudio: true }
});
assert(splitVideo.MkvMerge().includes('--track-order 0:0,1:0'));
assert.deepEqual(
	[...splitVideo.FFmpeg().matchAll(/-map (\d+):v:0/g)].map((match) => match[1]),
	['0', '1']
);
const allDubs = new Merger({
	...layout,
	onlyAudio: [vi('hindi', hi), vi('french', fr), vi('japanese', ja), vi('english', en)],
	subtitles: [],
	crunchy: { languages: [], allDubs: true, noaudio: false }
});
assert(allDubs.MkvMerge().includes('--track-order 0:0,4:0,3:0,2:0,1:0'), 'allDubs sorts by English names rather than native labels');
const extraLocales = new Merger({
	...layout,
	onlyAudio: [vi('en', en)],
	subtitles: [sub('extra-hi', hi), sub('extra-fr', fr), sub('extra-ja', ja), sub('extra-en', en)],
	crunchy: { languages: [en], allDubs: false, noaudio: false }
});
assert(extraLocales.MkvMerge().includes('--track-order 0:0,1:0,5:0,4:0,3:0,2:0'), 'subtitle-only languages follow audio then English-name ordering');
const regionOrder = new Merger({
	...layout,
	onlyAudio: [vi('usa', en), { ...vi('india', en), orderLang: { ...enIndia, name: 'English' } }],
	subtitles: [],
	crunchy: { languages: [], allDubs: true, noaudio: false }
});
assert(regionOrder.MkvMerge().includes('--track-order 0:0,2:0,1:0'), 'same-name regional ties use normalized locale');
const legacyOptions = { ...layout, crunchy: undefined, onlyVid: [vi('legacy-video', en)], onlyAudio: [vi('legacy-audio', en)], subtitles: [] };
const legacy = new Merger(legacyOptions);
assert(!legacy.MkvMerge().includes('--track-order') && !legacy.MkvMerge().includes('--forced-display-flag'));
assert(!legacy.FFmpeg().includes('-disposition:'), 'other providers retain their existing mux policy');
const sidecars = new Merger({ ...layout, skipSubMux: true });
assert(!sidecars.FFmpeg().includes('/fake/en-signs'));
assert(!sidecars.MkvMerge().includes('/fake/en-signs'));

fs.rmSync(tmp, { recursive: true, force: true });
consoleOutput.log('Mux result handling tests passed');
