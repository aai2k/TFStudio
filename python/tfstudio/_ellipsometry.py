"""A coated side's Ψ and Δ, as design.ellipsometry() and
design.ellipsometry_vs_angle() answer."""

from ._csv import write_rows
from ._errors import TFStudioError
from ._results import AngleCurve, Curve, _js_number

# The window's table headings (EllipsometryResults.js, and the English
# spectralAxis.lambdaShort and spectrumExchange.aoiLabel).
_WAVELENGTH, _ANGLE, _PSI, _DELTA = "λ (nm)", "AOI (°)", "Ψ (°)", "Δ (°)"


def _reading(name, doc):
    """A read-only attribute giving self._values[name], documented as `doc`."""
    return property(lambda self: self._values[name], doc=doc)


def _curve(name, doc):
    """The curve `name` at the first angle, a read-only attribute documented as `doc`."""
    return property(lambda self: self._curves[0][name], doc=doc)


def _header(e):
    """The first row of the window's export of `e`."""
    if e._values["angular"]:
        return [_ANGLE, _PSI, _DELTA]
    angles = e.angles
    if len(angles) == 1:
        return [_WAVELENGTH, _PSI, _DELTA]
    return [_WAVELENGTH] + ["{} at {:g} deg".format(label, angle) for angle in angles for label in (_PSI, _DELTA)]


def _condition_lines(e):
    """The # lines above the table: against wavelength at one angle, the
    design's name and the angle and side, as Measured Ellipsometry's export of
    the design's Psi/Delta writes them; none otherwise."""
    if e._values["angular"] or len(e.angles) != 1:
        return []
    return ["# {}".format(e._values["name"] or "design"),
            "# AOI {} deg, {} side".format(_js_number(e.angles[0]), e.mode)]


