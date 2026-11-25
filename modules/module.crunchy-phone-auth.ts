import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { parse } from 'dotenv';
import { domain } from './module.api-urls';
import { workingDir } from './module.cfg-loader';
import { validDeviceToken } from './module.crunchy-device-auth';
import type { Req } from './module.fetch';
import type { CrunchySession } from './module.crunchy-session-store';

const ssoOrigin = 'https://sso.crunchyroll.com';
const callbackPath = '/android/oauth-callback';
const inputTimeoutMs = 10 * 60_000;
const userAgent = 'Crunchyroll/3.130.0 Android/16 okhttp/5.3.2';

const idKey = 'CRUNCHYROLL_PHONE_CLIENT_ID';
const secretKey = 'CRUNCHYROLL_PHONE_CLIENT_SECRET';
export const PHONE_CLIENT_REQUIRED = 'Configure CRUNCHYROLL_PHONE_CLIENT_ID and CRUNCHYROLL_PHONE_CLIENT_SECRET for Android phone sign-in.';

function phoneClient() {
	let id = process.env[idKey];
	let secret = process.env[secretKey];
	if (!id && !secret) {
		const file = path.join(workingDir, 'config', 'cr_phone_client.env');
		try {
			const stat = fs.statSync(file);
			if (stat.isFile() && stat.size <= 16_384 && (process.platform === 'win32' || (stat.mode & 0o077) === 0)) {
				const client = parse(fs.readFileSync(file));
				id = client[idKey];
				secret = client[secretKey];
			}
		} catch {
			/* The fixed diagnostic below covers absent or inaccessible configuration. */
		}
	}
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
	if (callback.origin !== ssoOrigin || callback.pathname !== callbackPath || callback.username || callback.password || callback.hash) return;
	const states = callback.searchParams.getAll('state');
	const codes = callback.searchParams.getAll('code');
	if (states.length !== 1 || states[0] !== state || codes.length !== 1 || callback.searchParams.has('error') || !/^[!-~]{1,2048}$/.test(codes[0])) return;
	return codes[0];
}

async function readCallback(): Promise<string | undefined> {
	const hidden = new Writable({
		write(_chunk, _encoding, done) {
			done();
		}
	});
	const input = createInterface({ input: process.stdin, output: hidden, terminal: true, historySize: 0 });
	const close = () => input.close();
	input.once('SIGINT', close);
	process.once('SIGINT', close);
	process.once('SIGTERM', close);
	const timer = setTimeout(close, inputTimeoutMs);
	try {
		process.stdout.write('Paste the full callback URL and press Enter (input hidden): ');
		for await (const line of input) return line;
	} finally {
		clearTimeout(timer);
		close();
		process.removeListener('SIGINT', close);
		process.removeListener('SIGTERM', close);
		hidden.end();
		process.stdout.write('\n');
	}
}

async function exchangePhoneToken(request: Req['getData'], fields: Record<string, string>, device: CrunchySession): Promise<CrunchySession | undefined> {
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
			allowH2: true,
			useProxy: true,
			quietDebug: true,
			deferErrorBody: true,
			signal: AbortSignal.timeout(15_000)
		});
		if (!result.ok || !result.res) {
			await result.res?.body?.cancel().catch(() => {});
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

export async function loginWithPhone(request: Req['getData']): Promise<CrunchySession | undefined> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Android phone sign-in requires an interactive terminal.');
	const client = phoneClient();
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
	process.stdout.write(`Opening Crunchyroll sign-in in your browser…\nIf your browser didn’t open, open this link manually:\n${authorize.href}\n\n`);
	void import('open').then(({ default: open }) => open(authorize.href)).catch(() => {});
	const input = await readCallback();
	const code = input && parsePhoneCallback(input, state);
	if (!code) return;
	const deviceId = randomUUID();
	return exchangePhoneToken(
		request,
		{ grant_type: 'authorization_code', code, code_verifier: verifier },
		{
			device_id: deviceId,
			device_name: `Android Phone (${deviceId.slice(-4)})`,
			device_type: 'Android Phone'
		}
	);
}

export function refreshPhoneToken(request: Req['getData'], session: CrunchySession): Promise<CrunchySession | undefined> {
	if (!['refresh_token', 'account_id', 'device_id', 'device_name', 'device_type'].every((key) => typeof session[key] === 'string' && session[key])) {
		return Promise.resolve(undefined);
	}
	return exchangePhoneToken(request, { grant_type: 'refresh_token', refresh_token: session.refresh_token }, session);
}
