"""Test helper for tests/python_client.mjs: drives the objects of the tfstudio
package (python/) and prints what each gave, one JSON object per line,
beside the design it computed on, so that the test computes each with the
API's calls and compares.

    python -B -I tests/_pythonObjects.py objects <folder holding tfstudio>

The first line on stdin is the input, as JSON: { name, pool, settingNames,
dataDir }, dataDir a data folder whose user catalog holds two materials named
Twin.
"""

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
    for sides in ("front", "back", "both", "symmetric"):
        for score_on in ("side", "whole part"):
            each = both.copy()
            each.sides = sides
            each.score_on = score_on
            found.append([sides, score_on, each.sides, each.score_on, each._data["surfaceMode"], each._data["mfEvalMode"],
                          each.spectrum(500, 600, step=50).mode, each.monte_carlo(500, 600, step=50, runs=1, seed=1).mode,
                          each.refine(max_iter=1).mode, each.layer_sensitivity().mode])

    def sides():
        both.sides = "two"

    def score_on():
        both.score_on = "total"

    out({"modes": found, "badSides": refused(sides), "badScoreOn": refused(score_on)})


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
    # A NaN first in the band, where Python's own min() and max() would stop,
    # and a band holding that NaN alone.
    gappy = tfstudio.Curve([0.2, float("nan"), 0.1, 0.4], [500, 510, 520, 530])
    out({"spectrum": {"mode": s.mode, "wavelength": s.wavelength, "angles": s.angles, "R": s.R, "Tp0": s.angle(0).Tp,
                      "isList": isinstance(s.R, list), "maxR": max(s.R), "band": [s.R.mean(450, 650), s.R.min(450, 650), s.R.max(450, 650)],
                      "whole": [s.T.mean(), s.T.min(), s.T.max()], "outOfRange": s.out_of_range,
                      "noAngle": refused(lambda: s.angle(30)), "noBand": refused(lambda: s.R.mean(800, 900)),
                      "gappy": [list(gappy), gappy.wavelength, [gappy.min(510, 530), gappy.max(510, 530), gappy.mean()]],
                      "nanBand": [gappy.min(510, 510), gappy.max(510, 510)]}})


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
    side and has no merit function; and the same refusals of the calls
    themselves."""
    front = design.copy()
    back = design.copy()
    back.sides = "back"
    symmetric = design.copy()
    symmetric.sides = "symmetric"
    worded = [refused(make) for make in (
        front.refine, front.layer_sensitivity, lambda: front.back_layers.append("SiO2", 10),
        lambda: front.back_layers.insert(1, "SiO2", 10), lambda: back.layers.append("SiO2", 10),
        lambda: symmetric.back_layers.remove(1), lambda: setattr(front.layers[1], "thickness", -5),
        lambda: front.merit.add("RAV", 450, 650, aoi=95), lambda: front.merit.add("RAV", "x", 650),
        lambda: front.merit.add("RAV", 700, 400), lambda: front.spectrum(700, 400),
        lambda: front.monte_carlo(400, 700, thickness_rel=5), lambda: setattr(front, "reference", -1),
        lambda: setattr(front.substrate, "thickness", 0), lambda: front.stack("HL", at=-5),
        lambda: front.stack("Air | HL | BK7"), lambda: tf.materials["TiO2"].nk(-5),
        lambda: tf.new_design("X", reference=0), lambda: front.synthesize("needle", pool=["TiO2", "SiO2"]),
        lambda: front.layers.append("SiO2", 10, locked=1), lambda: front.merit.add("RAV", 450, 650, target_end="x"))]
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
