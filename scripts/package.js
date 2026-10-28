const fs = require('node:fs');
const path = require('node:path');
const { createVSIX } = require('@vscode/vsce');
const { packagePath, verifyPackage } = require('./verifyPackage');

async function buildPackage() {
	fs.mkdirSync(path.dirname(packagePath), { recursive: true });
	await createVSIX({
		cwd: path.resolve(__dirname, '..'),
		packagePath,
		dependencies: false,
		skipLicense: true
	});
	const entries = await verifyPackage(packagePath);
	return { packagePath, entries };
}

if (require.main === module) {
	buildPackage().catch(error => {
		console.error(error);
		process.exitCode = 1;
	});
}

module.exports = { buildPackage };
