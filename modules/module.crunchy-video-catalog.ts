import { DOMParser } from '@xmldom/xmldom';

export type VideoSource = {
	guid: string;
	locale: string;
	languageCode: string;
};

export type VideoFamily = 'Current' | 'Legacy 0' | 'Legacy 1';
export type VideoAddressing = 'SegmentBase' | 'SegmentList' | 'SegmentTemplate' | 'Unknown';

/**
 * Maintainer defaults for bounded future discovery and declared video timing.
 * Timeout values are milliseconds; maxManifestBytes is bytes; all tolerances are frames (about 41.7 ms at 23.976 fps).
 * Looser tolerances only widen metadata eligibility: they do not retime streams or prove edit identity.
 * Subtitle cue times are intentionally not used as video timing evidence.
 */
export const VIDEO_SELECTION_DEFAULTS = {
	requestTimeoutMs: 15000,
	discoveryTimeoutMs: 90000,
	maxVersions: 32,
	maxManifestBytes: 2 * 1024 * 1024,
	startToleranceFrames: 1,
	endToleranceFrames: 1,
	durationToleranceFrames: 1,
	maxFrameRateDriftFrames: 1
} as const;

export type VideoTiming = {
	periodStart: number;
	periodDuration: number;
	fps: number;
	timescale: number;
	presentationTimeOffset: number;
	addressing: VideoAddressing;
	timelineStart?: number;
	timelineEnd?: number;
};

export type CatalogVideo = {
	source: VideoSource;
	family: VideoFamily;
	representationId: string;
	representationKey: string;
	baseUrlOrdinals: [number, number, number, number];
	width: number;
	height: number;
	bandwidth: number;
	codecs: string;
	server: string;
	serverOrdinal: number;
	periodOrdinal: number;
	adaptationOrdinal: number;
	representationOrdinal: number;
	timing?: VideoTiming;
	timingIssue?: string;
};

export type TimingCompatibility = {
	compatible: boolean;
	reason?: string;
	driftSeconds?: number;
};

type Element = globalThis.Element;
type BaseRef = { url: URL; server: string; baseUrlOrdinals: [number, number, number, number] };
type AddressingInfo = {
	type: VideoAddressing;
	attributes: Record<string, string>;
	node?: Element;
	timeline?: Element;
};

function localChildren(node: Element, name: string): Element[] {
	const result: Element[] = [];
	for (let child = node.firstChild; child; child = child.nextSibling) {
		if (child.nodeType === 1 && (child as Element).localName === name) result.push(child as Element);
	}
	return result;
}

function elementText(node: Element): string {
	return node.textContent?.trim() ?? '';
}

function finitePositive(raw: string | null): number | undefined {
	if (raw === null || raw.trim() === '') return undefined;
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 ? value : undefined;
}

function safeInteger(raw: string | null): number | undefined {
	if (raw === null || !/^-?\d+$/.test(raw.trim())) return undefined;
	const value = Number(raw);
	return Number.isSafeInteger(value) ? value : undefined;
}

function parseRational(raw: string | null): number | undefined {
	if (raw === null || raw.trim() === '') return undefined;
	const trimmed = raw.trim();
	const ratio = /^([0-9]+(?:\.[0-9]+)?)\/([0-9]+(?:\.[0-9]+)?)$/.exec(trimmed);
	if (ratio) {
		const numerator = Number(ratio[1]);
		const denominator = Number(ratio[2]);
		const value = numerator / denominator;
		return Number.isFinite(value) && numerator > 0 && denominator > 0 ? value : undefined;
	}
	return finitePositive(trimmed);
}

