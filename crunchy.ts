// build-in
import path from 'path';
import fs from 'fs';

// package program
import packageJson from './package.json';
import { displayVersion } from './modules/module.fork-display';

// plugins
import { console } from './modules/log';
import streamdl, { M3U8Json } from './modules/hls-download';
import Helper from './modules/module.helper';
import { Parser } from 'm3u8-parser';

// custom modules
import * as fontsData from './modules/module.fontsData';
import * as langsData from './modules/module.langsData';
import * as yamlCfg from './modules/module.cfg-loader';
import * as yargs from './modules/module.app-args';
import Merger, { Font, MergerInput, SubtitleInput } from './modules/module.merger';
import { canDecrypt, getKeysPRD, getKeysWVD, cdm } from './modules/cdm';

// load req
import { domain, api } from './modules/module.api-urls';
import * as reqModule from './modules/module.fetch';
import { CrunchySearch } from './@types/crunchySearch';
import { CrunchyEpisodeList, CrunchyEpisode } from './@types/crunchyEpisodeList';
import {
	CrunchyDownloadOptions,
	CrunchyEpMeta,
	CrunchyMuxOptions,
	CrunchyMultiDownload,
	DownloadedMedia,
	ParseItem,
	SeriesSearch,
	SeriesSearchItem,
	EpisodeVersion
} from './@types/crunchyTypes';
import { ObjectInfo } from './@types/objectInfo';
import parseFileName, { Variable } from './modules/module.filename';
import { CrunchyStreams, PlaybackData } from './@types/playbackData';
import { downloaded } from './modules/module.downloadArchive';
import parseSelect from './modules/module.parseSelect';
import { AvailableFilenameVars, getDefault } from './modules/module.args';
import { AuthData, AuthResponse, Episode, ResponseBase, SearchData, SearchResponse, SearchResponseItem } from './@types/messageHandler';
import { ServiceClass } from './@types/serviceClassInterface';
import { CrunchyAndroidEpisodes } from './@types/crunchyAndroidEpisodes';
import { parse } from './modules/module.transform-mpd';
import { legacyUrls, optionalManifests, videoQualities } from './modules/module.crunchy-manifests';
import {
	CatalogVideo,
	formatGroupedVideoQualities,
	formatVideoCandidate,
	formatVideoQualityRow,
	inspectVideoManifest,
	rankVideoCandidates,
	timingCompatible,
	VideoSource,
	VIDEO_SELECTION_DEFAULTS
} from './modules/module.crunchy-video-catalog';
import { boundedRequest, discoverVideoCandidates, readLimitedManifest } from './modules/module.crunchy-video-selection';
import {
	PlaybackRecoveryBudget,
	PlaybackRefusal,
	isPlaybackRefusal,
	concurrentStreamLimit,
	playbackSessions,
	PlaybackSession,
	PlaybackRecoveryState
} from './modules/module.crunchy-playback-recovery';
import { DiscoveryScheduler, retryAfterMs } from './modules/module.crunchy-discovery-scheduler';
import { WorkingIndicator } from './modules/module.working-indicator';
import { accountBinding, formatLocalRetryTime, formatPlaybackDuration, observePlaybackWait, readPlaybackWait } from './modules/module.crunchy-playback-status';
import { AndroidObject, CrunchyAndroidObject, CrunchyMVObject } from './@types/crunchyAndroidObject';
import { CrunchyChapters, CrunchyChapter, CrunchyOldChapter } from './@types/crunchyChapters';
import vtt2ass from './modules/module.vtt2ass';
import { CrunchyPlayStream } from './@types/crunchyPlayStreams';
import { CrunchyVideoPlayStreams, CrunchyAudioPlayStreams } from './@types/enums';
import { randomUUID } from 'node:crypto';
import { FetchParams } from './modules/module.fetch';
import { CrunchyTokenInputError, parseCrunchyTokenInput } from './modules/module.crunchy-token';
import { loginWithPhone, PHONE_CALLBACK_INVALID, PHONE_CLIENT_REQUIRED, refreshPhoneToken } from './modules/module.crunchy-phone-auth';
import { crunchyCliAuthDecision, crunchyLoginInstruction } from './modules/module.crunchy-cli-auth';
import { CrunchySession, CrunchySessionSlot, crunchySessionSlot } from './modules/module.crunchy-session-store';
import {
	requestDeviceToken,
	validDeviceToken,
	refreshCredentialsRejected,
	getDeviceName,
	DEVICE_TYPE,
	DEVICE_USER_AGENT,
	DEVICE_BETA_WARNING,
	deviceAuthAttempt,
	deviceFallbackEligible,
	deviceErrorDetails
} from './modules/module.crunchy-device-auth';

type VideoEndpoint = keyof typeof CrunchyVideoPlayStreams;
type PlaybackRole = 'Video' | 'Audio' | 'Subtitle metadata';
type PlaybackAuthFailure = 'invalid' | 'unavailable' | 'account';
type PlaybackSessionCheck = { session: CrunchySession } | { failure: PlaybackAuthFailure };
const playbackSignIns = {
	androidtv: { session: 'Android TV', command: '--device androidtv' },
	android: { session: 'Android phone', command: '--device android' },
	web: { session: 'web', command: '--token' }
} as const;
type PlaybackSlot = keyof typeof playbackSignIns;

function playbackSlot(endpoint: VideoEndpoint): PlaybackSlot {
	return endpoint === 'androidtv' ? 'androidtv' : endpoint === 'android' || endpoint === 'androidtab' ? 'android' : 'web';
}

function playbackAuthError(role: PlaybackRole, endpoint: VideoEndpoint, failure: PlaybackAuthFailure): void {
	const prefix = `${role} endpoint "${endpoint}"`;
	const { session, command } = playbackSignIns[playbackSlot(endpoint)];
	if (failure === 'unavailable') {
		console.error(`${prefix} could not refresh the saved session. Retry later.`);
	} else if (failure === 'account') {
		console.error(
			`${prefix} requires a session for the active Crunchyroll account. Sign in using the same account.\n${crunchyLoginInstruction(command)}\nWhen AniDL confirms you’re signed in, run your download command again.`
		);
	} else {
		console.error(
			`${prefix} has no valid ${session} session. Sign in first.\n${crunchyLoginInstruction(command)}\nWhen AniDL confirms you’re signed in, run your download command again.`
		);
	}
}

async function playbackCredentialsRejected(response?: Response): Promise<boolean> {
	if (response?.status === 401) return true;
	if (!response || (response.status !== 400 && response.status !== 403)) return false;
	try {
		const body = JSON.parse(await readLimitedManifest(response));
		const code = body?.error?.code ?? body?.errors?.[0]?.code ?? body?.code ?? body?.error;
		return code === 40016 || code === '40016';
	} catch {
		return false;
	}
}

type PlaybackAuth = {
	endpoint: VideoEndpoint;
	session: CrunchySession;
	slot: CrunchySessionSlot;
	origin: string;
	prefix: string;
};
type PlaybackRouting = { video: PlaybackAuth; audio: PlaybackAuth };
type PlaybackSelection = Pick<CrunchyDownloadOptions, 'cstream' | 'vstream' | 'astream' | 'novids' | 'noaudio'>;

type GlobalVideoPass = {
	kind: 'video' | 'audio';
	selected: CatalogVideo;
	references: CatalogVideo[];
	ignoreTiming: boolean;
	requestedName?: string;
	selectionLost?: boolean;
	cleanupFailed?: boolean;
	noRetry?: boolean;
	bypassSync?: boolean;
	forceWarning?: boolean;
	onSelectionConfirmed?: (entry: CatalogVideo) => void;
};

export type sxItem = {
	language: langsData.LanguageItem;
	path: string;
	file: string;
	title: string;
	fonts: Font[];
};

export default class Crunchy implements ServiceClass {
	public cfg: yamlCfg.ConfigObject;
	public locale: string;
	private token: Record<string, any>;
	private req: reqModule.Req;
	private refreshInFlight?: Promise<boolean>;
	private cmsToken: {
		cms?: Record<string, string>;
		cms_beta?: Record<string, string>;
		cms_web?: Record<string, string>;
	} = {};

	constructor(
		private debug = false,
		private readonly commandRecovery?: PlaybackRecoveryBudget,
		readOnly = false
	) {
		this.cfg = yamlCfg.loadCfg(readOnly);
		this.token = yamlCfg.loadCRToken();
		this.req = new reqModule.Req(readOnly);
		this.locale = 'en-US';
	}

	public checkToken(): boolean {
		return Object.keys(this.cmsToken.cms ?? {}).length > 0;
	}

	/** Explicit account playback reset; the limit is a client safety bound. */
	private async resetPlaybackSessions(
		headers: FetchParams,
		context?: {
			checkOnly?: boolean;
			snapshot?: PlaybackSession[];
			availableBelow?: number;
			budget?: PlaybackRecoveryBudget;
			signal?: AbortSignal;
			timeoutMs?: number;
			phase?: (label: string) => void;
			dispatch?: () => Promise<void>;
		}
	): Promise<{ ok: boolean; closed: number; remaining?: number; reason?: string }> {
		const controller = new AbortController();
		const onSignal = () => controller.abort();
		if (context?.signal?.aborted) controller.abort();
		context?.signal?.addEventListener('abort', onSignal, { once: true });
		const cli = process.env.isGUI !== 'true';
		const indicator = context?.phase
			? undefined
			: new WorkingIndicator(
					cli && !this.debug && !this.req.argv?.debug && !!process.stdout.isTTY && !!process.env.TERM && process.env.TERM !== 'dumb',
					process.stdout,
					'Clearing playback sessions…'
				);
		if (cli) {
			process.on('SIGINT', onSignal);
			process.on('SIGTERM', onSignal);
		}
		indicator?.start();
		const phase = (label: string) => {
			indicator?.phase(label);
			context?.phase?.(label);
		};
		phase(context?.checkOnly ? 'Checking remaining sessions…' : 'Clearing playback sessions…');
		let closed = 0;
		const check = (signal: AbortSignal) => {
			if (signal.aborted) throw new Error('reset cancelled or timed out');
		};
		try {
			return await boundedRequest(
				async (signal) => {
					const list = async () => {
						check(signal);
						await context?.dispatch?.();
						check(signal);
						const response = await this.req.getData(api.streaming_sessions, { ...headers, signal });
						check(signal);
						if (!response.ok || !response.res) throw new Error('session list failed');
						let data: { items?: unknown };
						try {
							data = (await response.res.json()) as { items?: unknown };
						} catch {
							check(signal);
							throw new Error('invalid session list');
						}
						check(signal);
						const sessions = playbackSessions(data);
						if (!sessions) throw new Error('invalid session list');
						return sessions;
					};
					const sessions = context?.snapshot ?? (await list());
					if (context?.checkOnly) return { ok: sessions.length === 0, closed, remaining: sessions.length };
					for (const item of sessions) {
						check(signal);
						await context?.dispatch?.();
						check(signal);
						if (context?.budget) context.budget.used = true;
						const response = await this.req.getData(`https://cr-play-service.prd.crunchyrollsvc.com/v1/token/${item.contentId}/${item.token}`, {
							...headers,
							method: 'DELETE',
							signal
						});
						check(signal);
						if (!response.ok || (response.res?.status !== 200 && response.res?.status !== 204)) throw new Error('session deletion failed');
						closed++;
					}
					phase('Checking remaining sessions…');
					const remaining = (await list()).length;
					return { ok: context?.availableBelow === undefined ? remaining === 0 : remaining < context.availableBelow, closed, remaining };
				},
				undefined,
				controller.signal,
				context?.timeoutMs
			);
		} catch (error) {
			const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : '';
			const reason = controller.signal.aborted
				? 'session reset cancelled'
				: message === 'request deadline exceeded'
					? 'session reset timed out'
					: ['session list failed', 'invalid session list', 'session list exceeds reset limit', 'session deletion failed'].includes(message)
						? message
						: 'session reset failed';
			return { ok: false, closed, reason };
		} finally {
			indicator?.stop();
			context?.signal?.removeEventListener('abort', onSignal);
			if (cli) {
				process.removeListener('SIGINT', onSignal);
				process.removeListener('SIGTERM', onSignal);
			}
		}
	}

	private async inspectPlaybackCapacity(
		headers: FetchParams,
		scheduler: DiscoveryScheduler,
		signal: AbortSignal | undefined,
		state: PlaybackRecoveryState,
		pollUntil?: number
	): Promise<{ limit?: number; sessions?: PlaybackSession[] }> {
		try {
			const getJson = async (url: string) => {
				await scheduler.dispatch(false, pollUntil);
				const pollRemaining = pollUntil === undefined ? Infinity : pollUntil - scheduler.clock.now();
				if (pollRemaining <= 0) throw new Error('playback slot wait timed out');
				return boundedRequest(
					async (requestSignal) => {
						const result = await this.req.getData(url, { ...headers, signal: requestSignal });
						if (!result.ok || !result.res || result.error) throw new Error('capacity request failed');
						return result.res.json();
					},
					undefined,
					signal,
					Math.min(scheduler.remaining(), pollRemaining)
				);
			};
			const binding = String((headers.headers as Record<string, string>)?.Authorization ?? '');
			let limit = state.capacityCache?.binding === binding ? state.capacityCache.limit : undefined;
			if (limit === undefined) {
				const me = (await getJson(api.me)) as { external_id?: unknown };
				if (!me || typeof me.external_id !== 'string' || !me.external_id.trim()) return {};
				const benefits = await getJson(`https://beta-api.crunchyroll.com/subs/v1/subscriptions/${me.external_id}/benefits`);
				limit = concurrentStreamLimit(benefits);
				if (limit === undefined) return {};
				state.capacityCache = { binding, limit };
			}
			const sessions = playbackSessions(await getJson(api.streaming_sessions));
			return sessions ? { limit, sessions } : {};
		} catch {
			scheduler.check();
			if (signal?.aborted) throw new Error('playback recovery cancelled');
			return {};
		}
	}

	private async resolvePlaybackCapacity(
		headers: FetchParams,
		scheduler: DiscoveryScheduler,
		signal: AbortSignal | undefined,
		state: PlaybackRecoveryState,
		indicator: WorkingIndicator,
		refusal?: { headers: Headers; ordinal: number; at: number; wall: number },
		allowClear = true
	): Promise<boolean> {
		try {
			indicator.phase('Checking remaining sessions…');
			let capacity = await this.inspectPlaybackCapacity(headers, scheduler, signal, state);
			let didReset = false;
			let polled = false;
			const full = capacity.limit !== undefined && !!capacity.sessions && capacity.sessions.length >= capacity.limit;
			if (refusal && state.permitClear && (state.owned || full)) scheduler.serverDelayAvailable(refusal.headers, refusal.at, refusal.wall);
			if (capacity.limit !== undefined && capacity.sessions && capacity.sessions.length >= capacity.limit) {
				if (state.permitClear && !state.budget.used && allowClear) {
					const result = await this.resetPlaybackSessions(headers, {
						snapshot: capacity.sessions,
						availableBelow: capacity.limit,
						budget: state.budget,
						signal,
						timeoutMs: scheduler.remaining(),
						phase: (label) => indicator.phase(label),
						dispatch: () => scheduler.dispatch()
					});
					state.resetPerformed ||= state.budget.used;
					if (!result.ok) {
						console.error(`Playback recovery stopped: ${result.reason ?? 'sessions remain'}`);
						return false;
					}
					didReset = true;
					state.owned = true;
				} else {
					if (state.permitClear) state.owned = true;
					const slotDeadline = (scheduler.getWindow().slotDeadline ??= scheduler.clock.now() + 60000);
					polled = true;
					while (capacity.limit !== undefined && capacity.sessions && capacity.sessions.length >= capacity.limit) {
						const remaining = slotDeadline - scheduler.clock.now();
						if (remaining <= 0) {
							console.error('Playback slot wait timed out.');
							return false;
						}
						indicator.slot(capacity.sessions.length, capacity.limit, remaining);
						await scheduler.playbackSleep(Math.min(5000, remaining));
						if (scheduler.clock.now() >= slotDeadline) {
							console.error('Playback slot wait timed out.');
							return false;
						}
						capacity = await this.inspectPlaybackCapacity(headers, scheduler, signal, state, slotDeadline);
						if (scheduler.clock.now() >= slotDeadline) {
							console.error('Playback slot wait timed out.');
							return false;
						}
					}
				}
			}
			if (!refusal && state.permitClear && polled && (capacity.limit === undefined || !capacity.sessions || capacity.sessions.length >= capacity.limit)) {
				console.error('Playback recovery stopped: unable to verify available capacity');
				return false;
			}
			if (refusal) {
				const recovered = didReset || (polled && capacity.limit !== undefined && capacity.sessions && capacity.sessions.length < capacity.limit);
				if (state.owned) {
					state.ordinal = state.ownedOrdinal = (state.ownedOrdinal ?? 0) + 1;
					if (state.ordinal > 2 || (state.resetPerformed && refusal.ordinal > 2)) return false;
					const serverWait = scheduler.serverDelayAvailable(refusal.headers, refusal.at, refusal.wall);
					if (!recovered && !serverWait) return false;
					await scheduler.waitServerDelay(refusal.headers, refusal.at, refusal.wall);
				} else if (recovered) await scheduler.waitServerDelay(refusal.headers, refusal.at, refusal.wall);
				else await scheduler.waitPlayback(refusal.headers, refusal.ordinal, refusal.at, refusal.wall);
			}
			return true;
		} catch (error) {
			console.error(`Playback recovery stopped: ${String(error).replace(/^Error: /, '')}`);
			return false;
		} finally {
			indicator.phase('Discovering video qualities');
		}
	}

	private playbackRateNotice(alreadyReset: boolean, clearingUnavailable = false): void {
		console.warn(
			alreadyReset
				? 'Rate limit (429) persists after session reset. Wait and try again.'
				: clearingUnavailable
					? 'Rate limited (429). Wait and try again.'
					: 'Rate limited (429). Wait, or try --tsd to clear playback sessions without logging out; this may not clear the limit.'
		);
	}

	private async playbackStatus(debug: boolean): Promise<boolean> {
		if (!this.token.refresh_token) {
			console.error('Login required to check Crunchyroll playback status.');
			return false;
		}
		if (!(await this.refreshToken(true, true))) return false;
		const headers: FetchParams = {
			headers: {
				Authorization: `Bearer ${this.token.access_token}`,
				...(this.token.auth_type === 'web' ? { ...api.crunchyDefHeader, 'User-Agent': api.crunchyWebUserAgent } : this.deviceHeaders())
			}
		};
		const binding = accountBinding(this.token.account_id);
		const controller = new AbortController();
		const onSignal = () => controller.abort();
		const cli = process.env.isGUI !== 'true';
		const indicator = new WorkingIndicator(
			cli && !debug && !!process.stdout.isTTY && !!process.env.TERM && process.env.TERM !== 'dumb',
			undefined,
			'Checking Crunchyroll playback status'
		);
		if (cli) {
			process.on('SIGINT', onSignal);
			process.on('SIGTERM', onSignal);
		}
		indicator.start();
		let limit: number | undefined,
			active: number | undefined,
			failed = false;
		const stages: { name: string; status?: number; wait?: number }[] = [];
		try {
			await boundedRequest(
				async (signal) => {
					const get = async (name: string, url: string): Promise<any> => {
						if (signal.aborted) throw new Error('status cancelled');
						const stage: { name: string; status?: number; wait?: number } = { name };
						stages.push(stage);
						try {
							const response = await this.req.getData(url, {
								...headers,
								signal,
								quietErrors: true,
								quietDebug: true,
								skipErrorBody: true,
								onResponse: (res) => {
									stage.status = res.status;
									stage.wait = retryAfterMs(res.headers.get('retry-after'), res.headers.get('date'), Date.now());
								}
							});
							if (signal.aborted) throw new Error('status cancelled');
							stage.status ??= response.res?.status ?? response.error?.res?.status;
							if (!response.ok || !response.res || response.error) {
								failed = true;
								return undefined;
							}
							const body = await response.res.json();
							if (signal.aborted) throw new Error('status cancelled');
							return body;
						} catch (error) {
							if (signal.aborted) throw error;
							failed = true;
							return undefined;
						}
					};
					const me = await get('account', api.me);
					if (typeof me?.external_id === 'string' && me.external_id.trim()) {
						limit = concurrentStreamLimit(await get('benefits', `https://beta-api.crunchyroll.com/subs/v1/subscriptions/${me.external_id}/benefits`));
					}
					if (limit === undefined) failed = true;
					const sessions = playbackSessions(await get('sessions', api.streaming_sessions));
					if (sessions) active = sessions.length;
					else failed = true;
				},
				undefined,
				controller.signal,
				15000
			);
		} catch {
			failed = true;
		} finally {
			indicator.stop();
			if (cli) {
				process.removeListener('SIGINT', onSignal);
				process.removeListener('SIGTERM', onSignal);
			}
		}
		console.info(`Concurrent-stream allowance: ${limit ?? 'unknown'}`);
		console.info(`Active playback sessions: ${active ?? 'unknown'}`);
		console.info(`Available slots (calculated): ${limit !== undefined && active !== undefined ? Math.max(0, limit - active) : 'unknown'}`);
		for (const stage of stages) {
			if (debug)
				console.debug(
					`[DEBUG] Status ${stage.name}: HTTP ${stage.status ?? 'unknown'}${stage.wait !== undefined ? `, Retry-After ${Number.isFinite(stage.wait) ? formatPlaybackDuration(stage.wait) : 'too large to represent'}` : ''}`
				);
			if (stage.status === 429)
				console.warn(
					`Status ${stage.name} request was rate limited (HTTP 429); ${stage.wait !== undefined ? `Retry-After ${Number.isFinite(stage.wait) ? formatPlaybackDuration(stage.wait) : 'too large to represent'}` : 'Retry-After unknown'}.`
				);
		}
		const record = readPlaybackWait(yamlCfg.workingDir ? path.join(yamlCfg.workingDir, 'config') : (this.cfg.dir.config ?? ''), binding);
		if (record) {
			const remaining = Math.max(0, record.deadline - Date.now());
			console.info(
				remaining
					? `Last observed playback wait: ${formatPlaybackDuration(remaining)} remaining. Earliest suggested retry (local time): ${formatLocalRetryTime(record.deadline)}. Current playback is unverified.`
					: 'Last observed playback wait elapsed; current playback is unverified.'
			);
		} else console.info('No recorded playback wait; current playback is unverified.');
		return !failed;
	}

	public async cli() {
		console.info(`\n=== Multi Downloader NX ${displayVersion(packageJson)} ===\n`);
		const argv = yargs.appArgv(this.cfg.cli);
		if (argv.checkStatus) return this.playbackStatus(!!argv.debug);
		const authDecision = crunchyCliAuthDecision({ ...argv, service: 'crunchy' });
		if (authDecision.kind !== 'continue') {
			(authDecision.kind === 'notice' ? console.info : console.error)(authDecision.message);
			if (authDecision.kind === 'error') process.exitCode = 1;
			return authDecision.kind === 'notice';
		}
		this.locale = argv.locale;
		if (argv.debug) this.debug = true;

		// load binaries
		this.cfg.bin = await yamlCfg.loadBinCfg();
		if (argv.allDubs) {
			argv.dubLang = langsData.dubLanguageCodes;
		}
		// select mode
		if (argv.device === 'androidtv') {
			if (!(await this.loginWithDevice())) process.exitCode = 1;
		} else if (argv.device === 'android') {
			if (!(await this.loginWithAndroidPhone())) process.exitCode = 1;
		} else if (argv.dlFonts) {
			await this.getFonts(argv.dryRun);
		} else if (typeof argv.token === 'string') {
			if (!(await this.loginWithToken(argv.token))) {
				process.exitCode = 1;
			}
		} else if (argv.cmsindex) {
			if (!(await this.refreshToken())) return false;
			await this.getCmsData();
		} else if (argv.new) {
			if (!(await this.refreshToken())) return false;
			await this.getNewlyAdded(argv.page, argv.searchType, argv.raw, argv.rawoutput);
		} else if (argv.search && argv.search.length > 2) {
			if (!(await this.refreshToken())) return false;
			await this.doSearch({ ...argv, search: argv.search as string });
		} else if (argv.series && argv.series.match(/^[0-9A-Z]{9,}$/)) {
			if (!(await (argv.e || argv.all || argv.but ? this.prepareMediaDownload(argv) : this.refreshToken()))) return false;
			await this.logSeriesById(argv.series as string);
			const selected = await this.downloadFromSeriesID(argv.series, { ...argv });
			if (!selected.isOk) return false;
			if (selected.isOk) {
				for (const select of selected.value) {
					if (!(await this.downloadEpisode(select, { ...argv, skipsubs: false, queueRecovery: this.commandRecovery }, true))) {
						console.error(`Unable to download selected episode ${select.episodeNumber}`);
						return false;
					}
				}
			}
			return true;
		} else if (argv.movieListing && argv.movieListing.match(/^[0-9A-Z]{9,}$/)) {
			if (!(await this.refreshToken())) return false;
			await this.logMovieListingById(argv.movieListing as string);
		} else if (argv.showRaw && argv.showRaw.match(/^[0-9A-Z]{9,}$/)) {
			if (!(await this.refreshToken())) return false;
			await this.logShowRawById(argv.showRaw as string);
		} else if (argv.seasonRaw && argv.seasonRaw.match(/^[0-9A-Z]{9,}$/)) {
			if (!(await this.refreshToken())) return false;
			await this.logSeasonRawById(argv.seasonRaw as string);
		} else if (argv.showListRaw) {
			if (!(await this.refreshToken())) return false;
			await this.logShowListRaw();
		} else if (argv.s && argv.s.match(/^[0-9A-Z]{9,}$/)) {
			if (!(await (argv.e || argv.all || argv.but ? this.prepareMediaDownload(argv) : this.refreshToken()))) return false;
			const selected = await this.getSeasonById(argv.s, argv.numbers, argv.e, argv.but, argv.all, { dubLang: argv.dubLang, allDubs: argv.allDubs });
			if (!selected.isOk) return false;
			for (const select of selected.value) {
				if (!(await this.downloadEpisode(select, { ...argv, skipsubs: false, queueRecovery: this.commandRecovery }))) {
					console.error(`Unable to download selected episode ${select.episodeNumber}`);
					return false;
				}
			}
			return true;
		} else if (argv.e) {
			if (!(await this.prepareMediaDownload(argv))) return false;
			if (argv.dubLang.length > 1) {
				console.info('One show can only be downloaded with one dub. Use --srz instead.');
			}
			const requestedDubLang = argv.allDubs ? undefined : [...argv.dubLang];
			argv.dubLang = [argv.dubLang[0]];
			const selected = await this.getObjectById(argv.e, false);
			for (const select of selected as Partial<CrunchyEpMeta>[]) {
				if (
					!(await this.downloadEpisode(select as CrunchyEpMeta, {
						...argv,
						skipsubs: false,
						queueRecovery: this.commandRecovery,
						requestedDubLang
					}))
				) {
					console.error(`Unable to download selected episode ${select.episodeNumber}`);
					return false;
				}
			}
			return true;
		} else if (argv.extid) {
			if (!(await this.prepareMediaDownload(argv))) return false;
			if (argv.dubLang.length > 1) {
				console.info('One show can only be downloaded with one dub. Use --srz instead.');
			}
			const requestedDubLang = argv.allDubs ? undefined : [...argv.dubLang];
			argv.dubLang = [argv.dubLang[0]];
			const selected = await this.getObjectById(argv.extid, false, true);
			for (const select of selected as Partial<CrunchyEpMeta>[]) {
				if (
					!(await this.downloadEpisode(select as CrunchyEpMeta, {
						...argv,
						skipsubs: false,
						queueRecovery: this.commandRecovery,
						requestedDubLang
					}))
				) {
					console.error(`Unable to download selected episode ${select.episodeNumber}`);
					return false;
				}
			}
			return true;
		} else if (
			argv.tsd &&
			argv.tsdExplicit &&
			!argv.requestedActionOrSelector &&
			!argv.all &&
			!argv.but &&
			![argv.search, argv.series, argv.movieListing, argv.showRaw, argv.seasonRaw, argv.s, argv.e, argv.extid].some((value) => value !== undefined) &&
			!argv._?.length
		) {
			if (typeof this.token?.refresh_token !== 'string' || !this.token.refresh_token.trim()) {
				console.error('Login required before resetting playback sessions.');
				process.exitCode = 1;
				return false;
			}
			if (!(await this.refreshToken(true, true))) {
				process.exitCode = 1;
				return false;
			}
			const headers: FetchParams = {
				headers: {
					Authorization: `Bearer ${this.token.access_token}`,
					...(this.token.auth_type === 'web' ? { ...api.crunchyDefHeader, 'User-Agent': api.crunchyWebUserAgent } : this.deviceHeaders())
				}
			};
			const reset = await this.resetPlaybackSessions(headers);
			console.info(`Closed ${reset.closed} playback sessions. Active sessions remaining: ${reset.remaining ?? 'unknown'}.`);
			if (!reset.ok) {
				if (reset.reason) console.error(`Playback session reset incomplete: ${reset.reason}`);
				process.exitCode = 1;
				return false;
			}
			return true;
		} else {
			console.info('No option selected or invalid value entered. Try --help.');
		}
	}

