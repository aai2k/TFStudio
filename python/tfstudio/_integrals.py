"""A design's weighted averages of T, R and A, as design.integrals()
answers."""

import collections
import math

from ._csv import write_rows
from ._errors import TFStudioError

# One integral: value, min and max as fractions of 1, min_at and max_at in nm,
# band and spectrum_span (start, end) in nm.
IntegralRow = collections.namedtuple("IntegralRow",
                                     "key quantity value min min_at max max_at band covered spectrum_span")


def _reading(name, doc):
    """A read-only attribute giving self._values[name], documented as `doc`."""
    return property(lambda self: self._values[name], doc=doc)


def _finite(value):
    """`value`, or None for a number the integral could not give, which the
    window's export writes as an empty cell."""
    return value if value is not None and math.isfinite(value) else None


def _whole(value):
    """`value` rounded to a whole number as JavaScript's toFixed(0) writes a
    wavelength: a half rounds up."""
    return "{:d}".format(math.floor(value + 0.5))


def _band(row):
    start, end = row.band
    return "" if start == end else "{}-{} nm".format(_whole(start), _whole(end))


def _table_rows(integrals):
    """The rows of the window's English export, each named by its key."""
    rows = [["Integral", "Value", "%", "Min", "Min λ (nm)", "Max", "Max λ (nm)", "Band"]]
    for row in integrals.rows:
        value = _finite(row.value)
        rows.append([row.key, value, None if value is None else value * 100, _finite(row.min), _finite(row.min_at),
                     _finite(row.max), _finite(row.max_at), _band(row)])
    return rows


class Integrals:
    """A design's weighted averages of T, R and A, as design.integrals()
    computes them and the Integral Values window lists them: the built-in
    rows, Tvis to RNIR, and then the rows of your own, each read by its key
    with [].

    Example::

        design = tf.new_design("AR")
        design.stack("HL")
        iv = design.integrals()
        print(iv.mode, "Tvis", round(iv["Tvis"].value, 4), "Rsol", round(iv["Rsol"].value, 4))
    """

    def __init__(self, table):
        rows = [IntegralRow(r["key"], r["quantity"], r["value"], r["min"], r["minAt"], r["max"], r["maxAt"],
                            tuple(r["band"]), r["covered"], tuple(r["spectrumSpan"])) for r in table["rows"]]
        self._values = {
            "mode": table["mode"], "start": table["start"], "end": table["end"], "step": table["step"],
            "angle": table["angle"], "pol": table["pol"], "rows": rows, "out_of_range": table["outOfRange"],
        }

    mode = _reading("mode", """The sides computed: "front", "back" or "total", the whole part.

        Example::

            design = tf.new_design("AR")
            design.stack("HL")
            print(design.integrals().mode)
        """)
    start = _reading("start", """The first wavelength of the spectrum, nm.

        Example::

            design = tf.new_design("AR")
            design.stack("HL")
            print(design.integrals(start=350).start, "nm")
        """)
    end = _reading("end", """The last wavelength of the spectrum, nm.

        Example::

            design = tf.new_design("AR")
            design.stack("HL")
            print(design.integrals(end=1200).end, "nm")
        """)
    step = _reading("step", """The wavelength step, nm.

        Example::

            design = tf.new_design("AR")
            design.stack("HL")
            print(design.integrals(step=1).step, "nm")
        """)
    angle = _reading("angle", """The angle of incidence, degrees in the incident medium.

        Example::

            design = tf.new_design("AR")
            design.stack("HL")
            print(design.integrals(angle=30).angle, "degrees")
        """)
    pol = _reading("pol", """The polarization: "avg", "s" or "p".

        Example::

            design = tf.new_design("AR")
            design.stack("HL")
            print(design.integrals(angle=45, pol="p").pol)
        """)
    rows = _reading("rows", """The rows, the built-in ones first as the window lists them, then yours,
        each a named tuple (key, quantity, value, min, min_at, max, max_at, band, covered,
        spectrum_span): quantity "T", "R" or "A"; value the weighted average and min and max the
        lowest and highest value over the band, fractions of 1; min_at and max_at their
        wavelengths, nm; band the band integrated, (start, end) in nm; covered whether the
        spectrum spans the band, its numbers nan when it does not or when the weighting is 0
        over the whole band; spectrum_span the spectrum's first and last wavelength, nm.

        Example::

            design = tf.new_design("AR")
            design.stack("HL")
            for row in design.integrals().rows:
                print(row.key, round(row.value, 4) if row.covered else "no value")
        """)
    out_of_range = _reading("out_of_range", """The materials of the sides computed whose data stop inside
        the range, a list of dicts with id, name, rangeNm and heldFlat: outside rangeNm their n and k
        are held at the last value (heldFlat True) or extrapolated. Empty when every material
        covers it.

        Example::

            design = tf.new_design("AR")
            design.stack("HL")
            print([m["id"] for m in design.integrals().out_of_range])
        """)

    def __getitem__(self, key):
        """The row of the integral named `key`, as rows gives it.

        Args:
            key: The row's key: Tvis, Rvis, Avis, Tsol, Rsol, Asol, TUV,
                RUV, TNIR, RNIR, or the key of a row of your own.

        Returns:
            The row.

        Raises:
            TFStudioError: a key no row has.

        Example::

            design = tf.new_design("AR")
            design.stack("HL")
            row = design.integrals()["Rvis"]
            print("Rvis", round(row.value, 4), "lowest", round(row.min, 4), "at", row.min_at, "nm")
        """
        for row in self.rows:
            if row.key == key:
                return row
        raise TFStudioError("integrals: no row has the key {!r}; the keys are {}".format(
            key, ", ".join(row.key for row in self.rows)))

    def save_csv(self, path):
        """Writes the rows to a CSV file as the window's English export
        writes its table: Integral, Value, %, Min, Min λ (nm), Max, Max λ
        (nm) and Band, with each row named by its key, which for the
        built-in rows is the window's own name, and an empty cell where a row
        has no value. The numbers are the window's, written in Python's float
        notation. A file that is there is written over.

        Args:
            path: The file to write. A relative path is taken from the
                program's working folder: in the Script Console, the script's
                folder, or the data folder for a script not saved.

        Example::

            import time

            name = "integrals-{}.csv".format(time.time_ns())
            design = tf.new_design("AR")
            design.stack("HL")
            design.integrals().save_csv(name)
            print("Wrote", name)
        """
        write_rows(path, _table_rows(self))

    def __repr__(self):
        return "<Integrals {} from {} to {} nm: {} rows>".format(self.mode, self.start, self.end, len(self.rows))
