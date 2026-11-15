import assert from 'node:assert/strict';
import fs from 'node:fs';
import output from 'node:console';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import YAML from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const languages = [
	{ code: 'eng', cr_locale: 'en-US' },
	{ code: 'jpn', cr_locale: 'ja-JP' }
];
const languageData = { dubLanguageCodes: ['jpn'], languages, searchLocales: ['en-US'], subtitleLanguagesFilter: ['all', 'eng', 'jpn'] };
const enums = { CrunchyVideoPlayStreams: {}, CrunchyAudioPlayStreams: {} };
const compiledSources = new Map();

function compile(file, deps = {}, overrides = {}) {
	if (!compiledSources.has(file)) {
		compiledSources.set(
			file,
			ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
				compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
			}).outputText
		);
	}
	const code = compiledSources.get(file);
	const module = { exports: {} };
	vm.runInNewContext(
		code,
		{
			module,
			exports: module.exports,
			require: (id) => (id in deps ? deps[id] : require(id)),
			process: overrides.process,
			__dirname: path.join(root, 'modules'),
			console: output
		},
		{ filename: file }
	);
	return module.exports;
}

const { args, groups, configuredDefault, getDefault } = compile('modules/module.args.ts', {
	'./module.langsData': languageData,
	'../@types/enums': enums
});
const qallOption = args.find((arg) => arg.name === 'qall');
assert.equal(qallOption.default.default, false);
assert.deepEqual(Array.from(qallOption.service), ['crunchy']);
assert.equal(qallOption.type, 'boolean');
assert.match(qallOption.docDescribe, /may trigger rate limits/);

const yamlConfig = YAML.parse(fs.readFileSync(path.join(root, 'config/cli-defaults.yml'), 'utf8'));
assert.equal(yamlConfig.qall, false, 'the shared CLI defaults set qall to false');

function parse(argv, config = {}, override) {
	const mockProcess = {
		argv: ['node', 'aniDL', '--service', 'crunchy', ...argv],
		platform: 'darwin',
		exit: (code) => {
			throw Error(`unexpected exit ${code}`);
		}
	};
	const appArgs = compile(
		'modules/module.app-args.ts',
		{
			'./module.args': { args, groups, configuredDefault },
			'./log': { console: output },
			'./module.langsData': languageData,
			'../@types/enums': enums,
			'../package.json': { description: 'fixture CLI', version: '1.0.0' },
			leven: () => 99
		},
		{ process: mockProcess }
	);
	const parsed = appArgs.appArgv(config, false);
	if (!override) return parsed;
	appArgs.overrideArguments(config, override);
	return appArgs.argvC;
}

const parser = compile(
	'modules/module.app-args.ts',
	{
		'./module.args': { args, groups, configuredDefault },
		'./log': { console: output },
		'./module.langsData': languageData,
		'../@types/enums': enums,
		'../package.json': { description: 'fixture CLI', version: '1.0.0' },
		leven: () => 99
	},
	{ process: { platform: 'darwin' } }
);
assert.equal(parser.statusInvocation(['--service', 'crunchy', '--check-status']), 'valid');
assert.equal(parser.statusInvocation(['--check-status', '--debug', '--service=crunchy']), 'valid');
for (const extra of ['--help', '--version', '--tsd', '--dry-run', '--no-qall', '--qall=false', '--e=', 'unexpected'])
	assert.equal(parser.statusInvocation(['--service', 'crunchy', '--check-status', extra]), 'invalid');
