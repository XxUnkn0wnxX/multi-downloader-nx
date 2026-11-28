import { crunchyLoginInstruction } from './module.crunchy-cli-auth';
import { FetchParams } from './module.fetch';

export const getDeviceName = (deviceId: string): string => `ANDROIDTV (${deviceId.slice(-4)})`;
export const DEVICE_TYPE = 'ANDROIDTV';
export const DEVICE_USER_AGENT = 'Crunchyroll/3.76.0_22366 Android/12; ANDROIDTV; SHIELD Android TV; NVIDIA; NVIDIA';

type Result = { ok: boolean; res?: Response; headers?: Record<string, string>; error?: { name?: string; message?: string } };
type DeviceOptions = {
	request: (url: string, options: FetchParams) => Promise<Result>;
	authUrl: string;
	fallbackAuthUrl?: string;
	warn?: (message: string) => void;
	headers: Record<string, string>;
	deviceId: string;
	signal: AbortSignal;
	debug: boolean;
	log: (message: string) => void;
	dryRun?: boolean;
	openActivation?: (url: string) => void;
	onCountdown?: (remainingSeconds: number | undefined, status?: 'waiting' | 'approved' | 'timed-out' | 'error') => void;
	now?: () => number;
	sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export const DEVICE_BETA_WARNING = 'Using beta API fallback: beta-api.crunchyroll.com';

export const CR_BASIC_REQUIRED = 'This build has missing or invalid Crunchyroll sign-in settings (basic_auth_token). An AniDL maintainer needs to update them.';
export const CR_BASIC_REJECTED = 'Crunchyroll rejected this build’s sign-in settings (basic_auth_token). An AniDL maintainer needs to update them.';
export const CR_WEB_BASIC_REQUIRED =
	'This build has missing or invalid Crunchyroll browser-cookie sign-in settings (web_basic_auth_token). An AniDL maintainer needs to update them.';
export const CR_WEB_BASIC_REJECTED = 'Crunchyroll rejected this build’s browser-cookie sign-in settings (web_basic_auth_token). An AniDL maintainer needs to update them.';

// Reject only locally verifiable malformed Basic settings, without logging their contents.
export function validBasicClient(value: unknown, allowEmptySecret = false): boolean {
	if (typeof value !== 'string' || !value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
	try {
		const decoded = atob(value);
		const separator = decoded.indexOf(':');
		return (
			separator > 0 &&
			(allowEmptySecret || separator < decoded.length - 1) &&
			[...decoded].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
		);
	} catch {
		return false;
	}
}

// Consume at most 8 KiB and return only recognized OAuth codes; never expose the provider body.
export async function classifyOAuthError(response?: Response): Promise<'invalid_client' | 'invalid_grant' | 'invalid_refresh_token' | undefined> {
	if (!response || (response.status !== 400 && response.status !== 401)) return;
	const reader = response.body?.getReader();
	if (!reader) return;
	try {
		const chunks: Uint8Array[] = [];
		let size = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > 8192) {
				void reader.cancel().catch(() => {});
				return;
			}
			chunks.push(value);
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		const error = JSON.parse(new TextDecoder().decode(bytes))?.error;
		if (error === 'invalid_client' || error === 'invalid_grant' || error === 'invalid_refresh_token') return error;
	} catch {
		return;
	} finally {
		reader.releaseLock();
	}
}

type Attempt = { result: Result; timedOut: boolean; cancelled: boolean };
export async function deviceAuthAttempt(
	request: (url: string, options: FetchParams) => Promise<Result>,
	url: string,
	options: FetchParams,
	parentSignal?: AbortSignal
): Promise<Attempt> {
	const controller = new AbortController();
	const cancel = () => controller.abort();
	let timedOut = false;
	if (parentSignal?.aborted) return { result: { ok: false }, timedOut: false, cancelled: true };
	parentSignal?.addEventListener('abort', cancel, { once: true });
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, 30000);
	let result: Result | undefined;
	try {
		result = await request(url, { ...options, signal: controller.signal });
		// Consume a clone while the timer is active so a stalled response body also times out.
		if (result.res && typeof result.res.clone === 'function') await result.res.clone().arrayBuffer();
		return { result: timedOut ? { ...result, ok: false } : result, timedOut, cancelled: !!parentSignal?.aborted };
	} catch {
		return { result: { ...result, ok: false }, timedOut, cancelled: !!parentSignal?.aborted };
	} finally {
		clearTimeout(timer);
		parentSignal?.removeEventListener('abort', cancel);
	}
}

