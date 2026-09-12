/**
 * The smooth-dispersion fit panel of the Material Editor.
 *
 * The fit has its own wavelength band, separate from the material's stated
 * validity range: a table can cover far more than any one model describes, and
 * outside the fit the table itself is read, so a narrow fit costs nothing. What
 * the panel reports is the residual the fit leaves and, for the metal models,
 * what the fit ran into on the way there.
 */

import {
    dispersionFitModelName, dispersionFitParameters, fitTabulatedMaterial, metalFitDiagnostics,
} from '../../../../utils/materials/dispersionFits.js';
import { anchoredFitRange, photonEnergyDecades, WIDE_BAND_DECADES } from '../../../../utils/materials/dispersionFitRange.js';
import { effectiveFitModel, fitModelsForRows, fitRangeNm, fitRows, tableRangeNm } from './materialDraft.js';
import { smallBtn } from './materialEditorUI.js';

const { createElement: h } = React;

const FIT_MODEL_LABELS = {
    cauchy: 'Cauchy',
    sellmeier: 'Sellmeier',
    drude: 'Drude',
    'drude-lorentz': 'Drude-Lorentz',
};

/**
 * The suggestion if it still belongs to what is on screen.
 *
 * It carries a fit of the rows and model it was made from. A row edited or a
 * model changed makes it a fit of something else, and installing it would leave
 * the material holding a fit of rows that are no longer in the table, which is
 * the one thing every row edit is careful to prevent.
 */
function currentSuggestion(suggestion, draft) {
    return suggestion && suggestion.rows === draft.rows && suggestion.model === effectiveFitModel(draft)
        ? suggestion
        : null;
}

// A draft carrying the band its fit was taken over, so the two never disagree.
function withFitRange(draft, dispersionFit, rangeNm) {
    return {
        ...draft, dispersionFit,
        fitRangeMinNm: String(rangeNm[0]), fitRangeMaxNm: String(rangeNm[1]),
    };
}

/**
 * What the panel's buttons do.
 *
 * A fit is taken over the fit range, which is the material's own band and not
 * its stated validity range, and the band used is written back into the boxes
 * so a fit and the range it covers never drift apart. The suggested band is
 * fitted but not installed: the panel shows what it reaches and the user
 * decides, rather than having one of the two numbers happen to them.
 */
export function fitActions({ draft, onChange, workingNm, suggestion, setFitError, setSuggestion }) {
    const fitOver = (rangeNm, install) => {
        try {
            const fit = fitTabulatedMaterial(fitRows(draft), {
                nModel: effectiveFitModel(draft), rangeNm,
            });
            setFitError('');
            install(fit);
        } catch (error) {
            setFitError(error.message || String(error));
        }
    };
    return {
        runFit: (rangeNm) => {
            // A table with nothing to fit has no band either; the fitter names
            // that in the error the panel shows, so it is asked either way.
            const range = rangeNm || fitRangeNm(draft, workingNm);
            fitOver(range, (fit) => {
                setSuggestion(null);
                onChange(withFitRange(draft, fit, range));
            });
        },
        onSuggest: () => {
            const range = anchoredFitRange(fitRows(draft).map(row => row[0]), workingNm);
            if (!range) return;
            fitOver(range, fit => setSuggestion({
                rangeNm: range, fit, rows: draft.rows, model: effectiveFitModel(draft),
            }));
        },
        onApplySuggestion: () => {
            const current = currentSuggestion(suggestion, draft);
            if (!current) return;
            onChange(withFitRange(draft, current.fit, current.rangeNm));
            setSuggestion(null);
        },
    };
}

// A wavelength as the range boxes show it: down to the picometre for a table
// that steps that finely, with no trailing zeros on one that does not.
const rangeText = value => String(Number(value.toFixed(3)));

// The coefficients the material is computed from, with the formula they sit in.
function renderFitCoefficients(fit, c) {
    const { formula, parameters } = dispersionFitParameters(fit);
    if (parameters.length === 0) return null;
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('div', { style: { color: c.textDim, fontSize: 10 } }, formula),
        h('div', {
            style: {
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                gap: '2px 12px', fontSize: 11, fontFamily: 'ui-monospace, Consolas, monospace',
            },
        },
            parameters.map(parameter => h('div', {
                key: parameter.label,
                style: { display: 'flex', justifyContent: 'space-between', gap: 6 },
            },
                h('span', { style: { color: c.textDim } }, parameter.label),
                h('span', { style: { color: c.text } }, parameter.value.toPrecision(7)),
            )),
        ),
    );
}

/**
 * What the fit panel says about how well the fit matched.
 *
 * A fit made here compares a formula against the material's own table, so it
 * reports a residual in n and, where the table absorbs, in k. A material saved
 * from n,k Characterization carries a fit too, but that one was refined against
 * a measured spectrum through the transfer matrix and never saw a table of n
 * and k, so it has no residual against one. Its residual is in the window that
 * produced it, against the measurement, which is the only place it means
 * anything.
 */
function fitResidualText(fit, me) {
    const residuals = fit.residuals || {};
    if (!residuals.n) {
        return [me.fitFromMeasurement(fit.source)];
    }
    const summary = (label, value) =>
        `${label} residual: RMS ${value.rms.toExponential(3)}, max ${value.max.toExponential(3)}`;
    return [
        summary('n', residuals.n),
        // A table with no absorption in it has no k residual to report.
        fit.k?.kind !== 'zero' && residuals.k ? `; ${summary('k', residuals.k)}` : '',
    ];
}

// One reading per fit. The form redraws on every keystroke in every field and
// the diagnostics sample the model a few hundred times, while what they say
// changes only when the fit itself does.
const diagnosticsByFit = new WeakMap();

