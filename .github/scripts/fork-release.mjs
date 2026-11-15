import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import console from 'node:console';
import process from 'node:process';

const { fetch } = globalThis;

const platforms = ['windows', 'macos', 'linux', 'alpine'];
const architectures = ['x64', 'arm64'];
const shaPattern = /^[0-9a-f]{40}$/;
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

export function eligibleEvent(event, repository) {
	const run = event?.workflow_run;
	const workflow = event?.workflow;
	if (
		event?.action !== 'completed' ||
		event?.repository?.full_name !== repository ||
		workflow?.name !== 'Tests' ||
		workflow?.path !== '.github/workflows/test.yml' ||
		!positiveInteger(workflow?.id) ||
		run?.workflow_id !== workflow?.id ||
		run?.status !== 'completed' ||
		run?.conclusion !== 'success' ||
		!['push', 'workflow_dispatch'].includes(run?.event) ||
		run?.head_branch !== 'main' ||
		run?.head_repository?.full_name !== repository ||
		run?.repository?.full_name !== repository ||
		!shaPattern.test(run?.head_sha ?? '') ||
		!positiveInteger(run?.id) ||
		!positiveInteger(run?.run_attempt)
	)
		return null;
	return { sha: run.head_sha, testsRunId: run.id, testsAttempt: run.run_attempt };
}

export async function requireCurrentMain(repository, sha, api) {
	const ref = await api('GET', `/repos/${repository}/git/ref/heads/main`);
	if (ref?.object?.sha !== sha) throw new Error('Tested commit is no longer the current main head');
}

export function assetNames(arch) {
	if (!architectures.includes(arch)) throw new Error('Unsupported architecture');
	return platforms.map((platform) => `multi-downloader-nx-${platform}-${arch}-cli.7z`);
}

async function checksum(file) {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(file)) hash.update(chunk);
	return hash.digest('hex');
}

async function regularFile(file) {
	if (!(await lstat(file)).isFile()) throw new Error(`Not a regular file: ${file}`);
}

async function validateAssets(directory, arch) {
	const hashes = {};
	for (const name of assetNames(arch)) {
		const file = path.join(directory, name);
		const hashFile = `${file}.sha256`;
		await regularFile(file);
		await regularFile(hashFile);
		const expected = (await readFile(hashFile, 'utf8')).trim().match(/^([0-9a-f]{64}) ([^\r\n]+)$/);
		if (!expected || expected[2] !== name || expected[1] !== (await checksum(file))) throw new Error(`Checksum mismatch: ${name}`);
		hashes[name] = expected[1];
	}
	return hashes;
}

export async function recordBundle(source, destination, arch, provenance) {
	const hashes = await validateAssets(source, arch);
	await mkdir(destination, { recursive: true });
	for (const name of assetNames(arch)) {
		await copyFile(path.join(source, name), path.join(destination, name));
		await copyFile(path.join(source, `${name}.sha256`), path.join(destination, `${name}.sha256`));
	}
	await writeFile(path.join(destination, 'provenance.json'), JSON.stringify({ ...provenance, arch, hashes }, null, 2) + '\n');
}

export async function verifyBundles(directory, provenance) {
	const files = [];
	for (const arch of architectures) {
		const dir = path.join(directory, arch);
		const expectedNames = [...assetNames(arch).flatMap((name) => [name, `${name}.sha256`]), 'provenance.json'].sort();
		const actualNames = (await readdir(dir)).sort();
		if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) throw new Error(`Incomplete or unexpected ${arch} bundle`);
		await regularFile(path.join(dir, 'provenance.json'));
		const receipt = JSON.parse(await readFile(path.join(dir, 'provenance.json'), 'utf8'));
		const { buildAttempt, ...identity } = provenance;
		for (const [key, value] of Object.entries({ ...identity, arch })) {
			if (receipt[key] !== value) throw new Error(`Wrong ${arch} provenance: ${key}`);
		}
		if (!positiveInteger(receipt.buildAttempt) || receipt.buildAttempt > buildAttempt) throw new Error(`Wrong ${arch} provenance: buildAttempt`);
		const hashes = await validateAssets(dir, arch);
		if (JSON.stringify(receipt.hashes) !== JSON.stringify(hashes)) throw new Error(`Wrong ${arch} provenance hashes`);
		files.push(...assetNames(arch).flatMap((name) => [path.join(dir, name), path.join(dir, `${name}.sha256`)]));
	}
	return files;
}

function workflowProvenance(env) {
	const number = (value) => Number(value);
	const result = {
		sha: env.TESTED_SHA,
		testsRunId: number(env.TESTS_RUN_ID),
		testsAttempt: number(env.TESTS_ATTEMPT),
		buildRunId: number(env.GITHUB_RUN_ID),
		buildAttempt: number(env.GITHUB_RUN_ATTEMPT)
	};
	if (!shaPattern.test(result.sha ?? '') || ![result.testsRunId, result.testsAttempt, result.buildRunId, result.buildAttempt].every(positiveInteger)) {
		throw new Error('Invalid workflow provenance');
	}
	return result;
}