	public async logShowRawById(id: string) {
		// check token
		if (!this.cmsToken.cms) {
			console.error('Authentication required!');
			return;
		}
		// opts
		const AuthHeaders = {
			headers: {
				Authorization: `Bearer ${this.token.access_token}`,
				...api.crunchyDefHeader
			}
		};
		// seasons list
		const seriesSeasonListReq = await this.req.getData(
			`${api.content_cms}/series/${id}/seasons?force_locale=&preferred_audio_language=ja-JP&locale=${this.locale}`,
			AuthHeaders
		);
		if (!seriesSeasonListReq.ok || !seriesSeasonListReq.res) {
			console.error('Series Request FAILED!');
			return;
		}
		const seriesData = await seriesSeasonListReq.res.json();
		for (const item of seriesData.data) {
			// stringify each object, then a newline
			console.log(JSON.stringify(item));
		}
		return seriesData.data;
	}

	public async logSeasonRawById(id: string) {
		// check token
		if (!this.cmsToken.cms) {
			console.error('Authentication required!');
			return;
		}
		// opts
		const AuthHeaders = {
			headers: {
				Authorization: `Bearer ${this.token.access_token}`,
				...api.crunchyDefHeader
			}
		};
		//get episode info
		const reqEpsListOpts = [
			api.cms_bucket,
			this.cmsToken.cms.bucket,
			'/episodes?',
			new URLSearchParams({
				force_locale: '',
				preferred_audio_language: 'ja-JP',
				locale: this.locale,
				season_id: id,
				Policy: this.cmsToken.cms.policy,
				Signature: this.cmsToken.cms.signature,
				'Key-Pair-Id': this.cmsToken.cms.key_pair_id
			})
		].join('');
		const reqEpsList = await this.req.getData(reqEpsListOpts, AuthHeaders);
		if (!reqEpsList.ok || !reqEpsList.res) {
			console.error('Episode List Request FAILED!');
			return { isOk: false, reason: new Error('Episode List request failed. No more information provided.') };
		}
		//CrunchyEpisodeList
		const episodeListAndroid = (await reqEpsList.res.json()) as CrunchyAndroidEpisodes;
		const episodeList: CrunchyEpisodeList = {
			total: episodeListAndroid.total,
			data: episodeListAndroid.items,
			meta: {}
		};
		for (const item of episodeList.data) {
			// stringify each object, then a newline
			console.log(JSON.stringify(item));
		}

		// Return the data directly if this function is called by other code
		return episodeList.data;
	}

	public async logShowListRaw() {
		// check token
		if (!this.cmsToken.cms) {
			console.error('Authentication required!');
			return;
		}

		// opts
		const AuthHeaders = {
			headers: {
				Authorization: `Bearer ${this.token.access_token}`,
				...api.crunchyDefHeader
			}
		};

		const allShows: any[] = [];
		let page = 1;
		let hasMorePages = true;

		if (this.debug) {
			console.info('Retrieving complete show list...');
		}

		while (hasMorePages) {
			const searchStart = (page - 1) * 50;
			const params = new URLSearchParams({
				preferred_audio_language: 'ja-JP',
				locale: this.locale,
				ratings: 'true',
				sort_by: 'alphabetical',
				n: '50',
				start: searchStart.toString()
			}).toString();

			const showListReq = await this.req.getData(`${api.browse_all_series}?${params}`, AuthHeaders);

			if (!showListReq.ok || !showListReq.res) {
				console.error(`Show List Request FAILED on page ${page}!`);
				return allShows;
			}

			const showListData = await showListReq.res.json();

			// Add current page data
			for (const item of showListData.data) {
				// stringify each object, then a newline
				console.log(JSON.stringify(item));
				allShows.push(item);
			}

			// Calculate pagination info
			const totalItems = showListData.total;
			const totalPages = Math.ceil(totalItems / 50);
			if (this.debug) {
				console.info(`Retrieved page ${page}/${totalPages} (${allShows.length}/${totalItems} items)`);
			}

			// Check if we need to fetch more pages
			if (page >= totalPages) {
				hasMorePages = false;
			} else {
				page++;
				// Add a small delay to avoid rate limiting
				await this.sleep(1000);
			}
		}

		if (this.debug) {
			console.info(`Complete show list retrieved: ${allShows.length} items`);
		}
		return allShows;
	}

	public async getFonts(dryRun = false) {
		const fonts = Object.values(fontsData.fontFamilies).reduce((pre, curr) => pre.concat(curr));
		if (dryRun) {
			for (const font of fonts) console.info('Font URL:', fontsData.root + font);
			return;
		}
		console.info('Downloading fonts...');
		for (const f of fonts) {
			const fontLoc = path.join(this.cfg.dir.fonts, f);
			if (fs.existsSync(fontLoc) && fs.statSync(fontLoc).size != 0) {
				console.info(`${f} already downloaded!`);
			} else {
				const fontFolder = path.dirname(fontLoc);
				if (fs.existsSync(fontLoc) && fs.statSync(fontLoc).size == 0) {
					fs.rmSync(fontLoc, { recursive: true, force: true });
				}
				try {
					fs.existsSync(fontFolder);
				} catch (e) {
					console.info('');
				}
				const fontUrl = fontsData.root + f;
				const getFont = await this.req.getData(fontUrl, {
					headers: api.crunchyDefHeader
				});
				if (getFont.ok && getFont.res) {
					fs.writeFileSync(fontLoc, Buffer.from(await getFont.res.arrayBuffer()));
					console.info(`Downloaded: ${f}`);
				} else {
					console.warn(`Failed to download: ${f}`);
				}
			}
		}
		console.info('All required fonts downloaded!');
	}

	public async doAuth(data: AuthData): Promise<AuthResponse> {
		// GUI workaround: a UUID-shaped username is treated as an etp_rt cookie and logged in like --token
		if (/^(etp_rt=)?[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(data.username.trim())) {
			return (await this.loginWithToken(data.username)) ? { isOk: true, value: undefined } : { isOk: false, reason: new Error('Token Authentication failed') };
		}
		const basic = atob(api.basic_auth_token);
		const client = basic.split(':');

		const uuid = randomUUID();
		const authData = new URLSearchParams({
			username: data.username,
			password: data.password,
			grant_type: 'password',
			scope: 'offline_access',
			client_id: client[0],
			client_secret: client[1],
			device_id: uuid,
			device_name: 'emu64xa',
			device_type: 'ANDROIDTV'
		}).toString();
		const authReqOpts: FetchParams = {
			method: 'POST',
			headers: { ...api.crunchyAuthHeader, 'ETP-Anonymous-ID': uuid },
			body: authData,
			useProxy: true
		};
		const authReq = await this.req.getData(api.auth, authReqOpts);
		if (!authReq.ok || !authReq.res) {
			console.error('Authentication failed!');
			if (authReq.res?.status === 400) {
				console.warn(
					'Crunchyroll may no longer accept username/password login. Log in with --service crunchy --token and the etp_rt cookie from your browser instead (GUI: paste it as the username).'
				);
			}
			return { isOk: false, reason: new Error('Authentication failed') };
		}

		// To prevent any Cloudflare errors in the future
		if (authReq.res.headers.get('Set-Cookie')) {
			api.crunchyDefHeader['Cookie'] = authReq.res.headers.get('Set-Cookie') as string;
			api.crunchyAuthHeader['Cookie'] = authReq.res.headers.get('Set-Cookie') as string;
		}
		if (authReq.headers && authReq.headers['Set-Cookie']) {
			api.crunchyDefHeader['Cookie'] = authReq.headers['Set-Cookie'];
			api.crunchyAuthHeader['Cookie'] = authReq.headers['Set-Cookie'];
			api.crunchyDefHeader['User-Agent'] = authReq.headers['User-Agent'];
			api.crunchyAuthHeader['User-Agent'] = authReq.headers['User-Agent'];
		}

		this.token = await authReq.res.json();
		this.token.device_id = uuid;
		this.token.expires = new Date(Date.now() + this.token.expires_in * 1000);
		yamlCfg.saveCRToken(this.token);
		await this.getProfile();
		console.info('Your Country: %s', this.token.country);
		return { isOk: true, value: undefined };
	}

	public async doAnonymousAuth(): Promise<boolean> {
		const basic = atob(api.basic_auth_token);
		const client = basic.split(':');

		const uuid = randomUUID();
		const authData = new URLSearchParams({
			grant_type: 'client_id',
			scope: 'offline_access',
			client_id: client[0],
			client_secret: client[1],
			device_id: uuid,
			device_name: 'emu64xa',
			device_type: 'ANDROIDTV'
		}).toString();
		const authReqOpts: FetchParams = {
			method: 'POST',
			headers: { ...api.crunchyAuthHeader, 'ETP-Anonymous-ID': uuid },
			body: authData,
			useProxy: true
		};
		const authReq = await this.req.getData(api.auth, authReqOpts);
		if (!authReq.ok || !authReq.res) {
			console.error('Anonymous Authentication failed!');
			return false;
		}
		// To prevent any Cloudflare errors in the future
		if (authReq.res.headers.get('Set-Cookie')) {
			api.crunchyDefHeader['Cookie'] = authReq.res.headers.get('Set-Cookie') as string;
			api.crunchyAuthHeader['Cookie'] = authReq.res.headers.get('Set-Cookie') as string;
		}
		if (authReq.headers && authReq.headers['Set-Cookie']) {
			api.crunchyDefHeader['Cookie'] = authReq.headers['Set-Cookie'];
			api.crunchyAuthHeader['Cookie'] = authReq.headers['Set-Cookie'];
			api.crunchyDefHeader['User-Agent'] = authReq.headers['User-Agent'];
			api.crunchyAuthHeader['User-Agent'] = authReq.headers['User-Agent'];
		}

		this.token = await authReq.res.json();
		this.token.device_id = uuid;
		this.token.expires = new Date(Date.now() + this.token.expires_in * 1000);
		yamlCfg.saveCRToken(this.token);
		return true;
	}

	private deviceUserAgent(token = this.token): string {
		return typeof token.device_user_agent === 'string' && token.device_user_agent ? token.device_user_agent : DEVICE_USER_AGENT;
	}

	private sessionHeaders(token: CrunchySession): Record<string, string> {
		if (token.auth_type === 'android') return { 'User-Agent': token.device_user_agent, Accept: 'application/json' };
		if (token.auth_type === 'web') return { ...api.crunchyDefHeader, 'User-Agent': api.crunchyWebUserAgent };
		return token.auth_type === 'device' ? { ...api.crunchyDefHeader, 'User-Agent': this.deviceUserAgent(token) } : api.crunchyDefHeader;
	}

	private async checkPlaybackSession(slot: PlaybackSlot): Promise<PlaybackSessionCheck> {
		const activeSlot = crunchySessionSlot(this.token);
		const session = yamlCfg.loadCRSessions().sessions[slot] ?? (activeSlot === slot || activeSlot === 'legacy' ? this.token : undefined);
		if (!session) return { failure: 'invalid' };
		if (
			session !== this.token &&
			((session.account_id && this.token.account_id && session.account_id !== this.token.account_id) ||
				(activeSlot !== slot && !!this.token.access_token && (!session.account_id || !this.token.account_id)))
		) {
			return { failure: 'account' };
		}
		if (crunchySessionSlot(session) === 'legacy') {
			return typeof session.access_token === 'string' && session.access_token.trim() ? { session } : { failure: 'invalid' };
		}
		if (typeof session.refresh_token !== 'string' || !session.refresh_token.trim()) return { failure: 'invalid' };
		if (this.sessionIsCurrent(session)) return { session };
		let rejected = false;
		const current = await this.refreshStoredSession(session, true, () => {
			rejected = true;
		}).catch(() => undefined);
		return current ? { session: current } : { failure: rejected ? 'invalid' : 'unavailable' };
	}

	private playbackAuth(endpoint: VideoEndpoint, session: CrunchySession): PlaybackAuth {
		const phonePlayback = session.auth_type === 'android' && endpoint === 'android';
		return {
			endpoint,
			session,
			slot: crunchySessionSlot(session),
			origin: phonePlayback ? domain.cr_www : domain.cr_playback,
			prefix: phonePlayback ? '/playback' : ''
		};
	}

	private playbackHeaders(auth: PlaybackAuth): FetchParams {
		return {
			headers: { ...this.sessionHeaders(auth.session), Authorization: `Bearer ${auth.session.access_token}` },
			quietDebug: true,
			redirect: 'manual'
		};
	}

	private async refreshPlaybackOwner(auth: PlaybackAuth): Promise<boolean> {
		if (!auth.session.refresh_token || auth.slot === 'legacy' || this.sessionIsCurrent(auth.session)) return true;
		const refreshed = await this.refreshStoredSession(auth.session, true);
		if (!refreshed) return false;
		auth.session = refreshed;
		return true;
	}

	private playbackURL(auth: PlaybackAuth, contentId: string, audio = false): string {
		const endpoint = auth.slot === 'legacy' && !audio ? 'androidtv' : auth.endpoint;
		const queue = auth.prefix ? 'false' : auth.slot === 'legacy' && audio ? '1' : '0';
		const route = audio ? CrunchyAudioPlayStreams[endpoint] : CrunchyVideoPlayStreams[endpoint];
		return `${auth.origin}${auth.prefix}/v3/${contentId}/${route}/play?queue=${queue}`;
	}

	private playbackTokenURL(auth: PlaybackAuth, contentId: string | undefined, token: string): string {
		return `${auth.origin}${auth.prefix}/v1/token/${contentId}/${encodeURIComponent(token)}`;
	}

	private async resolvePlaybackRouting(options: PlaybackSelection): Promise<PlaybackRouting | undefined> {
		const defaultEndpoint: VideoEndpoint = this.token.auth_type === 'android' ? 'android' : this.token.auth_type === 'web' ? 'chrome' : 'androidtv';
		const endpoint = (configured: VideoEndpoint) => (Object.prototype.hasOwnProperty.call(CrunchyVideoPlayStreams, configured) ? configured : defaultEndpoint);
		const videoEndpoint = endpoint(options.cstream || (options.novids && !options.noaudio ? options.astream : options.vstream));
		const audioEndpoint = options.noaudio || options.cstream ? videoEndpoint : endpoint(options.astream);
		const videoSlot = playbackSlot(videoEndpoint);
		const audioSlot = playbackSlot(audioEndpoint);
		const videoCheck = await this.checkPlaybackSession(videoSlot);
		const audioCheck = videoSlot === audioSlot ? videoCheck : await this.checkPlaybackSession(audioSlot);
		if ('failure' in videoCheck && (!options.novids || options.noaudio)) {
			playbackAuthError(options.novids ? 'Subtitle metadata' : 'Video', videoEndpoint, videoCheck.failure);
		}
		if ('failure' in audioCheck && !options.noaudio) playbackAuthError('Audio', audioEndpoint, audioCheck.failure);
		if ('failure' in videoCheck || 'failure' in audioCheck) return;
		const video = this.playbackAuth(videoEndpoint, videoCheck.session);
		const audio = videoEndpoint === audioEndpoint ? video : this.playbackAuth(audioEndpoint, audioCheck.session);
		if (video.slot !== audio.slot && (!video.session.account_id || video.session.account_id !== audio.session.account_id)) {
			console.error('Crunchyroll video and audio sessions must belong to the same account.');
			return;
		}
		return { video, audio };
	}

	private async prepareMediaDownload(options: PlaybackSelection): Promise<boolean> {
		if (options.novids && options.noaudio) return this.refreshToken();
		const routing = await this.resolvePlaybackRouting(options);
		if (!routing) return false;
		if (this.token.access_token !== routing.video.session.access_token) {
			this.token = routing.video.session;
			this.cmsToken = {};
		}
		return this.refreshToken(true);
	}

	private manifestHeaders(url: string, auth: PlaybackAuth): FetchParams {
		const origin = new URL(url).origin;
		return origin === domain.cr_www || origin === domain.cr_playback ? this.playbackHeaders(auth) : { quietDebug: true, redirect: 'manual' };
	}

	private deviceHeaders(): Record<string, string> {
		return this.sessionHeaders(this.token);
	}

	public async getProfile(silent = false, signal?: AbortSignal, quietErrors = false, onError?: (details: string) => void): Promise<boolean> {
		if (!this.token.access_token) {
			if (quietErrors) onError?.('No access token');
			else console.error('No access token!');
			return false;
		}

		const profileReqOptions = {
			signal,
			quietErrors,
			headers: {
				...this.deviceHeaders(),
				Authorization: `Bearer ${this.token.access_token}`
			}
		};
		const profileReq = await this.req.getData(api.profile, profileReqOptions);
		if (!profileReq.ok || !profileReq.res) {
			if (quietErrors) onError?.(await deviceErrorDetails(profileReq));
			else console.error('Get profile failed!');
			return false;
		}
		const profile = await profileReq.res.json();
		if (!silent) {
			console.info('USER: %s (%s)', profile.username, profile.email);
		}
		return true;
	}

	public sleep(ms: number) {
		return new Promise((resolve) => {
			setTimeout(resolve, ms);
		});
	}

	private async requestWebToken(refreshToken: string, deviceId: string, errorMessage: string, onRejected?: () => void): Promise<Record<string, any> | undefined> {
		const authData = new URLSearchParams({
			device_id: deviceId,
			device_type: 'Firefox on Windows',
			grant_type: 'etp_rt_cookie'
		}).toString();
		const authReqOpts: FetchParams = {
			method: 'POST',
			headers: { ...api.crunchyWebAuthHeader, Cookie: `device_id=${deviceId}; etp_rt=${refreshToken}` },
			body: authData,
			useProxy: true,
			quietDebug: true
		};
		const authReq = await this.req.getData(api.auth, authReqOpts);
		if (!authReq.ok || !authReq.res) {
			if (onRejected) {
				if (await refreshCredentialsRejected(authReq.res)) onRejected();
			} else {
				console.error(errorMessage);
				if (authReq.res?.status === 400) {
					console.warn('Token is likely wrong (Or invalid for given API), please login again!');
				}
			}
			return;
		}

		const token = await authReq.res.json();
		if (!token.access_token) {
			if (!onRejected) console.error(errorMessage);
			return;
		}

		token.auth_type = 'web';
		token.device_id = deviceId;
		token.expires = new Date(Date.now() + token.expires_in * 1000);
		return token;
	}

	public async loginWithToken(input: string): Promise<boolean> {
		let tokenInput;
		try {
			tokenInput = parseCrunchyTokenInput(input);
		} catch (error) {
			const source = error instanceof CrunchyTokenInputError ? error.source : 'direct token';
			const message = error instanceof Error ? error.message : 'Invalid token input.';
			console.error(`Token authentication failed (${source}): ${message}`);
			return false;
		}

		const source = tokenInput.source;
		const previousToken = this.token;
		const previousCMS = this.cmsToken;
		let committed = false;
		try {
			const token = await this.requestWebToken(tokenInput.refreshToken, randomUUID(), `Token authentication failed (${source})!`);
			if (!token) {
				return false;
			}

			this.token = token;
			this.cmsToken = {};
			if (!(await this.getProfile(false))) {
				console.error(`Token authentication failed (${source}): profile lookup failed.`);
				return false;
			}
			if (!(await this.getCMStoken())) {
				console.error(`Token authentication failed (${source}): CMS authentication failed.`);
				return false;
			}
			if (!yamlCfg.saveCRTokenAtomic(token)) return false;
			committed = true;
			console.info(`Signed in with a Crunchyroll browser cookie (${source}). Session saved.`);
			return true;
		} catch {
			console.error(`Token authentication failed (${source}).`);
			return false;
		} finally {
			if (!committed) {
				this.token = previousToken;
				this.cmsToken = previousCMS;
			}
		}
	}

	public async loginWithAndroidPhone(): Promise<boolean> {
		try {
			const token = await loginWithPhone(this.req.getData.bind(this.req));
			if (!token) {
				console.error('Android phone sign-in failed or was cancelled.');
				return false;
			}
			if (!yamlCfg.saveCRTokenAtomic(token)) return false;
			this.token = token;
			this.cmsToken = {};
			console.info('Signed in with Android phone. Session saved.');
			return true;
		} catch (error) {
			console.error(error instanceof Error && [PHONE_CLIENT_REQUIRED, PHONE_CALLBACK_INVALID].includes(error.message) ? error.message : 'Android phone sign-in failed.');
			return false;
		}
	}

	public async loginWithDevice(signal?: AbortSignal): Promise<boolean> {
		const controller = new AbortController();
		const cancel = () => controller.abort();
		if (signal) {
			if (signal.aborted) cancel();
			else signal.addEventListener('abort', cancel, { once: true });
		} else process.once('SIGINT', cancel);
		const previousToken = this.token;
		const previousCMS = this.cmsToken;
		let committed = false;
		let validationTimer: ReturnType<typeof setTimeout> | undefined;
		let validationStage = 'profile validation';
		let validationError = '';
		const rememberValidationError = (details: string) => (validationError = details);
		const failValidation = (detail: string) => {
			console.error('Status: Error');
			console.error(`Device authentication failed: ${detail}.`);
			return false;
		};
		try {
			const deviceId = randomUUID();
			const token = await requestDeviceToken({
				request: this.req.getData.bind(this.req),
				authUrl: `${domain.cr_www}/auth/v1/token`,
				fallbackAuthUrl: `${domain.cr_api}/auth/v1/token`,
				warn: (message) => console.warn(message),
				headers: { Authorization: `Basic ${api.basic_auth_token}`, 'User-Agent': DEVICE_USER_AGENT, Accept: 'application/json' },
				deviceId,
				signal: controller.signal,
				debug: this.debug,
				log: (message) => console.info(message),
				openActivation: (url) => {
					void import('open')
						.then(({ default: open }) => {
							if (!controller.signal.aborted) return open(url);
						})
						.catch(() => {});
				},
				onCountdown: (remainingSeconds, status) => {
					if (remainingSeconds === undefined) {
						if (!this.debug && process.stdout.isTTY) process.stdout.write('\n');
						return;
					}
					const state = status === 'approved' ? 'Approved' : status === 'timed-out' ? 'Timed Out' : status === 'error' ? 'Error' : 'Waiting for approval';
					const message = `Expires in ${remainingSeconds} seconds. (${state})`;
					if (!this.debug && process.stdout.isTTY) process.stdout.write(`\r\x1b[2K${message}`);
					else console.info(message);
				}
			});
			if (!token) return false;
			this.token = {
				...token,
				device_id: deviceId,
				device_name: getDeviceName(deviceId),
				device_type: DEVICE_TYPE,
				device_user_agent: DEVICE_USER_AGENT,
				device_auth_origin: token.device_auth_origin === 'api' ? 'api' : 'www',
				auth_type: 'device',
				expires: new Date(Date.now() + token.expires_in * 1000)
			};
			this.cmsToken = {};
			validationTimer = setTimeout(cancel, 30000);
			if (!(await this.getProfile(false, controller.signal, true, rememberValidationError)) || controller.signal.aborted) {
				return failValidation(`profile validation failed${validationError ? ` (${validationError})` : ''}`);
			}
			validationStage = 'CMS authentication';
			if (!(await this.getCMStoken(false, controller.signal, true, rememberValidationError)) || controller.signal.aborted) {
				return failValidation(`CMS validation failed${validationError ? ` (${validationError})` : ''}`);
			}
			validationStage = 'session save';
			if (!yamlCfg.saveCRTokenAtomic(this.token)) {
				return failValidation('session could not be saved');
			}
			committed = true;
			console.info('Signed in with Android TV. Session saved.');
			return true;
		} catch {
			return failValidation(`${validationStage} failed${validationError ? ` (${validationError})` : ''}`);
		} finally {
			if (validationTimer) clearTimeout(validationTimer);
			if (signal) signal.removeEventListener('abort', cancel);
			else process.removeListener('SIGINT', cancel);
			// A candidate is committed only after the durable save succeeds.
			if (!committed) {
				this.token = previousToken;
				this.cmsToken = previousCMS;
			}
		}
	}

	public async refreshToken(ifNeeded = false, silent = false): Promise<boolean> {
		if (this.refreshInFlight) return this.refreshInFlight;
		const work = this.refreshTokenOnce(ifNeeded, silent);
		this.refreshInFlight = work;
		try {
			return await work;
		} finally {
			this.refreshInFlight = undefined;
		}
	}

	private async requestRefreshedSession(previous: CrunchySession, onRejected?: () => void): Promise<CrunchySession | undefined> {
		if (previous.auth_type === 'android') return refreshPhoneToken(this.req.getData.bind(this.req), previous, onRejected);
		if (previous.auth_type === 'web') return this.requestWebToken(previous.refresh_token, previous.device_id || randomUUID(), 'Token Refresh Failed!', onRejected);
		if (this.debug && previous.auth_type !== 'device') console.debug(`[DEBUG] Refresh request: ${api.auth}`);
		const client = atob(api.basic_auth_token).split(':');
		const uuid = previous.device_id || randomUUID();
		const body = new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: previous.refresh_token,
			scope: 'offline_access',
			client_id: client[0],
			client_secret: client[1],
			device_id: uuid,
			device_name: previous.device_name || 'emu64xa',
			device_type: previous.device_type || 'ANDROIDTV'
		}).toString();
		const device = previous.auth_type === 'device';
		let origin: 'www' | 'api' = previous.device_auth_origin === 'api' ? 'api' : 'www';
		const requestOptions: FetchParams = {
			method: 'POST',
			headers: device
				? { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent': this.deviceUserAgent(previous) }
				: { ...api.crunchyAuthHeader },
			body,
			useProxy: true
		};
		let primaryTimedOut = false;
		let result;
		if (device) {
			const doAttempt = async (selected: 'www' | 'api') => {
				const url = `${selected === 'www' ? domain.cr_www : domain.cr_api}/auth/v1/token`;
				if (this.debug) console.debug(`[DEBUG] Refresh request: ${url} (HTTP/2 preferred)`);
				return deviceAuthAttempt(this.req.getData.bind(this.req), url, requestOptions);
			};
			if (origin === 'api') console.warn(DEVICE_BETA_WARNING);
			let attempt = await doAttempt(origin);
			primaryTimedOut = attempt.timedOut;
			if (origin === 'www' && !attempt.result.ok && (await deviceFallbackEligible(attempt.result))) {
				console.warn(DEVICE_BETA_WARNING);
				origin = 'api';
				attempt = await doAttempt(origin);
			}
			result = attempt.timedOut ? { ...attempt.result, ok: false } : attempt.result;
		} else {
			result = await this.req.getData(api.auth, requestOptions);
		}

		if (this.debug) console.debug(`[DEBUG] Refresh response: ${result.res?.status ?? 'network error'}`);
		if (!result.ok || !result.res) {
			const rejected = await refreshCredentialsRejected(result.res);
			if (onRejected) {
				if (rejected) onRejected();
			} else {
				console.error(
					rejected && previous.auth_type === 'device'
						? primaryTimedOut && origin === 'api'
							? `Device refresh credentials are unusable. Sign in again.\n${crunchyLoginInstruction('--device androidtv')}`
							: `Device refresh rejected. Sign in again.\n${crunchyLoginInstruction('--device androidtv')}`
						: 'Token refresh failed; retry later. Saved login was retained.'
				);
			}
			return;
		}
		// Preserve the existing native client's Cloudflare cookie propagation.
		if (!device && result.res.headers.get('Set-Cookie')) {
			api.crunchyDefHeader['Cookie'] = result.res.headers.get('Set-Cookie') as string;
			api.crunchyAuthHeader['Cookie'] = result.res.headers.get('Set-Cookie') as string;
		}
		if (!device && result.headers && result.headers['Set-Cookie']) {
			api.crunchyDefHeader['Cookie'] = result.headers['Set-Cookie'];
			api.crunchyAuthHeader['Cookie'] = result.headers['Set-Cookie'];
			api.crunchyDefHeader['User-Agent'] = result.headers['User-Agent'];
			api.crunchyAuthHeader['User-Agent'] = result.headers['User-Agent'];
		}
		const token = await result.res.json();
		if (token && !Object.prototype.hasOwnProperty.call(token, 'refresh_token')) token.refresh_token = previous.refresh_token;
		if (!validDeviceToken(token)) {
			if (!onRejected) console.error('Invalid refresh response; retry later. Saved login was retained.');
			return;
		}
		return {
			...token,
			device_id: uuid,
			device_name: previous.device_name,
			device_type: previous.device_type,
			...(device ? { device_user_agent: this.deviceUserAgent(previous), device_auth_origin: origin } : {}),
			auth_type: previous.auth_type,
			expires: new Date(Date.now() + token.expires_in * 1000)
		};
	}

