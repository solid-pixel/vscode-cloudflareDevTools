const assert = require('assert');
const vscode = require('vscode');

async function run() {
	const extension = vscode.extensions.getExtension('AlessandroBenassi.cloudflare-devtools');
	assert.ok(extension, 'The packaged extension must be discoverable');
	await extension.activate();
	assert.ok(extension.isActive, 'The extension must activate with no credentials');

	const commands = await vscode.commands.getCommands(true);
	for (const name of ['devOn', 'devOff', 'purgeCache', 'commands', 'configureToken', 'removeToken', 'testConnection']) {
		assert.ok(commands.includes(`cloudflareDevTools.${name}`), `Missing command: ${name}`);
	}

	const manifestCommands = extension.packageJSON.contributes.commands.map(command => command.command);
	for (const name of ['configureToken', 'removeToken', 'testConnection']) {
		assert.ok(manifestCommands.includes(`cloudflareDevTools.${name}`), `Missing manifest command: ${name}`);
	}

	console.log(`Cloudflare DevTools ${extension.packageJSON.version}: activation and commands passed on VS Code ${vscode.version}.`);
}

module.exports = { run };
