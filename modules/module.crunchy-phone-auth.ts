import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { api, domain } from './module.api-urls';
import { classifyOAuthError, validDeviceToken } from './module.crunchy-device-auth';
import type { Req } from './module.fetch';
import type { CrunchySession } from './module.crunchy-session-store';
import { phoneWindowEnvironment, phoneWindowPath, resolvePhoneRuntime } from './module.crunchy-phone-runtime';

export { PHONE_RUNTIME_ERROR } from './module.crunchy-phone-runtime';

const ssoOrigin = 'https://sso.crunchyroll.com';
const callbackPath = '/android/oauth-callback';
const inputTimeoutMs = 10 * 60_000;
const userAgent = 'Crunchyroll/3.130.0 Android/16 okhttp/5.3.2';
const browserDevicePattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export const PHONE_CLIENT_REQUIRED =
	'This build has missing or invalid Android phone sign-in settings (phone_client_id and phone_client_secret). An AniDL maintainer needs to update them.';
export const PHONE_CLIENT_REJECTED =
	'Crunchyroll rejected this build’s Android phone sign-in settings (phone_client_id and phone_client_secret). An AniDL maintainer needs to update them.';

export const PHONE_WEBVIEW_FAILED = 'AniDL could not complete sign-in in the Crunchyroll window. Close the window and start Android phone sign-in again.';
export const PHONE_BROWSER_DEVICE_MISSING = 'The sign-in window could not verify the browser device ID for this attempt. The Android exchange was skipped.';
export const WEB_WINDOW_FAILED = 'AniDL could not complete web sign-in in the Crunchyroll window.';
export const WEB_COOKIES_MISSING = 'The sign-in window could not verify the Crunchyroll browser session. The web exchange was skipped.';

export type WebAuthProfile = { userAgent: string; deviceType: string };

export function firefoxWebAuthProfile(platform = process.platform, arch = process.arch): WebAuthProfile | undefined {
	const version = '153.0'; // Firefox ESR version used in desktop sign-in windows.
	const platforms = {
		darwin: { name: 'Mac', ua: 'Macintosh; Intel Mac OS X 10.15' },
		win32: { name: 'Windows', ua: 'Windows NT 10.0; Win64; x64' },
		linux: { name: 'Linux', ua: `X11; Linux ${arch === 'arm64' ? 'aarch64' : 'x86_64'}` }
	};
	if (platform !== 'darwin' && platform !== 'win32' && platform !== 'linux') return;
	const { name, ua } = platforms[platform];
	return {
		deviceType: `Firefox (web) on ${name}`,
		userAgent: `Mozilla/5.0 (${ua}; rv:${version}) Gecko/20100101 Firefox/${version}`
	};
}

function phoneClient() {
	const { phone_client_id: id, phone_client_secret: secret } = api;
	const allowed = /^[a-zA-Z0-9_.~-]+$/;
	if (!id || !secret || !allowed.test(id) || !allowed.test(secret)) throw new Error(PHONE_CLIENT_REQUIRED);
	return { id, authorization: `Basic ${Buffer.from(`${id}:${secret}`, 'latin1').toString('base64')}` };
}

export function parsePhoneCallback(input: string, state: string): string | undefined {
	if (input.length > 8192) return;
	let callback: URL;
	try {
		callback = new URL(input.trim());
	} catch {
		return;
	}
	if (callback.origin !== ssoOrigin || callback.pathname !== callbackPath || callback.username || callback.password || callback.href.includes('#')) return;
	const states = callback.searchParams.getAll('state');
	const codes = callback.searchParams.getAll('code');
	if (states.length !== 1 || states[0] !== state || codes.length !== 1 || callback.searchParams.has('error') || !/^[!-~]{1,2048}$/.test(codes[0])) return;
	return codes[0];
}

