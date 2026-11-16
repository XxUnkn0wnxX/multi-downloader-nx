import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import console from 'node:console';
import { URL } from 'node:url';
import {
	assetNames,
	reusableProofDescendant,
	eligibleEvent,
	latestApplicableProof,
	publish,
	recordBundle,
	releaseTitleFromSource,
	requireCurrentMain,
	selectGate,
	verifyBundles
} from '../.github/scripts/fork-release.mjs';

const repo = 'owner/repository';
const packageMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const targetRevision = packageMetadata.fork.revision + 1;
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
const selected = { sha, testedSha: sha, testsRunId: 101, testsAttempt: 2 };
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

const otherSha = 'b'.repeat(40);
const validComparison = { status: 'ahead', merge_base_commit: { sha }, behind_by: 0, files: [{ status: 'modified', filename: 'docs/CHANGELOG.md' }] };
const compare = async () => validComparison;
assert.equal(
	await reusableProofDescendant(repo, sha, sha, async () => {
		throw new Error('unneeded comparison');
	}),
	true
);
assert.equal(await reusableProofDescendant(repo, sha, otherSha, compare), true);
for (const filename of ['.github/scripts/fork-release.mjs', 'tests/fork-release.mjs']) {
	assert.equal(await reusableProofDescendant(repo, sha, otherSha, async () => ({ ...validComparison, files: [{ status: 'modified', filename }] })), true);
	assert.equal(await reusableProofDescendant(repo, sha, otherSha, async () => ({ ...validComparison, files: [{ status: 'added', filename }] })), false);
	assert.equal(
		await reusableProofDescendant(repo, sha, otherSha, async () => ({ ...validComparison, files: [{ status: 'renamed', filename, previous_filename: 'docs/old.md' }] })),
		false
	);
}
assert.equal(
	await reusableProofDescendant(repo, sha, otherSha, async () => ({
		...validComparison,
		files: [
			{ status: 'modified', filename: '.github/scripts/fork-release.mjs' },
			{ status: 'modified', filename: 'package.json' }
		]
	})),
	false
);
for (const filename of ['package.json', 'pnpm-lock.yaml', '.github/workflows/test.yml']) {
	assert.equal(await reusableProofDescendant(repo, sha, otherSha, async () => ({ ...validComparison, files: [{ status: 'modified', filename }] })), false);
}
for (const [filename, previous_filename] of [
	['docs/readme.md', 'src/index.ts'],
	['src/index.ts', 'docs/readme.md']
]) {
	assert.equal(await reusableProofDescendant(repo, sha, otherSha, async () => ({ ...validComparison, files: [{ status: 'renamed', filename, previous_filename }] })), false);
}
await assert.rejects(
	reusableProofDescendant(repo, sha, otherSha, async () => ({ ...validComparison, files: Array(300).fill(validComparison.files[0]) })),
	/300-file/
);
await assert.rejects(
	reusableProofDescendant(repo, sha, otherSha, async () => ({ ...validComparison, files: [{ status: 'renamed', filename: 'docs/a.md' }] })),
	/malformed/
);
await assert.rejects(
	reusableProofDescendant(repo, sha, otherSha, async () => ({ ...validComparison, files: null })),
	/malformed/
);
assert.equal(await reusableProofDescendant(repo, sha, otherSha, async () => ({ ...validComparison, status: 'diverged' })), false);
assert.equal(await reusableProofDescendant(repo, sha, otherSha, async () => ({ ...validComparison, merge_base_commit: { sha: otherSha } })), false);