export async function deviceFallbackEligible(result: Result): Promise<boolean> {
	if (!result.res) return true;
	if (result.res.status >= 500) return true;
	if (result.res.status !== 403) return false;
	try {
		const body = await result.res.clone().text();
		return /<html/i.test(body) && (/cf-chl-/i.test(body) || (/cloudflare/i.test(body) && /challenge|just a moment/i.test(body)));
	} catch {
		return false;
	}
}

export async function deviceErrorDetails(result: { res?: Response; error?: { name?: string; message?: string } }, credentialRequest = false): Promise<string> {
	const status = result.res?.status;
	let providerCode: string | undefined;
	let reason: string | undefined;
	if (result.res && typeof result.res.clone === 'function') {
		try {
			const body = await result.res.clone().text();
			const value = JSON.parse(body);
			const error = value?.error;
			const code = value?.error_code ?? value?.code ?? (typeof error === 'string' ? error : error?.code);
			const description = value?.error_description ?? value?.message ?? value?.detail ?? error?.message ?? error?.description;
			if (typeof code === 'string' || typeof code === 'number') providerCode = String(code);
			if (typeof description === 'string') reason = description;
		} catch {
			// Keep the HTTP status even when the provider body is not JSON or cannot be read.
		}
	}
	const safe = (value: string) =>
		value
			.replace(/https?:\/\/\S+/gi, '[URL]')
			.replace(/[\r\n\t]+/g, ' ')
			.slice(0, 100);
	if (credentialRequest) {
		const allowedCodes = ['invalid_grant', 'invalid_refresh_token', 'invalid_client', 'authorization_pending', 'slow_down', 'access_denied', 'expired_token'];
		const allowedReasons = ['approval denied'];
		return [status ? `HTTP ${status}` : '', providerCode && allowedCodes.includes(providerCode) ? providerCode : '', reason && allowedReasons.includes(reason) ? reason : '']
			.filter(Boolean)
			.join(' ');
	}
	const details = [status ? `HTTP ${status}` : '', providerCode ? safe(providerCode) : '', reason ? safe(reason) : ''].filter(Boolean);
	if (!status && !details.length && result.error?.name) details.push(safe(result.error.name));
	return details.join(' ');
}

export function validDeviceToken(token: any): boolean {
	return (
		!!token &&
		typeof token.access_token === 'string' &&
		!!token.access_token &&
		typeof token.refresh_token === 'string' &&
		!!token.refresh_token &&
		typeof token.expires_in === 'number' &&
		Number.isFinite(token.expires_in) &&
		token.expires_in > 0
	);
}

const sleep = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		if (signal.aborted) return reject(new Error('cancelled'));
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', abort);
			resolve();
		}, ms);
		const abort = () => {
			clearTimeout(timer);
			reject(new Error('cancelled'));
		};
		signal.addEventListener('abort', abort, { once: true });
	});