async function readSignInWindow(
	executable: string,
	url: URL,
	{ web = false, userAgent }: { web?: boolean; userAgent?: string }
): Promise<[credential: string, deviceId: string] | undefined> {
	const env = phoneWindowEnvironment();
	const overridden = new Set(['ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE', 'ELECTRON_ENABLE_LOGGING', 'ELECTRON_LOG_FILE', 'NODE_OPTIONS']);
	for (const name of Object.keys(env)) {
		if (overridden.has(name.toUpperCase())) delete env[name];
	}
	env.ELECTRON_NO_ATTACH_CONSOLE = '1';
	const profile = await mkdtemp(join(tmpdir(), web ? 'anidl-web-signin-' : 'anidl-phone-signin-'));
	const windowError = web ? WEB_WINDOW_FAILED : PHONE_WEBVIEW_FAILED;
	const sessionError = web ? WEB_COOKIES_MISSING : PHONE_BROWSER_DEVICE_MISSING;
	try {
		return await new Promise((resolve, reject) => {
			const controller = new AbortController();
			const cancel = () => controller.abort();
			const child = execFile(
				executable,
				[phoneWindowPath(), profile, ...(web ? ['--web-sign-in'] : [])],
				{
					encoding: 'utf8',
					timeout: inputTimeoutMs,
					maxBuffer: 8230,
					signal: controller.signal,
					windowsHide: true,
					env
				},
				(error, stdout) => {
					process.removeListener('SIGINT', cancel);
					process.removeListener('SIGTERM', cancel);
					if (controller.signal.aborted || error?.code === 2 || error?.signal === 'SIGINT') return resolve(undefined);
					if (error?.code === 4) return reject(new Error(sessionError));
					if (error) return reject(new Error(windowError));
					const lines = stdout.trim().split('\n');
					const [credential, deviceId] = lines;
					if (!credential || /[\r\n]/.test(credential)) return reject(new Error(windowError));
					if (lines.length !== 2 || !browserDevicePattern.test(deviceId) || (web && !browserDevicePattern.test(credential))) return reject(new Error(sessionError));
					resolve([credential, deviceId]);
				}
			);
			process.once('SIGINT', cancel);
			process.once('SIGTERM', cancel);
			child.stdin?.on('error', () => {});
			child.stdin?.end(`${url.href}\n${userAgent ? `${userAgent}\n` : ''}`);
		});
	} finally {
		await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
	}
}

export async function readCrunchyWebCookies(profile = firefoxWebAuthProfile()): Promise<{ refreshToken: string; deviceId: string } | undefined> {
	const executable = await resolvePhoneRuntime();
	process.stdout.write('Use the Crunchyroll window to sign in for web streams.\n');
	const cookies = await readSignInWindow(executable, new URL('/login', ssoOrigin), { web: true, userAgent: profile?.userAgent });
	if (cookies) return { refreshToken: cookies[0], deviceId: cookies[1] };
}

