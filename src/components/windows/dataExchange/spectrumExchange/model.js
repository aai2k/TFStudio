import { buildJcampDx } from '../../../../utils/io/jcampDx.js';
import { designSpectrumColumns } from '../../../../utils/io/designSpectrum.js';
import { curvesToCsv, tableToCsv, X_UNITS } from '../../../../utils/io/spectrumTable.js';

export function delimiterName(delimiter, sx) {
    if (delimiter === ',') return sx.delimComma;
    if (delimiter === ';') return sx.delimSemicolon;
    if (delimiter === '\t') return sx.delimTab;
    return sx.delimWhitespace;
}

export function isJcampText(text) {
    return /##\s*(TITLE|JCAMP)/i.test(text);
}

export function measuredExportDocument(design, expFormat) {
    const list = design.measuredCurves || [];
    const base = (design.name || 'spectrum').replace(/[^\w.-]+/g, '_');
    if (expFormat === 'jcamp') {
        const spectra = list.map((curve) => ({
            title: curve.name,
            xUnit: X_UNITS.NM,
            quantity: curve.quantity,
            isAbsorbance: curve.quantity === 'A',
            x: curve.x,
            y: curve.y,
        }));
        return {
            text: buildJcampDx(spectra, { title: `${design.name || 'spectra'} (measured)` }),
            fileName: `${base}_measured.dx`,
        };
    }
    return { text: curvesToCsv(list), fileName: `${base}_measured.csv` };
}

export function designExportSelection(dAoi, dQ) {
    const thetas = String(dAoi).split(',').map((value) => parseFloat(value.trim())).filter(Number.isFinite);
    return {
        thetas: thetas.length ? thetas : [0],
        quantities: ['T', 'R', 'A'].filter((quantity) => dQ[quantity]),
    };
}

export function designExportBaseName(design) {
    return (design.name || 'design').replace(/[^\w.-]+/g, '_');
}

function jcampDesignSpectra(spec, design, quantities, includeSP) {
    const pols = includeSP ? ['avg', 's', 'p'] : ['avg'];
    const polKey = {
        avg: { T: 'T', R: 'R', A: 'A' },
        s: { T: 'Ts', R: 'Rs' },
        p: { T: 'Tp', R: 'Rp' },
    };
    const multi = spec.series.length > 1;
    const spectra = [];
    spec.series.forEach((series) => {
        const suffix = multi ? ` @${Number.isInteger(series.theta) ? series.theta : series.theta.toFixed(1)}°` : '';
        pols.forEach((pol) => quantities.forEach((quantity) => {
            const key = polKey[pol]?.[quantity];
            if (!key || !series[key]) return;
            const polLabel = pol === 'avg' ? '' : ` ${pol}`;
            spectra.push({
                title: `${design.name || 'design'} ${quantity}${polLabel}${suffix}`,
                xUnit: X_UNITS.NM,
                quantity,
                isAbsorbance: quantity === 'A',
                x: spec.lambda,
                y: series[key],
            });
        }));
    });
    return spectra;
}

export function designExportDocument({ spec, design, quantities, includeSP, expFormat, base }) {
    if (expFormat === 'jcamp') {
        const spectra = jcampDesignSpectra(spec, design, quantities, includeSP);
        return {
            text: buildJcampDx(spectra, { title: `${design.name || 'design'} spectrum` }),
            fileName: `${base}_spectrum.dx`,
        };
    }
    const columns = designSpectrumColumns(spec, {
        quantities,
        pols: includeSP ? ['avg', 's', 'p'] : ['avg'],
    });
    return { text: tableToCsv(columns), fileName: `${base}_spectrum.csv` };
}
