import assert from 'node:assert/strict';
import fs from 'node:fs';
import output from 'node:console';
import process from 'node:process';
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
const languageData = { dubLanguageCodes: ['eng', 'hin', 'zho', 'chi', 'jpn'], languages, searchLocales: ['en-US'], subtitleLanguagesFilter: ['all', 'eng', 'jpn'] };
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
			console: output,
			...(overrides.global ? { global: overrides.global } : {})
		},
		{ filename: file }
	);
	return module.exports;
}

for (const { name, runtime, expected } of [
	{
		name: 'source entry in its project root',
		runtime: { argv: ['node', '/synthetic/project/index.ts', '--service', 'crunchy'], cwd: () => '/synthetic/project', platform: 'linux', env: {} },
		expected: 'anidl'
	},
	{
		name: 'built Node entry from an unrelated deep directory',
		runtime: { argv: ['node', '/synthetic/project/lib/index.js', '--service', 'crunchy'], cwd: () => '/unrelated/deep/cwd', platform: 'linux', env: {} },
		expected: 'anidl'
	},
	{
		name: 'built Node GUI bridge from an unrelated directory',
		runtime: { argv: ['node', '/synthetic/project/lib/gui.js', '--service', 'crunchy'], cwd: () => '/unrelated/deep/cwd', platform: 'linux', env: { isGUI: 'true' } },
		expected: 'anidl'
	},
	{
		name: 'Windows executable',
		runtime: { argv: ['node', 'C:/synthetic/project/lib/index.js', '--service', 'crunchy'], cwd: () => 'C:/unrelated/cwd', platform: 'win32', env: {} },
		expected: 'anidl'
	},
	{
		name: 'packaged POSIX from its executable folder',
		runtime: {
			argv: ['aniDL', '/snapshot/project/index.js', '--service', 'crunchy'],
			cwd: () => '/synthetic/package',
			platform: 'linux',
			env: {},
			execPath: '/synthetic/package/aniDL',
			pkg: {}
		},
		expected: './aniDL'
	},
	{
		name: 'packaged POSIX from elsewhere',
		runtime: {
			argv: ['aniDL', '/snapshot/project/index.js', '--service', 'crunchy'],
			cwd: () => '/unrelated/deep/cwd',
			platform: 'linux',
			env: {},
			execPath: '/synthetic/package/aniDL',
			pkg: {}
		},
		expected: 'anidl'
	},
	{
		name: 'packaged Windows from its executable folder',
		runtime: {
			argv: ['aniDL.exe', 'C:/snapshot/project/index.js', '--service', 'crunchy'],
			cwd: () => 'C:/synthetic/package',
			platform: 'win32',
			env: {},
			execPath: 'C:/synthetic/package/aniDL.exe',
			pkg: {}
		},
		expected: 'aniDL.exe'
	}
]) {
	const runtimePath = runtime.platform === 'win32' ? path.win32 : path.posix;
	const auth = compile('modules/module.crunchy-cli-auth.ts', { path: runtimePath }, { process: runtime });
	assert.equal(auth.cliInvocation(), expected, name);
	assert.equal(auth.leadingCliService(runtime.argv.slice(2)), 'crunchy');
	assert.equal(auth.leadingCliService(['-service', 'hidive']), 'hidive');
	assert.equal(auth.leadingCliService(['--service=adn']), 'adn');
	assert.equal(auth.leadingCliService(['--token=--service=crunchy']), undefined);
	assert.equal(auth.leadingCliService(['--', '--service', 'crunchy']), undefined);
	const recovery = auth.crunchyLoginInstruction('--device androidtv');
	if (runtime.env.isGUI === 'true') assert.equal(recovery, `Run:\n  ${expected} --service crunchy --device androidtv`);
	else assert.equal(recovery, 'Keep your Crunchyroll command and replace its options with:\n  --device androidtv');
	for (const [argv, example] of [
		[{ service: 'crunchy', auth: true }, '--device android'],
		[{ service: 'crunchy', device: true }, '--device androidtv'],
		[{ service: 'crunchy', token: true, crunchyAuthExplicit: true }, '--token']
	]) {
		const decision = auth.crunchyCliAuthDecision(argv);
		assert.notEqual(decision.kind, 'continue', `${name}: expected a sign-in notice`);
		assert(decision.message.includes(example), `${name}: missing compact example ${example}`);
		if (argv.auth) assert.match(decision.message, /Run the same command again, replacing/);
		else {
			const lines = decision.message.split('\n');
			assert.equal(lines.length, 5, 'show just two labeled examples');
			assert.equal(lines[2], '');
			assert.deepEqual([lines[1], lines[4]], argv.device ? ['  --device androidtv', '  --device android'] : ['  --token "cookies.txt"', '  --token "YOUR_COOKIE_VALUE"']);
			if (argv.device) assert.match(lines[3], /Crunchyroll window/);
			else assert.match(lines[3], /etp_rt/);
		}
		assert.doesNotMatch(decision.message, /--service|(?:^|\n)\s*(?:anidl|aniDL\.exe|node|pnpm exec tsx)\s+--|\/synthetic\/|\/unrelated\/|node_modules|\.\.\/|C:\/synthetic/i);
	}
	const unscopedRuntime = { ...runtime, argv: runtime.argv.slice(0, 2) };
	const unscoped = compile('modules/module.crunchy-cli-auth.ts', { path: runtimePath }, { process: unscopedRuntime });
	assert.equal(unscoped.leadingCliService(unscopedRuntime.argv.slice(2)), undefined);
	assert.equal(unscoped.crunchyLoginInstruction('--device androidtv'), `Run:\n  ${expected} --service crunchy --device androidtv`);
}

