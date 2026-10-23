"""A design's specification: its checks, the verdict on them, and the yield
of Monte Carlo trials against them."""

import copy
import numbers

from ._errors import TFStudioError
from ._names import api_name, api_names
from ._refusals import Words, worded
from ._results import SpecReport, Yield
from ._stop import run_hooks

# add() makes its check with setSpecification, whose refusals begin with the
# check's place; the check's wavelengths are start and end, which with its
# kind are add()'s arguments, and the id is the one every check added gets.
_ADD_WORDS = Words("setSpecification: check 0", "add", {"lambda": "start", "lambdaStart": "start", "lambdaEnd": "end"},
                   ("kind", "lambda", "lambdaStart", "lambdaEnd", "id"))
_YIELD_WORDS = Words("estimateYield", "estimate_yield", hidden=("runs",), extra=("progress", "stop"))

# The kinds checked at one wavelength, and those that read none: a thickness
# budget, a layer count, and a peak-to-peak error, read at the wavelengths of
# its measured curve. The others read a band.
_AT_ONE_WAVELENGTH = ("T_AT", "R_AT", "A_AT")
_NO_WAVELENGTH = ("THICKNESS_BUDGET", "LAYER_COUNT", "PPEF")


def _wavelengths(kind, start, end):
    """The fields of a check of `kind` that add()'s start and end give,
    refusing one the kind does not read."""
    if kind in _AT_ONE_WAVELENGTH:
        if end is not None:
            raise TFStudioError("add: {} is checked at one wavelength, start, and takes no end, not {!r}".format(kind, end))
        given = {"lambda": start}
    elif kind in _NO_WAVELENGTH:
        if start is not None or end is not None:
            raise TFStudioError("add: {} reads no wavelength, and takes no start or end, not {!r}".format(
                kind, start if start is not None else end))
        given = {}
    else:
        given = {"lambdaStart": start, "lambdaEnd": end}
    return {field: value for field, value in given.items() if value is not None}


def _refuse_argument_fields(fields):
    """Refuses a keyword argument that names a field add() takes as an
    argument, or the id, which add() gives each check it adds, so no two
    checks share one. A field is known by its API name, so lambdaStart is
    refused as lambda_start is."""
    argument = next((name for name in fields if api_name(name) in ("lambda", "lambdaStart", "lambdaEnd")), None)
    if argument:
        raise TFStudioError("add: unknown option {!r}; a check's kind and wavelengths are add()'s arguments, kind, "
                            "start and end".format(argument))
    if "id" in fields:
        raise TFStudioError("add: unknown option 'id'; each check add() adds gets an id of its own")


def _reading(name, doc):
    return property(lambda self: self._values.get(name), doc=doc)