function fitDiagnostics(fit) {
    let diagnostics = diagnosticsByFit.get(fit);
    if (!diagnostics) diagnosticsByFit.set(fit, diagnostics = metalFitDiagnostics(fit));
    return diagnostics;
}

/**
 * What a metal fit ran into: parameters left on a bound, and oscillators the
 * band cannot tell from a constant. Both are ways for a fit to report numbers
 * that read as a measured material when they are an optimiser that gave up.
 */
function renderFitDiagnostics(fit, me) {
    const { pinned, flat } = fitDiagnostics(fit);
    if (pinned.length === 0 && flat.length === 0) return null;
    return h('div', { style: { fontSize: 11, color: '#e6a23c', lineHeight: 1.4 } },
        pinned.length > 0 && me.fitPinnedParameters(pinned.join(', ')),
        pinned.length > 0 && flat.length > 0 && h('br'),
        flat.length > 0 && me.fitFlatOscillators(flat.join(', ')),
    );
}

// The band the design is evaluated over, where the table reaches that far and
// it covers less photon energy than the band being fitted.
function narrowerBand(draft, workingNm, band) {
    const anchored = workingNm && anchoredFitRange(fitRows(draft).map(row => row[0]), workingNm);
    return anchored && photonEnergyDecades(anchored) < photonEnergyDecades(band) ? anchored : null;
}

/**
 * The note shown when the band being fitted covers more photon energy than one
 * model holds, with the band the design is evaluated over as the way out.
 *
 * The band is offered rather than applied: the fit it reaches is run on the
 * first click and shown with its residual, so the user chooses between two
 * numbers instead of having one of them happen to them.
 */
function renderBandNote({ draft, workingNm, suggestion, onSuggest, onApplySuggestion, me, c }, band) {
    if (!band || photonEnergyDecades(band) <= WIDE_BAND_DECADES) return null;
    const anchored = narrowerBand(draft, workingNm, band);
    const shown = currentSuggestion(suggestion, draft);
    return h('div', { style: { fontSize: 11, color: '#e6a23c', lineHeight: 1.4 } },
        me.fitWideBand(photonEnergyDecades(band).toFixed(1)),
        anchored && ' ',
        anchored && !shown && h('button', {
            type: 'button', onClick: onSuggest, style: smallBtn(c),
        }, me.fitTryRange(rangeText(anchored[0]), rangeText(anchored[1]))),
        shown && h('div', { style: { marginTop: 4, color: c.text } },
            me.fitSuggestion(
                rangeText(shown.rangeNm[0]),
                rangeText(shown.rangeNm[1]),
                shown.fit.residuals.n.rms.toExponential(3),
            ),
            ' ',
            h('button', { type: 'button', onClick: onApplySuggestion, style: smallBtn(c) }, me.fitUseRange),
        ),
    );
}

// The two boxes the fit is taken between. A box left empty is the band the panel
// would use anyway, so it stands in the box as a placeholder rather than being
// typed in for the user, and a fit writes the band it used into both.
function renderFitRange({ draft, set, me, inputStyle, labelStyle }, fitBand) {
    const band = fitBand || tableRangeNm(draft.rows) || [0, 0];
    const box = (field, value, label) => h('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
        h('span', { style: labelStyle }, label),
        h('input', {
            type: 'number', min: 1, max: 99999999,
            value: draft[field] ?? '',
            placeholder: rangeText(value),
            onChange: event => set(field, event.target.value),
            style: { ...inputStyle, width: '100%', boxSizing: 'border-box' },
        }),
    );
    return h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px' } },
        box('fitRangeMinNm', band[0], me.fitRangeMin),
        box('fitRangeMaxNm', band[1], me.fitRangeMax),
    );
}

export function renderFitPanel(ctx) {
    const { draft, set, runFit, fitError, workingNm, me, c, sectionLabel, inputStyle } = ctx;
    const fit = draft.dispersionFit;
    const models = fitModelsForRows(draft.rows);
    // The band both the boxes and the note are about, read once: it walks the
    // whole table, and the form redraws on every keystroke.
    const band = fitRangeNm(draft, workingNm);
    return h('div', null,
        sectionLabel(me.dispersionFit),
        h('div', {
            style: {
                padding: 8, border: `1px solid ${c.border}`, borderRadius: 4,
                backgroundColor: c.panel, display: 'flex', flexDirection: 'column', gap: 7,
            },
        },
            renderFitRange(ctx, band),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                h('select', {
                    value: effectiveFitModel(draft),
                    onChange: event => set('fitModel', event.target.value),
                    style: { ...inputStyle, padding: '3px 6px' },
                },
                    models.map(id => h('option', { key: id, value: id }, FIT_MODEL_LABELS[id])),
                ),
                h('button', { type: 'button', onClick: () => runFit(), style: smallBtn(c) },
                    fit ? me.refit : me.fit),
                fit && h('button', {
                    type: 'button',
                    onClick: () => set('dispersionFit', null),
                    style: { ...smallBtn(c), color: '#ec7063' },
                }, me.removeFit),
            ),
            h('div', { style: { color: c.textDim, fontSize: 10, lineHeight: 1.4 } }, me.fitHint),
            renderBandNote(ctx, band),
            fit && h('div', { style: { fontSize: 11, color: c.text } },
                dispersionFitModelName(fit).replace(/^Fit: /, ''),
                h('br'),
                ...fitResidualText(fit, me),
            ),
            fit && renderFitDiagnostics(fit, me),
            fit && renderFitCoefficients(fit, c),
            fitError && h('div', { style: { color: '#ef5350', fontSize: 11 } }, fitError),
        ),
    );
}
