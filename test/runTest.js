const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');
const { buildPackage } = require('../scripts/package');

async function main() {
	const temporaryDirectory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cfd-'));
	const userDataDirectory = path.join(temporaryDirectory, 'u');
	const workspaceDirectory = path.join(temporaryDirectory, 'workspace');
	fs.mkdirSync(path.join(userDataDirectory, 'User'), { recursive: true });
	fs.mkdirSync(workspaceDirectory);
	fs.writeFileSync(path.join(userDataDirectory, 'User', 'settings.json'), JSON.stringify({
		'cloudflareDevTools.api.key': '',
		'cloudflareDevTools.api.email': '',
		'cloudflareDevTools.api.zoneID': '',
		'cloudflareDevTools.developmentModeStatus.enable': false,
		'security.workspace.trust.enabled': false,
		'update.mode': 'none',
		'telemetry.telemetryLevel': 'off',
		'extensions.autoUpdate': false
	}));

	try {
		const { entries } = await buildPackage();
		const packagedExtensionDirectory = path.join(temporaryDirectory, 'extension');
		for (const [name, contents] of entries) {
			if (!name.startsWith('extension/')) continue;
			const destination = path.resolve(temporaryDirectory, name);
			if (!destination.startsWith(packagedExtensionDirectory + path.sep)) throw new Error('Unexpected package entry');
			fs.mkdirSync(path.dirname(destination), { recursive: true });
			fs.writeFileSync(destination, contents);
		}
		await runTests({
			version: process.env.VSCODE_VERSION || 'stable',
			extensionDevelopmentPath: packagedExtensionDirectory,
			extensionTestsPath: path.resolve(__dirname, 'smoke', 'index.js'),
			launchArgs: [
				workspaceDirectory,
				'--disable-extensions',
				'--disable-workspace-trust',
				'--skip-welcome',
				'--skip-release-notes',
				'--user-data-dir', userDataDirectory,
				'--extensions-dir', path.join(temporaryDirectory, 'extensions'),
				...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [])
			]
		});
	} finally {
		fs.rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
