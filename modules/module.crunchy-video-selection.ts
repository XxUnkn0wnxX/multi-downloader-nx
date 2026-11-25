import { console } from './log';
import { DiscoveryClock, DiscoveryScheduler } from './module.crunchy-discovery-scheduler';
import { PlaybackRecoveryBudget, PlaybackRefusal } from './module.crunchy-playback-recovery';
import { FetchParams, Req } from './module.fetch';
import { legacyUrls } from './module.crunchy-manifests';
import { CatalogVideo, inspectVideoManifest, rankVideoCandidates, timingCompatible, VideoFamily, VideoSource, VIDEO_SELECTION_DEFAULTS } from './module.crunchy-video-catalog';

async function requestWithTimeout<T>(
	operation: (signal: AbortSignal) => Promise<T>,
	timeoutMs: number,
	onLate?: (value: T) => Promise<void>,
	outerSignal?: AbortSignal
): Promise<T> {
	if (outerSignal?.aborted) throw new Error('discovery cancelled');
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let timedOut = false;
	let consumed = false;
	let settled = false;
	let delivered: T;
	let lateHandled = false;
	const handleLate = () => {
		if (!settled || consumed || lateHandled || !onLate) return;
		lateHandled = true;
		void onLate(delivered).catch(() => console.warn('Failed to close a late playback session'));
	};
	const pending = Promise.resolve()
		.then(() => {
			if (outerSignal?.aborted) throw new Error('discovery cancelled');
			return operation(controller.signal);
		})
		.then((value) => {
			settled = true;
			delivered = value;
			if (timedOut) handleLate();
			return value;
		});
	let rejectAbort: ((reason: Error) => void) | undefined;
	const abort = () => {
		timedOut = true;
		controller.abort();
		handleLate();
		rejectAbort?.(new Error('discovery cancelled'));
	};
	try {
		outerSignal?.addEventListener('abort', abort, { once: true });
		const value = await Promise.race([
			pending,
			new Promise<never>((_, reject) => {
				rejectAbort = reject;
			}),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					timedOut = true;
					controller.abort();
					handleLate();
					reject(new Error('request deadline exceeded'));
				}, timeoutMs);
			})
		]);
		if (timedOut || outerSignal?.aborted) {
			handleLate();
			throw new Error('discovery cancelled');
		}
		consumed = true;
		return value;
	} finally {
		outerSignal?.removeEventListener('abort', abort);
		if (timer) clearTimeout(timer);
	}
}

export async function boundedRequest<T>(
	operation: (signal: AbortSignal) => Promise<T>,
	onLate?: (value: T) => Promise<void>,
	outerSignal?: AbortSignal,
	timeoutMs: number = VIDEO_SELECTION_DEFAULTS.requestTimeoutMs
): Promise<T> {
	return requestWithTimeout(operation, Math.min(timeoutMs, VIDEO_SELECTION_DEFAULTS.requestTimeoutMs), onLate, outerSignal);
}

export async function readLimitedManifest(response: Response): Promise<string> {
	const declared = Number(response.headers?.get('content-length') ?? 0);
	if (declared > VIDEO_SELECTION_DEFAULTS.maxManifestBytes) {
		try {
			await response.body?.cancel();
		} catch {
			/* Preserve the size-limit error. */
		}
		throw new Error('manifest too large');
	}
	const reader = response.body?.getReader();
	if (!reader) {
		const text = await response.text();
		if (Buffer.byteLength(text) > VIDEO_SELECTION_DEFAULTS.maxManifestBytes) throw new Error('manifest too large');
		return text;
	}
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			size += chunk.value.byteLength;
			if (size > VIDEO_SELECTION_DEFAULTS.maxManifestBytes) {
				await reader.cancel();
				throw new Error('manifest too large');
			}
			chunks.push(chunk.value);
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(chunks).toString('utf8');
}

