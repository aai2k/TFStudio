/**
 * Out-of-range wavelength detection (utils/materials/materialRange.js).
 *
 * The load-bearing rule is that only a *declared* range warns. Both the AGF
 * reader and the OptiLayer doc-meta reader substitute a hardcoded 0.3–2.5 µm
 * span when the file states no range, and a warning raised on that span would
 * fire for materials whose real range nobody knows.
 */
const { materialRangeNm, rangeExceeds, designRangeCoverage } =
  await import(new URL('../src/utils/materials/materialRange.js', import.meta.url));

let passed = 0;
function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

const declared = (id, minUm, maxUm) => ({
  id, name: id, lambdaMin: minUm, lambdaMax: maxUm, rangeDeclared: true,
});
const defaulted = (id) => ({ id, name: id, lambdaMin: 0.3, lambdaMax: 2.5, rangeDeclared: false });
const untagged = (id) => ({ id, name: id, lambdaMin: 0.3, lambdaMax: 2.5 });

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

console.log(`material_range: ${passed} passed`);
