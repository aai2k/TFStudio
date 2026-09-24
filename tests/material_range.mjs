/**
 * Out-of-range wavelength detection (utils/materials/materialRange.js).
 *
 * The load-bearing rule is that only a *declared* range warns. Both the AGF
 * reader and the OptiLayer doc-meta reader substitute a hardcoded 0.3–2.5 µm
 * span when the file states no range, and a warning raised on that span would
 * fire for materials whose real range nobody knows.
 */
const { materialRangeNm, rangeExceeds, designRangeCoverage, materialsRangeCoverage,
  uncoveredRegions, uncoveredMaterialRegions, clampToCovered, clampLambdaToCovered } =
  await import(new URL('../src/utils/materials/materialRange.js', import.meta.url));

let passed = 0;
function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

// A record resolves only when it holds optical constants, so each carries the
// simplest there is: a one-term Cauchy series, n = 1.5 at every wavelength.
const CONSTANT_INDEX = { formulaNum: 102, coefficients: [1.5] };
const declared = (id, minUm, maxUm) => ({
  id, name: id, ...CONSTANT_INDEX, lambdaMin: minUm, lambdaMax: maxUm, rangeDeclared: true,
});
const defaulted = (id) => ({ id, name: id, ...CONSTANT_INDEX, lambdaMin: 0.3, lambdaMax: 2.5, rangeDeclared: false });
const untagged = (id) => ({ id, name: id, ...CONSTANT_INDEX, lambdaMin: 0.3, lambdaMax: 2.5 });

// ── materialRangeNm: µm in, nm out, null when nothing is declared ───────────
{
  ok(materialRangeNm(null) === null, 'no material yields no range');
  ok(materialRangeNm(undefined) === null, 'undefined yields no range');

  const range = materialRangeNm(declared('SiO2', 0.21, 6.7));
  ok(range[0] === 210 && range[1] === 6700, 'a declared range converts µm to nm');

  ok(materialRangeNm(defaulted('AGF glass')) === null,
    'a defaulted range is not a declaration');
  ok(materialRangeNm(untagged('legacy')) === null,
    'an untagged material is treated as undeclared, not as covering everything');

  // A tabulated material's extent is a declaration by construction: there is no
  // row past the last one to extrapolate from.
  ok(materialRangeNm({ lambdaMin: 0.4, lambdaMax: 0.8, tabData: [[400, 1.5, 0]] })[1] === 800,
    'tabulated data declares its own extent without the flag');
  ok(materialRangeNm({ lambdaMin: 0.4, lambdaMax: 0.8, tabData: [] }) === null,
    'an empty table declares nothing');

  ok(materialRangeNm({ lambdaMin: 2, lambdaMax: 1, rangeDeclared: true }) === null,
    'an inverted range is rejected rather than silently reordered');
  ok(materialRangeNm({ lambdaMin: NaN, lambdaMax: 1, rangeDeclared: true }) === null,
    'a non-finite bound is rejected');
  ok(materialRangeNm({ lambdaMin: 1, lambdaMax: 1, rangeDeclared: true }) === null,
    'a zero-width range is rejected');
}