const { args, groups, configuredDefault, getDefault, optionAppliesToService } = compile('modules/module.args.ts', {
	'./module.langsData': languageData,
	'../@types/enums': enums,
	'../package.json': JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')),
	'./module.fork-display': compile('modules/module.fork-display.ts')
});
const qallOption = args.find((arg) => arg.name === 'qall');
assert.equal(qallOption.default.default, false);
assert.deepEqual(Array.from(qallOption.service), ['crunchy']);
assert.equal(qallOption.type, 'boolean');
assert.match(qallOption.docDescribe, /may trigger rate limits/);

const yamlConfig = YAML.parse(fs.readFileSync(path.join(root, 'config/cli-defaults.yml'), 'utf8'));
assert.equal(yamlConfig.qall, false, 'the shared CLI defaults set qall to false');

function parse(argv, config = {}, override, directOverride = false, isGUI = false, service = 'crunchy') {
	const errors = [];
	const mockProcess = {
		argv: ['node', 'aniDL', ...(service ? ['--service', service] : []), ...argv],
		platform: 'darwin',
		exit: (code) => {
			throw Error(`exit ${code}: ${errors.join('; ')}`);
		}
	};
	const appArgs = compile(
		'modules/module.app-args.ts',
		{
			'node:fs': { existsSync: (file) => ['-cookies.txt', '--debug'].includes(file) },
			'./module.args': { args, groups, configuredDefault, optionAppliesToService },
			'./module.crunchy-cli-auth': compile('modules/module.crunchy-cli-auth.ts'),
			'./log': { console: { ...output, error: (message) => errors.push(message) } },
			'./module.langsData': languageData,
			'../@types/enums': enums,
			'../package.json': { description: 'fixture CLI', version: '1.0.0' },
			leven: () => 99
		},
		{ process: mockProcess, global: { console: { log() {} } } }
	);
	if (directOverride) {
		appArgs.overrideArguments(config, override, isGUI);
		return appArgs.argvC;
	}
	const parsed = appArgs.appArgv(config, isGUI);
	if (!override) return parsed;
	appArgs.overrideArguments(config, override, isGUI);
	return appArgs.argvC;
}

