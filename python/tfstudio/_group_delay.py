"""A design's phase, group delay, GDD, TOD and CDC against wavelength, as
design.group_delay() answers."""

import math

from ._csv import write_rows
from ._results import Curve

# The window's table headings (gdGddEvaluation/viewModel.js, and the English
# spectralAxis.lambdaShort, gdgdd and materialRange.outsideColumn), its
# derivatives in the order the table shows them, and the label of each side
# of a knot.
_WAVELENGTH, _KNOT, _OUTSIDE, _PHASE = "λ (nm)", "Knot", "Outside data", "Phase φ (°)"
_DERIVATIVES = (("gd", "Group Delay (fs)"), ("gdd", "GDD (fs²)"), ("cdc", "CDC (fs/nm)"))
_TOD = ("tod", "TOD (fs³)")
_KNOT_SIDES = ("λ−", "λ+")
# NaN and the infinities as the window's export writes them, JavaScript's way.
_NOT_FINITE = {"nan": "NaN", "inf": "Infinity", "-inf": "-Infinity"}


def _reading(name, doc):
    """A read-only attribute giving self._values[name], documented as `doc`."""
    return property(lambda self: self._values[name], doc=doc)


def _curve(name, doc):
    """The curve `name`, a read-only attribute documented as `doc`."""
    return property(lambda self: self._curves[name], doc=doc)


def _number(value):
    """A number as the window's export writes it."""
    return value if value is None or math.isfinite(value) else _NOT_FINITE[str(value)]


def _derivative(g, i, knot, side, name):
    """The derivative `name` at the i-th wavelength of `g`, or at a knot
    there on its side `side`, 0 left and 1 right, as the window's export
    writes it."""
    return _number(g._values[name][i] if knot is None else knot[name][side])


def _row(g, i, knot, side, columns):
    """The table's row for the i-th wavelength of `g`, or for one side of a
    knot there; `columns` says whether the table has its Knot and Outside
    data columns. The phase is the same on both sides of a knot."""
    knotted, outside = columns
    marks = [_KNOT_SIDES[side] if knot else ""] * knotted + [g.outside[i] or ""] * outside
    values = [_derivative(g, i, knot, side, name) for name, _ in _DERIVATIVES]
    return [g.wavelength[i]] + marks + values + [_number(g.phase[i]), _derivative(g, i, knot, side, _TOD[0])]


def _table_rows(g):
    """The rows of the window's table of `g`, its heading first: a row per
    wavelength, two at a sampled knot, one for each side of it."""
    knots = {knot["wavelength"]: knot for knot in g.knots}
    columns = (bool(knots), any(g.outside))
    header = [_WAVELENGTH] + [_KNOT] * columns[0] + [_OUTSIDE] * columns[1] \
        + [label for _, label in _DERIVATIVES] + [_PHASE, _TOD[1]]
    rows = [header]
    for i, wavelength in enumerate(g.wavelength):
        knot = knots.get(wavelength)
        rows.extend(_row(g, i, knot, side, columns) for side in ((0, 1) if knot else (None,)))
    return rows