function parseDuration(raw: string | null): number | undefined {
	if (raw === null) return undefined;
	const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(raw);
	if (!match || !match.slice(1).some((part) => part !== undefined)) return undefined;
	const parts = match.slice(1).map((part) => (part === undefined ? 0 : Number(part)));
	const seconds = parts[0] * 86400 + parts[1] * 3600 + parts[2] * 60 + parts[3];
	return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function directBaseUrls(node: Element): Element[] {
	return localChildren(node, 'BaseURL');
}

function resolveBaseRefs(parent: BaseRef[], node: Element, level: 0 | 1 | 2 | 3): BaseRef[] {
	const values = directBaseUrls(node);
	if (!values.length) return parent;
	const resolved: BaseRef[] = [];
	for (const base of parent) {
		for (const [index, value] of values.entries()) {
			const text = elementText(value);
			if (!text) continue;
			try {
				const url = new URL(text, base.url);
				if (!['http:', 'https:'].includes(url.protocol) || !url.host) continue;
				const server = value.getAttribute('serviceLocation')?.trim() || url.host;
				const route = `${url.origin}${url.pathname}`;
				if (!resolved.some((item) => `${item.url.origin}${item.url.pathname}` === route)) {
					const baseUrlOrdinals = [...base.baseUrlOrdinals] as [number, number, number, number];
					baseUrlOrdinals[level] = index + 1;
					resolved.push({ url, server, baseUrlOrdinals });
				}
			} catch {
				// An unresolved BaseURL cannot provide an execution route or catalog server.
			}
		}
	}
	return resolved;
}

function safePath(raw: string | undefined, base: URL): string {
	if (!raw) return base.pathname;
	try {
		return new URL(raw, base).pathname;
	} catch {
		return raw.split(/[?#]/, 1)[0];
	}
}

function mergedAttributes(nodes: Element[]): Record<string, string> {
	const result: Record<string, string> = {};
	for (const node of nodes) {
		for (let index = 0; index < node.attributes.length; index++) {
			const attr = node.attributes.item(index);
			if (attr) result[attr.name] = attr.value;
		}
	}
	return result;
}

function addressingInfo(ancestors: Element[]): AddressingInfo {
	const found: { type: VideoAddressing; node: Element }[] = [];
	for (const node of ancestors) {
		for (const name of ['SegmentBase', 'SegmentList', 'SegmentTemplate'] as const) {
			for (const child of localChildren(node, name)) found.push({ type: name, node: child });
		}
	}
	if (!found.length) return { type: 'Unknown', attributes: {} };
	const type = found[found.length - 1].type;
	const nodes = found.filter((item) => item.type === type).map((item) => item.node);
	const timelines = nodes.map((node) => {
		const children = localChildren(node, 'SegmentTimeline');
		return children[children.length - 1];
	});
	const availableTimelines = timelines.filter((item): item is Element => !!item);
	const timeline = availableTimelines[availableTimelines.length - 1];
	return { type, attributes: mergedAttributes(nodes), node: nodes[nodes.length - 1], timeline };
}

function inheritedAttribute(ancestors: Element[], name: string): string | null {
	for (let index = ancestors.length - 1; index >= 0; index--) {
		const value = ancestors[index].getAttribute(name);
		if (value !== null && value.trim() !== '') return value;
	}
	return null;
}

function parseTimeline(timeline: Element, periodStart: number, periodDuration: number, fps: number, timescale: number, pto: number): { start: number; end: number } {
	const entries = localChildren(timeline, 'S');
	if (!entries.length) throw new Error('empty SegmentTimeline');
	let cursor: number | undefined;
	let firstTick: number | undefined;
	for (let index = 0; index < entries.length; index++) {
		const entry = entries[index];
		const duration = safeInteger(entry.getAttribute('d'));
		if (!duration) throw new Error('invalid SegmentTimeline duration');
		const tick = entry.hasAttribute('t') ? safeInteger(entry.getAttribute('t')) : (cursor ?? 0);
		const repeat = entry.hasAttribute('r') ? safeInteger(entry.getAttribute('r')) : 0;
		if (tick === undefined || repeat === undefined || repeat < -1 || duration <= 0) throw new Error('invalid SegmentTimeline entry');
		if (cursor !== undefined && tick !== cursor) throw new Error(tick < cursor ? 'SegmentTimeline overlap' : 'SegmentTimeline gap');
		if (firstTick === undefined) firstTick = tick;
		let count: number;
		if (repeat === -1) {
			const next = entries[index + 1];
			const nextTick = next?.hasAttribute('t') ? safeInteger(next.getAttribute('t')) : undefined;
			if (next?.hasAttribute('t') && nextTick === undefined) throw new Error('invalid SegmentTimeline repeat boundary');
			const periodEndTicks = pto + periodDuration * timescale;
			if (!Number.isFinite(periodEndTicks) || Math.abs(periodEndTicks) > Number.MAX_SAFE_INTEGER) throw new Error('unsafe SegmentTimeline Period boundary');
			const stop = nextTick ?? Math.round(periodEndTicks);
			const difference = stop - tick;
			if (!Number.isFinite(stop) || difference <= 0 || difference % duration !== 0) throw new Error('unbounded or malformed SegmentTimeline repeat');
			count = difference / duration;
		} else {
			count = repeat + 1;
		}
		cursor = tick + count * duration;
		if (!Number.isSafeInteger(count) || !Number.isSafeInteger(cursor)) throw new Error('unsafe SegmentTimeline expansion');
	}
	if (firstTick === undefined || cursor === undefined) throw new Error('missing SegmentTimeline coverage');
	const start = periodStart + (firstTick - pto) / timescale;
	const end = periodStart + (cursor - pto) / timescale;
	const startTolerance = VIDEO_SELECTION_DEFAULTS.startToleranceFrames / fps;
	const endTolerance = VIDEO_SELECTION_DEFAULTS.endToleranceFrames / fps;
	if (Math.abs(start - periodStart) > startTolerance) throw new Error('SegmentTimeline start does not cover Period start');
	if (Math.abs(end - (periodStart + periodDuration)) > endTolerance) throw new Error('SegmentTimeline end does not cover Period end');
	return { start, end };
}

function timingFor(mpd: Element, periods: Element[], period: Element, ancestors: Element[], address: AddressingInfo): { timing?: VideoTiming; issue?: string } {
	try {
		if ((mpd.getAttribute('type') || 'static') !== 'static') throw new Error('MPD is not static');
		if (periods.length !== 1) throw new Error('MPD does not have exactly one Period');
		const periodStart = period.hasAttribute('start') ? parseDuration(period.getAttribute('start')) : 0;
		if (periodStart === undefined) throw new Error('invalid Period start');
		const mpdDuration = mpd.hasAttribute('mediaPresentationDuration') ? parseDuration(mpd.getAttribute('mediaPresentationDuration')) : undefined;
		if (mpd.hasAttribute('mediaPresentationDuration') && mpdDuration === undefined) throw new Error('invalid MPD duration');
		const ownDuration = period.hasAttribute('duration') ? parseDuration(period.getAttribute('duration')) : undefined;
		if (period.hasAttribute('duration') && (!ownDuration || ownDuration <= 0)) throw new Error('invalid Period duration');
		const periodDuration = ownDuration ?? (mpdDuration === undefined ? undefined : mpdDuration - periodStart);
		if (periodDuration === undefined || periodDuration <= 0) throw new Error('Period duration is unknown');
		const fps = parseRational(inheritedAttribute(ancestors, 'frameRate'));
		if (!fps) throw new Error('video frame rate is unknown');
		if (ownDuration !== undefined && mpdDuration !== undefined && Math.abs(periodStart + ownDuration - mpdDuration) > VIDEO_SELECTION_DEFAULTS.durationToleranceFrames / fps)
			throw new Error('Period and MPD durations disagree');
		const timescaleRaw = address.attributes.timescale;
		const timescale = timescaleRaw === undefined ? 1 : safeInteger(timescaleRaw);
		if (!timescale || timescale <= 0) throw new Error('invalid addressing timescale');
		const ptoRaw = address.attributes.presentationTimeOffset;
		const pto = ptoRaw === undefined ? 0 : safeInteger(ptoRaw);
		if (pto === undefined || pto < 0) throw new Error('invalid presentation time offset');
		const templateDuration = address.type === 'SegmentTemplate' ? safeInteger(address.attributes.duration ?? null) : undefined;
		let timelineStart: number | undefined;
		let timelineEnd: number | undefined;
		if (address.timeline) {
			({ start: timelineStart, end: timelineEnd } = parseTimeline(address.timeline, periodStart, periodDuration, fps, timescale, pto));
		} else if (address.type === 'SegmentBase') {
			// SegmentBase exposes no first-sample timestamp. Declared Period metadata is the available boundary.
		} else if (address.type === 'SegmentTemplate' && templateDuration !== undefined && templateDuration > 0) {
			if (pto !== 0) throw new Error('non-zero presentation time offset has no SegmentTimeline mapping');
			const segmentDuration = templateDuration / timescale;
			const lastSegmentEnd = Math.ceil(periodDuration / segmentDuration) * segmentDuration;
			if (lastSegmentEnd - periodDuration > VIDEO_SELECTION_DEFAULTS.endToleranceFrames / fps) throw new Error('SegmentTemplate duration does not cover Period end');
			timelineStart = periodStart;
			timelineEnd = periodStart + periodDuration;
		} else {
			throw new Error('segment timing is unknown');
		}
		return {
			timing: {
				periodStart,
				periodDuration,
				fps,
				timescale,
				presentationTimeOffset: pto,
				addressing: address.type,
				...(timelineStart === undefined ? {} : { timelineStart }),
				...(timelineEnd === undefined ? {} : { timelineEnd })
			}
		};
	} catch (error) {
		return { issue: error instanceof Error ? error.message : 'timing is unknown' };
	}
}

function representationResourcePaths(address: AddressingInfo, base: URL): string[] {
	const paths: string[] = [];
	for (const [name, value] of Object.entries(address.attributes)) {
		if (isUrlValuedAttribute(name)) paths.push(safePath(value, base));
	}
	if (address.type === 'SegmentTemplate') {
		paths.push(safePath(address.attributes.media, base), safePath(address.attributes.initialization, base));
	} else if (address.type === 'SegmentList') {
		if (address.node) {
			for (const url of localChildren(address.node, 'SegmentURL')) {
				for (let index = 0; index < url.attributes.length; index++) {
					const attr = url.attributes.item(index);
					if (attr && isUrlValuedAttribute(attr.name)) paths.push(safePath(attr.value, base));
				}
			}
			const initializations = localChildren(address.node, 'Initialization');
			const initialization = initializations[initializations.length - 1];
			if (initialization) {
				for (let index = 0; index < initialization.attributes.length; index++) {
					const attr = initialization.attributes.item(index);
					if (attr && isUrlValuedAttribute(attr.name)) paths.push(safePath(attr.value, base));
				}
			}
		}
	} else if (address.type === 'SegmentBase') {
		paths.push(base.pathname);
		if (address.node) {
			const initializations = localChildren(address.node, 'Initialization');
			const initialization = initializations[initializations.length - 1];
			if (initialization) paths.push(safePath(initialization.getAttribute('sourceURL') ?? undefined, base));
		}
	} else {
		paths.push(base.pathname);
	}
	return [...new Set(paths.filter(Boolean))].sort();
}

function isUrlValuedAttribute(name: string): boolean {
	return ['media', 'initialization', 'index', 'sourceurl', 'href', 'url'].includes(name.split(':').pop()?.toLowerCase() ?? '');
}

function representationKey(
	source: VideoSource,
	family: VideoFamily,
	id: string,
	width: number,
	height: number,
	bandwidth: number,
	codecs: string,
	paths: string[],
	address: AddressingInfo
): string {
	const stableAttributes = Object.fromEntries(
		Object.entries(address.attributes)
			.filter(([name]) => !isUrlValuedAttribute(name))
			.sort(([left], [right]) => left.localeCompare(right))
	);
	return JSON.stringify([source.guid, family, id, width, height, bandwidth, codecs, paths, address.type, stableAttributes]);
}

/** Extract metadata-only video identities. Signed URL queries and generated media segments are not returned. */
export function inspectVideoManifest(xml: string, source: VideoSource, family: VideoFamily, manifestUrl: string, serverOrdinal = 1): CatalogVideo[] {
	if (!xml || !manifestUrl || !source.guid || !source.locale || !source.languageCode) return [];
	let doc: Document;
	const parserErrors: string[] = [];
	try {
		doc = new DOMParser({
			errorHandler: { warning: (message) => parserErrors.push(message), error: (message) => parserErrors.push(message), fatalError: (message) => parserErrors.push(message) }
		}).parseFromString(xml, 'application/xml');
	} catch {
		return [];
	}
	const mpd = doc.documentElement;
	if (parserErrors.length || !mpd || mpd.localName !== 'MPD') return [];
	let manifest: URL;
	try {
		manifest = new URL(manifestUrl);
	} catch {
		return [];
	}
	const periods = localChildren(mpd, 'Period');
	if ((mpd.hasAttribute('type') && mpd.getAttribute('type') !== 'static') || periods.length !== 1) return [];
	const refs: BaseRef[] = [{ url: manifest, server: manifest.host, baseUrlOrdinals: [0, 0, 0, 0] }];
	const mpdBases = resolveBaseRefs(refs, mpd, 0);
	const all: CatalogVideo[] = [];
	for (let periodIndex = 0; periodIndex < periods.length; periodIndex++) {
		const period = periods[periodIndex];
		const periodBases = resolveBaseRefs(mpdBases, period, 1);
		const adaptations = localChildren(period, 'AdaptationSet');
		for (let adaptationIndex = 0; adaptationIndex < adaptations.length; adaptationIndex++) {
			const adaptation = adaptations[adaptationIndex];
			const adaptationBases = resolveBaseRefs(periodBases, adaptation, 2);
			const representations = localChildren(adaptation, 'Representation');
			for (let representationIndex = 0; representationIndex < representations.length; representationIndex++) {
				const representation = representations[representationIndex];
				const mimeType = inheritedAttribute([mpd, period, adaptation, representation], 'mimeType') ?? '';
				const contentType = inheritedAttribute([mpd, period, adaptation, representation], 'contentType') ?? '';
				if (!/^video\//i.test(mimeType) && contentType.toLowerCase() !== 'video') continue;
				const width = finitePositive(inheritedAttribute([mpd, period, adaptation, representation], 'width'));
				const height = finitePositive(inheritedAttribute([mpd, period, adaptation, representation], 'height'));
				const bandwidth = finitePositive(inheritedAttribute([mpd, period, adaptation, representation], 'bandwidth'));
				if (!width || !height || !bandwidth) continue;
				const codecs = inheritedAttribute([mpd, period, adaptation, representation], 'codecs') ?? '';
				const address = addressingInfo([mpd, period, adaptation, representation]);
				const bases = resolveBaseRefs(adaptationBases, representation, 3);
				const timing = timingFor(mpd, periods, period, [mpd, period, adaptation, representation], address);
				for (const base of bases) {
					const paths = representationResourcePaths(address, base.url);
					const id = representation.getAttribute('id')?.trim() || `p${periodIndex + 1}a${adaptationIndex + 1}r${representationIndex + 1}`;
					all.push({
						source,
						family,
						representationId: id,
						representationKey: representationKey(source, family, id, width, height, bandwidth, codecs, paths, address),
						baseUrlOrdinals: [...base.baseUrlOrdinals] as [number, number, number, number],
						width,
						height,
						bandwidth,
						codecs,
						server: base.server,
						serverOrdinal: 0,
						periodOrdinal: periodIndex + 1,
						adaptationOrdinal: adaptationIndex + 1,
						representationOrdinal: representationIndex + 1,
						...(timing.timing ? { timing: timing.timing } : {}),
						...(timing.issue ? { timingIssue: timing.issue } : {})
					});
				}
			}
		}
	}
	const servers = [...new Set(all.map((item) => item.server))];
	const requestedIndex = Number.isInteger(serverOrdinal) && serverOrdinal > 0 ? serverOrdinal - 1 : 0;
	const selected = servers[requestedIndex] ?? servers[0];
	if (!selected) return [];
	const ordinal = servers.indexOf(selected) + 1;
	return all.filter((item) => item.server === selected).map((item) => ({ ...item, serverOrdinal: ordinal }));
}

/** Compare declared single-Period timing against every requested reference. */
export function timingCompatible(candidate: CatalogVideo, references: CatalogVideo[]): TimingCompatibility {
	if (!candidate.timing) return { compatible: false, reason: candidate.timingIssue ?? 'candidate timing is unknown' };
	if (!references.length) return { compatible: false, reason: 'no reference timing supplied' };
	for (const [index, reference] of references.entries()) {
		if (!reference.timing) return { compatible: false, reason: `reference ${index + 1} timing is unknown` };
		const a = candidate.timing;
		const b = reference.timing;
		const frameDuration = Math.max(1 / a.fps, 1 / b.fps);
		const aStart = a.timelineStart ?? a.periodStart;
		const bStart = b.timelineStart ?? b.periodStart;
		const aEnd = a.timelineEnd ?? a.periodStart + a.periodDuration;
		const bEnd = b.timelineEnd ?? b.periodStart + b.periodDuration;
		if (Math.abs(aStart - bStart) > VIDEO_SELECTION_DEFAULTS.startToleranceFrames * frameDuration)
			return { compatible: false, reason: `reference ${index + 1} normalized timeline start differs`, driftSeconds: Math.abs(aStart - bStart) };
		if (Math.abs(aEnd - bEnd) > VIDEO_SELECTION_DEFAULTS.endToleranceFrames * frameDuration)
			return { compatible: false, reason: `reference ${index + 1} normalized timeline end differs`, driftSeconds: Math.abs(aEnd - bEnd) };
		if (Math.abs(aEnd - aStart - (bEnd - bStart)) > VIDEO_SELECTION_DEFAULTS.durationToleranceFrames * frameDuration)
			return { compatible: false, reason: `reference ${index + 1} normalized timeline span differs`, driftSeconds: Math.abs(aEnd - aStart - (bEnd - bStart)) };
		if (Math.abs(a.fps - b.fps) * Math.max(a.periodDuration, b.periodDuration) > VIDEO_SELECTION_DEFAULTS.maxFrameRateDriftFrames)
			return {
				compatible: false,
				reason: `reference ${index + 1} frame rate differs`,
				driftSeconds: Math.abs(a.fps - b.fps) * Math.max(a.periodDuration, b.periodDuration) * frameDuration
			};
	}
	return { compatible: true };
}

/** Return ascending resolution/bandwidth order; q=0 consumers select the final entry. */
export function rankVideoCandidates(entries: CatalogVideo[], preferredGuids: string[] = []): CatalogVideo[] {
	const preferred = new Map(preferredGuids.map((guid, index) => [guid, index]));
	const familyOrder: Record<VideoFamily, number> = { 'Legacy 1': 0, 'Legacy 0': 1, Current: 2 };
	return entries
		.map((entry, index) => ({ entry, index }))
		.sort((left, right) => {
			const a = left.entry;
			const b = right.entry;
			return (
				a.height - b.height ||
				a.width - b.width ||
				a.bandwidth - b.bandwidth ||
				Number(preferred.has(a.source.guid)) - Number(preferred.has(b.source.guid)) ||
				(preferred.get(b.source.guid) ?? -1) - (preferred.get(a.source.guid) ?? -1) ||
				familyOrder[a.family] - familyOrder[b.family] ||
				a.serverOrdinal - b.serverOrdinal ||
				a.source.locale.localeCompare(b.source.locale) ||
				a.source.guid.localeCompare(b.source.guid) ||
				a.periodOrdinal - b.periodOrdinal ||
				a.adaptationOrdinal - b.adaptationOrdinal ||
				a.representationOrdinal - b.representationOrdinal ||
				a.representationKey.localeCompare(b.representationKey) ||
				left.index - right.index
			);
		})
		.map(({ entry }) => entry);
}

export function formatVideoCandidate(entry: CatalogVideo): string {
	const manifest = entry.family === 'Current' ? 'Current M' : 'Legacy M';
	return `${entry.width}x${entry.height} (${Math.round(entry.bandwidth / 1000)} kb/s) [${manifest}] [${entry.source.languageCode}]`;
}

export function formatGroupedVideoQualities(entries: Array<{ height?: number; text: string }>): string {
	const lines: string[] = [];
	let currentGroup: string | undefined;
	for (const [index, entry] of entries.entries()) {
		const height = entry.height;
		const group = typeof height === 'number' && Number.isFinite(height) && height > 0 ? `${height}p` : 'Other';
		if (group !== currentGroup) {
			lines.push(group);
			currentGroup = group;
		}
		lines.push(`\t[${index + 1}] ${entry.text}`);
	}
	return `\t${lines.join('\n\t')}`;
}
