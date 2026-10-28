const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createController, TOKEN_KEY } = require('../src/controller');

const ZONE_A = 'a'.repeat(32);
const ZONE_B = 'b'.repeat(32);

async function flush() {
	for (let index = 0; index < 10; index += 1) { await Promise.resolve(); }
}

function fixture({ polling = true, autoPurge = true, token = 'stored-token', honorCancellation = true, settings = {} } = {}) {
	const values = {
		'api.zoneID': ZONE_A,
		'api.key': 'legacy-key',
		'api.email': 'person@example.invalid',
		'developmentModeStatus.enable': polling,
		'developmentModeStatus.interval': 60,
		'cache.purgeAutomatically': autoPurge,
		...settings
	};
	const commands = new Map();
	const configListeners = new Set();
	const secretListeners = new Set();
	const disposableObjects = [];
	const requests = [];
	const queue = new Map();
	const messages = { info: [], error: [], log: [] };
	let nextTimer = 0;
	let now = 0;
	let input;
	let clientDisposed = false;
	function disposable(extra = {}, onDispose = () => {}) {
		const object = { ...extra, disposed: false, dispose() { this.disposed = true; onDispose(); } };
		disposableObjects.push(object);
		return object;
	}
	const status = disposable({ show() {} });
	const output = disposable({ appendLine(message) { messages.log.push(message); } });
	const context = {
		subscriptions: [],
		secrets: {
			async get() { return token; },
			async store(_key, value) {
				token = value;
				for (const listener of secretListeners) { listener({ key: TOKEN_KEY }); }
			},
			async delete() {
				token = undefined;
				for (const listener of secretListeners) { listener({ key: TOKEN_KEY }); }
			},
			onDidChange(listener) {
				secretListeners.add(listener);
				return disposable({}, () => secretListeners.delete(listener));
			}
		}
	};
	const vscode = {
		StatusBarAlignment: { Right: 1 },
		TreeItemCollapsibleState: { Expanded: 2 },
		ThemeColor: class { constructor(id) { this.id = id; } },
		ThemeIcon: class { constructor(id) { this.id = id; } },
		TreeItem: class { constructor(label) { this.label = label; } },
		window: {
			createStatusBarItem: () => status,
			createOutputChannel: () => output,
			createTreeView: () => disposable(),
			async showInformationMessage(message) { messages.info.push(message); },
			async showErrorMessage(message) { messages.error.push(message); },
			async showInputBox() { return input; }
		},
		workspace: {
			getConfiguration: () => ({ get: (key, fallback) => values[key] === undefined ? fallback : values[key] }),
			onDidChangeConfiguration(listener) {
				configListeners.add(listener);
				return disposable({}, () => configListeners.delete(listener));
			}
		},
		commands: {
			registerCommand(name, handler) {
				commands.set(name, handler);
				return disposable({}, () => commands.delete(name));
			},
			async executeCommand() {}
		}
	};
	const client = {
		request(options) {
			let resolve;
			let reject;
			const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
			const request = {
				options,
				promise,
				cancelCount: 0,
				resolve,
				reject,
				cancel() {
					this.cancelCount += 1;
					if (honorCancellation) { reject(Object.assign(new Error('Cancelled'), { code: 'CANCELLED' })); }
				}
			};
			requests.push(request);
			return request;
		},
		dispose() {
			clientDisposed = true;
			for (const request of requests) { request.cancel(); }
		}
	};
	const timers = {
		setTimeout(callback, delay) {
			const id = ++nextTimer;
			queue.set(id, { callback, time: now + delay, delay });
			return id;
		},
		clearTimeout(id) { queue.delete(id); }
	};
	const controller = createController(vscode, context, client, timers);
	return {
		controller, context, values, status, output, messages, requests, queue, disposableObjects, configListeners, secretListeners,
		get clientDisposed() { return clientDisposed; },
		set input(value) { input = value; },
		run(name) { return commands.get(`cloudflareDevTools.${name}`)(); },
		async change(patch) {
			Object.assign(values, patch);
			for (const listener of configListeners) { listener({ affectsConfiguration: () => true }); }
			await flush();
		},
		async changeToken(value) { await context.secrets.store(TOKEN_KEY, value); await flush(); },
		async advance(milliseconds) {
			const target = now + milliseconds;
			for (;;) {
				const next = [...queue.entries()].filter(([, timer]) => timer.time <= target).sort((a, b) => a[1].time - b[1].time)[0];
				if (!next) { break; }
				queue.delete(next[0]);
				now = next[1].time;
				next[1].callback();
				await flush();
			}
			now = target;
			await flush();
		}
	};
}

