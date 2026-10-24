"""Test helper for tests/python_client.mjs: drives the objects of the tfstudio
package (python/) and prints what each gave, one JSON object per line,
beside the design it computed on, so that the test computes each with the
API's calls and compares.

    python -B -I tests/_pythonObjects.py objects <folder holding tfstudio>

The first line on stdin is the input, as JSON: { name, pool, settingNames,
dataDir, measured, specKinds }, dataDir a data folder whose user catalog
holds two materials named Twin, measured a design file with a measured curve,
and specKinds the checks to add to it, each [kind, wavelengths, keyword
arguments, the fields the test gives setSpecification].
"""

import copy
import inspect
import json
import sys
import time

# The package is imported from the folder given, ahead of any installed one.
sys.path.insert(0, sys.argv[2])

import tfstudio
from tfstudio._names import api_name


def out(value):
    print(json.dumps(value), flush=True)


def refused(make):
    """The message of the TFStudioError `make()` raises, or None."""
    try:
        make()
    except tfstudio.TFStudioError as err:
        return str(err)
    return None


def objects(given):
    """Each object's answers, in the order the test checks them."""
    with tfstudio.TFStudio() as tf:
        design = tf.new_design("Stack", substrate="BK7", reference=550)
        out({"new": design._data})
        set_up(design)
        design.stack("(HL)^3 H", H="TiO2", L="SiO2", at=600)
        out({"stacked": design._data, "stackOption": refused(lambda: design.copy().stack("HL", sid="back"))})
        stacked_back(design)
        layers_and_back(design)
        files(tf, design)
        modes(design)
        materials(tf, given)
        spectra(design)
        merit(design)
        specification(tf, design, given)
        yields(tf)
        cleaning(tf)
        design_edits(tf)
        stack_views(tf)
        admittance_and_field(tf)
        colour_and_integrals(tf)
        ellipsometry(tf)
        group_delay(tf)
        material_dispersion(tf)
        band_features(tf)
        runs(design, given)
        progress(design, given)
        stopping(design, given)
        refusals(tf, design)
        out({"names": public_names()})


def set_up(design):
    """The setup attributes set on a copy of the new design and read back;
    the two media differ from each other and from Air, so a swap or an
    attribute that sets nothing shows."""
    setup = design.copy()
    setup.name = "Set up"
    setup.reference = 600
    setup.substrate.material = "SiO2"
    setup.substrate.thickness = 3
    setup.incident_medium = "MgF2"
    setup.exit_medium = "Al2O3"
    out({"setup": setup._data, "setupRead": [setup.name, setup.reference, setup.substrate.material,
                                              setup.substrate.thickness, setup.incident_medium, setup.exit_medium]})


def stacked_back(design):
    """stack() on the back of a copy coated on both sides, from the incident
    medium in; "HL" has two unlike layers, so their order shows."""
    two = design.copy()
    two.sides = "both"
    before = two._data
    two.stack("HL", side="back", from_substrate=False, H="Ta2O5")
    out({"stackedBack": [before, two._data]})


def listed(layers):
    return [[layer.number, layer.side, layer.material, layer.thickness, layer.locked] for layer in layers]


def text_of(path):
    with open(path, "rb") as file:
        return file.read().decode("utf-8")


def files(tf, design):
    """save() of the design to a new file, its refusal of that file then,
    open_design() of it, and save() of a changed copy over it."""
    design.save("saved.tfs")
    first = text_of("saved.tfs")
    try:
        design.save("saved.tfs")
        taken = None
    except tfstudio.TFStudioError as err:
        taken = [type(err).__name__, str(err)]
    kept = text_of("saved.tfs") == first
    opened = tf.open_design("saved.tfs")._data
    changed = design.copy()
    changed.layers[1].thickness = 33
    changed.save("saved.tfs", overwrite=True)
    out({"saved": {"first": first, "refused": taken, "kept": kept, "opened": opened, "changed": changed._data,
                   "over": text_of("saved.tfs")}})


def layers_and_back(design):
    """Layer edits by number on the front, then on the back of a copy coated
    on both sides, and the refusals of numbers a side has no layer of."""
    design.layers[1].thickness = 12.5
    design.layers[3].locked = True
    design.layers[2].material = "Ta2O5"
    design.layers.append("MgF2", 95)
    design.layers.insert(2, "Al2O3", 20)
    design.layers.remove(4)
    count = len(design.layers)
    out({"edited": design._data, "listed": listed(design.layers), "first": design.layers[1].thickness,
         "refusals": [refused(lambda: design.layers[0]), refused(lambda: design.layers[count + 1]),
                      refused(lambda: design.layers.insert(count + 2, "SiO2", 10)), refused(lambda: design.layers["1"]),
                      refused(lambda: design.layers[True])]})
    both = design.copy()
    both.sides = "both"
    both.back_layers.append("SiO2", 100)
    both.back_layers.append("TiO2", 30)
    both.back_layers.insert(1, "MgF2", 40)
    both.back_layers[2].thickness = 21
    both.back_layers.remove(3)
    out({"back": both._data, "backListed": listed(both.back_layers), "copyApart": design._data["surfaceMode"]})
    symmetric = both.copy()
    symmetric.sides = "symmetric"

    def thicker():
        symmetric.back_layers[1].thickness = 5

    out({"symmetricBack": refused(thicker)})


