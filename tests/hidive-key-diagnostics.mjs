import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import output from 'node:console';
import { fileURLToPath, URL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { Response } from 'undici';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'hidive.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
const key = 'synthetic-api-key';
const secrets = [key, 'synthetic-password', 'synthetic-auth', 'synthetic-refresh'];
const notice = 'An AniDL maintainer needs to update hd_new_apiKey.';

function fixture(apiKey, responses, token = { authorisationToken: 'synthetic-auth', refreshToken: 'synthetic-refresh' }) {
	const logs = [];
	const requests = [];
	const saves = [];
	const waits = [];
	const fakeConsole = Object.fromEntries(
		['info', 'warn', 'error', 'debug'].map((name) => [name, (...args) => logs.push(args.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' '))])
	);
	const stubs = {
		'node:timers/promises': { setTimeout: async (milliseconds) => waits.push([milliseconds, requests.length]) },
		'./modules/log': { console: fakeConsole },
		'./modules/module.cfg-loader': { loadCfg: () => ({ cli: {} }), loadNewHDToken: () => token, saveNewHDToken: (value) => saves.push(value) },
		'./modules/module.api-urls': { api: { hd_new_api: 'https://hidive.invalid', hd_new_apiKey: apiKey, hd_new_version: 'test' } },
		'./modules/module.fetch': {
			Req: class {
				async getData(url, options) {
					requests.push({ url, ...options, headers: { ...options.headers } });
					// Model the shared transport's debug/error output if suppression is absent.
					if (!options.quietDebug) fakeConsole.debug(options, 'synthetic-password', key);
					assert(responses.length, 'Unexpected extra HIDIVE request');
					return responses.shift();
				}
			}
		}
	};
	const exports = {};
	const module = { exports };
	vm.runInNewContext(code, { exports, module, require: (id) => stubs[id] ?? {}, process, Buffer, URL }, { filename: 'hidive.ts' });
	return { service: new module.exports.default(true), logs, requests, saves, waits };
}
const failure = (status, body = '') => ({ ok: false, res: new Response(body, { status }) });
const success = (body = {}) => ({ ok: true, res: new Response(JSON.stringify(body)) });
const expired = () => failure(401, '{"error":"invalid_token"}');
const renewed = () => success({ authorisationToken: 'synthetic-renewed', refreshToken: 'synthetic-renewed-refresh' });
const paths = (f) => f.requests.map((request) => new URL(request.url).pathname);
const refresh = '/v2/token/refresh';
const guest = '/v2/login/guest/checkin';
const init = '/v1/init/';
const season = '/v4/example';