const archivedSeason = { but: true, all: false, service: 'hidive', e: '4', s: '120' };
for (const [argv, config, label] of [
	[['--downloadArchive'], {}, 'default selection'],
	[['--downloadArchive'], { all: true }, 'config all:true'],
	[['--downloadArchive', '--all'], {}, 'CLI --all']
]) {
	const replay = parse(argv, config, archivedSeason, false, false, 'hidive');
	assert.equal(replay.all, false, `archive replay clears all for ${label}`);
	assert.equal(replay.but, true, `archive replay preserves but for ${label}`);
	assert.equal(replay.e, '4', `archive replay retains completed-episode exclusions for ${label}`);
	assert.equal(replay.s, '120', `archive replay retains the season selector for ${label}`);
}
const ordinaryAll = parse(['--all', '-s', '120'], {}, undefined, false, false, 'hidive');
assert.equal(ordinaryAll.all, true, 'ordinary CLI --all remains enabled outside archive replay');

for (const selectors of [
	['--service', 'hidive', '--service', 'hidive'],
	['--service', 'hidive', '--service', 'crunchy'],
	['--service=hidive', '-service', 'crunchy'],
	['--service', 'hidive', '--addArchive', '-s', '42', '--fileName', '--service=crunchy'],
	['--service', 'hidive', '--fileName', '-service', 'crunchy'],
	['--service', 'hidive', '--fileName', '--', '--service=crunchy'],
	['--service', 'hidive', '-hq', '--', '--fileName', '--service=crunchy']
]) {
	const originalExit = process.exit;
	const originalStderrWrite = process.stderr.write;
	let errorOutput = '';
	try {
		process.exit = (code) => {
			throw Error(`captured process exit ${code}`);
		};
		process.stderr.write = (message) => ((errorOutput += String(message)), true);
		assert.throws(() => parse(selectors, {}, undefined, false, false, null), /captured process exit 1/);
		assert.match(errorOutput, /Choose one service per command/);
	} finally {
		process.exit = originalExit;
		process.stderr.write = originalStderrWrite;
	}
}