def modes(design):
    """sides and score_on set, read back, held as the API names them, and the
    mode a spectrum, a Monte Carlo run, a refinement and a layer ranking
    report for each pair."""
    both = design.copy()
    both.sides = "both"
    both.back_layers.append("SiO2", 100)
    both.merit.add("RAV", 450, 650, target=0)
    out({"twoSided": both._data})
    ranked(both)
    found = []
    facts = []
    for sides in ("front", "back", "both", "symmetric"):
        for score_on in ("side", "whole part"):
            each = both.copy()
            each.sides = sides
            each.score_on = score_on
            found.append([sides, score_on, each.sides, each.score_on, each._data["surfaceMode"], each._data["mfEvalMode"],
                          each.spectrum(500, 600, step=50).mode, each.monte_carlo(500, 600, step=50, runs=1, seed=1).mode,
                          each.refine(max_iter=1).mode, each.layer_sensitivity().mode, each.index_profile().mode,
                          each.layer_thicknesses().mode])
            facts.append([each._data, each.total_thickness()])

    def sides():
        both.sides = "two"

    def score_on():
        both.score_on = "total"

    out({"modes": found, "modeFacts": facts, "badSides": refused(sides), "badScoreOn": refused(score_on)})


def ranking(sensitivity):
    return [[r.side, r.number, r.material, r.thickness, r.step, r.merit_change, r.signed_merit_change, r.sensitivity,
             r.locked] for r in sensitivity.rows]


def ranked(both):
    """Layer rankings of a two-sided design with two back layers and a
    locked front one: with the defaults, by a step in percent with the
    locked layers scored, and by the default step in percent; and a step
    that is not one."""
    design = both.copy()
    design.back_layers.append("TiO2", 30)
    design.layers[1].locked = True
    percent = design.layer_sensitivity(step="percent", rel_pct=3, include_locked=True)
    rows = [ranking(design.layer_sensitivity()), ranking(percent), ranking(design.layer_sensitivity(step="percent"))]
    out({"ranked": {"design": design._data, "rows": rows,
                    "badStep": refused(lambda: design.layer_sensitivity(step="relative"))}})


def materials(tf, given):
    """Materials by id and by name, by the builtin: id a stacked layer holds,
    a name two materials share, and one of them by its catalog:key id."""
    tio2 = tf.materials["TiO2"]
    named = tf.materials[given["name"]]
    plain = tf.new_design()
    plain.stack("(HL)^2 H")
    held = plain.layers[1].material
    with tfstudio.TFStudio(data_dir=given["dataDir"]) as own:
        twins = refused(lambda: own.materials["Twin"])
        twin = own.materials["twins:A"]
        twin_by_id = [twin.id, twin.name]
    out({"material": [tio2.id, tio2.name, tio2.catalog], "nkOne": list(tio2.nk(550)), "nkMany": list(tio2.nk([400, 550, 700])),
         "found": [m.id for m in tf.materials.find("SiO2")], "byName": named.id,
         "unknown": refused(lambda: tf.materials["Unobtainium"]), "held": [held, list(tf.materials[held].nk(550))],
         "twins": twins, "twinById": twin_by_id})


def spectra(design):
    s = design.spectrum(400, 700, step=10, angles=[45, 0])
    s.save_csv("spectrum.csv")
    one = design.spectrum(400, 700, step=10, angles=[7.5])
    one.save_csv("one.csv")
    helpers(s)
    # A NaN first in the band, where Python's own min() and max() would stop,
    # and a band holding that NaN alone.
    gappy = tfstudio.Curve([0.2, float("nan"), 0.1, 0.4], [500, 510, 520, 530])
    out({"spectrum": {"mode": s.mode, "wavelength": s.wavelength, "angles": s.angles, "R": s.R, "Tp0": s.angle(0).Tp,
                      "isList": isinstance(s.R, list), "maxR": max(s.R), "band": [s.R.mean(450, 650), s.R.min(450, 650), s.R.max(450, 650)],
                      "whole": [s.T.mean(), s.T.min(), s.T.max()], "outOfRange": s.out_of_range,
                      "noAngle": refused(lambda: s.angle(30)), "noBand": refused(lambda: s.R.mean(800, 900)),
                      "gappy": [list(gappy), gappy.wavelength, [gappy.min(510, 530), gappy.max(510, 530), gappy.mean()]],
                      "nanBand": [gappy.min(510, 510), gappy.max(510, 510)]}})


def helpers(s):
    """A curve's ripple, its value between samples and its optical density,
    on a spectrum and on a curve with a NaN, and their refusals."""
    gappy = tfstudio.Curve([0.2, float("nan"), 0.1, 0.4], [500, 510, 520, 530])
    out({"helpers": {
        "ripple": [s.R.ripple(450, 650), s.T.ripple(450, 650, unit="dB"), s.Rp.ripple(), gappy.ripple(), gappy.ripple(510, 510)],
        "at": [s.R.at(532.1), s.Tp.at(400), s.Tp.at(700), s.T.at(455), gappy.at(505)],
        "density": [list(s.T.density()), list(s.angle(0).Ts.density()), type(s.T.density()).__name__],
        "refused": [refused(lambda: s.R.density()), refused(lambda: gappy.density()), refused(lambda: s.T.at(399.9)), refused(lambda: s.T.at("401")),
                    refused(lambda: s.T.ripple(450, 650, unit="percent")), refused(lambda: s.T.ripple(900, 950))]}})


def merit(design):
    """Rows added, the merit and its rows, and a copy cleared."""
    rated = design.copy()
    rated.merit.add("RAV", 450, 650, target=0)
    rated.merit.add("MNT", 1, len(rated.layers), target=10)
    rated.merit.add("TAV", 800, 900, target=0.95, weight=2, aoi=45, pol="p")
    rows = [[row.type, row.start, row.end, row.aoi, row.pol, row.target, row.weight, row.enabled, row.value, row.error]
            for row in rated.merit.rows]
    cleared = rated.copy()
    cleared.merit.clear()
    out({"merit": {"design": rated._data, "count": len(rated.merit), "value": rated.merit.value,
                   "optical": rated.merit.optical_value, "rows": rows, "cleared": [len(cleared.merit), len(rated.merit)]}})


# SpecCheck's attributes, in the order the test reads them.
SPEC_ATTRIBUTES = ("kind", "label", "enabled", "cmp", "target", "tol", "lo", "hi", "wavelength", "start", "end", "aoi", "pol",
                   "channel", "direction", "level", "edge_side", "flag", "side", "preset_key", "preset_label", "source",
                   "detector", "band_points", "curve_id")


