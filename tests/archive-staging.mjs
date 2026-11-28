import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { require as requireTs } from 'tsx/cjs/api';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { copyReleaseDocs } = requireTs('../modules/module.archive-docs.ts', import.meta.url);
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'anidl-archive-staging-'));

try {
	fs.copyFileSync(path.join(root, '.gitignore'), path.join(fixture, '.gitignore'));
	fs.copyFileSync(path.join(root, 'tsc.ts'), path.join(fixture, 'tsc.ts'));
	fs.cpSync(fs.realpathSync(path.join(root, 'node_modules', 'ignore')), path.join(fixture, 'node_modules', 'ignore'), { recursive: true });
	fs.mkdirSync(path.join(fixture, 'modules'), { recursive: true });
	fs.copyFileSync(path.join(root, 'modules', 'module.archive-docs.ts'), path.join(fixture, 'modules', 'module.archive-docs.ts'));

	const files = new Map([
		['docs/nested/guide.md', Buffer.from('# Fixture guide\n', 'utf8')],
		['docs/nested/reference.bin', Buffer.from([0, 255, 1, 128, 13, 10])],
		['docs/nested/asset.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>\n', 'utf8')],
		['docs/nested/ignored.log', Buffer.from('local diagnostic fixture', 'utf8')],
		['docs/nested/license.wvd', Buffer.from('synthetic sidecar', 'utf8')],
		['docs/nested/certificate.CeRt', Buffer.from('synthetic sidecar', 'utf8')],
		['docs/nested/private.PeM', Buffer.from('synthetic sidecar', 'utf8')],
		['widevine/README.md', Buffer.from('# Public Widevine guide fixture\n', 'utf8')],
		['widevine/guide.md', Buffer.from('# Second public guide fixture\n', 'utf8')],
		['widevine/.private.md', Buffer.from('hidden markdown fixture', 'utf8')],
		['widevine/nested/nested-guide.md', Buffer.from('nested markdown fixture', 'utf8')],
		['widevine/device-fixture.bin', Buffer.from([9, 0, 7])],
		['widevine/device.wvd', Buffer.from('synthetic sidecar', 'utf8')],
		['widevine/certificate.CERT', Buffer.from('synthetic sidecar', 'utf8')],
		['widevine/private.PEM', Buffer.from('synthetic sidecar', 'utf8')],
		['widevine/nested/arbitrary.txt', Buffer.from('synthetic private sibling', 'utf8')],
		['playready/arbitrary.bin', Buffer.from([3, 2, 1])],
		['playready/device.WvD', Buffer.from('synthetic sidecar', 'utf8')],
		['playready/certificate.cert', Buffer.from('synthetic sidecar', 'utf8')],
		['playready/private.pem', Buffer.from('synthetic sidecar', 'utf8')],
		['playready/nested/fixture.txt', Buffer.from('synthetic private sibling', 'utf8')]
	]);
	for (const [relative, contents] of files) {
		const source = path.join(fixture, relative);
		fs.mkdirSync(path.dirname(source), { recursive: true });
		fs.writeFileSync(source, contents);
	}

	const links = ['docs/nested/misleading-guide.md', 'widevine/misleading-guide.md'];
	for (const relative of links) {
		try {
			fs.symlinkSync(path.join(fixture, 'widevine', 'private.PEM'), path.join(fixture, relative), 'file');
		} catch (error) {
			if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
		}
	}

	const bin = path.join(fixture, 'test-bin');
	fs.mkdirSync(bin);
	if (process.platform === 'win32') {
		fs.writeFileSync(path.join(bin, 'npx.cmd'), '@exit /b 0\r\n');
	} else {
		const fakeNpx = path.join(bin, 'npx');
		fs.writeFileSync(fakeNpx, '#!/usr/bin/env node\nprocess.exit(0);\n');
		fs.chmodSync(fakeNpx, 0o755);
	}

	const cli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
	execFileSync(process.execPath, [cli, path.join(fixture, 'tsc.ts'), 'test', 'false'], {
		cwd: fixture,
		stdio: 'pipe',
		env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` }
	});

	const publicFiles = new Set(['docs/nested/guide.md', 'docs/nested/reference.bin', 'docs/nested/asset.svg', 'widevine/README.md', 'widevine/guide.md']);
	for (const [relative, contents] of files) {
		const staged = path.join(fixture, 'lib', relative);
		if (publicFiles.has(relative)) assert.deepEqual(fs.readFileSync(staged), contents, relative);
		else assert.equal(fs.lstatSync(staged, { throwIfNoEntry: false }), undefined, relative);
	}
	for (const relative of links) assert.equal(fs.lstatSync(path.join(fixture, 'lib', relative), { throwIfNoEntry: false }), undefined, relative);

	// Exercise final packaging with unfiltered inputs, including files introduced after staging.
	fs.writeFileSync(path.join(fixture, 'LICENSE.md'), 'Fixture license');
	const bundle = path.join(fixture, 'bundle');
	copyReleaseDocs(fixture, bundle);
	for (const relative of publicFiles) assert.deepEqual(fs.readFileSync(path.join(bundle, relative)), files.get(relative), relative);
	assert.deepEqual(fs.readdirSync(path.join(bundle, 'widevine')).sort(), ['README.md', 'guide.md']);
	assert.equal(fs.readFileSync(path.join(bundle, 'docs', 'LICENSE.md'), 'utf8'), 'Fixture license');
	for (const relative of [...links, ...Array.from(files.keys()).filter((file) => /\.(?:wvd|cert|pem)$/i.test(file))]) {
		assert.equal(fs.lstatSync(path.join(bundle, relative), { throwIfNoEntry: false }), undefined, relative);
	}
	if (fs.lstatSync(path.join(fixture, links[0]), { throwIfNoEntry: false })?.isSymbolicLink()) {
		fs.renameSync(path.join(fixture, 'docs'), path.join(fixture, 'original-docs'));
		fs.symlinkSync(path.join(fixture, 'original-docs'), path.join(fixture, 'docs'), 'junction');
		assert.throws(() => copyReleaseDocs(fixture, path.join(fixture, 'invalid-bundle')), /public docs directory/);
	}
} finally {
	fs.rmSync(fixture, { recursive: true, force: true });
}

process.stdout.write('Archive staging fixtures passed.\n');