for (const missing of [undefined, '', '  ']) {
	const f = fixture(missing, []);
	assert.equal((await f.service.apiReq('/v2/login', { password: 'synthetic-password' })).ok, false);
	assert.deepEqual(f.logs, [notice]);
	assert.equal(f.requests.length, 0);
}
for (const [apiKey, responses, count] of [
	[undefined, [], 0],
	[key, [failure(401, '{"code":"invalid_api_key"}')], 1]
]) {
	const token = { authorisationToken: 'synthetic-auth', refreshToken: 'synthetic-refresh' };
	const f = fixture(apiKey, responses, token);
	assert.equal(await f.service.refreshToken(), 'invalid-api-key');
	assert.equal(f.requests.length, count);
	assert.equal(f.saves.length, 0);
	assert.deepEqual(token, { authorisationToken: 'synthetic-auth', refreshToken: 'synthetic-refresh' });
	assert.equal(f.logs.filter((line) => line === notice).length, 1);
	assert(!f.logs.some((line) => line.includes('reinitializing session')));
	assert(secrets.every((secret) => !f.logs.join('\n').includes(secret)));
}
{
	const f = fixture(key, [failure(401, '{"code":"invalid_session"}'), failure(403, '{"code":"invalid_api_key"}')]);
	assert.equal((await f.service.apiReq('/v4/example', '', 'auth', 'GET')).appKeyInvalid, true);
	assert.equal(f.requests.length, 2);
	assert.equal(f.saves.length, 0);
	assert.equal(f.logs.filter((line) => line === notice).length, 1);
	assert(!f.logs.some((line) => line.includes('reinitializing session') || line.includes('Failed to refresh token')));
}
{
	const f = fixture(undefined, [], {});
	assert.equal((await f.service.doAuth({ username: 'synthetic-user', password: 'synthetic-password' })).isOk, false);
	assert.equal(f.requests.length, 0);
	assert.equal(f.logs.filter((line) => line === notice).length, 1);
}
for (const [status, body] of [
	[403, '<html>challenge</html>'],
	[429, '{"error":"rate_limit"}'],
	[500, 'synthetic-api-key synthetic-password']
]) {
	const f = fixture(key, [failure(status, body)]);
	assert.equal((await f.service.apiReq('/v2/login', { password: 'synthetic-password' })).ok, false);
	assert(!f.logs.includes(notice), `HTTP ${status} must not be classified as a bad key`);
	assert.equal(f.requests[0].quietDebug, true);
	assert(secrets.every((secret) => !f.logs.join('\n').includes(secret)));
}
for (const body of ['{"code":"invalid_api_key"}', '{"error":"invalid_api_key"}', '{"error":{"code":"invalid_api_key"}}']) {
	const f = fixture(key, [failure(403, body)]);
	assert.equal((await f.service.apiReq('/v2/login')).ok, false);
	assert.equal(f.logs.filter((line) => line === notice).length, 1);
}
{
	const f = fixture(key, [failure(401, '{"code":"invalid_api_key"}')]);
	assert.equal((await f.service.apiReq('/v4/example', '', 'auth', 'GET')).ok, false);
	assert.equal(f.requests.length, 1);
	assert.deepEqual(f.waits, []);
	assert.equal(f.logs.filter((line) => line === notice).length, 1);
}
for (const status of [429, 500, 503]) {
	const f = fixture(key, [failure(status, '{"code":"invalid_api_key"}')]);
	await f.service.apiReq('/v2/login');
	assert(!f.logs.includes(notice));
}
for (const body of ['{"message":"invalid_api_key"}', '{"code":"invalid_session","message":"invalid_api_key"}', '{"code":"invalid_api_key_extra"}']) {
	const f = fixture(key, [failure(403, body)]);
	await f.service.apiReq('/v2/login');
	assert(!f.logs.includes(notice));
}
{
	const f = fixture(key, [expired(), renewed(), failure(403, 'synthetic-api-key synthetic-password')]);
	assert.equal((await f.service.apiReq('/v4/example', '', 'auth', 'GET')).ok, false);
	assert.deepEqual(paths(f), [season, refresh, season]);
	assert(f.requests.every((request) => request.quietDebug));
	assert(!f.logs.includes(notice));
	assert(secrets.every((secret) => !f.logs.join('\n').includes(secret)));
}
{
	const f = fixture(key, [expired(), renewed(), failure(401, '{"code":"invalid_api_key"}')]);
	assert.equal((await f.service.apiReq('/v4/example', '', 'auth', 'GET')).ok, false);
	assert.deepEqual(paths(f), [season, refresh, season]);
	assert.deepEqual(f.waits, []);
	assert.equal(f.logs.filter((line) => line === notice).length, 1);
}
{
	const f = fixture(key, [expired(), renewed(), success()]);
	assert.equal((await f.service.apiReq('/v4/example', '', 'auth', 'GET')).ok, true);
	assert.deepEqual(paths(f), [season, refresh, season]);
	assert.deepEqual(f.waits, []);
	assert.equal(f.requests[2].headers.Authorization, 'Bearer synthetic-renewed');
}
{
	const f = fixture(key, [{ ok: false, error: { message: 'synthetic-password synthetic-api-key' } }]);
	assert.equal((await f.service.apiReq('/v2/login')).ok, false);
	assert(!f.logs.includes(notice));
	assert(secrets.every((secret) => !f.logs.join('\n').includes(secret)));
}
// A second 401 can come from the refresh itself or from replaying the original request.
{
	const f = fixture(key, [expired(), expired(), expired(), expired(), expired(), renewed(), success()]);
	assert.equal((await f.service.apiReq(season, '', 'auth', 'GET')).ok, false);
	assert.deepEqual(paths(f), [season, refresh, refresh]);
	assert.deepEqual(f.waits, [[1000, 2]]);
	assert.equal(f.saves.length, 0);
	assert.equal(f.logs.filter((line) => line.includes('after two recovery attempts')).length, 1);
	assert.equal((await f.service.apiReq(season, '', 'auth', 'GET')).ok, true);
	assert.deepEqual(paths(f).slice(3), [season, refresh, refresh, season]);
	assert.deepEqual(f.waits, [
		[1000, 2],
		[1000, 5]
	]);
	assert.equal(f.requests[6].headers.Authorization, 'Bearer synthetic-renewed');
}
{
	const f = fixture(key, [expired(), renewed(), expired(), renewed(), expired()]);
	assert.equal((await f.service.apiReq(season, '', 'auth', 'GET')).ok, false);
	assert.deepEqual(paths(f), [season, refresh, season, refresh, season]);
	assert.deepEqual(f.waits, [[1000, 3]]);
}
for (const [method, endpoint, token] of [
	['refreshToken', refresh, undefined],
	['refreshToken', guest, {}],
	['doAnonymousAuth', guest, {}],
	['initSession', init, undefined]
]) {
	const f = fixture(key, [expired(), expired()], token);
	assert.equal(await f.service[method](), false);
	assert.deepEqual(paths(f), [endpoint, endpoint]);
	assert.deepEqual(f.waits, [[1000, 1]]);
	assert.equal(f.saves.length, 0);
}
{
	const f = fixture(key, [{ ok: false, error: { res: new Response('', { status: 401 }) } }, renewed(), success()]);
	assert.equal((await f.service.apiReq(season, '', 'both', 'GET')).ok, true);
	assert.deepEqual(paths(f), [season, refresh, season]);
	assert.equal(f.requests[2].headers.Authorization, 'Mixed synthetic-renewed synthetic-renewed-refresh');
	assert.deepEqual(f.waits, []);
}
{
	const f = fixture(key, [expired(), failure(500), success({ authentication: { authorisationToken: 'synthetic-reinitialized' } }), success()]);
	assert.equal((await f.service.apiReq(season, '', 'auth', 'GET')).ok, true);
	assert.deepEqual(paths(f), [season, refresh, init, season]);
	assert.deepEqual(f.waits, []);
	assert.equal(f.requests[3].headers.Authorization, 'Bearer synthetic-reinitialized');
}
output.log('HIDIVE key diagnostics and session recovery passed');
