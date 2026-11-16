import fs from 'fs';
import path from 'path';
import { workingDir } from './module.cfg-loader';
import { console } from './log';
import { Req } from './module.fetch';
import { argvC } from './module.app-args';
import { displayVersion, forkReleaseUrl } from './module.fork-display';

type Metadata = { version: string; fork: { channel: string; revision: number; repository: string; releaseTag: string } };
type Cache = { repository: string; releaseTag: string; installedVersion: string; installedRevision: number; checkedAt: number; latest: Metadata };
const day = 24 * 60 * 60 * 1000;
const cachePath = path.join(workingDir, 'config', 'updates.json');
const debug = (message: string): void => {
	if (argvC?.debug) console.debug(`[DEBUG] Fork update: ${message}`);
};
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function parseVersion(version: unknown): RegExpMatchArray | null {
	if (typeof version !== 'string') return null;
	const match = version.match(semverPattern);
	if (!match || match[4]?.split('.').some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) return null;
	return match;
}

export function compareVersions(a: string, b: string): number {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (!left || !right) throw new Error('Invalid version');
	for (let i = 1; i <= 3; i++) {
		const x = BigInt(left[i]);
		const y = BigInt(right[i]);
		if (x !== y) return x > y ? 1 : -1;
	}
	if (!left[4] || !right[4]) return left[4] === right[4] ? 0 : left[4] ? -1 : 1;
	const x = left[4].split('.');
	const y = right[4].split('.');
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		if (x[i] === undefined) return -1;
		if (y[i] === undefined) return 1;
		if (x[i] === y[i]) continue;
		const xn = /^\d+$/.test(x[i]);
		const yn = /^\d+$/.test(y[i]);
		if (xn && yn) return BigInt(x[i]) > BigInt(y[i]) ? 1 : -1;
		if (xn !== yn) return xn ? -1 : 1;
		return x[i] > y[i] ? 1 : -1;
	}
	return 0;
}

function validMetadata(value: unknown): value is Metadata {
	if (!value || typeof value !== 'object') return false;
	const m = value as Metadata;
	if (
		!parseVersion(m.version) ||
		!m.fork ||
		typeof m.fork !== 'object' ||
		typeof m.fork.channel !== 'string' ||
		!m.fork.channel.trim() ||
		!Number.isSafeInteger(m.fork.revision) ||
		m.fork.revision < 1
	)
		return false;
	try {
		forkReleaseUrl(m.fork);
		return true;
	} catch {
		return false;
	}
}

function matches(latest: Metadata, installed: Metadata): boolean {
	return latest.fork.repository === installed.fork.repository && latest.fork.releaseTag === installed.fork.releaseTag && latest.fork.channel === installed.fork.channel;
}

function notice(installed: Metadata, latest: Metadata): void {
	const order = compareVersions(latest.version, installed.version);
	if (order > 0 || (order === 0 && latest.fork.revision > installed.fork.revision)) {
		console.info(`Fork update available: ${displayVersion(installed)} -> ${displayVersion(latest)}\n\tDownload updates: ${forkReleaseUrl(installed.fork)}`);
	}
}

function readCache(): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
		return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function validCache(value: unknown, installed: Metadata, now: number): value is Cache {
	if (!value || typeof value !== 'object') return false;
	const c = value as Cache;
	return (
		c.repository === installed.fork.repository &&
		c.releaseTag === installed.fork.releaseTag &&
		c.installedVersion === installed.version &&
		c.installedRevision === installed.fork.revision &&
		Number.isSafeInteger(c.checkedAt) &&
		c.checkedAt >= 0 &&
		c.checkedAt <= now &&
		now - c.checkedAt < day &&
		validMetadata(c.latest) &&
		matches(c.latest, installed)
	);
}

async function fetchMetadata(installed: Metadata): Promise<Metadata> {
	const controller = new AbortController();
	let rejectDeadline: (reason: Error) => void = () => {};
	const deadline = new Promise<never>((_, reject) => {
		rejectDeadline = reject;
	});
	const timer = setTimeout(() => {
		controller.abort();
		rejectDeadline(new Error('Update check timed out'));
	}, 5000);
	try {
		const req = new Req(true);
		const get = async (url: string): Promise<any> => {
			const result = await Promise.race([req.getData(url, { signal: controller.signal, quietErrors: true, quietDebug: true, skipErrorBody: true }), deadline]);
			if (!result.ok || !result.res) {
				void result.res?.body?.cancel().catch(() => {});
				throw new Error('Update metadata unavailable');
			}
			return JSON.parse(await Promise.race([result.res.text(), deadline]));
		};
		const api = `https://api.github.com/repos/${installed.fork.repository}`;
		const release = await get(`${api}/releases/tags/${encodeURIComponent(installed.fork.releaseTag)}`);
		if (
			release.draft !== false ||
			typeof release.published_at !== 'string' ||
			!Number.isFinite(Date.parse(release.published_at)) ||
			release.tag_name !== installed.fork.releaseTag ||
			typeof release.target_commitish !== 'string' ||
			!/^[a-fA-F0-9]{40}$/.test(release.target_commitish) ||
			!Array.isArray(release.assets)
		)
			throw new Error('Invalid release');
		for (const platform of ['windows', 'macos', 'linux', 'alpine'])
			for (const arch of ['x64', 'arm64']) {
				const name = `multi-downloader-nx-${platform}-${arch}-cli.7z`;
				for (const expected of [name, `${name}.sha256`]) {
					if (!release.assets.some((asset: any) => asset.name === expected && asset.state === 'uploaded' && Number.isSafeInteger(asset.size) && asset.size > 0))
						throw new Error('Incomplete release');
				}
			}
		const content = await get(`${api}/contents/package.json?ref=${release.target_commitish}`);
		if (content.type !== 'file' || content.encoding !== 'base64' || typeof content.content !== 'string') throw new Error('Invalid package content');
		const encoded = content.content.replace(/\s/g, '');
		if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('Invalid base64');
		const bytes = Buffer.from(encoded, 'base64');
		if (bytes.toString('base64') !== encoded) throw new Error('Invalid base64');
		const latest: unknown = JSON.parse(bytes.toString('utf8'));
		if (!validMetadata(latest) || !matches(latest, installed)) throw new Error('Invalid package metadata');
		return latest;
	} finally {
		clearTimeout(timer);
		controller.abort();
	}
}

export async function checkForkUpdate(installed: unknown, force = false): Promise<void> {
	try {
		if (!validMetadata(installed)) {
			debug('invalid installed metadata');
			return;
		}
		const cached = readCache();
		const now = Date.now();
		if (!force && validCache(cached.fork, installed, now)) {
			notice(installed, cached.fork.latest);
			return;
		}
		const latest = await fetchMetadata(installed);
		notice(installed, latest);
		const fork: Cache = {
			repository: installed.fork.repository,
			releaseTag: installed.fork.releaseTag,
			installedVersion: installed.version,
			installedRevision: installed.fork.revision,
			checkedAt: Date.now(),
			latest
		};
		const temporary = `${cachePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
		try {
			fs.writeFileSync(temporary, JSON.stringify({ ...cached, fork }, null, 2));
			fs.renameSync(temporary, cachePath);
		} catch {
			debug('could not persist cache');
			try {
				fs.unlinkSync(temporary);
			} catch {
				/* No temporary file to remove. */
			}
		}
	} catch {
		debug('metadata lookup failed');
	}
}