def specification(tf, design, given):
    """Checks of each kind added with the wavelengths each kind takes, read
    back, removed and cleared, the verdict on them, and the refusals of the
    checks in Python's words on `design`, which has no specification."""
    added = tf.open_design(given["measured"])
    for kind, where, keywords, _ in given["specKinds"]:
        added.specification.add(kind, *where, **keywords)
    holding = added.copy()
    holding._data = dict(holding._data, qualifiers=[dict(holding._data["qualifiers"][11], id="saved", presetKey="My preset")])
    holding.specification.add("LAYER_COUNT", cmp="le", target=30)
    removed = added.copy()
    removed.specification.remove(1)
    removed.specification.remove(len(removed.specification) - 1)
    cleared = added.copy()
    cleared.specification.clear()
    count = len(added.specification)
    added.specification.rows[10].source["T"] = 1
    report = added.specification.check()
    bare = design.copy().specification
    worded = [refused(make) for make in (
        bare.check, lambda: bare.estimate_yield(5), lambda: bare.add("R_AT", 550, 600), lambda: bare.add("LAYER_COUNT", 15),
        lambda: bare.add("PPEF", end=3), lambda: bare.add("R_AVG", 650, 450),
        lambda: bare.add("R_AT", -5), lambda: bare.add("R_AVG", 450, "x"), lambda: bare.add("R_AVG", 450, 650, id="mine"),
        lambda: bare.add("R_AVG", 450, 650, lambda_start=450), lambda: bare.add("R_AVG", 450, 650, lambdaStart=500, lambdaEnd=600),
        lambda: bare.add("R_AVG", lambdaStart=500, lambdaEnd=600), lambda: bare.add("EDGE_LAMBDA", 450, 650, edge_side="up"),
        lambda: bare.add("INTEGRAL", 400, 700, preset_key="Rvis"), lambda: bare.add("R_AT", 550, cmp="between", lo=0.9, hi=0.8),
        lambda: bare.add("MIN_MAX", 450, 650, channel="R", flag=2),
        lambda: bare.add("PPEF", curve_id="none"), lambda: bare.add("FWHM", 400, 700, band_points=1), lambda: bare.remove(0),
        lambda: bare.add("R_AVG", 450, 650, targt=1))]
    point = design.copy()
    point.specification.add("R_AVG", 600, 600)
    out({"specification": {
        "point": [point.specification.rows[0].start, point.specification.rows[0].end],
        "shown": [repr(report.rows[5]), repr(report.rows[13]), report.rows[13].value, report.rows[13].passed],
        "added": added._data, "snapshot": added._data["qualifiers"][10]["source"]["T"], "holding": holding._data["qualifiers"],
        "removed": removed._data,
        "cleared": [cleared._data, len(cleared.specification), count],
        "rows": [[getattr(check, name) for name in SPEC_ATTRIBUTES] for check in added.specification.rows],
        "attributes": sorted(name for name in vars(tfstudio.SpecCheck) if not name.startswith("_")),
        "outside": [refused(lambda index=index: added.specification.remove(index)) for index in (-1, count, 1.5, "1", True)],
        "report": [[r.kind, r.label, r.value, r.unit, r.passed, r.margin, list(r.threshold), r.reason] for r in report.rows],
        "verdict": [report.passed, report.passing, report.total, report.mode], "worded": worded}})


def yield_of(y):
    return [y.value, y.pass_count, y.evaluated, y.interval, [[check.label, check.fail_rate] for check in y.checks], y.runs, y.seed,
            y.mode]


def yields(tf):
    """A mirror whose checks a few % of thickness error fails now and then:
    its yield with a seed and with the documented defaults, a Monte Carlo
    run's, the Progress of each trial, a progress function that raises, a
    Stop stopped before the run, and the runs refused."""
    mirror = tf.new_design("Mirror")
    mirror.stack("(HL)^5 H")
    spec = mirror.specification
    spec.add("R_AVG", 520, 580, cmp="ge", target=0.9953)
    spec.add("R_AT", 550, cmp="ge", target=0.99585)
    spec.add("LAYER_COUNT", cmp="le", target=15)
    spec.add("T_AT", 600, cmp="le", target=0.5, enabled=False)
    errors = {"thickness_rel_pct": 3, "index_re": 0.01, "distribution": "uniform", "seed": 9}
    trials = []
    spec.estimate_yield(10, seed=2, progress=lambda p: trials.append([p.trial, p.total]))

    def raises(p):
        raise ValueError("raised at trial {} of {}".format(p.trial, p.total))

    try:
        spec.estimate_yield(20, seed=2, progress=raises)
        raised = None
    except ValueError as err:
        raised = str(err)
    early = tfstudio.Stop()
    early.stop()
    unchecked = mirror.copy()
    unchecked.specification.clear()
    unchecked.specification.add("LAYER_COUNT", cmp="le", target=15, enabled=False)
    unchecked.score_on = "whole part"
    seeded = spec.estimate_yield(40, **errors)
    out({"yield": {"design": mirror._data, "seeded": yield_of(seeded), "shown": repr(seeded),
                   "defaults": yield_of(spec.estimate_yield(30, seed=4)),
                   "monteCarlo": yield_of(mirror.monte_carlo(500, 600, step=10, runs=40, **errors).spec),
                   "unchecked": yield_of(unchecked.monte_carlo(500, 600, step=50, runs=5, seed=1).spec),
                   "trials": trials, "raised": raised, "stopped": spec.estimate_yield(100000, seed=2, stop=early).runs,
                   "refused": [refused(lambda: spec.estimate_yield(0)), refused(lambda: spec.estimate_yield(None)),
                               refused(lambda: spec.estimate_yield(5, thickness_rel=3))]}})


