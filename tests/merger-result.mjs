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

fs.rmSync(tmp, { recursive: true, force: true });
consoleOutput.log('Mux result handling tests passed');
