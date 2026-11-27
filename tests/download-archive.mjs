import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeRequire = createRequire(import.meta.url);
const filename = path.join(root, 'modules/module.downloadArchive.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
	compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;

function loadArchive(directory) {
	const module = { exports: {} };
	vm.runInNewContext(
		compiled,
		{
			module,
			exports: module.exports,
			require: (id) => (id === './module.cfg-loader' ? { workingDir: directory } : nativeRequire(id)),
			__dirname: path.dirname(filename),
			__filename: filename
		},
		{ filename }
	);
	return module.exports;
}

const snapshot = (value) => JSON.parse(JSON.stringify(value));
const withArchive = (fn) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anidl-download-archive-'));
	fs.mkdirSync(path.join(directory, 'config'));
	try {
		fn(loadArchive(directory), path.join(directory, 'config/archive.json'));
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
};
const writeArchive = (archiveFile, data) => fs.writeFileSync(archiveFile, JSON.stringify(data, null, 4));
const readArchive = (archiveFile) => JSON.parse(fs.readFileSync(archiveFile, 'utf8'));

withArchive((archive) => {
	for (const service of ['crunchy', 'hidive', 'adn']) assert.deepEqual(snapshot(archive.makeCommand(service)), [], `${service} handles a missing archive`);
});

for (const content of ['', '{ malformed nonempty JSON']) {
	withArchive((archive, archiveFile) => {
		fs.writeFileSync(archiveFile, content);
		if (content)
			assert.throws(
				() => archive.makeCommand('hidive'),
				(error) => error.name === 'SyntaxError',
				'reject malformed archive JSON'
			);
		else assert.deepEqual(snapshot(archive.makeCommand('hidive')), [], 'a blank archive has no commands');
		assert.equal(fs.readFileSync(archiveFile, 'utf8'), content, 'reading an invalid archive preserves its contents');
	});
}

withArchive((archive, archiveFile) => {
	const existing = { crunchy: { s: [{ id: '120', already: ['4'] }], srz: [{ id: '901', already: ['3'] }] } };
	writeArchive(archiveFile, existing);
	assert.deepEqual(snapshot(archive.makeCommand('hidive')), [], 'a missing provider is empty when another provider has entries');
	assert.deepEqual(snapshot(archive.makeCommand('adn')), [], 'a second missing provider is empty');
	assert.deepEqual(readArchive(archiveFile), existing, 'reading a missing service does not rewrite the other service');
});

for (const [service, data] of [
	['hidive', { hidive: {} }],
	['hidive', { hidive: { s: [] } }],
	['adn', { adn: {} }],
	['adn', { adn: { s: [] } }],
	['crunchy', { crunchy: {} }],
	['crunchy', { crunchy: { s: [], srz: [] } }]
]) {
	withArchive((archive, archiveFile) => {
		writeArchive(archiveFile, data);
		assert.deepEqual(snapshot(archive.makeCommand(service)), [], `${service} handles an empty service shape ${JSON.stringify(data)}`);
	});
}

withArchive((archive, archiveFile) => {
	const initial = {
		hidive: {
			s: [
				{ id: 'previous-0', already: ['1'] },
				{ id: 'previous-1', already: ['2'] },
				{ id: '901', already: ['8'] }
			]
		},
		adn: { s: [{ id: 'adn-season', already: ['6'] }] },
		crunchy: {
			s: [{ id: 'cr-season', already: ['5'] }],
			srz: [{ id: 'cr-series', already: ['7'] }]
		}
	};
	writeArchive(archiveFile, initial);

	archive.downloaded({ service: 'hidive', type: 's' }, '1', ['4']);
	archive.addToArchive({ service: 'hidive', type: 's' }, '120');
	archive.downloaded({ service: 'hidive', type: 's' }, '120', ['4']);
	archive.downloaded({ service: 'hidive', type: 's' }, '120', ['4']);
	archive.addToArchive({ service: 'hidive', type: 's' }, '120');

	const finalData = readArchive(archiveFile);
	assert.deepEqual(
		finalData.hidive.s,
		[
			{ id: 'previous-0', already: ['1'] },
			{ id: 'previous-1', already: ['2'] },
			{ id: '901', already: ['8'] },
			{ id: '1', already: ['4'] },
			{ id: '120', already: ['4'] }
		],
		'numeric ID 1 is matched by entry ID, completion is idempotent, and existing ambiguous IDs are preserved'
	);
	assert.deepEqual(finalData.adn, initial.adn, 'HIDIVE writes retain ADN data');
	assert.deepEqual(finalData.crunchy, initial.crunchy, 'HIDIVE writes retain both Crunchyroll season and series lists');
	assert.deepEqual(
		snapshot(archive.makeCommand('crunchy')),
		[
			{ but: true, all: false, service: 'crunchy', e: '5', s: 'cr-season' },
			{ but: true, all: false, service: 'crunchy', e: '7', series: 'cr-series' }
		],
		'Crunchyroll keeps season and series archive commands distinct'
	);
	assert.deepEqual(snapshot(archive.makeCommand('hidive')), [
		{ but: true, all: false, service: 'hidive', e: '1', s: 'previous-0' },
		{ but: true, all: false, service: 'hidive', e: '2', s: 'previous-1' },
		{ but: true, all: false, service: 'hidive', e: '8', s: '901' },
		{ but: true, all: false, service: 'hidive', e: '4', s: '1' },
		{ but: true, all: false, service: 'hidive', e: '4', s: '120' }
	]);
	archive.addToArchive({ service: 'crunchy', type: 's' }, 'new-season');
	archive.addToArchive({ service: 'crunchy', type: 'srz' }, 'new-series');
	archive.addToArchive({ service: 'crunchy', type: 's' }, 'new-season');
	assert.deepEqual(
		readArchive(archiveFile).crunchy,
		{
			s: [
				{ id: 'cr-season', already: ['5'] },
				{ id: 'new-season', already: [] }
			],
			srz: [
				{ id: 'cr-series', already: ['7'] },
				{ id: 'new-series', already: [] }
			]
		},
		'Crunchyroll add-archive retains both existing lists and deduplicates repeated season/series additions'
	);
});