	private sessionIsCurrent(token: CrunchySession): boolean {
		return typeof token.access_token === 'string' && !!token.access_token.trim() && Date.now() < new Date(token.expires).getTime();
	}

	private async refreshStoredSession(previous: CrunchySession, ifNeeded: boolean, onRejected?: () => void): Promise<CrunchySession | undefined> {
		if (ifNeeded && this.sessionIsCurrent(previous)) return previous;
		const slot = crunchySessionSlot(previous);
		const refreshed = await yamlCfg.withCRTokenRefreshLock(slot, async () => {
			const saved = yamlCfg.loadCRSessions(true).sessions[slot];
			if (saved && ((previous.account_id && saved.account_id !== previous.account_id) || saved.device_id !== previous.device_id)) return;
			const current = saved ?? previous;
			if ((ifNeeded || current.refresh_token !== previous.refresh_token) && this.sessionIsCurrent(current)) return current;
			const updated = await this.requestRefreshedSession(current, onRejected);
			if (!updated || (current.account_id && updated.account_id && current.account_id !== updated.account_id)) return;
			if (!yamlCfg.saveCRTokenAtomic(updated, { activate: false, expectedRefresh: saved?.refresh_token })) return;
			return updated;
		});
		if (!refreshed && !onRejected) console.error('Unable to refresh the saved Crunchyroll session. Saved login was retained.');
		return refreshed;
	}

	private async refreshTokenOnce(ifNeeded: boolean, silent: boolean): Promise<boolean> {
		try {
			if (['device', 'android', 'web'].includes(this.token.auth_type) && !this.token.refresh_token) {
				console.error(
					this.token.auth_type === 'device'
						? `Device login is missing its refresh token. Sign in again.\n${crunchyLoginInstruction('--device androidtv')}`
						: 'The saved login is missing its refresh token. Sign in again.'
				);
				return false;
			}
			if (!this.token.refresh_token) {
				if (!(await this.doAnonymousAuth())) return false;
			} else {
				if (ifNeeded && this.sessionIsCurrent(this.token)) return await this.getCMStoken(true);
				const token = await this.refreshStoredSession(this.token, ifNeeded);
				if (!token) return false;
				this.token = token;
			}
			if (this.token.refresh_token) {
				if (!(await this.getProfile(silent))) return false;
			} else console.info('USER: Anonymous');
			return await this.getCMStoken();
		} catch {
			console.error('Authentication failed; retry later. Saved login was retained.');
			return false;
		}
	}

	public async getCMStoken(ifNeeded = false, signal?: AbortSignal, quietErrors = false, onError?: (details: string) => void): Promise<boolean> {
		if (!this.token.access_token) {
			if (quietErrors) onError?.('No access token');
			else console.error('No access token!');
			return false;
		}

		if (ifNeeded && this.cmsToken.cms) {
			if (Number.isFinite(new Date(this.cmsToken.cms.expires).getTime()) && Date.now() < new Date(this.cmsToken.cms.expires).getTime()) {
				return true;
			}
		}

		const cmsTokenReqOpts = {
			signal,
			quietErrors,
			quietDebug: this.token.auth_type === 'android',
			headers: {
				Authorization: `Bearer ${this.token.access_token}`,
				...this.deviceHeaders()
			}
		};
		const cmsTokenReq = await this.req.getData(api.cms_auth, cmsTokenReqOpts);
		if (!cmsTokenReq.ok || !cmsTokenReq.res) {
			if (quietErrors) onError?.(await deviceErrorDetails(cmsTokenReq));
			else console.error('Authentication CMS token failed!');
			return false;
		}
		this.cmsToken = await cmsTokenReq.res.json();
		console.info('Your Country: %s\n', this.cmsToken.cms?.bucket.split('/')[1]);
		const valid = this.checkToken();
		if (!valid && quietErrors) onError?.('CMS response did not include a valid token');
		return valid;
	}

	public async getCmsData() {
		// check token
		if (!this.cmsToken.cms) {
			console.error('Authentication required!');
			return;
		}
		// opts
		const indexReqOpts = [
			api.cms_bucket,
			this.cmsToken.cms.bucket,
			'/index?',
			new URLSearchParams({
				force_locale: '',
				preferred_audio_language: 'ja-JP',
				locale: this.locale,
				Policy: this.cmsToken.cms.policy,
				Signature: this.cmsToken.cms.signature,
				'Key-Pair-Id': this.cmsToken.cms.key_pair_id
			})
		].join('');
		const indexReq = await this.req.getData(indexReqOpts, {
			headers: {
				'User-Agent': api.crunchyDefUserAgent
			}
		});
		if (!indexReq.ok || !indexReq.res) {
			console.error('Get CMS index FAILED!');
			return;
		}
		console.info(await indexReq.res.json());
	}

	public async doSearch(data: SearchData): Promise<SearchResponse> {
		if (!this.token.access_token) {
			console.error('Authentication required!');
			return { isOk: false, reason: new Error('Not authenticated') };
		}
		const searchReqOpts = {
			headers: {
				Authorization: `Bearer ${this.token.access_token}`,
				...api.crunchyDefHeader
			}
		};
		const searchStart = data.page ? (data.page - 1) * 5 : 0;
		const searchParams = new URLSearchParams({
			q: data.search,
			n: '5',
			start: data.page ? `${(data.page - 1) * 5}` : '0',
			type: data['search-type'] ?? getDefault('search-type', this.cfg.cli),
			locale: this.locale
		}).toString();
		const searchReq = await this.req.getData(`${api.search}?${searchParams}`, searchReqOpts);
		if (!searchReq.ok || !searchReq.res) {
			console.error('Search FAILED!');
			return { isOk: false, reason: new Error('Search failed. No more information provided') };
		}
		const searchResults = (await searchReq.res.json()) as CrunchySearch;
		if (searchResults.total < 1) {
			console.info('Nothing Found!');
			return { isOk: true, value: [] };
		}

		const searchTypesInfo = {
			top_results: 'Top results',
			series: 'Found series',
			movie_listing: 'Found movie lists',
			episode: 'Found episodes'
		};
		for (const search_item of searchResults.data) {
			console.info('%s:', searchTypesInfo[search_item.type as keyof typeof searchTypesInfo]);
			// calculate pages
			const pageCur = searchStart > 0 ? Math.ceil(searchStart / 5) + 1 : 1;
			const pageMax = Math.ceil(search_item.count / 5);
			// pages per category
			if (search_item.count < 1) {
				console.info('  Nothing Found...');
			}
			if (search_item.count > 0) {
				if (pageCur > pageMax) {
					console.info('  Last page is %s...', pageMax);
					continue;
				}
				for (const item of search_item.items) {
					await this.logObject(item);
				}
				console.info(`  Total results: ${search_item.count} (Page: ${pageCur}/${pageMax})`);
			}
		}
		const toSend = searchResults.data.filter((a) => a.type === 'series' || a.type === 'movie_listing');
		return {
			isOk: true,
			value: toSend
				.map((a) => {
					return a.items.map((a): SearchResponseItem => {
						const images = (a.images?.poster_tall ?? [[{ source: '/notFound.png' }]])[0];
						return {
							id: a.id,
							image: images[Math.floor(images.length / 2)].source,
							name: a.title,
							rating: -1,
							desc: a.description
						};
					});
				})
				.reduce((pre, cur) => pre.concat(cur))
		};
	}

