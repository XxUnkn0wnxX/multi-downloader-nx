import type { DiscoveryScheduler } from './module.crunchy-discovery-scheduler';
import type { WorkingIndicator } from './module.working-indicator';

/** One account-wide clear per command, shared by all archive entries. */
export type PlaybackRecoveryBudget = { used: boolean };

/** A fully read provider refusal; this does not establish session nonallocation. */
export class PlaybackRefusal extends Error {
	constructor(readonly headers: Headers) {
		super('playback HTTP 429 (provider 4294)');
	}
}

/** Only the complete, exact requested response is eligible for recovery. */
export function isPlaybackRefusal(status: number | undefined, body: string): boolean {
	if (status !== 429) return false;
	try {
		const value: unknown = JSON.parse(body);
		if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
		const record = value as Record<string, unknown>;
		return Object.keys(record).length === 2 && record.error === 4294 && record.reason === 'Too many requests';
	} catch {
		return false;
	}
}

export type PlaybackSession = { contentId: string; token: string };
export const MAX_PLAYBACK_SESSIONS = 32;

/** Invalid or contradictory entitlement metadata never authorizes a reset. */
export function concurrentStreamLimit(payload: unknown): number | undefined {
	if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { items?: unknown }).items)) return undefined;
	const matches = new Set<number>();
	for (const item of (payload as { items: unknown[] }).items) {
		if (!item || typeof item !== 'object' || typeof (item as { benefit?: unknown }).benefit !== 'string') continue;
		const benefit = (item as { benefit: string }).benefit;
		if (!benefit.startsWith('concurrent_streams')) continue;
		const match = /^concurrent_streams\.(\d+)$/.exec(benefit);
		if (!match) return undefined;
		const value = Number(match[1]);
		if (!Number.isSafeInteger(value) || value <= 0) return undefined;
		matches.add(value);
	}
	return matches.size === 1 ? [...matches][0] : undefined;
}

/** A malformed list is unknown; it must never be treated as empty. */
export function playbackSessions(payload: unknown): PlaybackSession[] | undefined {
	if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { items?: unknown }).items)) return undefined;
	const record = payload as Record<string, unknown>;
	const items = record.items as unknown[];
	const complete = (meta: Record<string, unknown>): boolean => {
		for (const key of ['total', 'total_count']) {
			if (key in meta && (!Number.isSafeInteger(meta[key]) || meta[key] !== items.length)) return false;
		}
		for (const key of ['next', 'next_page', 'nextPage', 'next_cursor', 'nextCursor']) {
			if (key in meta && meta[key] !== null && meta[key] !== undefined && meta[key] !== '') return false;
		}
		for (const key of ['has_more', 'hasMore']) if (key in meta && meta[key] !== false) return false;
		for (const key of ['total_pages', 'totalPages']) if (key in meta && meta[key] !== 1) return false;
		return true;
	};
	if (!complete(record)) return undefined;
	for (const key of ['meta', 'metadata', 'pagination', 'links']) {
		if (!(key in record) || record[key] === null || record[key] === undefined) continue;
		const value = record[key];
		if (typeof value !== 'object' || Array.isArray(value) || !complete(value as Record<string, unknown>)) return undefined;
	}
	const unique = new Map<string, PlaybackSession>();
	for (const item of (payload as { items: unknown[] }).items) {
		if (!item || typeof item !== 'object') return undefined;
		const { contentId, token } = item as { contentId?: unknown; token?: unknown };
		if (typeof contentId !== 'string' || !contentId.trim() || typeof token !== 'string' || !token.trim()) return undefined;
		unique.set(JSON.stringify([contentId, token]), { contentId, token });
		if (unique.size > MAX_PLAYBACK_SESSIONS) return undefined;
	}
	return [...unique.values()];
}

export type PlaybackRecoveryState = {
	budget: PlaybackRecoveryBudget;
	permitClear: boolean;
	preflightChecked: boolean;
	resetPerformed: boolean;
	noticeShown: boolean;
	ordinal: number;
	initial?: { scheduler: DiscoveryScheduler; controller: AbortController; indicator: WorkingIndicator; release: () => void };
	capacityCache?: { binding: string; limit: number };
};
