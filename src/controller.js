const DataProvider = require('./dataProvider');

const TOKEN_KEY = 'cloudflareDevTools.apiToken';
const PREFIX = 'cloudflareDevTools';

function createController(vscode, context, client, timers = { setTimeout, clearTimeout }) {
	const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
	const output = vscode.window.createOutputChannel('Cloudflare DevTools');
	const disposables = [status, output];
	const requests = new Set();
	let revision = 0;
	let disposed = false;
	let settings;
	let pollTimer;
	let pollRequest;
	let purgeTimer;
	let busy;
	let failures = 0;
	let lastPollError;
	let lastStatus = 'Connection not tested';
	let statusError = false;

	function log(message) {
		if (!disposed) { output.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`); }
	}

	function current(snapshot) {
		return !disposed && snapshot && snapshot.revision === revision;
	}

	function render() {
		if (disposed) { return; }
		const zone = settings && settings.zoneId;
		status.name = 'Cloudflare DevTools';
		status.text = busy ? '$(sync~spin) Cloudflare' : '$(cloud)';
		status.tooltip = `Cloudflare DevTools\nZone: ${zone || 'not configured'}\n${busy ? busy.label : lastStatus}`;
		status.command = `${PREFIX}.commands`;
		status.backgroundColor = statusError
			? new vscode.ThemeColor('statusBarItem.errorBackground')
			: lastStatus.startsWith('Development Mode: ON')
				? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
		status.show();
	}

	function updateMode(result) {
		if (!result || !['on', 'off'].includes(result.value)) {
			throw new Error('Cloudflare returned an unexpected Development Mode response.');
		}
		const remaining = result.time_remaining;
		const duration = result.value === 'on' && typeof remaining === 'number' && Number.isFinite(remaining) && remaining >= 0
			? ` (${Math.ceil(remaining / 60)} minutes left)` : '';
		lastStatus = `Development Mode: ${result.value.toUpperCase()}${duration}`;
		statusError = false;
		render();
	}

	function clearPoll() {
		timers.clearTimeout(pollTimer);
		pollTimer = undefined;
		if (pollRequest) {
			pollRequest.cancel();
			pollRequest = undefined;
		}
	}

	function clearPurge() {
		timers.clearTimeout(purgeTimer);
		purgeTimer = undefined;
	}

	function invalidate() {
		revision += 1;
		clearPoll();
		clearPurge();
		for (const request of requests) { request.cancel(); }
		requests.clear();
		busy = undefined;
		settings = undefined;
	}

	function configurationError(snapshot) {
		if (!snapshot || !/^[a-f0-9]{32}$/i.test(snapshot.zoneId)) {
			return 'Set a valid 32-character Zone ID in Cloudflare DevTools settings.';
		}
		if (!snapshot.credentials.token && (!snapshot.credentials.key || !snapshot.credentials.email)) {
			return 'Run Cloudflare DevTools: Set API Token, or configure your Global API Key and email.';
		}
		return undefined;
	}

	function schedulePoll(snapshot, delay) {
		if (!current(snapshot) || !snapshot.polling || busy || pollRequest || configurationError(snapshot)) { return; }
		timers.clearTimeout(pollTimer);
		pollTimer = timers.setTimeout(() => {
			pollTimer = undefined;
			void poll(snapshot);
		}, Math.min(2147483647, Math.max(snapshot.interval, delay)));
	}

	function startRequest(snapshot, method, endpoint, body) {
		const request = client.request({ zoneId: snapshot.zoneId, credentials: snapshot.credentials, method, endpoint, body });
		requests.add(request);
		return request;
	}

	async function poll(snapshot) {
		if (!current(snapshot) || !snapshot.polling || busy || pollRequest) { return; }
		let request;
		let delay = snapshot.interval;
		try {
			request = startRequest(snapshot, 'GET', '/settings/development_mode');
			pollRequest = request;
			const result = await request.promise;
			if (!current(snapshot) || pollRequest !== request) { return; }
			updateMode(result);
			if (lastPollError) { log(`Connection restored for zone ${snapshot.zoneId}.`); }
			failures = 0;
			lastPollError = undefined;
		} catch (error) {
			if (!current(snapshot) || error.code === 'CANCELLED') { return; }
			failures += 1;
			delay = Math.max(
				Math.min(snapshot.interval * (2 ** Math.min(failures, 8)), Math.max(snapshot.interval, 15 * 60 * 1000)),
				error.retryAfterMs || 0
			);
			lastStatus = `Connection unavailable: ${error.message}`;
			statusError = true;
			if (lastPollError !== error.message) { log(`Zone ${snapshot.zoneId}: ${error.message}`); }
			lastPollError = error.message;
			render();
		} finally {
			requests.delete(request);
			if (pollRequest === request) {
				pollRequest = undefined;
				schedulePoll(snapshot, delay);
			}
		}
	}

	async function refresh() {
		invalidate();
		const refreshRevision = revision;
		lastStatus = 'Loading connection settings';
		statusError = false;
		render();
		try {
			const config = vscode.workspace.getConfiguration(PREFIX);
			const token = await context.secrets.get(TOKEN_KEY);
			if (disposed || refreshRevision !== revision) { return; }
			const text = key => String(config.get(key, '') || '').trim();
			const seconds = Number(config.get('developmentModeStatus.interval', 60));
			settings = Object.freeze({
				revision,
				zoneId: text('api.zoneID'),
				credentials: Object.freeze(token ? { token } : { key: text('api.key'), email: text('api.email') }),
				polling: config.get('developmentModeStatus.enable', true) === true,
				interval: Math.min(86400, Math.max(5, Number.isFinite(seconds) ? seconds : 60)) * 1000,
				autoPurge: config.get('cache.purgeAutomatically', true) === true
			});
			failures = 0;
			lastPollError = undefined;
			lastStatus = configurationError(settings) || (settings.polling ? 'Checking connection' : 'Periodic status checks disabled');
			render();
			if (!configurationError(settings) && settings.polling) { void poll(settings); }
		} catch {
			if (disposed || refreshRevision !== revision) { return; }
			lastStatus = 'Could not read secure credentials. Reload VS Code and try again.';
			statusError = true;
			log(lastStatus);
			render();
		}
	}

	function schedulePurge(snapshot, delay = 3000) {
		clearPurge();
		purgeTimer = timers.setTimeout(() => {
			purgeTimer = undefined;
			if (!current(snapshot)) { return; }
			if (busy) { schedulePurge(snapshot, 500); return; }
			void action('purge', snapshot, true);
		}, delay);
	}

	async function action(kind, snapshot = settings, automatic = false) {
		if (disposed) { return; }
		if (busy) {
			if (!automatic) { await vscode.window.showInformationMessage('A Cloudflare action is already running.'); }
			return;
		}
		const invalid = configurationError(snapshot);
		if (invalid) {
			await vscode.window.showErrorMessage(invalid);
			return;
		}
		if (!current(snapshot)) { return; }
		if (kind !== 'test') { clearPurge(); }
		clearPoll();
		const operation = { label: kind === 'test' ? 'Testing connection' : kind === 'purge' ? 'Purging cache' : `Turning Development Mode ${kind.toUpperCase()}` };
		busy = operation;
		render();
		let request;
		try {
			const endpoint = kind === 'purge' ? '/purge_cache' : '/settings/development_mode';
			const method = kind === 'test' ? 'GET' : kind === 'purge' ? 'POST' : 'PATCH';
			const body = kind === 'test' ? undefined : kind === 'purge' ? { purge_everything: true } : { value: kind };
			request = startRequest(snapshot, method, endpoint, body);
			const result = await request.promise;
			if (!current(snapshot)) { return; }
			if (kind !== 'purge') { updateMode(result); }
			failures = 0;
			lastPollError = undefined;
			const message = kind === 'test'
				? `Connected to zone ${snapshot.zoneId}. Development Mode is ${result.value.toUpperCase()}. This checks read access only.`
				: kind === 'purge' ? `Cloudflare accepted the cache purge for zone ${snapshot.zoneId}.`
					: `Development Mode is ${result.value.toUpperCase()} for zone ${snapshot.zoneId}.`;
			log(message);
			void vscode.window.showInformationMessage(message);
			if (kind === 'on' && result.value === 'on' && snapshot.autoPurge) { schedulePurge(snapshot); }
		} catch (error) {
			if (!current(snapshot) || error.code === 'CANCELLED') { return; }
			log(`Zone ${snapshot.zoneId}: ${error.message}`);
			void vscode.window.showErrorMessage(`Cloudflare: ${error.message}`);
		} finally {
			requests.delete(request);
			if (busy === operation) {
				busy = undefined;
				render();
				schedulePoll(snapshot, snapshot.interval);
			}
		}
	}

	async function configureToken() {
		const token = await vscode.window.showInputBox({
			title: 'Cloudflare API Token',
			prompt: 'Use a token scoped to your zone with Zone Settings Edit and Cache Purge permissions.',
			password: true,
			ignoreFocusOut: true,
			validateInput: value => !value.trim() || /\s/.test(value.trim()) ? 'Enter an API token without spaces.' : undefined
		});
		if (disposed || token === undefined) { return; }
		if (!token.trim() || /\s/.test(token.trim())) { return; }
		await context.secrets.store(TOKEN_KEY, token.trim());
		await refresh();
		if (!disposed) { void vscode.window.showInformationMessage('Cloudflare API token saved securely. Run Test Connection to check your zone.'); }
	}

	async function removeToken() {
		await context.secrets.delete(TOKEN_KEY);
		await refresh();
		if (!disposed) {
			void vscode.window.showInformationMessage('Cloudflare API token removed. Existing Global API Key settings, if configured, will be used.');
		}
	}

	function register(name, handler) {
		disposables.push(vscode.commands.registerCommand(`${PREFIX}.${name}`, async () => {
			if (disposed) { return; }
			try { return await handler(); } catch {
				if (!disposed) { void vscode.window.showErrorMessage('Cloudflare could not save or read secure credentials. Please try again.'); }
			}
		}));
	}

	register('devOn', () => action('on'));
	register('devOff', () => action('off'));
	register('purgeCache', () => action('purge'));
	register('testConnection', () => action('test'));
	register('configureToken', configureToken);
	register('removeToken', removeToken);
	register('commands', () => vscode.commands.executeCommand('workbench.action.quickOpen', '>Cloudflare DevTools:'));
	const tree = vscode.window.createTreeView('cloudflareDevTools-tree', { treeDataProvider: new DataProvider(vscode) });
	disposables.push(tree, vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration(PREFIX)) { void refresh(); }
	}));
	disposables.push(context.secrets.onDidChange(event => {
		if (event.key === TOKEN_KEY) { void refresh(); }
	}));

	return {
		start: refresh,
		dispose() {
			if (disposed) { return; }
			disposed = true;
			invalidate();
			client.dispose();
			for (const disposable of disposables) { disposable.dispose(); }
		}
	};
}

module.exports = { createController, TOKEN_KEY };