for (const input of [['eng', 'jpn', 'hin'], ['eng,jpn,hin'], ['eng,', 'jpn,', 'hin'], ['eng,jpn', 'hin']]) {
	assert.deepEqual(Array.from(parse(['--dubLang', ...input]).dubLang), ['eng', 'jpn', 'hin']);
}
for (const option of ['device', 'token']) {
	assert.equal(parse([])[option], undefined);
	assert.equal(parse([`--${option}`, '--debug'])[option], true);
	assert.equal(parse([`--${option}=`])[option], '');
}
for (const type of ['android', 'androidtv']) {
	assert.equal(parse(['--device', type]).device, type);
	assert.equal(parse([`--device=${type}`]).device, type);
}
assert.equal(parse(['--token', 'my cookies.txt']).token, 'my cookies.txt');
assert.equal(parse(['--token', '-cookies.txt']).token, '-cookies.txt');
assert.equal(parse(['--token', '--debug']).debug, true);
assert.equal(parse(['--token=--service=crunchy']).token, '--service=crunchy');
assert.equal(parse(['--', '--service', 'hidive'], {}, undefined, false, false, 'hidive').service, 'hidive');
assert.equal(parse(['--search=--service=crunchy'], {}, undefined, false, false, 'hidive').search, '--service=crunchy');
assert.equal(parse(['--fileName', '--', '--search', 'literal'], {}, undefined, false, false, 'hidive').search, 'literal');
assert.equal(parse(['--', '--token', '-fixture-private-cookie', '--qall=false'], {}, { e: '1' }).e, '1', 'archive overrides remain options before the delimiter');
assert.equal(parse(['--', '--token', '-fixture-private-cookie'], {}, undefined, false, false, 'hidive').token, undefined);
assert.equal(parse(['--', '--qall=false'], { qall: true }).qall, true);
assert.equal(parse(['-hq', '--', '--', '--token', '-fixture-private-cookie'], {}, { e: '1' }, true, true).e, '1', 'grouped short options locate the archive override boundary');
assert.equal(parse(['-hq=2', '--', '--token', '-fixture-private-cookie'], {}, { e: '1' }, true, true).e, '1', 'a grouped attached short value leaves the delimiter active');
assert.equal(parse(['--service', 'hidive'], {}, undefined, false, true, 'crunchy').service, 'hidive', 'GUI parsing retains service overrides');
assert.throws(() => parse(['--version', '--', '--token', '-fixture-private-cookie']), /exit 0/);
assert.equal(parse(['--auth'], {}, undefined, false, false, 'hidive').auth, true);
assert.equal(parse(['--auth'], {}, undefined, false, false, 'adn').auth, true);
{
	const originalExit = process.exit;
	const originalStderrWrite = process.stderr.write;
	let errorOutput = '';
	try {
		process.exit = (code) => {
			throw Error(`captured process exit ${code}`);
		};
		process.stderr.write = (message) => ((errorOutput += String(message)), true);
		assert.throws(() => parse(['--token', '-fixture-private-cookie']), /captured process exit 1/);
		assert.throws(() => parse(['-hq', '--', '--token', '-fixture-private-cookie']), /captured process exit 1/);
		assert.match(errorOutput, /Invalid --token input or unknown option/);
		assert(!errorOutput.includes('fixture-private-cookie'));
	} finally {
		process.exit = originalExit;
		process.stderr.write = originalStderrWrite;
	}
}
for (const [flag, id, episode] of [
	['--srz', '12345', '4'],
	['--series', '67890', '7']
]) {
	const hidive = parse([flag, id, '--episode', episode], {}, undefined, false, false, 'hidive');
	assert.equal(hidive.srz, id, `${flag} is accepted by the HIDIVE parser`);
	assert.equal(hidive.e, episode, 'the selected episode is retained');
}
for (const flag of ['--series', '--srz', '-series', '-srz']) {
	for (const service of ['crunchy', 'hidive']) {
		const parsed = parse([flag, '12345'], {}, undefined, false, false, service);
		assert.equal(parsed.srz, '12345', `${flag} remains supported for ${service}`);
	}
}
for (const [flag, service] of [
	['--qall', 'hidive'],
	['-qall', 'adn'],
	['--no-qall', 'hidive'],
	['--tsd', 'adn'],
	['-tsd', 'hidive'],
	['--disctmr', 'adn'],
	['-disctmr', 'hidive'],
	['--bypasssync', 'adn'],
	['--combineLines', 'crunchy'],
	['--combineLines', 'adn'],
	['--rawoutput', 'hidive'],
	['--locale', 'hidive'],
	['--series', 'adn']
]) {
	const value = ['--disctmr', '-disctmr'].includes(flag) ? '0' : flag === '--rawoutput' ? 'fixture.txt' : flag === '--locale' ? 'fr' : flag === '--series' ? '12345' : undefined;
	const argv = [flag, ...(value === undefined ? [] : [value])];
	assert.throws(
		() => parse(argv, {}, undefined, false, false, service),
		(error) => {
			const reportedFlag = ['-qall', '--no-qall'].includes(flag) ? '--qall' : ['--disctmr', '-disctmr'].includes(flag) ? '--discovery-timmer' : flag;
			assert.match(error.message, new RegExp(`${reportedFlag} is unavailable with --service ${service}\\.`));
			assert.match(error.message, /Use --service (crunchy|hidive|adn)/i);
			return true;
		}
	);
}
assert.equal(parse(['--new'], {}, undefined, false, false, 'hidive').new, true, 'the unimplemented HIDIVE --new option remains accepted for its existing diagnostic');
assert.equal(parse(['--tsd'], {}, undefined, false, false, 'crunchy').tsd, true, 'a Crunchyroll-only option remains accepted for Crunchyroll');
assert.equal(parse(['--qall'], {}, undefined, false, false, 'crunchy').qall, true);
assert.equal(parse(['--no-qall'], {}, undefined, false, false, 'crunchy').qall, false);
assert.equal(parse(['--', '--tsd'], {}, undefined, false, false, 'hidive').tsd, false, 'an option-looking delimiter operand is not validated as a CLI option');
assert.equal(parse([], { qall: true }, undefined, false, false, 'hidive').qall, true, 'foreign service config defaults continue to parse');
assert.equal(parse(['--allDubs'], {}, undefined, false, false, 'adn').allDubs, true, 'shared all-service options remain valid');
assert(optionAppliesToService, 'module.args exports the applicability contract');
for (const [name, services] of [
	['qall', ['crunchy']],
	['series', ['crunchy', 'hidive']],
	['dlVideoOnce', ['crunchy', 'adn']],
	['auth', ['all']],
	['combineLines', ['hidive']],
	['rawoutput', ['crunchy']],
	['waittime', ['crunchy', 'adn']],
	['fontName', ['all']]
]) {
	const option = args.find((item) => item.name === name);
	assert.deepEqual(Array.from(option.service), services, `${name} declares its service scope`);
	assert.equal(optionAppliesToService(option), services.includes('all'), `${name} global applicability`);
	for (const service of ['crunchy', 'hidive', 'adn'])
		assert.equal(optionAppliesToService(option, service), services.includes('all') || services.includes(service), `${name} applicability for ${service}`);
}
for (const [flag, service] of [
	['--srz', 'hidive'],
	['--series', 'crunchy'],
	['-srz', 'crunchy'],
	['--dlVideoOnce', 'adn'],
	['--waittime', 'adn'],
	['--fontName', 'crunchy'],
	['--page', 'adn']
]) {
	const argument = ['--srz', '--series', '-srz'].includes(flag) ? '12345' : ['--waittime', '--page'].includes(flag) ? '0' : flag === '--fontName' ? 'Fixture Font' : undefined;
	const parsed = parse([flag, ...(argument === undefined ? [] : [argument])], {}, undefined, false, false, service);
	if (['--srz', '--series', '-srz'].includes(flag)) assert.equal(parsed.srz, '12345');
	else assert.equal(parsed[flag.slice(2)], flag === '--fontName' ? 'Fixture Font' : flag === '--dlVideoOnce' ? true : 0);
}
assert.equal(parse(['--device', 'android'], { token: 'configured-cookie' }).token, undefined);
assert.equal(parse(['--device=--token']).device, '--token');
assert.deepEqual(Array.from(parse([], { dubLang: ['eng,jpn', 'hin'] }).dubLang), ['eng', 'jpn', 'hin']);
assert.deepEqual(Array.from(parse(['--dubLang', 'zho,chi'], { dubLang: ['hindi'] }).dubLang), ['zho', 'chi']);
assert.deepEqual(Array.from(parse([], { dubLang: ['hindi'] }, { dubLang: ['eng', 'jpn'] }, true).dubLang), ['eng', 'jpn']);
assert.throws(() => parse(['--dubLang', 'eng,hindi', 'jpn,chin', 'hindi']), /exit 1: Invalid language tags for --dubLang: hindi, chin/);
assert.throws(() => parse([], { dubLang: ['hindi', 'chin'] }), /Invalid language tags for --dubLang: hindi, chin/);
assert.throws(() => parse([], {}, { dubLang: ['hindi', 'chin'] }, true), /Invalid language tags for --dubLang: hindi, chin/);
assert.throws(() => parse(['--dubLang', ' , ']), /Invalid language tags for --dubLang: <empty>/);
assert.deepEqual(Array.from(parse(['--downloadArchive'], { dubLang: ['hindi'] }, { dubLang: ['eng', 'jpn'] }).dubLang), ['eng', 'jpn']);
assert.deepEqual(Array.from(parse([], { dubLang: ['hindi'] }, undefined, false, true).dubLang), ['hindi'], 'stale GUI defaults do not preempt the queue selection');
assert.deepEqual(Array.from(parse(['--dubLang', 'eng,jpn', 'hin'], { dubLang: ['hindi'] }, undefined, false, true).dubLang), ['eng', 'jpn', 'hin']);
assert.deepEqual(Array.from(parse([], { dubLang: ['hindi'] }, { dubLang: ['eng', 'jpn'] }, false, true).dubLang), ['eng', 'jpn']);
assert.deepEqual(Array.from(parse([], { dubLang: ['hindi'] }, { dubLang: ['hindi', 'chin'] }, false, true).dubLang), ['hindi', 'chin']);

