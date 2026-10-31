"""A design's specular R and T with rough interfaces against the smooth
design, as design.roughness() answers."""

import collections

from ._csv import write_rows
from ._results import _spectrum_curve

# The curves of one spectrum, each a Curve: R and T for unpolarized light,
# then for s and p.
RoughnessCurves = collections.namedtuple("RoughnessCurves", "R T Rs Rp Ts Tp")
# One layer set to 0 nm: its side, and its number as the Design Editor
# numbers it.
ThinnedLayer = collections.namedtuple("ThinnedLayer", "side number")

# The window's table with every curve switched on (roughnessScattering/tableModel.js,
# and the English spectralAxis.lambdaShort and roughnessScattering): the curves
# in its order, each its smooth and its rough value, then the loss. Its Copy
# CSV writes each value in the unit its heading names: R and T in %, the loss
# in ppm.
_WAVELENGTH = "λ (nm)"
_TABLE_CURVES = ("T", "Ts", "Tp", "R", "Rs", "Rp")
_LOSS = "Specular loss (ppm)"


def _reading(name, doc):
    """A read-only attribute giving self._values[name], documented as `doc`."""
    return property(lambda self: self._values[name], doc=doc)


def _curves_of(spectrum, wavelength):
    return RoughnessCurves(*(_spectrum_curve(spectrum[name], wavelength, name) for name in RoughnessCurves._fields))


def _table_rows(r):
    """The rows of the window's table of `r`, its heading first."""
    header = [_WAVELENGTH] + [label for key in _TABLE_CURVES
                              for label in ("{} smooth (%)".format(key), "{} rough (%)".format(key))] + [_LOSS]
    rows = [header]
    for i, wavelength in enumerate(r.wavelength):
        rows.append([wavelength] + [value * 100 for key in _TABLE_CURVES
                                    for value in (getattr(r.smooth, key)[i], getattr(r.rough, key)[i])] + [r.loss[i] * 1e6])
    return rows


class Roughness:
    """The specular R and T of a design with rough interfaces, against the
    smooth design, as design.roughness() computes them and the Roughness /
    Scattering window shows them. ``r.smooth`` and ``r.rough`` hold the
    curves and ``r.loss`` the light lost from the specular beams, each a
    Curve.

    Example::

        design = tf.new_design("Mirror")
        design.stack("(HL)^4 H")
        r = design.roughness(sigma=2)
        print(r.mode, "mean R from 500 to 600 nm", round(r.smooth.R.mean(500, 600), 5), "becomes",
              round(r.rough.R.mean(500, 600), 5))
    """

    def __init__(self, result):
        wavelength = result["wavelength"]
        self._values = {
            "mode": result["mode"], "angle": result["angle"], "wavelength": wavelength,
            "smooth": _curves_of(result["smooth"], wavelength), "rough": _curves_of(result["rough"], wavelength),
            "loss": _spectrum_curve(result["loss"], wavelength, "loss"),
            "thinned": [ThinnedLayer(layer["side"], layer["number"]) for layer in result["thinned"]],
            "long_range": result["longRange"],
            "out_of_range": result["outOfRange"],
        }

    mode = _reading("mode", """The sides computed: "front", "back" or "total", the whole part.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(design.roughness().mode, design.roughness(side="total").mode)
        """)
    angle = _reading("angle", """The angle of incidence, degrees in the incident medium.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(design.roughness(angle=30).angle, "degrees")
        """)
    wavelength = _reading("wavelength", """The wavelengths, nm.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(design.roughness(step=100).wavelength)
        """)
    smooth = _reading("smooth", """The design as it stands, a named tuple of Curves of fractions of 1:
        R and T for unpolarized light and Rs, Rp, Ts and Tp for s and p.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print("peak R", round(design.roughness().smooth.R.max(), 5))
        """)
    rough = _reading("rough", """The design with its rough interfaces, the same curves as smooth.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            r = design.roughness(sigma=3, range="short")
            print("peak R", round(r.rough.R.max(), 5), "against", round(r.smooth.R.max(), 5))
        """)
    loss = _reading("loss", """The light lost from the specular beams, smooth R + T minus rough
        R + T for unpolarized light, a Curve of fractions of 1. In an absorbing design it holds
        the change in absorption too, and where a transition layer replaces part of an absorbing
        layer it can fall below 0.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            loss = design.roughness(sigma=2).loss
            print("largest loss", round(loss.max() * 1e6, 1), "ppm")
        """)
    thinned = _reading("thinned", """The layers set to 0 nm because their transition layer took more
        than they had, each a named tuple (side, number), numbered as the Design Editor numbers
        them. Empty when every layer is thicker than 2σ.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            design.layers[1].thickness = 3
            print(design.roughness(sigma=2).thinned)
        """)
    long_range = _reading("long_range", """True when a long-range interface with a σ above 0 is in. The
        long-range layer is derived for one surface at normal incidence, so at an angle, under a
        cone or in a multilayer it is an estimate.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(design.roughness().long_range, design.roughness(range="short").long_range)
        """)
    out_of_range = _reading("out_of_range", """The materials of the sides computed whose data stop
        inside the range, a list of dicts with id, name, rangeNm and heldFlat: outside rangeNm their
        n and k are held at the last value (heldFlat True) or extrapolated. Empty when every
        material covers it.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print([m["id"] for m in design.roughness(start=200, end=2500, step=10).out_of_range])
        """)

    def save_csv(self, path):
        """Writes the curves to a CSV file as the window's Copy CSV writes its
        table with every curve switched on: λ (nm), then for T, Ts, Tp, R,
        Rs and Rp in turn the smooth and the rough value in %, then the loss
        in ppm, as the headings name them. The numbers are the window's,
        written in Python's float notation. A file that is there is written
        over.

        Args:
            path: The file to write. A relative path is taken from the
                program's working folder: in the Script Console, the script's
                folder, or the data folder for a script not saved.

        Example::

            import time

            name = "roughness-{}.csv".format(time.time_ns())
            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            design.roughness(sigma=2).save_csv(name)
            print("Wrote", name)
        """
        write_rows(path, _table_rows(self))

    def __repr__(self):
        count = len(self.thinned)
        return "<Roughness {} at {} degrees from {} to {} nm, {} points, {} layer{} thinned to 0 nm>".format(
            self.mode, self.angle, self.wavelength[0], self.wavelength[-1], len(self.wavelength), count,
            "" if count == 1 else "s")
