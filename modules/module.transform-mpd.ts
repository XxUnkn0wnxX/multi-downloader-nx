import { parse as mpdParse } from 'mpd-parser';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { LanguageItem, findLang, languages } from './module.langsData';
import { console } from './log';
import * as reqModule from './module.fetch';
import { FetchParams } from './module.fetch';

let req: reqModule.Req | undefined;
const getReq = (): reqModule.Req => (req ??= new reqModule.Req());

type Segment = {
	uri: string;
	timeline: number;
	duration: number;
	map: {
		uri: string;
		byterange?: {
			length: number;
			offset: number;
		};
	};
	byterange?: {
		length: number;
		offset: number;
	};
	number?: number;
	presentationTime?: number;
};

export type PlaylistItem = {
	pssh_wvd?: string;
	pssh_prd?: string;
	bandwidth: number;
	segments: Segment[];
};

type AudioPlayList = {
	language: LanguageItem;
	default: boolean;
} & PlaylistItem;

type VideoPlayList = {
	quality: {
		width: number;
		height: number;
	};
} & PlaylistItem;

export type MPDParsed = {
	[server: string]: {
		audio: AudioPlayList[];
		video: VideoPlayList[];
	};
};

function selectedHeadLength(result: Awaited<ReturnType<reqModule.Req['getData']>>): number {
	if (!result.ok || !result.res) throw new Error('Selected SIDX HEAD request failed');
	const value = result.res.headers?.get('content-length')?.trim();
	if (!value || !/^[0-9]+$/.test(value)) throw new Error('Selected SIDX HEAD has invalid content length');
	const length = Number(value);
	if (!Number.isSafeInteger(length) || length <= 0) throw new Error('Selected SIDX HEAD has invalid content length');
	return length;
}

function extractPSSH(manifest: string, schemeIdUri: string, psshTagNames: string[]): string | null {
	const regex = new RegExp(`<ContentProtection[^>]*schemeIdUri=["']${schemeIdUri}["'][^>]*>([\\s\\S]*?)</ContentProtection>`, 'i');
	const match = regex.exec(manifest);
	if (match && match[1]) {
		const innerContent = match[1];
		for (const tagName of psshTagNames) {
			const psshRegex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i');
			const psshMatch = psshRegex.exec(innerContent);
			if (psshMatch && psshMatch[1]) {
				return psshMatch[1].trim();
			}
		}
	}
	return null;
}

type TrackSelection =
	| { kind: 'video'; period: number; adaptation: number; representation: number; baseUrlOrdinals?: [number, number, number, number]; manifestUrl?: string }
	| { kind: 'audio'; language?: string; manifestUrl?: string; serverOrdinal?: number };

