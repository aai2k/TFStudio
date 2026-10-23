// A run's hooks as the API server streams them: each hook the client names
// becomes a message on the run's request, { hook, args }, with the arguments
// the run called it with.
//
// onProgress reports the readouts that changed, a design and the whole merit
// history among them, as often as the run steps, and a client shows the
// latest. So at most four go out a second: a report that comes sooner waits,
// merged with any after it, until the quarter second is up. What waits goes
// out before any other hook's message and before the run's answer, so the
// messages keep the order the run made them in and the last report reaches
// the client.

const PROGRESS_EVERY_MS = 250;

/**
 * The hooks a run is given: one for each name in `names`, each passing what
 * the run reports to `send({ hook, args })`, and `signal`. flush() sends the
 * onProgress report still waiting, if any.
 */
export function streamedHooks(names, signal, send) {
    let held = null;
    let timer = null;
    let lastSent = 0;
    const flush = () => {
        clearTimeout(timer);
        timer = null;
        if (!held) return;
        send({ hook: 'onProgress', args: [held] });
        held = null;
        lastSent = Date.now();
    };
    const progress = patch => {
        held = { ...held, ...patch };
        const wait = PROGRESS_EVERY_MS - (Date.now() - lastSent);
        if (wait <= 0) flush();
        else timer ??= setTimeout(flush, wait);
    };
    const forward = hook => (...args) => {
        flush();
        send({ hook, args });
    };
    const hooks = Object.fromEntries(names.map(name => [name, name === 'onProgress' ? progress : forward(name)]));
    return { hooks: { ...hooks, signal }, flush };
}