export type PlaybackLease = { token: string; url: string };
type ProbeInput = {
	req: Req;
	headers: FetchParams;
	manifestHeaders?: (url: string) => FetchParams;
	sources: VideoSource[];
	requested: string[];
	ordinal: number;
	ignoreTiming: boolean;
	debug: boolean;
	signal?: AbortSignal;
	clock?: DiscoveryClock;
	onWaiting?: (retry: number, ms: number, kind: 'manifest' | 'playback', playbackRetry: number) => void;
	recoveryBudget?: PlaybackRecoveryBudget;
	scheduler?: DiscoveryScheduler;
	replayLimit?: () => number;
	recover?: (attempt: number, scheduler: DiscoveryScheduler, signal: AbortSignal | undefined, headers: Headers, refusedAt: number, refusedWall: number) => Promise<boolean>;
	fixedPauseMs?: number;
	qall?: boolean;
	onSlow?: () => void;
	onAcquired?: () => void;
	acquire: (source: VideoSource, signal: AbortSignal) => Promise<PlaybackLease>;
	close: (source: VideoSource, token: string, signal: AbortSignal) => Promise<boolean>;
	prepareDownload?: (source: VideoSource, signal: AbortSignal) => Promise<{ status: 'ok'; token?: string; url?: string } | { status: 'unavailable' }>;
	resolve?: (source: VideoSource, lease: PlaybackLease, downloadUrl: string) => string;
};

/** Metadata-only sequential probes. A failed/unknown lease closure stops the entire discovery. */
export type DiscoveryResult =
	| { status: 'ok'; entries: CatalogVideo[]; references: CatalogVideo[]; timingFallbackReason?: string }
	| { status: 'fallback'; reason: string }
	| { status: 'unsafe'; reason?: string }
	| { status: 'rate-limited'; reason: string }
	| { status: 'cancelled' };