function pruneTracks(manifest: string, selection: TrackSelection): string {
	const fail = (message: string) => {
		throw new Error(message);
	};
	const doc = new DOMParser({ errorHandler: { warning: fail, error: fail, fatalError: fail } }).parseFromString(manifest, 'application/xml');
	const children = (node: Element, name: string): Element[] =>
		Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1 && (child as Element).localName === name);
	const periods = children(doc.documentElement, 'Period');
	if (
		!doc.documentElement ||
		doc.documentElement.localName !== 'MPD' ||
		(doc.documentElement.hasAttribute('type') && doc.documentElement.getAttribute('type') !== 'static') ||
		periods.length !== 1
	)
		throw new Error('Selected manifest requires a single static Period');
	if (selection.kind === 'video' && selection.baseUrlOrdinals) {
		const period = periods[selection.period - 1];
		const adaptation = period && children(period, 'AdaptationSet')[selection.adaptation - 1];
		const representation = adaptation && children(adaptation, 'Representation')[selection.representation - 1];
		if (!period || !adaptation || !representation) throw new Error('Selected representation locator is invalid');
		const nodes = [doc.documentElement, period, adaptation, representation];
		const bases = nodes.map((node) => children(node, 'BaseURL'));
		for (const [index, choices] of bases.entries()) {
			const ordinal = selection.baseUrlOrdinals[index];
			if (!Number.isInteger(ordinal) || (choices.length === 0 ? ordinal !== 0 : ordinal < 1 || ordinal > choices.length))
				throw new Error('Selected BaseURL locator is invalid');
			if (ordinal && !choices[ordinal - 1].textContent?.trim()) throw new Error('Selected BaseURL is empty');
		}
		for (const [index, choices] of bases.entries())
			for (const [choice, node] of choices.entries()) {
				if (choice + 1 !== selection.baseUrlOrdinals[index]) node.parentNode?.removeChild(node);
			}
	}

	let audioChoice: { representation: Element; bandwidth: number; specific: boolean; nodes: Element[]; ordinals: number[]; server: string } | undefined;
	if (selection.kind === 'audio') {
		type Base = { url: URL; server: string; ordinals: number[] };
		const expand = (parents: Base[], node: Element): Base[] => {
			const choices = children(node, 'BaseURL');
			if (!choices.length) return parents.map((base) => ({ ...base, ordinals: [...base.ordinals, 0] }));
			const result: Base[] = [];
			for (const base of parents)
				for (const [index, choice] of choices.entries()) {
					try {
						const url = new URL(choice.textContent?.trim() || '', base.url);
						if (!choice.textContent?.trim() || !['https:', 'http:'].includes(url.protocol)) continue;
						result.push({ url, server: choice.getAttribute('serviceLocation')?.trim() || url.host, ordinals: [...base.ordinals, index + 1] });
					} catch {
						/* Invalid alternatives cannot be selected. */
					}
				}
			return result;
		};
		const origin = new URL(selection.manifestUrl || 'https://invalid.example/');
		const candidates: NonNullable<typeof audioChoice>[] = [];
		const mpdBases = expand([{ url: origin, server: origin.host, ordinals: [] }], doc.documentElement);
		for (const period of periods)
			for (const adaptation of children(period, 'AdaptationSet'))
				for (const representation of children(adaptation, 'Representation')) {
					const kind =
						representation.getAttribute('contentType') ||
						adaptation.getAttribute('contentType') ||
						representation.getAttribute('mimeType') ||
						adaptation.getAttribute('mimeType') ||
						'';
					const bandwidth = Number(representation.getAttribute('bandwidth') || adaptation.getAttribute('bandwidth'));
					const lang = representation.getAttribute('lang') || adaptation.getAttribute('lang');
					if (selection.language && lang && lang.toLowerCase() !== selection.language.toLowerCase()) continue;
					if (!(kind === 'audio' || kind.startsWith('audio/')) || !Number.isFinite(bandwidth) || bandwidth <= 0) continue;
					const nodes = [doc.documentElement, period, adaptation, representation];
					let bases = mpdBases;
					for (const node of nodes.slice(1)) bases = expand(bases, node);
					for (const base of bases)
						candidates.push({ representation, bandwidth, specific: !!selection.language && !!lang, nodes, ordinals: base.ordinals, server: base.server });
				}
		const servers = [...new Set(candidates.map((candidate) => candidate.server))];
		const requestedServer = servers[(selection.serverOrdinal || 1) - 1] || servers[0];
		for (const candidate of candidates.filter((item) => item.server === requestedServer)) {
			if (!audioChoice || (candidate.specific && !audioChoice.specific) || (candidate.specific === audioChoice.specific && candidate.bandwidth > audioChoice.bandwidth))
				audioChoice = candidate;
		}
		if (!audioChoice) throw new Error('No usable current audio representation');
		for (const [index, node] of audioChoice.nodes.entries())
			for (const [choice, base] of children(node, 'BaseURL').entries()) {
				if (choice + 1 !== audioChoice.ordinals[index]) node.removeChild(base);
			}
	}

	let found = false;
	for (const [pi, period] of periods.entries())
		for (const [ai, adaptation] of children(period, 'AdaptationSet').entries()) {
			const reps = children(adaptation, 'Representation');
			for (const [ri, representation] of reps.entries()) {
				const keep =
					selection.kind === 'video'
						? pi + 1 === selection.period && ai + 1 === selection.adaptation && ri + 1 === selection.representation
						: representation === audioChoice?.representation;
				if (keep) found = true;
				else adaptation.removeChild(representation);
			}
			if (!children(adaptation, 'Representation').length) period.removeChild(adaptation);
		}
	if (!found) throw new Error('Selected representation vanished');
	return new XMLSerializer().serializeToString(doc);
}