def report_of(report):
    return [report.removed, report.merged, [list(op) for op in report.operations]]


def design_edits(tf):
    """scale_thicknesses(), quantize() with its defaults and each argument,
    perturb() with a seed and without, layers.flip(), copy_front_to_back(),
    copy_back_to_front() and differences(), each from the design before it,
    and their refusals."""
    design = tf.new_design("Edits")
    design.stack("(HL)^2 H")
    design.layers[2].locked = True
    steps = {"before": copy.deepcopy(design._data)}
    design.scale_thicknesses(1.07)
    steps["scaled"] = copy.deepcopy(design._data)
    design.quantize()
    steps["rounded"] = copy.deepcopy(design._data)
    design.quantize("qwot", 0.5)
    steps["qwot"] = copy.deepcopy(design._data)
    seed = design.perturb(3, seed=17)
    steps["kicked"] = copy.deepcopy(design._data)
    fresh = design.copy()
    fresh_seed = fresh.perturb()
    design.layers.flip()
    steps["flipped"] = copy.deepcopy(design._data)
    design.sides = "both"
    design.copy_front_to_back()
    steps["copied"] = copy.deepcopy(design._data)
    design.back_layers.append("MgF2", 90)
    design.copy_back_to_front()
    steps["back"] = copy.deepcopy(design._data)
    other = design.copy()
    other.sides = "symmetric"
    other.substrate.thickness = 2
    other.layers[1].thickness = 50
    found = design.differences(other)
    worded = [refused(make) for make in (
        lambda: design.scale_thicknesses(0), lambda: design.quantize("decimals", 9), lambda: design.quantize("round"),
        lambda: design.perturb(150), lambda: design.perturb(seed=0), lambda: other.back_layers.flip(),
        lambda: design.differences(design._data), lambda: design.quantize(side="total"))]
    out({"designEdits": {"steps": steps, "seed": seed, "fresh": [fresh_seed, fresh._data, steps["kicked"]],
                         "found": [found.same, [s._asdict() for s in found.setup],
                                   [[c.side, c.number, c.before and c.before._asdict(), c.after and c.after._asdict(), c.change]
                                    for c in found.layers], type(found).__name__],
                         "other": other._data, "worded": worded}})


def cleaning(tf):
    """clean() on a design coated on both sides, each with a same-material
    pair and thin layers, more taken out than merged, no two other layers
    alike, one 4.5 nm and one 5.5 nm thick, either side of the default
    minimum: with its defaults, with each option, on a symmetric copy, and its
    refusals; and the layer each operation's number names in the design
    before, read by that number."""
    dirty = tf.new_design("Two sides to clean")
    dirty.sides = "both"
    for material, thickness in (("TiO2", 20), ("SiO2", 30), ("SiO2", 50), ("Ta2O5", 4.5), ("MgF2", 100), ("Al2O3", 3)):
        dirty.layers.append(material, thickness)
    for material, thickness in (("Al2O3", 40), ("Al2O3", 25), ("TiO2", 60), ("MgF2", 1.5), ("SiO2", 5.5)):
        dirty.back_layers.append(material, thickness)
    before = dirty.copy()
    report = dirty.clean()
    side_of = {"front": before.layers, "back": before.back_layers}
    named = [[side_of[op.side][op.number].material, side_of[op.side][op.number].thickness,
              None if op.merged_into is None else side_of[op.side][op.merged_into].material] for op in report.operations]
    optioned = before.copy()
    back_only = optioned.clean(min_thickness=1.8, merge=False, back=True)
    front_only = before.copy()
    front_only.clean(back=False)
    symmetric = before.copy()
    symmetric.sides = "symmetric"
    symmetric_before = symmetric._data
    symmetric.clean()
    kept = before.copy()
    worded = [refused(make) for make in (
        lambda: kept.clean(min_thickness=-1), lambda: kept.clean(min_thickness=None), lambda: kept.clean(merge=1),
        lambda: kept.clean(back="yes"), lambda: tf.new_design("Bare").clean())]
    out({"cleaning": {"before": before._data, "after": dirty._data, "report": report_of(report), "shown": repr(report),
                      "fields": list(type(report.operations[0])._fields), "named": named,
                      "optioned": [optioned._data, report_of(back_only)], "frontOnly": front_only._data,
                      "symmetric": [symmetric_before, symmetric._data], "worded": worded, "kept": kept._data == before._data}})


def profile_of(profile):
    return [profile.mode, profile.wavelength, None if profile.incident is None else list(profile.incident),
            None if profile.substrate is None else list(profile.substrate), [list(layer) for layer in profile.layers],
            profile.thickness, profile.optical_thickness, profile.out_of_range]


def thicknesses_of(listed):
    return [listed.mode, listed.wavelength, [list(row) for row in listed.rows], listed.out_of_range]


