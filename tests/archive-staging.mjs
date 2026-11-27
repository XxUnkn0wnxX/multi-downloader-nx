import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'anidl-archive-staging-'));

try {
	fs.copyFileSync(path.join(root, '.gitignore'), path.join(fixture, '.gitignore'));
	fs.copyFileSync(path.join(root, 'tsc.ts'), path.join(fixture, 'tsc.ts'));
	fs.cpSync(fs.realpathSync(path.join(root, 'node_modules', 'ignore')), path.join(fixture, 'node_modules', 'ignore'), { recursive: true });

	const files = new Map([
		['docs/nested/guide.md', Buffer.from('# Fixture guide\n', 'utf8')],
		['docs/nested/reference.bin', Buffer.from([0, 255, 1, 128, 13, 10])],
		['docs/nested/ignored.log', Buffer.from('local diagnostic fixture', 'utf8')],
		['widevine/README.md', Buffer.from('# Public Widevine guide fixture\n', 'utf8')],
		['widevine/device-fixture.bin', Buffer.from([9, 0, 7])],
		['widevine/nested/arbitrary.txt', Buffer.from('synthetic private sibling', 'utf8')],
		['playready/arbitrary.bin', Buffer.from([3, 2, 1])],
		['playready/nested/fixture.txt', Buffer.from('synthetic private sibling', 'utf8')]
	]);
	for (const [relative, contents] of files) {
		const source = path.join(fixture, relative);
		fs.mkdirSync(path.dirname(source), { recursive: true });
		fs.writeFileSync(source, contents);
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

	for (const relative of ['docs/nested/guide.md', 'docs/nested/reference.bin', 'widevine/README.md']) {
		assert.deepEqual(fs.readFileSync(path.join(fixture, 'lib', relative)), files.get(relative), `${relative} should be copied byte-for-byte`);
	}
	for (const relative of ['docs/nested/ignored.log', 'widevine/device-fixture.bin', 'widevine/nested/arbitrary.txt', 'playready/arbitrary.bin', 'playready/nested/fixture.txt']) {
		assert.equal(fs.existsSync(path.join(fixture, 'lib', relative)), false, `${relative} should stay out of the staged application`);
	}
} finally {
	fs.rmSync(fixture, { recursive: true, force: true });
}

process.stdout.write('Archive staging fixtures passed.\n');
