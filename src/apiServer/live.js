// The API server's calls that reach the designs open in the TFStudio app, over
// the live link (src/mcp/liveLink.js) when the server runs with --live. They
// keep nothing between calls: app.read answers with a design and the revision
// it was read at, and app.apply takes both back. The app writes an apply as one
// undo step, and refuses it when its design changed since that revision or is
// no longer the open one.
//
//   app.designs()                          { activeDesignId, designs, folders, appVersion }
//   app.read({ appDesignId })              { appDesignId, revision, active, appRunning, design }
//                                          the open design without appDesignId
//   app.apply({ appDesignId, revision, design })   the same, at the new revision
//   app.select({ appDesignId })            opens the design; { appDesignId, name, folder,
//                                          active, unsaved, frontLayers, backLayers }
//   app.add({ design, folder })            adds the design, or a blank one without it, to
//                                          the folder, by default the one selected in the
//                                          app or the first, and opens it; as app.read
//                                          answers, with the folder
//   app.delete({ appDesignId })            deletes the design, its file to the Recycle
//                                          Bin; { appDesignId, name, folder }
//
// A refusal by the app or the link carries the code liveLink.js gives it, with
// failureText's words, which name the calls of the Python package's tf.app
// that read and list the app's designs. A design holding NaN or an infinite
// number is refused here, before it is sent, with no code.

import { createLiveLink, failureText } from '../mcp/liveLink.js';
import { checkOptions } from '../api/check.js';

const NAMES = ['app.designs', 'app.read', 'app.apply', 'app.select', 'app.add', 'app.delete'];

// Where `value` holds NaN or an infinite number, as a path such as
// design.frontLayers[0].thickness, or null when it holds none.
function nonFinite(value, at) {
    if (typeof value === 'number') return Number.isFinite(value) ? null : at;
    if (!value || typeof value !== 'object') return null;
    for (const [key, x] of Object.entries(value)) {
        const found = nonFinite(x, Array.isArray(value) ? `${at}[${key}]` : `${at}.${key}`);
        if (found) return found;
    }
    return null;
}

// The options of the call `name`, checked against `keys`, a design among them
// included. The live link writes JSON, which has no NaN or Infinity, so such a
// number would reach the app as null; the design is refused instead, as the
// API's own calls refuse it.
function withDesign(name, options, keys) {
    const checked = checkOptions(name, options, keys);
    const at = checked.design == null ? null : nonFinite(checked.design, 'design');
    if (at) throw new Error(`${name}: ${at} is NaN or infinite, which the app cannot take`);
    return checked;
}

/**
 * The app.* calls by name, over the live link file `live.file`, and close(),
 * which ends the link. `live.program` is the name the app shows for the
 * program the server serves, or null. Without `live` each call is refused.
 */
export function liveCalls(live) {
    if (!live) {
        const refuse = name => () => { throw new Error(`${name}: this server was started without --live, so it reaches no open app`); };
        return { calls: new Map(NAMES.map(name => [name, refuse(name)])), close: () => {} };
    }
    const link = createLiveLink(live.file, () => live.program ?? null);
    // The app's answer to `method`, or an error that says why there is none.
    const ask = async (name, method, params) => {
        try {
            return await link.request(method, params);
        } catch (err) {
            throw Object.assign(new Error(`${name}: ${failureText(err, { read: 'tf.app.open_design()', list: 'tf.app.designs()', folders: 'tf.app.folders()' })}`), { code: err.code });
        }
    };
    const calls = new Map([
        ['app.designs', async () => ({ ...(await ask('app.designs', 'designs', {})), appVersion: link.appVersion() })],
        ['app.read', options => {
            const { appDesignId } = checkOptions('app.read', options, ['appDesignId']);
            return ask('app.read', 'read', appDesignId == null ? {} : { appDesignId });
        }],
        ['app.apply', options => ask('app.apply', 'apply', withDesign('app.apply', options, ['appDesignId', 'revision', 'design']))],
        ['app.select', options => ask('app.select', 'select', checkOptions('app.select', options, ['appDesignId']))],
        ['app.add', options => ask('app.add', 'add', withDesign('app.add', options, ['design', 'folder']))],
        ['app.delete', options => ask('app.delete', 'delete', checkOptions('app.delete', options, ['appDesignId']))],
    ]);
    return { calls, close: () => link.close() };
}