// ── The reported range is the range that can actually be evaluated ──────────
//
// n and k can come from different sources. BK7 states the 300 to 2500 nm
// validity of its Sellmeier n, while the k table derived from its internal
// transmittance starts at 310, and the point evaluators refuse everything below
// that. A range that still read 300 warned about a span ten nanometres wider
// than the one the window would draw, so the first 10 nm went missing with no
// notice, no band and no fix button.
{
  const { buildBuiltinCatalog } = await import(
    new URL('../src/utils/materials/catalogManager/builtinCatalog.js', import.meta.url));
  const { materialOmegaResponse } = await import(
    new URL('../src/utils/materials/materialDispersion.js', import.meta.url));

  const bk7 = buildBuiltinCatalog().materials.BK7;
  ok(bk7.lambdaMin === 0.3 && bk7.lambdaMax === 2.5,
    'the material still declares the validity range of its Sellmeier n');

  const range = materialRangeNm(bk7);
  ok(range[0] === 310 && range[1] === 2500,
    'and the reported range is that intersected with the k table');
  ok(materialOmegaResponse(bk7, range[0]).inRange && materialOmegaResponse(bk7, range[1]).inRange,
    'both ends of the reported range evaluate');
  ok(!materialOmegaResponse(bk7, range[0] - 0.1).inRange,
    'and the wavelength below the low end does not');

  // A tabulated material's own extent bounds it the same way, whether or not
  // the record around it states one.
  const table = { formulaNum: -1, interp: 'pchip', tabData: [[400, 1.5, 0], [600, 1.6, 0]] };
  const { makeGetNK } = await import(
    new URL('../src/utils/materials/catalogManager/dispersion.js', import.meta.url));
  const tabulated = { id: 'x:table', name: 'Table', ...table, getNK: makeGetNK(table) };
  const built = materialRangeNm(tabulated);
  ok(built[0] === 400 && built[1] === 600, 'a table with no stated bounds reports its own');

  // Which kind of outside it is. Past its last row a table holds the end value,
  // so its index has no slope out there and the material adds no dispersion at
  // all; a formula carries on past the band it was fitted over.
  const { offenders } = materialsRangeCoverage([
    { id: 'x:table', material: tabulated },
    { id: 'x:formula', material: declared('x:formula', 0.4, 0.6) },
  ], [300, 900]);
  ok(offenders.find(item => item.id === 'x:table').heldFlat === true,
    'a tabulated index is reported as held flat outside its range');
  ok(offenders.find(item => item.id === 'x:formula').heldFlat === false,
    'and an analytic one is not');
  const bare = { id: 'x:bare', lambdaMin: 0.4, lambdaMax: 0.6, ...table };
  ok(materialsRangeCoverage([{ id: 'x:bare', material: bare }], [300, 900])
    .offenders[0].heldFlat === true,
    'a table is held flat whether or not a sampler has been built over it');

  // A k table stops the material dead whether or not the file it came from
  // stated a range. An AGF glass with internal-transmittance rows and no LD
  // record is the case: the evaluator refuses outside the table, so a notice
  // that stayed silent there would disagree with the merit function.
  const kOnly = { formulaNum: 1, coefficients: [1, 0, 0, 0, 0, 0], rangeDeclared: false,
    kTable: [{ lam_um: 0.4, k: 1e-7 }, { lam_um: 0.9, k: 2e-7 }] };
  const undeclared = materialRangeNm({ ...kOnly, getNK: makeGetNK(kOnly) });
  ok(undeclared[0] === 400 && undeclared[1] === 900,
    'a k table gives a range even when the material declares none');

  // The two can fail to overlap, which is a k table entered in the wrong unit.
  // The material can then be read nowhere, and that is the one it is least
  // acceptable to say nothing about.
  const wrongUnit = { formulaNum: 1, coefficients: [1, 0, 0, 0, 0, 0],
    lambdaMin: 0.4, lambdaMax: 0.8, rangeDeclared: true,
    kTable: [{ lam_um: 1.0, k: 1e-7 }, { lam_um: 2.0, k: 2e-7 }] };
  const disjoint = materialRangeNm({ ...wrongUnit, getNK: makeGetNK(wrongUnit) });
  ok(disjoint[0] === 400 && disjoint[1] === 800,
    'an empty intersection still reports a range rather than dropping the warning');
}

// ── uncoveredMaterialRegions: the same bands over an explicit material list ──
{
  const materials = [
    { id: 'x:narrow', material: declared('x:narrow', 0.4, 0.7) },
    { id: null, material: declared('unset', 0.5, 0.6) },
  ];
  const regions = uncoveredMaterialRegions(materials, [300, 900]);
  ok(regions.length === 2, 'one region per contiguous uncovered span');
  ok(regions[0].x0 === 300 && regions[0].x1 === 400 && regions[0].materials[0] === 'x:narrow',
    'the low region runs to the material edge and names it');
  ok(regions[1].x0 === 700 && regions[1].x1 === 900, 'and the high region starts at the other');
  ok(uncoveredMaterialRegions(materials, [450, 650]).length === 0,
    'a covered range draws no bands');
  ok(uncoveredMaterialRegions([], [300, 900]).length === 0, 'no materials, no bands');
}

// ── rangeExceeds: touching the limits exactly must not warn ─────────────────
{
  const band = [400, 800];
  ok(rangeExceeds(band, [399, 800]) === true, 'reaching below the minimum exceeds');
  ok(rangeExceeds(band, [400, 801]) === true, 'reaching above the maximum exceeds');
  ok(rangeExceeds(band, [400, 800]) === false, 'an exactly touching range does not exceed');
  ok(rangeExceeds(band, [450, 700]) === false, 'a contained range does not exceed');
  ok(rangeExceeds(band, [400 - 1e-9, 800 + 1e-9]) === false,
    'floating-point dust at the edges does not warn');
}

