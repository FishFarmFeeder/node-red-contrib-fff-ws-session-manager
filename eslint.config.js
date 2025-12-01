const js = require('@eslint/js');

module.exports = [
    {
        ignores: ['node_modules/', 'test/', 'examples/', '.git/']
    },
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                RED: 'readonly'
            }
        },
        rules: {
            'indent': ['error', 4],
            'linebreak-style': ['error', 'unix'],
            'quotes': ['error', 'single'],
            'semi': ['error', 'always']
        }
    }
];
