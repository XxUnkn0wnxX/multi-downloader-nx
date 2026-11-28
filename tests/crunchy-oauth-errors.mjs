import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import output from 'node:console';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const { atob, TextDecoder, Response, AbortController, setTimeout, clearTimeout, setInterval, clearInterval } = globalThis;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'modules/module.crunchy-device-auth.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(code, {
	module,
	exports: module.exports,
	require: () => ({ crunchyLoginInstruction: () => 'sign in again' }),
	atob,
	TextDecoder,
	AbortController,
	setTimeout,
	clearTimeout,
	setInterval,
	clearInterval
});
const { classifyOAuthError, validBasicClient, requestDeviceToken, CR_BASIC_REJECTED } = module.exports;

assert(validBasicClient(Buffer.from('fixture-client:fixture-secret').toString('base64')));
for (const value of ['', '!', Buffer.from('missing-separator').toString('base64'), Buffer.from('client:').toString('base64'), undefined])
	assert.equal(validBasicClient(value), false);
assert(validBasicClient(Buffer.from('web-client:').toString('base64'), true));
for (const status of [400, 401]) {
	for (const code of ['invalid_client', 'invalid_grant', 'invalid_refresh_token']) assert.equal(await classifyOAuthError(Response.json({ error: code }, { status })), code);
}
assert.equal(await classifyOAuthError(Response.json({ error: 'invalid_client' }, { status: 403 })), undefined);
assert.equal(await classifyOAuthError(new Response('<html>challenge</html>', { status: 401 })), undefined);
assert.equal(await classifyOAuthError(new Response(JSON.stringify({ error: 'invalid_client', padding: 'x'.repeat(8192) }), { status: 400 })), undefined);

for (const stage of ['code', 'token']) {
	const messages = [];
	const requests = [];
	const result = await requestDeviceToken({
		request: async (url, options) => {
			requests.push(options);
			if (url.endsWith('/code') && stage === 'token') return { ok: true, res: Response.json({ user_code: 'TEST', device_code: 'fixture', expires_in: 10, interval: 1 }) };
			return { ok: false, res: Response.json({ error: 'invalid_client', error_description: 'fixture-secret' }, { status: 401 }) };
		},
		authUrl: 'https://example.invalid/auth/v1/token',
		headers: { Authorization: 'Basic fixture-secret' },
		deviceId: 'fixture',
		signal: new AbortController().signal,
		debug: true,
		log: (message) => messages.push(message),
		sleep: async () => {}
	});
	assert.equal(result, undefined);
	assert(messages.some((message) => message.includes(CR_BASIC_REJECTED)));
	assert(messages.every((line) => !line.includes('fixture-secret')));
	assert(requests.every((options) => options.quietDebug === true));
}
for (const debug of [false, true]) {
	const messages = [];
	let calls = 0;
	await requestDeviceToken({
		request: async () =>
			++calls === 1
				? { ok: false, res: new Response('<html>Cloudflare challenge</html>', { status: 403 }) }
				: { ok: false, res: Response.json({ error: 'invalid_grant', error_description: 'fixture-basic fixture-secret' }, { status: 400 }) },
		authUrl: 'https://example.invalid/auth/v1/token',
		fallbackAuthUrl: 'https://fallback.invalid/auth/v1/token',
		headers: { Authorization: 'Basic fixture-basic' },
		deviceId: 'fixture',
		signal: new AbortController().signal,
		debug,
		log: (message) => messages.push(message)
	});
	assert.equal(calls, 2);
	assert(messages.some((message) => message.includes('HTTP 400 invalid_grant')));
	assert(messages.every((message) => !/fixture-basic|fixture-secret/.test(message)));
}
output.log('Crunchyroll OAuth error fixtures passed');