const parser = compile(
	'modules/module.app-args.ts',
	{
		'./module.args': { args, groups, configuredDefault, optionAppliesToService },
		'./module.crunchy-cli-auth': compile('modules/module.crunchy-cli-auth.ts'),
		'./log': { console: output },
		'./module.langsData': languageData,
		'../@types/enums': enums,
		'../package.json': { description: 'fixture CLI', version: '1.0.0' },
		leven: () => 99
	},
	{ process: { platform: 'darwin', argv: ['node', 'aniDL'] } }
);
assert.equal(parser.statusInvocation(['--service', 'crunchy', '--check-status']), 'valid');
assert.equal(parser.statusInvocation(['--check-status', '--debug', '--service=crunchy']), 'valid');
for (const extra of ['--help', '--version', '--tsd', '--dry-run', '--update', '--no-qall', '--qall=false', '--e=', 'unexpected'])
	assert.equal(parser.statusInvocation(['--service', 'crunchy', '--check-status', extra]), 'invalid');
assert.equal(parser.statusInvocation(['--check-status=false', '--service', 'crunchy']), 'invalid');
assert.equal(parser.statusInvocation(['--check-status', '--service', 'hidive']), 'invalid');
assert.equal(parse([], { 'check-status': true }).checkStatus, undefined);
assert.equal(parse(['--check-status'], { tsd: true, qall: true }).checkStatus, true);
assert.equal(parser.statusInvocation(['--service=crunchy', '--check-auth', '--debug'], '--check-auth'), 'valid');
for (const extra of ['--check-status', '--device', '--token', '--help', '--dry-run', '--update', '--check-auth'])
	assert.equal(parser.statusInvocation(['--service', 'crunchy', '--check-auth', extra], '--check-auth'), 'invalid');
