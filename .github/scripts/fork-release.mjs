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
	return { sha: run.head_sha, testedSha: run.head_sha, testsRunId: run.id, testsAttempt: run.run_attempt };
}

async function currentMain(repository, api) {
	const ref = await api('GET', `/repos/${repository}/git/ref/heads/main`);
	if (!shaPattern.test(ref?.object?.sha ?? '')) throw new Error('Cannot verify current main head');
	return ref.object.sha;
}

export async function requireCurrentMain(repository, sha, api) {
	if ((await currentMain(repository, api)) !== sha) throw new Error('Target commit is no longer the current main head');
}

const HISTORY_PAGE_SIZE = 100;
const HISTORY_LIMIT = 500;
const isDocument = (name) => typeof name === 'string' && name.length > 0 && (name.startsWith('docs/') || name.endsWith('.md'));
const releaseOnlyFiles = new Set(['.github/scripts/fork-release.mjs', 'tests/fork-release.mjs']);
const isReusableChange = (name) => isDocument(name) || releaseOnlyFiles.has(name);

export async function reusableProofDescendant(repository, testedSha, targetSha, api) {
	if (testedSha === targetSha) return true;
	const comparison = await api('GET', `/repos/${repository}/compare/${testedSha}...${targetSha}?per_page=1&page=1`);
	if (!comparison || typeof comparison.status !== 'string' || !comparison.merge_base_commit || !Number.isSafeInteger(comparison.behind_by) || !Array.isArray(comparison.files)) {
		throw new Error('Cannot prove reusable Tests comparison: malformed response');
	}
	if (comparison.files.length >= 300) throw new Error('Cannot prove reusable Tests comparison: 300-file limit reached');
	if (comparison.status !== 'ahead' || comparison.merge_base_commit.sha !== testedSha || comparison.behind_by !== 0) return false;
	for (const file of comparison.files) {
		if (
			!file ||
			typeof file.filename !== 'string' ||
			!file.filename ||
			!['added', 'removed', 'modified', 'renamed', 'changed', 'copied', 'unchanged'].includes(file.status) ||
			(file.status === 'renamed' && (typeof file.previous_filename !== 'string' || !file.previous_filename)) ||
			(file.previous_filename !== undefined && (typeof file.previous_filename !== 'string' || !file.previous_filename))
		) {
			throw new Error('Cannot prove reusable Tests comparison: malformed file');
		}
		if (!isReusableChange(file.filename) || (file.previous_filename !== undefined && !isReusableChange(file.previous_filename))) return false;
		if ((releaseOnlyFiles.has(file.filename) || releaseOnlyFiles.has(file.previous_filename)) && file.status !== 'modified') return false;
	}
	return true;
}

function relevantRun(run, workflowId, repository) {
	return (
		run?.workflow_id === workflowId &&
		run.head_branch === 'main' &&
		['push', 'workflow_dispatch'].includes(run.event) &&
		run.repository?.full_name === repository &&
		run.head_repository?.full_name === repository &&
		shaPattern.test(run.head_sha ?? '') &&
		positiveInteger(run.id) &&
		positiveInteger(run.run_attempt)
	);
}

async function readHistory(base, workflowId, api) {
	const runs = [];
	let total;
	for (let page = 1; page <= HISTORY_LIMIT / HISTORY_PAGE_SIZE; page++) {
		const result = await api('GET', `${base}/actions/workflows/${workflowId}/runs?branch=main&per_page=${HISTORY_PAGE_SIZE}&page=${page}`);
		if (!result || !Array.isArray(result.workflow_runs) || !Number.isSafeInteger(result.total_count) || result.total_count < 0)
			throw new Error('Cannot verify Tests history: malformed response');
		if (total !== undefined && total !== result.total_count) throw new Error('Tests history changed during pagination; retry the release');
		total = result.total_count;
		if (total > HISTORY_LIMIT) throw new Error(`Cannot verify Tests history: ${HISTORY_LIMIT}-run limit exceeded`);
		runs.push(...result.workflow_runs);
		if (runs.length >= total || result.workflow_runs.length < HISTORY_PAGE_SIZE) break;
	}
	if (runs.length !== total || new Set(runs.map((run) => run.id)).size !== runs.length) throw new Error('Incomplete or changing Tests history; retry the release');
	return runs;
}

