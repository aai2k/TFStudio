"""The CIE colour of a design's reflectance or transmittance, as
design.color() answers."""

import collections

# Tristimulus values, the white's Y being 100.
XYZ = collections.namedtuple("XYZ", "X Y Z")
# A chromaticity.
Chromaticity = collections.namedtuple("Chromaticity", "x y")
# CIE L*a*b*, the hue angle h in degrees.
Lab = collections.namedtuple("Lab", "L a b C h")
# CIE L*u*v*, the hue angle h in degrees and s the saturation.
Luv = collections.namedtuple("Luv", "L u v C h s")
# A UCS chromaticity: u′ and v′ for CIE 1976, u and v for CIE 1960.
UV = collections.namedtuple("UV", "u v")
# Hunter Lab.
HunterLab = collections.namedtuple("HunterLab", "L a b")
# The dominant or complementary wavelength, nm, and the excitation purity.
Dominant = collections.namedtuple("Dominant", "wavelength complementary purity")
# The sRGB swatch, each channel 0 to 255.
RGB = collections.namedtuple("RGB", "r g b")


def _reading(name, doc):
    """A read-only attribute giving self._values[name], documented as `doc`."""
    return property(lambda self: self._values[name], doc=doc)


class Color:
    """The CIE colour of a design's reflectance or transmittance, as
    design.color() computes it and the Color Evaluation window shows it: the
    tristimulus values on the 380-780 nm band under one illuminant, the colour
    spaces, the dominant wavelength, the correlated colour temperature and the
    sRGB swatch.

    Example::

        design = tf.new_design("Mirror")
        design.stack("(HL)^3 H")
        c = design.color(illuminant="D50")
        print(c.mode, round(c.x, 4), round(c.y, 4), c.lab)
    """

    def __init__(self, colour):
        dominant = colour["dominant"]
        self._values = {
            "mode": colour["mode"], "quantity": colour["quantity"], "angle": colour["angle"], "pol": colour["pol"],
            "observer": colour["observer"], "illuminant": colour["illuminant"], "step": colour["step"],
            "X": colour["X"], "Y": colour["Y"], "Z": colour["Z"], "x": colour["x"], "y": colour["y"],
            "white": XYZ(**colour["white"]), "white_xy": Chromaticity(**colour["whiteXy"]),
            "lab": Lab(**colour["lab"]), "luv": Luv(**colour["luv"]),
            "uv1976": UV(**colour["uv1976"]), "uv1960": UV(**colour["uv1960"]),
            "hunter_lab": HunterLab(**colour["hunterLab"]),
            "dominant": Dominant(dominant["wavelength"], dominant["complementary"], dominant["purity"]),
            "cct": colour["cct"], "duv": colour["duv"], "srgb": RGB(**colour["srgb"]),
            "out_of_range": colour["outOfRange"],
        }

    mode = _reading("mode", """The sides computed: "front", "back" or "total", the whole part.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.color().mode)
        """)
    quantity = _reading("quantity", """What is coloured: "R" or "T".

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.color(quantity="T").quantity)
        """)
    angle = _reading("angle", """The angle of incidence, degrees in the incident medium.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.color(angle=30).angle, "degrees")
        """)
    pol = _reading("pol", """The polarization: "avg", "s" or "p".

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.color(angle=45, pol="s").pol)
        """)
    observer = _reading("observer", """The CIE standard observer, by its field in degrees: 2 or 10.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.color(observer=10).observer)
        """)
    illuminant = _reading("illuminant", """The CIE illuminant: "D65", "D50", "A" or "E".

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.color(illuminant="A").illuminant)
        """)
    step = _reading("step", """The wavelength step of the spectrum the colour is integrated on, nm.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.color(step=1).step, "nm")
        """)
    X = _reading("X", """The tristimulus X, on the scale where the white's Y is 100.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.color().X)
        """)
    Y = _reading("Y", """The tristimulus Y: the luminous reflectance or transmittance, %.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print("luminous R", round(design.color().Y, 2), "%")
        """)
    Z = _reading("Z", """The tristimulus Z, on the scale where the white's Y is 100.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.color().Z)
        """)
    x = _reading("x", """The chromaticity x.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(round(design.color().x, 4))
        """)
    y = _reading("y", """The chromaticity y.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(round(design.color().y, 4))
        """)
    white = _reading("white", """The illuminant's white, a named tuple (X, Y, Z) with Y 100: R or T of 1,
        integrated on the same grid.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.color(illuminant="D50").white)
        """)
    white_xy = _reading("white_xy", """The white's chromaticity, a named tuple (x, y).

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.color().white_xy)
        """)
    lab = _reading("lab", """CIE L*a*b*, a named tuple (L, a, b, C, h), the hue angle h in degrees.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            lab = design.color().lab
            print(round(lab.L, 2), round(lab.a, 2), round(lab.b, 2))
        """)
    luv = _reading("luv", """CIE L*u*v*, a named tuple (L, u, v, C, h, s), the hue angle h in degrees
        and s the saturation.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.color().luv)
        """)
    uv1976 = _reading("uv1976", """The CIE 1976 UCS chromaticity, a named tuple (u, v): u′ and v′.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.color().uv1976)
        """)
    uv1960 = _reading("uv1960", """The CIE 1960 UCS chromaticity, a named tuple (u, v).

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.color().uv1960)
        """)
    hunter_lab = _reading("hunter_lab", """Hunter Lab, a named tuple (L, a, b).

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.color().hunter_lab)
        """)
    dominant = _reading("dominant", """A named tuple (wavelength, complementary, purity): the dominant
        wavelength in nm, or for a purple None and its complementary wavelength in nm; purity the
        excitation purity as a fraction of 1, measured to the purple line for a purple. Both
        wavelengths are None for the white itself.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            d = design.color().dominant
            print(d.wavelength if d.wavelength is not None else "complementary {}".format(d.complementary),
                  "nm, purity", round(d.purity, 3))
        """)
    cct = _reading("cct", """The correlated colour temperature, K, by McCamy's formula on the 2 degree
        chromaticity whatever the observer; nan outside the 1000 K to 1e6 K it covers, or more than 0.05
        from the Planckian locus.

        Example::

            design = tf.new_design("AR")
            design.stack("HL")
            print(round(design.color(quantity="T").cct), "K")
        """)
    duv = _reading("duv", """The distance from the Planckian locus in CIE 1960 u, v, positive above it;
        nan outside the range McCamy's formula covers.

        Example::

            design = tf.new_design("AR")
            design.stack("HL")
            print(round(design.color(quantity="T").duv, 4))
        """)
    srgb = _reading("srgb", """The window's swatch, a named tuple (r, g, b), each 0 to 255: sRGB at an
        exposure of 1, adapted from the illuminant's white to D65.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print("rgb{}".format(tuple(design.color().srgb)))
        """)
    out_of_range = _reading("out_of_range", """The materials of the sides computed whose data stop inside
        380-780 nm, a list of dicts with id, name, rangeNm and heldFlat: outside rangeNm their n and k
        are held at the last value (heldFlat True) or extrapolated. Empty when every material covers
        the band.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print([m["id"] for m in design.color().out_of_range])
        """)

    def __repr__(self):
        return "<Color {} {}, {} {} degrees: x {:.4f}, y {:.4f}, Y {:.3f}>".format(
            self.quantity, self.mode, self.illuminant, self.observer, self.x, self.y, self.Y)