// ── designRangeCoverage ────────────────────────────────────────────────────
const designWith = (materials) => ({
  incidentMedium: 'builtin:Air',
  substrate: { material: 'x:sub' },
  frontLayers: Object.keys(materials)
    .filter(id => id !== 'x:sub')
    .map(id => ({ material: id, thickness: 100 })),
  materials,
});

{
  // Air is a built-in with no declared range, and is skipped rather than
  // treated as covering nothing.
  const narrow = designWith({
    'x:sub': declared('x:sub', 0.3, 2.5),
    'x:narrow': declared('x:narrow', 0.4, 0.7),
  });

  const inside = designRangeCoverage(narrow, [450, 650]);
  ok(inside.offenders.length === 0, 'a range inside every material warns about nothing');
  ok(inside.covered[0] === 400 && inside.covered[1] === 700,
    'covered is the intersection of the declared ranges');

  const outside = designRangeCoverage(narrow, [200, 900]);
  ok(outside.offenders.length === 2, 'both materials are reported when both are exceeded');

  const oneOffender = designRangeCoverage(narrow, [400, 900]);
  ok(oneOffender.offenders.length === 1, 'only the material actually exceeded is reported');
  ok(oneOffender.offenders[0].id === 'x:narrow', 'the narrow material is the offender');
  ok(oneOffender.offenders[0].rangeNm[0] === 400 && oneOffender.offenders[0].rangeNm[1] === 700,
    'the offender carries its own range in nm');

  const touching = designRangeCoverage(narrow, [400, 700]);
  ok(touching.offenders.length === 0,
    'a range exactly touching the narrowest material does not warn');
}

// ── materialsRangeCoverage: the same rule over an explicit material list ───
//
// For a window that computes with a stack other than the design's own: the
// Process Exporter reads the part or a witness chip in air, so it checks the
// materials in the chamber rather than the design's.
{
  const entries = [
    { id: 'Air', material: { id: 'Air', name: 'Air' } },
    { id: 'x:chip', material: declared('x:chip', 0.35, 2.0) },
    { id: 'x:narrow', material: declared('x:narrow', 0.4, 0.7) },
    { id: 'x:narrow', material: declared('x:narrow', 0.4, 0.7) },
    { id: null, material: declared('unset', 0.5, 0.6) },
  ];

  const outside = materialsRangeCoverage(entries, [300, 900]);
  ok(outside.offenders.map(item => item.id).join() === 'x:chip,x:narrow',
    'each declared material short of the range is reported once, in list order');
  ok(outside.covered[0] === 400 && outside.covered[1] === 700,
    'covered is the intersection of the declared ranges');

  const inside = materialsRangeCoverage(entries, [450, 650]);
  ok(inside.offenders.length === 0, 'a range inside every material warns about nothing');

  ok(materialsRangeCoverage([], [300, 900]).covered === null,
    'no materials, no known covered span');
  ok(materialsRangeCoverage(entries, null).offenders.length === 0, 'no range, no offenders');

  // designRangeCoverage is the same check over the design's resolved materials.
  const viaDesign = designRangeCoverage(
    designWith({ 'x:sub': declared('x:sub', 0.35, 2.0), 'x:narrow': declared('x:narrow', 0.4, 0.7) }),
    [300, 900]);
  ok(viaDesign.offenders.map(item => item.id).join() === 'x:sub,x:narrow'
    && viaDesign.covered[0] === 400 && viaDesign.covered[1] === 700,
    'a design resolves to the same offenders and covered span');
}

// ── A defaulted range never warns, even far outside it ─────────────────────
{
  const mixed = designWith({
    'x:sub': defaulted('x:sub'),
    'x:legacy': untagged('x:legacy'),
    'x:real': declared('x:real', 0.4, 0.7),
  });

  const wide = designRangeCoverage(mixed, [200, 5000]);
  ok(wide.offenders.length === 1, 'only the material with a declared range warns');
  ok(wide.offenders[0].id === 'x:real', 'the declared material is the one reported');
  ok(wide.covered[0] === 400 && wide.covered[1] === 700,
    'coverage ignores materials that declare no range');

  const allDefaulted = designRangeCoverage(
    designWith({ 'x:sub': defaulted('x:sub'), 'x:b': untagged('x:b') }), [100, 9000]);
  ok(allDefaulted.offenders.length === 0, 'a design of undeclared materials never warns');
  ok(allDefaulted.covered === null, 'and reports no known covered span');
}