assert.equal(parser.statusInvocation(['--check-auth=false', '--service', 'crunchy'], '--check-auth'), 'invalid');
assert.equal(parser.statusInvocation(['--check-auth', '--service', 'adn'], '--check-auth'), 'invalid');
assert.equal(parse([], { 'check-auth': true }).checkAuth, undefined);
assert.equal(parse(['--check-auth']).checkAuth, true);
assert.equal(parse([]).CC, true);
assert.equal(parse([], { CC: false }).CC, false);
for (const argv of [['--CC'], ['--CC', 'true'], ['--CC=true']]) assert.equal(parse(argv, { CC: false }).CC, true);
for (const argv of [['--CC', 'false'], ['--CC=false']]) assert.equal(parse(argv, { CC: true }).CC, false);
assert.equal(parse([], { CC: true }, { CC: false }).CC, false);
assert.equal(parse([], { CC: false }, { CC: true }).CC, true);
assert.equal(parse([], { CC: true }, { CC: false }, false, true).CC, false);
assert.throws(() => parse(['--CC', 'maybe']), /Invalid value for --CC: expected true or false/);
assert.throws(() => parse([], { CC: 'maybe' }), /Invalid value for --CC: expected true or false/);
for (const service of ['hidive', 'adn']) {
	const parsed = parse(['-s', '12345'], { CC: 'invalid' }, undefined, false, false, service);
	assert.equal(parsed.s, '12345', `${service} keeps parsing a download selector with a foreign CC setting`);
	assert.equal(parsed.CC, 'invalid', `${service} ignores Crunchyroll-only CC validation`);
	assert.equal(parse(['-s', '12345'], { disctmr: 'invalid' }, undefined, false, false, service).s, '12345');
	assert.throws(() => parse(['--disctmr', 'invalid'], {}, undefined, false, false, service), /--discovery-timmer is unavailable/);
}
assert.equal(parse([]).qall, false, 'qall is false by default');
assert.equal(parse([], { qall: true }).qall, true, 'qall can be enabled from the YAML config value');
assert.equal(parse(['--qall'], { qall: false }).qall, true);
assert.equal(parse(['-qall'], { qall: false }).qall, true, 'the existing short spelling normalization accepts -qall');
assert.equal(parse(['--qall=false'], { qall: true }).qall, false, 'an explicit false CLI value overrides config');
assert.equal(parse(['--no-qall'], { qall: true }).qall, false, 'Commander negation overrides config');
assert.equal(parse(['--qall=true'], { qall: false }).qall, true);
assert.equal(parse(['--qall=false', '--qall'], { qall: true }).qall, true, 'the last explicit option wins');
assert.equal(parse(['--qall', '--qall=false'], { qall: true }).qall, false);
assert.equal(parse(['--update']).update, true, 'the manual update flag remains accepted by the CLI parser');
assert.equal(parse(['-update']).update, true, 'the existing single-dash spelling remains accepted');
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
			'./module.args': { args, groups, configuredDefault, optionAppliesToService },
			'./module.crunchy-cli-auth': compile('modules/module.crunchy-cli-auth.ts'),
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
	assert.equal(text.includes('--check-auth'), crunchy);
	assert.equal(text.includes('--device'), crunchy);
	assert(text.includes('--dry-run'));
	assert(text.includes('--update'));
	assert(text.replace(/\s+/g, ' ').includes('Updates disabled on this fork. Download updates: https://github.com/XxUnkn0wnxX/multi-downloader-nx/releases/tag/nightly-fork'));
	if (crunchy) assert(text.includes('automatic per batch, or per request for multi-dub/--qall'));
	assert(text.includes('--help') && text.includes('--version'));
	assert(!text.includes('--no-qall'));
	if (!crunchy) assert(!text.includes('Crunchyroll CLI:'));
}
const generalHelp = help(['--help']);
const crunchyServiceHelp = help(['--service', 'crunchy', '--help']);
const hidiveServiceHelp = help(['--service', 'hidive', '--help']);
const adnServiceHelp = help(['--service', 'adn', '--help']);
const helpFlags = (text) => new Set(Array.from(text.matchAll(/(?:^|[^\w-])(--[\w-]+|-[A-Za-z])(?=$|[^\w-])/g), (match) => match[1]));
const helpsByService = { crunchy: crunchyServiceHelp, hidive: hidiveServiceHelp, adn: adnServiceHelp };
for (const option of args) {
	const flags = [`${option.name.length === 1 ? '-' : '--'}${option.name}`];
	if (option.alias) flags.push(`${option.alias.length === 1 ? '-' : '--'}${option.alias}`);
	for (const flag of flags) {
		assert.equal(helpFlags(generalHelp).has(flag), optionAppliesToService(option), `global help applicability for ${flag}`);
		for (const service of ['crunchy', 'hidive', 'adn'])
			assert.equal(helpFlags(helpsByService[service]).has(flag), optionAppliesToService(option, service), `${service} help applicability for ${flag}`);
	}
}
assert.match(crunchyServiceHelp, /--auth[\s\S]{0,100}Crunchyroll CLI: use --device or --token/);
for (const text of [generalHelp, hidiveServiceHelp, adnServiceHelp]) {
	assert.match(text, /--auth[\s\S]{0,140}Sign in with your username or email and password\s+\(HIDIVE and ADN\)/);
	assert(!text.includes('Crunchyroll CLI: use --device or --token'));
}
for (const flag of ['--srz', '--series']) {
	assert(helpFlags(crunchyServiceHelp).has(flag), `Crunchyroll help should include ${flag}`);
	assert(helpFlags(hidiveServiceHelp).has(flag), `HIDIVE help should include ${flag}`);
	assert(!helpFlags(generalHelp).has(flag), `general help should hide ${flag}`);
	assert(!helpFlags(adnServiceHelp).has(flag), `ADN help should hide ${flag}`);
}
for (const text of [generalHelp, crunchyServiceHelp, hidiveServiceHelp, adnServiceHelp]) assert(helpFlags(text).has('--allDubs'));
assert(helpFlags(crunchyServiceHelp).has('--dlVideoOnce'));
assert(helpFlags(adnServiceHelp).has('--dlVideoOnce'));
assert(!helpFlags(hidiveServiceHelp).has('--dlVideoOnce'));
assert(!helpFlags(generalHelp).has('--dlVideoOnce'));
const dubLangOption = args.find((option) => option.name === 'dubLang');
assert(dubLangOption?.sharedHelp);
for (const text of [generalHelp, hidiveServiceHelp, adnServiceHelp]) {
	assert(text.replace(/\s+/g, ' ').includes(dubLangOption.sharedHelp.replace(/\s+/g, ' ')));
	assert(!text.includes('Crunchy Only:'));
	assert(!text.includes('Direct episode-ID'));
	assert(!helpFlags(text).has('--extid'));
}
for (const hint of ['--srz', '--allDubs', '--extid']) assert(helpFlags(crunchyServiceHelp).has(hint));
const configuredHelp = help(['--help', '--service', 'crunchy'], { token: 'private-cookie', username: 'private-user', password: 'private-password' });
for (const value of ['private-cookie', 'private-user', 'private-password']) assert(!configuredHelp.includes(value));
output.log('ok - discovery timer, aliases, config precedence and service-aware help');

