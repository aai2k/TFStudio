"""A design's spectrum with graded interlayers against the design as it
stands, as design.inhomogeneities() answers."""

import collections

from ._csv import write_rows
from ._results import SpecReport, _spectrum_curve

# The curves of one spectrum, each a Curve: R, T and A for unpolarized light,
# then for s and p.
SpectrumCurves = collections.namedtuple("SpectrumCurves", "R T A Rs Rp Ts Tp As Ap")
# One interlayer: side, interface, thickness in nm, profile, slices, and the
# two materials that meet there by id, in the order the interlayer grades.
Interlayer = collections.namedtuple("Interlayer", "side interface thickness profile slices materials")

# The window's table with every curve switched on (inhomogeneities/tableModel.js,
# and the English spectralAxis.lambdaShort and inhomogeneities): the curves in
# its order, each its homogeneous and its graded value. Its Copy CSV keeps the
# headings' (%) and writes the values as fractions of 1.
_WAVELENGTH = "λ (nm)"
_TABLE_CURVES = ("T", "Ts", "Tp", "R", "Rs", "Rp", "A", "As", "Ap")


def _reading(name, doc):
    """A read-only attribute giving self._values[name], documented as `doc`."""
    return property(lambda self: self._values[name], doc=doc)


def _curves_of(spectrum, wavelength):
    return SpectrumCurves(*(_spectrum_curve(spectrum[name], wavelength, name) for name in SpectrumCurves._fields))


def _table_rows(r):
    """The rows of the window's table of `r`, its heading first."""
    header = [_WAVELENGTH] + [label for key in _TABLE_CURVES
                              for label in ("{} homogeneous (%)".format(key), "{} graded (%)".format(key))]
    rows = [header]
    for i, wavelength in enumerate(r.wavelength):
        rows.append([wavelength] + [value for key in _TABLE_CURVES
                                    for value in (getattr(r.homogeneous, key)[i], getattr(r.graded, key)[i])])
    return rows


class Inhomogeneities:
    """The spectrum of a design with graded interlayers at its interfaces,
    against the design as it stands, as design.inhomogeneities() computes it
    and the Inhomogeneities window shows it. ``r.homogeneous`` and
    ``r.graded`` hold the curves, each a Curve.

    Example::

        design = tf.new_design("Mirror")
        design.stack("(HL)^4 H")
        r = design.inhomogeneities(interlayers=[{"interface": 4, "thickness": 3}])
        print(r.mode, "mean R from 500 to 600 nm", round(r.homogeneous.R.mean(500, 600), 5), "becomes",
              round(r.graded.R.mean(500, 600), 5))
    """

    def __init__(self, result):
        wavelength = result["wavelength"]
        specification = result["specification"]
        self._values = {
            "mode": result["mode"], "angle": result["angle"], "wavelength": wavelength,
            "homogeneous": _curves_of(result["homogeneous"], wavelength), "graded": _curves_of(result["graded"], wavelength),
            "interlayers": [Interlayer(row["side"], row["interface"], row["thickness"], row["profile"], row["slices"],
                                       tuple(row["materials"])) for row in result["interlayers"]],
            "added_thickness": result["addedThickness"],
            "specification": SpecReport(specification) if specification else None,
            "out_of_range": result["outOfRange"],
        }

    mode = _reading("mode", """The sides computed: "front", "back" or "total", the whole part.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(design.inhomogeneities().mode, design.inhomogeneities(side="total").mode)
        """)
    angle = _reading("angle", """The angle of incidence, degrees in the incident medium.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(design.inhomogeneities(angle=30).angle, "degrees")
        """)
    wavelength = _reading("wavelength", """The wavelengths, nm.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(design.inhomogeneities(step=100).wavelength)
        """)
    homogeneous = _reading("homogeneous", """The design as it stands, a named tuple of Curves of fractions
        of 1: R, T and A for unpolarized light and Rs, Rp, Ts, Tp, As and Ap for s and p.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print("peak R", round(design.inhomogeneities().homogeneous.R.max(), 5))
        """)
    graded = _reading("graded", """The design with the interlayers in, the same curves as homogeneous.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            r = design.inhomogeneities(interlayers=[{"interface": 4, "thickness": 3}, {"interface": 5, "thickness": 3}])
            print("peak R", round(r.graded.R.max(), 5), "against", round(r.homogeneous.R.max(), 5))
        """)
    interlayers = _reading("interlayers", """The interlayers, in the order given, with their defaults filled
        in, each a named tuple (side, interface, thickness, profile, slices, materials): materials
        the two that meet there, by id, in the order the interlayer grades from one to the other.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            for row in design.inhomogeneities(interlayers=[{"interface": 0}, {"interface": 9}]).interlayers:
                print(row.side, row.interface, row.thickness, "nm", row.profile, row.slices, "slices:", " to ".join(row.materials))
        """)
    added_thickness = _reading("added_thickness", """What the interlayers add to the coating, nm: the window's
        Σ.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(design.inhomogeneities(interlayers=[{"interface": 1, "thickness": 2}, {"interface": 2}]).added_thickness, "nm")
        """)
    specification = _reading("specification", """The verdict for the design with its interlayers in, a
        SpecReport as specification.check() gives one, each check read at its own Step, as the
        badge under the window's chart reads it; None when the design has no specification.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.98)
            report = design.inhomogeneities(interlayers=[{"interface": 4, "thickness": 10}]).specification
            print(report.passed, round(report.rows[0].value, 5))
        """)
    out_of_range = _reading("out_of_range", """The materials of the sides computed whose data stop
        inside the range, a list of dicts with id, name, rangeNm and heldFlat: outside rangeNm their
        n and k are held at the last value (heldFlat True) or extrapolated. Empty when every
        material covers it.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print([m["id"] for m in design.inhomogeneities(start=200, end=2500, step=10).out_of_range])
        """)

    def save_csv(self, path):
        """Writes the curves to a CSV file as the window's Copy CSV writes its
        table with every curve switched on: λ (nm), then for T, Ts, Tp, R,
        Rs, Rp, A, As and Ap in turn the homogeneous and the graded value, as
        fractions of 1. The numbers are the window's, written in Python's
        float notation. A file that is there is written over.

        Args:
            path: The file to write. A relative path is taken from the
                program's working folder: in the Script Console, the script's
                folder, or the data folder for a script not saved.

        Example::

            import time

            name = "interlayers-{}.csv".format(time.time_ns())
            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            design.inhomogeneities(interlayers=[{"interface": 4}]).save_csv(name)
            print("Wrote", name)
        """
        write_rows(path, _table_rows(self))

    def __repr__(self):
        count = len(self.interlayers)
        return "<Inhomogeneities {} at {} degrees from {} to {} nm, {} points, {} interlayer{}>".format(
            self.mode, self.angle, self.wavelength[0], self.wavelength[-1], len(self.wavelength), count,
            "" if count == 1 else "s")