// ── Degenerate inputs ──────────────────────────────────────────────────────
{
  const design = designWith({ 'x:sub': declared('x:sub', 0.4, 0.7) });
  ok(designRangeCoverage(null, [400, 800]).offenders.length === 0, 'no design, no offenders');
  ok(designRangeCoverage(design, null).offenders.length === 0, 'no range, no offenders');
  ok(designRangeCoverage(design, [NaN, 800]).offenders.length === 0, 'NaN bound is ignored');
  ok(designRangeCoverage(design, [900, 300]).offenders.length === 1,
    'a reversed evaluated range is normalized, not skipped');
}

// ── uncoveredRegions: merged plot bands from the same coverage rule ────────
{
  const design = designWith({
    'x:sub': declared('x:sub', 0.35, 0.9),
    'x:narrow': declared('x:narrow', 0.4, 0.7),
  });

  const regions = uncoveredRegions(design, [300, 1100]);
  ok(regions.length === 2, 'one region per contiguous uncovered span');
  ok(regions[0].x0 === 300 && regions[0].x1 === 400,
    'the low region runs to the last material edge inside it');
  ok(regions[0].materials.length === 2,
    'overlapping shortfalls merge into one region naming both materials');
  ok(regions[1].x0 === 700 && regions[1].x1 === 1100,
    'the high region starts at the first material edge inside it');

  const oneSide = uncoveredRegions(design, [400, 1100]);
  ok(oneSide.length === 1 && oneSide[0].x0 === 700,
    'a range covered at one end produces only the other end');
  ok(oneSide[0].materials[0] === 'x:narrow' && oneSide[0].materials[1] === 'x:sub',
    'the merged region lists each offender once');

  ok(uncoveredRegions(design, [450, 650]).length === 0,
    'a fully covered range draws no bands');
  ok(uncoveredRegions(design, [1100, 300]).length === 2,
    'a reversed evaluated range is normalized');
  ok(uncoveredRegions(null, [300, 1100]).length === 0, 'no design, no bands');
  ok(uncoveredRegions(design, null).length === 0, 'no range, no bands');

  // A material whose whole declared range sits outside the evaluated span
  // shades the entire span, not a negative-width sliver.
  const far = designWith({ 'x:ir': declared('x:ir', 2.0, 12.0) });
  const whole = uncoveredRegions(far, [400, 700]);
  ok(whole.length === 1 && whole[0].x0 === 400 && whole[0].x1 === 700,
    'a material with no data anywhere in the span shades all of it');
}

// ── clampToCovered: the range the warning's fix button applies ─────────────
{
  ok(clampToCovered(null, [400, 800]) === null, 'no covered span, nothing to set');
  ok(clampToCovered([370.1, 826.6], null) === null, 'no evaluated range, nothing to set');

  const clipped = clampToCovered([370.1, 826.6], [360, 1000]);
  ok(clipped[0] === 370.1 && clipped[1] === 826.6,
    'a range reaching out both sides is clipped to the covered span');

  const oneEnd = clampToCovered([370.1, 826.6], [400, 1000]);
  ok(oneEnd[0] === 400 && oneEnd[1] === 826.6,
    'an end already inside the covered span is left where the user put it');

  const disjoint = clampToCovered([2000, 12000], [400, 700]);
  ok(disjoint[0] === 2000 && disjoint[1] === 12000,
    'a range with no overlap moves to the covered span instead of collapsing');

  const dusty = clampToCovered([370.0999999999, 826.6000000001], [300, 900]);
  ok(dusty[0] === 370.1 && dusty[1] === 826.6,
    'floating-point dust rounds onto 0.1 nm without leaving the covered span');

  const inward = clampToCovered([370.14, 826.57], [300, 900]);
  ok(inward[0] === 370.2 && inward[1] === 826.5,
    'bounds round inward, so the applied range cannot re-raise the warning');

  ok(clampToCovered([500.04, 500.06], [300, 900]) === null,
    'a covered span too narrow to hold a 0.1 nm range yields nothing');
}

