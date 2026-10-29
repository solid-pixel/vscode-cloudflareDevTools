const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yauzl = require('yauzl');
const manifest = require('../package.json');

const packagePath = path.resolve(__dirname, '..', 'dist', `${manifest.name}-${manifest.version}.vsix`);

function readPackage(filename) {
	return new Promise((resolve, reject) => {
		yauzl.open(filename, { lazyEntries: true }, (error, zip) => {
			if (error) return reject(error);
			const entries = new Map();
			zip.on('error', reject);
			zip.on('end', () => resolve(entries));
			zip.on('entry', entry => {
				if (entry.fileName.endsWith('/')) return zip.readEntry();
				zip.openReadStream(entry, (streamError, stream) => {
					if (streamError) {
						zip.close();
						return reject(streamError);
					}
					const chunks = [];
					stream.on('data', chunk => chunks.push(chunk));
					stream.on('error', reject);
					stream.on('end', () => {
						entries.set(entry.fileName, Buffer.concat(chunks));
						zip.readEntry();
					});
				});
			});
			zip.readEntry();
		});
	});
}

async function verifyPackage(filename = packagePath) {
	const entries = await readPackage(filename);
	const root = path.resolve(__dirname, '..');
	for (const required of ['extension.vsixmanifest', '[Content_Types].xml', 'extension/package.json', 'extension/readme.md', 'extension/changelog.md', `extension/${manifest.icon}`]) {
		assert.ok(entries.has(required), `Package is missing ${required}`);
	}
	const packagedManifest = JSON.parse(entries.get('extension/package.json').toString());
	const readme = entries.get('extension/readme.md').toString();
	for (const [, imagePath] of readme.matchAll(/!\[[^\]]*\]\((assets\/[^)]+)\)/g)) {
		assert.ok(entries.has(`extension/${imagePath}`), `README image must be packaged: ${imagePath}`);
	}
	assert.equal(packagedManifest.version, manifest.version, 'Package version must match the source');
	assert.equal(packagedManifest.publisher, manifest.publisher, 'Package publisher must match the source');
	assert.equal(packagedManifest.engines.vscode, manifest.engines.vscode, 'Package compatibility must match the source');

	const sourceFiles = ['extension.js', ...fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js')).map(name => `src/${name}`)];
	for (const sourceFile of sourceFiles) {
		assert.deepEqual(entries.get(`extension/${sourceFile}`), fs.readFileSync(path.join(root, sourceFile)), `Package must contain the current ${sourceFile}`);
	}
	for (const name of entries.keys()) {
		assert.ok(!/^extension\/(?:node_modules|test|scripts|\.github|\.vscode|dist|out)\//.test(name), `Development files must not ship: ${name}`);
		assert.ok(!/^extension\/(?:package-lock\.json|eslint\.config\.js|\.nvmrc|\.gitignore)$/.test(name), `Development configuration must not ship: ${name}`);
	}
	console.log(`Verified ${path.basename(filename)} (${entries.size} files): runtime sources, metadata and assets are present; development files are excluded.`);
	return entries;
}

if (require.main === module) {
	verifyPackage(process.argv[2] || packagePath).catch(error => {
		console.error(error);
		process.exitCode = 1;
	});
}

module.exports = { packagePath, verifyPackage };
