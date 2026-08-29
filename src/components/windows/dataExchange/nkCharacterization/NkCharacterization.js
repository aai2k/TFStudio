/**
 * n, k and thickness from a measured spectrum.
 *
 * Takes the reflectance and transmittance imported in Measured Spectra and
 * derives the optical constants and thickness of the film they were measured
 * from, then stores the result as a material.
 *
 * The extraction is in utils/materials/characterization/, with its sources. It
 * runs on a button rather than on every keystroke: it is a search over
 * interference orders, not a redraw, and a half-typed thickness is not a
 * question worth answering.
 */

import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { ActionButton } from '../../analysis/chrome/controls.js';
import { AnalysisWindow, CenteredMessage, PlotArea } from '../../analysis/chrome/layout.js';
import { CharacterizationChart } from './charts.js';
import { CharacterizationControls } from './CharacterizationControls.js';
import { buildCharacterizedDesign } from './resultDesign.js';
import {
    characterizationNotices, constantsCsv, resultColumns, resultRows, thicknessText,
} from './resultsModel.js';
import { newSaveDialogState, SaveMaterialDialog } from './SaveMaterialDialog.js';
import {
    saveCharacterizedMaterial, suggestedMaterialName, userCatalogs,
} from './saveMaterial.js';
import { useNkCharacterization } from './useNkCharacterization.js';

const { createElement: h, useState } = React;

/**
 * Storing the result: the material, and the design that reproduces it.
 *
 * Both go through one dialog because both need the material written first: a
 * design references a material by catalog id, so there is nothing to point a
 * layer at until it has been saved. Once it has, the design can still be built
 * from the same save rather than from a second copy of the material.
 */
export function SaveAction({ c, nk, state, onCreateDesign }) {
    const [saved, setSaved] = useState(null);
    const [dialog, setDialog] = useState(null);
    const catalogs = userCatalogs();
    const change = patch => setDialog(current => ({ ...current, ...patch, error: '' }));

    const openDesign = (stored) => onCreateDesign && onCreateDesign(buildCharacterizedDesign({
        design: state.design,
        settings: state.settings,
        chosen: state.chosen,
        result: state.result,
        materialId: `${stored.catalogId}:${stored.materialId}`,
        materialName: stored.name,
    }));

    const store = (thenOpenDesign) => {
        try {
            const stored = saveCharacterizedMaterial(state.result, {
                name: dialog.name.trim(),
                catalogId: dialog.catalogId,
                catalogName: dialog.catalogName.trim(),
            });
            setSaved(stored);
            setDialog(null);
            if (thenOpenDesign) openDesign(stored);
        } catch (caught) {
            change({ error: caught?.message || nk.saveError });
        }
    };

    return h(React.Fragment, null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            saved && h('span', {
                title: nk.saved(saved.name, saved.catalogName),
                style: {
                    color: c.success, fontSize: 11, maxWidth: 180,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                },
            }, nk.saved(saved.name, saved.catalogName)),
            // Offered again after a save so a design can be built from the
            // material already in the catalog rather than from a second copy.
            saved && h(ActionButton, {
                c, label: nk.openDesign,
                title: onCreateDesign ? nk.openDesignHint : nk.openDesignNoFolder,
                disabled: !onCreateDesign, onClick: () => openDesign(saved),
            }),
            h(ActionButton, {
                c, label: nk.save, title: nk.saveHint,
                onClick: () => setDialog(newSaveDialogState(
                    suggestedMaterialName(state.design, state.chosen), catalogs)),
            }),
        ),
        dialog && h(SaveMaterialDialog, {
            c, nk, catalogs, dialog,
            result: state.result,
            onChange: change,
            onSave: store,
            onCancel: () => setDialog(null),
            canOpenDesign: !!onCreateDesign,
        }),
    );
}

function ChartBody({ c, nk, state }) {
    const { result, view } = state;
    // The mode has nothing to fit, but the design does. Say which window brings
    // this kind in and leave the toolbar above alone, so the other mode is one
    // click away.
    if (state.curves.length === 0) {
        return h(CenteredMessage, {
            c,
            message: state.measurementMode === 'ellipsometry' ? nk.noEllipsometry : nk.noPhotometry,
        });
    }
    if (!result) return h(CenteredMessage, { c, message: nk.notRunYet });
    if (result.error) {
        return h(CenteredMessage, {
            c, message: nk.errors[result.error] || result.message || result.error,
        });
    }
    return h(CharacterizationChart, {
        result, c, view: view.view, showPointwise: view.showPointwise,
        labels: {
            measured: nk.measured, calculated: nk.calculated,
            pointwiseIndex: nk.pointwiseIndex, pointwiseExtinction: nk.pointwiseExtinction,
            residualAxis: nk.residualAxis, residualAxisDegrees: nk.residualAxisDegrees,
        },
    });
}

export function NkCharacterization({ c, t, onCreateDesign }) {
    const state = useNkCharacterization();
    const nk = t.nkCharacterization;
    const dt = t.dataTable;
    const solved = state.result && !state.result.error ? state.result : null;
    const columns = resultColumns(nk);
    const rows = solved ? resultRows(solved, nk) : [];
    const csv = useCsvExport(
        () => (solved ? constantsCsv(solved) : ''),
        () => `${(state.design?.name || 'film').replace(/[^\w.-]+/g, '_')}_nk.csv`,
    );

    if (!state.design) return h(CenteredMessage, { c, message: nk.noDesign });
    if (state.anyCurves.length === 0) return h(CenteredMessage, { c, message: nk.noCurves });

    return h(AnalysisWindow, { c },
        h(CharacterizationControls, {
            c, t, nk, state,
            notices: characterizationNotices(state.result, nk, state.stale),
        }),
        h(PlotArea, null, h(ChartBody, { c, nk, state })),
        h(ResultsSection, {
            c, label: nk.results,
            summary: solved ? `d = ${thicknessText(solved, nk)}` : nk.notRunYet,
            open: state.view.showResults,
            setOpen: value => state.setViewField('showResults', value),
            actions: solved && h('div', {
                style: { display: 'flex', alignItems: 'center', gap: 8 },
            },
                h(SaveAction, { c, nk, state, onCreateDesign }),
                h(ExportMenu, {
                    c, enabled: rows.length > 0, ...csv,
                    labels: {
                        export: dt.export, copyCsv: dt.copyCsv, saveCsv: dt.saveCsv,
                        copied: dt.csvCopied, saved: dt.csvSaved,
                    },
                }),
            ),
        }, h(ResultsGrid, { columns, rows, c })),
    );
}