def stack_views(tf):
    """index_profile() and layer_thicknesses() of a design coated on both
    sides, unlike materials on each, with their defaults and each argument;
    the CSV of a profile on one side and on the whole part; the facts with
    and without side; each layer's QWOT read, two set; a layer whose
    material resolves to nothing; and the refusals."""
    two = tf.new_design("Two sides", reference=600)
    two.stack("(HL)^2 H")
    two.sides = "both"
    two.back_layers.append("MgF2", 95)
    two.back_layers.append("Ta2O5", 20)
    profiles = [profile_of(two.index_profile()), profile_of(two.index_profile(wavelength=633)),
                profile_of(two.index_profile(side="back", wavelength=1064))]
    thicknesses = [thicknesses_of(two.layer_thicknesses()), thicknesses_of(two.layer_thicknesses(wavelength=550, side="front"))]
    two.index_profile(side="front", wavelength=633).save_csv("profile-front.csv")
    two.index_profile().save_csv("profile-total.csv")
    facts = [[two.total_thickness(side=side), two.optical_thickness(side=side), two.layer_counts(side=side)]
             for side in (None, "front", "back", "total")]
    qwots = [layer.qwot for layer in two.layers] + [layer.qwot for layer in two.back_layers]
    set_qwot = two.copy()
    set_qwot.layers[2].qwot = 1.5
    set_qwot.back_layers[1].qwot = 0.75
    lost = two.copy()
    lost._data["frontLayers"][0]["material"] = "NoSuchFilm"
    top = len(lost.layers)
    symmetric = two.copy()
    symmetric.sides = "symmetric"

    def set_to(layer, qwot):
        layer.qwot = qwot

    worded = [refused(make) for make in (
        lambda: set_to(set_qwot.layers[1], 0), lambda: set_to(lost.layers[top], 1),
        lambda: set_to(symmetric.back_layers[1], 1), lambda: two.index_profile(side="both"),
        lambda: two.layer_thicknesses(wavelength=-5), lambda: tf.new_design("Front").layer_thicknesses(side="back"),
        lambda: tf.new_design("Bare").index_profile())]
    out({"stackViews": {"design": two._data, "profiles": profiles, "thicknesses": thicknesses,
                        "csv": [text_of("profile-front.csv"), text_of("profile-total.csv")], "facts": facts, "qwots": qwots,
                        "set": set_qwot._data, "read": [set_qwot.layers[2].qwot, set_qwot.back_layers[1].qwot],
                        "lost": [lost.layers[top].qwot, lost.optical_thickness()], "worded": worded,
                        "shown": [repr(two.index_profile(wavelength=600)), repr(two.layer_thicknesses(side="front"))],
                        "fields": [list(type(two.index_profile().layers[0])._fields),
                                   list(type(two.layer_thicknesses().rows[0])._fields)]}})


def complex_of(value):
    return [value.real, value.imag]


def locus_of(locus):
    return [complex_of(locus.eta0), complex_of(locus.eta_substrate),
            [[b.layer, b.material, b.name] + complex_of(b.Y) + complex_of(b.gamma) for b in locus.boundaries],
            [list(arc) for arc in locus.arcs]]


def loci_of(loci):
    return [loci.mode, loci.wavelength, loci.angle, loci.plane, list(loci.incident), list(loci.substrate),
            locus_of(loci.s), locus_of(loci.p), loci.out_of_range]


def field_of(field):
    return [field.mode, field.wavelength, field.angle, field.reference, field.depth_unit, field.points_per_layer, field.z,
            field.depth, [list(layer) for layer in field.layers], [list(field.s), list(field.p), list(field.avg)],
            field.incident_amplitude, field.out_of_range]


def admittance_and_field(tf):
    """admittance() and electric_field() of a design coated on both sides,
    unlike materials on each, with their defaults and each argument; their
    complex values' type; the side taken on a design coated on the back
    alone; the CSV of each; their refusals and repr()."""
    two = tf.new_design("Two sides", reference=600)
    two.stack("(HL)^2 H")
    two.sides = "both"
    two.back_layers.append("MgF2", 95)
    two.back_layers.append("Ta2O5", 20)
    loci = [loci_of(two.admittance()), loci_of(two.admittance(633, angle=45)),
            loci_of(two.admittance(side="back", plane="reflection"))]
    fields = [field_of(two.electric_field()), field_of(two.electric_field(1064, depth_unit="QWOT")),
              field_of(two.electric_field(633, angle=45, side="back", points_per_layer=9, depth_unit="OT", reference=500))]
    locus = two.admittance(633, angle=45).s
    types = [type(locus.eta0).__name__, type(locus.boundaries[-1].Y).__name__, type(locus.boundaries[-1].gamma).__name__]
    back = two.copy()
    back.sides = "back"
    two.admittance(633, angle=45).save_csv("admittance.csv")
    two.electric_field(1064, depth_unit="QWOT").save_csv("field.csv")
    worded = [refused(make) for make in (
        lambda: two.admittance(550, angle=95), lambda: two.admittance(550, side="total"),
        lambda: two.admittance(550, plane="smith"), lambda: two.electric_field(-1),
        lambda: two.electric_field(550, points_per_layer=1), lambda: two.electric_field(550, depth_unit="um"),
        lambda: two.electric_field(550, points_per_layer=250001), lambda: two.electric_field(550, depth_units="nm"),
        lambda: tf.new_design("Front").electric_field(550, side="back"),
        lambda: tf.new_design("Front").admittance(550, side="back"))]
    out({"fields": {"design": two._data, "loci": loci, "fields": fields, "types": types,
                    "modes": [two.admittance().mode, two.electric_field().mode, back.admittance().mode, back.electric_field().mode],
                    "csv": [text_of("admittance.csv"), text_of("field.csv")], "worded": worded,
                    "shown": [repr(two.admittance(550, angle=45)), repr(two.electric_field(550))],
                    "tuples": [list(type(locus)._fields), list(type(locus.boundaries[0])._fields), list(type(locus.arcs[0])._fields),
                               list(type(two.electric_field().s)._fields), list(type(two.electric_field().layers[0])._fields)]}})


def colour_of(c):
    return [c.mode, c.quantity, c.angle, c.pol, c.observer, c.illuminant, c.step, c.X, c.Y, c.Z, c.x, c.y, list(c.white),
            list(c.white_xy), list(c.lab), list(c.luv), list(c.uv1976), list(c.uv1960), list(c.hunter_lab), list(c.dominant),
            c.cct, c.duv, list(c.srgb), c.out_of_range]


def table_of(t):
    return [t.mode, t.start, t.end, t.step, t.angle, t.pol,
            [[r.key, r.quantity, r.value, r.min, r.min_at, r.max, r.max_at, list(r.band), r.covered, list(r.spectrum_span)]
             for r in t.rows], t.out_of_range]


_CUSTOM = [{"key": "T3000K", "source": {"id": "blackbody", "T": 3000}, "band": [400, 700]},
           {"key": "Rled", "quantity": "R", "source": {"id": "custom", "table": [[440, 0.2], [450, 1], [470, 0.1]]},
            "detector": {"id": "flat"}}]


