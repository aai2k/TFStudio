/**
 * Test helper for tests/python_client.mjs: the manual's Python examples, on
 * the API Reference, the Script Console page and the Python page, each run as
 * a reader runs it (tests/_pythonExamples.py says how), the live ones against
 * a stand-in app. Each runs without an error and prints what it found, and one
 * that writes a file, run again, writes over nothing of its first run. The
 * Python page's table of AppError codes lists the codes AppError's docstring
 * names.
 *
 * checkExamples(t) runs them with the test's helpers in `t`: scenario, ok,
 * failure, openApp, examplesOf, PAGES, PACKAGE, ENV, WORK and limit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DRIVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '_pythonExamples.py');

// What is wrong with what an example answered, or null.
function wrong(answer) {
    if (!answer) return 'no answer';
    if (answer.error) return answer.error;
    if (answer.rewrote.length) return `run again, it wrote over ${answer.rewrote.join(', ')}`;
    return answer.printed.trim() ? null : 'it printed nothing';
}

// The codes AppError's docstring names, and those the Python page's table gives.
function appErrorCodes(t) {
    const docstring = /class AppError[^"]*"""([\s\S]*?)"""/.exec(fs.readFileSync(path.join(t.PACKAGE, 'tfstudio', '_errors.py'), 'utf8'))?.[1] ?? '';
    const named = [...docstring.matchAll(/'(\w+)'/g)].map(m => m[1]);
    const lines = fs.readFileSync(t.PAGES.find(page => page.slug === 'python').en, 'utf8').split(/\r?\n/);
    const after = lines.slice(lines.findIndex(line => /^\| Code \| Meaning \|$/.test(line)) + 2);
    const end = after.findIndex(line => !line.startsWith('|'));
    const tabled = after.slice(0, end < 0 ? after.length : end).map(line => /^\| `(\w+)` \|/.exec(line)?.[1]);
    return { named, tabled };
}

export async function checkExamples(t) {
    // The home folder is WORK, so what an example writes there is watched as
    // what it writes in its working folder is.
    const env = { ...t.ENV, HOME: t.WORK, USERPROFILE: t.WORK };
    const link = path.join(t.WORK, 'examples-bridge.json');
    const { bridge } = await t.openApp(link, []);
    for (const page of t.PAGES) {
        const examples = t.examplesOf(page.en);
        const ran = await t.scenario('examples', { driver: DRIVER, input: { examples, link }, env, limit: t.limit });
        const bad = examples.map((code, i) => [code.split('\n').find(line => line && !line.startsWith('import')), wrong(ran.messages.find(m => m.example === i))])
            .filter(([, problem]) => problem).map(([first, problem]) => `${first}: ${problem}`);
        t.ok(`${page.slug}.md: each Python example runs, prints what it found, and run again writes over nothing`, examples.length > 0 && bad.length === 0,
            bad.join('\n') || t.failure(ran));
    }
    bridge.close();
    const { named, tabled } = appErrorCodes(t);
    t.ok('the Python page\'s table of AppError codes lists the codes AppError\'s docstring names', named.length > 0 && JSON.stringify(tabled) === JSON.stringify(named),
        `${tabled} / ${named}`);
}