export async function parse(
	manifest: string,
	language?: LanguageItem,
	url?: string,
	parseOptions: { videoOnly?: boolean; noNetwork?: boolean; onSkipped?: (reason: string) => void; selection?: TrackSelection; signal?: AbortSignal } = {}
) {
	if (parseOptions.selection) manifest = pruneTracks(manifest, parseOptions.selection);
	if (!manifest.includes('BaseURL') && url) {
		manifest = manifest.replace(/(<MPD*\b[^>]*>)/gm, `$1<BaseURL>${url}</BaseURL>`);
	}
	const manifestUrl = parseOptions.selection?.manifestUrl;
	const parsed = manifestUrl
		? (mpdParse as unknown as (xml: string, options: { manifestUri: string }) => ReturnType<typeof mpdParse>)(manifest, { manifestUri: manifestUrl })
		: mpdParse(manifest);
	const ret: MPDParsed = {};

	// Audio Loop
	for (const item of parseOptions.videoOnly || parseOptions.selection?.kind === 'video' ? [] : Object.values(parsed.mediaGroups.AUDIO.audio)) {
		for (const playlist of item.playlists) {
			const host = new URL(playlist.resolvedUri).hostname;
			if (!Object.prototype.hasOwnProperty.call(ret, host)) ret[host] = { audio: [], video: [] };

			if (playlist.sidx && playlist.segments.length == 0) {
				const options: FetchParams = {
					method: 'head',
					...(parseOptions.selection && parseOptions.signal ? { signal: parseOptions.signal } : {})
				};
				const itemReq = await getReq().getData(playlist.sidx.uri, options);
				const selectedLength = parseOptions.selection ? selectedHeadLength(itemReq) : undefined;
				if (!itemReq.res || !itemReq.ok)
					console.warn(
						`${itemReq.error?.res?.status}: ${itemReq.error?.res?.statusText}, Unable to fetch byteLength for audio stream ${Math.round(playlist.attributes.BANDWIDTH / 1024)}KiB/s`
					);
				const byteLength = selectedLength ?? parseInt(itemReq.res?.headers?.get('content-length') as string);
				let currentByte = playlist.sidx.map.byterange.length;
				while (currentByte <= byteLength) {
					playlist.segments.push({
						duration: 0,
						map: {
							uri: playlist.resolvedUri,
							resolvedUri: playlist.resolvedUri,
							byterange: playlist.sidx.map.byterange
						},
						uri: playlist.resolvedUri,
						resolvedUri: playlist.resolvedUri,
						byterange: {
							length: 500000,
							offset: currentByte
						},
						timeline: 0,
						number: 0,
						presentationTime: 0
					});
					currentByte = currentByte + 500000;
				}
			}

			//Find and add audio language if it is found in the MPD
			let audiolang: LanguageItem;
			const foundlanguage = findLang(languages.find((a) => a.code === item.language)?.cr_locale ?? 'unknown');
			if (item.language) {
				audiolang = foundlanguage;
			} else {
				audiolang = language ? language : foundlanguage;
			}
			const pItem: AudioPlayList = {
				bandwidth: playlist.attributes.BANDWIDTH,
				language: audiolang,
				default: item.default,
				segments: playlist.segments.map((segment): Segment => {
					const uri = segment.resolvedUri;
					const map_uri = segment.map.resolvedUri;
					return {
						duration: segment.duration,
						map: { uri: map_uri, byterange: segment.map.byterange },
						number: segment.number,
						presentationTime: segment.presentationTime,
						timeline: segment.timeline,
						byterange: segment.byterange,
						uri
					};
				})
			};

			const playreadyPssh = extractPSSH(manifest, 'urn:uuid:9A04F079-9840-4286-AB92-E65BE0885F95', ['cenc:pssh', 'mspr:pro']);

			const widevinePssh = extractPSSH(manifest, 'urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed', ['cenc:pssh']);

			if (widevinePssh) {
				pItem.pssh_wvd = widevinePssh;
			}

			if (playreadyPssh) {
				pItem.pssh_prd = playreadyPssh;
			}

			ret[host].audio.push(pItem);
		}
	}

	// Video Loop
	for (const playlist of parseOptions.selection?.kind === 'audio' ? [] : parsed.playlists) {
		const host = new URL(playlist.resolvedUri).hostname;
		if (!Object.prototype.hasOwnProperty.call(ret, host)) ret[host] = { audio: [], video: [] };

		if (playlist.sidx && playlist.segments.length == 0) {
			if (parseOptions.noNetwork) {
				parseOptions.onSkipped?.('unresolved SIDX');
				continue;
			}
			const options: FetchParams = {
				method: 'head',
				...(parseOptions.selection && parseOptions.signal ? { signal: parseOptions.signal } : {})
			};
			const itemReq = await getReq().getData(playlist.sidx.uri, options);
			const selectedLength = parseOptions.selection ? selectedHeadLength(itemReq) : undefined;
			if (!itemReq.res || !itemReq.ok)
				console.warn(
					`${itemReq.error?.res?.status}: ${itemReq.error?.res?.statusText}, Unable to fetch byteLength for video stream ${playlist.attributes.RESOLUTION?.height}x${playlist.attributes.RESOLUTION?.width}@${Math.round(playlist.attributes.BANDWIDTH / 1024)}KiB/s`
				);
			const byteLength = selectedLength ?? parseInt(itemReq.res?.headers?.get('content-length') as string);
			let currentByte = playlist.sidx.map.byterange.length;
			while (currentByte <= byteLength) {
				playlist.segments.push({
					duration: 0,
					map: {
						uri: playlist.resolvedUri,
						resolvedUri: playlist.resolvedUri,
						byterange: playlist.sidx.map.byterange
					},
					uri: playlist.resolvedUri,
					resolvedUri: playlist.resolvedUri,
					byterange: {
						length: 2000000,
						offset: currentByte
					},
					timeline: 0,
					number: 0,
					presentationTime: 0
				});
				currentByte = currentByte + 2000000;
			}
		}

		const pItem: VideoPlayList = {
			bandwidth: playlist.attributes.BANDWIDTH,
			quality: playlist.attributes.RESOLUTION!,
			segments: playlist.segments.map((segment): Segment => {
				const uri = segment.resolvedUri;
				const map_uri = segment.map.resolvedUri;
				return {
					duration: segment.duration,
					map: { uri: map_uri, byterange: segment.map.byterange },
					number: segment.number,
					presentationTime: segment.presentationTime,
					timeline: segment.timeline,
					byterange: segment.byterange,
					uri
				};
			})
		};

		const playreadyPssh =
			(parseOptions.videoOnly && playlist.contentProtection?.['com.microsoft.playready']?.pssh
				? Buffer.from(playlist.contentProtection['com.microsoft.playready'].pssh).toString('base64')
				: null) || extractPSSH(manifest, 'urn:uuid:9A04F079-9840-4286-AB92-E65BE0885F95', ['cenc:pssh', 'mspr:pro']);
		const widevinePssh =
			(parseOptions.videoOnly && playlist.contentProtection?.['com.widevine.alpha']?.pssh
				? Buffer.from(playlist.contentProtection['com.widevine.alpha'].pssh).toString('base64')
				: null) || extractPSSH(manifest, 'urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed', ['cenc:pssh']);

		if (widevinePssh) {
			pItem.pssh_wvd = widevinePssh;
		}

		if (playreadyPssh) {
			pItem.pssh_prd = playreadyPssh;
		}

		ret[host].video.push(pItem);
	}

	return ret;
}