assert.equal(parser.statusInvocation(['--check-status=false', '--service', 'crunchy']), 'invalid');
assert.equal(parser.statusInvocation(['--check-status', '--service', 'hidive']), 'invalid');
assert.equal(parse([], { 'check-status': true }).checkStatus, undefined);
assert.equal(parse(['--check-status'], { tsd: true, qall: true }).checkStatus, true);
assert.equal(parse([]).qall, false, 'qall is false by default');
assert.equal(parse([], { qall: true }).qall, true, 'qall can be enabled from the YAML config value');
assert.equal(parse(['--qall'], { qall: false }).qall, true);
assert.equal(parse(['-qall'], { qall: false }).qall, true, 'the existing short spelling normalization accepts -qall');
assert.equal(parse(['--qall=false'], { qall: true }).qall, false, 'an explicit false CLI value overrides config');
assert.equal(parse(['--no-qall'], { qall: true }).qall, false, 'Commander negation overrides config');
assert.equal(parse(['--qall=true'], { qall: false }).qall, true);
assert.equal(parse(['--qall=false', '--qall'], { qall: true }).qall, true, 'the last explicit option wins');
assert.equal(parse(['--qall', '--qall=false'], { qall: true }).qall, false);
for (const flag of ['--qall=false', '--no-qall']) {
	assert.equal(parse([flag], { qall: true }, { e: '1' }).qall, false, 'archive argument replacement preserves explicit CLI false');
}
assert.equal(parse([], { qall: true }, { qall: false }).qall, false, 'an explicit archive override can disable the setting');
output.log('ok - Crunchyroll qall option, config default and CLI parsing');

assert.equal(parse([]).discoveryTimmer, undefined);
assert.equal(parse(['--discovery-timmer', '0']).discoveryTimmer, 0);
assert.equal(parse(['-disctmr', '42']).discoveryTimmer, 42);
assert.equal(parse(['--disctmr', '12']).discoveryTimmer, 12);
assert.equal(parse(['--disctmr', '12', '--discovery-timmer', '0']).discoveryTimmer, 0);
assert.equal(parse([], { disctmr: 4 }).discoveryTimmer, 4);
assert.equal(parse([], { 'discovery-timmer': 0, disctmr: 5 }).discoveryTimmer, 0);
assert.equal(parse([], { forcevid: true, forcevideo: true }).bypasssync, false);
assert.equal(parse([], { bypasssync: true }).bypasssync, true);
assert.equal(parse(['--bypasssync'], {}).bypasssync, true);
for (const old of ['--forcevideo', '--forcevid']) {
	const command = parser
		.getCommander({}, false)
		.configureOutput({ writeOut() {}, writeErr() {} })
		.exitOverride();
	assert.throws(() => command.parse(['node', 'aniDL', '--service', 'crunchy', old]), /unknown option/);
}

