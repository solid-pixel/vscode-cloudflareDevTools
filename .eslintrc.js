module.exports = {
	'env': {
		'node': true
	},
	'extends': [ 'eslint:recommended' ],
	'parserOptions': {
		'ecmaVersion': 'latest'
	},
	'rules': {
		'indent': [
			'error',
			'tab'
		],
		'quotes': [
			'error',
			'single'
		],
		'semi': [
			'error',
			'always'
		],
		'keyword-spacing': [
			'error',
			{
				'before': true,
				'after': true
			}
		],
		'space-in-parens': [
			'error',
			'always'
		],
		'template-curly-spacing': [
			'error',
			'always'
		],
		'space-infix-ops': 'error',
		'padded-blocks': [
			'error',
			'always'
		],
		'padding-line-between-statements': [
			'error',
			{
				blankLine: 'always',
				prev: '*',
				next: 'block-like'
			},
			{
				blankLine: 'always',
				prev: 'multiline-expression',
				next: '*'
			},
			{
				blankLine: 'always',
				prev: 'multiline-const',
				next: '*'
			},
			{
				blankLine: 'always',
				prev: 'multiline-let',
				next: '*'
			},
			{
				blankLine: 'always',
				prev: 'let',
				next: 'expression'
			}
		],
		'no-multiple-empty-lines': [
			'error',
			{
				'max': 2,
				'maxEOF': 1
			}
		],
		'camelcase': 'error',
		'curly': 'error',
		'prefer-arrow-callback': 'error',
		'no-var': 'error',
		'prefer-const': 'error',
		'vars-on-top': 'error',
		'spaced-comment': [
			'error',
			'always'
		],
		'array-bracket-newline': [
			'error',
			{
				'multiline': true,
				'minItems': 2
			}
		],
		'array-element-newline': [
			'error',
			{
				'multiline': true,
				'minItems': 2
			}
		],
		'array-bracket-spacing': [
			'error',
			'always'
		],
		'object-curly-newline': [
			'error',
			'always'
		],
		'object-property-newline': 'error',
		'brace-style': 'error',
		'computed-property-spacing': [
			'error',
			'always'
		],
		'no-multi-spaces': 'error',
		'no-trailing-spaces': 'error'

	}
};
