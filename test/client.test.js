const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { createCloudflareClient } = require('../src/cloudflareClient');

const zoneId = 'a'.repeat(32);
const action = { zoneId, credentials: { token: 'secret-token' }, method: 'GET', endpoint: '/settings/development_mode' };

function transport() {

	const requests = [];
	return {
		requests,
		request(options, callback) {
			const req = new EventEmitter();
			req.destroyed = false;
			req.destroy = () => { req.destroyed = true; };
			req.end = (payload) => { req.payload = payload; };
			req.options = options;
			req.respond = (body, statusCode = 200, headers = {}) => {
				const res = new EventEmitter();
				res.statusCode = statusCode;
				res.headers = headers;
				res.destroy = () => { res.destroyed = true; };
				req.response = res;
				callback(res);
				if (body !== undefined) {
					res.emit('data', Buffer.from(body));
					res.emit('end');
				}
				return res;
			};
			requests.push(req);
			return req;
		}
	};

}

test('uses token authentication and resolves a successful Cloudflare result', async () => {

	const httpsModule = transport();
	const client = createCloudflareClient({ httpsModule });
	const request = client.request(action);
	const req = httpsModule.requests[0];
	assert.equal(req.options.hostname, 'api.cloudflare.com');
	assert.equal(req.options.path, `/client/v4/zones/${zoneId}/settings/development_mode`);
	assert.equal(req.options.headers.Authorization, 'Bearer secret-token');
	assert.equal(req.options.headers['X-Auth-Key'], undefined);
	req.respond(JSON.stringify({ success: true, result: { value: 'on', time_remaining: 180 } }));
	assert.deepEqual(await request.promise, { value: 'on', time_remaining: 180 });
	client.dispose();
	assert.equal(req.destroyed, false);

});

test('supports legacy authentication and sends a correctly sized JSON body', async () => {

	const httpsModule = transport();
	const client = createCloudflareClient({ httpsModule });
	const request = client.request({ ...action, credentials: { key: 'legacy-key', email: 'person@example.invalid' }, method: 'PATCH', body: { value: 'on' } });
	const req = httpsModule.requests[0];
	assert.equal(req.options.headers['X-Auth-Key'], 'legacy-key');
	assert.equal(req.options.headers['X-Auth-Email'], 'person@example.invalid');
	assert.equal(req.options.headers.Authorization, undefined);
	assert.equal(req.payload, '{"value":"on"}');
	assert.equal(req.options.headers['Content-Length'], Buffer.byteLength(req.payload));
	req.respond('{"success":true,"result":{"value":"on"}}');
	await request.promise;

});

test('validates configuration before sending a request', async () => {

	const httpsModule = transport();
	const client = createCloudflareClient({ httpsModule });
	for (const changes of [{ zoneId: '../another-zone' }, { credentials: {} }, { credentials: { key: 'only-key' } }, { endpoint: '/unknown' }, { method: 'DELETE' }]) {
		await assert.rejects(client.request({ ...action, ...changes }).promise, { code: 'CONFIGURATION' });
	}
	assert.equal(httpsModule.requests.length, 0);

});

test('handles malformed JSON, missing fields and success false without trusting HTTP 200', async () => {

	for (const [body, code] of [
		['<html>Proxy error</html>', 'INVALID_RESPONSE'],
		['null', 'INVALID_RESPONSE'],
		['{"result":{}}', 'INVALID_RESPONSE'],
		['{"success":true}', 'INVALID_RESPONSE'],
		['{"success":false,"errors":[{"message":"no access"}]}', 'API_ERROR']
	]) {
		const httpsModule = transport();
		const client = createCloudflareClient({ httpsModule });
		const request = client.request(action);
		httpsModule.requests[0].respond(body);
		await assert.rejects(request.promise, { code, statusCode: 200 });
	}

});

