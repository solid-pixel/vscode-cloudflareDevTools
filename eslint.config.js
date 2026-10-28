const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
	{ ignores: ['node_modules/**', '.vscode-test/**', 'dist/**'] },
	js.configs.recommended,
	{
		files: ['**/*.js'],
		languageOptions: {
			sourceType: 'commonjs',
			globals: globals.node
		},
		rules: {
			'no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
		}
	},
	{
		files: ['extension.js', 'src/**/*.js', 'test/smoke/**/*.js'],
		languageOptions: { ecmaVersion: 2021 }
	}
];
