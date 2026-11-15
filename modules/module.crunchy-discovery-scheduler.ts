import { VIDEO_SELECTION_DEFAULTS as limits } from './module.crunchy-video-catalog';

export type PlaybackWindow = { started: number; creditedSleep: number; admittedSleep: number; slotDeadline?: number };

/** Episode-local request pacing. Cleanup is counted but never delayed. */
export type DiscoveryClock = {
	now: () => number;
	wallNow: () => number;
	random: () => number;
	sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export const defaultDiscoveryClock: DiscoveryClock = {
	now: () => performance.now(),
	wallNow: () => Date.now(),
	random: () => Math.random(),
	sleep: (ms, signal) =>
		new Promise((resolve, reject) => {
			if (signal?.aborted) return reject(new Error('discovery cancelled'));
			const timer = setTimeout(() => {
				signal?.removeEventListener('abort', abort);
				resolve();
			}, ms);
			const abort = () => {
				clearTimeout(timer);
				signal?.removeEventListener('abort', abort);
				reject(new Error('discovery cancelled'));
			};
			signal?.addEventListener('abort', abort, { once: true });
		})
};

// RFC 9110 HTTP-date accepts IMF-fixdate and both obsolete forms.
function httpDate(value: string | null, referenceNow: number): number | undefined {
	if (!value) return undefined;
	const forms = [
		/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/,
		/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} \d{2}:\d{2}:\d{2} GMT$/,
		/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?: \d|\d{2}) \d{2}:\d{2}:\d{2} \d{4}$/
	];
	if (!forms.some((form) => form.test(value))) return undefined;
	let normalized = value;
	if (forms[1].test(value)) {
		// RFC850 uses a rolling century, not Date.parse's fixed 1950/2050 pivot.
		const year = Number(value.match(/-(\d{2}) /)![1]);
		const reference = new Date(referenceNow);
		let fullYear = Math.floor(reference.getUTCFullYear() / 100) * 100 + year;
		const futureLimit = new Date(referenceNow);
		futureLimit.setUTCFullYear(reference.getUTCFullYear() + 50);
		const withYear = () => value.replace(/-\d{2} /, '-' + fullYear + ' ');
		if (Date.parse(withYear()) > futureLimit.getTime()) fullYear -= 100;
		normalized = withYear();
	}
	const parsed = Date.parse(forms[2].test(normalized) ? `${normalized} GMT` : normalized);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export function retryAfterMs(value: string | null, serverDate: string | null, wallNow: number): number | undefined {
	if (value === null) return undefined;
	const trimmed = value.trim();
	if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
	const reference = httpDate(serverDate?.trim() ?? null, wallNow) ?? wallNow;
	const date = httpDate(trimmed, reference);
	if (date === undefined) return undefined;
	return Math.max(0, date - reference);
}