def colour_and_integrals(tf):
    """color() and integrals() of a design coated on both sides, with their
    defaults and each argument; their groups' fields; a row by its key; the
    CSV of an Integrals; their refusals and repr()."""
    two = tf.new_design("Two sides", reference=600)
    two.stack("(HL)^2 H")
    two.sides = "both"
    two.back_layers.append("MgF2", 95)
    colours = [colour_of(two.color()),
               colour_of(two.color(quantity="T", angle=30, pol="s", observer=10, illuminant="A", step=1, side="front"))]
    tables = [table_of(two.integrals()),
              table_of(two.integrals(start=350, end=1100, step=1, angle=45, pol="p", custom=_CUSTOM, side="back"))]
    iv = two.integrals(custom=_CUSTOM)
    iv.save_csv("integrals.csv")
    c = two.color()
    worded = [refused(make) for make in (
        lambda: two.color(observer=3), lambda: two.color(illuminant="F2"), lambda: two.color(side="both"),
        lambda: two.integrals(start=900, end=400), lambda: two.integrals(custom=[{"key": "x", "char": "T"}]),
        lambda: two.integrals(custom=[{"key": "Tvis"}]), lambda: iv["Tsun"])]
    out({"colour": {"design": two._data, "colours": colours, "tables": tables, "rows": [list(iv["Rled"]), iv["Tvis"] == iv.rows[0]],
                    "csv": text_of("integrals.csv"), "worded": worded, "shown": [repr(c), repr(iv)],
                    "tuples": [list(type(c.lab)._fields), list(type(c.luv)._fields), list(type(c.dominant)._fields),
                               list(type(c.srgb)._fields), list(type(c.white)._fields), list(type(iv.rows[0])._fields)]}})


def sweep_of(e):
    curves = [[list(e.angle(a).psi), list(e.angle(a).delta)] for a in e.angles] if isinstance(e.wavelength, list) \
        else [[list(e.psi), list(e.delta)]]
    return [e.mode, e.wavelength, e.angles, e.delta_convention, curves, e.out_of_range]


def ellipsometry(tf):
    """ellipsometry() and ellipsometry_vs_angle() of a design coated on both
    sides, with their defaults and each argument; the curve types; an
    AngleCurve's mean, min and max; the CSV of each; their refusals and
    repr()."""
    two = tf.new_design("Two sides", reference=600)
    two.stack("(HL)^2 H")
    two.sides = "both"
    two.back_layers.append("MgF2", 95)
    spectral = [two.ellipsometry(),
                two.ellipsometry(450, 900, step=2, angles=[55, 70], side="back", delta_convention="reversed")]
    angular = [two.ellipsometry_vs_angle(),
               two.ellipsometry_vs_angle(633, 20, 70, step=2, side="back", delta_convention="reversed")]
    e, a = spectral[1], angular[1]
    curves = [a.psi.mean(), a.psi.mean(30, 50), a.psi.min(30, 50), a.psi.max(30), a.delta.min(), a.delta.max(None, 40),
              list(a.psi.angle)]
    e.save_csv("spectral.csv")
    a.save_csv("angular.csv")
    worded = [refused(make) for make in (
        lambda: two.ellipsometry(800, 400), lambda: two.ellipsometry(side="total"),
        lambda: two.ellipsometry(delta_convention="tompkins"), lambda: two.ellipsometry(start_at=400),
        lambda: two.ellipsometry_vs_angle(633, 45, 90), lambda: two.ellipsometry_vs_angle(633, 45, 80, step=0.01),
        lambda: two.ellipsometry_vs_angle(633, angle_step=1), lambda: two.ellipsometry_vs_angle(633, angle_start=50),
        lambda: two.ellipsometry(to=900), lambda: a.angle(50), lambda: a.psi.max(5, 15))]
    out({"ellipsometry": {"design": two._data, "spectral": [sweep_of(x) for x in spectral],
                          "angular": [sweep_of(x) for x in angular], "curves": curves,
                          "types": [type(e.psi).__name__, type(a.psi).__name__],
                          "csv": [text_of("spectral.csv"), text_of("angular.csv")], "worded": worded,
                          "shown": [repr(e), repr(a)]}})


def curves_of(g):
    return [g.mode, g.response, g.angle, g.pol, g.step, g.reference, g.wavelength, list(g.phase), list(g.gd),
            list(g.gdd), list(g.tod), list(g.cdc), g.outside, g.knots, g.invalid, g.models, g.out_of_range]


def group_delay(tf):
    """group_delay() of a design coated on both sides, with its defaults and
    each argument; the curve type; the CSV of each; its refusals and
    repr()."""
    two = tf.new_design("Two sides", reference=600)
    two.stack("(HL)^2 H")
    two.sides = "both"
    two.back_layers.append("MgF2", 95)
    asked = [two.group_delay(),
             two.group_delay(450, 900, step=2, angle=30, pol="p", response="T", side="back", reference=600),
             two.group_delay(step="auto", response="T", side="total")]
    asked[1].save_csv("uniform.csv")
    asked[2].save_csv("auto.csv")
    worded = [refused(make) for make in (
        lambda: two.group_delay(800, 400), lambda: two.group_delay(side="total"), lambda: two.group_delay(step="fine"),
        lambda: two.group_delay(pol="x"), lambda: two.group_delay(start_at=400), lambda: two.group_delay(to=900))]
    out({"groupDelay": {"design": two._data, "asked": [curves_of(g) for g in asked],
                        "types": [type(asked[0].gd).__name__, type(asked[0].phase).__name__],
                        "csv": [text_of("uniform.csv"), text_of("auto.csv")], "worded": worded,
                        "shown": [repr(g) for g in asked]}})