class SpecCheck:
    """One check of a design's specification, as it was when
    design.specification.rows was read. Each attribute holds the check's
    field as the design holds it, None for a field it holds none of; a field
    the check's kind does not read holds the value it was given, or the one a
    check added in the Specification window starts with.

    Example::

        design = tf.new_design("Mirror")
        design.stack("(HL)^5 H")
        design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
        for check in design.specification.rows:
            print(check.kind, check.start, check.end, check.cmp, check.target)
    """

    def __init__(self, check):
        self._values = copy.deepcopy(dict(check, wavelength=check.get("lambda"), start=check.get("lambdaStart"),
                                          end=check.get("lambdaEnd")))

    kind = _reading("kind", """What the check checks, such as "R_AVG" or "LAYER_COUNT";
        specification.add() lists the kinds.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("LAYER_COUNT", cmp="le", target=15)
            print(design.specification.rows[0].kind)
        """)
    label = _reading("label", """The check's label, "" when it has none.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, label="Stop band")
            print(design.specification.rows[0].label)
        """)
    enabled = _reading("enabled", """False for a check left out of the verdict.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, enabled=False)
            print(design.specification.rows[0].enabled)
        """)
    cmp = _reading("cmp", """The comparison: "ge", "le", "eq" or "between".

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("LAYER_COUNT", cmp="le", target=15)
            print(design.specification.rows[0].cmp)
        """)
    target = _reading("target", """The bound of "ge" and "le", and the value "eq" holds to, in the check's
        unit: T, R and A as fractions of 1, wavelengths, widths and thicknesses in nm, a layer count
        as a count, PPEF in dB.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
            print(design.specification.rows[0].target)
        """)
    tol = _reading("tol", """The tolerance of "eq", in the check's unit.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("CENTRAL_LAMBDA", 500, 600, cmp="eq", target=550)
            print(design.specification.rows[0].tol, "nm")
        """)
    lo = _reading("lo", """The lowest value of "between", in the check's unit.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AT", 550, cmp="between", lo=0.95, hi=1)
            print(design.specification.rows[0].lo)
        """)
    hi = _reading("hi", """The highest value of "between", in the check's unit.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AT", 550, cmp="between", lo=0.95, hi=1)
            print(design.specification.rows[0].hi)
        """)
    wavelength = _reading("wavelength", """The wavelength of a check at one wavelength, T_AT, R_AT or A_AT, nm.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AT", 550, cmp="ge", target=0.99)
            print(design.specification.rows[0].wavelength, "nm")
        """)
    start = _reading("start", """The first wavelength of the band a check over a band reads, nm.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
            print(design.specification.rows[0].start, "nm")
        """)
    end = _reading("end", """The last wavelength of the band, nm.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
            print(design.specification.rows[0].end, "nm")
        """)
    aoi = _reading("aoi", """The angle of incidence, degrees in the incident medium.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, aoi=45, pol="s")
            print(design.specification.rows[0].aoi)
        """)
    pol = _reading("pol", """The polarization, "avg", "s" or "p".

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, aoi=45, pol="s")
            print(design.specification.rows[0].pol)
        """)
    channel = _reading("channel", """What MIN_MAX, INTEGRAL, CENTRAL_LAMBDA, FWHM and EDGE_LAMBDA read: "T",
        "R" or "A".

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("MIN_MAX", 520, 580, channel="R", direction="min", cmp="ge", target=0.9)
            print(design.specification.rows[0].channel)
        """)
    direction = _reading("direction", """For MIN_MAX, CENTRAL_LAMBDA, FWHM and EDGE_LAMBDA: "max", the highest
        value or a peak, or "min", the lowest value or a dip.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("MIN_MAX", 520, 580, channel="R", direction="min", cmp="ge", target=0.9)
            print(design.specification.rows[0].direction)
        """)
    level = _reading("level", """For FWHM and EDGE_LAMBDA, the level the curve crosses, 0 to 1: with
        direction "max" that fraction of the band's highest value, with "min" that fraction of the
        way from its lowest value up to 1.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("FWHM", 400, 800, channel="R", level=0.5, cmp="ge", target=100)
            print(design.specification.rows[0].level)
        """)
    edge_side = _reading("edgeSide", """For EDGE_LAMBDA, "left" or "right", the crossing below or above the
        peak; None for the one below it, or the one above where there is none below.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("EDGE_LAMBDA", 400, 800, channel="R", edge_side="right", cmp="ge", target=600)
            print(design.specification.rows[0].edge_side)
        """)
    flag = _reading("flag", """The window's Step, or None for its default; specification.add() says what it
        is on each kind.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, flag=2)
            print(design.specification.rows[0].flag)
        """)
    side = _reading("side", """For THICKNESS_BUDGET and LAYER_COUNT, the layers added up: "front", "back"
        or "both".

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("THICKNESS_BUDGET", cmp="le", target=2000)
            print(design.specification.rows[0].side)
        """)
    preset_key = _reading("presetKey", """For INTEGRAL, the integral preset that set its channel, band, source
        and detector, such as "Tvis", or "" for none.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.specification.add("INTEGRAL", preset_key="Rvis", cmp="le", target=0.01)
            print(design.specification.rows[0].preset_key)
        """)
    preset_label = _reading("presetLabel", """For INTEGRAL, the preset's name as the window shows it.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.specification.add("INTEGRAL", preset_key="Rvis", cmp="le", target=0.01)
            print(design.specification.rows[0].preset_label)
        """)
    source = _reading("source", """For INTEGRAL, the source the band is weighted by, such as
        {"id": "D65"}.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.specification.add("INTEGRAL", preset_key="Rvis", cmp="le", target=0.01)
            print(design.specification.rows[0].source)
        """)
    detector = _reading("detector", """For INTEGRAL, the detector the band is weighted by, such as
        {"id": "photopic"}.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.specification.add("INTEGRAL", preset_key="Rvis", cmp="le", target=0.01)
            print(design.specification.rows[0].detector)
        """)
    band_points = _reading("bandPoints", """For INTEGRAL, FWHM and EDGE_LAMBDA, how many points the band is
        sampled at; None for the default.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("FWHM", 400, 800, channel="R", band_points=801, cmp="ge", target=100)
            print(design.specification.rows[0].band_points)
        """)
    curve_id = _reading("curveId", """For PPEF, the id of the measured curve the error is taken against;
        None on a check of another kind, such as the layer count below.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("LAYER_COUNT", cmp="le", target=15)
            check = design.specification.rows[0]
            print(check.kind, "is taken against no curve:", check.curve_id)
        """)

    def __repr__(self):
        held = "{}..{}".format(self.lo, self.hi) if self.cmp == "between" else self.target
        return "<SpecCheck {} {} {}>".format(self.kind, self.cmp, held)


