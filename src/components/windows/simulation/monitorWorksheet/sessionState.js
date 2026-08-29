import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';

// The chip plan, the monitoring wavelengths and the chip glass belong to the
// coating being planned, so each design keeps its own and none carries across
// a design change. The plans start empty and are derived from the chip size
// until the user overrides a row; the chip glass follows the design substrate
// until another material is picked.
//
// The rest is the monitor itself: what it measures, how accurately, and the
// termination error a layer is allowed. That is a property of the coater rather
// than of the design, so those are the keys the Save button writes, and the
// same ones Settings edits.
export const monitorWorksheetSession = createWindowSession(
    {
        ...sessionDefaults('monitorWorksheet'),
        chipByStep: null, lambdaByStep: null, bulkLambda: null, chipMaterial: null,
        splitSizes: [58, 42],
    },
    {
        id: 'monitorWorksheet',
        scope: 'design',
        savable: registryKeys('monitorWorksheet'),
        // The wavelength the Set-all field offers starts at the design's own
        // reference wavelength, which is where a monitor is usually pointed
        // before anything else is known. Only while the field has never been
        // used: a design switched away from and back keeps what was entered,
        // as its chip plan does.
        onDesignChange: (design, current) => (current.bulkLambda == null
            ? { bulkLambda: design?.referenceWavelength || 550 }
            : null),
    },
);