const referencePath = path.join(root, 'docs/ARGUMENTS.md');
const docs = fs.readFileSync(referencePath, 'utf8');
const headings = (text) => Array.from(text.matchAll(/^#### `([^`]+)`$/gm), (match) => match[1]);
const providerBlock = (text, service) => {
	const escaped = service.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = text.match(new RegExp(`<details>[\\s\\S]*?<summary>[^\\n]*--service ${escaped}[\\s\\S]*?<\\/summary>([\\s\\S]*?)<\\/details>`));
	assert(match, `reference should have an expandable ${service} options section`);
	return match[1];
};
const globalReference = docs.split(/<details>/)[0];
const providerReferences = Object.fromEntries(['crunchy', 'hidive', 'adn'].map((service) => [service, providerBlock(docs, service)]));
assert.match(providerReferences.crunchy, /`--service crunchy --device \[type\]`/);
for (const option of args) {
	const flag = (option.name.length === 1 ? '-' : '--') + option.name;
	assert.equal(headings(globalReference).includes(flag), optionAppliesToService(option), `global reference placement for ${flag}`);
	for (const service of ['crunchy', 'hidive', 'adn']) {
		const present = headings(providerReferences[service]).includes(flag);
		const expected = !optionAppliesToService(option) && optionAppliesToService(option, service);
		assert.equal(present, expected, `${flag} should ${expected ? '' : 'not '}appear in ${service} reference`);
	}
}
const section = (name, service = 'crunchy') => {
	const scope = service ? providerReferences[service] : globalReference;
	return scope.split(`#### \`${name}\``)[1]?.split('#### `')[0] ?? '';
};
assert.match(section('--discovery-timmer'), /`automatic`[\s\S]*`discovery-timmer: ` or `disctmr: `/);
assert.match(section('--dry-run', null), /`false`[\s\S]*`—`/);
for (const [name, service] of [
	['--username', 'hidive'],
	['--password', 'hidive'],
	['--token', 'crunchy'],
	['--forceMuxer', null]
]) {
	assert.match(section(name, service), /`undefined`/);
	assert(!section(name, service).includes('`automatic`'));
}
assert.equal((section('-x', null).match(/`x: ` or `server: `/g) ?? []).length, 1);
assert.match(section('--bypasssync'), /`bypasssync: `/);
assert(!docs.includes('#### `--forcevideo`'));
assert.match(section('--check-status'), /`—`/);
assert.match(section('--check-auth'), /`—`/);
assert.match(section('--vstream'), /`vstream: ` or `vs: `/);
assert.match(section('--astream'), /`astream: ` or `as: `/);

const serverOption = args.find((argument) => argument.name === 'x');
serverOption.default.name = 'server';
let generated = '';
try {
	compile('modules/build-docs.ts', {
		'../package.json': { name: 'fixture', version: '1', fork: { channel: 'Nightly', revision: 12 } },
		'./module.args': { args, groups, cliServices: ['crunchy', 'hidive', 'adn'], optionAppliesToService },
		'./module.fork-display': compile('modules/module.fork-display.ts'),
		fs: {
			writeFileSync: (outputPath, text) => {
				assert.equal(outputPath, referencePath, 'write the reference to its documented path');
				generated = text;
			}
		},
		path
	});
} finally {
	delete serverOption.default.name;
}
const generatedServer = generated.split('#### `-x`')[1].split('#### `')[0];
assert(generated.startsWith('# fixture v1 (Nightly) [Rev12]'));
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
