import { DOMParser } from '@xmldom/xmldom';
import { console } from './log';
import { FetchParams, Req } from './module.fetch';
import { LanguageItem } from './module.langsData';
import { MPDParsed, parse } from './module.transform-mpd';
import { VIDEO_SELECTION_DEFAULTS } from './module.crunchy-video-catalog';

type Family = 'Current' | 'Legacy 0' | 'Legacy 1';
type Video = MPDParsed[string]['video'][number];
export type Quality = Video & { family: Family; server: string; resolutionText: string };

export function legacyUrls(url: string): string[] {
	const match = /^(https?:\/\/[^/?#]+)([^?#]*)([?#][\s\S]*)?$/.exec(url);
	if (!match) return [];
	const clean = /^(.*\/static\/)(?:majin\/)?([^/]+)\/(?:\d+\/)?clean\/(?:cenc\/)?dash\/(.*)$/.exec(match[2]);
	if (!clean) return [];
	return [...new Set([0, 1].map((n) => `${match[1]}${clean[1]}${clean[2]}/${n}/clean/dash/${clean[3]}${match[3] || ''}`).filter((candidate) => candidate !== url))];
}

export async function optionalManifests(req: Req, url: string, headers: FetchParams, language: LanguageItem, debug: boolean): Promise<{ family: Family; playlists: MPDParsed }[]> {
	const urls = legacyUrls(url);
	const results = await Promise.all(
		urls.map(async (candidate) => {
			const family: Family = /\/0\/clean\/dash\//.test(candidate.split(/[?#]/, 1)[0]) ? 'Legacy 0' : 'Legacy 1';
			const controller = new AbortController();
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				if (debug) console.debug(`[DEBUG] ${family} manifest request: ${candidate}`);
				const timeout = new Promise<never>((_, reject) => {
					timer = setTimeout(() => {
						controller.abort();
						reject(new Error('deadline exceeded'));
					}, VIDEO_SELECTION_DEFAULTS.requestTimeoutMs);
				});
				const work = (async () => {
					const response = await req.getData(candidate, { ...headers, quietErrors: true, signal: controller.signal });
					if (debug) console.debug(`[DEBUG] ${family} manifest status: ${response.res?.status ?? response.error?.res?.status ?? 'request failed'}`);
					if (!response.ok || !response.res) throw new Error('request failed');
					const body = await response.res.text();
					const fail = (message: string) => {
						throw new Error(message);
					};
					const doc = new DOMParser({ errorHandler: { warning: fail, error: fail, fatalError: fail } }).parseFromString(body, 'application/xml');
					if (doc.documentElement?.localName !== 'MPD') throw new Error('not an MPD');
					const playlists = await parse(body, language, candidate.match(/.*\.urlset\//)?.[0], {
						videoOnly: true,
						noNetwork: true,
						onSkipped: (reason) => {
							if (debug) console.debug(`[DEBUG] ${family} track excluded: ${reason}`);
						}
					});
					if (!Object.values(playlists).some((server) => server.video.length)) throw new Error('no usable video tracks (including unresolved SIDX)');
					return { family, playlists };
				})();
				const result = await Promise.race([work, timeout]);
				if (debug) console.debug(`[DEBUG] ${family} manifest parsed successfully`);
				return result;
			} catch (error) {
				if (debug) console.debug(`[DEBUG] ${family} manifest excluded: ${String(error)}`);
				return undefined;
			} finally {
				if (timer) clearTimeout(timer);
			}
		})
	);
	return results.filter((result): result is NonNullable<typeof result> => !!result);
}

export function videoQualities(current: MPDParsed, optional: { family: Family; playlists: MPDParsed }[], ordinal: number, debug = false, languageCode = 'und'): Quality[] {
	const seen = new Set<string>();
	const videos: Quality[] = [];
	for (const { family, playlists } of [{ family: 'Current' as Family, playlists: current }, ...optional]) {
		const servers = Object.keys(playlists);
		const valid = (item: Video) =>
			!!item.quality &&
			[item.quality.width, item.quality.height, item.bandwidth].every((value) => Number.isFinite(value) && value > 0) &&
			!!item.segments.length &&
			!!item.segments[0].map;
		if (debug && family !== 'Current') {
			for (const name of servers)
				for (const item of playlists[name].video) if (!valid(item)) console.debug(`[DEBUG] ${family} track excluded: invalid video metadata on ${name}`);
		}
		const usable = (name: string) => playlists[name].video.some(valid);
		const requested = servers[ordinal - 1];
		const server = requested && usable(requested) ? requested : servers.find(usable);
		if (!server) continue;
		for (const item of playlists[server].video) {
			if (!valid(item)) continue;
			const identity = JSON.stringify([item.segments.map((segment) => [segment.map, segment.uri, segment.byterange]), item.pssh_wvd, item.pssh_prd]);
			if (seen.has(identity)) continue;
			seen.add(identity);
			videos.push({
				...item,
				family,
				server,
				resolutionText: `${item.quality.width}x${item.quality.height} (${Math.round(item.bandwidth / 1000)} kb/s) [${family === 'Current' ? 'Current M' : 'Legacy M'}] [${languageCode}]`
			});
		}
	}
	const rank: Record<Family, number> = { Current: 2, 'Legacy 0': 1, 'Legacy 1': 0 };
	return videos.sort((a, b) => a.quality.height - b.quality.height || a.quality.width - b.quality.width || a.bandwidth - b.bandwidth || rank[a.family] - rank[b.family]);
}
