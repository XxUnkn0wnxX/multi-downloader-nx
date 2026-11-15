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
			console: output
		},
		{ filename: file }
	);
	return module.exports;
}

const { args, groups } = compile('modules/module.args.ts', {
	'./module.langsData': languageData,
	'../@types/enums': enums
});
const qallOption = args.find((arg) => arg.name === 'qall');
assert.equal(qallOption.default.default, false);
assert.deepEqual(Array.from(qallOption.service), ['crunchy']);
assert.equal(qallOption.type, 'boolean');
assert.match(qallOption.docDescribe, /does not reduce manifest discovery requests/);

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
			'./module.args': { args, groups },
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