export async function requestDeviceToken(options: DeviceOptions): Promise<Record<string, any> | 'dry-run' | undefined> {
	const { request, headers, deviceId, log, debug } = options;
	const controller = new AbortController();
	const signal = controller.signal;
	const cancel = () => controller.abort();
	if (options.signal.aborted) cancel();
	else options.signal.addEventListener('abort', cancel, { once: true });
	let expiryTimer: ReturnType<typeof setTimeout> | undefined;
	let countdownTimer: ReturnType<typeof setInterval> | undefined;
	let countdownActive = false;
	let timeoutReported = false;
	let expired = false;
	let initiationTimedOut = false;
	let deadline: number | undefined;
	let origin: 'www' | 'api' = 'www';
	const now = options.now ?? Date.now;
	const wait = options.sleep ?? sleep;
	const stopCountdown = () => {
		if (countdownTimer) clearInterval(countdownTimer);
		countdownTimer = undefined;
		if (countdownActive) options.onCountdown?.(undefined);
		countdownActive = false;
	};
	const reportTimeout = () => {
		if (timeoutReported) return;
		timeoutReported = true;
		options.onCountdown?.(0, 'timed-out');
		stopCountdown();
	};
	let root = options.authUrl.replace(/\/token\/?$/, '');
	const makeRequest = async (endpoint: string, body: string) => {
		const url = `${root}/device/${endpoint}`;
		if (debug) log(`[DEBUG] Device ${endpoint} request: ${url}`);
		const result = await request(url, {
			method: 'POST',
			headers: body ? { ...headers, 'Content-Type': 'application/json' } : { ...headers },
			body,
			useProxy: true,
			signal,
			quietErrors: !debug,
			quietDebug: true
		});
		if (debug) log(`[DEBUG] Device ${endpoint} response: ${result.res?.status ?? 'network error'}`);
		return result;
	};
	try {
		if (signal.aborted) throw new Error('Device login cancelled.');
		const initiate = async (authUrl: string) => {
			const url = `${authUrl.replace(/\/token\/?$/, '')}/device/code`;
			if (debug) log(`[DEBUG] Device code request: ${url}`);
			const attempt = await deviceAuthAttempt(
				request,
				url,
				{ method: 'POST', headers: { ...headers }, body: '', useProxy: true, quietErrors: !debug, quietDebug: true },
				signal
			);
			if (debug) log(`[DEBUG] Device code response: ${attempt.result.res?.status ?? 'network error'}`);
			return attempt;
		};
		let attempt = await initiate(options.authUrl);
		if (attempt.cancelled || signal.aborted) throw new Error('Device login cancelled.');
		if (!attempt.result.ok && (await deviceFallbackEligible(attempt.result)) && options.fallbackAuthUrl) {
			if (signal.aborted) throw new Error('Device login cancelled.');
			(options.warn ?? log)(DEVICE_BETA_WARNING);
			origin = 'api';
			root = options.fallbackAuthUrl.replace(/\/token\/?$/, '');
			attempt = await initiate(options.fallbackAuthUrl);
		}
		initiationTimedOut = attempt.timedOut;
		if (attempt.cancelled || signal.aborted) throw new Error('Device login cancelled.');
		if (!attempt.result.ok || !attempt.result.res || attempt.timedOut) {
			if (
				!attempt.timedOut &&
				attempt.result.res &&
				[400, 401].includes(attempt.result.res.status) &&
				(await classifyOAuthError(attempt.result.res.clone())) === 'invalid_client'
			)
				throw new Error(`Device code request failed. ${CR_BASIC_REJECTED}`);
			const details = attempt.timedOut ? '' : await deviceErrorDetails(attempt.result, true);
			throw new Error(`Device code request failed.${details ? ` ${details}.` : ''} Retry the command.`);
		}
		const data = await attempt.result.res.json();
		if (signal.aborted) throw new Error('Device login cancelled.');
		if (
			typeof data.user_code !== 'string' ||
			!data.user_code ||
			typeof data.device_code !== 'string' ||
			!data.device_code ||
			typeof data.expires_in !== 'number' ||
			!Number.isFinite(data.expires_in) ||
			data.expires_in <= 0 ||
			!Number.isSafeInteger(data.expires_in * 1000) ||
			data.expires_in * 1000 > 2147483647 ||
			typeof data.interval !== 'number' ||
			!Number.isFinite(data.interval) ||
			data.interval <= 0 ||
			!Number.isSafeInteger(data.interval) ||
			data.interval > 2147483647
		)
			throw new Error('Invalid device code response.');
		const activationUrl = 'https://crunchyroll.com/activate';
		if (options.openActivation || options.dryRun) log('If your browser doesn’t open, open this link manually.');
		log(`${activationUrl}\n`);
		log(`Enter Code: ${data.user_code.toUpperCase()}`);
		const initialCountdown = `Expires in ${data.expires_in} seconds. (Waiting for approval)`;
		if (options.dryRun) {
			log(initialCountdown);
			return 'dry-run';
		}
		options.openActivation?.(activationUrl);
		deadline = now() + data.expires_in * 1000;
		if (options.onCountdown) {
			countdownActive = true;
			const updateCountdown = () => {
				const remainingSeconds = Math.max(0, Math.ceil((deadline! - now()) / 1000));
				if (remainingSeconds > 0) options.onCountdown?.(remainingSeconds, 'waiting');
			};
			updateCountdown();
			countdownTimer = setInterval(updateCountdown, 1000);
		} else log(initialCountdown);
		expiryTimer = setTimeout(() => {
			expired = true;
			reportTimeout();
			controller.abort();
		}, data.expires_in * 1000);
		let errors = 0;
		while (!signal.aborted && now() < deadline) {
			await wait(Math.min(data.interval, deadline - now()), signal);
			if (signal.aborted) break;
			if (now() >= deadline) {
				expired = true;
				reportTimeout();
				break;
			}
			const result = await makeRequest(
				'token',
				JSON.stringify({ device_code: data.device_code, device_id: deviceId, device_name: getDeviceName(deviceId), device_type: DEVICE_TYPE })
			);
			if (signal.aborted) break;
			if (result.res?.status === 204) {
				errors = 0;
				continue;
			}
			if (result.ok && result.res) {
				const token = await result.res.json();
				if (signal.aborted) break;
				if (now() >= deadline) {
					expired = true;
					reportTimeout();
					break;
				}
				if (!validDeviceToken(token)) throw new Error('Invalid device token response.');
				token.device_auth_origin = origin;
				const remainingSeconds = Math.max(0, Math.ceil((deadline - now()) / 1000));
				if (options.onCountdown) options.onCountdown(remainingSeconds, 'approved');
				else log(`Expires in ${remainingSeconds} seconds. (Approved)`);
				stopCountdown();
				return token;
			}
			if (result.res?.status === 429) {
				const details = await deviceErrorDetails(result, true);
				throw new Error(`Device approval rate limited${details ? ` (${details})` : ''}. Retry later.`);
			}
			if (result.res && [400, 401].includes(result.res.status) && (await classifyOAuthError(result.res.clone())) === 'invalid_client')
				throw new Error(`Device approval was rejected. ${CR_BASIC_REJECTED}`);
			if (!result.res || result.res.status >= 500) {
				if (++errors <= 3) continue;
				const details = await deviceErrorDetails(result, true);
				throw new Error(`Device approval failed after repeated temporary errors${details ? ` (${details})` : ''}. Retry the command.`);
			}
			const details = await deviceErrorDetails(result, true);
			throw new Error(`Device approval was rejected${details ? ` (${details})` : ''}. Retry the command.`);
		}
		if (!expired && now() >= deadline) {
			expired = true;
			reportTimeout();
		}
		throw new Error(signal.aborted && !expired ? 'Device login cancelled.' : `Device code expired. Request a new code.\n${crunchyLoginInstruction('--device androidtv')}`);
	} catch (error) {
		const message = initiationTimedOut
			? 'Device code request timed out. Retry the command.'
			: expired
				? `Device code expired. Request a new code.\n${crunchyLoginInstruction('--device androidtv')}`
				: signal.aborted
					? 'Device login cancelled.'
					: error instanceof Error
						? error.message
						: 'Device login failed.';
		const hadCountdown = countdownActive;
		if (hadCountdown && !signal.aborted && !expired) {
			const remainingSeconds = deadline === undefined ? 0 : Math.max(0, Math.ceil((deadline - now()) / 1000));
			options.onCountdown?.(remainingSeconds, 'error');
		}
		stopCountdown();
		if (!signal.aborted && !expired && deadline === undefined) log('Status: Error');
		log(message);
		return;
	} finally {
		stopCountdown();
		if (expiryTimer) clearTimeout(expiryTimer);
		options.signal.removeEventListener('abort', cancel);
	}
}