def material_dispersion(tf):
    """dispersion() of two materials, with its defaults and each argument;
    the curve type; range; the CSV of each; its refusals and repr()."""
    tio2, si = tf.materials["TiO2"], tf.materials["Si"]
    asked = [tio2.dispersion(), tio2.dispersion(300, 900, thickness=2), si.dispersion(400, 1100, thickness=0.5)]
    asked[1].save_csv("outside.csv")
    asked[2].save_csv("masked.csv")
    worded = [refused(make) for make in (
        lambda: tio2.dispersion(800, 400), lambda: tio2.dispersion(thickness=0), lambda: tio2.dispersion(start_at=400),
        lambda: tio2.dispersion(to=900))]
    out({"materialDispersion": {
        "asked": [[d.thickness, d.wavelength, list(d.phase), list(d.gd), list(d.gdd), list(d.cdc), list(d.tod), list(d.group_index),
                   d.outside, d.masked, d.knots, d.model] for d in asked],
        "types": [type(asked[0].gdd).__name__, type(asked[0].group_index).__name__], "range": [tio2.range, si.range],
        "csv": [text_of("outside.csv"), text_of("masked.csv")], "worded": worded, "shown": [repr(d) for d in asked]}})


def band_features(tf):
    """A spectrum curve's peak(), fwhm() and edge() with their defaults and
    each argument, read again after the design changed, edge_shift(), the
    named tuples they give, and their refusals."""
    design = tf.new_design("Bandpass")
    design.stack("(HL)^4 HH (LH)^4")
    before = design._data
    s = design.spectrum(500, 600, angles=[0, 30])
    read = lambda: [s.T.peak(), s.angle(30).Rp.fwhm(520, 580, level=0.3, direction="min", step=0.1),
                    s.T.edge(520, 580, edge_side="right"), s.R.peak(510, 590, direction="min", step=0.01)]
    asked = read()
    design.stack("(HL)^2")
    again = read()
    lwp = tf.new_design("Long-wave pass")
    lwp.stack("(0.5H L 0.5H)^8")
    moved = lwp.edge_shift(600, 760, [0, 15, 30], quantity="Tp", level=0.4)
    worded = [refused(make) for make in (
        lambda: s.T.peak(450, 600), lambda: s.T.peak(level=0.5), lambda: s.T.fwhm(step=0.5), lambda: s.R.peak(step=0.1),
        lambda: tfstudio.Curve([0.1, 0.2], [500, 510]).edge(), lambda: lwp.edge_shift(600, 760, []),
        lambda: lwp.edge_shift(700, 600, [0]), lambda: lwp.edge_shift(600, 760, [0], to=800))]
    out({"bandFeatures": {"design": before, "lwp": lwp._data, "asked": [a._asdict() for a in asked],
                          "again": [a._asdict() for a in again], "moved": moved._asdict(),
                          "types": [type(a).__name__ for a in asked + [moved]], "worded": worded}})


def ran(before, design, result):
    return {"before": before, "after": design._data, "reported": result.reported,
            "result": [result.completed, result.stop_reason, result.merit, result.optical_merit, result.initial_merit,
                       result.iterations, result.seed, result.mode]}


def runs(design, given):
    """Each run on a copy of a design with a merit function: what the design
    then holds and what the result says; a Monte Carlo run and a layer
    ranking of the design; and the API names of the settings given."""
    start = design.copy()
    start.merit.add("RAV", 450, 650, target=0)
    pool = given["pool"]
    made = {}
    for name, make in (("dls", lambda d: d.refine(method="dls", max_iter=20)),
                       ("sa", lambda d: d.refine(method="sa", max_iter=20, seed=5)),
                       ("needle", lambda d: d.synthesize("needle", pool=pool, max_layers=12, refine_iter=10, threads=1)),
                       ("structural", lambda d: d.synthesize("structural", pool=pool, max_iter=3, refine_iter=5, threads=1, seed=7))):
        each = start.copy()
        made[name] = ran(start._data, each, make(each))
    mc = start.monte_carlo(450, 650, step=10, runs=5, seed=3)
    sensitivity = start.layer_sensitivity(delta_nm=2)
    out({"runs": made, "unchanged": start._data == made["dls"]["before"],
         "monteCarlo": {"curves": [mc.wavelength, mc.theory, mc.mean, mc.stdev, mc.lower, mc.upper, mc.lowest, mc.highest],
                        "rest": [mc.runs, mc.quantity, mc.seed, mc.spec, mc.mode]},
         "sensitivity": {"rows": ranking(sensitivity), "merit": sensitivity.merit, "mode": sensitivity.mode},
         "settingNames": {name: api_name(name) for name in given["settingNames"]}})


def progress(design, given):
    """The Progress objects a refinement, a Needle run and a Monte Carlo run
    give their progress function."""
    start = design.copy()
    start.merit.add("RAV", 450, 650, target=0)
    reports = {"refine": [], "needle": [], "monteCarlo": []}
    start.copy().refine(method=["dls", "cg"], progress=reports["refine"].append)
    start.copy().synthesize("needle", pool=given["pool"], max_layers=12, refine_iter=10, threads=1,
                            progress=reports["needle"].append)
    start.copy().monte_carlo(450, 650, step=10, runs=40, seed=3, progress=reports["monteCarlo"].append)
    attributes = ("merit", "best_merit", "optical_merit", "iteration", "generation", "layer_count", "method", "seed",
                  "trial", "total", "activity")
    trials = reports["monteCarlo"]
    out({"progress": {"design": start._data, "last": {name: [getattr(got[-1], a) for a in attributes] for name, got in reports.items()},
                      "reported": {name: got[-1].reported for name, got in reports.items()},
                      "snapshots": trials[0].reported is not trials[-1].reported and trials[0].trial != trials[-1].trial,
                      "methodWhileIterating": all(p.method for p in reports["refine"] if p.iteration)}})