class Ellipsometry:
    """Ψ and Δ of one coated side, as design.ellipsometry() computes them
    against wavelength, at one angle of incidence or several, or
    design.ellipsometry_vs_angle() against angle at one wavelength. Against
    wavelength, ``e.psi`` and ``e.delta`` are Curves at the first angle asked
    and ``e.angle(70)`` is the sweep at another; against angle, they are
    AngleCurves.

    Example::

        design = tf.new_design("Mirror")
        design.stack("(HL)^3 H")
        e = design.ellipsometry(400, 800, angles=[65, 70])
        print(e.mode, min(e.psi), max(e.angle(70).delta))
    """

    def __init__(self, result):
        wavelength = result["wavelength"]
        angular = not isinstance(wavelength, list)
        series = [{"psi": result["psi"], "delta": result["delta"]}] if angular else result["angles"]
        angles = result["angle"] if angular else [one["angle"] for one in series]
        self._values = {"mode": result["mode"], "wavelength": wavelength, "angles": angles,
                        "delta_convention": result["deltaConvention"], "out_of_range": result["outOfRange"],
                        "angular": angular, "name": None}
        self._series = series
        if angular:
            self._curves = [{name: AngleCurve(one[name], angles) for name in ("psi", "delta")} for one in series]
        else:
            self._curves = [{name: Curve(one[name], wavelength) for name in ("psi", "delta")} for one in series]

    def _named(self, name):
        """The result with the name of the design it was computed on, which its
        CSV file gives."""
        self._values["name"] = name
        return self

    mode = _reading("mode", """The side computed: "front" or "back".

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.ellipsometry().mode)
        """)
    wavelength = _reading("wavelength", """Against wavelength, the wavelengths, nm; against angle, the one
        wavelength, nm.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.ellipsometry(400, 800, step=100).wavelength, design.ellipsometry_vs_angle(633).wavelength)
        """)
    angles = _reading("angles", """The angles of incidence, degrees in the medium light comes from:
        against wavelength, those asked, in the order asked; against angle, the angles swept.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            e = design.ellipsometry(400, 800, angles=[55, 70])
            for a in e.angles:
                print(a, min(e.angle(a).psi))
        """)
    delta_convention = _reading("delta_convention", """The sign of Δ: "azzam", the Azzam-Bashara sign an
        ellipsometer writes, or "reversed", 360 degrees minus that.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.ellipsometry(400, 800, delta_convention="reversed").delta_convention)
        """)
    psi = _curve("psi", """Ψ, degrees from 0 to 90, where tan Ψ is
        |r_p| / |r_s|, and NaN where the computed r_s or r_p is exactly zero: against
        wavelength a Curve at the first angle, against angle an AngleCurve.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.ellipsometry().psi.mean(500, 600))
        """)
    delta = _curve("delta", """Δ, degrees from 0 up to 360, the phase of
        r_p / r_s in the convention delta_convention names, and NaN where Ψ is: against wavelength
        a Curve at the first angle, against angle an AngleCurve.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(max(design.ellipsometry_vs_angle(633).delta))
        """)
    out_of_range = _reading("out_of_range", """The materials of the side computed whose data stop inside
        the range, or do not reach the one wavelength of a sweep against angle, a list of dicts with
        id, name, rangeNm and heldFlat: outside rangeNm their n and k are held at the last value
        (heldFlat True) or extrapolated. Empty when every material covers it.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print([m["id"] for m in design.ellipsometry(200, 2500, step=10).out_of_range])
        """)

    def angle(self, angle):
        """The sweep against wavelength at one of the angles it was computed
        at.

        Args:
            angle: The angle of incidence, degrees.

        Returns:
            An Ellipsometry of that angle alone.

        Raises:
            TFStudioError: an angle the sweep was not computed at, or a sweep
                against angle.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            e = design.ellipsometry(400, 800, angles=[55, 70])
            print(min(e.angle(70).psi))
        """
        values = self._values
        if values["angular"]:
            raise TFStudioError("angle: this sweep runs over angle at {} nm; psi and delta hold it".format(
                values["wavelength"]))
        for i, computed in enumerate(values["angles"]):
            if computed == angle:
                return Ellipsometry({"mode": values["mode"], "wavelength": values["wavelength"],
                                     "deltaConvention": values["delta_convention"],
                                     "outOfRange": values["out_of_range"], "angles": [self._series[i]]})._named(values["name"])
        raise TFStudioError("angle: the sweep was computed at {}, not at {}".format(values["angles"], angle))

    def save_csv(self, path):
        """Writes Ψ and Δ to a CSV file as the window's export writes its
        table: a column of wavelengths, λ (nm), or of angles, AOI (°), then
        Ψ (°) and Δ (°). Against wavelength at more than one angle, Ψ and Δ
        come for each angle in turn, each headed with its angle. Against
        wavelength at one angle, two # lines come first, as Measured
        Ellipsometry's export of the design's Psi/Delta writes them: the
        design's name, then the angle and the side, which its import reads
        back. The numbers are the window's, written in Python's float
        notation. A file that is there is written over.

        Args:
            path: The file to write. A relative path is taken from the
                program's working folder: in the Script Console, the script's
                folder, or the data folder for a script not saved.

        Example::

            import time

            name = "ellipsometry-{}.csv".format(time.time_ns())
            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            design.ellipsometry(400, 800, step=5).save_csv(name)
            print("Wrote", name)
        """
        xs = self.angles if self._values["angular"] else self.wavelength
        rows = [[x] + [one[name][i] for one in self._series for name in ("psi", "delta")] for i, x in enumerate(xs)]
        write_rows(path, [_header(self)] + rows, _condition_lines(self))

    def __repr__(self):
        values = self._values
        if values["angular"]:
            return "<Ellipsometry {} at {} nm, {} to {} degrees, {} points, {}>".format(
                values["mode"], values["wavelength"], self.angles[0], self.angles[-1], len(self.angles),
                values["delta_convention"])
        return "<Ellipsometry {} from {} to {} nm, {} points, angles {}, {}>".format(
            values["mode"], self.wavelength[0], self.wavelength[-1], len(self.wavelength), self.angles,
            values["delta_convention"])