assert.equal(parse([], { vs: 'android' }).vstream, 'android');
assert.equal(parse([], { as: 'web' }).astream, 'web');
assert.equal(parse(['--server', '3']).x, 3);
assert.equal(parse(['-x', '2']).server, 2);
assert.equal(parse([], { server: 4 }).x, 4);
assert.equal(parse([], {}, { server: 2 }).x, 2);
assert.equal(getDefault('defaultAudio', { defaultAudio: 'jpn' }), 'jpn', 'GUI getDefault returns raw untransformed values');
for (const key of ['discoveryTimmer', 'discovery-timmer', 'disctmr']) assert.equal(parse([], {}, { [key]: 0 }).discoveryTimmer, 0);
for (const invalid of [null, false, true, '', ' ', '-1', '1.5', 'Infinity', '1e3', 1.5, -1, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
	assert.throws(() => parse([], { 'discovery-timmer': invalid, disctmr: 5 }), /nonnegative safe integer/);
}
for (const flag of ['--discovery-timmer', '--disctmr', '-disctmr'])
	for (const invalid of ['-1', '1.5', 'Infinity', '']) assert.throws(() => parse([flag, invalid]), /nonnegative safe integer/);
assert.equal(parse([], { 'dry-run': true, dryRun: true }).dryRun, false);
assert.equal(parse(['--dry-run'], { 'dry-run': false }).dryRun, true);
assert.equal(parse(['--dryRun']).dryRun, true);
function help(argv, config = {}) {
	const mockProcess = {
		argv: ['node', 'aniDL', ...argv],
		platform: 'darwin',
		exit: () => {
			throw Error('unexpected process exit');
		}
	};
	const appArgs = compile(
		'modules/module.app-args.ts',
		{
			'./module.args': { args, groups, configuredDefault },
			'./log': { console: output },
			'./module.langsData': languageData,
			'../@types/enums': enums,
			'../package.json': { description: 'fixture CLI', version: '1.0.0' },
			leven: () => 99
		},
		{ process: mockProcess }
	);
	let captured = '';
	const command = appArgs
		.getCommander(config, false)
		.configureOutput({
			writeOut: (s) => {
				captured += s;
			},
			writeErr: (s) => {
				captured += s;
			}
		})
		.exitOverride();
	command.parse(mockProcess.argv);
	command.outputHelp();
	return captured;
}
for (const [argv, cfg, crunchy] of [
	[['--help'], {}, false],
	[['--service', 'crunchy', '--help'], {}, true],
	[['--help', '--service', 'crunchy'], {}, true],
	[['--help', '--service=crunchy'], {}, true],
	[['--help'], { service: 'crunchy' }, true],
	[['--service', 'hidive', '--help'], {}, false],
	[['--help', '--service=adn'], {}, false]
]) {
	const text = help(argv, cfg);
	assert.equal(text.includes('--discovery-timmer'), crunchy);
	assert.equal(text.includes('--bypasssync'), crunchy);
	assert(!text.includes('--forcevid'));
	assert.equal(text.includes('--check-status'), crunchy);
	assert.equal(text.includes('--device'), crunchy);
	assert(text.includes('--dry-run'));
	if (crunchy) assert(text.includes('unset uses automatic 250–400 ms'));
	assert(text.includes('--help') && text.includes('--version'));
	assert(!text.includes('--no-qall'));
	if (!crunchy) assert(!text.includes('Crunchyroll CLI: use --device'));
}
output.log('ok - discovery timer, aliases, config precedence and service-aware help');

const docs = fs.readFileSync(path.join(root, 'docs/DOCUMENTATION.md'), 'utf8');
const section = (name) => docs.split(`#### \`${name}\``)[1].split('#### `')[0];
assert.match(section('--discovery-timmer'), /`automatic`[\s\S]*`discovery-timmer: ` or `disctmr: `/);
assert.match(section('--dry-run'), /`false`[\s\S]*`—`/);
for (const name of ['--username', '--password', '--token', '--forceMuxer']) {
	assert.match(section(name), /`undefined`/);
	assert(!section(name).includes('`automatic`'));
}
assert.equal((section('-x').match(/`server: `/g) ?? []).length, 1);
assert.match(section('--bypasssync'), /`bypasssync: `/);
assert(!docs.includes('#### `--forcevideo`'));
assert.match(section('--check-status'), /`—`/);
assert.match(section('--vstream'), /`vstream: ` or `vs: `/);
assert.match(section('--astream'), /`astream: ` or `as: `/);

const serverOption = args.find((argument) => argument.name === 'x');
serverOption.default.name = 'server';
let generated = '';
try {
	compile('modules/build-docs.ts', {
		'../package.json': { name: 'fixture', version: '1' },
		'./module.args': { args, groups },
		fs: {
			writeFileSync: (_path, text) => {
				generated = text;
			}
		},
		path
	});
} finally {
	delete serverOption.default.name;
}
const generatedServer = generated.split('#### `-x`')[1].split('#### `')[0];
assert.equal((generatedServer.match(/`server: `/g) ?? []).length, 1, 'matching canonical and alias keys render only once');

assert.equal(parse([], { tsd: true }).tsd, true);
assert.equal(parse([], { tsd: true }).tsdExplicit, false);
assert.equal(parse(['--tsd'], { tsd: false }).tsdExplicit, true);
assert.equal(parse([], { tsd: false }).tsd, false);
assert.equal(parse(['--tsd'], { tsd: false }).tsd, true);
assert.equal(parse(['--tsd']).requestedActionOrSelector, false);
assert.equal(parse([], { tsd: true, all: true }).requestedActionOrSelector, true);
assert.equal(parse([], { tsd: true, all: false }).requestedActionOrSelector, false);
for (const argv of [
	['--search', 'ab'],
	['--search', ''],
	['--series', 'bad'],
	['-s', 'bad'],
	['--movie-listing', ''],
	['--show-raw', 'bad'],
	['--season-raw', 'bad'],
	['--tsd', 'unexpected']
]) {
	assert.equal(parse(argv).requestedActionOrSelector, true, `selector blocks standalone reset: ${argv.join(' ')}`);
}