function historySnapshot(runs) {
	return JSON.stringify(
		runs
			.map((run) => ({
				id: run.id,
				workflow_id: run.workflow_id,
				head_sha: run.head_sha,
				head_branch: run.head_branch,
				event: run.event,
				repository: run.repository?.full_name,
				head_repository: run.head_repository?.full_name,
				run_attempt: run.run_attempt,
				run_started_at: run.run_started_at,
				created_at: run.created_at,
				status: run.status,
				conclusion: run.conclusion
			}))
			.sort((a, b) => a.id - b.id)
	);
}

export async function latestApplicableProof(repository, targetSha, api) {
	const base = `/repos/${repository}`;
	const workflow = await api('GET', `${base}/actions/workflows/test.yml`);
	if (workflow?.name !== 'Tests' || workflow?.path !== '.github/workflows/test.yml' || !positiveInteger(workflow.id)) throw new Error('Cannot verify expected Tests workflow');
	const runs = await readHistory(base, workflow.id, api);
	const snapshot = historySnapshot(runs);
	const candidates = [];
	for (const run of runs.filter((entry) => relevantRun(entry, workflow.id, repository))) {
		const time = run.run_started_at ?? (run.run_attempt === 1 && run.status !== 'completed' ? run.created_at : null);
		if (typeof time !== 'string' || !Number.isFinite(Date.parse(time))) {
			if (await reusableProofDescendant(repository, run.head_sha, targetSha, api)) throw new Error('Cannot order applicable Tests attempt: missing activity time');
			continue;
		}
		candidates.push({ run, time: Date.parse(time) });
	}
	candidates.sort((a, b) => b.time - a.time || a.run.id - b.run.id);
	for (let i = 0; i < candidates.length;) {
		const time = candidates[i].time;
		const applicable = [];
		while (i < candidates.length && candidates[i].time === time) {
			const run = candidates[i++].run;
			if (await reusableProofDescendant(repository, run.head_sha, targetSha, api)) applicable.push(run);
		}
		if (!applicable.length) continue;
		for (const run of applicable) {
			const fresh = await api('GET', `${base}/actions/runs/${run.id}`);
			if (!relevantRun(fresh, workflow.id, repository) || historySnapshot([fresh]) !== historySnapshot([run]))
				throw new Error('Tests attempt changed during proof; retry the release');
			if (fresh.status !== 'completed') throw new Error('Latest applicable Tests attempt is still running or pending');
			if (fresh.conclusion !== 'success') throw new Error(`Latest applicable Tests attempt did not succeed: ${fresh.conclusion}`);
		}
		if (snapshot !== historySnapshot(await readHistory(base, workflow.id, api))) throw new Error('Tests history changed during proof; retry the release');
		const selected = applicable[0];
		return { sha: targetSha, testedSha: selected.head_sha, testsRunId: selected.id, testsAttempt: selected.run_attempt };
	}
	throw new Error('No successful applicable Tests run found for target main commit');
}