const run = { ...base.workflow_run, run_started_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' };
const proofApi =
	(runs, overrides = {}) =>
	async (method, endpoint) => {
		if (endpoint.endsWith('/actions/workflows/test.yml')) return { id: 7, name: 'Tests', path: '.github/workflows/test.yml' };
		if (endpoint.includes('/actions/workflows/7/runs?')) return { total_count: runs.length, workflow_runs: runs };
		if (endpoint.includes('/compare/')) return validComparison;
		if (endpoint.includes('/actions/runs/')) return overrides[endpoint] ?? runs.find((entry) => endpoint.endsWith(`/${entry.id}`));
		throw new Error(`Unexpected request ${method} ${endpoint}`);
	};
assert.deepEqual(await latestApplicableProof(repo, sha, proofApi([run])), selected);
assert.deepEqual(await latestApplicableProof(repo, otherSha, proofApi([run])), { ...selected, sha: otherSha });
const laterFailedRerun = { ...run, id: 100, run_attempt: 3, run_started_at: '2026-01-02T00:00:00Z', conclusion: 'failure' };
await assert.rejects(latestApplicableProof(repo, sha, proofApi([run, laterFailedRerun])), /did not succeed/);
await assert.rejects(latestApplicableProof(repo, sha, proofApi([run, { ...laterFailedRerun, status: 'queued', conclusion: null }])), /running or pending/);
await assert.rejects(latestApplicableProof(repo, sha, proofApi([run], { '/repos/owner/repository/actions/runs/101': { ...run, run_attempt: 3 } })), /changed during proof/);
await assert.rejects(
	latestApplicableProof(
		repo,
		sha,
		proofApi([
			{ ...run, event: 'pull_request' },
			{ ...run, id: 102, head_repository: { full_name: 'fork/repository' } }
		])
	),
	/No successful/
);
await assert.rejects(
	latestApplicableProof(repo, sha, async (method, endpoint) => (endpoint.endsWith('test.yml') ? { id: 7, name: 'Other', path: '.github/workflows/test.yml' } : {})),
	/expected Tests/
);
await assert.rejects(
	latestApplicableProof(repo, sha, async (method, endpoint) =>
		endpoint.endsWith('test.yml') ? { id: 7, name: 'Tests', path: '.github/workflows/test.yml' } : { total_count: 501, workflow_runs: [] }
	),
	/500-run limit/
);

const tiedFailure = { ...run, id: 102, conclusion: 'failure' };
await assert.rejects(latestApplicableProof(repo, sha, proofApi([run, tiedFailure])), /did not succeed/);
await assert.rejects(latestApplicableProof(repo, sha, proofApi([run, { ...tiedFailure, status: 'queued', conclusion: null }])), /running or pending/);
assert.deepEqual(await latestApplicableProof(repo, sha, proofApi([run, { ...tiedFailure, head_sha: otherSha }])), selected);
const older = { ...run, id: 99, run_started_at: '2025-12-31T00:00:00Z' };
let historyReads = 0;
const baseRaceApi = proofApi([run, older]);
await assert.rejects(
	latestApplicableProof(repo, sha, async (method, endpoint) => {
		if (endpoint.includes('/actions/workflows/7/runs?') && ++historyReads === 2) {
			return { total_count: 2, workflow_runs: [run, { ...older, run_attempt: 3, conclusion: 'failure', run_started_at: '2026-01-02T00:00:00Z' }] };
		}
		return baseRaceApi(method, endpoint);
	}),
	/history changed/
);
const fiveHundred = Array.from({ length: 500 }, (_, index) => ({ ...run, id: index + 1, run_started_at: new Date(Date.parse(run.run_started_at) + index * 1000).toISOString() }));
const pagedApi = async (method, endpoint) => {
	if (endpoint.endsWith('test.yml')) return { id: 7, name: 'Tests', path: '.github/workflows/test.yml' };
	if (endpoint.includes('/actions/workflows/7/runs?')) {
		const page = Number(endpoint.match(/page=(\d+)$/)[1]);
		return { total_count: 500, workflow_runs: fiveHundred.slice((page - 1) * 100, page * 100) };
	}
	if (endpoint.includes('/actions/runs/')) return fiveHundred.find((entry) => endpoint.endsWith(`/${entry.id}`));
	throw new Error('Unexpected request');
};
assert.equal((await latestApplicableProof(repo, sha, pagedApi)).testsRunId, 500);
const manualApi = async (method, endpoint) => (endpoint.endsWith('/git/ref/heads/main') ? { object: { sha: otherSha } } : proofApi([run])(method, endpoint));
await assert.rejects(selectGate({ eventName: 'workflow_dispatch', ref: 'refs/heads/develop', sha, repository: repo }, manualApi), /requires main/);
assert.deepEqual(await selectGate({ eventName: 'workflow_dispatch', ref: 'refs/heads/main', sha: otherSha, repository: repo }, manualApi), { ...selected, sha: otherSha });
const exactApi = async (method, endpoint) => (endpoint.endsWith('/git/ref/heads/main') ? { object: { sha } } : proofApi([run])(method, endpoint));
assert.deepEqual(await selectGate({ eventName: 'workflow_dispatch', ref: 'refs/heads/main', sha, repository: repo }, exactApi), selected);
assert.deepEqual(await selectGate({ eventName: 'workflow_run', event: base, repository: repo }, manualApi), {
	skipReason: 'Tests commit is no longer current main; skipping automatic release'
});
assert.equal(await selectGate({ eventName: 'workflow_run', event: { ...base, action: 'requested' }, repository: repo }, manualApi), null);
await assert.rejects(selectGate({ eventName: 'push', repository: repo }, manualApi), /Unsupported/);
await assert.rejects(
	selectGate({ eventName: 'workflow_run', event: base, repository: repo }, async () => {
		throw new Error('network failed');
	}),
	/network failed/
);

const proof = async () => {};

const sourceManifest = (revision = packageMetadata.fork.revision) => ({
	type: 'file',
	encoding: 'base64',
	content: Buffer.from(JSON.stringify({ version: '5.8.8', fork: { channel: 'Nightly', revision } })).toString('base64')
});
assert.equal(
	await releaseTitleFromSource(repo, sha, async (method, endpoint) => {
		assert.equal(method, 'GET');
		assert.equal(endpoint, `/repos/${repo}/contents/package.json?ref=${sha}`);
		return sourceManifest(targetRevision);
	}),
	`Nightly Fork (Rev${targetRevision})`
);
for (const revision of [3, 12]) {
	assert.equal(await releaseTitleFromSource(repo, sha, async () => sourceManifest(revision)), `Nightly Fork (Rev${revision})`);
}
for (const manifest of [
	null,
	{ type: 'dir', encoding: 'base64', content: 'e30=' },
	{ type: 'file', encoding: 'utf8', content: '{}' },
	{ type: 'file', encoding: 'base64', content: '%%%=' },
	{ type: 'file', encoding: 'base64', content: Buffer.from('{').toString('base64') },
	{ type: 'file', encoding: 'base64', content: Buffer.from(JSON.stringify({ version: '5.8.8', fork: { channel: 'Nightly', revision: 0 } })).toString('base64') },
	{ type: 'file', encoding: 'base64', content: Buffer.from(JSON.stringify({ version: '5.8.8', fork: { channel: 'Nightly', revision: 1.5 } })).toString('base64') },
	{ type: 'file', encoding: 'base64', content: Buffer.from(JSON.stringify({ version: '5.8.8', fork: { channel: 'Stable', revision: 3 } })).toString('base64') }
]) {
	await assert.rejects(
		releaseTitleFromSource(repo, sha, async () => manifest),
		/target package\.json/i
	);
}

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

	const reusedProvenance = { ...provenance, sha: otherSha, testedSha: sha };
	for (const arch of ['x64', 'arm64']) {
		await recordBundle(path.join(root, 'source', arch), path.join(root, 'reused', arch), arch, reusedProvenance);
	}
	assert.equal((await verifyBundles(path.join(root, 'reused'), reusedProvenance)).length, 16);
	await assert.rejects(verifyBundles(path.join(root, 'reused'), { ...reusedProvenance, testedSha: otherSha }), /provenance/);
	let releaseBody;
	await publish(
		path.join(root, 'reused'),
		reusedProvenance,
		repo,
		async (method, endpoint, body) => {
			if (endpoint.includes('/contents/package.json?ref=')) return sourceManifest(targetRevision);
			if (endpoint.endsWith('/releases/tags/nightly-fork')) return { id: 44 };
			if (endpoint.endsWith('/git/ref/heads/main')) return { object: { sha: otherSha } };
			if (endpoint.endsWith('/git/ref/tags/nightly-fork')) return { object: { sha } };
			if (method === 'POST' && endpoint.endsWith('/releases')) return { id: 45 };
			if (method === 'PATCH' && endpoint.endsWith('/releases/45')) releaseBody = body.body;
			return {};
		},
		async () => {},
		'https://github.com',
		proof
	);
	assert.ok(releaseBody.includes(`Source: [${otherSha}]`));
	assert.ok(releaseBody.includes(`tested ancestor: [${sha}]`));

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
		if (endpoint.includes('/contents/package.json?ref=')) return sourceManifest(targetRevision);
		if (endpoint.endsWith('/releases/tags/nightly-fork')) return { id: 44 };
		if (endpoint.endsWith('/git/ref/tags/nightly-fork')) return { object: { sha: 'b'.repeat(40) } };
		if (endpoint.endsWith('/git/ref/heads/main')) return { object: { sha } };
		if (method === 'POST' && endpoint.endsWith('/releases')) return { id: 55 };
		return {};
	};
	const upload = async (files, repository) => {
		uploadCalls.push({ files, repository, requestsBeforeUpload: requests.length });
	};
	await publish(path.join(root, 'bundles'), provenance, repo, rest, upload, 'https://github.com', proof);
	assert.deepEqual(
		requests.map((call) => call.method),
		['GET', 'GET', 'GET', 'DELETE', 'POST', 'GET', 'GET', 'PATCH', 'PATCH']
	);
	assert.equal(requests[0].endpoint, `/repos/${repo}/contents/package.json?ref=${sha}`);
	assert.equal(requests[3].endpoint, '/repos/owner/repository/releases/44');
	assert.equal(requests[4].body.draft, true);
	assert.equal(requests[4].body.name, `Nightly Fork (Rev${targetRevision})`);
	assert.equal(uploadCalls[0].requestsBeforeUpload, 5);
	assert.equal(requests[7].body.sha, sha);
	assert.equal(requests[8].endpoint, '/repos/owner/repository/releases/55');
	assert.equal(requests[8].body.prerelease, false);
	assert.equal(requests[8].body.make_latest, 'true');
	assert.equal(requests[8].body.tag_name, 'nightly-fork');
	assert.equal(requests[8].body.name, `Nightly Fork (Rev${targetRevision})`);
	assert.match(requests[8].body.body, /tests|Tests/);
	assert.equal(uploadCalls[0].files.length, 16);
	assert.match(requests[8].body.body, new RegExp(sha));
	requests.length = 0;
	for (const [metadata, error] of [
		[sourceManifest(0), /invalid Nightly fork revision/],
		[null, /Cannot read target package\.json/]
	]) {
		requests.length = 0;
		await assert.rejects(
			publish(
				path.join(root, 'bundles'),
				provenance,
				repo,
				async (method, endpoint) => {
					requests.push({ method, endpoint });
					if (endpoint.includes('/contents/package.json?ref=')) return metadata;
					throw new Error(`Unexpected release API call: ${method} ${endpoint}`);
				},
				async () => {
					throw new Error('unexpected upload');
				},
				'https://github.com',
				proof
			),
			error
		);
		assert.deepEqual(
			requests.map((call) => call.method),
			['GET']
		);
	}
	requests.length = 0;
	await assert.rejects(
		publish(
			path.join(root, 'bundles'),
			provenance,
			repo,
			async (method, endpoint, body) => {
				if (method === 'DELETE') throw new Error('delete denied');
				return rest(method, endpoint, body);
			},
			async () => {
				throw new Error('unexpected upload');
			},
			'https://github.com',
			proof
		),
		/delete denied/
	);
	assert.deepEqual(
		requests.map((call) => call.method),
		['GET', 'GET', 'GET']
	);
	requests.length = 0;
	await assert.rejects(
		publish(
			path.join(root, 'bundles'),
			provenance,
			repo,
			async (method, endpoint, body) => {
				if (endpoint.endsWith('/git/ref/heads/main')) return { object: { sha: otherSha } };
				return rest(method, endpoint, body);
			},
			async () => {
				throw new Error('unexpected upload');
			},
			'https://github.com',
			async () => {}
		),
		/no longer/
	);
	assert.ok(requests.every((call) => call.method === 'GET'));

	requests.length = 0;
	let checks = 0;
	await assert.rejects(
		publish(
			path.join(root, 'bundles'),
			provenance,
			repo,
			rest,
			async () => {},
			'https://github.com',
			async () => {
				if (++checks === 2) throw new Error('new failed test');
			}
		),
		/new failed test/
	);
	assert.deepEqual(
		requests.map((call) => call.method),
		['GET', 'GET', 'GET', 'DELETE', 'POST', 'GET']
	);

	requests.length = 0;
	const failedUpload = async () => {
		throw new Error('upload failed');
	};
	await assert.rejects(publish(path.join(root, 'bundles'), provenance, repo, rest, failedUpload, 'https://github.com', proof), /upload failed/);
	assert.deepEqual(
		requests.map((call) => call.method),
		['GET', 'GET', 'GET', 'DELETE', 'POST']
	);
	requests.length = 0;
	let headChecks = 0;
	const movedAfterUpload = async (method, endpoint, body) => {
		if (endpoint.endsWith('/git/ref/heads/main') && ++headChecks === 2) return { object: { sha: 'b'.repeat(40) } };
		return rest(method, endpoint, body);
	};
	await assert.rejects(
		publish(path.join(root, 'bundles'), provenance, repo, movedAfterUpload, async () => {}, 'https://github.com', proof),
		/no longer/
	);
	assert.deepEqual(
		requests.map((call) => call.method),
		['GET', 'GET', 'GET', 'DELETE', 'POST', 'GET']
	);

	let draft;
	let nextDraftId = 55;
	const draftCalls = [];
	const draftApi = async (method, endpoint, body) => {
		draftCalls.push({ method, endpoint, body });
		if (endpoint.includes('/contents/package.json?ref=')) return sourceManifest();
		if (endpoint.endsWith('/releases/tags/nightly-fork')) return null;
		if (endpoint.includes('/releases?')) return draft ? [draft] : [];
		if (endpoint.endsWith('/git/ref/heads/main')) return { object: { sha } };
		if (endpoint.endsWith('/git/ref/tags/nightly-fork')) return null;
		if (method === 'DELETE' && endpoint.endsWith(`/releases/${draft?.id}`)) {
			draft = null;
			return null;
		}
		if (method === 'POST' && endpoint.endsWith('/releases')) {
			draft = { id: nextDraftId++, ...body };
			return draft;
		}
		return {};
	};
	await assert.rejects(publish(path.join(root, 'bundles'), provenance, repo, draftApi, failedUpload, 'https://github.com', proof), /upload failed/);
	assert.equal(draft.draft, true);
	assert.equal(draft.prerelease, false);
	assert.equal(draft.target_commitish, sha);
	assert.equal(draft.name, `Nightly Fork (Rev${packageMetadata.fork.revision})`);
	assert.equal(draftCalls.filter((call) => call.method !== 'GET').length, 1);
	draftCalls.length = 0;
	await publish(
		path.join(root, 'bundles'),
		provenance,
		repo,
		draftApi,
		async () => {
			assert.deepEqual(
				draftCalls.filter((call) => call.method !== 'GET').map((call) => call.method),
				['DELETE', 'POST']
			);
		},
		'https://github.com',
		proof
	);
	assert.equal(draftCalls.filter((call) => call.method === 'POST' && call.endpoint.endsWith('/releases')).length, 1);
	assert.equal(draftCalls.at(-1).endpoint, '/repos/owner/repository/releases/56');
	assert.equal(draftCalls.at(-1).body.draft, false);
	assert.equal(draftCalls.at(-1).body.prerelease, false);
	assert.equal(draftCalls.at(-1).body.make_latest, 'true');
	assert.equal(draftCalls.at(-1).body.name, `Nightly Fork (Rev${packageMetadata.fork.revision})`);

	requests.length = 0;
	const staleRest = async (method, endpoint, body) => {
		if (endpoint.endsWith('/git/ref/heads/main')) return { object: { sha: 'b'.repeat(40) } };
		return rest(method, endpoint, body);
	};
	await assert.rejects(publish(path.join(root, 'bundles'), provenance, repo, staleRest, upload, 'https://github.com', proof), /no longer/);
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
	await assert.rejects(publish(path.join(root, 'bundles'), provenance, repo, rest, upload, 'https://github.com', proof), /Checksum mismatch/);
	assert.equal(requests.length, 0);
	assert.equal(uploadCalls.length, 1);
	await writeFile(file, original);
	await rm(`${file}.sha256`);
	await assert.rejects(verifyBundles(path.join(root, 'bundles'), provenance), /Incomplete/);
} finally {
	await rm(root, { recursive: true, force: true });
}
console.log('fork-release fixtures passed');