test('disabled polling stays stopped at startup and after settings changes', async (t) => {
	const f = fixture({ polling: false });
	t.after(() => f.controller.dispose());
	await f.controller.start();
	await f.change({ 'developmentModeStatus.interval': 5 });
	await f.advance(120000);
	assert.equal(f.requests.length, 0);
	assert.equal(f.queue.size, 0);
	assert.match(f.status.tooltip, /Periodic status checks disabled/);
});

test('polling waits for the previous request and stops immediately when disabled', async (t) => {
	const f = fixture();
	t.after(() => f.controller.dispose());
	await f.controller.start();
	await f.advance(120000);
	assert.equal(f.requests.length, 1);
	f.requests[0].resolve({ value: 'on', time_remaining: 120 });
	await flush();
	await f.advance(59999);
	assert.equal(f.requests.length, 1);
	await f.advance(1);
	assert.equal(f.requests.length, 2);
	await f.change({ 'developmentModeStatus.enable': false });
	assert.ok(f.requests[1].cancelCount > 0);
	await f.advance(300000);
	assert.equal(f.requests.length, 2);
	assert.equal(f.queue.size, 0);
});

test('poll failures back off, respect Retry-After and avoid repeated notifications or logs', async (t) => {
	const f = fixture();
	t.after(() => f.controller.dispose());
	await f.controller.start();
	f.requests[0].reject(new Error('Offline'));
	await flush();
	assert.equal([...f.queue.values()][0].delay, 120000);
	await f.advance(120000);
	f.requests[1].reject(new Error('Offline'));
	await flush();
	assert.equal([...f.queue.values()][0].delay, 240000);
	assert.equal(f.messages.error.length, 0);
	assert.equal(f.messages.info.length, 0);
	assert.equal(f.messages.log.length, 1);
	await f.advance(240000);
	f.requests[2].reject(Object.assign(new Error('Rate limited'), { retryAfterMs: 1000000 }));
	await flush();
	assert.equal([...f.queue.values()][0].delay, 1000000);
	await f.advance(1000000);
	f.requests[3].resolve({ value: 'off' });
	await flush();
	assert.equal([...f.queue.values()][0].delay, 60000);
	assert.match(f.messages.log.at(-1), /Connection restored/);
});

test('a stale poll response cannot overwrite the new zone status', async (t) => {
	const f = fixture({ honorCancellation: false });
	t.after(() => f.controller.dispose());
	await f.controller.start();
	const oldRequest = f.requests[0];
	await f.change({ 'api.zoneID': ZONE_B });
	assert.equal(f.requests[1].options.zoneId, ZONE_B);
	f.requests[1].resolve({ value: 'off' });
	await flush();
	oldRequest.resolve({ value: 'on', time_remaining: 99999 });
	await flush();
	assert.match(f.status.tooltip, new RegExp(ZONE_B));
	assert.match(f.status.tooltip, /Development Mode: OFF/);
	assert.doesNotMatch(f.status.tooltip, /99999|ON/);
});

test('turning Development Mode off never schedules an automatic purge', async (t) => {
	const f = fixture({ polling: false });
	t.after(() => f.controller.dispose());
	await f.controller.start();
	const done = f.run('devOff');
	assert.deepEqual(f.requests[0].options.body, { value: 'off' });
	f.requests[0].resolve({ value: 'off' });
	await done;
	await f.advance(10000);
	assert.equal(f.requests.length, 1);
	assert.equal(f.queue.size, 0);
});

test('automatic purge uses the original zone only after a successful on action', async (t) => {
	const f = fixture({ polling: false });
	t.after(() => f.controller.dispose());
	await f.controller.start();
	const done = f.run('devOn');
	f.requests[0].resolve({ value: 'on' });
	await done;
	await f.advance(2999);
	assert.equal(f.requests.length, 1);
	await f.advance(1);
	assert.equal(f.requests.length, 2);
	assert.equal(f.requests[1].options.zoneId, ZONE_A);
	assert.equal(f.requests[1].options.endpoint, '/purge_cache');
	assert.equal(f.requests[1].options.method, 'POST');
	assert.deepEqual(f.requests[1].options.body, { purge_everything: true });
	f.requests[1].resolve({ id: ZONE_A });
	await flush();
});

test('zone, token and settings changes cancel a pending automatic purge', async (t) => {
	for (const change of ['zone', 'token', 'settings']) {
		const f = fixture({ polling: false });
		t.after(() => f.controller.dispose());
		await f.controller.start();
		const done = f.run('devOn');
		f.requests[0].resolve({ value: 'on' });
		await done;
		if (change === 'zone') { await f.change({ 'api.zoneID': ZONE_B }); }
		if (change === 'token') { await f.changeToken('replacement-token'); }
		if (change === 'settings') { await f.change({ 'cache.purgeAutomatically': false }); }
		await f.advance(10000);
		assert.equal(f.requests.length, 1, `${change} must cancel the delayed purge`);
		assert.equal(f.queue.size, 0);
	}
});

