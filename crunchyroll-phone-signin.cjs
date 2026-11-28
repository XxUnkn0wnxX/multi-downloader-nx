/* global Buffer, process, require, setImmediate, URL */
/* eslint-disable @typescript-eslint/no-require-imports -- Electron launches this standalone CommonJS helper. */
const { app, BrowserWindow, session } = require('electron');
const { appendFileSync } = require('node:fs');
const { isAbsolute } = require('node:path');
const { createInterface } = require('node:readline');

const origin = 'https://sso.crunchyroll.com';
const webOrigins = new Set(['https://www.crunchyroll.com', 'https://crunchyroll.com']);
const callbackPath = '/android/oauth-callback';
const browserDevicePattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

const header = (headers, name) => Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];

function readBrowserCookie(pairs, name) {
	const prefix = `${name}=`;
	const matches = pairs.map((pair) => pair.trim()).filter((pair) => pair.startsWith(prefix));
	const value = matches[0]?.slice(prefix.length).replace(/^"(.*)"$/, '$1');
	if (matches.length === 1 && browserDevicePattern.test(value)) return value;
}

function createTrace(file) {
	const knownOrigins = [origin, 'https://www.crunchyroll.com', 'https://crunchyroll.com', 'https://api.crunchyroll.com', 'https://beta.crunchyroll.com'];
	const knownSegments = new Set([
		'',
		'en',
		'android',
		'oauth-callback',
		'authorize',
		'api',
		'auth',
		'oauth',
		'oauth2',
		'v1',
		'v2',
		'v3',
		'account',
		'accounts',
		'session',
		'sessions',
		'device',
		'devices',
		'activate',
		'deactivate',
		'login',
		'log-in',
		'signin',
		'sign-in',
		'logout',
		'log-out',
		'token',
		'callback',
		'sso',
		'me',
		'profile',
		'verify'
	]);
	const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']);
	const labels = new Map();
	const label = (value) => {
		if (!labels.has(value)) labels.set(value, `<${labels.size + 1}>`);
		return labels.get(value);
	};
	function safeUrl(address, base) {
		try {
			const url = new URL(address, base);
			if (!['http:', 'https:'].includes(url.protocol)) return '<non-http>';
			if (!knownOrigins.includes(url.origin)) return `external-${label(url.origin)}/${label(url.pathname)}`;
			const segments = url.pathname.split('/');
			const path = segments
				.slice(0, 16)
				.map((segment) => (knownSegments.has(segment) ? segment : label(segment)))
				.join('/');
			return url.origin + path + (segments.length > 16 ? '/<omitted>' : '');
		} catch {
			return '<invalid-url>';
		}
	}
	let count = 0;
	return (event, details, extra) => {
		if (count > 2_000) return;
		const record = { at: Date.now(), event, ...extra };
		if (details) {
			record.id = details.id;
			record.method = methods.has(details.method) ? details.method : 'OTHER';
			record.resource = details.resourceType;
			record.url = safeUrl(details.url);
			const firstParty = knownOrigins.some((host) => record.url.startsWith(`${host}/`));
			if (Number.isInteger(details.statusCode)) record.status = details.statusCode;
			if (event === 'web.sent') {
				const cookie = header(details.requestHeaders, 'cookie');
				record.hasCookie = cookie !== undefined;
				if (firstParty) {
					record.hasDeviceCookie = /(?:^|;\s*)device_id=/.test(cookie ?? '');
					record.hasSessionCookie = /(?:^|;\s*)etp_rt=/.test(cookie ?? '');
				}
			}
			if (event === 'web.response') {
				const cookies = header(details.responseHeaders, 'set-cookie');
				record.setsCookie = cookies !== undefined;
				if (firstParty) {
					record.setsDeviceCookie = cookies?.some((cookie) => cookie.startsWith('device_id=')) ?? false;
					record.setsSessionCookie = cookies?.some((cookie) => cookie.startsWith('etp_rt=')) ?? false;
				}
				const location = header(details.responseHeaders, 'location')?.[0];
				if (location) record.redirect = safeUrl(location, details.url);
			}
			if (event === 'web.error' && /^net::ERR_[A-Z0-9_]+$/.test(details.error)) record.error = details.error;
		}
		try {
			const line = count++ === 2_000 ? { at: record.at, event: 'web.trace-limit' } : record;
			appendFileSync(file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
		} catch {
			count = 2_001;
		}
	};
}

function ssoUrl(address) {
	try {
		const url = new URL(address);
		if (url.origin === origin && !url.username && !url.password) return url;
	} catch {
		return;
	}
}

async function readSignInInput(web) {
	const input = createInterface({ input: process.stdin, terminal: false });
	try {
		let url;
		let userAgent;
		for await (const line of input) {
			if (Buffer.byteLength(line) > 8192) return;
			if (!url) {
				url = ssoUrl(line);
				if (web ? url?.href !== `${origin}/login` : url?.pathname !== '/en/authorize' || url.href.includes('#')) return;
			} else {
				if (userAgent || !/^Mozilla\/5\.0 \([\w.; ]{1,96}; rv:\d+\.0\) Gecko\/20100101 Firefox\/\d+\.0$/.test(line)) return;
				userAgent = line;
			}
		}
		if (url) return { url, userAgent };
	} finally {
		input.close();
	}
}

function watchWebCookies(finish, trace) {
	const authorizePath = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?authorize$/i;
	let loginResponseSeen = false;
	let loginIssuedCookies = false;
	let sessionCookies;
	let authorization;
	return {
		sent(details, url) {
			if (!loginResponseSeen || !url || !authorizePath.test(url.pathname) || details.method !== 'GET' || details.resourceType !== 'mainFrame') return;
			const sent = (header(details.requestHeaders, 'cookie') ?? '').split(';');
			const deviceId = readBrowserCookie(sent, 'device_id');
			const refreshToken = readBrowserCookie(sent, 'etp_rt');
			const bound = sessionCookies && deviceId === sessionCookies.deviceId && refreshToken === sessionCookies.refreshToken;
			authorization = { id: details.id, bound };
			if (bound) trace?.('web.session-cookies-carried');
		},
		received(details, url) {
			if (!url) return false;
			const pairs = (header(details.responseHeaders, 'set-cookie') ?? []).map((cookie) => cookie.split(';', 1)[0].trim());
			const setsDevice = pairs.some((pair) => pair.startsWith('device_id='));
			const setsSession = pairs.some((pair) => pair.startsWith('etp_rt='));
			if (url.pathname === '/api/login' && details.method === 'POST' && details.statusCode === 200) {
				loginResponseSeen = true;
				if (setsDevice || setsSession) {
					const deviceId = readBrowserCookie(pairs, 'device_id');
					const refreshToken = readBrowserCookie(pairs, 'etp_rt');
					sessionCookies = !loginIssuedCookies && deviceId && refreshToken ? { deviceId, refreshToken } : undefined;
					loginIssuedCookies = true;
					authorization = undefined;
					if (sessionCookies) trace?.('web.session-cookies-issued');
				}
				return false;
			}
			if (!authorizePath.test(url.pathname) || details.id !== authorization?.id) return false;
			if (!authorization.bound || !sessionCookies) {
				trace?.('web.session-cookies-unverified');
				finish(4);
				return true;
			}
			const location = header(details.responseHeaders, 'location')?.[0];
			const { deviceId } = sessionCookies;
			const refreshToken = setsSession ? readBrowserCookie(pairs, 'etp_rt') : sessionCookies.refreshToken;
			if ((setsDevice && readBrowserCookie(pairs, 'device_id') !== deviceId) || !refreshToken) {
				trace?.('web.session-cookies-unverified');
				finish(4);
				return true;
			}
			if (location && [301, 302, 303, 307, 308].includes(details.statusCode)) {
				const target = URL.parse(location, url);
				if (target && !target.username && !target.password && webOrigins.has(target.origin)) {
					trace?.('web.session-cookies-verified');
					finish(0, `${refreshToken}\n${deviceId}\n`);
					return true;
				}
				if (target && ssoUrl(target.href) && authorizePath.test(target.pathname)) {
					sessionCookies = { deviceId, refreshToken };
					return false;
				}
			}
			trace?.('web.session-cookies-unverified');
			finish(4);
			return true;
		}
	};
}

async function main() {
	const profile = process.argv[2];
	const web = process.argv.includes('--web-sign-in');
	if (!profile || !isAbsolute(profile)) return app.exit(3);
	app.setPath('userData', profile);
	app.setPath('sessionData', profile);
	app.enableSandbox();
	const signIn = await readSignInInput(web);
	if (!signIn) return app.exit(3);

	await app.whenReady();
	const signInSession = session.fromPartition('anidl-phone-signin');
	if (signIn.userAgent) signInSession.setUserAgent(signIn.userAgent);
	const traceFile = process.env.ANIDL_CRUNCHY_PHONE_TRACE;
	const trace = traceFile && isAbsolute(traceFile) ? createTrace(traceFile) : undefined;
	trace?.('web.start');
	try {
		await signInSession.cookies.set({ url: origin, name: 'c_locale', value: 'en-US', domain: '.crunchyroll.com', path: '/', secure: true });
		trace?.('web.locale-prepared');
	} catch {
		trace?.('web.locale-unavailable');
	}
	signInSession.setPermissionCheckHandler(() => false);
	signInSession.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
	signInSession.on('will-download', (event) => event.preventDefault());

	const window = new BrowserWindow({
		width: 620,
		height: 680,
		title: 'Crunchyroll sign-in',
		autoHideMenuBar: true,
		webPreferences: {
			session: signInSession,
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			webSecurity: true,
			devTools: false
		}
	});
	let finished = false;
	let loginResponseSeen = false;
	let issuedDeviceId;
	let boundAuthorizeId;
	let boundCallback;
	function finish(status, output) {
		if (finished) return;
		finished = true;
		trace?.('web.finish', undefined, { status });
		if (output) process.stdout.write(output, () => app.exit(status));
		else setImmediate(() => app.exit(status));
	}

	function allowNavigation(address, mainFrame, canReturnCallback) {
		const url = ssoUrl(address);
		if (web) return !mainFrame || (!!url && url.pathname !== callbackPath);
		if (url?.pathname === callbackPath) {
			trace?.(mainFrame && canReturnCallback ? 'web.callback-intercepted' : 'web.callback-blocked');
			if (mainFrame && canReturnCallback) {
				if (url.href.includes('#') || Buffer.byteLength(url.href) > 8192) finish(3);
				else {
					const verified = issuedDeviceId && boundCallback === url.href;
					trace?.(verified ? 'web.browser-device-verified' : 'web.browser-device-unverified');
					if (verified) finish(0, `${url.href}\n${issuedDeviceId}\n`);
					else finish(4);
				}
			}
			return false;
		}
		return !mainFrame || !!url;
	}

	const contents = window.webContents;
	contents.setWindowOpenHandler(() => ({ action: 'deny' }));
	const guardNavigation = (event) => {
		if (!allowNavigation(event.url, event.isMainFrame, !event.initiator?.parent)) event.preventDefault();
	};
	contents.on('will-frame-navigate', guardNavigation);
	contents.on('will-redirect', guardNavigation);
	contents.on('dom-ready', () => {
		if (ssoUrl(contents.getURL())) {
			void contents.insertCSS('#onetrust-banner-sdk { display: none !important; }', { cssOrigin: 'user' }).catch(() => {});
		}
	});
	const requests = signInSession.webRequest;
	const webCookies = web ? watchWebCookies(finish, trace) : undefined;
	requests.onBeforeRequest((request, reply) => {
		const allowed = allowNavigation(request.url, request.resourceType === 'mainFrame', request.webContentsId === contents.id);
		trace?.('web.request', request, { blocked: !allowed });
		reply({ cancel: !allowed });
	});
	requests.onSendHeaders((details) => {
		const url = details.webContentsId === contents.id && ssoUrl(details.url);
		if (webCookies) webCookies.sent(details, url);
		else if (url?.pathname === '/authorize' && details.resourceType === 'mainFrame' && details.method === 'GET') {
			const sent = readBrowserCookie((header(details.requestHeaders, 'cookie') ?? '').split(';'), 'device_id');
			boundAuthorizeId = sent && sent === issuedDeviceId ? details.id : undefined;
			boundCallback = undefined;
			if (boundAuthorizeId !== undefined) trace?.('web.browser-device-carried');
		}
		trace?.('web.sent', details);
	});
	requests.onHeadersReceived((details, reply) => {
		const url = details.webContentsId === contents.id && ssoUrl(details.url);
		if (webCookies) {
			trace?.('web.response', details);
			reply({ cancel: webCookies.received(details, url) });
			return;
		}
		if (url?.pathname === '/api/login' && details.method === 'POST' && details.statusCode === 200) {
			const cookies = header(details.responseHeaders, 'set-cookie') ?? [];
			issuedDeviceId = loginResponseSeen
				? undefined
				: readBrowserCookie(
						cookies.map((cookie) => cookie.split(';', 1)[0]),
						'device_id'
					);
			loginResponseSeen = true;
			boundAuthorizeId = undefined;
			boundCallback = undefined;
			if (issuedDeviceId) trace?.('web.browser-device-issued');
		} else if (url && issuedDeviceId && header(details.responseHeaders, 'set-cookie')?.some((cookie) => cookie.trim().startsWith('device_id='))) {
			issuedDeviceId = undefined;
			boundAuthorizeId = undefined;
			boundCallback = undefined;
			trace?.('web.browser-device-reissued');
		}
		if (url?.pathname === '/authorize' && details.id === boundAuthorizeId && details.statusCode >= 300 && details.statusCode < 400) {
			const location = header(details.responseHeaders, 'location')?.[0];
			try {
				const target = location && ssoUrl(new URL(location, details.url).href);
				if (target?.pathname === callbackPath) boundCallback = target.href;
			} catch {
				// An invalid Location cannot prove which request led to the callback.
			}
		}
		trace?.('web.response', details);
		reply({});
	});
	if (trace) {
		requests.onCompleted((details) => trace('web.completed', details));
		requests.onErrorOccurred((details) => trace('web.error', details));
	}
	contents.once('render-process-gone', () => finish(3));
	window.once('closed', () => finish(2));
	await contents.loadURL(signIn.url.href).catch(() => finish(3));
}

main().catch(() => app.exit(3));