export async function discoverVideoCandidates(input: ProbeInput): Promise<DiscoveryResult> {
	if (input.signal?.aborted) return { status: 'cancelled' };
	const byGuid = new Map<string, VideoSource>();
	for (const source of input.sources) {
		const previous = byGuid.get(source.guid);
		if (previous && (previous.locale !== source.locale || previous.languageCode !== source.languageCode)) return { status: 'fallback', reason: 'version metadata unavailable' };
		byGuid.set(source.guid, source);
	}
	const sources = [...byGuid.values()];
	if (!sources.length || sources.length > VIDEO_SELECTION_DEFAULTS.maxVersions || !input.requested.length) return { status: 'fallback', reason: 'version metadata unavailable' };

	let playbackRetry = 0;
	const scheduler =
		input.scheduler ??
		new DiscoveryScheduler(
			sources.length * (input.prepareDownload ? 7 : 5),
			input.clock,
			input.signal,
			(retry, ms, kind) => input.onWaiting?.(retry, ms, kind, playbackRetry),
			input.fixedPauseMs,
			undefined,
			input.qall,
			input.onSlow
		);
	const entries: CatalogVideo[] = [];
	const references: CatalogVideo[] = [];
	const deadline = async <T>(operation: (signal: AbortSignal) => Promise<T>, cleanup = false, onLate?: (value: T) => Promise<void>): Promise<T> => {
		await scheduler.dispatch(cleanup);
		const remaining = cleanup ? VIDEO_SELECTION_DEFAULTS.requestTimeoutMs : scheduler.remaining();
		if (remaining <= 0) throw new Error('discovery deadline exceeded');
		return requestWithTimeout(operation, Math.min(remaining, VIDEO_SELECTION_DEFAULTS.requestTimeoutMs), onLate, cleanup ? undefined : input.signal);
	};

	let replay = 0;
	for (const source of sources) {
		for (;;) {
			let refusal: PlaybackRefusal | undefined;
			let refusedAt = 0;
			let refusedWall = 0;
			let lease: PlaybackLease | undefined;
			let failed = false;
			let terminalRateFailure = false;
			let unsafe = false;
			let cleanupFailed = false;
			let acquireStarted = false;
			let preparationUncertain = false;
			let fallbackReason = 'metadata unavailable';
			try {
				let downloadUrl: string | undefined;
				if (input.prepareDownload) {
					const prepared = await deadline(
						(signal) => {
							preparationUncertain = true;
							return input.prepareDownload!(source, signal);
						},
						false,
						async (late) => {
							if (late.status === 'ok' && late.token && !(await deadline((signal) => input.close(source, late.token!, signal), true)))
								console.warn('Failed to close a late download session');
						}
					);
					if (prepared.status === 'unavailable') preparationUncertain = false;
					else {
						if (!prepared.token) throw new Error('unknown download session');
						if (!(await deadline((signal) => input.close(source, prepared.token!, signal), true))) {
							cleanupFailed = true;
							throw new Error('download session cleanup failed');
						}
						preparationUncertain = false;
						if (!prepared.url || !/^https?:\/\//i.test(prepared.url)) throw new Error('invalid download URL');
						downloadUrl = prepared.url;
					}
				}

				lease = await deadline(
					(signal) => {
						acquireStarted = true;
						return input.acquire(source, signal);
					},
					false,
					async (late) => {
						if (late.token && !(await deadline((signal) => input.close(source, late.token, signal), true))) console.warn('Failed to close a late playback session');
					}
				);
				if (!lease?.token || !lease.url) throw new Error('invalid playback lease');
				input.onAcquired?.();
				if (downloadUrl && input.resolve) lease = { ...lease, url: input.resolve(source, lease, downloadUrl) };
				if (!/\.mpd(?:[?#]|$)/i.test(lease.url)) throw new Error('unsupported playback manifest');
				const candidates: { family: VideoFamily; url: string }[] = [{ family: 'Current', url: lease.url }];
				for (const url of legacyUrls(lease.url)) candidates.push({ family: /\/0\/clean\/dash\//.test(url.split(/[?#]/, 1)[0]) ? 'Legacy 0' : 'Legacy 1', url });
				for (const candidate of candidates) {
					try {
						if (input.debug) console.debug(`[DEBUG] ${source.guid} ${candidate.family} manifest request: ${candidate.url}`);
						let body: string;
						for (;;) {
							let limited: Response | undefined;
							try {
								body = await deadline(async (signal) => {
									const response = await input.req.getData(candidate.url, {
										...(input.manifestHeaders?.(candidate.url) ?? input.headers),
										quietErrors: true,
										signal,
										skipErrorBody: true,
										onResponse: (res) => {
											if (res.status === 429) {
												limited = res;
												scheduler.observedRateLimit = true;
											}
										}
									});
									const status = response.res?.status ?? response.error?.res?.status;
									if (input.debug) console.debug(`[DEBUG] ${source.guid} ${candidate.family} manifest status: ${status ?? 'request failed'}`);
									if (status === 429) {
										limited = response.res ?? response.error?.res;
										scheduler.observedRateLimit = true;
										throw new Error('manifest rate limited');
									}
									if (!response.ok || !response.res) throw new Error('manifest unavailable');
									return readLimitedManifest(response.res);
								});
								break;
							} catch (error) {
								if (!limited || !/manifest rate limited/.test(String(error))) throw error;
								scheduler.retry(limited.headers);
							}
						}
						const tracks = inspectVideoManifest(body, source, candidate.family, candidate.url, input.ordinal);
						if (input.debug) console.debug(`[DEBUG] ${source.guid} ${candidate.family} parsed ${tracks.length} tracks`);
						if (!tracks.length && candidate.family === 'Current') throw new Error('unusable current manifest');
						entries.push(...tracks);
						if (candidate.family === 'Current' && input.requested.includes(source.guid)) {
							const ranked = rankVideoCandidates(tracks, input.requested);
							if (ranked.length) references.push(ranked[ranked.length - 1]);
						}
					} catch (error) {
						if (input.debug) console.debug(`[DEBUG] ${source.guid} ${candidate.family} excluded: ${String(error)}`);
						if (candidate.family === 'Current' || /rate limited|deadline exceeded|cancelled/.test(String(error))) throw error;
					}
				}
			} catch (error) {
				failed = true;
				if (error instanceof PlaybackRefusal && input.recoveryBudget && input.recover && replay < (input.replayLimit?.() ?? 3)) {
					try {
						refusedAt = scheduler.clock.now();
						refusedWall = scheduler.clock.wallNow();
						scheduler.reservePlaybackRetry();
						refusal = error;
						playbackRetry = replay + 1;
						acquireStarted = false;
						preparationUncertain = false;
					} catch {
						/* Exhausted budget or deadline is terminal. */
					}
				}
				terminalRateFailure = /rate limited|deadline exceeded/.test(String(error));
				if (/rate limited|HTTP 429/.test(String(error))) fallbackReason = String(error).replace(/^Error: /, '');
				else if (/deadline exceeded/.test(String(error))) fallbackReason = 'discovery timed out';
				else if (/unsupported playback manifest|unusable current manifest/.test(String(error))) fallbackReason = 'unsupported manifest';
				else if (/manifest too large/.test(String(error))) fallbackReason = 'manifest too large';
				unsafe = preparationUncertain || (!lease?.token && acquireStarted) || /session limit|invalid download URL|download session cleanup failed/.test(String(error));
				if (input.debug) console.debug(`[DEBUG] ${source.guid} discovery stopped: ${String(error)}`);
			} finally {
				if (lease?.token) {
					try {
						if (!(await deadline((signal) => input.close(source, lease!.token, signal), true))) {
							failed = true;
							unsafe = true;
							cleanupFailed = true;
						}
					} catch {
						failed = true;
						unsafe = true;
						cleanupFailed = true;
					}
				} else if (acquireStarted) {
					failed = true;
					unsafe = true;
				}
			}
			if (failed) {
				if (refusal && !cleanupFailed && !unsafe) {
					try {
						if (await input.recover!(replay + 1, scheduler, input.signal, refusal.headers, refusedAt, refusedWall)) {
							replay++;
							continue;
						}
					} catch {
						/* A failed reset/check or deadline is terminal. */
					}
					return { status: 'unsafe', reason: 'playback recovery failed' };
				}
				if (cleanupFailed || unsafe) return { status: 'unsafe', reason: cleanupFailed ? 'session cleanup failed' : fallbackReason };
				if (input.signal?.aborted) return { status: 'cancelled' };
				const expired = scheduler.remaining() <= 0;
				if (terminalRateFailure || expired) return { status: 'rate-limited', reason: expired ? 'discovery timed out' : fallbackReason };
				return { status: 'fallback', reason: fallbackReason };
			}
			break;
		}
	}
	if (input.signal?.aborted) return { status: 'cancelled' };
	if (scheduler.remaining() <= 0) return { status: 'rate-limited', reason: 'discovery timed out' };
	if (references.length !== new Set(input.requested).size) return { status: 'fallback', reason: 'metadata unavailable' };
	const ranked = rankVideoCandidates([...new Map(entries.map((entry) => [entry.representationKey, entry])).values()], input.requested);
	const eligible = ranked.filter((item) => {
		const result = timingCompatible(item, references);
		if (!result.compatible && input.debug) console.debug(`[DEBUG] ${item.source.guid} ${item.family} ${item.representationId} timing: ${result.reason}`);
		return input.ignoreTiming || result.compatible;
	});
	const best = ranked[ranked.length - 1];
	const chosen = eligible[eligible.length - 1];
	const better =
		best &&
		(!chosen ||
			best.height > chosen.height ||
			(best.height === chosen.height && (best.width > chosen.width || (best.width === chosen.width && best.bandwidth > chosen.bandwidth))));
	const timing = best && !input.ignoreTiming && better ? timingCompatible(best, references) : undefined;
	const timingFallbackReason =
		timing && !timing.compatible
			? timing.reason?.endsWith('frame rate differs')
				? 'frame rate differs'
				: timing.driftSeconds === undefined || !Number.isFinite(timing.driftSeconds)
					? 'timing unknown'
					: `timing drift ${timing.driftSeconds.toFixed(2)}s`
			: undefined;
	return { status: 'ok', entries: eligible, references, timingFallbackReason };
}
