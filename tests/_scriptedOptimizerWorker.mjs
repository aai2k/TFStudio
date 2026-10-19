/**
 * A stand-in for the optimizer worker in the Refinement hook tests. Each start
 * job reports its start values in an 'init' message and one progress step,
 * with every layer moved by its index so the design it returns is
 * recognisable, and then finishes; with `ScriptedWorker.hold` set it stops
 * after the progress step, leaving the run in flight. A 'score' job answers
 * with the same start values. It answers nothing else, so a parallel DE run
 * waits on its evaluation pool until it is stopped.
 */
const START = 0.05;

export class ScriptedWorker {
    static hold = false;

    constructor() { this.onmessage = null; this.terminated = false; }

    postMessage(job) {
        if (job?.type === 'score') {
            setTimeout(() => this.post({ type: 'score', mf: START, omf: START }), 0);
            return;
        }
        if (job?.type !== 'start') return;
        setTimeout(() => {
            const shift = layers => (layers || []).map((l, i) => ({ ...l, thickness: l.thickness + i + 1 }));
            const front = shift(job.design.frontLayers), back = shift(job.design.backLayers);
            const layers = { frontLayers: front, backLayers: back, bestFrontLayers: front, bestBackLayers: back };
            this.post({ type: 'init', mfInitial: START, mfBest: START, omfInitial: START, omfBest: START });
            this.post({ type: 'progress', iter: 5, mf: 0.02, mfBest: 0.02, omf: 0.02, omfBest: 0.02, ...layers });
            if (ScriptedWorker.hold) return;
            this.post({ type: 'done', iter: 12, mf: 0.01, mfBest: 0.01, omf: 0.01, omfBest: 0.01, reason: 'stalled', ...layers });
        }, 0);
    }

    post(data) { if (!this.terminated && this.onmessage) this.onmessage({ data }); }

    terminate() { this.terminated = true; }
}