async function exchangePhoneToken(request: Req['getData'], fields: Record<string, string>, device: CrunchySession, onRejected?: () => void): Promise<CrunchySession | undefined> {
	const form = new URLSearchParams({
		...fields,
		scope: 'offline_access',
		device_id: device.device_id,
		device_name: device.device_name,
		device_type: device.device_type
	});
	try {
		const result = await request(`${domain.cr_www}/auth/v1/token`, {
			method: 'POST',
			headers: {
				Authorization: phoneClient().authorization,
				'User-Agent': userAgent,
				Accept: 'application/json',
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: form,
			redirect: 'manual',
			useProxy: true,
			quietDebug: true,
			deferErrorBody: true,
			signal: AbortSignal.timeout(15_000)
		});
		if (!result.ok || !result.res) {
			const providerError = await classifyOAuthError(result.res);
			if (providerError === 'invalid_client') throw new Error(PHONE_CLIENT_REJECTED);
			if (onRejected && (providerError === 'invalid_grant' || providerError === 'invalid_refresh_token')) onRejected();
			else if (!result.res?.bodyUsed) await result.res?.body?.cancel().catch(() => {});
			return;
		}
		const token = await result.res.json();
		if (device.refresh_token && token?.refresh_token == null) token.refresh_token = device.refresh_token;
		if (!validDeviceToken(token) || typeof token.account_id !== 'string' || !token.account_id || (device.account_id && token.account_id !== device.account_id)) return;
		return {
			...token,
			auth_type: 'android',
			device_id: device.device_id,
			device_name: device.device_name,
			device_type: device.device_type,
			device_user_agent: userAgent,
			expires: new Date(Date.now() + token.expires_in * 1000)
		};
	} finally {
		form.delete('code');
		form.delete('code_verifier');
		form.delete('refresh_token');
	}
}

export async function loginWithPhone(request: Req['getData'], dryRun = false): Promise<CrunchySession | 'dry-run' | undefined> {
	const client = phoneClient();
	const webProfile = firefoxWebAuthProfile();
	if (dryRun) {
		process.stdout.write('Dry run: the Crunchyroll sign-in window would open.\n');
		if (webProfile) process.stdout.write(`Sign-in window User-Agent: ${webProfile.userAgent}\n`);
		return 'dry-run';
	}
	const executable = await resolvePhoneRuntime();
	const verifier = randomBytes(32).toString('base64url');
	const state = JSON.stringify({ flow: 'SIGN_IN', flowRoot: randomUUID() });
	const authorize = new URL('/en/authorize', ssoOrigin);
	authorize.search = new URLSearchParams({
		client_id: client.id,
		redirect_uri: new URL(callbackPath, ssoOrigin).href,
		scope: 'offline_access',
		code_challenge: verifier,
		code_challenge_method: 'plain',
		response_type: 'code',
		state
	}).toString();
	process.stdout.write('Use the Crunchyroll window to sign in.\n');
	const tracePath = phoneWindowEnvironment().ANIDL_CRUNCHY_PHONE_TRACE;
	const trace =
		tracePath && isAbsolute(tracePath)
			? (event: string, status?: number) => {
					try {
						appendFileSync(tracePath, `${JSON.stringify({ at: Date.now(), event, status })}\n`, { mode: 0o600 });
					} catch {
						// A diagnostic write must not interrupt sign-in.
					}
				}
			: undefined;
	const result = await readSignInWindow(executable, authorize, { userAgent: webProfile?.userAgent });
	if (!result) {
		trace?.('cli.cancelled');
		return;
	}
	const [callback, deviceId] = result;
	const code = parsePhoneCallback(callback, state);
	trace?.(code ? 'cli.callback-validated' : 'cli.callback-rejected');
	if (!code) throw new Error(PHONE_WEBVIEW_FAILED);
	const exchange: Req['getData'] = trace
		? async (url, options) => {
				trace('cli.token-request');
				try {
					const result = await request(url, options);
					const status = result.res?.status;
					trace(typeof status === 'number' ? 'cli.token-result' : 'cli.token-no-response', status);
					return result;
				} catch (error) {
					trace('cli.token-error');
					throw error;
				}
			}
		: request;
	trace?.('cli.browser-device-selected');
	return exchangePhoneToken(
		exchange,
		{ grant_type: 'authorization_code', code, code_verifier: verifier },
		{
			device_id: deviceId,
			device_name: `Android Phone (${deviceId.slice(-4)})`,
			device_type: 'Android Phone'
		}
	);
}

export function refreshPhoneToken(request: Req['getData'], session: CrunchySession, onRejected?: () => void): Promise<CrunchySession | undefined> {
	if (!['refresh_token', 'account_id', 'device_id', 'device_name', 'device_type'].every((key) => typeof session[key] === 'string' && session[key])) {
		onRejected?.();
		return Promise.resolve(undefined);
	}
	return exchangePhoneToken(request, { grant_type: 'refresh_token', refresh_token: session.refresh_token }, session, onRejected);
}
