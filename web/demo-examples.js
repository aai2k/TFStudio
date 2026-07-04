// web/demo-examples.js — curated, read-only example designs for the web demo.
//
// Each object matches TFStudio's design schema (see makeDefaultDesign in
// src/state/DesignContext.js): thicknesses are PHYSICAL nm, substrate thickness is
// mm, materials are names from the 16-material built-in library (materialDatabase.js).
//
// These are canonical textbook starting stacks (quarter-wave AR / HR / edge filter
// designs). The optical engine computes the *true* spectrum live in the browser, so
// nothing here asserts a result — they are honest starting points a user can open,
// evaluate, and explore. Quarter-wave physical thickness d = λ0 / (4·n), λ0 = 550 nm.
//
// Loaded as a PLAIN script BEFORE demo-shim.js, exposing window.DEMO_EXAMPLES.

(function () {
  'use strict';

  const layer = (i, material, thickness) => ({
    id: `demo-l-${i}`, material, thickness, locked: false,
  });

  // (H L) repeats for a quarter-wave high reflector at 550 nm.
  // TiO2 QWOT ≈ 58.5 nm (n≈2.35), SiO2 QWOT ≈ 94.2 nm (n≈1.46).
  const qwHR = [];
  for (let k = 0; k < 7; k++) {
    qwHR.push(layer(qwHR.length + 1, 'TiO2', 58.5));
    qwHR.push(layer(qwHR.length + 1, 'SiO2', 94.2));
  }
  qwHR.push(layer(qwHR.length + 1, 'TiO2', 58.5)); // 15 layers: (HL)^7 H

  const base = {
    incidentMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    exitMedium: 'Air',
    surfaceMode: 'front_only',
    mfEvalMode: 'side',
    backLayers: [],
    referenceWavelength: 550,
  };

  const examples = [
    Object.assign({}, base, {
      id: 'demo-mgf2-ar',
      name: 'Single-layer AR (MgF₂)',
      notes: 'Classic single-layer antireflection coating: one quarter-wave of MgF₂ '
           + '(≈99.6 nm) on BK7, reference 550 nm. Open Optical Evaluation to see the '
           + 'reflectance dip near the design wavelength.',
      frontLayers: [layer(1, 'MgF2', 99.6)],
    }),
    Object.assign({}, base, {
      id: 'demo-bbar-4',
      name: 'Broadband AR — 4 layer (Ta₂O₅/SiO₂/MgF₂)',
      notes: 'A four-layer antireflection coating on BK7 (MgF₂ outer / Ta₂O₅ / SiO₂ / '
           + 'Ta₂O₅). Evaluate over 400–800 nm: reflectance drops below ~1% across the '
           + '500–700 nm core band. Layers are stored air-side first.',
      // air-side → substrate-side; verified against the spectrum engine.
      frontLayers: [
        layer(1, 'MgF2', 86.19),
        layer(2, 'Ta2O5', 118.07),
        layer(3, 'SiO2', 387.70),
        layer(4, 'Ta2O5', 134.23),
      ],
    }),
    Object.assign({}, base, {
      id: 'demo-hr-qw',
      name: 'High reflector — QW stack (TiO₂/SiO₂)',
      notes: 'A 15-layer quarter-wave high-reflector centred at 550 nm: (TiO₂ HL)⁷ + TiO₂. '
           + 'Evaluate to see the high-reflectance stopband around the design wavelength.',
      frontLayers: qwHR,
    }),
    Object.assign({}, base, {
      id: 'demo-metal-ag',
      name: 'Metal mirror (Ag)',
      notes: 'A 120 nm opaque silver mirror on BK7 with a thin SiO₂ protective overcoat. '
           + 'Evaluate reflectance across the visible — note silver uses tabulated complex n,k.',
      frontLayers: [
        layer(1, 'Ag', 120.0),
        layer(2, 'SiO2', 80.0),
      ],
    }),
    Object.assign({}, base, {
      id: 'demo-edge',
      name: 'Edge filter — QW stack',
      notes: 'A longer quarter-wave dielectric stack forms a reflective edge/stopband. '
           + 'Compare the band edges as you change the reference wavelength.',
      frontLayers: (function () {
        const a = [];
        for (let k = 0; k < 10; k++) {
          a.push(layer(a.length + 1, 'Ta2O5', 64.0)); // Ta2O5 QWOT ≈ 64 nm
          a.push(layer(a.length + 1, 'SiO2', 94.2));
        }
        return a;
      })(),
    }),
  ];

  window.DEMO_EXAMPLES = examples;
})();