test('returns useful HTTP errors even for non-JSON error responses', async () => {

	for (const [statusCode, message] of [[401, /credentials/], [403, /permission/], [404, /zone/], [429, /rate limiting/], [503, /temporarily unavailable/]]) {
		const httpsModule = transport();
		const request = createCloudflareClient({ httpsModule }).request(action);
		httpsModule.requests[0].respond('<html>Error</html>', statusCode, { 'retry-after': '30' });
		await assert.rejects(request.promise, (error) => {
			assert.equal(error.code, 'HTTP_ERROR');
			assert.equal(error.statusCode, statusCode);
			assert.equal(error.retryAfterMs, 30000);
			assert.match(error.message, message);
			assert.doesNotMatch(error.message, /secret-token/);
			return true;
		});
	}

});

test('accepts Retry-After dates and ignores invalid Retry-After values', async () => {

	for (const value of [new Date(Date.now() + 60000).toUTCString(), 'invalid']) {
		const httpsModule = transport();
		const request = createCloudflareClient({ httpsModule }).request(action);
		httpsModule.requests[0].respond('', 429, { 'retry-after': value });
		await assert.rejects(request.promise, (error) => {
			if (value === 'invalid') {
				assert.equal(error.retryAfterMs, undefined);
			} else {
				assert.ok(error.retryAfterMs > 58000 && error.retryAfterMs <= 60000);
			}
			return true;
		});
	}

});

test('cancels requests and ignores late responses', async () => {

	const httpsModule = transport();
	const request = createCloudflareClient({ httpsModule }).request(action);
	request.cancel();
	await assert.rejects(request.promise, { code: 'CANCELLED' });
	assert.equal(httpsModule.requests[0].destroyed, true);
	const response = httpsModule.requests[0].respond('{"success":true,"result":{}}');
	assert.equal(response.destroyed, true);
	request.cancel();

});

test('disposal cancels every active request and rejects new work', async () => {

	const httpsModule = transport();
	const client = createCloudflareClient({ httpsModule });
	const first = client.request(action);
	const second = client.request(action);
	client.dispose();
	await assert.rejects(first.promise, { code: 'CANCELLED' });
	await assert.rejects(second.promise, { code: 'CANCELLED' });
	await assert.rejects(client.request(action).promise, { code: 'CANCELLED' });
	assert.equal(httpsModule.requests.length, 2);
	assert.ok(httpsModule.requests.every((req) => req.destroyed));

});

test('a total deadline aborts a response that never finishes', async () => {

	const httpsModule = transport();
	const request = createCloudflareClient({ httpsModule, timeoutMs: 10 }).request(action);
	const response = httpsModule.requests[0].respond(undefined);
	response.emit('data', Buffer.from('{'));
	await assert.rejects(request.promise, { code: 'TIMEOUT' });
	assert.equal(httpsModule.requests[0].destroyed, true);
	assert.equal(response.destroyed, true);

});

test('rejects oversized responses and releases the connection', async () => {

	const httpsModule = transport();
	const request = createCloudflareClient({ httpsModule }).request(action);
	const response = httpsModule.requests[0].respond(undefined);
	response.emit('data', Buffer.alloc(1024 * 1024 + 1));
	await assert.rejects(request.promise, { code: 'INVALID_RESPONSE' });
	assert.equal(httpsModule.requests[0].destroyed, true);
	assert.equal(response.destroyed, true);

});

test('handles request failures and interrupted responses', async () => {

	for (const failure of ['request', 'response', 'aborted']) {
		const httpsModule = transport();
		const request = createCloudflareClient({ httpsModule }).request(action);
		const req = httpsModule.requests[0];
		if (failure === 'request') {
			req.emit('error', new Error('socket failure'));
		} else {
			const response = req.respond(undefined);
			response.emit(failure === 'response' ? 'error' : 'aborted', new Error('socket failure'));
		}
		await assert.rejects(request.promise, { code: 'NETWORK' });
		assert.equal(req.destroyed, true);
	}

});

test('normalizes synchronous transport failures without exposing credentials', async () => {

	const httpsModule = { request() { throw new Error('secret-token'); } };
	const request = createCloudflareClient({ httpsModule }).request(action);
	await assert.rejects(request.promise, (error) => {
		assert.equal(error.code, 'REQUEST_ERROR');
		assert.doesNotMatch(error.message, /secret-token/);
		return true;
	});

});
