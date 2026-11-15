import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import console from 'node:console';
import { assetNames, eligibleEvent, publish, recordBundle, requireCurrentMain, verifyBundles } from '../.github/scripts/fork-release.mjs';

const repo = 'owner/repository';
const sha = 'a'.repeat(40);
const base = {
	action: 'completed',
	repository: { full_name: repo },
	workflow: { id: 7, name: 'Tests', path: '.github/workflows/test.yml' },
	workflow_run: {
		workflow_id: 7,
		status: 'completed',
		conclusion: 'success',
		event: 'push',
		head_branch: 'main',
		head_repository: { full_name: repo },
		repository: { full_name: repo },
		head_sha: sha,
		id: 101,
		run_attempt: 2
	}
};
const selected = { sha, testsRunId: 101, testsAttempt: 2 };
assert.deepEqual(eligibleEvent(base, repo), selected);
const changed = (part, values) => ({ ...base, [part]: { ...base[part], ...values } });
assert.deepEqual(eligibleEvent(changed('workflow_run', { event: 'workflow_dispatch' }), repo), selected);
for (const event of [
	{ ...base, action: 'requested' },
	changed('repository', { full_name: 'other/repository' }),
	changed('workflow', { path: '.github/workflows/other.yml' }),
	changed('workflow', { id: undefined }),
	changed('workflow_run', { workflow_id: 8 }),
	...['failure', 'cancelled'].map((conclusion) => changed('workflow_run', { conclusion })),
	changed('workflow_run', { status: 'in_progress' }),
	changed('workflow_run', { event: 'pull_request' }),
	changed('workflow_run', { head_branch: 'develop' }),
	changed('workflow_run', { head_repository: { full_name: 'fork/repository' } }),
	changed('workflow_run', { repository: { full_name: 'fork/repository' } }),
	changed('workflow_run', { head_sha: 'bad' }),
	changed('workflow_run', { id: 0 }),
	changed('workflow_run', { run_attempt: 0 })
])
	assert.equal(eligibleEvent(event, repo), null);

const calls = [];
const api = async (method, endpoint) => {
	calls.push([method, endpoint]);
	return { object: { sha } };
};
await requireCurrentMain(repo, sha, api);
assert.deepEqual(calls, [['GET', '/repos/owner/repository/git/ref/heads/main']]);
await assert.rejects(
	requireCurrentMain(repo, sha, async () => ({ object: { sha: 'b'.repeat(40) } })),
	/no longer/
);
await assert.rejects(
	requireCurrentMain(repo, sha, async () => {
		throw new Error('unavailable');
	}),
	/unavailable/
);

