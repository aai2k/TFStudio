// Catches names used without being defined or imported, which otherwise only
// fail at run time as a ReferenceError on the path that reaches them.
// Run by tests/lint_no_undef.mjs as part of `npm test`.

import globals from 'globals';

const MAIN_PROCESS = ['src/main.js', 'src/preload.js', 'src/main/**/*.js'];

// Modules that also run under Node (tests, the benchmark) and reach for
// Node-only names behind a `typeof` check.
const SHARED_WITH_NODE = [
    'src/utils/benchmark/optimizerBenchmark.js',
    'src/utils/synthesis/deepSynthesis/runner.js',
    'src/utils/workers/inThreadOptimizerWorker.js',
];

// The source carries disable comments for this rule; only no-undef runs here,
// so the rule is declared empty to let those comments resolve.
const reactHooksStub = { rules: { 'exhaustive-deps': { create: () => ({}) } } };

export default [
    {
        linterOptions: { reportUnusedDisableDirectives: 'off' },
        plugins: { 'react-hooks': reactHooksStub },
    },
    {
        files: ['src/**/*.js', 'web/*.js'],
        ignores: MAIN_PROCESS,
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: { ecmaFeatures: { jsx: true } },
            globals: {
                ...globals.browser,
                ...globals.worker,
                // Loaded by script tags in src/index.html and the built page.
                React: 'readonly',
                ReactDOM: 'readonly',
                // Set by esbuild `define` in tools/build-renderer.mjs.
                __TFS_BUILD_DATE__: 'readonly',
            },
        },
        rules: { 'no-undef': 'error' },
    },
    {
        files: SHARED_WITH_NODE,
        languageOptions: { globals: { process: 'readonly', setImmediate: 'readonly' } },
    },
    {
        files: MAIN_PROCESS,
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: { ...globals.node },
        },
        rules: { 'no-undef': 'error' },
    },
];