class GroupDelay:
    """Phase, group delay, GDD, TOD and CDC of a design's reflected or
    transmitted light against wavelength, as design.group_delay() computes
    them and the Group Delay / GDD window shows them. ``g.phase``, ``g.gd``,
    ``g.gdd``, ``g.tod`` and ``g.cdc`` are Curves.

    Example::

        design = tf.new_design("Mirror")
        design.stack("(HL)^8 H")
        g = design.group_delay(500, 600, step=1)
        print(g.mode, "mean GD from 540 to 560 nm", round(g.gd.mean(540, 560), 3), "fs")
    """

    def __init__(self, result):
        wavelength = result["wavelength"]
        self._values = {
            "mode": result["mode"], "response": result["response"], "angle": result["angle"], "pol": result["pol"],
            "step": result["step"], "reference": result["reference"], "wavelength": wavelength,
            "gd": result["gd"], "gdd": result["gdd"], "tod": result["tod"], "cdc": result["cdc"],
            "outside": result["outside"], "knots": result["knots"], "invalid": result["invalid"],
            "models": result["models"], "out_of_range": result["outOfRange"],
        }
        self._curves = {name: Curve(result[name], wavelength) for name in ("phase", "gd", "gdd", "tod", "cdc")}

    mode = _reading("mode", """The sides computed: "front" or "back", one coated side, or "total",
        the whole part in transmission.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print(design.group_delay().mode, design.group_delay(400, 800, response="T", side="total").mode)
        """)
    response = _reading("response", """The light whose phase is taken: "R", reflected, or "T",
        transmitted.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print(design.group_delay(400, 800, response="T").response)
        """)
    angle = _reading("angle", """The angle of incidence, degrees in the medium light comes from.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print(design.group_delay(400, 800, angle=45).angle, "degrees")
        """)
    pol = _reading("pol", """The polarization: "avg", "s" or "p".

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print(design.group_delay(400, 800, angle=45, pol="p").pol)
        """)
    step = _reading("step", """The wavelength step, nm, or "auto", the window's own grid.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print(design.group_delay(400, 800, step="auto").step)
        """)
    reference = _reading("reference", """The wavelength the phase is shifted to 0 at, nm, or None for the
        absolute phase: without a reference, or when the sample nearest it has no value.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print(design.group_delay(400, 800, reference=550).reference, "nm")
        """)
    wavelength = _reading("wavelength", """The wavelengths, nm.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print(design.group_delay(400, 800, step=100).wavelength)
        """)
    phase = _curve("phase", """The phase φ, degrees, a Curve: unwrapped along the grid, absolute,
        or 0 at the sample nearest the reference when one was given.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            g = design.group_delay(500, 600, reference=550)
            print("phase from 500 to 600 nm:", round(g.phase.min(), 1), "to", round(g.phase.max(), 1), "degrees")
        """)
    gd = _curve("gd", """The group delay, fs, a Curve.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print("mean GD from 520 to 580 nm:", round(design.group_delay().gd.mean(520, 580), 3), "fs")
        """)
    gdd = _curve("gdd", """The GDD, fs², a Curve.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            g = design.group_delay()
            print("GDD from 520 to 580 nm:", round(g.gdd.min(520, 580), 3), "to", round(g.gdd.max(520, 580), 3), "fs²")
        """)
    tod = _curve("tod", """The TOD, fs³, a Curve.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print("mean TOD from 520 to 580 nm:", round(design.group_delay().tod.mean(520, 580), 3), "fs³")
        """)
    cdc = _curve("cdc", """The CDC, GDD · 2πc/λ², fs/nm, a Curve: the chromatic dispersion as
        Essential Macleod reports it, with the sign of GDD. The slope of group delay against
        wavelength, dGD/dλ, is its negative.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print("mean CDC from 520 to 580 nm:", round(design.group_delay().cdc.mean(520, 580), 5), "fs/nm")
        """)
    outside = _reading("outside", """For each wavelength, the name of the material whose data its value
        was taken outside of, or None.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            g = design.group_delay(200, 2500, step=10)
            print(sum(1 for name in g.outside if name), "wavelengths outside a material's data")
        """)
    knots = _reading("knots", """The table knots that are exactly wavelengths of the grid, a list
        of dicts with wavelength, gd, gdd, tod and cdc, each quantity a pair [left, right] of its
        values on the two sides of the knot; the value the curves hold at that wavelength reads
        the material averaged across the knot. On the uniform grid none is read when the knots in
        range are dense against the grid, more than one per 8 points, and on side="total" none is
        read.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            for knot in design.group_delay().knots[:3]:
                print(knot["wavelength"], "nm: GDD", round(knot["gdd"][0], 3), "and", round(knot["gdd"][1], 3), "fs²")
        """)
    invalid = _reading("invalid", """The wavelengths with no value, a list of dicts with wavelength
        and reason; the curves are NaN there. Empty when every wavelength has one.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print(len(design.group_delay().invalid), "wavelengths with no value")
        """)
    models = _reading("models", """The material models the values come from, each "name: model".

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print("\\n".join(design.group_delay().models))
        """)
    out_of_range = _reading("out_of_range", """The materials of the sides computed whose data stop
        inside the range, a list of dicts with id, name, rangeNm and heldFlat: outside rangeNm their
        n and k are held at the last value (heldFlat True) or extrapolated. Empty when every
        material covers it.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print([m["id"] for m in design.group_delay(200, 2500, step=10).out_of_range])
        """)

    def save_csv(self, path):
        """Writes the curves to a CSV file as the window's Copy CSV writes its
        table: λ (nm), then Knot where a table knot is sampled, a row for
        each side of it, λ− and λ+, then Outside data where a value was taken
        outside a material's data, then Group Delay (fs), GDD (fs²), CDC
        (fs/nm), Phase φ (°) and TOD (fs³). The phase is the one phase holds.
        The numbers are the window's, written in Python's float notation. A
        file that is there is written over.

        Args:
            path: The file to write. A relative path is taken from the
                program's working folder: in the Script Console, the script's
                folder, or the data folder for a script not saved.

        Example::

            import time

            name = "group-delay-{}.csv".format(time.time_ns())
            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            design.group_delay(400, 800, step=1).save_csv(name)
            print("Wrote", name)
        """
        write_rows(path, _table_rows(self))

    def __repr__(self):
        values = self._values
        return "<GroupDelay {} {} {} at {} degrees from {} to {} nm, {} points>".format(
            values["mode"], values["response"], values["pol"], values["angle"], self.wavelength[0],
            self.wavelength[-1], len(self.wavelength))