class Specification:
    """A design's specification, as the Specification window holds it: pass
    or fail checks in order, each a requirement on the design, such as R of
    0.99 or more over a band, or no more than 30 layers. check() judges the
    design against them as the window does, and estimate_yield() counts the
    share of Monte Carlo trials that meet them.

    Example::

        design = tf.new_design("Mirror")
        design.stack("(HL)^5 H")
        design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
        design.specification.add("LAYER_COUNT", cmp="le", target=15)
        report = design.specification.check()
        print(report.passed, [row.margin for row in report.rows])
    """

    def __init__(self, design):
        self._design = design

    def add(self, kind, start=None, end=None, **fields):
        """Adds a check at the end of the specification, made as the
        Specification window makes a row: a field left out takes the value a
        row added there starts with, and a thickness budget or layer count
        given no side adds up the side the design coats. The wavelengths
        follow the kind: one, ``start``, for a check at one wavelength,
        ``start`` and ``end`` for a check over a band, and none for
        THICKNESS_BUDGET, LAYER_COUNT and PPEF. An INTEGRAL check given a
        preset takes its band from the preset, so its ``start`` and ``end``
        may be left out.

        Args:
            kind: What is checked: "T_AT", "R_AT" or "A_AT" at one wavelength;
                "T_AVG", "R_AVG" or "A_AVG", the average over a band;
                "MIN_MAX", the lowest or highest value over a band;
                "INTEGRAL", a weighted average such as Tvis;
                "CENTRAL_LAMBDA", the wavelength of the band's peak or dip;
                "FWHM", the width of the peak at `level`; "EDGE_LAMBDA", where
                the curve crosses `level` of the peak; "THICKNESS_BUDGET", the
                total thickness; "LAYER_COUNT", the number of layers; "PPEF",
                the peak-to-peak error against a measured curve.
            start: The wavelength of a check at one wavelength, or the first
                wavelength of the band, nm. Without it, 550 nm for one
                wavelength and 400 nm for a band.
            end: The last wavelength of the band, nm, no lower than `start`.
                Without it, 700 nm.
            cmp: The comparison: "ge" or "le" with `target`, "eq" within
                `target` plus or minus `tol`, or "between" from `lo` to `hi`.
                Default "ge".
            target: The bound, in the check's unit: T, R and A as fractions of
                1, where the window shows percent; wavelengths, widths and
                thicknesses in nm; a layer count as a count; PPEF in dB.
                Default 0.99.
            tol: The tolerance of "eq", in the check's unit; 0 or less holds
                the value to the target itself. Without it, 0.01 for T, R and
                A, 1 nm for a centre or an edge, 2 nm for a width, 10 nm for a
                thickness, 0 for a layer count, 0.05 dB for PPEF.
            lo: The lowest value of "between", in the check's unit.
                Default 0.95.
            hi: The highest value of "between", no lower than `lo`.
                Default 1.
            aoi: The angle of incidence, degrees in the incident medium.
                Default 0.
            pol: "avg", "s" or "p". Default "avg".
            channel: What MIN_MAX, INTEGRAL, CENTRAL_LAMBDA, FWHM and
                EDGE_LAMBDA read: "T", "R" or "A". Default "T".
            direction: For MIN_MAX, CENTRAL_LAMBDA, FWHM and EDGE_LAMBDA:
                "max", the highest value or a peak, or "min", the lowest value
                or a dip. Default "max".
            level: For FWHM and EDGE_LAMBDA, the level the curve crosses, 0
                to 1: with direction "max" that fraction of the band's highest
                value, with "min" that fraction of the way from its lowest
                value up to 1. A level below 0.001 or above 0.999 is taken as
                0.001 or 0.999. Default 0.5.
            edge_side: For EDGE_LAMBDA, "right" for the crossing above the
                peak; otherwise the one below it, or the one above where there
                is none below.
            flag: The window's Step, None for its default: on T_AVG, R_AVG,
                A_AVG and INTEGRAL 1 to 4, a grid no coarser than 1, 0.1, 0.01
                or 0.001 nm, the default being the design's fringe grid; on
                FWHM and EDGE_LAMBDA, and on MIN_MAX and CENTRAL_LAMBDA of the
                highest T or A or the lowest R, 2 to 4, a search at 0.1, 0.01
                or 0.001 nm, the default being 1 nm. A check at one
                wavelength, MIN_MAX and CENTRAL_LAMBDA of the lowest T or A or
                the highest R, a thickness budget, a layer count and PPEF have
                no Step, and take None.
            side: For THICKNESS_BUDGET and LAYER_COUNT, the layers added up:
                "front", "back" or "both". Without it, the side the design
                coats.
            preset_key: For INTEGRAL, one of the integral presets Tvis, Rvis,
                Avis, Tsol, Rsol, Asol, TUV, RUV, TNIR and RNIR, which sets the
                channel, band, source, detector and `preset_label` as picking
                it in the window does, or "" for none. Default "".
            preset_label: For INTEGRAL, the preset's name as the window shows
                it. Default "".
            source: For INTEGRAL without a preset, the source: {"id": ...},
                the id one of D65, D50, A, AM1.5G, E, blackbody (with "T" in
                K) or custom (with "table", rows of [nm, value]). Default:
                {"id": "D65"}.
            detector: For INTEGRAL without a preset, the detector:
                {"id": ...}, the id photopic, flat or custom (with "table").
                Default: {"id": "photopic"}.
            band_points: For INTEGRAL, FWHM and EDGE_LAMBDA, how many points
                the band is sampled at in place of the default, a whole number
                of 2 or more; a width or edge scan takes 11 at the least.
            curve_id: For PPEF, the id of one of the design's measured curves.
            label: The check's label. Default "".
            enabled: False leaves the check out of the verdict. Default True.

        Raises:
            TFStudioError: a kind this version does not evaluate, a field no
                check has, a value its field cannot take, a band whose end is
                below its start, or a `hi` below `lo`.
            TFStudioError: a wavelength the kind does not read, or the check's
                wavelengths or id among the keyword arguments.
            TFStudioError: a preset the window does not offer, a field the
                check gives otherwise than its preset sets it, a PPEF check
                whose curve is not one of the design's measured curves, or a
                flag on a check with no Step.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AT", 550, cmp="ge", target=0.99)
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97, aoi=45, pol="s")
            design.specification.add("LAYER_COUNT", cmp="le", target=15)
            print(len(design.specification), "checks, the layer count on the", design.specification.rows[2].side)
        """
        _refuse_argument_fields(fields)
        check = dict(api_names(fields), kind=kind, **_wavelengths(kind, start, end))
        design = self._design
        with worded(_ADD_WORDS):
            made = design._calls.setSpecification(design._data, [check])["qualifiers"]
        design._data = dict(design._data, qualifiers=self._checks() + made)

    def remove(self, index):
        """Takes check `index` out; the checks after it move one up.

        Args:
            index: The check's place in the specification, from 0, as in
                ``rows``.

        Raises:
            TFStudioError: an index the specification has no check at.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
            design.specification.add("LAYER_COUNT", cmp="le", target=15)
            design.specification.remove(0)
            print(len(design.specification), "check:", design.specification.rows[0].kind)
        """
        checks = self._checks()
        if not isinstance(index, numbers.Integral) or isinstance(index, bool) or not 0 <= index < len(checks):
            raise TFStudioError("check {!r}: the specification has {} checks, numbered from 0".format(index, len(checks)))
        design = self._design
        design._data = dict(design._data, qualifiers=checks[:index] + checks[index + 1:])

    def clear(self):
        """Takes every check out of the specification.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
            design.specification.clear()
            print(len(design.specification), "checks")
        """
        design = self._design
        design._data = design._calls.setSpecification(design._data, [])

    @property
    def rows(self):
        """The checks, in order, each a SpecCheck.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
            design.specification.add("LAYER_COUNT", cmp="le", target=15)
            for check in design.specification.rows:
                print(check.kind, check.cmp, check.target)
        """
        return [SpecCheck(check) for check in self._checks()]

    def __len__(self):
        """How many checks the specification has.

        Example::

            design = tf.new_design("Mirror")
            design.specification.add("LAYER_COUNT", cmp="le", target=15)
            print(len(design.specification), "check")
        """
        return len(self._checks())

    def check(self):
        """The design as it is now judged against its specification, as the
        Specification window judges it: each check read at its own Step, and
        averaged over the design's cone of incidence when it has one.

        Returns:
            A SpecReport.

        Raises:
            TFStudioError: a design with no check.
            TFStudioError: a design that names a material that resolves to
                nothing.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
            design.specification.add("LAYER_COUNT", cmp="le", target=9)
            report = design.specification.check()
            for row in report.rows:
                print(row.kind, row.value, row.unit, row.passed, "margin", row.margin)
            print("Passes:", report.passed)
        """
        design = self._design
        with worded(Words("checkSpecification", "check")):
            return SpecReport(design._calls.checkSpecification(design._data))

    def estimate_yield(self, runs, **settings):
        """The share of Monte Carlo trials with random layer errors that meet
        the specification, as the Monte Carlo window counts its yield: each
        trial is judged by every enabled check, at the check's own Step, on
        what the design's sides and score_on say. The trials draw the errors
        design.monte_carlo() draws with the same seed and settings, so the
        yield is its spec; no spread is computed. The design is not changed.

        Args:
            runs: How many trials, a whole number of 1 or more.
            thickness_rel_pct: The thickness error, % of each layer. Default 1.
            thickness_abs_nm: A thickness error in nm added to every layer's.
                Default 0.
            index_re: The error on n, an absolute amount: one standard
                deviation with "gaussian", a bound with "uniform" and
                "truncated". Default 0.
            index_im: The error on k, an amount as index_re is on n; k does not
                go below 0. Default 0.
            distribution: "gaussian", "uniform" or "truncated" (a bound at
                three standard deviations). Default "gaussian".
            seed: The number the draws start from, a whole number from 1 to
                2^32 - 1; the same seed and settings repeat the run. Default:
                a fresh one, which the result reports.
            progress: A function called with a Progress (trial and total) as
                the trials go. An exception it raises stops the run and goes
                on.
            stop: A tfstudio.Stop whose stop() ends the run, which then
                answers with the trials it made.

        Returns:
            A Yield.

        Raises:
            TFStudioError: a design with no enabled check, or with no layer
                the trials can change on the side it is scored on.
            TFStudioError: a setting it does not take, a value outside its
                range, or a design that names a material that resolves to
                nothing.
            KeyboardInterrupt: Ctrl+C during the run, after stopping it.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
            y = design.specification.estimate_yield(100, thickness_rel_pct=2, seed=1)
            print("Yield", y.value, "of", y.runs, "trials; fails:", [check.fail_rate for check in y.checks])
        """
        hooks = run_hooks(settings, lambda: ["onProgress"])
        design = self._design
        with worded(_YIELD_WORDS):
            return Yield(design._calls.estimateYield(design._data, dict(api_names(settings), runs=runs), hooks))

    def _checks(self):
        return list(self._design._data.get("qualifiers") or [])

    def __repr__(self):
        return "<Specification of {} checks>".format(len(self))
