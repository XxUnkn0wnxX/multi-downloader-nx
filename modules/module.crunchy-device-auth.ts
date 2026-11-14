import { FetchParams } from './module.fetch';

export const DEVICE_NAME = 'ANDROIDTV 3.76.0';
export const DEVICE_TYPE = 'ANDROIDTV';
export const DEVICE_USER_AGENT = 'Crunchyroll/3.76.0_22366 Android/12; ANDROIDTV; SHIELD Android TV; NVIDIA; NVIDIA';

type Result = { ok: boolean; res?: Response; headers?: Record<string, string> };
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
	now?: () => number;
	sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export const DEVICE_BETA_WARNING = 'Using beta API fallback: beta-api.crunchyroll.com';

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

export function validateCrunchyAuthModes(argv: { service?: string; device?: boolean; auth?: boolean; token?: string; silentAuth?: boolean }): string | undefined {
	if (argv.device && argv.service !== 'crunchy') return '--device is only supported for Crunchyroll.';
	if (argv.service !== 'crunchy') return;
	const modes = Number(!!argv.device) + Number(!!argv.auth) + Number(argv.token !== undefined) + Number(!!argv.silentAuth);
	if (modes > 1) return 'Choose only one of --device, --token, --auth, or --silentAuth.';
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

export async function requestDeviceToken(options: DeviceOptions): Promise<Record<string, any> | undefined> {
	const { request, headers, deviceId, log, debug } = options;
	const controller = new AbortController();
	const signal = controller.signal;
	const cancel = () => controller.abort();
	if (options.signal.aborted) cancel();
	else options.signal.addEventListener('abort', cancel, { once: true });
	let expiryTimer: ReturnType<typeof setTimeout> | undefined;
	let expired = false;
	let initiationTimedOut = false;
	let origin: 'www' | 'api' = 'www';
	const now = options.now ?? Date.now;
	const wait = options.sleep ?? sleep;
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
			allowH2: true
		});
		if (debug) log(`[DEBUG] Device ${endpoint} response: ${result.res?.status ?? 'network error'}`);
		return result;
	};
	try {
		if (signal.aborted) throw new Error('Device login cancelled.');
		const initiate = async (authUrl: string) => {
			const url = `${authUrl.replace(/\/token\/?$/, '')}/device/code`;
			if (debug) log(`[DEBUG] Device code request: ${url}`);
			const attempt = await deviceAuthAttempt(request, url, { method: 'POST', headers: { ...headers }, body: '', useProxy: true, allowH2: true }, signal);
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
		if (!attempt.result.ok || !attempt.result.res || attempt.timedOut) throw new Error('Could not request a device code. Retry the command.');
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
		log('https://crunchyroll.com/activate');
		log(`Code: ${data.user_code}`);
		log(`Expires in ${data.expires_in} seconds. Waiting for approval...`);
		const deadline = now() + data.expires_in * 1000;
		expiryTimer = setTimeout(() => {
			expired = true;
			controller.abort();
		}, data.expires_in * 1000);
		let errors = 0;
		while (!signal.aborted && now() < deadline) {
			await wait(Math.min(data.interval, deadline - now()), signal);
			if (signal.aborted || now() >= deadline) break;
			const result = await makeRequest('token', JSON.stringify({ device_code: data.device_code, device_id: deviceId, device_name: DEVICE_NAME, device_type: DEVICE_TYPE }));
			if (signal.aborted) break;
			if (result.res?.status === 204) {
				errors = 0;
				continue;
			}
			if (result.ok && result.res) {
				const token = await result.res.json();
				if (signal.aborted || now() >= deadline) break;
				if (!validDeviceToken(token)) throw new Error('Invalid device token response.');
				token.device_auth_origin = origin;
				return token;
			}
			if (result.res?.status === 429) throw new Error('Device approval rate limited. Retry later.');
			if (!result.res || result.res.status >= 500) {
				if (++errors <= 3) continue;
				throw new Error('Device approval failed after repeated temporary errors. Retry the command.');
			}
			throw new Error('Device approval was rejected. Retry the command.');
		}
		throw new Error(signal.aborted && !expired ? 'Device login cancelled.' : 'Device code expired. Retry the command.');
	} catch (error) {
		log(
			initiationTimedOut
				? 'Device code request timed out. Retry the command.'
				: expired
					? 'Device code expired. Retry the command.'
					: signal.aborted
						? 'Device login cancelled.'
						: error instanceof Error
							? error.message
							: 'Device login failed.'
		);
		return;
	} finally {
		if (expiryTimer) clearTimeout(expiryTimer);
		options.signal.removeEventListener('abort', cancel);
	}
}
