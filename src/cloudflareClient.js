const https = require('https');

const MAX_RESPONSE_BYTES = 1024 * 1024;

function clientError(message, code, statusCode) {

	const error = new Error(message);
	error.code = code;
	if (statusCode !== undefined) {
		error.statusCode = statusCode;
	}
	return error;

}

function retryAfterMilliseconds(value) {

	if (typeof value !== 'string' || !value.trim()) {
		return undefined;
	}
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return seconds * 1000;
	}
	const date = Date.parse(value);
	return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;

}

function httpError(statusCode, headers) {

	let message = `Cloudflare request failed (HTTP ${statusCode}).`;
	if (statusCode === 401) {
		message = 'Cloudflare rejected the credentials. Set a valid API token or check your API key and email.';
	} else if (statusCode === 403) {
		message = 'Cloudflare denied access. Check that your token can access this zone and has permission for this action.';
	} else if (statusCode === 404) {
		message = 'Cloudflare could not find this zone. Check the zone ID and your token’s zone access.';
	} else if (statusCode === 429) {
		message = 'Cloudflare is rate limiting requests. Wait before trying again.';
	} else if (statusCode >= 500) {
		message = 'Cloudflare is temporarily unavailable. Try again later.';
	}
	const error = clientError(message, 'HTTP_ERROR', statusCode);
	const retryAfterMs = retryAfterMilliseconds(headers && headers['retry-after']);
	if (retryAfterMs !== undefined) {
		error.retryAfterMs = retryAfterMs;
	}
	return error;

}

function createCloudflareClient({ httpsModule = https, timeoutMs = 15000 } = {}) {

	const active = new Set();
	let disposed = false;

	function request({ zoneId, credentials, method, endpoint, body }) {

		let resolvePromise;
		let rejectPromise;
		const promise = new Promise((resolve, reject) => {
			resolvePromise = resolve;
			rejectPromise = reject;
		});
		let settled = false;
		let nodeRequest;
		let response;
		let timer;

		function finish(error, result) {

			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			active.delete(cancel);
			if (error) {
				rejectPromise(error);
			} else {
				resolvePromise(result);
			}

		}

		function abort(error) {

			if (settled) {
				return;
			}
			finish(error);
			if (response) {
				response.destroy();
			}
			if (nodeRequest) {
				nodeRequest.destroy();
			}

		}

		function cancel() {

			abort(clientError('Cloudflare request cancelled.', 'CANCELLED'));

		}

		const handle = { promise, cancel };
		if (disposed) {
			cancel();
			return handle;
		}

		try {
			if (typeof zoneId !== 'string' || !/^[a-f0-9]{32}$/i.test(zoneId)) {
				throw clientError('Enter a valid Cloudflare zone ID (32 hexadecimal characters) in the extension settings.', 'CONFIGURATION');
			}
			const validAction = (endpoint === '/settings/development_mode' && (method === 'GET' || method === 'PATCH')) ||
				(endpoint === '/purge_cache' && method === 'POST');
			if (!validAction) {
				throw clientError('Unsupported Cloudflare action.', 'CONFIGURATION');
			}
			const headers = { Accept: 'application/json' };
			if (credentials && typeof credentials.token === 'string' && credentials.token.trim()) {
				headers.Authorization = `Bearer ${credentials.token.trim()}`;
			} else if (credentials && typeof credentials.key === 'string' && credentials.key.trim() &&
				typeof credentials.email === 'string' && credentials.email.trim()) {
				headers['X-Auth-Key'] = credentials.key.trim();
				headers['X-Auth-Email'] = credentials.email.trim();
			} else {
				throw clientError('Set a Cloudflare API token, or provide both a legacy API key and email in the extension settings.', 'CONFIGURATION');
			}
			const payload = body === undefined ? undefined : JSON.stringify(body);
			if (payload !== undefined) {
				headers['Content-Type'] = 'application/json';
				headers['Content-Length'] = Buffer.byteLength(payload);
			}
			active.add(cancel);
			timer = setTimeout(() => {
				abort(clientError('Cloudflare did not respond in time. Check your connection and try again.', 'TIMEOUT'));
			}, timeoutMs);
			nodeRequest = httpsModule.request({
				hostname: 'api.cloudflare.com',
				port: 443,
				path: `/client/v4/zones/${zoneId}${endpoint}`,
				method,
				headers
			}, (res) => {
				response = res;
				if (settled) {
					res.destroy();
					return;
				}
				let size = 0;
				const chunks = [];
				res.on('data', (chunk) => {
					if (settled) {
						return;
					}
					const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
					size += buffer.length;
					if (size > MAX_RESPONSE_BYTES) {
						abort(clientError('Cloudflare returned an unexpectedly large response. Try again later.', 'INVALID_RESPONSE', res.statusCode));
						return;
					}
					chunks.push(buffer);
				});
				res.on('error', () => {
					abort(clientError('The connection to Cloudflare was interrupted. Try again.', 'NETWORK'));
				});
				res.on('aborted', () => {
					abort(clientError('The connection to Cloudflare was interrupted. Try again.', 'NETWORK'));
				});
				res.on('end', () => {
					if (settled) {
						return;
					}
					if (res.statusCode < 200 || res.statusCode >= 300) {
						finish(httpError(res.statusCode, res.headers));
						return;
					}
					let envelope;
					try {
						envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
					} catch {
						finish(clientError('Cloudflare returned an unreadable response. Try again later.', 'INVALID_RESPONSE', res.statusCode));
						return;
					}
					if (!envelope || typeof envelope !== 'object' || typeof envelope.success !== 'boolean') {
						finish(clientError('Cloudflare returned an unexpected response. Try again later.', 'INVALID_RESPONSE', res.statusCode));
					} else if (!envelope.success) {
						finish(clientError('Cloudflare rejected the request. Check your zone and the API token’s permissions.', 'API_ERROR', res.statusCode));
					} else if (!Object.prototype.hasOwnProperty.call(envelope, 'result')) {
						finish(clientError('Cloudflare returned an incomplete response. Try again later.', 'INVALID_RESPONSE', res.statusCode));
					} else {
						finish(undefined, envelope.result);
					}
				});
			});
			nodeRequest.on('error', () => {
				abort(clientError('Could not connect to Cloudflare. Check your connection and try again.', 'NETWORK'));
			});
			nodeRequest.end(payload);
		} catch (error) {
			abort(error.code === 'CONFIGURATION' ? error : clientError('Could not start the Cloudflare request. Check your connection settings and credentials.', 'REQUEST_ERROR'));
		}
		return handle;

	}

	function dispose() {

		disposed = true;
		for (const cancel of active) {
			cancel();
		}

	}

	return { request, dispose };

}

module.exports = { createCloudflareClient };
