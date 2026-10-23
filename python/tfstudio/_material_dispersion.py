"""A material's phase, group delay, GDD, CDC and TOD through a slab of it,
and its group index, as material.dispersion() answers."""

import math

from ._csv import write_rows
from ._results import Curve

# The window's table headings (materialDispersionSpectrum.js, and the English
# spectralAxis.lambdaShort, gdgdd and materialRange.outsideColumn), with the
# curves in the order the table shows them.
_WAVELENGTH, _OUTSIDE = "λ (nm)", "Outside data"
_COLUMNS = (("phase", "Phase φ (°)"), ("gd", "Group Delay (fs)"), ("gdd", "GDD (fs²)"), ("cdc", "CDC (fs/nm)"),
            ("tod", "TOD (fs³)"), ("group_index", "nᵧ"))
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
    return value if math.isfinite(value) else _NOT_FINITE[str(value)]


def _table_rows(d):
    """The rows of the window's table of `d`, its heading first: a row per
    wavelength, with the Outside data column when a value was taken outside
    the material's data."""
    outside = any(d.outside)
    rows = [[_WAVELENGTH] + [_OUTSIDE] * outside + [label for _, label in _COLUMNS]]
    for i, wavelength in enumerate(d.wavelength):
        marks = [d.outside[i] or ""] * outside
        rows.append([wavelength] + marks + [_number(d._curves[name][i]) for name, _ in _COLUMNS])
    return rows


class MaterialDispersion:
    """Phase, group delay, GDD, CDC and TOD of light through a slab of one
    material, and its group index, against wavelength, as
    material.dispersion() computes them and the Material Dispersion window
    shows them. ``d.phase``, ``d.gd``, ``d.gdd``, ``d.cdc``, ``d.tod`` and
    ``d.group_index`` are Curves.

    Example::

        d = tf.materials["BK7"].dispersion(700, 900, thickness=2)
        print("mean GDD of 2 mm of BK7 from 780 to 820 nm:", round(d.gdd.mean(780, 820), 1), "fs²")
    """

    def __init__(self, result):
        wavelength = result["wavelength"]
        self._values = {
            "id": result["id"], "thickness": result["thickness"], "wavelength": wavelength, "outside": result["outside"],
            "masked": result["masked"], "knots": result["knots"], "model": result["model"],
        }
        self._curves = {name: Curve(result[key], wavelength) for name, key in
                        (("phase", "phase"), ("gd", "gd"), ("gdd", "gdd"), ("cdc", "cdc"), ("tod", "tod"),
                         ("group_index", "groupIndex"))}

    thickness = _reading("thickness", """The slab's thickness, mm.

        Example::

            print(tf.materials["BK7"].dispersion().thickness, "mm")
        """)
    wavelength = _reading("wavelength", """The wavelengths, nm: the window's grid, with a sample on
        each table knot in range.

        Example::

            print(len(tf.materials["BK7"].dispersion(700, 900).wavelength), "wavelengths")
        """)
    phase = _curve("phase", """The phase φ = −(d/c)·ω·n, degrees, a Curve.

        Example::

            d = tf.materials["BK7"].dispersion(700, 900)
            print("phase from", round(d.phase.min()), "to", round(d.phase.max()), "degrees")
        """)
    gd = _curve("gd", """The group delay, fs, a Curve.

        Example::

            d = tf.materials["BK7"].dispersion(700, 900)
            print("GD of 1 mm of BK7 at 800 nm:", round(d.gd[d.wavelength.index(800)], 1), "fs")
        """)
    gdd = _curve("gdd", """The GDD, fs², a Curve.

        Example::

            d = tf.materials["BK7"].dispersion(700, 900)
            print("GDD of 1 mm of BK7 at 800 nm:", round(d.gdd[d.wavelength.index(800)], 2), "fs²")
        """)
    cdc = _curve("cdc", """The CDC, GDD · 2πc/λ², fs/nm, a Curve, with the sign of GDD; the slope
        of group delay against wavelength, dGD/dλ, is its negative.

        Example::

            d = tf.materials["BK7"].dispersion(700, 900)
            print("CDC of 1 mm of BK7 at 800 nm:", round(d.cdc[d.wavelength.index(800)], 4), "fs/nm")
        """)
    tod = _curve("tod", """The TOD, fs³, a Curve.

        Example::

            d = tf.materials["BK7"].dispersion(700, 900)
            print("TOD of 1 mm of BK7 at 800 nm:", round(d.tod[d.wavelength.index(800)], 2), "fs³")
        """)
    group_index = _curve("group_index", """The group index n − λ·dn/dλ, a Curve.

        Example::

            d = tf.materials["BK7"].dispersion(700, 900)
            print("group index of BK7 at 800 nm:", round(d.group_index[d.wavelength.index(800)], 5))
        """)
    outside = _reading("outside", """For each wavelength, the material's name where its value was
        taken outside the material's data, held at the edge or extrapolated, or None.

        Example::

            d = tf.materials["TiO2"].dispersion(300, 1100)
            print(sum(1 for name in d.outside if name), "wavelengths outside the data")
        """)
    masked = _reading("masked", """The wavelengths with no value, a list of dicts with wavelength,
        reason and maximumThickness. reason says why: most often the slab absorbs the light there
        to an optical depth above 50, and maximumThickness, mm, is then the thickness up to which
        it would have one; it is None when no thickness gives one, as where the material's model
        has no third derivative. The curves are NaN there. Empty when every wavelength has one.

        Example::

            d = tf.materials["Si"].dispersion(400, 1100, thickness=1)
            print(len(d.masked), "wavelengths with no value; the first", d.masked[0])
        """)
    knots = _reading("knots", """The table knots that are wavelengths of the grid, a list of dicts
        with wavelength, gd, gdd, tod and cdc, each quantity a pair [left, right] of its values on
        the two sides of the knot; the value the curves hold at that wavelength reads the material
        averaged across the knot. None is read when the knots are dense against the grid, more
        than one per 8 points.

        Example::

            for knot in tf.materials["TiO2"].dispersion().knots[:3]:
                print(knot["wavelength"], "nm: GDD", round(knot["gdd"][0], 3), "and", round(knot["gdd"][1], 3), "fs²")
        """)
    model = _reading("model", """The models the material's n and k come from, as the window names
        them.

        Example::

            print(tf.materials["BK7"].dispersion().model)
        """)

    def save_csv(self, path):
        """Writes the curves to a CSV file as the window's Copy CSV writes its
        table: λ (nm), then Outside data where a value was taken outside the
        material's data, then Phase φ (°), Group Delay (fs), GDD (fs²),
        CDC (fs/nm), TOD (fs³) and nᵧ, the group index. The numbers are the
        window's, written in Python's float notation. A file that is there is
        written over.

        Args:
            path: The file to write. A relative path is taken from the
                program's working folder: in the Script Console, the script's
                folder, or the data folder for a script not saved.

        Example::

            import time

            name = "bk7-dispersion-{}.csv".format(time.time_ns())
            tf.materials["BK7"].dispersion(700, 900).save_csv(name)
            print("Wrote", name)
        """
        write_rows(path, _table_rows(self))

    def __repr__(self):
        values = self._values
        return "<MaterialDispersion {}, {} mm, from {} to {} nm, {} points>".format(
            values["id"], values["thickness"], self.wavelength[0], self.wavelength[-1], len(self.wavelength))