	public async logObject(item: ParseItem, pad?: number, getSeries?: boolean, getMovieListing?: boolean) {
		if (this.debug) {
			console.info(item);
		}
		pad = pad ?? 2;
		getSeries = getSeries === undefined ? true : getSeries;
		getMovieListing = getMovieListing === undefined ? true : getMovieListing;
		item.isSelected = item.isSelected === undefined ? false : item.isSelected;
		if (!item.type) {
			item.type = item.__class__;
		}

		//guess item type
		//TODO: look into better methods of getting item type
		let iType = item.type;
		if (!iType) {
			if (item.episode_number) {
				iType = 'episode';
			} else if (item.season_number) {
				iType = 'season';
			} else if (item.season_count) {
				iType = 'series';
			} else if (item.media_type == 'movie') {
				iType = 'movie';
			} else if (item.movie_release_year) {
				iType = 'movie_listing';
			} else if (item.type && item.type === 'musicVideo') {
				iType = 'music_video';
			} else {
				if (item.identifier !== '') {
					const iTypeCheck = item.identifier?.split('|');
					if (iTypeCheck) {
						if (iTypeCheck[1] == 'M') {
							iType = 'movie';
						} else if (!iTypeCheck[2]) {
							iType = 'season';
						} else {
							iType = 'episode';
						}
					} else {
						iType = 'series';
					}
				} else {
					iType = 'movie_listing';
				}
			}
			item.type = iType;
		}

		const oTypes = {
			series: 'Z', // SRZ
			season: 'S', // VOL
			episode: 'E', // EPI
			movie_listing: 'F', // FLM
			movie: 'M', // MED
			musicVideo: 'MV' // MVD
		};
		// check title
		item.title = item.title != '' ? item.title : 'NO_TITLE';
		// static data
		const oMetadata: string[] = [],
			oBooleans: string[] = [],
			tMetadata = item.type + '_metadata',
			iMetadata = (Object.prototype.hasOwnProperty.call(item, tMetadata) ? item[tMetadata as keyof ParseItem] : item) as Record<string, any>,
			iTitle = [item.title];

		const audio_languages: string[] = [];

		// set object booleans
		if (iMetadata.duration_ms) {
			oBooleans.push(Helper.formatTime(iMetadata.duration_ms / 1000));
		}
		if (iMetadata.is_simulcast) {
			oBooleans.push('SIMULCAST');
		}
		if (iMetadata.is_mature) {
			oBooleans.push('MATURE');
		}
		if (item.versions) {
			for (const version of item.versions) {
				audio_languages.push(version.audio_locale);
				if (version.original) {
					oBooleans.push('SUB');
				} else {
					if (!oBooleans.includes('DUB')) {
						oBooleans.push('DUB');
					}
				}
			}
		} else {
			if (iMetadata.is_subbed) {
				oBooleans.push('SUB');
			}
			if (iMetadata.is_dubbed) {
				oBooleans.push('DUB');
			}
		}
		if (item.playback && item.type != 'movie_listing') {
			oBooleans.push('STREAM');
		}
		// set object metadata
		if (iMetadata.season_count) {
			oMetadata.push(`Seasons: ${iMetadata.season_count}`);
		}
		if (iMetadata.episode_count) {
			oMetadata.push(`EPs: ${iMetadata.episode_count}`);
		}
		if (item.season_number && !iMetadata.hide_season_title && !iMetadata.hide_season_number) {
			oMetadata.push(`Season: ${item.season_number}`);
		}
		if (item.type == 'episode') {
			if (iMetadata.episode) {
				iTitle.unshift(iMetadata.episode);
			}
			if (!iMetadata.hide_season_title && iMetadata.season_title) {
				iTitle.unshift(iMetadata.season_title);
			}
		}
		if (item.is_premium_only) {
			iTitle[0] = `☆ ${iTitle[0]}`;
		}
		// display metadata
		if (item.hide_metadata) {
			iMetadata.hide_metadata = item.hide_metadata;
		}
		const showObjectMetadata = oMetadata.length > 0 && !iMetadata.hide_metadata;
		const showObjectBooleans = oBooleans.length > 0 && !iMetadata.hide_metadata;
		// make obj ids
		const objects_ids: string[] = [];
		objects_ids.push(oTypes[item.type as keyof typeof oTypes] + ':' + item.id);
		if (item.seq_id) {
			objects_ids.unshift(item.seq_id);
		}
		if (item.f_num) {
			objects_ids.unshift(item.f_num);
		}
		if (item.s_num) {
			objects_ids.unshift(item.s_num);
		}
		if (item.external_id) {
			objects_ids.push(item.external_id);
		}
		if (item.ep_num) {
			objects_ids.push(item.ep_num);
		}

		// show entry
		console.info(
			'%s%s[%s] %s%s%s',
			''.padStart(item.isSelected ? pad - 1 : pad, ' '),
			item.isSelected ? '✓' : '',
			objects_ids.join('|'),
			iTitle.join(' - '),
			showObjectMetadata ? ` (${oMetadata.join(', ')})` : '',
			showObjectBooleans ? ` [${oBooleans.join(', ')}]` : ''
		);
		if (item.last_public) {
			console.info(''.padStart(pad + 1, ' '), '- Last updated:', item.last_public);
		}
		if (item.subtitle_locales) {
			iMetadata.subtitle_locales = item.subtitle_locales;
		}
		if (item.versions && audio_languages.length > 0) {
			console.info('%s- Versions: %s', ''.padStart(pad + 2, ' '), langsData.parseSubtitlesArray(audio_languages));
		}
		if (iMetadata.subtitle_locales && iMetadata.subtitle_locales.length > 0) {
			console.info('%s- Subtitles: %s', ''.padStart(pad + 2, ' '), langsData.parseSubtitlesArray(iMetadata.subtitle_locales));
		}
		if (item.availability_notes) {
			console.info('%s- Availability notes: %s', ''.padStart(pad + 2, ' '), item.availability_notes.replace(/\[[^\]]*]?/gm, ''));
		}
		if (item.type == 'series' && getSeries) {
			await this.logSeriesById(item.id, pad, true);
			console.info('');
		}
		if (item.type == 'movie_listing' && getMovieListing) {
			await this.logMovieListingById(item.id, pad + 2);
			console.info('');
		}
	}

	public async logSeriesById(id: string, pad?: number, hideSeriesTitle?: boolean) {
		// parse
		pad = pad || 0;
		hideSeriesTitle = hideSeriesTitle !== undefined ? hideSeriesTitle : false;
		// check token
		if (!this.cmsToken.cms) {
			console.error('Authentication required!');
			return;
		}
		// opts
		const AuthHeaders = {
			headers: {
				Authorization: `Bearer ${this.token.access_token}`,
				...api.crunchyDefHeader
			}
		};
		// reqs
		if (!hideSeriesTitle) {
			const seriesReq = await this.req.getData(`${api.content_cms}/series/${id}?force_locale=&preferred_audio_language=ja-JP&locale=${this.locale}`, AuthHeaders);
			if (!seriesReq.ok || !seriesReq.res) {
				console.error('Series Request FAILED!');
				return;
			}
			const seriesData = await seriesReq.res.json();
			await this.logObject(seriesData.data[0], pad, false);
		}
		// seasons list
		const seriesSeasonListReq = await this.req.getData(
			`${api.content_cms}/series/${id}/seasons?force_locale=&preferred_audio_language=ja-JP&locale=${this.locale}`,
			AuthHeaders
		);
		if (!seriesSeasonListReq.ok || !seriesSeasonListReq.res) {
			console.error('Series Request FAILED!');
			return;
		}
		// parse data
		const seasonsList = (await seriesSeasonListReq.res.json()) as SeriesSearch;
		if (seasonsList.total < 1) {
			console.info('Series is empty!');
			return;
		}
		for (const item of seasonsList.data) {
			await this.logObject(item, pad + 2);
		}
	}

	public async logMovieListingById(id: string, pad?: number) {
		pad = pad || 2;
		if (!this.cmsToken.cms) {
			console.error('Authentication required!');
			return;
		}

		// opts
		const AuthHeaders = {
			headers: {
				Authorization: `Bearer ${this.token.access_token}`,
				...api.crunchyDefHeader
			}
		};

		//Movie Listing
		const movieListingReq = await this.req.getData(`${api.content_cms}/movie_listings/${id}?force_locale=&preferred_audio_language=ja-JP&locale=${this.locale}`, AuthHeaders);
		if (!movieListingReq.ok || !movieListingReq.res) {
			console.error('Movie Listing Request FAILED!');
			return;
		}
		const movieListing = await movieListingReq.res.json();
		if (movieListing.total < 1) {
			console.info('Movie Listing is empty!');
			return;
		}
		for (const item of movieListing.data) {
			await this.logObject(item, pad, false, false);
		}

		//Movies
		const moviesListReq = await this.req.getData(
			`${api.content_cms}/movie_listings/${id}/movies?force_locale=&preferred_audio_language=ja-JP&locale=${this.locale}`,
			AuthHeaders
		);
		if (!moviesListReq.ok || !moviesListReq.res) {
			console.error('Movies List Request FAILED!');
			return;
		}
		const moviesList = await moviesListReq.res.json();
		for (const item of moviesList.data) {
			await this.logObject(item, pad + 2);
		}
	}

	public async getNewlyAdded(page: number = 1, type: string, raw: boolean = false, rawoutput?: string) {
		if (!this.token.access_token) {
			console.error('Authentication required!');
			return;
		}
		const newlyAddedReqOpts = {
			headers: {
				Authorization: `Bearer ${this.token.access_token}`,
				...api.crunchyDefHeader
			}
		};
		const newlyAddedParams = new URLSearchParams({
			sort_by: 'newly_added',
			type: type || 'series',
			n: '50',
			start: (page ? (page - 1) * 25 : 0).toString(),
			preferred_audio_language: 'ja-JP',
			force_locale: '',
			locale: this.locale
		}).toString();
		const newlyAddedReq = await this.req.getData(`${api.browse}?${newlyAddedParams}`, newlyAddedReqOpts);
		if (!newlyAddedReq.ok || !newlyAddedReq.res) {
			console.error('Get newly added FAILED!');
			return;
		}
		const newlyAddedResults = await newlyAddedReq.res.json();

		if (raw) {
			console.info(JSON.stringify(newlyAddedResults, null, 2));
			if (rawoutput) {
				try {
					fs.writeFileSync(rawoutput, JSON.stringify(newlyAddedResults), { encoding: 'utf-8' });
					console.info(`Raw output saved to ${rawoutput}`);
				} catch (e) {
					console.error(`Failed to save raw output to ${rawoutput}:`, e);
				}
			}
			return;
		}

		console.info('Newly added:');
		for (const i of newlyAddedResults.items) {
			await this.logObject(i, 2);
		}
		// calculate pages
		const itemPad = parseInt(new URL(newlyAddedResults.__href__, domain.cr_api).searchParams.get('start') as string);
		const pageCur = itemPad > 0 ? Math.ceil(itemPad / 25) + 1 : 1;
		const pageMax = Math.ceil(newlyAddedResults.total / 25);
		console.info(`  Total results: ${newlyAddedResults.total} (Page: ${pageCur}/${pageMax})`);
	}

	public async getSeasonById(
		id: string,
		numbers: number,
		e: string | undefined,
		but: boolean,
		all: boolean,
		selection?: Pick<CrunchyMultiDownload, 'dubLang' | 'allDubs'>
	): Promise<ResponseBase<CrunchyEpMeta[]>> {
		selection ??= { dubLang: yargs.appArgv(this.cfg.cli).dubLang };
		if (!this.cmsToken.cms) {
			console.error('Authentication required!');
			return { isOk: false, reason: new Error('Authentication required') };
		}

		const AuthHeaders = {
			headers: {
				Authorization: `Bearer ${this.token.access_token}`,
				...api.crunchyDefHeader
			}
		};

		//get show info
		const showInfoReq = await this.req.getData(`${api.content_cms}/seasons/${id}?force_locale=&preferred_audio_language=ja-JP&locale=${this.locale}`, AuthHeaders);
		if (!showInfoReq.ok || !showInfoReq.res) {
			console.error('Show Request FAILED!');
			return { isOk: false, reason: new Error('Show request failed. No more information provided.') };
		}
		const showInfo = await showInfoReq.res.json();
		await this.logObject(showInfo.data[0], 0);

		let episodeList: CrunchyEpisodeList;
		//get episode info CMS
		const reqEpsCMSListOpts = [
			api.cms_bucket,
			this.cmsToken.cms.bucket,
			'/episodes?',
			new URLSearchParams({
				force_locale: '',
				preferred_audio_language: 'ja-JP',
				locale: this.locale,
				season_id: id,
				Policy: this.cmsToken.cms.policy,
				Signature: this.cmsToken.cms.signature,
				'Key-Pair-Id': this.cmsToken.cms.key_pair_id
			})
		].join('');
		const reqEpsCMSList = await this.req.getData(reqEpsCMSListOpts, AuthHeaders);
		if (!reqEpsCMSList.ok || !reqEpsCMSList.res) {
			console.error('Episode List Request FAILED!');
			return { isOk: false, reason: new Error('Episode List request failed. No more information provided.') };
		}
		//CrunchyEpisodeList
		const episodeListAndroid = (await reqEpsCMSList.res.json()) as CrunchyAndroidEpisodes;

		//get episode info API
		const reqEpsListOpts = [
			domain.cr_api,
			'/content/v2/cms/seasons/',
			id,
			'/episodes?',
			new URLSearchParams({
				force_locale: '',
				preferred_audio_language: 'ja-JP',
				locale: this.locale
			})
		].join('');
		const reqEpsList = await this.req.getData(reqEpsListOpts, AuthHeaders);
		if (!reqEpsList.ok || !reqEpsList.res) {
			console.error('Episode List Request FAILED!');
			return { isOk: false, reason: new Error('Episode List request failed. No more information provided.') };
		}
		//CrunchyEpisodeList
		const episodeListAPI = (await reqEpsList.res.json()) as CrunchyEpisodeList;

		// if API has more items than CMS use API episodes
		if (episodeListAPI.total > episodeListAndroid.total) {
			episodeList = {
				total: episodeListAPI.total,
				data: episodeListAPI.data,
				meta: {}
			};
		} else {
			episodeList = {
				total: episodeListAndroid.total,
				data: episodeListAndroid.items,
				meta: {}
			};
		}

		const epNumList: {
			ep: number[];
			sp: number;
		} = { ep: [], sp: 0 };
		const epNumLen = numbers;

		if (episodeList.total < 1) {
			console.info('  Season is empty!');
			return { isOk: true, value: [] };
		}

		const doEpsFilter = parseSelect(e as string);
		const selectedMedia: CrunchyEpMeta[] = [];

		episodeList.data.forEach((item) => {
			item.hide_season_title = true;
			if (item.season_title == '' && item.series_title != '') {
				item.season_title = item.series_title;
				item.hide_season_title = false;
				item.hide_season_number = true;
			}
			if (item.season_title == '' && item.series_title == '') {
				item.season_title = 'NO_TITLE';
				item.series_title = 'NO_TITLE';
			}
			const epNum = item.episode;
			let isSpecial = false;
			item.isSelected = false;
			if (!epNum.match(/^\d+$/) || epNumList.ep.indexOf(parseInt(epNum, 10)) > -1) {
				isSpecial = true;
				epNumList.sp++;
			} else {
				epNumList.ep.push(parseInt(epNum, 10));
			}
			const selEpId = isSpecial ? 'S' + epNumList.sp.toString().padStart(epNumLen, '0') : '' + parseInt(epNum, 10).toString().padStart(epNumLen, '0');
			// set data
			const images = (item.images?.thumbnail ?? [[{ source: '/notFound.png' }]])[0];
			const epMeta: CrunchyEpMeta = {
				data: [
					{
						mediaId: item.id,
						versions: item.versions ?? null,
						playback: item.playback,
						lang: langsData.languages.find((a) => a.cr_locale === item.audio_locale) ?? langsData.languages.find((a) => a.code === selection.dubLang[0]),
						isSubbed: item.is_subbed,
						isDubbed: item.is_dubbed,
						durationMs: item.duration_ms ?? 0
					}
				],
				seriesTitle: item.series_title,
				seasonTitle: item.season_title,
				episodeNumber: item.episode,
				episodeTitle: item.title,
				seasonID: item.season_id,
				season: item.season_number,
				showID: id,
				e: selEpId,
				image: images[Math.floor(images.length / 2)].source
			};
			// Check for streams_link and update playback var if needed
			if (item.__links__?.streams?.href) {
				epMeta.data[0].playback = item.__links__.streams.href;
				if (!item.playback) {
					item.playback = item.__links__.streams.href;
				}
			}
			if (item.streams_link) {
				epMeta.data[0].playback = item.streams_link;
				if (!item.playback) {
					item.playback = item.streams_link;
				}
			}
			if (item.versions?.length) {
				const seen = new Set<string>();
				const entries = item.versions.flatMap((version) => {
					const lang = langsData.languages.find((candidate) => candidate.cr_locale === version.audio_locale);
					if (!lang || seen.has(lang.code)) return [];
					seen.add(lang.code);
					return [{ ...epMeta.data[0], mediaId: version.guid || item.id, lang }];
				});
				if (entries.length) epMeta.data = entries;
			}
			this.applyDubSelection(epMeta, selection.dubLang, selection.allDubs);
			// find episode numbers
			if (
				(but && item.playback && !doEpsFilter.isSelected([selEpId, item.id])) ||
				(all && item.playback) ||
				(!but && doEpsFilter.isSelected([selEpId, item.id]) && !item.isSelected && item.playback)
			) {
				selectedMedia.push(epMeta);
				item.isSelected = true;
			}
			// show ep
			item.seq_id = selEpId;
			this.logObject(item);
		});

		// display
		if (selectedMedia.length < 1) {
			console.info('\nEpisodes not selected!\n');
		}

		console.info('');
		return { isOk: true, value: selectedMedia };
	}

	private resolveSelectedVersion(item: CrunchyEpMeta['data'][number], options: CrunchyDownloadOptions): EpisodeVersion | undefined {
		const itemVersions = item.versions;
		if (!itemVersions) return undefined;
		const hasExplicitLanguage = !!item.lang || options.dubLang?.length === 1;
		const configuredLocale = item.lang
			? item.lang.cr_locale
			: options.dubLang?.length === 1
				? langsData.languages.find((lang) => lang.code === options.dubLang[0])?.cr_locale
				: undefined;
		const requestedVersion = configuredLocale ? itemVersions.find((version) => version.audio_locale === configuredLocale) : undefined;
		if (!options.noaudio) return requestedVersion || (!hasExplicitLanguage && itemVersions.length === 1 ? itemVersions[0] : undefined);
		if (requestedVersion?.guid && requestedVersion.media_guid) return requestedVersion;
		const mediaId = item.mediaId.includes(':') ? item.mediaId.split(':')[1] : item.mediaId;
		return (
			itemVersions.find((version) => version.guid === mediaId && version.media_guid) ||
			itemVersions.find((version) => version.original && version.guid && version.media_guid) ||
			itemVersions.find((version) => version.guid && version.media_guid)
		);
	}

	public async downloadEpisode(data: CrunchyEpMeta, options: CrunchyDownloadOptions, isSeries?: boolean): Promise<boolean> {
		options = { ...options };
		const state: PlaybackRecoveryState = {
			budget: options.queueRecovery ?? this.commandRecovery ?? { used: false },
			permitClear: !!options.tsd,
			preflightChecked: false,
			resetPerformed: false,
			noticeShown: false,
			ordinal: 0
		};
		options.queueRecovery = state.budget;
		options.recoveryState = state;
		const versions = data.data?.[0]?.versions;
		const requested = (data.data ?? []).map((item) => this.resolveSelectedVersion(item, options));
		if (!options.noaudio) {
			const items = data.data ?? [];
			const failedItems = items.filter((item, index) => item.versions != null && (!requested[index]?.guid || !requested[index]?.media_guid));
			const missingRequired = (data.requiredDubLang ?? []).filter((code) => {
				const index = items.findIndex((item) => item.lang?.code === code);
				return index < 0 || (items[index].versions != null && (!requested[index]?.guid || !requested[index]?.media_guid));
			});
			if (missingRequired.length || failedItems.length) {
				const failedCodes = failedItems.map((item) => item.lang?.code ?? (options.dubLang.length === 1 ? options.dubLang[0] : 'unknown'));
				let missing = [...new Set(missingRequired.length ? missingRequired : failedCodes)];
				if (data.requiredDubLang) {
					missing = [...new Set([...data.requiredDubLang.filter((code) => missing.includes(code)), ...missing])];
				} else if (options.requestedDubLang && versions != null) {
					missing = [
						...new Set(
							options.requestedDubLang
								.filter((code) => {
									const locales = langsData.languages.filter((lang) => lang.code === code).map((lang) => lang.cr_locale);
									return !versions.some((version) => locales.includes(version.audio_locale) && version.guid && version.media_guid);
								})
								.concat(missing)
						)
					];
				}
				const names = [...new Set(missing.map((code) => langsData.languages.find((lang) => lang.code === code)?.name ?? code))];
				console.error(`Selected audio languages were not found: ${names.join(', ')}`);
				return false;
			}
		}

		const selectedLocales = new Set<string>(requested.filter((version): version is EpisodeVersion => !!version).map((version) => version.audio_locale));
		const allDubs = data.allDubs ?? options.allDubs;
		const activeVersions = options.qall ? versions : requested.every(Boolean) ? versions?.filter((version) => selectedLocales.has(version.audio_locale)) : [];
		const perRequestDiscovery = !!options.qall || selectedLocales.size > 1;
		const discoveryPause = options.discoveryTimmer;
		const routing = await this.resolvePlaybackRouting(options);
		if (!routing) return false;
		const broadDiscoveryWarning = options.qall || !!allDubs || new Set(data.requiredDubLang ?? []).size > 2 || selectedLocales.size > 2;
		if (broadDiscoveryWarning && !state.budget.qallWarned) {
			console.warn(
				options.qall
					? 'Full stream discovery scans more sources, is slower, and can trigger rate limits affecting normal viewing.'
					: 'Multi-stream discovery scans more sources, is slower, and can trigger rate limits affecting normal viewing.'
			);
			state.budget.qallWarned = true;
		}
		if (state.permitClear) {
			if (!(await this.refreshToken(true, true))) return false;
			const headers = this.playbackHeaders(routing.video);
			const controller = new AbortController();
			const onSignal = () => controller.abort();
			const cli = process.env.isGUI !== 'true';
			const indicator = new WorkingIndicator(cli && !this.debug && !this.req.argv?.debug && !!process.stdout.isTTY && !!process.env.TERM && process.env.TERM !== 'dumb');
			if (cli) {
				process.on('SIGINT', onSignal);
				process.on('SIGTERM', onSignal);
			}
			indicator.start();
			let released = false;
			const release = () => {
				if (released) return;
				released = true;
				indicator.stop();
				if (cli) {
					process.removeListener('SIGINT', onSignal);
					process.removeListener('SIGTERM', onSignal);
				}
			};
			const sourceCount = Math.max(1, new Set((activeVersions ?? []).map((version) => version.guid)).size);
			const scheduler = new DiscoveryScheduler(
				sourceCount * (options.vstream === 'android' || options.vstream === 'androidtab' ? 7 : 5),
				undefined,
				controller.signal,
				(retry, ms, kind) => indicator.waiting(retry, ms, kind, state.ordinal, state.owned || state.resetPerformed ? 2 : 3),
				discoveryPause,
				undefined,
				perRequestDiscovery,
				() => indicator.extraTime()
			);
			state.initial = { scheduler, controller, indicator, release };
			state.preflightChecked = true;
			if (!(await this.resolvePlaybackCapacity(headers, scheduler, controller.signal, state, indicator))) {
				release();
				return false;
			}
		}

		try {
			let res: Awaited<ReturnType<Crunchy['downloadMediaList']>>;
			let muxOptions = options;
			let fallbackCause: string | undefined;
			const requestedCode = data.data?.[0]?.lang?.code || (options.dubLang?.length === 1 ? options.dubLang[0] : undefined);
			const fallbackLanguage =
				langsData.languages.find((lang) => lang.code === requestedCode)?.code ||
				(versions?.length === 1 ? langsData.languages.find((lang) => lang.cr_locale === versions[0].audio_locale)?.code : undefined) ||
				'requested';
			const eligible =
				!options.novids &&
				!(options as CrunchyMuxOptions).keepAllVideos &&
				options.hslang === 'none' &&
				!!versions?.length &&
				data.data.every((item) => item.versions?.length);
			if (eligible && versions) {
				const unique = [...new Map(versions.filter((version) => version.guid && version.media_guid).map((version) => [version.guid, version])).values()];
				const conflicting = versions.some((version) =>
					unique.some((item) => item.guid === version.guid && (item.audio_locale !== version.audio_locale || item.media_guid !== version.media_guid))
				);
				const sameEpisode =
					!conflicting && requested.every((version) => version && unique.some((item) => item.guid === version.guid && item.media_guid === version.media_guid));
				const sources: VideoSource[] = unique
					.filter((version) => activeVersions?.some((active) => active.guid === version.guid))
					.map((version) => ({
						guid: version.guid,
						locale: version.audio_locale,
						languageCode: langsData.languages.find((lang) => lang.cr_locale === version.audio_locale)?.code || ''
					}));
				if (!sameEpisode || !sources.every((source) => source.guid && source.locale && source.languageCode)) fallbackCause = 'version metadata unavailable';
				if (sameEpisode && sources.every((source) => source.guid && source.locale && source.languageCode)) {
					if (!(await this.refreshToken(true, true))) return false;
					const headers = this.playbackHeaders(routing.video);
					const preferred = [...new Set(requested.map((version) => version!.guid))];
					const headersForPlayback = headers;
					const playbackBinding = accountBinding(routing.video.session.account_id);
					const observePlayback = (response: Response) =>
						observePlaybackWait(yamlCfg.workingDir ? path.join(yamlCfg.workingDir, 'config') : (this.cfg.dir.config ?? ''), playbackBinding, response);
					const initial = state.initial;
					const controller = initial?.controller ?? new AbortController();
					const onSignal = () => controller.abort();
					const cli = process.env.isGUI !== 'true';
					const indicator =
						initial?.indicator ??
						new WorkingIndicator(cli && !this.debug && !this.req.argv?.debug && !!process.stdout.isTTY && !!process.env.TERM && process.env.TERM !== 'dumb');
					if (!initial && cli) {
						process.on('SIGINT', onSignal);
						process.on('SIGTERM', onSignal);
					}
					indicator.start();
					let discovery: Awaited<ReturnType<typeof discoverVideoCandidates>>;
					let videoAuthRejected = false;
					try {
						discovery = await discoverVideoCandidates({
							signal: controller.signal,
							onWaiting: (retry, ms, kind, playbackRetry) =>
								indicator.waiting(retry, ms, kind, state.owned ? state.ordinal : playbackRetry, state.owned || state.resetPerformed ? 2 : 3),
							scheduler: initial?.scheduler,
							replayLimit: () => (state.resetPerformed ? 2 : 3),
							recoveryBudget: options.queueRecovery,
							recover: async (attempt, scheduler, signal, headers, refusedAt, refusedWall) => {
								state.ordinal = attempt;
								if (!state.noticeShown) {
									this.playbackRateNotice(state.resetPerformed, state.permitClear || state.budget.used);
									state.noticeShown = true;
								}
								const ok = await this.resolvePlaybackCapacity(
									headersForPlayback,
									scheduler,
									signal,
									state,
									indicator,
									{
										headers,
										ordinal: attempt,
										at: refusedAt,
										wall: refusedWall
									},
									attempt < 3
								);
								return ok;
							},
							fixedPauseMs: discoveryPause,
							qall: perRequestDiscovery,
							onSlow: () => indicator.extraTime(),
							onAcquired: () => {
								state.owned = false;
								state.ownedOrdinal = 0;
								state.ordinal = 0;
							},
							req: this.req,
							headers,
							manifestHeaders: (url) => this.manifestHeaders(url, routing.video),
							sources,
							requested: preferred,
							ordinal: options.x,
							ignoreTiming: !!options.noaudio || !!options.bypasssync,
							debug: this.debug || !!this.req.argv?.debug,
							acquire: async (source, signal) => {
								const response = await this.req.getData(this.playbackURL(routing.video, source.guid), {
									...headers,
									signal,
									onResponse: observePlayback,
									...(options.queueRecovery ? { quietErrors: true, deferErrorBody: true } : {})
								});
								if (!response.ok || !response.res) {
									if (await playbackCredentialsRejected(response.res)) {
										videoAuthRejected = true;
										playbackAuthError('Video', routing.video.endpoint, 'invalid');
										if (!options.noaudio && routing.video === routing.audio) playbackAuthError('Audio', routing.audio.endpoint, 'invalid');
										throw new Error('Playback session rejected');
									}
									if (options.queueRecovery && !response.error && response.res?.status === 429 && isPlaybackRefusal(429, await readLimitedManifest(response.res)))
										throw new PlaybackRefusal(response.res.headers);
									throw new Error(response.res?.status === 429 ? 'playback HTTP 429' : 'Playback request failed');
								}
								const stream = (await response.res.json()) as CrunchyPlayStream;
								return { token: stream.token, url: stream.url };
							},
							prepareDownload:
								routing.video.slot === 'legacy' && (options.vstream === 'android' || options.vstream === 'androidtab')
									? async (source, signal) => {
											const response = await this.req.getData(
												`https://cr-play-service.prd.crunchyrollsvc.com/v3/${source.guid}/${CrunchyVideoPlayStreams[options.vstream]}/download`,
												{ ...headers, signal, onResponse: observePlayback, ...(options.queueRecovery ? { quietErrors: true, deferErrorBody: true } : {}) }
											);
											const status = response.res?.status ?? response.error?.res?.status;
											if (!response.ok || !response.res) {
												if (!response.error && (status === 403 || status === 404)) return { status: 'unavailable' as const };
												if (
													options.queueRecovery &&
													!response.error &&
													status === 429 &&
													response.res &&
													isPlaybackRefusal(429, await readLimitedManifest(response.res))
												)
													throw new PlaybackRefusal(response.res.headers);
												throw new Error(status === 429 ? 'download HTTP 429' : 'download request outcome unknown');
											}
											const stream = (await response.res.json()) as CrunchyPlayStream;
											return { status: 'ok' as const, token: stream.token, url: stream.url };
										}
									: undefined,
							resolve: (_source, lease, downloadUrl) => this.convertDownloadToPlayback(downloadUrl, lease.url),
							close: async (source, token, signal) => {
								const response = await this.req.getData(this.playbackTokenURL(routing.video, source.guid, token), {
									...headers,
									signal,
									method: 'DELETE'
								});
								return response.ok && (response.res?.status === 200 || response.res?.status === 204);
							}
						});
					} finally {
						if (initial) {
							initial.release();
							state.initial = undefined;
						} else {
							indicator.stop();
							if (cli) {
								process.removeListener('SIGINT', onSignal);
								process.removeListener('SIGTERM', onSignal);
							}
						}
					}
					if (videoAuthRejected) return false;
					if (discovery.status === 'cancelled' || discovery.status === 'rate-limited') {
						console.error(discovery.status === 'cancelled' ? 'Video discovery cancelled' : `Video discovery stopped: ${discovery.reason}`);
						return false;
					}
					if (discovery.status === 'unsafe') {
						if (discovery.reason?.includes('playback HTTP 429') && !state.noticeShown) {
							this.playbackRateNotice(state.resetPerformed, state.permitClear || state.budget.used);
							state.noticeShown = true;
						}
						console.error(`Unable to safely complete video discovery${discovery.reason ? `: ${discovery.reason}` : ''}`);
						return false;
					}
					if (discovery.status === 'fallback') fallbackCause = discovery.reason;
					if (discovery.status === 'ok' && !discovery.entries.length)
						fallbackCause = discovery.timingFallbackReason ? (options.q === 0 ? discovery.timingFallbackReason : undefined) : 'metadata unavailable';
					if (discovery.status === 'ok' && discovery.entries.length) {
						const requestedIndex = options.q === 0 ? discovery.entries.length - 1 : options.q - 1;
						const validRequestedIndex = requestedIndex >= 0 && requestedIndex < discovery.entries.length ? requestedIndex : undefined;
						console.info(
							`Available Video Qualities:\n${formatGroupedVideoQualities(
								discovery.entries.map((entry) => ({ height: entry.height, text: formatVideoCandidate(entry), family: entry.family, bandwidth: entry.bandwidth })),
								validRequestedIndex,
								{ compact: !options.qall }
							)}`
						);
						if (options.q > discovery.entries.length) {
							console.error(`Requested quality ${options.q} is not available`);
							return false;
						}
						let selected = discovery.entries[options.q === 0 ? discovery.entries.length - 1 : options.q - 1];
						if (!selected) {
							console.error('Requested quality is not available');
							return false;
						}
						const requestedName = data.data[0]?.lang?.name || langsData.languages.find((lang) => lang.cr_locale === requested[0]?.audio_locale)?.name;
						const runVideo = async (choice: CatalogVideo, onSelectionConfirmed?: (entry: CatalogVideo) => void) => {
							const lang = langsData.languages.find((item) => item.cr_locale === choice.source.locale);
							const pass: GlobalVideoPass = {
								kind: 'video',
								selected: choice,
								references: discovery.references,
								ignoreTiming: !!options.noaudio || !!options.bypasssync,
								requestedName,
								onSelectionConfirmed
							};
							const videoData = { ...data, data: [{ ...data.data[0], lang }] };
							let videoResult: Awaited<ReturnType<Crunchy['downloadMediaList']>>;
							try {
								videoResult = await this.downloadMediaList(
									videoData,
									{ ...options, noaudio: true, skipsubs: true, nosubs: true, chapters: false },
									pass,
									undefined,
									routing
								);
							} catch (error) {
								console.error(`Video pass failed: ${String(error)}`);
							}
							return { videoResult, pass };
						};
						let video = await runVideo(
							selected,
							options.q === 0 && discovery.timingFallbackReason
								? (confirmed) => {
										const selectedIndex = discovery.entries.findIndex((entry) => entry.representationKey === confirmed.representationKey);
										if (selectedIndex >= 0) console.info(formatVideoQualityRow(selectedIndex + 1, formatVideoCandidate(confirmed), 'Re-selected'));
										console.info(`[Notice: falling back to ${confirmed.source.languageCode} video — ${discovery.timingFallbackReason}]`);
									}
								: undefined
						);
						if ((!video.videoResult || video.videoResult.error) && video.pass.selectionLost && !video.pass.cleanupFailed && !video.pass.noRetry && options.q === 0) {
							const fallback = discovery.entries.filter((entry) => preferred.includes(entry.source.guid) && entry.family === 'Current').slice(-1)[0];
							if (fallback) {
								const discarded = video.pass.selected;
								video = await runVideo(fallback, (confirmed) => {
									const discardedIndex = discovery.entries.findIndex((entry) => entry.representationKey === discarded.representationKey);
									const selectedIndex = discovery.entries.findIndex((entry) => entry.representationKey === confirmed.representationKey);
									if (discardedIndex >= 0)
										console.info(formatVideoQualityRow(discardedIndex + 1, formatVideoCandidate(discovery.entries[discardedIndex]), 'Discarded'));
									if (selectedIndex >= 0)
										console.info(formatVideoQualityRow(selectedIndex + 1, formatVideoCandidate(discovery.entries[selectedIndex]), 'Re-selected'));
									console.info(`[Notice: falling back to ${confirmed.source.languageCode} video — stream changed]`);
								});
							}
						}
						if (!video.videoResult || video.videoResult.error || (!options.dryRun && !video.videoResult.data.some((item) => item.type === 'Video'))) return false;
						selected = video.pass.selected;
						const forceWarning = !!options.bypasssync && !options.noaudio && !timingCompatible(selected, discovery.references).compatible;
						if (forceWarning) console.warn('Forced video timing differs or is unknown; audio and video may be out of sync.');
						const audioPass: GlobalVideoPass = {
							kind: 'audio',
							selected,
							references: discovery.references,
							ignoreTiming: !!options.noaudio || !!options.bypasssync,
							bypassSync: !!options.bypasssync,
							forceWarning,
							requestedName
						};
						let audio: Awaited<ReturnType<Crunchy['downloadMediaList']>>;
						const audioOptions = { ...options, novids: true };
						try {
							audio = await this.downloadMediaList(data, audioOptions, audioPass, undefined, routing);
						} catch (error) {
							console.error(`Audio pass failed: ${String(error)}`);
							return false;
						}
						if (!audio || audio.error || (!options.dryRun && !options.noaudio && !audio.data.some((item) => item.type === 'Audio'))) return false;
						muxOptions = { ...options, subdlfailed: audioOptions.subdlfailed };
						res = { ...video.videoResult, data: [...video.videoResult.data, ...audio.data] };
					}
				}
			}
			if (!res) {
				if (fallbackCause) console.info(`[Notice: falling back to ${fallbackLanguage} video — ${fallbackCause}]`);
				res = await this.downloadMediaList(data, options, undefined, fallbackCause, routing);
			}
			if (res === undefined || res.error) {
				return false;
			} else {
				if (options.dryRun) return true;
				if (!options.skipmux) {
					if (
						!(await this.muxStreams(res.data, {
							...muxOptions,
							allDubs,
							muxAudioLanguages: data.data.flatMap((item) => (item.lang ? [item.lang] : [])),
							output: res.fileName
						}))
					)
						return false;
				} else {
					console.info('Skipping mux');
				}
				if (!isSeries) {
					downloaded(
						{
							service: 'crunchy',
							type: 's'
						},
						data.seasonID,
						[data.e]
					);
				} else {
					downloaded(
						{
							service: 'crunchy',
							type: 'srz'
						},
						data.showID,
						[data.e]
					);
				}
			}
			return true;
		} finally {
			state.initial?.release();
			state.initial = undefined;
		}
	}

	public async getObjectById(e?: string, earlyReturn?: boolean, external_id?: boolean): Promise<ObjectInfo | Partial<CrunchyEpMeta>[] | undefined> {
		if (!this.cmsToken.cms) {
			console.error('Authentication required!');
			return [];
		}

		let convertedObjects;
		if (external_id) {
			const epFilter = parseSelect(e as string);
			const objectIds = [];
			for (const ob of epFilter.values) {
				const extIdReqOpts = [
					api.cms_bucket,
					this.cmsToken.cms.bucket,
					'/channels/crunchyroll/objects',
					'?',
					new URLSearchParams({
						force_locale: '',
						preferred_audio_language: 'ja-JP',
						locale: this.locale,
						external_id: ob,
						Policy: this.cmsToken.cms.policy,
						Signature: this.cmsToken.cms.signature,
						'Key-Pair-Id': this.cmsToken.cms.key_pair_id
					})
				].join('');

				const extIdReq = await this.req.getData(extIdReqOpts, {
					headers: {
						'User-Agent': api.crunchyDefUserAgent
					}
				});
				if (!extIdReq.ok || !extIdReq.res) {
					console.error('Objects Request FAILED!');
					if (extIdReq.error && extIdReq.error.res && extIdReq.error.res.body) {
						console.info('[INFO] Body:', extIdReq.error.res.body);
					}
					continue;
				}

				const oldObjectInfo = (await extIdReq.res.json()) as Record<any, any>;
				for (const object of oldObjectInfo.items) {
					objectIds.push(object.id);
				}
			}
			convertedObjects = objectIds.join(',');
		}

		const doEpsFilter = parseSelect(convertedObjects ?? (e as string));

		if (doEpsFilter.values.length < 1) {
			console.info('\nObjects not selected!\n');
			return [];
		}

		// node index.js --service crunchy -e G6497Z43Y,GRZXCMN1W,G62PEZ2E6,G25FVGDEK,GZ7UVPVX5
		console.info('Requested object ID: %s', doEpsFilter.values.join(', '));

		const AuthHeaders = {
			headers: {
				Authorization: `Bearer ${this.token.access_token}`,
				...api.crunchyDefHeader
			}
		};

		// reqs
		let objectInfo: ObjectInfo = { total: 0, data: [], meta: {} };

		// Music Videos handling
		if (doEpsFilter.values.filter((e) => e.startsWith('MV')).length > 0) {
			const toFetch = doEpsFilter.values.filter((e) => e.startsWith('MV'));
			const AuthHeaders = {
				headers: {
					Authorization: `Bearer ${this.token.access_token}`,
					...api.crunchyDefHeader
				}
			};

			const mvInfoReq = await this.req.getData(
				`${api.content_music}/music_videos/${toFetch.join(',')}?force_locale=&preferred_audio_language=ja-JP&locale=${this.locale}`,
				AuthHeaders
			);
			if (!mvInfoReq.ok || !mvInfoReq.res) {
				console.error('Music Video Request FAILED!');
				return [];
			}

			const mvInfo = (await mvInfoReq.res.json()) as { data: CrunchyMVObject[]; total: number };
			if (mvInfo.data.length === 0) return [];

			objectInfo = {
				total: objectInfo.total + mvInfo.total,
				data: [...objectInfo.data, ...mvInfo.data],
				meta: {}
			};

			doEpsFilter.values = doEpsFilter.values.filter((e) => !e.startsWith('MV'));
		}

		// Media ID handling
		if (doEpsFilter.values.length > 0) {
			const objectReqOpts = [
				api.cms_bucket,
				this.cmsToken.cms.bucket,
				'/objects/',
				doEpsFilter.values.join(','),
				'?',
				new URLSearchParams({
					force_locale: '',
					preferred_audio_language: 'ja-JP',
					locale: this.locale,
					Policy: this.cmsToken.cms.policy,
					Signature: this.cmsToken.cms.signature,
					'Key-Pair-Id': this.cmsToken.cms.key_pair_id
				})
			].join('');
			const objectReq = await this.req.getData(objectReqOpts, AuthHeaders);
			if (!objectReq.ok || !objectReq.res) {
				console.error('Objects Request FAILED!');
				if (objectReq.error && objectReq.error.res && objectReq.error.res.body) {
					const objectInfo = await objectReq.error.res.json();
					console.info('Body:', JSON.stringify(objectInfo, null, '\t'));
					objectInfo.error = true;
					return objectInfo;
				}
				return [];
			}
			const objectInfoAndroid = (await objectReq.res.json()) as CrunchyAndroidObject;

			objectInfo = {
				total: objectInfo.total + objectInfoAndroid.total,
				data: [...objectInfo.data, ...objectInfoAndroid.items],
				meta: {}
			};
		}

		if (earlyReturn) {
			return objectInfo;
		}

		const selectedMedia: Partial<CrunchyEpMeta>[] = [];
		// Non MV handling
		for (const item of objectInfo.data.filter((i) => i.type !== 'musicVideo') as AndroidObject[]) {
			if (item.type != 'episode' && item.type != 'movie') {
				await this.logObject(item, 2, true, false);
				continue;
			}
			const epMeta: Partial<CrunchyEpMeta> = {};

			epMeta.data = [];
			if (item.episode_metadata) {
				item.s_num = 'S:' + item.episode_metadata.season_id;
				epMeta.data = [
					{
						mediaId: 'E:' + item.id,
						versions: item.episode_metadata.versions,
						isSubbed: item.episode_metadata.is_subbed,
						isDubbed: item.episode_metadata.is_dubbed,
						durationMs: item.episode_metadata.duration_ms ?? 0
					}
				];
				epMeta.seriesTitle = item.episode_metadata.series_title;
				epMeta.seasonTitle = item.episode_metadata.season_title;
				epMeta.episodeNumber = item.episode_metadata.episode;
				epMeta.episodeTitle = item.title;
				epMeta.season = item.episode_metadata.season_number;
			} else if (item.movie_listing_metadata) {
				item.f_num = 'F:' + item.id;
				epMeta.data = [
					{
						mediaId: 'M:' + item.id,
						isSubbed: item.movie_listing_metadata.is_subbed,
						isDubbed: item.movie_listing_metadata.is_dubbed,
						durationMs: item.movie_listing_metadata.duration_ms ?? 0
					}
				];
				epMeta.seriesTitle = item.title;
				epMeta.seasonTitle = item.title;
				epMeta.episodeNumber = 'Movie';
				epMeta.episodeTitle = item.title;
			} else if (item.movie_metadata) {
				item.f_num = 'F:' + item.id;
				epMeta.data = [
					{
						mediaId: 'M:' + item.id,
						isSubbed: item.movie_metadata.is_subbed,
						isDubbed: item.movie_metadata.is_dubbed,
						durationMs: item.movie_metadata.duration_ms ?? 0
					}
				];
				epMeta.season = 0;
				epMeta.seriesTitle = item.title;
				epMeta.seasonTitle = item.title;
				epMeta.episodeNumber = 'Movie';
				epMeta.episodeTitle = item.title;
			}
			if (item.streams_link) {
				epMeta.data[0].playback = item.streams_link;
				if (!item.playback) {
					item.playback = item.streams_link;
				}
				selectedMedia.push(epMeta);
				item.isSelected = true;
			} else if (item.__links__) {
				epMeta.data[0].playback = item.__links__.streams.href;
				if (!item.playback) {
					item.playback = item.__links__.streams.href;
				}
				selectedMedia.push(epMeta);
				item.isSelected = true;
			}
			await this.logObject(item, 2);
		}

		// MV handling
		for (const item of objectInfo.data.filter((i) => i.type === 'musicVideo') as CrunchyMVObject[]) {
			const epMeta: Partial<CrunchyEpMeta> = {};

			epMeta.data = [
				{
					mediaId: 'V:' + item.id,
					isSubbed: false,
					isDubbed: false,
					durationMs: item.durationMs ?? 0
				}
			];
			epMeta.season = 0;
			epMeta.seriesTitle = item.title;
			epMeta.seasonTitle = item.title;
			epMeta.episodeNumber = 'MV';
			epMeta.episodeTitle = item.title;

			if (item.streams_link) {
				epMeta.data[0].playback = item.streams_link;
				if (!item.playback) {
					item.playback = item.streams_link;
				}
				selectedMedia.push(epMeta);
				item.isSelected = true;
			}

			await this.logObject(item, 2);
		}
		console.info('');
		return selectedMedia;
	}

	private convertDownloadToPlayback(audioUrl: string, videoUrl: string): string {
		try {
			const url = new URL(audioUrl);
			const urla = new URL(videoUrl);
			url.pathname = url.pathname.replace('/manifest/download/', '/manifest/');
			url.searchParams.delete('downloadGuid');
			url.searchParams.set('playbackGuid', urla.searchParams.get('playbackGuid') as string);

			return url.toString();
		} catch (err) {
			return audioUrl;
		}
	}

	public async downloadMediaList(
		medias: CrunchyEpMeta,
		options: CrunchyDownloadOptions,
		globalPass?: GlobalVideoPass,
		selectionFallbackReason?: string,
		resolvedRouting?: PlaybackRouting
	): Promise<
		| {
				data: DownloadedMedia[];
				fileName: string;
				error: boolean;
		  }
		| undefined
	> {
		const state: PlaybackRecoveryState = options.recoveryState ?? {
			budget: options.queueRecovery ?? this.commandRecovery ?? { used: false },
			permitClear: !!options.tsd,
			preflightChecked: false,
			resetPerformed: false,
			noticeShown: false,
			ordinal: 0
		};
		const recoveryBudget = state.budget;
		if (!this.cmsToken.cms) {
			console.error('Authentication required!');
			return;
		}
		const routing = resolvedRouting ?? (await this.resolvePlaybackRouting(options));
		if (!routing) return;

		if (!options.dryRun && !this.cfg.bin.ffmpeg) this.cfg.bin = await yamlCfg.loadBinCfg();

		let mediaName = '...';
		let fileName;
		const variables: Variable[] = globalPass
			? [
					{ name: 'height', type: 'number', replaceWith: globalPass.selected.height },
					{ name: 'width', type: 'number', replaceWith: globalPass.selected.width }
				]
			: [];
		if (medias.seasonTitle && medias.episodeNumber && medias.episodeTitle) {
			mediaName = `${medias.seasonTitle} - ${medias.episodeNumber} - ${medias.episodeTitle}`;
		}

		const files: DownloadedMedia[] = [];

		if (medias.data.every((a) => !a.playback)) {
			console.warn('Video not available!');
			return undefined;
		}

		let dlFailed = false;
		let queueCleanupFailed = false;
		let dlVideoOnce = false; // Variable to save if best selected video quality was downloaded

		for (const mMeta of medias.data) {
			if (queueCleanupFailed) return undefined;
			if (globalPass && (globalPass.cleanupFailed || globalPass.noRetry)) return undefined;
			console.info(`Requesting: [${mMeta.mediaId}] ${mediaName}`);

			// Make sure we have a media id without a : in it
			const currentMediaId = mMeta.mediaId.includes(':') ? mMeta.mediaId.split(':')[1] : mMeta.mediaId;

			//Make sure token is up-to-date
			if (!(await this.refreshToken(true, true))) return undefined;
			const videoAuth = globalPass?.kind === 'audio' && routing.audio.slot !== 'legacy' ? routing.audio : routing.video;
			const audioAuth = routing.audio;
			let currentVersion: EpisodeVersion | undefined;
			let isPrimary = mMeta.isSubbed;
			const AuthHeaders = this.playbackHeaders(videoAuth);
			const playbackBinding = accountBinding(videoAuth.session.account_id);
			const observePlayback = (response: Response) =>
				observePlaybackWait(yamlCfg.workingDir ? path.join(yamlCfg.workingDir, 'config') : (this.cfg.dir.config ?? ''), playbackBinding, response);

			//Get Media GUID
			if (mMeta.versions) {
				if (globalPass?.kind === 'video') {
					currentVersion = mMeta.versions.find((version) => version.guid === globalPass.selected.source.guid);
				} else {
					currentVersion = this.resolveSelectedVersion(mMeta, options);
				}
				if (!currentVersion?.media_guid) {
					console.error('Selected language not found in versions.');
					continue;
				}
				isPrimary = currentVersion.original;
			}

			const compiledChapters: string[] = [];
			if (options.chapters) {
				//Make Chapter Request
				const chapterRequest = await this.req.getData(`https://static.crunchyroll.com/skip-events/production/${currentMediaId}.json`, {
					headers: api.crunchyDefHeader
				});
				if (!chapterRequest.ok || !chapterRequest.res) {
					//Old Chapter Request Fallback
					console.warn('Chapter request failed, attempting old API');
					const oldChapterRequest = await this.req.getData(`https://static.crunchyroll.com/datalab-intro-v2/${currentMediaId}.json`, {
						headers: api.crunchyDefHeader
					});
					if (!oldChapterRequest.ok || !oldChapterRequest.res) {
						console.warn('Old Chapter API request failed');
					} else {
						console.info('Old Chapter request successful');
						const chapterData = (await oldChapterRequest.res.json()) as CrunchyOldChapter;

						//Generate Timestamps
						const startTime = new Date(0),
							endTime = new Date(0);
						startTime.setSeconds(chapterData.startTime);
						endTime.setSeconds(chapterData.endTime);
						const startTimeMS = String(chapterData.startTime).split('.')[1],
							endTimeMS = String(chapterData.endTime).split('.')[1];
						const startMS = startTimeMS ? startTimeMS : '00',
							endMS = endTimeMS ? endTimeMS : '00';
						const startFormatted = startTime.toISOString().substring(11, 19) + '.' + startMS;
						const endFormatted = endTime.toISOString().substring(11, 19) + '.' + endMS;

						//Push Generated Chapters
						if (chapterData.startTime > 1) {
							compiledChapters.push(`CHAPTER${compiledChapters.length / 2 + 1}=00:00:00.00`, `CHAPTER${compiledChapters.length / 2 + 1}NAME=Prologue`);
						}
						compiledChapters.push(`CHAPTER${compiledChapters.length / 2 + 1}=${startFormatted}`, `CHAPTER${compiledChapters.length / 2 + 1}NAME=Intro`);
						compiledChapters.push(`CHAPTER${compiledChapters.length / 2 + 1}=${endFormatted}`, `CHAPTER${compiledChapters.length / 2 + 1}NAME=Episode`);
					}
				} else {
					//Chapter request succeeded, now let's parse them
					console.info('Chapter request successful');
					const chapterData = (await chapterRequest.res.json()) as CrunchyChapters;
					const chapters: CrunchyChapter[] = [];

					//Make a format more usable for the crunchy chapters
					for (const chapter in chapterData) {
						if (chapterData[chapter] && typeof chapterData[chapter] == 'object') {
							chapters.push(chapterData[chapter]);
						}
					}

					if (chapters.length > 0) {
						chapters.sort((a, b) => a.start - b.start);
						//Check if chapters has an intro
						//if (!(chapters.find(c => c.type === 'intro') || chapters.find(c => c.type === 'recap'))) {
						if (!chapters.find((c) => c.type === 'intro')) {
							compiledChapters.push(`CHAPTER${compiledChapters.length / 2 + 1}=00:00:00.00`, `CHAPTER${compiledChapters.length / 2 + 1}NAME=Episode`);
						}

						//Loop through all the chapters
						for (const chapter of chapters) {
							if (typeof chapter.start == 'undefined' || typeof chapter.end == 'undefined') continue;
							//Generate timestamps
							const startTime = new Date(0),
								endTime = new Date(0);
							startTime.setSeconds(chapter.start);
							endTime.setSeconds(chapter.end);
							const startFormatted = startTime.toISOString().substring(11, 19) + '.00';
							const endFormatted = endTime.toISOString().substring(11, 19) + '.00';
							//Find the max start time from the chapters
							const maxStart = Math.max(...chapters.map((obj) => obj.start).filter((start): start is number => start !== null && start !== undefined));
							//We need the duration of the ep
							let epDuration: number | undefined;
							const epiMeta = await this.req.getData(
								`${api.content_cms}/objects/${currentMediaId}?force_locale=&preferred_audio_language=ja-JP&locale=${this.locale}`,
								AuthHeaders
							);
							if (!epiMeta.ok || !epiMeta.res) {
								epDuration = 7200;
							} else {
								epDuration = Math.floor((await epiMeta.res.json()).data[0].episode_metadata.duration_ms / 1000 - 3);
							}

							//Push generated chapters
							if (chapter.type == 'intro') {
								if (chapter.start > 0) {
									compiledChapters.push(`CHAPTER${compiledChapters.length / 2 + 1}=00:00:00.00`, `CHAPTER${compiledChapters.length / 2 + 1}NAME=Episode`);
								}
								compiledChapters.push(
									`CHAPTER${compiledChapters.length / 2 + 1}=${startFormatted}`,
									`CHAPTER${compiledChapters.length / 2 + 1}NAME=${chapter.type.charAt(0).toUpperCase() + chapter.type.slice(1)}`
								);
								if (chapter.end < epDuration && chapter.end != maxStart) {
									compiledChapters.push(`CHAPTER${compiledChapters.length / 2 + 1}=${endFormatted}`, `CHAPTER${compiledChapters.length / 2 + 1}NAME=Episode`);
								}
							} else {
								if (chapter.type !== 'recap') {
									compiledChapters.push(
										`CHAPTER${compiledChapters.length / 2 + 1}=${startFormatted}`,
										`CHAPTER${compiledChapters.length / 2 + 1}NAME=${chapter.type.charAt(0).toUpperCase() + chapter.type.slice(1)}`
									);
									if (chapter.end < epDuration && chapter.end != maxStart) {
										compiledChapters.push(`CHAPTER${compiledChapters.length / 2 + 1}=${endFormatted}`, `CHAPTER${compiledChapters.length / 2 + 1}NAME=Episode`);
									}
								}
							}
						}
					}
				}
			}

			const pbData = { total: 0, vpb: {}, apb: {}, meta: {} } as PlaybackData;

			let videoStream: CrunchyPlayStream | null = null;
			let audioStream: CrunchyPlayStream | null = null;
			let isDLVideoBypass = videoAuth.slot === 'legacy' && (options.vstream === 'android' || options.vstream === 'androidtab');
			let isDLAudioBypass = audioAuth.slot === 'legacy' && (options.astream === 'android' || options.astream === 'androidtab');
			let isDLBypassCapable: boolean = true;
			let previewVideoToken: string | undefined;
			let previewAudioToken: string | undefined;
			let previewDownloadToken: string | undefined;
			let terminalPlayback429 = false;
			const attemptedCloses = new Map<string, boolean>();
			const initial = state.initial;
			const acquisitionController = initial?.controller ?? new AbortController();
			let replay = 0;
			let acquisitionIndicator: WorkingIndicator | undefined;
			let acquisitionScheduler: DiscoveryScheduler | undefined;
			const releaseKey = (token: string, auth: PlaybackAuth) =>
				JSON.stringify([auth.origin, auth.slot, auth.session.device_id, currentVersion?.guid ?? currentMediaId, token]);
			const closeGlobalToken = async (token: string, auth = videoAuth): Promise<boolean> => {
				const key = releaseKey(token, auth);
				if (attemptedCloses.has(key)) return attemptedCloses.get(key)!;
				attemptedCloses.set(key, false);
				if (!(await this.refreshPlaybackOwner(auth))) return false;
				if (recoveryBudget) await acquisitionScheduler!.dispatch(true);
				const url = this.playbackTokenURL(auth, currentVersion?.guid ?? currentMediaId, token);
				const result = await boundedRequest((signal) => this.req.getData(url, { ...this.playbackHeaders(auth), signal, method: 'DELETE' }));
				const closed = result.ok && (result.res?.status === 200 || result.res?.status === 204);
				attemptedCloses.set(key, closed);
				return closed;
			};

			const releaseGlobalSessions = async (): Promise<boolean> => {
				let allClosed = true;
				const leases = [
					[previewVideoToken, videoAuth],
					[previewAudioToken, audioAuth],
					[previewDownloadToken, videoAuth]
				] as const;
				for (const [token, auth] of leases) {
					if (!token) continue;
					try {
						if (await closeGlobalToken(token, auth)) continue;
					} catch {
						/* The attempted close is terminal. */
					}
					console.warn('Failed to close playback session');
					if (globalPass) globalPass.cleanupFailed = true;
					allClosed = false;
				}
				return allClosed;
			};

			// prettier-ignore
			try {
			if (isDLVideoBypass || isDLAudioBypass) {
				const me = await this.req.getData(api.me, AuthHeaders);
				if (me.ok && me.res) {
					const data_me = await me.res.json();
					const benefits = await this.req.getData(`https://beta-api.crunchyroll.com/subs/v1/subscriptions/${data_me.external_id}/benefits`, AuthHeaders);
					if (benefits.ok && benefits.res) {
						const data_benefits = (await benefits.res.json()) as { items: { benefit: string }[] };
						const limit = concurrentStreamLimit(data_benefits);
						if (!me.error && !benefits.error && typeof data_me?.external_id === 'string' && data_me.external_id.trim() && limit !== undefined) {
							state.capacityCache = { binding: String((AuthHeaders.headers as Record<string, string>)?.Authorization ?? ''), limit };
						}
						if (data_benefits?.items && !data_benefits.items.find((i) => i.benefit === 'offline_viewing')) {
							isDLBypassCapable = false;
						}
					} else {
						isDLBypassCapable = false;
					}
				} else {
					isDLBypassCapable = false;
				}
			}

			if (isDLVideoBypass && !isDLBypassCapable) {
				isDLVideoBypass = false;
				options.vstream = 'androidtv';
				console.warn(
					'VBR video downloads are not available on your current Crunchyroll plan. Please upgrade to the "Mega Fan" plan to enable this feature. Falling back to CBR video stream.'
				);
			}

			if (isDLAudioBypass && !isDLBypassCapable) {
				isDLAudioBypass = false;
				options.astream = 'androidtv';
				console.warn(
					'192 kb/s audio downloads are not available on your current Crunchyroll plan. Please upgrade to the "Mega Fan" plan to enable this feature. Falling back to 128 kb/s CBR stream.'
				);
			}

			// Disable CBR bypass for Music Videos since it does not work
			if ((currentVersion ? currentVersion.guid : currentMediaId).startsWith('MV')) {
				isDLVideoBypass = false;
				isDLAudioBypass = false;
				options.vstream = 'androidtv';
				options.astream = 'androidtv';
			}

			acquisitionIndicator = initial?.indicator ?? new WorkingIndicator(process.env.isGUI !== 'true' && !this.debug && !this.req.argv?.debug && !!process.stdout.isTTY && !!process.env.TERM && process.env.TERM !== 'dumb');
			acquisitionScheduler = initial?.scheduler ?? new DiscoveryScheduler(7, undefined, acquisitionController.signal, (retry, ms, kind) => acquisitionIndicator!.waiting(retry, ms, kind, state.owned ? state.ordinal : replay + 1, state.owned || state.resetPerformed ? 2 : 3), 0);
			if (state.permitClear && !state.preflightChecked) {
				acquisitionIndicator.start();
				state.preflightChecked = true;
				const onPreflightSignal = () => acquisitionController.abort();
				const preflightCli = process.env.isGUI !== 'true';
				if (!initial && preflightCli) { process.on('SIGINT', onPreflightSignal); process.on('SIGTERM', onPreflightSignal); }
				let ready: boolean;
				try { ready = await this.resolvePlaybackCapacity(AuthHeaders, acquisitionScheduler, acquisitionController.signal, state, acquisitionIndicator); }
				finally { if (!initial && preflightCli) { process.removeListener('SIGINT', onPreflightSignal); process.removeListener('SIGTERM', onPreflightSignal); } }
				if (!ready) { if (initial) { initial.release(); state.initial = undefined; } else acquisitionIndicator.stop(); return undefined; }
			}
			const fetchPlayback = async (url: string, auth = videoAuth): Promise<{ ok: boolean; status?: number; authRejected?: boolean; transportError?: boolean; res?: { json: () => Promise<any> } }> => {
				const headers = this.playbackHeaders(auth);
				if (!globalPass && !recoveryBudget) {
					const response = await this.req.getData(url, { ...headers, onResponse: observePlayback });
					return { ...response, status: response.res?.status ?? response.error?.res?.status, authRejected: !response.ok && await playbackCredentialsRejected(response.res) };
				}
				try {
					if (recoveryBudget) await acquisitionScheduler!.dispatch();
					return await boundedRequest(async (signal) => {
						const response = await this.req.getData(url, { ...headers, signal, onResponse: observePlayback, ...(recoveryBudget ? { quietErrors: true, deferErrorBody: true } : {}) });
						if (!response.ok || !response.res) {
							if (recoveryBudget && !response.error && response.res?.status === 429 && isPlaybackRefusal(429, await readLimitedManifest(response.res))) throw new PlaybackRefusal(response.res.headers);
							return {
								ok: false, status: response.res?.status ?? response.error?.res?.status, transportError: !!response.error,
								authRejected: await playbackCredentialsRejected(response.res)
							};
						}
						const body = await response.res.json();
						return { ok: true, res: { json: async () => body }, token: (body as CrunchyPlayStream)?.token };
					}, async (late) => {
						if ('token' in late && late.token && !(await closeGlobalToken(late.token, auth))) console.warn('Failed to close a late playback session');
					}, recoveryBudget ? acquisitionController.signal : undefined, recoveryBudget ? acquisitionScheduler!.remaining() : undefined);
				} catch (error) {
					if (error instanceof PlaybackRefusal) throw error;
					if (globalPass) globalPass.cleanupFailed = true;
					dlFailed = true;
					console.warn('Playback request ended before its session could be verified');
					if (this.debug || this.req.argv?.debug) console.debug(`[DEBUG] Playback request failed: ${String(error)}`);
					return { ok: false };
				}
			};
			const onAcquisitionSignal = () => acquisitionController.abort();
			const acquisitionCli = process.env.isGUI !== 'true';
			if (!initial && acquisitionCli) { process.on('SIGINT', onAcquisitionSignal); process.on('SIGTERM', onAcquisitionSignal); }
			try {
			for (;;) {
			try {
			const videoPlaybackReq = await fetchPlayback(
				this.playbackURL(videoAuth, currentVersion?.guid ?? currentMediaId)
			);
			if (!videoPlaybackReq.ok || !videoPlaybackReq.res) {
				if (videoPlaybackReq.authRejected) {
					const role = options.novids ? (options.noaudio ? 'Subtitle metadata' : 'Audio') : 'Video';
					playbackAuthError(role, videoAuth.endpoint, 'invalid');
					if (role === 'Video' && !options.noaudio && videoAuth === audioAuth) playbackAuthError('Audio', audioAuth.endpoint, 'invalid');
					if (globalPass) globalPass.noRetry = true;
					return undefined;
				}
				console.warn('Request Video Stream URLs FAILED!');
				const status = videoPlaybackReq.status;
				if (status === 429) { terminalPlayback429 = true; if (!state.noticeShown) { this.playbackRateNotice(state.resetPerformed, state.permitClear || state.budget.used); state.noticeShown = true; } return undefined; }
				if (globalPass || recoveryBudget) { if (globalPass) globalPass.noRetry = true; return undefined; }
			} else {
				videoStream = (await videoPlaybackReq.res.json()) as CrunchyPlayStream;
				previewVideoToken = videoStream.token;
				if ((globalPass || recoveryBudget) && (!videoStream.token || !videoStream.url)) { if (globalPass) globalPass.cleanupFailed = true; return undefined; }
				const derivedPlaystreams = {} as CrunchyStreams;
				for (const hardsub in videoStream.hardSubs) {
					const stream = videoStream.hardSubs[hardsub];
					derivedPlaystreams[hardsub] = {
						url: stream.url,
						hardsub_locale: stream.hlang
					};
				}
				if (isDLVideoBypass && (!globalPass || globalPass.kind === 'video' || options.cstream || options.vstream === options.astream)) {
					const videoDLReq = await fetchPlayback(
						`https://cr-play-service.prd.crunchyrollsvc.com/v3/${currentVersion ? currentVersion.guid : currentMediaId}/${CrunchyVideoPlayStreams[options.vstream]}/download`
					);
					if (videoDLReq.ok && videoDLReq.res) {
						const data = (await videoDLReq.res.json()) as CrunchyPlayStream;
						previewDownloadToken = data.token;
						if (globalPass || recoveryBudget) {
							if (!previewDownloadToken) { if (globalPass) globalPass.cleanupFailed = true; return undefined; }
							if (previewDownloadToken !== videoStream.token) {
								if (!(await closeGlobalToken(previewDownloadToken))) { if (globalPass) globalPass.cleanupFailed = true; return undefined; }
								previewDownloadToken = undefined;
							}
							if (!data.url || !/^https?:\/\//i.test(data.url)) return undefined;
						}
						derivedPlaystreams[''] = {
							url: this.convertDownloadToPlayback(data.url, videoStream.url),
							hardsub_locale: ''
						};
					} else {
						if (videoDLReq.status === 429) { terminalPlayback429 = true; if (!state.noticeShown) { this.playbackRateNotice(state.resetPerformed, state.permitClear || state.budget.used); state.noticeShown = true; } return undefined; }
						if ((globalPass || recoveryBudget) && (!('status' in videoDLReq) || (videoDLReq.status !== 403 && videoDLReq.status !== 404) || videoDLReq.transportError)) { if (globalPass) globalPass.cleanupFailed = true; return undefined; }
						derivedPlaystreams[''] = {
							url: videoStream.url,
							hardsub_locale: ''
						};
					}
				} else {
					derivedPlaystreams[''] = {
						url: videoStream.url,
						hardsub_locale: ''
					};
				}
				pbData.meta = {
					audio_locale: videoStream.audioLocale,
					bifs: [videoStream.bifs],
					captions: videoStream.captions,
					closed_captions: videoStream.captions,
					media_id: videoStream.assetId,
					subtitles: videoStream.subtitles,
					versions: videoStream.versions
				};
				pbData.vpb[`adaptive_${options.vstream}_${videoStream.url.includes('m3u8') ? 'hls' : 'dash'}_drm`] = {
					...derivedPlaystreams
				};
			}

			if (globalPass?.kind !== 'video' && !options.noaudio && audioAuth !== videoAuth && videoStream) {
				const audioPlaybackReq = await fetchPlayback(
					isDLAudioBypass
						? `${domain.cr_playback}/v3/${currentVersion?.guid ?? currentMediaId}/${CrunchyAudioPlayStreams[audioAuth.endpoint]}/download`
						: this.playbackURL(audioAuth, currentVersion?.guid ?? currentMediaId, true),
					audioAuth
				);
				if (!audioPlaybackReq.ok || !audioPlaybackReq.res) {
					if (audioPlaybackReq.authRejected) {
						playbackAuthError('Audio', audioAuth.endpoint, 'invalid');
						if (globalPass) globalPass.noRetry = true;
						return undefined;
					}
					console.warn('Request Audio Stream URLs FAILED!');
					const status = audioPlaybackReq.status;
					if (status === 429) { terminalPlayback429 = true; if (!state.noticeShown) { this.playbackRateNotice(state.resetPerformed, state.permitClear || state.budget.used); state.noticeShown = true; } return undefined; }
					if (globalPass || recoveryBudget) {
						if (isDLAudioBypass && !audioPlaybackReq.transportError && 'status' in audioPlaybackReq && (audioPlaybackReq.status === 403 || audioPlaybackReq.status === 404)) pbData.apb = pbData.vpb;
						else { if (globalPass) globalPass.noRetry = true; return undefined; }
					}
				} else {
					audioStream = (await audioPlaybackReq.res.json()) as CrunchyPlayStream;
					previewAudioToken = audioStream.token;
					if ((globalPass || recoveryBudget) && (!audioStream.token || !audioStream.url)) { if (globalPass) globalPass.cleanupFailed = true; return undefined; }
					const derivedPlaystreams = {} as CrunchyStreams;
					// Give Audiostream the Videostream hardsubs if undefined or empty array
					if (!audioStream.hardSubs || Object.values(audioStream.hardSubs).length === 0) audioStream.hardSubs = videoStream.hardSubs;
					for (const hardsub in audioStream.hardSubs) {
						const stream = audioStream.hardSubs[hardsub];
						derivedPlaystreams[hardsub] = {
							url: stream.url,
							hardsub_locale: stream.hlang
						};
					}
					if (isDLAudioBypass) {
						if ((globalPass || recoveryBudget) && previewAudioToken && previewAudioToken !== videoStream.token) {
							if (!(await closeGlobalToken(previewAudioToken, audioAuth))) { if (globalPass) globalPass.cleanupFailed = true; return undefined; }
							previewAudioToken = undefined;
						}
						audioStream.token = videoStream.token;
						derivedPlaystreams[''] = {
							url: this.convertDownloadToPlayback(audioStream.url, videoStream.url),
							hardsub_locale: ''
						};
					} else {
						derivedPlaystreams[''] = {
							url: audioStream.url,
							hardsub_locale: ''
						};
					}
					pbData.meta = {
						audio_locale: audioStream.audioLocale,
						bifs: [audioStream.bifs],
						captions: audioStream.captions,
						closed_captions: audioStream.captions,
						media_id: audioStream.assetId,
						subtitles: audioStream.subtitles,
						versions: audioStream.versions
					};
					pbData.apb[`adaptive_${options.astream}_${audioStream.url.includes('m3u8') ? 'hls' : 'dash'}_drm`] = {
						...derivedPlaystreams
					};
				}
			} else {
				pbData.apb = pbData.vpb;
			}

				state.owned = false; state.ownedOrdinal = 0; state.ordinal = 0;
				break;
			} catch (error) {
				if (!(error instanceof PlaybackRefusal)) { if (this.debug) console.debug(`[DEBUG] Playback acquisition failed: ${String(error)}`); return undefined; }
				if (replay >= (state.resetPerformed ? 2 : 3)) { terminalPlayback429 = true; if (!state.noticeShown) { this.playbackRateNotice(state.resetPerformed, state.permitClear || state.budget.used); state.noticeShown = true; } return undefined; }
				if (!state.noticeShown) { this.playbackRateNotice(state.resetPerformed, state.permitClear || state.budget.used); state.noticeShown = true; }
				const refusedAt = acquisitionScheduler!.clock.now();
				const refusedWall = acquisitionScheduler!.clock.wallNow();
				try { acquisitionScheduler!.reservePlaybackRetry(); } catch { terminalPlayback429 = true; return undefined; }
				if (!(await releaseGlobalSessions())) { terminalPlayback429 = true; return undefined; }
				previewVideoToken = undefined; previewAudioToken = undefined; previewDownloadToken = undefined;
				videoStream = null; audioStream = null; pbData.total = 0; pbData.vpb = {}; pbData.apb = {}; pbData.meta = {} as PlaybackData['meta'];
				attemptedCloses.clear();
				acquisitionIndicator!.start();
				state.ordinal = replay + 1;
				if (!(await this.resolvePlaybackCapacity(AuthHeaders, acquisitionScheduler!, acquisitionController.signal, state, acquisitionIndicator!, { headers: error.headers, ordinal: replay + 1, at: refusedAt, wall: refusedWall }, replay < 2))) return undefined;
				replay++;
			}
			}
			} finally {
				if (initial) { initial.release(); state.initial = undefined; }
				else { acquisitionIndicator!.stop(); if (acquisitionCli) { process.removeListener('SIGINT', onAcquisitionSignal); process.removeListener('SIGTERM', onAcquisitionSignal); } }
			}

			variables.push(
				...(
					[
						['title', medias.episodeTitle, true],
						['episode', isNaN(parseFloat(medias.episodeNumber)) ? medias.episodeNumber : parseFloat(medias.episodeNumber), false],
						['service', 'CR', false],
						['seriesTitle', medias.seriesTitle, true],
						['showTitle', medias.seriesTitle ?? medias.seasonTitle, true],
						['season', medias.season, false]
					] as [AvailableFilenameVars, string | number, boolean][]
				).map((a): Variable => {
					return {
						name: a[0],
						replaceWith: a[1],
						type: typeof a[1],
						sanitize: a[2]
					} as Variable;
				})
			);

			let vstreams: any[] = [];
			let astreams: any[] = [];
			let hsLangs: string[] = [];
			const vpbStreams = pbData.vpb;
			const apbStreams = pbData.apb;

			if (!options.dryRun && !canDecrypt && (!options.novids || !options.noaudio)) {
				console.error('No valid Widevine or PlayReady CDM detected. Please ensure a supported and functional CDM is installed.');
				return undefined;
			}

			if (!options.dryRun && !this.cfg.bin.mp4decrypt && !this.cfg.bin.shaka && (!options.novids || !options.noaudio)) {
				console.error('Neither Shaka nor MP4Decrypt found. Please ensure at least one of them is installed.');
				return undefined;
			}

			for (const s of Object.keys(pbData.vpb)) {
				if ((s.match(/hls/) || s.match(/dash/)) && !(s.match(/hls/) && s.match(/drm/) && !options.dryRun) && !s.match(/trailer/)) {
					const pb = Object.values(vpbStreams[s]).map((v) => {
						v.hardsub_lang = v.hardsub_locale ? langsData.fixAndFindCrLC(v.hardsub_locale).locale : v.hardsub_locale;
						if (v.hardsub_lang && hsLangs.indexOf(v.hardsub_lang) < 0) {
							hsLangs.push(v.hardsub_lang);
						}
						return {
							...v,
							...{ format: s }
						};
					});
					vstreams.push(...pb);
				}
			}

			for (const s of Object.keys(pbData.apb)) {
				if ((s.match(/hls/) || s.match(/dash/)) && !(s.match(/hls/) && s.match(/drm/) && !options.dryRun) && !s.match(/trailer/)) {
					const pb = Object.values(apbStreams[s]).map((v) => {
						v.hardsub_lang = v.hardsub_locale ? langsData.fixAndFindCrLC(v.hardsub_locale).locale : v.hardsub_locale;
						if (v.hardsub_lang && hsLangs.indexOf(v.hardsub_lang) < 0) {
							hsLangs.push(v.hardsub_lang);
						}
						return {
							...v,
							...{ format: s }
						};
					});
					astreams.push(...pb);
				}
			}

			if (vstreams.length < 1) {
				console.warn('No full video streams found!');
				return undefined;
			}

			if (astreams.length < 1) {
				console.warn('No full audio streams found!');
				return undefined;
			}

			const audDub = langsData.findLang(langsData.fixLanguageTag(pbData.meta.audio_locale as string) || '').code;
			hsLangs = langsData.sortTags(hsLangs);

			vstreams = vstreams.map((s) => {
				s.audio_lang = audDub;
				s.hardsub_lang = s.hardsub_lang ? s.hardsub_lang : '-';
				s.type = `${s.format}/${s.audio_lang}/${s.hardsub_lang}`;
				return s;
			});

			vstreams = vstreams.sort((a, b) => {
				if (a.type < b.type) {
					return -1;
				}
				return 0;
			});

			astreams = astreams.map((s) => {
				s.audio_lang = audDub;
				s.hardsub_lang = s.hardsub_lang ? s.hardsub_lang : '-';
				s.type = `${s.format}/${s.audio_lang}/${s.hardsub_lang}`;
				return s;
			});

			astreams = astreams.sort((a, b) => {
				if (a.type < b.type) {
					return -1;
				}
				return 0;
			});

			if (options.hslang != 'none') {
				if (hsLangs.indexOf(options.hslang) > -1) {
					console.info('Selecting stream with %s hardsubs', langsData.locale2language(options.hslang).language);
					vstreams = vstreams.filter((s) => {
						if (s.hardsub_lang == '-') {
							return false;
						}
						return s.hardsub_lang == options.hslang;
					});
					astreams = astreams.filter((s) => {
						if (s.hardsub_lang == '-') {
							return false;
						}
						return s.hardsub_lang == options.hslang;
					});
					if (astreams.length < 1) {
						console.warn('No audio streams found, using video audio streams instead');
						astreams = vstreams;
					}
					if (vstreams.length < 1) {
						console.error('Raw video streams not available!');
						dlFailed = true;
					}
				} else {
					console.warn('Selected stream with %s hardsubs not available', langsData.locale2language(options.hslang).language);
					if (hsLangs.length > 0) {
						console.warn('Try other hardsubs stream:', hsLangs.join(', '));
					}
					dlFailed = true;
				}
			} else {
				vstreams = vstreams.filter((s) => {
					return s.hardsub_lang == '-';
				});
				astreams = astreams.filter((s) => {
					return s.hardsub_lang == '-';
				});
				if (astreams.length < 1) {
					console.warn('No audio streams found, using video audio streams instead');
					astreams = vstreams;
				}
				if (vstreams.length < 1) {
					console.error('Raw video streams not available!');
					if (hsLangs.length > 0) {
						console.warn('Try hardsubs stream:', hsLangs.join(', '));
					}
					dlFailed = true;
				}
				console.info('Selecting raw stream');
			}

			let vcurStream: undefined | (typeof vstreams)[0] = undefined;
			let acurStream: undefined | (typeof astreams)[0] = undefined;

			if (!dlFailed) {
				console.info('Downloading...');
				vcurStream = vstreams[0];
				acurStream = astreams[0];

				console.info('Video Playlists URL: %s (%s)', vcurStream.url, vcurStream.type);
				console.info('Audio Playlists URL: %s (%s)', acurStream.url, acurStream.type);
			}

			let tsFile = undefined;

			if (options.novids && options.noaudio && !options.dryRun && !globalPass && !(await releaseGlobalSessions())) return undefined;

			if (!dlFailed && vcurStream && acurStream && vcurStream !== undefined && acurStream !== undefined && !(options.novids && options.noaudio)) {
				let videoUrl = vcurStream.url as string;
				if (globalPass?.kind === 'video' && globalPass.selected.family !== 'Current') {
					const wanted = globalPass.selected.family === 'Legacy 0' ? 0 : 1;
					const legacy = legacyUrls(videoUrl).find((candidate) => new RegExp(`/${wanted}/clean/dash/`).test(candidate.split(/[?#]/, 1)[0]));
					if (!legacy) { globalPass.selectionLost = true; return undefined; }
					videoUrl = legacy;
				}
				const fetchManifest = async (url: string, auth: PlaybackAuth) => {
					const headers = this.manifestHeaders(url, auth);
					if (!globalPass) return this.req.getData(url, headers);
					try {
						if (this.debug || this.req.argv?.debug) console.debug(`[DEBUG] Selected manifest request: ${url}`);
						return await boundedRequest(async (signal) => {
							const result = await this.req.getData(url, { ...headers, signal });
							if (this.debug || this.req.argv?.debug) console.debug(`[DEBUG] Selected manifest status: ${result.res?.status ?? result.error?.res?.status ?? 'request failed'}`);
							if (!result.ok || !result.res) { if ((result.res?.status ?? result.error?.res?.status) === 429) globalPass.noRetry = true; return { ok: false }; }
							const body = await readLimitedManifest(result.res);
							return { ok: true, res: { text: async () => body } };
						});
					} catch (error) { if (this.debug || this.req.argv?.debug) console.debug(`[DEBUG] Manifest request failed: ${String(error)}`); return { ok: false }; }
				};
				const vstreamPlaylistsReq = globalPass?.kind === 'audio' && vcurStream.url === acurStream.url ? undefined : await fetchManifest(videoUrl, videoAuth);
				const astreamPlaylistsReq = globalPass?.kind === 'video' ? undefined : globalPass?.kind === 'audio' || vcurStream.url !== acurStream.url || (audioStream && audioAuth !== videoAuth) ? await fetchManifest(acurStream.url, audioStream ? audioAuth : videoAuth) : vstreamPlaylistsReq;
				const failedVideo = (globalPass?.kind !== 'audio' || !!vstreamPlaylistsReq) && (!vstreamPlaylistsReq?.ok || !vstreamPlaylistsReq.res);
				const failedAudio = globalPass?.kind !== 'video' && (!astreamPlaylistsReq?.ok || !astreamPlaylistsReq.res);
				if (failedVideo || failedAudio) {
					if (globalPass?.kind === 'video') globalPass.selectionLost = true;
					console.error("CAN'T FETCH VIDEO PLAYLISTS!");
					dlFailed = true;
				} else {
					const vstreamPlaylistBody = vstreamPlaylistsReq?.res ? await vstreamPlaylistsReq.res.text() : '';
					const astreamPlaylistBody = astreamPlaylistsReq?.res ? (astreamPlaylistsReq === vstreamPlaylistsReq ? vstreamPlaylistBody : await astreamPlaylistsReq.res.text()) : '';
					if ((globalPass?.kind === 'audio' || vstreamPlaylistBody.match('MPD')) && (globalPass?.kind === 'video' || astreamPlaylistBody.match('MPD'))) {
						let fresh: CatalogVideo | undefined;
						if (globalPass?.kind === 'video') {
							fresh = inspectVideoManifest(vstreamPlaylistBody, globalPass.selected.source, globalPass.selected.family, videoUrl, options.x).find((item) => item.representationKey === globalPass.selected.representationKey);
							if (!fresh || (!globalPass.ignoreTiming && !timingCompatible(fresh, globalPass.references).compatible)) { globalPass.selectionLost = true; return undefined; }
							globalPass.selected = fresh;
							if (this.debug || this.req.argv?.debug) console.debug(`[DEBUG] Selected manifest parsed and matched representation ${fresh.representationId}`);
						}
						if (globalPass?.kind === 'audio') {
							const locale = currentVersion?.audio_locale || mMeta.lang?.cr_locale || (pbData.meta.audio_locale as string);
							const source = { guid: currentVersion?.guid || currentMediaId, locale, languageCode: langsData.languages.find((lang) => lang.cr_locale === locale)?.code || '' };
							const anchors = rankVideoCandidates(inspectVideoManifest(vstreamPlaylistBody || astreamPlaylistBody, source, 'Current', videoUrl, options.x), [source.guid]);
							if (!anchors.length) { console.error('Requested current manifest has no usable video anchor'); return undefined; }
							const compatible = timingCompatible(globalPass.selected, [anchors[anchors.length - 1]]).compatible;
							if (!compatible && !globalPass.ignoreTiming) { console.error('Requested audio timing is no longer compatible with selected video'); return undefined; }
							if (!compatible && globalPass.bypassSync && !globalPass.forceWarning) { console.warn('Forced video timing differs or is unknown; audio and video may be out of sync.'); globalPass.forceWarning = true; }
						}
						const parseLanguage = langsData.findLang(langsData.fixLanguageTag(pbData.meta.audio_locale as string) || '');
						const vstreamPlaylists = globalPass?.kind === 'audio' ? {} : fresh
							? await boundedRequest((signal) => parse(vstreamPlaylistBody, parseLanguage, videoUrl.match(/.*\.urlset\//)?.[0], { selection: { kind: 'video', period: fresh!.periodOrdinal, adaptation: fresh!.adaptationOrdinal, representation: fresh!.representationOrdinal, baseUrlOrdinals: fresh!.baseUrlOrdinals, manifestUrl: videoUrl }, signal }))
							: await parse(vstreamPlaylistBody, parseLanguage, videoUrl.match(/.*\.urlset\//)?.[0]);
						const astreamPlaylists = globalPass?.kind === 'video' ? {} : globalPass?.kind === 'audio'
							? await boundedRequest((signal) => parse(astreamPlaylistBody, parseLanguage, acurStream.url.match(/.*\.urlset\//)?.[0], { selection: { kind: 'audio', language: mMeta.lang?.cr_locale || (pbData.meta.audio_locale as string), manifestUrl: acurStream.url, serverOrdinal: options.x }, signal }))
							: vcurStream.url !== acurStream.url ? await parse(astreamPlaylistBody, parseLanguage, acurStream.url.match(/.*\.urlset\//)?.[0]) : vstreamPlaylists;
						const astreamServers = Object.keys(astreamPlaylists);
						const requestedAudioServer = astreamServers[options.x - 1];
						const aselectedServer = (requestedAudioServer && astreamPlaylists[requestedAudioServer].audio.length && requestedAudioServer) || astreamServers.find((server) => astreamPlaylists[server].audio.length) || astreamServers[0];
						const aselectedList = astreamPlaylists[aselectedServer] || { audio: [] };
						const extra = !globalPass && !options.novids && vcurStream.hardsub_lang === '-' && !(dlVideoOnce && options.dlVideoOnce)
							? await optionalManifests(this.req, vcurStream.url, AuthHeaders, langsData.findLang(langsData.fixLanguageTag(pbData.meta.audio_locale as string) || ''), this.debug || !!this.req.argv?.debug) : [];
						const videos = videoQualities(vstreamPlaylists, extra, globalPass ? 1 : options.x, this.debug || !!this.req.argv?.debug, vcurStream.audio_lang);

						const audios = aselectedList.audio.map((item) => {
							return {
								...item,
								resolutionText: `${Math.round(item.bandwidth / 1000)} kb/s`
							};
						});

						audios.sort((a, b) => {
							return a.bandwidth - b.bandwidth;
						});

						let chosenVideoQuality = globalPass || options.q === 0 ? videos.length : options.q;
						if (chosenVideoQuality > videos.length) {
							console.warn(
								`The requested quality of ${options.q} is greater than the maximum ${videos.length}.\n[WARN] Therefor the maximum will be capped at ${videos.length}.`
							);
							chosenVideoQuality = videos.length;
						}
						chosenVideoQuality--;

						let chosenAudioQuality = globalPass || options.q === 0 ? audios.length : options.q;
						if (chosenAudioQuality > audios.length) {
							chosenAudioQuality = audios.length;
						}
						chosenAudioQuality--;

						const chosenVideoSegments = videos[chosenVideoQuality] || (globalPass?.kind === 'audio' ? { quality: { width: globalPass.selected.width, height: globalPass.selected.height }, bandwidth: 0, segments: [], pssh_wvd: undefined, pssh_prd: undefined, resolutionText: '', server: '' } : undefined);
						const chosenAudioSegments = audios[chosenAudioQuality] || (globalPass?.kind === 'video' ? { bandwidth: 0, segments: [], pssh_wvd: undefined, pssh_prd: undefined, resolutionText: '' } : undefined);
						if (!chosenVideoSegments || !chosenAudioSegments) { if (globalPass?.kind === 'video') globalPass.selectionLost = true; console.error('No usable selected tracks'); return undefined; }
						if (globalPass?.kind === 'video') globalPass.onSelectionConfirmed?.(globalPass.selected);

						if (!globalPass) {
							const selectedIndex = !options.novids && !(dlVideoOnce && options.dlVideoOnce) ? chosenVideoQuality : undefined;
							if (selectionFallbackReason) {
								if (selectedIndex !== undefined) console.info(formatVideoQualityRow(selectedIndex + 1, chosenVideoSegments.resolutionText, 'Re-selected'));
							} else {
								console.info(
									`Available Video Qualities:\n${formatGroupedVideoQualities(
										videos.map((a) => ({ height: a.quality.height, text: a.resolutionText, family: a.family, bandwidth: a.bandwidth })),
										selectedIndex,
										{ compact: !options.qall }
									)}`
								);
							}
						}
						if (globalPass?.kind !== 'video') {
							const audioQualityLines: string[] = [];
							for (const [index, audio] of audios.entries()) {
								const audioLanguage =
									langsData.languages.find((item) => item.code === audio.language?.code && item.code !== 'und')?.code ||
									langsData.languages.find((item) => item.code === acurStream.audio_lang && item.code !== 'und')?.code ||
									'und';
								const selected = index === chosenAudioQuality && !options.noaudio;
								audioQualityLines.push(`    [${index + 1}] ${audio.resolutionText} [A:${audioLanguage}]${selected ? ' <-- Selected' : ''}`);
								if (selected && aselectedServer) audioQualityLines.push(`        Audio Server: ${aselectedServer}`);
							}
							console.info(`Available Audio Qualities:\n${audioQualityLines.join('\n')}`);
						}

						variables.push(
							{
								name: 'height',
								type: 'number',
								replaceWith: chosenVideoSegments.quality.height
							},
							{
								name: 'width',
								type: 'number',
								replaceWith: chosenVideoSegments.quality.width
							}
						);

						const lang = langsData.languages.find((a) => a.code === acurStream?.audio_lang);
						if (!lang) {
							console.error(`Unable to find language for code ${acurStream.audio_lang}`);
							return;
						}
						if (globalPass?.kind === 'video') console.info(`Selected video: ${formatVideoCandidate(globalPass.selected)}\n\tVideo Server: ${chosenVideoSegments.server}`);
						else if (globalPass?.kind !== 'audio') console.info(`Selected quality: \n\tVideo: ${chosenVideoSegments.resolutionText}\n\tVideo Server: ${chosenVideoSegments.server}`);
						if (options.dryRun) {
							if (globalPass?.kind !== 'audio') {
								console.info('Video initialization URL:', chosenVideoSegments.segments[0].map.uri);
								console.info('Video first media segment URL:', chosenVideoSegments.segments[0].uri);
							}
							if (globalPass?.kind !== 'video') {
								console.info('Audio initialization URL:', chosenAudioSegments.segments[0].map.uri);
								console.info('Audio first media segment URL:', chosenAudioSegments.segments[0].uri);
							}
							if (!options.novids) dlVideoOnce = true;
							continue;
						}
						if (globalPass?.kind !== 'audio') console.info('Stream URL:', chosenVideoSegments.segments[0].uri.split(',.urlset')[0]);
						// TODO check filename
						fileName = parseFileName(options.fileName, variables, options.numbers, options.override).join(path.sep);
						const outFile = parseFileName(options.fileName + '.' + (globalPass?.kind === 'video' ? globalPass.requestedName || lang.name : mMeta.lang?.name || lang.name), variables, options.numbers, options.override).join(path.sep);
						const tempFile = parseFileName(`temp-${currentVersion ? currentVersion.guid : currentMediaId}`, variables, options.numbers, options.override).join(
							path.sep
						);
						const tempTsFile = path.isAbsolute(tempFile as string) ? tempFile : path.join(this.cfg.dir.content, tempFile);

						let encryptionKeysVideo: Awaited<ReturnType<typeof getKeysWVD>> | undefined;
						let encryptionKeysAudio: Awaited<ReturnType<typeof getKeysWVD>> | undefined;

						const needVideo = !options.novids && !(dlVideoOnce && options.dlVideoOnce);
						const needAudio = !options.noaudio;
						const videoPssh = cdm === 'widevine' ? chosenVideoSegments.pssh_wvd : chosenVideoSegments.pssh_prd;
						const audioPssh = cdm === 'widevine' ? chosenAudioSegments.pssh_wvd : chosenAudioSegments.pssh_prd;
						if ((needVideo && (chosenVideoSegments.pssh_wvd || chosenVideoSegments.pssh_prd) && !videoPssh) || (needAudio && (chosenAudioSegments.pssh_wvd || chosenAudioSegments.pssh_prd) && !audioPssh)) { console.error('No compatible PSSH for the selected decryptor'); return undefined; }
						if ((needVideo && videoPssh) || (needAudio && audioPssh)) {
							const tokenForAudio = (audioStream ?? videoStream)!.token;
							const ownerForAudio = audioStream && !isDLAudioBypass ? audioAuth : videoAuth;
							const contentId = currentVersion?.guid ?? currentMediaId;
							const leases = [[needVideo ? videoStream?.token : undefined, videoAuth], [needAudio ? tokenForAudio : undefined, ownerForAudio]] as const;
							const kept = new Set<string>();
							for (const [token, owner] of leases) {
								if (!token || kept.has(releaseKey(token, owner))) continue;
								kept.add(releaseKey(token, owner));
								if (!(await this.refreshPlaybackOwner(owner))) return undefined;
								await this.req.getData(`${this.playbackTokenURL(owner, contentId, token)}/keepAlive?playhead=1`, { ...this.playbackHeaders(owner), method: 'PATCH' });
							}
							const getKeys = cdm === 'widevine' ? getKeysWVD : getKeysPRD;
							const license = cdm === 'widevine' ? api.drm_widevine : api.drm_playready;
							const keyHeaders = (token: string, owner: PlaybackAuth) => ({
								...this.sessionHeaders(owner.session),
								Authorization: `Bearer ${owner.session.access_token}`,
								Pragma: 'no-cache',
								'Cache-Control': 'no-cache',
								'content-type': 'application/octet-stream',
								'x-cr-content-id': contentId,
								'x-cr-video-token': token
							});
							if (needVideo && videoPssh) encryptionKeysVideo = await getKeys(videoPssh, license, keyHeaders(videoStream!.token, videoAuth));
							if (needAudio && audioPssh) {
								if (!globalPass && needVideo && tokenForAudio === videoStream?.token && ownerForAudio === videoAuth && audioPssh === videoPssh) encryptionKeysAudio = encryptionKeysVideo;
								else encryptionKeysAudio = await getKeys(audioPssh, license, keyHeaders(tokenForAudio, ownerForAudio));
							}
							if ((needVideo && videoPssh && !encryptionKeysVideo?.length) || (needAudio && audioPssh && !encryptionKeysAudio?.length)) { console.error('Failed to get encryption keys'); return undefined; }
							console.info('Got decryption keys');
						}

						if (!(await releaseGlobalSessions())) return undefined;

						let [audioDownloaded, videoDownloaded] = [false, false];

						// When best selected video quality is already downloaded
						if (dlVideoOnce && options.dlVideoOnce) {
							console.info('Already downloaded video, skipping video download...');
						} else if (options.novids) {
							console.info('Skipping video download...');
						} else {
							//Download Video
							const totalParts = chosenVideoSegments.segments.length;
							const mathParts = Math.ceil(totalParts / options.partsize);
							const mathMsg = `(${mathParts}*${options.partsize})`;
							console.info('Total parts in video stream:', totalParts, mathMsg);
							tsFile = path.isAbsolute(outFile as string) ? outFile : path.join(this.cfg.dir.content, outFile);
							const dirName = path.dirname(tsFile);
							if (!fs.existsSync(dirName)) {
								fs.mkdirSync(dirName, { recursive: true });
							}
							const videoJson: M3U8Json = {
								segments: chosenVideoSegments.segments
							};
							const videoDownload = await new streamdl({
								output: chosenVideoSegments.pssh_wvd || chosenVideoSegments.pssh_prd ? `${tempTsFile}.video.enc.m4s` : `${tsFile}.video.m4s`,
								timeout: options.timeout,
								m3u8json: videoJson,
								// baseurl: chunkPlaylist.baseUrl,
								threads: options.partsize,
								fsRetryTime: options.fsRetryTime * 1000,
								override: options.force,
								callback: options.callbackMaker
									? options.callbackMaker({
											fileName: `${path.isAbsolute(outFile) ? outFile.slice(this.cfg.dir.content.length) : outFile}`,
											image: medias.image,
											parent: {
												title: medias.seasonTitle
											},
											title: medias.episodeTitle,
											language: lang
										})
									: undefined
							}).download();
							if (!videoDownload.ok) {
								console.error(`DL Stats: ${JSON.stringify(videoDownload.parts)}\n`);
								dlFailed = true;
							}
							dlVideoOnce = true;
							videoDownloaded = true;
						}

						if (chosenAudioSegments && !options.noaudio) {
							//Download Audio (if available)
							const totalParts = chosenAudioSegments.segments.length;
							const mathParts = Math.ceil(totalParts / options.partsize);
							const mathMsg = `(${mathParts}*${options.partsize})`;
							console.info('Total parts in audio stream:', totalParts, mathMsg);
							tsFile = path.isAbsolute(outFile as string) ? outFile : path.join(this.cfg.dir.content, outFile);
							const dirName = path.dirname(tsFile);
							if (!fs.existsSync(dirName)) {
								fs.mkdirSync(dirName, { recursive: true });
							}
							const audioJson: M3U8Json = {
								segments: chosenAudioSegments.segments
							};
							const audioDownload = await new streamdl({
								output: chosenAudioSegments.pssh_wvd || chosenAudioSegments.pssh_prd ? `${tempTsFile}.audio.enc.m4s` : `${tsFile}.audio.m4s`,
								timeout: options.timeout,
								m3u8json: audioJson,
								// baseurl: chunkPlaylist.baseUrl,
								threads: options.partsize,
								fsRetryTime: options.fsRetryTime * 1000,
								override: options.force,
								callback: options.callbackMaker
									? options.callbackMaker({
											fileName: `${path.isAbsolute(outFile) ? outFile.slice(this.cfg.dir.content.length) : outFile}`,
											image: medias.image,
											parent: {
												title: medias.seasonTitle
											},
											title: medias.episodeTitle,
											language: lang
										})
									: undefined
							}).download();
							if (!audioDownload.ok) {
								console.error(`DL Stats: ${JSON.stringify(audioDownload.parts)}\n`);
								dlFailed = true;
							}
							audioDownloaded = true;
						} else if (options.noaudio) {
							console.info('Skipping audio download...');
						}

						//Handle Decryption if needed
						if (
							((videoDownloaded && (chosenVideoSegments.pssh_wvd || chosenVideoSegments.pssh_prd)) || (audioDownloaded && (chosenAudioSegments.pssh_wvd || chosenAudioSegments.pssh_prd))) &&
							(videoDownloaded || audioDownloaded) &&
							!dlFailed
						) {
							console.info('Decryption Needed, attempting to decrypt');
							if (this.cfg.bin.mp4decrypt || this.cfg.bin.shaka) {
								let commandBaseVideo = `--show-progress ${encryptionKeysVideo?.map((kb) => `--key ${kb.kid}:${kb.key}`).join(' ')} `;
								let commandBaseAudio = `--show-progress ${encryptionKeysAudio?.map((kb) => `--key ${kb.kid}:${kb.key}`).join(' ')} `;
								let commandVideo = commandBaseVideo + `"${tempTsFile}.video.enc.m4s" "${tempTsFile}.video.m4s"`;
								let commandAudio = commandBaseAudio + `"${tempTsFile}.audio.enc.m4s" "${tempTsFile}.audio.m4s"`;

								if (this.cfg.bin.shaka) {
									commandBaseVideo = ` --enable_raw_key_decryption ${encryptionKeysVideo && encryptionKeysVideo.length > 0 ? `--keys "${encryptionKeysVideo.map((kb, i) => `label=KEY${i + 1}:key_id=${kb.kid}:key=${kb.key}`).join(',')}"` : ''}`;
									commandBaseAudio = ` --enable_raw_key_decryption ${encryptionKeysAudio && encryptionKeysAudio.length > 0 ? `--keys "${encryptionKeysAudio.map((kb, i) => `label=KEY${i + 1}:key_id=${kb.kid}:key=${kb.key}`).join(',')}"` : ''}`;
									commandVideo = `input="${tempTsFile}.video.enc.m4s",stream=video,output="${tempTsFile}.video.m4s"` + commandBaseVideo;
									commandAudio = `input="${tempTsFile}.audio.enc.m4s",stream=audio,output="${tempTsFile}.audio.m4s"` + commandBaseAudio;
								}

								if (videoDownloaded) {
									console.info('Started decrypting video,', this.cfg.bin.shaka ? 'using shaka' : 'using mp4decrypt');
									const decryptVideo = Helper.exec(
										this.cfg.bin.shaka ? 'shaka-packager' : 'mp4decrypt',
										this.cfg.bin.shaka ? `"${this.cfg.bin.shaka}"` : `"${this.cfg.bin.mp4decrypt}"`,
										commandVideo
									);
									if (!decryptVideo.isOk) {
										console.error(decryptVideo.err);
										console.error(`Decryption failed with exit code ${decryptVideo.err.code}`);
										if (this.cfg.bin.shaka) {
											console.error(
												`Downgrade to Shaka-Packager v2.6.1 (https://github.com/shaka-project/shaka-packager/releases/tag/v2.6.1) and try again`
											);
										}
										fs.renameSync(`${tempTsFile}.video.enc.m4s`, `${tsFile}.video.enc.m4s`);
										return undefined;
									} else {
										console.info('Decryption done for video');
										if (!options.nocleanup) {
											fs.unlinkSync(`${tempTsFile}.video.enc.m4s`);
										}
										fs.copyFileSync(`${tempTsFile}.video.m4s`, `${tsFile}.video.m4s`);
										fs.unlinkSync(`${tempTsFile}.video.m4s`);
										files.push({
											type: 'Video',
											layout: 'split',
											path: `${tsFile}.video.m4s`,
											lang: lang,
											isPrimary: isPrimary
										});
									}
								}

								if (audioDownloaded) {
									console.info('Started decrypting audio,', this.cfg.bin.shaka ? 'using shaka' : 'using mp4decrypt');
									const decryptAudio = Helper.exec(
										this.cfg.bin.shaka ? 'shaka-packager' : 'mp4decrypt',
										this.cfg.bin.shaka ? `"${this.cfg.bin.shaka}"` : `"${this.cfg.bin.mp4decrypt}"`,
										commandAudio
									);
									if (!decryptAudio.isOk) {
										console.error(decryptAudio.err);
										console.error(`Decryption failed with exit code ${decryptAudio.err.code}`);
										if (this.cfg.bin.shaka) {
											console.error(
												`Downgrade to Shaka-Packager v2.6.1 (https://github.com/shaka-project/shaka-packager/releases/tag/v2.6.1) and try again`
											);
										}
										fs.renameSync(`${tempTsFile}.audio.enc.m4s`, `${tsFile}.audio.enc.m4s`);
										return undefined;
									} else {
										if (!options.nocleanup) {
											fs.unlinkSync(`${tempTsFile}.audio.enc.m4s`);
										}
										fs.copyFileSync(`${tempTsFile}.audio.m4s`, `${tsFile}.audio.m4s`);
										fs.unlinkSync(`${tempTsFile}.audio.m4s`);
										files.push({
											type: 'Audio',
											muxLang: langsData.languages.find((item) => item.cr_locale === currentVersion?.audio_locale) ?? mMeta.lang,
											path: `${tsFile}.audio.m4s`,
											lang: lang,
											isPrimary: isPrimary
										});
										console.info('Decryption done for audio');
									}
								}
							} else {
								console.warn('mp4decrypt/shaka not found, files need decryption. Decryption Keys:', encryptionKeysVideo, encryptionKeysAudio);
							}
						} else if (dlFailed) {
							console.error('Download failed, skipping decryption');
						} else {
							if (videoDownloaded) {
								files.push({
									type: 'Video',
									layout: 'split',
									path: `${tsFile}.video.m4s`,
									lang: lang,
									isPrimary: isPrimary
								});
							}
							if (audioDownloaded) {
								files.push({
									type: 'Audio',
									muxLang: langsData.languages.find((item) => item.cr_locale === currentVersion?.audio_locale) ?? mMeta.lang,
									path: `${tsFile}.audio.m4s`,
									lang: lang,
									isPrimary: isPrimary
								});
							}
						}
					} else if (globalPass) {
						if (globalPass.kind === 'video') globalPass.selectionLost = true;
						return undefined;
					} else if (!options.novids || options.dryRun) {
						// Init parser
						const parser = new Parser();

						// Parse M3U8
						parser.push(vstreamPlaylistBody);
						parser.end();

						const streamPlaylists = parser.manifest;
						if (!streamPlaylists) throw Error('Failed to parse M3U8');

						const plServerList: string[] = [],
							plStreams: Record<string, Record<string, string>> = {},
							plQuality: {
								str: string;
								dim: string;
								bandwidth: number;
								CODECS?: string;
								RESOLUTION?: {
									width?: number;
									height?: number;
								};
							}[] = [];
						for (const pl of streamPlaylists.playlists ?? []) {
							// set quality
							const plResolution = pl.attributes.RESOLUTION;
							const plResolutionText = `${plResolution?.width}x${plResolution?.height}`;
							// set codecs
							const plCodecs = pl.attributes.CODECS;
							// parse uri
							const plUri = new URL(pl.uri);
							let plServer = plUri.hostname;
							// set server list
							if (plUri.searchParams.get('cdn')) {
								plServer += ` (${plUri.searchParams.get('cdn')})`;
							}
							if (!plServerList.includes(plServer)) {
								plServerList.push(plServer);
							}
							// add to server
							if (!Object.keys(plStreams).includes(plServer)) {
								plStreams[plServer] = {};
							}
							if (
								plStreams[plServer][plResolutionText] &&
								plStreams[plServer][plResolutionText] != pl.uri &&
								typeof plStreams[plServer][plResolutionText] != 'undefined'
							) {
								console.error(`Non duplicate url for ${plServer} detected, please report to developer!`);
							} else {
								plStreams[plServer][plResolutionText] = pl.uri;
							}
							// set plQualityStr
							const plBandwidth = Math.round((pl.attributes?.BANDWIDTH ?? 0) / 1000);
							const qualityStrAdd = `${plResolutionText} (${plBandwidth} kb/s)`;
							const qualityStrRegx = new RegExp(qualityStrAdd.replace(/([:()/])/g, '\\$1'), 'm');
							const qualityStrMatch = !plQuality
								.map((a) => a.str)
								.join('\r\n')
								.match(qualityStrRegx);
							if (qualityStrMatch) {
								plQuality.push({
									str: qualityStrAdd,
									dim: plResolutionText,
									bandwidth: pl.attributes?.BANDWIDTH ?? 0,
									CODECS: plCodecs,
									RESOLUTION: plResolution
								});
							}
						}

						const plSelectedServer = plServerList[0];
						const plSelectedList = plStreams[plSelectedServer];
						plQuality.sort((a, b) => {
							const aMatch: RegExpMatchArray | never[] = a.dim.match(/[0-9]+/) || [];
							const bMatch: RegExpMatchArray | never[] = b.dim.match(/[0-9]+/) || [];
							return parseInt(aMatch[0]) - parseInt(bMatch[0]);
						});
						let quality = options.q === 0 ? plQuality.length : options.q;
						if (quality > plQuality.length) {
							console.warn(
								`The requested quality of ${options.q} is greater than the maximum ${plQuality.length}.\n[WARN] Therefor the maximum will be capped at ${plQuality.length}.`
							);
							quality = plQuality.length;
						}
						// When best selected video quality is already downloaded
						if (dlVideoOnce && options.dlVideoOnce) {
							// Select the lowest resolution with the same codecs
							while (quality != 1 && plQuality[quality - 1].CODECS == plQuality[quality - 2].CODECS) {
								quality--;
							}
						}
						const selectedQuality = plQuality[quality - 1];
						const selectedQualityText = selectedQuality ? `${selectedQuality.str} [Current M] [V:${vcurStream.audio_lang || 'und'}]` : '';
						const selPlUrl = plSelectedList[plQuality.map((a) => a.dim)[quality - 1]] ? plSelectedList[plQuality.map((a) => a.dim)[quality - 1]] : '';
						console.info(`Servers available:\n\t${plServerList.join('\n\t')}`);
						const selectedIndex = selectedQuality && selPlUrl !== '' && !options.novids && !(dlVideoOnce && options.dlVideoOnce) ? quality - 1 : undefined;
						if (selectionFallbackReason) {
							if (selectedIndex !== undefined) console.info(formatVideoQualityRow(quality, selectedQualityText, 'Re-selected'));
						} else {
							console.info(
								`Available qualities:\n${formatGroupedVideoQualities(
									plQuality.map((a) => ({ height: a.RESOLUTION?.height, text: `${a.str} [Current M] [V:${vcurStream.audio_lang || 'und'}]`, family: 'Current' as const, bandwidth: a.bandwidth })),
									selectedIndex,
									{ compact: !options.qall }
								)}`
							);
						}

						if (selPlUrl != '') {
							variables.push(
								{
									name: 'height',
									type: 'number',
									replaceWith:
										quality === 0 ? (plQuality[plQuality.length - 1].RESOLUTION?.height as number) : (plQuality[quality - 1].RESOLUTION?.height as number)
								},
								{
									name: 'width',
									type: 'number',
									replaceWith:
										quality === 0 ? (plQuality[plQuality.length - 1].RESOLUTION?.width as number) : (plQuality[quality - 1].RESOLUTION?.width as number)
								}
							);
							const lang = langsData.languages.find((a) => a.code === vcurStream?.audio_lang);
							if (!lang) {
								console.error(`Unable to find language for code ${vcurStream.audio_lang}`);
								return;
							}
							console.info(`Selected quality: ${Object.keys(plSelectedList).find((a) => plSelectedList[a] === selPlUrl)} [Current M] [V:${vcurStream.audio_lang || 'und'}] @ ${plSelectedServer}`);
							console.info('Stream URL:', selPlUrl);
							if (options.dryRun) {
								if (!options.novids) dlVideoOnce = true;
								continue;
							}
							// TODO check filename
							fileName = parseFileName(options.fileName, variables, options.numbers, options.override).join(path.sep);
							const outFile = parseFileName(options.fileName + '.' + (mMeta.lang?.name || lang.name), variables, options.numbers, options.override).join(
								path.sep
							);
							console.info(`Output filename: ${outFile}`);
							const chunkPage = await this.req.getData(selPlUrl, {
								headers: api.crunchyDefHeader
							});
							if (!chunkPage.ok || !chunkPage.res) {
								console.error("CAN'T FETCH VIDEO PLAYLIST!");
								dlFailed = true;
							} else {
								// We have the stream, so go ahead and delete the active stream
								if (!(await releaseGlobalSessions())) return undefined;

								const chunkPageBody = await chunkPage.res.text();
								// Init parser
								const parser = new Parser();

								// Parse M3U8
								parser.push(chunkPageBody);
								parser.end();

								const chunkPlaylist = parser.manifest;
								if (!chunkPlaylist) throw Error('Failed to parse M3U8');

								const totalParts = chunkPlaylist.segments.length;
								const mathParts = Math.ceil(totalParts / options.partsize);
								const mathMsg = `(${mathParts}*${options.partsize})`;
								console.info('Total parts in stream:', totalParts, mathMsg);
								tsFile = path.isAbsolute(outFile as string) ? outFile : path.join(this.cfg.dir.content, outFile);
								const dirName = path.dirname(tsFile);
								if (!fs.existsSync(dirName)) {
									fs.mkdirSync(dirName, { recursive: true });
								}
								const dlStreamByPl = await new streamdl({
									output: `${tsFile}.ts`,
									timeout: options.timeout,
									m3u8json: chunkPlaylist,
									// baseurl: chunkPlaylist.baseUrl,
									threads: options.partsize,
									fsRetryTime: options.fsRetryTime * 1000,
									override: options.force,
									callback: options.callbackMaker
										? options.callbackMaker({
												fileName: `${path.isAbsolute(outFile) ? outFile.slice(this.cfg.dir.content.length) : outFile}`,
												image: medias.image,
												parent: {
													title: medias.seasonTitle
												},
												title: medias.episodeTitle,
												language: lang
											})
										: undefined
								}).download();
								if (!dlStreamByPl.ok) {
									console.error(`DL Stats: ${JSON.stringify(dlStreamByPl.parts)}\n`);
									dlFailed = true;
								}
								files.push({
									type: 'Video',
									layout: 'combined',
									muxLang: langsData.languages.find((item) => item.cr_locale === currentVersion?.audio_locale) ?? mMeta.lang,
									path: `${tsFile}.ts`,
									lang: lang,
									isPrimary: isPrimary
								});
								dlVideoOnce = true;
							}
						} else {
							console.error('Quality not selected!\n');
							dlFailed = true;
						}
					} else if (options.novids) {
						fileName = parseFileName(options.fileName, variables, options.numbers, options.override).join(path.sep);
						console.info('Downloading skipped!');
					}
				}
			} else if (options.novids && options.noaudio) {
				fileName = parseFileName(options.fileName, variables, options.numbers, options.override).join(path.sep);
			}

			if (options.dryRun) continue;
			if (globalPass && !(await releaseGlobalSessions())) return undefined;

			if (compiledChapters.length > 0) {
				try {
					fileName = parseFileName(options.fileName, variables, options.numbers, options.override).join(path.sep);
					const outFile = parseFileName(options.fileName + '.' + mMeta.lang?.name, variables, options.numbers, options.override).join(path.sep);
					tsFile = path.isAbsolute(outFile as string) ? outFile : path.join(this.cfg.dir.content, outFile);
					const dirName = path.dirname(tsFile);
					if (!fs.existsSync(dirName)) {
						fs.mkdirSync(dirName, { recursive: true });
					}
					const lang = langsData.languages.find((a) => a.code === vcurStream?.audio_lang);
					if (!lang) {
						console.error(`Unable to find language for code ${vcurStream.audio_lang}`);
						return;
					}
					fs.writeFileSync(`${tsFile}.txt`, compiledChapters.join('\r\n'));
					files.push({
						path: `${tsFile}.txt`,
						lang: lang,
						type: 'Chapters'
					});
				} catch {
					console.error('Failed to write chapter file');
				}
			}

			if (options.dlsubs.indexOf('all') > -1) {
				options.dlsubs = ['all'];
			}

			if (options.hslang != 'none') {
				console.warn('Subtitles downloading disabled for hardsubs streams.');
				options.skipsubs = true;
			}

			if (options.nosubs) {
				console.info('Subtitles downloading disabled from nosubs flag.');
				options.skipsubs = true;
			}

			if (!options.skipsubs && options.dlsubs.indexOf('none') == -1) {
				if (
					(pbData.meta.subtitles && Object.values(pbData.meta.subtitles).length) ||
					(pbData.meta.closed_captions && Object.values(pbData.meta.closed_captions).length > 0)
				) {
					const subsData = Object.values(pbData.meta.subtitles);
					const capsData = options.CC === false ? [] : Object.values(pbData.meta.closed_captions);
					const subsDataMapped = subsData
						.map((s) => {
							const subLang = langsData.fixAndFindCrLC(s.language);
							return {
								...s,
								isCC: false,
								locale: subLang,
								language: subLang.locale
							};
						})
						.concat(
							capsData.map((s) => {
								const subLang = langsData.fixAndFindCrLC(s.language);
								return {
									...s,
									isCC: true,
									locale: subLang,
									language: subLang.locale
								};
							})
						);
					const subsArr = langsData.sortSubtitles<(typeof subsDataMapped)[0]>(subsDataMapped, 'language');
					const audioLocale = langsData.fixLanguageTag(pbData.meta.audio_locale as string);
					const knownAudioLocale = !!audioLocale && audioLocale !== 'und' && langsData.languages.some((language) => language.cr_locale === audioLocale && language.code !== 'und');
					for (const subsIndex in subsArr) {
						const subsItem = subsArr[subsIndex];
						const langItem = subsItem.locale;
						const sxData: Partial<sxItem> = {};
						sxData.language = langItem;
						const subtitleLocale = langsData.fixLanguageTag(langItem.cr_locale || '');
						const isSigns = !subsItem.isCC && knownAudioLocale && audioLocale === subtitleLocale;
						const isCC = subsItem.isCC;
						sxData.file = langsData.subsFile(fileName as string, subsIndex, langItem, isCC, options.ccTag, isSigns, subsItem.format);
						if (path.isAbsolute(sxData.file)) {
							sxData.path = sxData.file;
						} else {
							sxData.path = path.join(this.cfg.dir.content, sxData.file);
						}
						const dirName = path.dirname(sxData.path);
						if (!fs.existsSync(dirName)) {
							fs.mkdirSync(dirName, { recursive: true });
						}
						if (
							files.some(
								(a) =>
									a.type === 'Subtitle' &&
									(a.language.cr_locale == langItem.cr_locale || a.language.locale == langItem.locale) &&
									a.cc === isCC &&
									a.signs === isSigns
							)
						)
							continue;
						if ((options.dlsubs.includes('all') || options.dlsubs.includes(langItem.locale)) && subsItem?.url) {
							const subsAssReq = await this.req.getData(subsItem.url, {
								headers: api.crunchyDefHeader
							});
							if (subsAssReq.ok && subsAssReq.res) {
								let sBody = await subsAssReq.res.text();

								if (subsItem.format === 'vtt') {
									if (!options.noASSConv) {
										const chosenFontSize = options.originalFontSize ? undefined : options.fontSize;
										if (!options.originalFontSize) sBody = sBody.replace(/( font-size:.+?;)/g, '').replace(/(font-size:.+?;)/g, '');
										sBody = vtt2ass(undefined, chosenFontSize, sBody, '', undefined, options.fontName);
										sxData.file = sxData.file.replace(/\.vtt$/i, '.ass');
										sxData.path = sxData.path.replace(/\.vtt$/i, '.ass');
									} else {
										// Yeah, whatever
										sxData.fonts = [];
									}
								}

								if (!options.noASSConv || subsItem.format !== 'vtt') {
									// Extract PlayRes
									const mX = sBody.match(/^PlayResX:\s*(\d+)/m);
									const mY = sBody.match(/^PlayResY:\s*(\d+)/m);
									let playResX = Number(mX?.[1]);
									let playResY = Number(mY?.[1]);

									// Fix for Crunchyroll CCC SRT ASS
									if (sBody.includes('www.closedcaptionconverter.com') && options.srtAssFix && !options.noSubFix) {
										playResX = 640;
										playResY = 360;

										// Fix invalid Dialogue and remove PlayDepth
										sBody = sBody.replace(/,,,,25.00,,/g, ',,0,0,0,,').replace('PlayDepth: 0\n', '');

										// Fix fonts
										switch (langItem.cr_locale) {
											case 'de-DE':
												sBody = sBody.replace(
													/^Style:\s*([^,]+),[^,]+\s*,\s*[\d.]+(?:,[^,]+){15},(\d+)(?:,[^,]+){3},(\d+)$/gm,
													(match, name, align) => {
														return `Style: ${name},Arial,23,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,${align},0,0,20,1`;
													}
												);
												break;
											case 'id-ID':
												sBody = sBody.replace(
													/^Style:\s*([^,]+),[^,]+\s*,\s*[\d.]+(?:,[^,]+){15},(\d+)(?:,[^,]+){3},(\d+)$/gm,
													(match, name, align) => {
														return `Style: ${name},Arial,20,&H00FFFFFF,&H0000FFFF,&H00000000,&H7F404040,-1,0,0,0,100,100,0,0,1,2,1,${align},0020,0020,0022,0`;
													}
												);
												break;
											case 'hi-IN':
												sBody = sBody.replace(
													/^Style:\s*([^,]+),[^,]+\s*,\s*[\d.]+(?:,[^,]+){15},(\d+)(?:,[^,]+){3},(\d+)$/gm,
													(match, name, align) => {
														return `Style: ${name},Mangal,24,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,${align},0010,0010,0018,0`;
													}
												);
												break;
											case 'ta-IN':
												sBody = sBody.replace(
													/^Style:\s*([^,]+),[^,]+\s*,\s*[\d.]+(?:,[^,]+){15},(\d+)(?:,[^,]+){3},(\d+)$/gm,
													(match, name, align) => {
														return `Style: ${name},Noto Sans Tamil,24,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,${align},0010,0010,0018,0`;
													}
												);
												break;
											case 'te-IN':
												sBody = sBody.replace(
													/^Style:\s*([^,]+),[^,]+\s*,\s*[\d.]+(?:,[^,]+){15},(\d+)(?:,[^,]+){3},(\d+)$/gm,
													(match, name, align) => {
														return `Style: ${name},Noto Sans Telugu,24,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,${align},0010,0010,0018,0`;
													}
												);
												break;
											case 'vi-VN':
												sBody = sBody.replace(
													/^Style:\s*([^,]+),[^,]+\s*,\s*[\d.]+(?:,[^,]+){15},(\d+)(?:,[^,]+){3},(\d+)$/gm,
													(match, name, align) => {
														return `Style: ${name},Arial Unicode MS,20,&H00FFFFFF,&H0000FFFF,&H00000000,&H7F404040,-1,0,0,0,100,100,0,0,1,2,1,${align},0020,0020,0022,0`;
													}
												);
												break;
											case 'ms-MY':
												sBody = sBody.replace(
													/^Style:\s*([^,]+),[^,]+\s*,\s*[\d.]+(?:,[^,]+){15},(\d+)(?:,[^,]+){3},(\d+)$/gm,
													(match, name, align) => {
														return `Style: ${name},Arial,20,&H00FFFFFF,&H0000FFFF,&H00000000,&H7F404040,-1,0,0,0,100,100,0,0,1,2,1,${align},0020,0020,0022,0`;
													}
												);
												break;
											case 'th-TH':
												sBody = sBody.replace(
													/^Style:\s*([^,]+),[^,]+\s*,\s*[\d.]+(?:,[^,]+){15},(\d+)(?:,[^,]+){3},(\d+)$/gm,
													(match, name, align) => {
														return `Style: ${name},Noto Sans Thai,30,&H00FFFFFF,&H0000FFFF,&H00000000,&H7F404040,-1,0,0,0,100,100,0,0,1,2,1,${align},0020,0020,0022,0`;
													}
												);
												break;
											case 'zh-CN':
											case 'zh-HK':
												sBody = sBody.replace(
													/^Style:\s*([^,]+),[^,]+\s*,\s*[\d.]+(?:,[^,]+){15},(\d+)(?:,[^,]+){3},(\d+)$/gm,
													(match, name, align) => {
														return `Style: ${name},Arial Unicode MS,20,&H00FFFFFF,&H0000FFFF,&H00000000,&H7F404040,-1,0,0,0,100,100,0,0,1,2,1,${align},0020,0020,0022,0`;
													}
												);
												break;
											case 'ru-RU':
												sBody = sBody.replace(
													/^Style:\s*([^,]+),[^,]+\s*,\s*[\d.]+(?:,[^,]+){15},(\d+)(?:,[^,]+){3},(\d+)$/gm,
													(match, name, align) => {
														return `Style: ${name},Tahoma,22,&H00FFFFFF,&H000000FF,&H00000000,&H96000000,0,0,0,0,100,100,0,0,1,2,1,${align},0010,0010,0025,204`;
													}
												);
												break;
											case 'it-IT':
												sBody = sBody.replace(
													/^Style:\s*([^,]+),[^,]+\s*,\s*[\d.]+(?:,[^,]+){15},(\d+)(?:,[^,]+){3},(\d+)$/gm,
													(match, name, align) => {
														return `Style: ${name},Trebuchet MS,22,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,${align},0010,0010,0015,1`;
													}
												);
												break;
											case 'ar-SA':
												sBody = sBody.replace(
													/^Style:\s*([^,]+),[^,]+\s*,\s*[\d.]+(?:,[^,]+){15},(\d+)(?:,[^,]+){3},(\d+)$/gm,
													(match, name, align) => {
														return `Style: ${name},Adobe Arabic,26,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,1,0,${align},0010,0010,0018,0`;
													}
												);
												break;
											case 'fr-FR':
												sBody = sBody.replace(
													/^Style:\s*([^,]+),[^,]+\s*,\s*[\d.]+(?:,[^,]+){15},(\d+)(?:,[^,]+){3},(\d+)$/gm,
													(match, name, align) => {
														return `Style: ${name},Trebuchet MS,22,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,1,1,${align},0002,0002,0025,1`;
													}
												);
												break;
											case 'pt-BR':
												sBody = sBody.replace(
													/^Style:\s*([^,]+),[^,]+\s*,\s*[\d.]+(?:,[^,]+){15},(\d+)(?:,[^,]+){3},(\d+)$/gm,
													(match, name, align) => {
														return `Style: ${name},Trebuchet MS,22,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,1,${align},0040,0040,0015,0`;
													}
												);
												break;
											default:
												sBody = sBody.replace(
													/^Style:\s*([^,]+),[^,]+\s*,\s*[\d.]+(?:,[^,]+){15},(\d+)(?:,[^,]+){3},(\d+)$/gm,
													(match, name, align) => {
														return `Style: ${name},Trebuchet MS,24,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,${align},0010,0010,0018,0`;
													}
												);
												break;
										}

										const lines = sBody.split('\n');

										// Add PlayResX, PlayResY, Timer and WrapStyle
										const idx = lines.findIndex((l) => l.trim() === '[Script Info]');
										if (idx !== -1) {
											const hasPlayResX = lines.some((l) => l.match(/^PlayResX:/));
											const hasPlayResY = lines.some((l) => l.match(/^PlayResY:/));
											const hasTimer = lines.some((l) => l.match(/^Timer:/));
											const hasWrapStyle = lines.some((l) => l.match(/^WrapStyle:/));

											const toInsert = [`SubtitleLanguage: ${langItem.name}`];

											if (!hasPlayResX) toInsert.push(`PlayResX: ${playResX}`);
											if (!hasPlayResY) toInsert.push(`PlayResY: ${playResY}`);
											if (!hasTimer) toInsert.push('Timer: 0.0000');
											if (!hasWrapStyle) toInsert.push('WrapStyle: 0');

											lines.splice(idx + 3, 0, ...toInsert);
										}

										sBody = lines.join('\n');
									}

									if (!options.noSubFix) {
										// LayoutRes Fix
										if (options.layoutResFix && !sBody.includes('LayoutResX') && !sBody.includes('LayoutResY')) {
											sBody = sBody.replace(/^(PlayResY:\s*\d+)/m, `$1\nLayoutResX: ${playResX}\nLayoutResY: ${playResY}`);
										}

										// ScaleBorderAndShadow Fix (True and doesn't exist)
										if (options.scaledBorderAndShadowFix && !sBody.includes('ScaledBorderAndShadow')) {
											sBody = sBody.replace(/^(WrapStyle:.*)$/m, `$1\nScaledBorderAndShadow: ${options.scaledBorderAndShadow}`);
										}

										// ScaleBorderAndShadow Fix (True and exists)
										if (options.scaledBorderAndShadowFix && sBody.includes('ScaledBorderAndShadow')) {
											sBody = sBody.replace(/ScaledBorderAndShadow:\s*(yes|no)/, `ScaledBorderAndShadow: ${options.scaledBorderAndShadow}`);
										}

										// Fix VLC wrong parsing if URL not avaiable
										if (options.originalScriptFix) {
											sBody = sBody.replace(/^Original Script:.*$/gm, 'Original Script: Crunchyroll');
										}

										// Remove All Comments
										sBody = sBody.replace(/^[ \t]*;.*\r?\n?/gm, '');

										// Remove Aegisub Project Garbage
										sBody = sBody.replace(/\[Aegisub Project Garbage\][\s\S]*?(?:\r?\n(?=\[)|$)/, '');

										// Remove YCbCr
										sBody = sBody.replace(/^[ \t]*YCbCr Matrix:\s*.*\r?\n?/m, '');

										// Make sure no Dialogue timestamp goes over video length
										if (options.subtitleTimestampFix && mMeta?.durationMs && mMeta.durationMs > 15000) {
											const lines = sBody.split('\n');
											const newLines: string[] = [];
											const durationS = mMeta.durationMs / 1000;

											const toSec = (t: string) => {
												const [h, m, s] = t.replace(',', '.').split(/[:.]/).map(Number);
												return h * 3600 + m * 60 + s;
											};

											for (let line of lines) {
												if (line.startsWith('Dialogue:')) {
													const parts = line.split(',');
													const start = parts[1];
													const end = parts[2];

													const s = toSec(start);
													const e = toSec(end);

													// If start time is longer than durationS skip the subtitle line completely
													if (s > durationS) continue;

													// If only end time is longer than durationS short it down
													if (e > durationS) {
														const h = String(Math.floor(durationS / 3600));
														const m = String(Math.floor((durationS % 3600) / 60)).padStart(2, '0');
														const sec = (durationS % 60).toFixed(2).padStart(5, '0');
														parts[2] = `${h}:${m}:${sec}`;
														line = parts.join(',');
													}
												}

												newLines.push(line);
											}

											sBody = newLines.join('\n');
										}

										// Force outline thickness for ru-RU: if the 17th field (Outline) equals 2.6 → 2
										if (langItem.cr_locale === 'ru-RU') {
											sBody = sBody.replace(/^[ \t]*(Style:\s*[^,\n]*(?:,[^,\n]*){15}),\s*2(?:[.,]6(?:0+)?)?(\s*,)/gm, '$1,2$2');
										}
									}

									sxData.title = langItem.language;
									sxData.fonts = fontsData.assFonts(sBody) as Font[];
								}
								fs.writeFileSync(sxData.path, sBody);
								console.info(`Subtitle downloaded: ${sxData.file}`);
								files.push({
									type: 'Subtitle',
									...(sxData as sxItem),
									cc: isCC,
									signs: isSigns
								});
							} else {
								console.warn(`Failed to download subtitle: ${sxData.file}`);
								options.subdlfailed = true;
							}
						}
					}
				} else {
					console.warn("Can't find urls for subtitles!");
					options.subdlfailed = true;
				}
			} else {
				console.info('Subtitles downloading skipped!');
			}

			await this.sleep(options.waittime);
			} finally {
				if (recoveryBudget && !(await releaseGlobalSessions())) { queueCleanupFailed = true; dlFailed = true; }
				if (!recoveryBudget && (options.dryRun || globalPass || terminalPlayback429)) {
					if (!(await releaseGlobalSessions())) dlFailed = true;
				}
			}
		}
		return {
			error: dlFailed,
			data: files,
			fileName: fileName ? (path.isAbsolute(fileName) ? fileName : path.join(this.cfg.dir.content, fileName)) || './unknown' : './unknown'
		};
	}

	public async muxStreams(data: DownloadedMedia[], options: CrunchyMuxOptions): Promise<boolean> {
		this.cfg.bin = await yamlCfg.loadBinCfg();
		if (options.novids || data.filter((a) => a.type === 'Video').length === 0) {
			if (options.novids && options.noaudio && !options.nocleanup && !options.dryRun && !options.skipmux && !options.subdlfailed) {
				for (const chapterPath of new Set(data.filter((item) => item.type === 'Chapters').map((item) => item.path))) {
					try {
						fs.unlinkSync(chapterPath);
					} catch {
						console.warn(`Failed to remove chapter file: ${chapterPath}`);
					}
				}
			}
			console.info('Skip muxing since no vids are downloaded');
			return true;
		}
		if (options.subdlfailed && options.skipMuxOnSubFail) {
			console.info('Skip muxing since some subtitles failed to download');
			return true;
		}
		const hasAudioStreams = data.some((a) => a.type === 'Audio');
		const merger = new Merger({
			onlyVid: data
				.filter((a) => a.type === 'Video')
				.filter((a) => a.layout === 'split' || (a.layout === undefined && hasAudioStreams))
				.map((a): MergerInput => ({ lang: a.lang, path: a.path, sourceIndex: data.indexOf(a) })),
			skipSubMux: options.skipSubMux,
			onlyAudio: hasAudioStreams
				? data
						.filter((a) => a.type === 'Audio')
						.map((a): MergerInput => {
							return {
								lang: a.lang,
								orderLang: a.muxLang,
								path: a.path
							};
						})
				: [],
			output: `${options.output}.${options.mp4 ? 'mp4' : 'mkv'}`,
			subtitles: data
				.filter((a) => a.type === 'Subtitle')
				.map((a): SubtitleInput => {
					return {
						file: a.path,
						language: a.language,
						closedCaption: a.cc,
						signs: a.signs
					};
				}),
			simul: false,
			keepAllVideos: options.keepAllVideos,
			fonts: Merger.makeFontsList(this.cfg.dir.fonts, data.filter((a) => a.type === 'Subtitle') as sxItem[]),
			videoAndAudio: data
				.filter((a) => a.type === 'Video')
				.filter((a) => a.layout === 'combined' || (a.layout === undefined && !hasAudioStreams))
				.map((a): MergerInput => ({ lang: a.lang, orderLang: a.muxLang, path: a.path, sourceIndex: data.indexOf(a) })),
			crunchy: { languages: options.muxAudioLanguages ?? [], allDubs: !!options.allDubs, noaudio: !!options.noaudio },
			chapters: data
				.filter((a) => a.type === 'Chapters')
				.map((a): MergerInput => {
					return {
						path: a.path,
						lang: a.lang
					};
				}),
			videoTitle: options.videoTitle,
			options: {
				ffmpeg: options.ffmpegOptions,
				mkvmerge: options.mkvmergeOptions
			},
			defaults: {
				audio: options.defaultAudio,
				sub: options.defaultSub
			},
			ccTag: options.ccTag
		});
		const bin = Merger.checkMerger(this.cfg.bin, options.mp4, options.forceMuxer);
		// collect fonts info
		// mergers
		const mixedWithSeparateAudio = hasAudioStreams && data.some((item) => item.type === 'Video' && item.layout === 'combined');
		if (options.syncTiming && !mixedWithSeparateAudio) {
			await merger.createDelays();
		}
		let merged: boolean;
		if (bin.MKVmerge) {
			merged = await merger.merge('mkvmerge', bin.MKVmerge);
		} else if (bin.FFmpeg) {
			merged = await merger.merge('ffmpeg', bin.FFmpeg);
		} else {
			console.error('Unable to mux files: no supported muxer is available.');
			return false;
		}
		if (!merged) return false;
		if (!options.nocleanup) merger.cleanUp();
		return true;
	}

	public async listSeriesID(
		id: string,
		data?: CrunchyMultiDownload
	): Promise<{
		list: Episode[];
		data: Record<
			string,
			{
				items: CrunchyEpisode[];
				langs: langsData.LanguageItem[];
			}
		>;
	}> {
		if (!(await this.refreshToken(true, true))) return { data: {}, list: [] };
		let serieshasversions = true;
		const parsed = await this.parseSeriesById(id);
		if (!parsed) return { data: {}, list: [] };
		const result = this.parseSeriesResult(parsed);
		const episodes: Record<
			string,
			{
				items: CrunchyEpisode[];
				langs: langsData.LanguageItem[];
			}
		> = {};
		for (const season of Object.keys(result) as unknown as number[]) {
			for (const key of Object.keys(result[season])) {
				const s = result[season][key];
				if (data?.s && s.id !== data.s) continue;
				(await this.getSeasonDataById(s))?.data?.forEach((episode) => {
					//TODO: Make sure the below code is ok
					//Prepare the episode array
					let item;
					const seasonIdentifier = s.identifier ? s.identifier.split('|')[1] : `S${episode.season_number}`;
					if (!Object.prototype.hasOwnProperty.call(episodes, `${seasonIdentifier}E${episode.episode || episode.episode_number}`)) {
						item = episodes[`${seasonIdentifier}E${episode.episode || episode.episode_number}`] = {
							items: [] as CrunchyEpisode[],
							langs: [] as langsData.LanguageItem[]
						};
					} else {
						item = episodes[`${seasonIdentifier}E${episode.episode || episode.episode_number}`];
					}

					if (episode.versions) {
						//Iterate over episode versions for audio languages
						for (const version of episode.versions) {
							//Make sure there is only one of the same language
							if (!item.langs.find((a) => a?.cr_locale == version.audio_locale)) {
								//Push to arrays if there is no duplicates of the same language.
								item.items.push(episode);
								item.langs.push(langsData.languages.find((a) => a.cr_locale == version.audio_locale) as langsData.LanguageItem);
							}
						}
						//Sort audio tracks according to the order of languages passed to the 'dubLang' option
						const argv = yargs.appArgv(this.cfg.cli);
						if (!argv.allDubs) {
							item.langs.sort((a, b) => argv.dubLang.indexOf(a.code) - argv.dubLang.indexOf(b.code));
						}
					} else {
						//Episode didn't have versions, mark it as such to be logged.
						serieshasversions = false;
						//Make sure there is only one of the same language
						if (!item.langs.find((a) => a?.cr_locale == episode.audio_locale)) {
							//Push to arrays if there is no duplicates of the same language.
							item.items.push(episode);
							item.langs.push(langsData.languages.find((a) => a.cr_locale == episode.audio_locale) as langsData.LanguageItem);
						}
					}
				});
			}
		}

		const itemIndexes = {
			sp: 1,
			no: 1
		};

		for (const key of Object.keys(episodes)) {
			const item = episodes[key];
			const isSpecial = !item.items[0].episode.match(/^\d+$/);
			episodes[`${isSpecial ? 'S' : 'E'}${itemIndexes[isSpecial ? 'sp' : 'no']}`] = item;
			if (isSpecial) itemIndexes.sp++;
			else itemIndexes.no++;
			delete episodes[key];
		}

		// Sort episodes to have specials at the end
		const specials = Object.entries(episodes).filter((a) => a[0].startsWith('S')),
			normal = Object.entries(episodes).filter((a) => a[0].startsWith('E')),
			sortedEpisodes = Object.fromEntries([...normal, ...specials]);

		for (const key of Object.keys(sortedEpisodes)) {
			const item = sortedEpisodes[key];
			const epNum = key.startsWith('E') ? `E${data?.absolute ? item.items[0].episode_number?.toString() || item.items[0].episode : key.slice(1)}` : key;
			console.info(`[${data?.absolute ? epNum : key}] [${item.items[0].upload_date ? new Date(item.items[0].upload_date).toISOString().slice(0, 10) : '0000-00-00'}] ${
				item.items.find((a) => !a.season_title.match(/\(\w+ Dub\)/))?.season_title ?? item.items[0].season_title.replace(/\(\w+ Dub\)/g, '').trimEnd()
			} - Season ${item.items[0].season_number} - ${item.items[0].title}
            \r\t- Versions: ${item.items
				.map((a, index) => {
					return `${a.is_premium_only ? '☆ ' : ''}${item.langs?.[index]?.name ?? 'Unknown'}`;
				})
				.join(', ')}
            \r\t- Subtitles: ${[...new Set(item.items.flatMap((a) => a.subtitle_locales ?? 'None'))].join(', ')}`);
		}

		if (!serieshasversions) {
			console.warn("Couldn't find versions on some episodes, fell back to old method.");
		}

		return {
			data: sortedEpisodes,
			list: Object.entries(sortedEpisodes).map(([key, value]) => {
				const images = (value.items[0].images?.thumbnail ?? [[{ source: '/notFound.png' }]])[0];
				const seconds = Math.floor(value.items[0].duration_ms / 1000);
				let epNum;
				if (data?.absolute) {
					epNum =
						value.items[0].episode_number !== null && value.items[0].episode_number !== undefined
							? value.items[0].episode_number.toString()
							: value.items[0].episode !== null && value.items[0].episode !== undefined
								? value.items[0].episode
								: key.startsWith('E')
									? key.slice(1)
									: key;
				} else {
					epNum = key.startsWith('E') ? key.slice(1) : key;
				}
				return {
					e: epNum,
					lang: value.langs.map((a) => a?.code),
					name: value.items[0].title,
					season: value.items[0].season_number.toString(),
					seriesTitle: value.items[0].series_title.replace(/\(\w+ Dub\)/g, '').trimEnd(),
					seasonTitle: value.items[0].season_title.replace(/\(\w+ Dub\)/g, '').trimEnd(),
					episode: value.items[0].episode_number?.toString() ?? value.items[0].episode ?? '?',
					id: value.items[0].season_id,
					img: images[Math.floor(images.length / 2)].source,
					description: value.items[0].description,
					time: `${Math.floor(seconds / 60)}:${seconds % 60}`
				};
			})
		};
	}

	public async downloadFromSeriesID(id: string, data: CrunchyMultiDownload): Promise<ResponseBase<CrunchyEpMeta[]>> {
		const { data: episodes } = await this.listSeriesID(id, data);
		console.info('');
		console.info('-'.repeat(30));
		console.info('');
		const selected = this.itemSelectMultiDub(episodes, data.dubLang, data.but, data.all, data.e, data.absolute, data.allDubs);
		for (const key of Object.keys(selected)) {
			const item = selected[key];
			console.info(
				`[S${item.season}E${item.episodeNumber}] - ${item.episodeTitle} [${item.data
					.map((a) => {
						return `✓ ${a.lang?.name || 'Unknown Language'}`;
					})
					.join(', ')}]`
			);
		}
		const value = Object.values(selected);
		if (!value.length) return { isOk: false, reason: new Error('No episodes selected.') };
		return { isOk: true, value };
	}

	public itemSelectMultiDub(
		eps: Record<
			string,
			{
				items: CrunchyEpisode[];
				langs: langsData.LanguageItem[];
			}
		>,
		dubLang: string[],
		but?: boolean,
		all?: boolean,
		e?: string,
		absolute?: boolean,
		allDubs?: boolean
	) {
		const doEpsFilter = parseSelect(e as string);

		const ret: Record<string, CrunchyEpMeta> = {};

		for (const key of Object.keys(eps)) {
			const itemE = eps[key];
			itemE.items.forEach((item, index) => {
				item.hide_season_title = true;
				if (item.season_title == '' && item.series_title != '') {
					item.season_title = item.series_title;
					item.hide_season_title = false;
					item.hide_season_number = true;
				}
				if (item.season_title == '' && item.series_title == '') {
					item.season_title = 'NO_TITLE';
					item.series_title = 'NO_TITLE';
				}

				let epNum;
				if (absolute) {
					epNum =
						item.episode_number !== null && item.episode_number !== undefined
							? item.episode_number.toString()
							: item.episode !== null && item.episode !== undefined
								? item.episode
								: key.startsWith('E')
									? key.slice(1)
									: key;
				} else {
					epNum = key.startsWith('E') ? key.slice(1) : key;
				}

				// set data
				const images = (item.images?.thumbnail ?? [[{ source: '/notFound.png' }]])[0];
				const epMeta: CrunchyEpMeta = {
					data: [
						{
							mediaId: item.id,
							playback: item.playback,
							versions: item.versions,
							isSubbed: item.is_subbed,
							isDubbed: item.is_dubbed,
							durationMs: item.duration_ms ?? 0
						}
					],
					seriesTitle: itemE.items.find((a) => !a.series_title.match(/\(\w+ Dub\)/))?.series_title ?? itemE.items[0].series_title.replace(/\(\w+ Dub\)/g, '').trimEnd(),
					seasonTitle: itemE.items.find((a) => !a.season_title.match(/\(\w+ Dub\)/))?.season_title ?? itemE.items[0].season_title.replace(/\(\w+ Dub\)/g, '').trimEnd(),
					episodeNumber: epNum,
					episodeTitle: item.title,
					seasonID: item.season_id,
					season: item.season_number,
					showID: item.series_id,
					e: epNum,
					image: images[Math.floor(images.length / 2)].source
				};
				if (item.__links__?.streams?.href) {
					epMeta.data[0].playback = item.__links__.streams.href;
					if (!item.playback) {
						item.playback = item.__links__.streams.href;
					}
				}
				if (item.streams_link) {
					epMeta.data[0].playback = item.streams_link;
					if (!item.playback) {
						item.playback = item.streams_link;
					}
				}

				if (item.playback && ((but && !doEpsFilter.isSelected([epNum, item.id])) || all || (doEpsFilter.isSelected([epNum, item.id]) && !but))) {
					if (Object.prototype.hasOwnProperty.call(ret, key)) {
						const epMe = ret[key];
						epMe.data.push({
							lang: itemE.langs[index],
							...epMeta.data[0]
						});
					} else {
						epMeta.data[0].lang = itemE.langs[index];
						ret[key] = {
							...epMeta
						};
					}
				}
				// show ep
				item.seq_id = epNum;
			});
		}
		for (const item of Object.values(ret)) this.applyDubSelection(item, dubLang, allDubs);
		return ret;
	}

	private applyDubSelection(item: CrunchyEpMeta, dubLang: string[], allDubs?: boolean): void {
		const matching = item.data.filter((entry) => entry.lang && (allDubs || dubLang.includes(entry.lang.code)));
		if (!allDubs) matching.sort((a, b) => dubLang.indexOf(a.lang!.code) - dubLang.indexOf(b.lang!.code));
		item.data = matching.length ? matching : item.data.slice(0, 1);
		item.allDubs = !!allDubs;
		if (allDubs) delete item.requiredDubLang;
		else item.requiredDubLang = [...dubLang];
	}

	public parseSeriesResult(seasonsList: SeriesSearch): Record<number, Record<string, SeriesSearchItem>> {
		const ret: Record<number, Record<string, SeriesSearchItem>> = {};
		let i = 0;
		for (const item of seasonsList.data) {
			i++;
			for (const lang of langsData.languages) {
				//TODO: Make sure the below code is fine
				let season_number = item.season_number;
				if (item.versions) {
					season_number = i;
				}
				if (!Object.prototype.hasOwnProperty.call(ret, season_number)) ret[season_number] = {};
				if (item.title.includes(`(${lang.name} Dub)`) || item.title.includes(`(${lang.name})`)) {
					ret[season_number][lang.code] = item;
				} else if (item.is_subbed && !item.is_dubbed && lang.code == 'jpn') {
					ret[season_number][lang.code] = item;
				} else if (
					item.is_dubbed &&
					lang.code === 'eng' &&
					!langsData.languages.some((a) => item.title.includes(`(${a.name})`) || item.title.includes(`(${a.name} Dub)`))
				) {
					// Dubbed with no more infos will be treated as eng dubs
					ret[season_number][lang.code] = item;
					//TODO: look into if below is stable
				} else if (item.audio_locale == lang.cr_locale) {
					ret[season_number][lang.code] = item;
				}
			}
		}
		return ret;
	}

	public async parseSeriesById(id: string) {
		if (!this.cmsToken.cms) {
			console.error('Authentication required!');
			return;
		}

		const AuthHeaders = {
			headers: {
				Authorization: `Bearer ${this.token.access_token}`,
				...api.crunchyDefHeader
			}
		};

		// seasons list
		const seriesSeasonListReq = await this.req.getData(
			`${api.content_cms}/series/${id}/seasons?force_locale=&preferred_audio_language=ja-JP&locale=${this.locale}`,
			AuthHeaders
		);
		if (!seriesSeasonListReq.ok || !seriesSeasonListReq.res) {
			console.error('Series Request FAILED!');
			return;
		}
		// parse data
		const seasonsList = (await seriesSeasonListReq.res.json()) as SeriesSearch;
		if (seasonsList.total < 1) {
			console.info('Series is empty!');
			return;
		}
		return seasonsList;
	}

	public async getSeasonDataById(item: SeriesSearchItem, log = false) {
		if (!this.cmsToken.cms) {
			console.error('Authentication required!');
			return;
		}

		const AuthHeaders = {
			headers: {
				Authorization: `Bearer ${this.token.access_token}`,
				...api.crunchyDefHeader
			}
		};

		//get show info
		const showInfoReq = await this.req.getData(`${api.content_cms}/seasons/${item.id}?force_locale=&preferred_audio_language=ja-JP&locale=${this.locale}`, AuthHeaders);
		if (!showInfoReq.ok || !showInfoReq.res) {
			console.error('Show Request FAILED!');
			return;
		}
		const showInfo = await showInfoReq.res.json();
		if (log) await this.logObject(showInfo, 0);

		let episodeList = { total: 0, data: [], meta: {} } as CrunchyEpisodeList;
		//get episode info
		for (const s of showInfo.data) {
			const id = s.id;

			//get episode info CMS
			const reqEpsCMSListOpts = [
				api.cms_bucket,
				this.cmsToken.cms.bucket,
				'/episodes?',
				new URLSearchParams({
					force_locale: '',
					preferred_audio_language: 'ja-JP',
					locale: this.locale,
					season_id: id,
					Policy: this.cmsToken.cms.policy,
					Signature: this.cmsToken.cms.signature,
					'Key-Pair-Id': this.cmsToken.cms.key_pair_id
				})
			].join('');
			const reqEpsCMSList = await this.req.getData(reqEpsCMSListOpts, AuthHeaders);
			if (!reqEpsCMSList.ok || !reqEpsCMSList.res) {
				console.error('Episode List Request FAILED!');
				return;
			}
			//CrunchyEpisodeList
			const episodeListAndroid = (await reqEpsCMSList.res.json()) as CrunchyAndroidEpisodes;

			//get episode info API
			const reqEpsListOpts = [
				domain.cr_api,
				'/content/v2/cms/seasons/',
				id,
				'/episodes?',
				new URLSearchParams({
					force_locale: '',
					preferred_audio_language: 'ja-JP',
					locale: this.locale
				})
			].join('');
			const reqEpsList = await this.req.getData(reqEpsListOpts, AuthHeaders);
			if (!reqEpsList.ok || !reqEpsList.res) {
				console.error('Episode List Request FAILED!');
				return;
			}
			//CrunchyEpisodeList
			const episodeListAPI = (await reqEpsList.res.json()) as CrunchyEpisodeList;

			// if API has more items than CMS use API episodes
			if (episodeListAPI.total > episodeListAndroid.total) {
				episodeList = {
					total: episodeList.total + episodeListAPI.total,
					data: [...episodeList.data, ...episodeListAPI.data],
					meta: {}
				};
			} else {
				episodeList = {
					total: episodeList.total + episodeListAndroid.total,
					data: [...episodeList.data, ...episodeListAndroid.items],
					meta: {}
				};
			}
		}

		if (episodeList.total < 1) {
			console.info('  Season is empty!');
			return;
		}
		return episodeList;
	}
}