// ── Undeclared ranges never shade ──────────────────────────────────────────
{
  const design = designWith({ 'x:sub': defaulted('x:sub'), 'x:b': untagged('x:b') });
  ok(uncoveredRegions(design, [100, 9000]).length === 0,
    'placeholder ranges draw no bands, matching the notice');
}

// ── Parser tagging: the flag reaches the material records ──────────────────
{
  const { parseAGF } = await import(new URL('../src/utils/materials/agfParser.js', import.meta.url));

  const withLD = parseAGF([
    'NM SAMPLE 2 0 1.5 60 0 0',
    'CD 1 0 1 0 1 0 0 0 0 0',
    'LD 0.365 1.014',
  ].join('\n'));
  const declaredGlass = Object.values(withLD.materials)[0];
  ok(declaredGlass.rangeDeclared === true, 'an LD record declares the range');
  ok(materialRangeNm(declaredGlass)[0] === 365, 'and it reads back in nm');

  const withoutLD = parseAGF([
    'NM NORANGE 2 0 1.5 60 0 0',
    'CD 1 0 1 0 1 0 0 0 0 0',
  ].join('\n'));
  const fallbackGlass = Object.values(withoutLD.materials)[0];
  ok(fallbackGlass.rangeDeclared === false, 'a glass with no LD record declares no range');
  ok(fallbackGlass.lambdaMin === 0.3 && fallbackGlass.lambdaMax === 2.5,
    'the placeholder span is still populated for everything else that reads it');
  ok(materialRangeNm(fallbackGlass) === null, 'and it cannot raise a warning');
}

// Formula documents often include sampled n/k arrays as a verification cache,
// but TFStudio evaluates their analytic coefficients and does not retain those
// samples as tabData. The explicit flag must therefore survive parsing.
{
  const { parseOptiLayerDoc } = await import(
    new URL('../src/utils/materials/optilayerParser.js', import.meta.url));
  const formula = parseOptiLayerDoc({
    name: 'Opti formula', nType: 5, kType: 0,
    wavelength: [400, 800], n: [1.5, 1.5], k: [0, 0],
    nFormulaCoef: [1.5, 0, 0],
  });
  ok(formula.formulaNum === 102 && formula.tabData === undefined,
    'the fixture follows the analytic OptiLayer path');
  ok(formula.rangeDeclared === true,
    'the sampled OptiLayer grid declares the analytic validity range');
  const range = materialRangeNm(formula);
  ok(range?.[0] === 400 && range?.[1] === 800,
    'an analytic OptiLayer material exposes its declared range in nm');

  const tabular = parseOptiLayerDoc({
    name: 'Opti table', nType: 0, kType: 0,
    wavelength: [400, 550, 800], n: [1.6, 1.5, 1.45], k: [0, 0, 0],
  });
  ok(tabular.formulaNum === -1 && tabular.interp === 'pchip',
    'an OptiLayer table stores the PCHIP rule');
}

// ── clampLambdaToCovered: what the fix button offers a single-wavelength window ─
//
// Those windows evaluate at one wavelength, so there is no range to pull in and
// the fix moves the wavelength itself onto data every material has.
{
  const covered = [300, 2480];
  ok(clampLambdaToCovered(covered, 2600) === 2480, 'past the top, it comes back to the top');
  ok(clampLambdaToCovered(covered, 250) === 300, 'below the bottom, it comes up to the bottom');
  ok(clampLambdaToCovered(covered, 1000) === null,
    'a wavelength already covered offers no button, because there is nothing to fix');
  ok(clampLambdaToCovered(covered, 300) === null && clampLambdaToCovered(covered, 2480) === null,
    'and neither does one sitting exactly on a limit');
  ok(clampLambdaToCovered(null, 2600) === null, 'no covered span, nothing to move to');
  ok(clampLambdaToCovered(covered, Number.NaN) === null, 'nor for a wavelength that is not one');

  // Rounded inward, so applying the result cannot re-raise the warning it clears.
  ok(clampLambdaToCovered([300.04, 2480.06], 2600) === 2480,
    'the top is rounded down onto 0.1 nm rather than up past the data');
  ok(clampLambdaToCovered([300.04, 2480.06], 250) === 300.1,
    'and the bottom is rounded up');
}

console.log(`material_range: ${passed} passed`);