async function githubApi(method, endpoint, body, allowMissing = false) {
	const response = await fetch(`${process.env.GITHUB_API_URL}${endpoint}`, {
		method,
		signal: globalThis.AbortSignal.timeout(30000),
		headers: {
			authorization: `Bearer ${process.env.GH_TOKEN}`,
			accept: 'application/vnd.github+json',
			'content-type': 'application/json',
			'x-github-api-version': '2022-11-28'
		},
		...(body ? { body: JSON.stringify(body) } : {})
	});
	if (allowMissing && response.status === 404) return null;
	if (!response.ok) throw new Error(`GitHub API ${method} ${endpoint} failed: ${response.status} ${await response.text()}`);
	return response.json();
}

async function findRelease(base, api) {
	const published = await api('GET', `${base}/releases/tags/nightly-fork`, undefined, true);
	if (published) return published;
	let found = null;
	for (let page = 1; ; page++) {
		const releases = await api('GET', `${base}/releases?per_page=100&page=${page}`);
		if (!Array.isArray(releases)) throw new Error('Unexpected release listing');
		for (const release of releases) {
			if (release.draft && release.tag_name === 'nightly-fork') {
				if (found) throw new Error('Multiple Nightly Fork drafts found');
				found = release;
			}
		}
		if (releases.length < 100) return found;
	}
}

export async function publish(directory, provenance, repository, api = githubApi, uploadAssets = uploadReleaseAssets, server = process.env.GITHUB_SERVER_URL) {
	const files = await verifyBundles(directory, provenance);
	const base = `/repos/${repository}`;
	let release = await findRelease(base, api);
	await requireCurrentMain(repository, provenance.sha, api);
	if (!release) {
		release = await api('POST', `${base}/releases`, {
			tag_name: 'nightly-fork',
			target_commitish: provenance.sha,
			name: 'Nightly Fork',
			body: 'Asset upload in progress.',
			draft: true,
			prerelease: true
		});
	}
	if (!positiveInteger(release.id)) throw new Error('Invalid release ID');
	await uploadAssets(files, repository);
	const tag = await api('GET', `${base}/git/ref/tags/nightly-fork`, undefined, true);
	await requireCurrentMain(repository, provenance.sha, api);
	if (tag) await api('PATCH', `${base}/git/refs/tags/nightly-fork`, { sha: provenance.sha, force: true });
	else await api('POST', `${base}/git/refs`, { ref: 'refs/tags/nightly-fork', sha: provenance.sha });
	const url = `${server}/${repository}`;
	const body = `Source: [${provenance.sha}](${url}/commit/${provenance.sha})\n\nTests: [run ${provenance.testsRunId}, attempt ${provenance.testsAttempt}](${url}/actions/runs/${provenance.testsRunId}/attempts/${provenance.testsAttempt})\n\nBuild: [run ${provenance.buildRunId}](${url}/actions/runs/${provenance.buildRunId}) (publication attempt ${provenance.buildAttempt})\n\n[Changelog](${url}/blob/${provenance.sha}/docs/CHANGELOG.md)`;
	await api('PATCH', `${base}/releases/${release.id}`, { tag_name: 'nightly-fork', name: 'Nightly Fork', body, prerelease: true, draft: false });
}

function uploadReleaseAssets(files, repository) {
	const upload = spawnSync('gh', ['release', 'upload', 'nightly-fork', ...files, '--clobber', '--repo', repository], { stdio: 'inherit' });
	if (upload.error || upload.status !== 0) throw new Error('Release asset replacement failed; workflow artifacts remain available');
}

async function main() {
	const command = process.argv[2];
	if (command === 'gate') {
		const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
		const selected = eligibleEvent(event, process.env.GITHUB_REPOSITORY);
		if (!selected) {
			await appendFile(process.env.GITHUB_OUTPUT, 'eligible=false\n');
			return;
		}
		await requireCurrentMain(process.env.GITHUB_REPOSITORY, selected.sha, githubApi);
		await appendFile(process.env.GITHUB_OUTPUT, `eligible=true\nsha=${selected.sha}\ntests_run_id=${selected.testsRunId}\ntests_attempt=${selected.testsAttempt}\n`);
	} else if (command === 'current-main') {
		const { sha } = workflowProvenance(process.env);
		await requireCurrentMain(process.env.GITHUB_REPOSITORY, sha, githubApi);
	} else if (command === 'record') {
		await recordBundle(process.argv[3], process.argv[4], process.argv[5], workflowProvenance(process.env));
	} else if (command === 'publish') {
		await publish(process.argv[3], workflowProvenance(process.env), process.env.GITHUB_REPOSITORY);
	} else throw new Error('Unknown command');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