export class DiscoveryScheduler {
	private count = 0;
	private lastStart = 0;
	private gap: number | undefined;
	private normalWait = 0;
	private retries = 0;
	private cooldownUntil = 0;
	private cooldownTotal = 0;
	private retryKind: 'manifest' | 'playback' = 'manifest';
	private readonly window: PlaybackWindow;
	private readonly scale: number;
	observedRateLimit = false;
	constructor(
		maxCalls: number,
		readonly clock: DiscoveryClock = defaultDiscoveryClock,
		private readonly signal?: AbortSignal,
		private readonly waiting?: (retry: number, ms: number, kind: 'manifest' | 'playback') => void,
		private readonly fixedPauseMs?: number,
		window?: PlaybackWindow
	) {
		if (fixedPauseMs !== undefined && (!Number.isSafeInteger(fixedPauseMs) || fixedPauseMs < 0)) throw new Error('discovery timer must be a nonnegative safe integer');
		this.window = window ?? { started: clock.now(), creditedSleep: 0, admittedSleep: 0 };
		const boundaries = Math.max(0, Math.ceil(maxCalls / limits.discoveryBatchSize) - 1);
		this.scale = boundaries ? Math.min(1, limits.discoveryNormalWaitBudgetMs / (limits.discoveryGapMaxMs * boundaries)) : 1;
	}
	remaining(): number {
		return limits.discoveryTimeoutMs - (this.clock.now() - this.window.started - this.window.creditedSleep);
	}
	check(): void {
		if (this.signal?.aborted) throw new Error('discovery cancelled');
		if (this.remaining() <= 0) throw new Error('discovery deadline exceeded');
	}
	getWindow(): PlaybackWindow {
		return this.window;
	}
	async playbackSleep(ms: number): Promise<void> {
		this.check();
		if (!Number.isFinite(ms) || ms < 0 || ms > 60000 || this.window.admittedSleep + ms > 120000) throw new Error('playback wait exceeds budget');
		this.window.admittedSleep += ms;
		const before = this.clock.now();
		await this.clock.sleep(ms, this.signal);
		this.window.creditedSleep += Math.min(ms, Math.max(0, this.clock.now() - before));
		this.check();
	}
	reservePlaybackRetry(): void {
		this.check();
		if (this.retries >= limits.discoveryRetryCooldownMs.length) throw new Error('playback retries exhausted');
		this.retryKind = 'playback';
		this.observedRateLimit = true;
		this.retries++;
		this.gap = undefined;
	}
	async waitPlayback(headers: Headers, ordinal: number, refusedAt = this.clock.now(), refusedWall = this.clock.wallNow()): Promise<void> {
		this.check();
		const delay = Math.max([10000, 30000, 60000][ordinal - 1], retryAfterMs(headers.get('retry-after'), headers.get('date'), refusedWall) ?? 0);
		if (!Number.isFinite(delay) || delay > 60000) throw new Error('playback wait exceeds budget');
		const remaining = Math.max(0, refusedAt + delay - this.clock.now());
		if (this.window.admittedSleep + remaining > 120000) throw new Error('playback wait exceeds budget');
		this.waiting?.(this.retries, remaining, 'playback');
		if (remaining) await this.playbackSleep(remaining);
		this.waiting?.(0, 0, 'playback');
	}
	async waitServerDelay(headers: Headers, refusedAt: number, refusedWall = this.clock.wallNow()): Promise<void> {
		const delay = retryAfterMs(headers.get('retry-after'), headers.get('date'), refusedWall) ?? 0;
		if (!Number.isFinite(delay) || delay > 60000) throw new Error('playback wait exceeds budget');
		const remaining = Math.max(0, refusedAt + delay - this.clock.now());
		if (remaining) {
			this.waiting?.(this.retries, remaining, 'playback');
			await this.playbackSleep(remaining);
			this.waiting?.(0, 0, 'playback');
		}
	}
	async dispatch(cleanup = false, slotDeadline?: number): Promise<void> {
		if (!cleanup) {
			this.check();
			const allowance = this.retries ? limits.discoveryRetryBatchSizes[this.retries - 1] : limits.discoveryBatchSize;
			if (this.count >= allowance && this.gap === undefined)
				this.gap = this.retries
					? limits.discoveryRetryGapMs[this.retries - 1]
					: (this.fixedPauseMs ?? (limits.discoveryGapMinMs + (limits.discoveryGapMaxMs - limits.discoveryGapMinMs) * this.clock.random()) * this.scale);
			const boundaryWait =
				this.gap === undefined ? 0 : !this.retries && this.fixedPauseMs !== undefined ? this.gap : Math.max(0, this.lastStart + this.gap - this.clock.now());
			const normal =
				this.retries || this.fixedPauseMs !== undefined ? boundaryWait : Math.min(boundaryWait, Math.max(0, limits.discoveryNormalWaitBudgetMs - this.normalWait));
			const cooldown = Math.max(0, this.cooldownUntil - this.clock.now());
			const wait = Math.max(normal, cooldown);
			if (wait >= this.remaining()) throw new Error('discovery deadline exceeded');
			if (slotDeadline !== undefined && wait >= slotDeadline - this.clock.now()) {
				const left = Math.max(0, slotDeadline - this.clock.now());
				if (left) await this.playbackSleep(left);
				throw new Error('playback slot wait timed out');
			}
			if (wait > 0) {
				if (cooldown) this.waiting?.(this.retries, cooldown, this.retryKind);
				await this.clock.sleep(wait, this.signal);
				if (cooldown) this.waiting?.(0, 0, this.retryKind);
				if (!this.retries) this.normalWait += Math.min(normal, wait);
			}
			this.check();
			if (this.gap !== undefined || this.cooldownUntil) {
				this.count = 0;
				this.gap = undefined;
				this.cooldownUntil = 0;
			}
		}
		this.lastStart = this.clock.now();
		this.count++;
	}
	retry(headers: Headers, kind: 'manifest' | 'playback' = 'manifest'): void {
		this.retryKind = kind;
		this.observedRateLimit = true;
		if (this.retries >= limits.discoveryRetryCooldownMs.length) throw new Error('manifest rate limited: retries exhausted');
		const delay = Math.max(limits.discoveryRetryCooldownMs[this.retries], retryAfterMs(headers.get('retry-after'), headers.get('date'), this.clock.wallNow()) ?? 0);
		if (!Number.isFinite(delay) || this.cooldownTotal + delay > limits.discoveryRateWaitBudgetMs || delay >= this.remaining())
			throw new Error('manifest rate limited: cooldown exceeds budget');
		this.cooldownTotal += delay;
		this.retries++;
		this.cooldownUntil = this.clock.now() + delay;
		this.gap = undefined;
	}
}