test('a stale mutation response cannot schedule a purge after the zone changes', async (t) => {
	const f = fixture({ polling: false, honorCancellation: false });
	t.after(() => f.controller.dispose());
	await f.controller.start();
	const done = f.run('devOn');
	await f.change({ 'api.zoneID': ZONE_B });
	f.requests[0].resolve({ value: 'on' });
	await done;
	await f.advance(10000);
	assert.equal(f.requests.length, 1);
	assert.equal(f.messages.info.length, 0);
	assert.doesNotMatch(f.status.tooltip, /Development Mode: ON/);
});

test('duplicate user actions do not create concurrent requests', async (t) => {
	const f = fixture({ polling: false });
	t.after(() => f.controller.dispose());
	await f.controller.start();
	const first = f.run('devOn');
	await f.run('purgeCache');
	assert.equal(f.requests.length, 1);
	assert.match(f.status.text, /sync~spin/);
	assert.match(f.messages.info[0], /already running/);
	f.requests[0].resolve({ value: 'on' });
	await first;
	assert.doesNotMatch(f.status.text, /sync~spin/);
});

test('on responses without a duration never display NaN', async (t) => {
	for (const time_remaining of [undefined, null, false, NaN, -1]) {
		const f = fixture({ polling: false, autoPurge: false });
		t.after(() => f.controller.dispose());
		await f.controller.start();
		const done = f.run('devOn');
		f.requests[0].resolve({ value: 'on', time_remaining });
		await done;
		assert.match(f.status.tooltip, /Development Mode: ON/);
		assert.doesNotMatch(f.status.tooltip, /NaN|minutes left/);
	}
});

test('stored token takes precedence and removal safely restores legacy credentials', async (t) => {
	const f = fixture({ polling: false });
	t.after(() => f.controller.dispose());
	await f.controller.start();
	let done = f.run('testConnection');
	assert.deepEqual(f.requests[0].options.credentials, { token: 'stored-token' });
	f.requests[0].resolve({ value: 'off' });
	await done;
	await f.run('removeToken');
	done = f.run('testConnection');
	assert.deepEqual(f.requests[1].options.credentials, { key: 'legacy-key', email: 'person@example.invalid' });
	f.requests[1].resolve({ value: 'off' });
	await done;
	assert.equal(f.values['api.key'], 'legacy-key');
	assert.equal(f.values['api.email'], 'person@example.invalid');
});

test('missing or invalid configuration never sends a request', async (t) => {
	for (const settings of [{ 'api.zoneID': '' }, { 'api.zoneID': 'bad-zone' }, { 'api.key': '', 'api.email': '' }]) {
		const f = fixture({ token: null, settings });
		t.after(() => f.controller.dispose());
		await f.controller.start();
		await f.run('devOn');
		await f.run('testConnection');
		await f.advance(100000);
		assert.equal(f.requests.length, 0);
		assert.equal(f.queue.size, 0);
		assert.equal(f.messages.error.length, 2);
	}
});

test('token removal without legacy credentials leaves actions unconfigured', async (t) => {
	const f = fixture({ polling: false, settings: { 'api.key': '', 'api.email': '' } });
	t.after(() => f.controller.dispose());
	await f.controller.start();
	await f.run('removeToken');
	await f.run('purgeCache');
	assert.equal(f.requests.length, 0);
	assert.match(f.messages.error[0], /Set API Token/);
});

test('disposal cancels active work, clears timers and releases every subscription', async () => {
	const f = fixture();
	await f.controller.start();
	f.controller.dispose();
	await flush();
	assert.ok(f.requests[0].cancelCount > 0);
	assert.equal(f.queue.size, 0);
	assert.equal(f.clientDisposed, true);
	assert.equal(f.configListeners.size, 0);
	assert.equal(f.secretListeners.size, 0);
	assert.ok(f.disposableObjects.every(object => object.disposed));
	const count = f.requests.length;
	await f.advance(600000);
	assert.equal(f.requests.length, count);
	assert.equal(f.messages.error.length, 0);
	f.controller.dispose();
});

test('disposal clears delayed purges and a late secret read cannot restart polling', async () => {
	const f = fixture({ polling: false });
	await f.controller.start();
	const done = f.run('devOn');
	f.requests[0].resolve({ value: 'on' });
	await done;
	assert.equal(f.queue.size, 1);
	f.controller.dispose();
	await f.advance(10000);
	assert.equal(f.requests.length, 1);
	assert.equal(f.queue.size, 0);

	const waiting = fixture();
	let resolveToken;
	waiting.context.secrets.get = () => new Promise(resolve => { resolveToken = resolve; });
	const start = waiting.controller.start();
	waiting.controller.dispose();
	resolveToken('late-token');
	await start;
	await waiting.advance(10000);
	assert.equal(waiting.requests.length, 0);
	assert.equal(waiting.queue.size, 0);
});