def stopping(design, given):
    """stop= and Ctrl+C on the objects' runs: a Stop stopped in progress, a
    Deep Synthesis run stopped once it has a best design, which its plain
    call answers with, a Stop stopped before the run, a progress function
    that raises KeyboardInterrupt, and a stop that is not a Stop."""
    start = design.copy()
    start.merit.add("RAV", 450, 650, target=0)
    stop = tfstudio.Stop()
    grown = start.copy()
    run = grown.synthesize("needle", pool=given["pool"], max_layers=20, refine_iter=10, threads=1, target_mf=0,
                           progress=lambda p: stop.stop(), stop=stop)
    halt = tfstudio.Stop()

    def best_so_far(p):
        if isinstance(p.reported.get("layers"), list):
            halt.stop()

    deep = start.copy()
    deep_run = deep.synthesize("deep", pool=given["pool"], d_min=20, max_layers=6, seed=7, threads=1, progress=best_so_far,
                               stop=halt)
    early = tfstudio.Stop()
    early.stop()
    refined = start.copy()
    already = refined.refine(method="dls", stop=early)
    trials = start.monte_carlo(450, 650, runs=100000, seed=5, stop=early)

    def interrupts(p):
        raise KeyboardInterrupt

    kept = start.copy()
    began = time.monotonic()
    try:
        kept.refine(method="dls", progress=interrupts)
        interrupted = None
    except KeyboardInterrupt:
        interrupted = [time.monotonic() - began, kept._data == start._data, kept.refine(method="dls", max_iter=5).stop_reason]
    out({"stopping": {"stopped": [run.stop_reason, grown._data == start._data], "deep": [deep_run.stop_reason, deep._data == start._data],
                      "before": [already.stop_reason, refined._data == start._data],
                      "trials": trials.runs, "interrupted": interrupted, "notStop": refused(lambda: start.refine(stop=True))}})


def plain(make):
    """[message, code, fields] of the TFStudioError a call of studio._calls,
    `make()`, raises, or None."""
    try:
        make()
    except tfstudio.TFStudioError as err:
        return [str(err), err.code, err.fields]
    return None


def refusals(tf, design):
    """The refusals of the API's calls the objects make, in the objects'
    words, on copies of `design`, which is coated on its front, scored on its
    side and has no merit function, the runs' settings on a copy given a merit
    row; and the same refusals of the calls themselves."""
    front = design.copy()
    back = design.copy()
    back.sides = "back"
    symmetric = design.copy()
    symmetric.sides = "symmetric"
    scored = design.copy()
    scored.merit.add("RAV", 450, 650)
    pool = ["TiO2", "SiO2"]
    worded = [refused(make) for make in (
        front.refine, front.layer_sensitivity, lambda: front.back_layers.append("SiO2", 10),
        lambda: front.back_layers.insert(1, "SiO2", 10), lambda: back.layers.append("SiO2", 10),
        lambda: symmetric.back_layers.remove(1), lambda: setattr(front.layers[1], "thickness", -5),
        lambda: front.merit.add("RAV", 450, 650, aoi=95), lambda: front.merit.add("RAV", "x", 650),
        lambda: front.merit.add("RAV", 700, 400), lambda: front.spectrum(700, 400),
        lambda: front.monte_carlo(400, 700, thickness_rel=5), lambda: front.monte_carlo(400, 800, to=900),
        lambda: setattr(front, "reference", -1),
        lambda: setattr(front.substrate, "thickness", 0), lambda: front.stack("HL", at=-5),
        lambda: front.stack("Air | HL | BK7"), lambda: tf.materials["TiO2"].nk(-5),
        lambda: tf.new_design("X", reference=0), lambda: front.synthesize("needle", pool=["TiO2", "SiO2"]),
        lambda: front.layers.append("SiO2", 10, locked=1), lambda: front.merit.add("RAV", 450, 650, target_end="x"),
        lambda: front.merit.add("RAV", lambda_start=450, lambda_end=650, target=0),
        lambda: front.merit.add("RAV", lambdaStart=450, lambdaEnd=650),
        lambda: scored.refine(max_iters=5), lambda: scored.synthesize("needle", pool, max_layers=0),
        lambda: scored.synthesize("ge", pool, refine_iter=0), lambda: scored.synthesize("structural", pool, max_iter=0),
        lambda: scored.synthesize("deep", pool, max_layers=0))]
    calls, data = tf._calls, front._data
    out({"pythonWords": {"design": data, "worded": worded, "rowType": refused(lambda: front.merit.add("XYZ")),
                      "formula": refused(lambda: front.stack("(HL")),
                      "rowOption": refused(lambda: front.merit.add("RAV", 450, 650, targt=0)),
                      "unknownMaterial": refused(lambda: front.layers.append("Unobtainium", 10)),
                      "plain": [plain(lambda: calls.refine(data, {"method": "dls"})),
                                plain(lambda: calls.insertLayer(data, {"side": "back", "material": "SiO2", "thickness": 10})),
                                plain(lambda: calls.setMerit(data, [{"type": "RAV", "lambdaStart": 700, "lambdaEnd": 400}])),
                                plain(lambda: calls.spectrum(data, {"from": 700, "to": 400}))]}})


def public_names():
    """The package's public names, each class with its public methods and
    attributes, and those whose doc lacks an example; an error class's doc
    need not show one."""
    names, undocumented = {}, []
    for name in tfstudio.__all__:
        thing = getattr(tfstudio, name)
        members = [member for member in vars(thing) if not member.startswith("_")]
        names[name] = sorted(members)
        error = issubclass(thing, Exception)
        for member in [None] + members:
            doc = inspect.getdoc(thing if member is None else getattr(thing, member)) or ""
            if not doc or (not error and "Example::" not in doc):
                undocumented.append(name if member is None else name + "." + member)
    return {"all": names, "undocumented": undocumented}


if __name__ == "__main__":
    globals()[sys.argv[1]](json.loads(sys.stdin.readline() or "null"))