const root = await mkdtemp(path.join(os.tmpdir(), 'fork-release-test-'));
const provenance = { ...selected, buildRunId: 202, buildAttempt: 3 };
try {
	for (const arch of ['x64', 'arm64']) {
		const source = path.join(root, 'source', arch);
		await mkdir(source, { recursive: true });
		for (const name of assetNames(arch)) {
			const data = `fixture ${name}`;
			await writeFile(path.join(source, name), data);
			await writeFile(path.join(source, `${name}.sha256`), `${createHash('sha256').update(data).digest('hex')} ${name}\n`);
		}
		await recordBundle(source, path.join(root, 'bundles', arch), arch, provenance);
	}
	assert.equal((await verifyBundles(path.join(root, 'bundles'), provenance)).length, 16);
	const receiptFile = path.join(root, 'bundles', 'x64', 'provenance.json');
	const originalReceipt = JSON.parse(await readFile(receiptFile, 'utf8'));
	await writeFile(receiptFile, JSON.stringify({ ...originalReceipt, buildAttempt: 1 }));
	assert.equal((await verifyBundles(path.join(root, 'bundles'), provenance)).length, 16);
	for (const buildAttempt of [0, 4, '1']) {
		await writeFile(receiptFile, JSON.stringify({ ...originalReceipt, buildAttempt }));
		await assert.rejects(verifyBundles(path.join(root, 'bundles'), provenance), /buildAttempt/);
	}
	await writeFile(receiptFile, JSON.stringify(originalReceipt));

	const requests = [];
	const uploadCalls = [];
	const rest = async (method, endpoint, body) => {
		requests.push({ method, endpoint, body });
		if (endpoint.endsWith('/releases/tags/nightly-fork')) return { id: 44 };
		if (endpoint.endsWith('/git/ref/tags/nightly-fork')) return { object: { sha: 'b'.repeat(40) } };
		if (endpoint.endsWith('/git/ref/heads/main')) return { object: { sha } };
		return {};
	};
	const upload = async (files, repository) => {
		uploadCalls.push({ files, repository, requestsBeforeUpload: requests.length });
	};
	await publish(path.join(root, 'bundles'), provenance, repo, rest, upload, 'https://github.com');
	assert.deepEqual(
		requests.map((call) => call.method),
		['GET', 'GET', 'GET', 'GET', 'PATCH', 'PATCH']
	);
	assert.equal(uploadCalls[0].requestsBeforeUpload, 2);
	assert.equal(requests[4].body.sha, sha);
	assert.equal(requests[5].endpoint, '/repos/owner/repository/releases/44');
	assert.match(requests[5].body.body, /tests|Tests/);
	assert.equal(uploadCalls[0].files.length, 16);

	requests.length = 0;
	const failedUpload = async () => {
		throw new Error('upload failed');
	};
	await assert.rejects(publish(path.join(root, 'bundles'), provenance, repo, rest, failedUpload, 'https://github.com'), /upload failed/);
	assert.ok(requests.every((call) => call.method === 'GET'));
	requests.length = 0;
	let headChecks = 0;
	const movedAfterUpload = async (method, endpoint, body) => {
		if (endpoint.endsWith('/git/ref/heads/main') && ++headChecks === 2) return { object: { sha: 'b'.repeat(40) } };
		return rest(method, endpoint, body);
	};
	await assert.rejects(
		publish(path.join(root, 'bundles'), provenance, repo, movedAfterUpload, async () => {}, 'https://github.com'),
		/no longer/
	);
	assert.ok(requests.every((call) => call.method === 'GET'));

	let draft;
	const draftCalls = [];
	const draftApi = async (method, endpoint, body) => {
		draftCalls.push({ method, endpoint, body });
		if (endpoint.endsWith('/releases/tags/nightly-fork')) return null;
		if (endpoint.includes('/releases?')) return draft ? [draft] : [];
		if (endpoint.endsWith('/git/ref/heads/main')) return { object: { sha } };
		if (endpoint.endsWith('/git/ref/tags/nightly-fork')) return null;
		if (method === 'POST' && endpoint.endsWith('/releases')) {
			draft = { id: 55, ...body };
			return draft;
		}
		return {};
	};
	await assert.rejects(publish(path.join(root, 'bundles'), provenance, repo, draftApi, failedUpload, 'https://github.com'), /upload failed/);
	assert.equal(draft.draft, true);
	assert.equal(draft.target_commitish, sha);
	assert.equal(draftCalls.filter((call) => call.method !== 'GET').length, 1);
	draftCalls.length = 0;
	await publish(
		path.join(root, 'bundles'),
		provenance,
		repo,
		draftApi,
		async () => {
			assert.equal(
				draftCalls.some((call) => call.method !== 'GET'),
				false
			);
		},
		'https://github.com'
	);
	assert.equal(draftCalls.filter((call) => call.method === 'POST' && call.endpoint.endsWith('/releases')).length, 0);
	assert.equal(draftCalls.at(-1).endpoint, '/repos/owner/repository/releases/55');
	assert.equal(draftCalls.at(-1).body.draft, false);

	requests.length = 0;
	const staleRest = async (method, endpoint, body) => {
		if (endpoint.endsWith('/git/ref/heads/main')) return { object: { sha: 'b'.repeat(40) } };
		return rest(method, endpoint, body);
	};
	await assert.rejects(publish(path.join(root, 'bundles'), provenance, repo, staleRest, upload, 'https://github.com'), /no longer/);
	assert.ok(requests.every((call) => call.method === 'GET'));
	assert.equal(uploadCalls.length, 1);

	await assert.rejects(verifyBundles(path.join(root, 'bundles'), { ...provenance, testsAttempt: 1 }), /provenance/);
	await assert.rejects(verifyBundles(path.join(root, 'bundles'), { ...provenance, buildAttempt: 2 }), /provenance/);
	const name = assetNames('arm64')[0];
	const file = path.join(root, 'bundles', 'arm64', name);
	const original = await readFile(file);
	await writeFile(file, 'altered');
	await assert.rejects(verifyBundles(path.join(root, 'bundles'), provenance), /Checksum mismatch/);
	requests.length = 0;
	await assert.rejects(publish(path.join(root, 'bundles'), provenance, repo, rest, upload, 'https://github.com'), /Checksum mismatch/);
	assert.equal(requests.length, 0);
	assert.equal(uploadCalls.length, 1);
	await writeFile(file, original);
	await rm(`${file}.sha256`);
	await assert.rejects(verifyBundles(path.join(root, 'bundles'), provenance), /Incomplete/);
} finally {
	await rm(root, { recursive: true, force: true });
}
console.log('fork-release fixtures passed');