export async function selectGate({ eventName, event, ref, sha, repository }, api) {
	if (eventName === 'workflow_dispatch') {
		if (ref !== 'refs/heads/main' || !shaPattern.test(sha ?? '')) throw new Error('Manual release requires main');
		await requireCurrentMain(repository, sha, api);
		const selected = await latestApplicableProof(repository, sha, api);
		await requireCurrentMain(repository, sha, api);
		return selected;
	}
	if (eventName !== 'workflow_run') throw new Error('Unsupported release event');
	const selected = eligibleEvent(event, repository);
	if (!selected) return null;
	if ((await currentMain(repository, api)) !== selected.sha) return { skipReason: 'Tests commit is no longer current main; skipping automatic release' };
	return selected;
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
		sha: env.TARGET_SHA,
		testedSha: env.TESTED_SHA,
		testsRunId: number(env.TESTS_RUN_ID),
		testsAttempt: number(env.TESTS_ATTEMPT),
		buildRunId: number(env.GITHUB_RUN_ID),
		buildAttempt: number(env.GITHUB_RUN_ATTEMPT)
	};
	if (
		!shaPattern.test(result.sha ?? '') ||
		!shaPattern.test(result.testedSha ?? '') ||
		![result.testsRunId, result.testsAttempt, result.buildRunId, result.buildAttempt].every(positiveInteger)
	) {
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
	if (response.status === 204) return null;
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

export async function publish(
	directory,
	provenance,
	repository,
	api = githubApi,
	uploadAssets = uploadReleaseAssets,
	server = process.env.GITHUB_SERVER_URL,
	proof = latestApplicableProof
) {
	const files = await verifyBundles(directory, provenance);
	const base = `/repos/${repository}`;
	const oldRelease = await findRelease(base, api);
	await proof(repository, provenance.sha, api);
	await requireCurrentMain(repository, provenance.sha, api);
	if (oldRelease) {
		if (!positiveInteger(oldRelease.id)) throw new Error('Invalid existing release ID');
		await api('DELETE', `${base}/releases/${oldRelease.id}`);
	}
	const release = await api('POST', `${base}/releases`, {
		tag_name: 'nightly-fork',
		target_commitish: provenance.sha,
		name: 'Nightly Fork',
		body: 'Asset upload in progress.',
		draft: true,
		prerelease: false
	});
	if (!positiveInteger(release.id)) throw new Error('Invalid release ID');
	await uploadAssets(files, repository);
	const tag = await api('GET', `${base}/git/ref/tags/nightly-fork`, undefined, true);
	await proof(repository, provenance.sha, api);
	await requireCurrentMain(repository, provenance.sha, api);
	if (tag) await api('PATCH', `${base}/git/refs/tags/nightly-fork`, { sha: provenance.sha, force: true });
	else await api('POST', `${base}/git/refs`, { ref: 'refs/tags/nightly-fork', sha: provenance.sha });
	const url = `${server}/${repository}`;
	const testedCommit = provenance.testedSha === provenance.sha ? '' : ` (tested ancestor: [${provenance.testedSha}](${url}/commit/${provenance.testedSha}))`;
	const body = `Source: [${provenance.sha}](${url}/commit/${provenance.sha})\n\nTests: [run ${provenance.testsRunId}, attempt ${provenance.testsAttempt}](${url}/actions/runs/${provenance.testsRunId}/attempts/${provenance.testsAttempt})${testedCommit}\n\nBuild: [run ${provenance.buildRunId}](${url}/actions/runs/${provenance.buildRunId}) (publication attempt ${provenance.buildAttempt})\n\n[Changelog](${url}/blob/${provenance.sha}/docs/CHANGELOG.md)`;
	await api('PATCH', `${base}/releases/${release.id}`, { tag_name: 'nightly-fork', name: 'Nightly Fork', body, prerelease: false, draft: false, make_latest: 'true' });
}

function uploadReleaseAssets(files, repository) {
	const upload = spawnSync('gh', ['release', 'upload', 'nightly-fork', ...files, '--repo', repository], { stdio: 'inherit' });
	if (upload.error || upload.status !== 0) throw new Error('Release asset upload failed; workflow artifacts remain available');
}

async function main() {
	const command = process.argv[2];
	if (command === 'gate') {
		const eventName = process.env.GITHUB_EVENT_NAME;
		const event = eventName === 'workflow_run' ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) : null;
		const selected = await selectGate({ eventName, event, ref: process.env.GITHUB_REF, sha: process.env.GITHUB_SHA, repository: process.env.GITHUB_REPOSITORY }, githubApi);
		if (!selected || selected.skipReason) {
			if (selected?.skipReason) console.info(selected.skipReason);
			await appendFile(process.env.GITHUB_OUTPUT, 'eligible=false\n');
			return;
		}
		await appendFile(
			process.env.GITHUB_OUTPUT,
			`eligible=true\nsha=${selected.sha}\ntested_sha=${selected.testedSha}\ntests_run_id=${selected.testsRunId}\ntests_attempt=${selected.testsAttempt}\n`
		);
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
