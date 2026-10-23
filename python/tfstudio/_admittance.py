"""A coated side's admittance locus at one wavelength, as design.admittance()
answers."""

import collections

from ._csv import write_rows

# The medium light comes from, or the substrate: its material id and its name
# as the window's table gives it.
Medium = collections.namedtuple("Medium", "material name")
# A boundary of a locus, a row of the window's table: layer 0 is the bare
# substrate; Y and gamma are complex.
Boundary = collections.namedtuple("Boundary", "layer material name Y gamma")
# The arc a layer draws, through the points re and im.
Arc = collections.namedtuple("Arc", "layer material re im")
# One polarization's locus: eta0 and eta_substrate complex.
Locus = collections.namedtuple("Locus", "eta0 eta_substrate boundaries arcs")


def _reading(name, doc):
    """A read-only attribute giving self._values[name], documented as `doc`."""
    return property(lambda self: self._values[name], doc=doc)


def _complex(value):
    return complex(value["re"], value["im"])


def _locus(locus):
    return Locus(_complex(locus["eta0"]), _complex(locus["etaSubstrate"]),
                 [Boundary(b["layer"], b["material"], b["name"], _complex(b["Y"]), _complex(b["gamma"]))
                  for b in locus["boundaries"]],
                 [Arc(arc["layer"], arc["material"], arc["re"], arc["im"]) for arc in locus["arcs"]])


def _table_rows(admittance):
    """The rows of the window's table for both polarizations, as its Copy CSV
    writes them: for each, the substrate, each layer from the substrate out,
    and the incident medium, whose reflection coefficient against itself is
    0."""
    rows = [["Layer", "Material", "Re(Y)", "Im(Y)", "Re(Γ)", "Im(Γ)"]]
    for pol, locus in (("s", admittance.s), ("p", admittance.p)):
        for b in locus.boundaries:
            label = "η_s ({})".format(pol) if b.layer == 0 else "L{} ({})".format(b.layer, pol)
            rows.append([label, b.name, b.Y.real, b.Y.imag, b.gamma.real, b.gamma.imag])
        rows.append(["η₀ ({})".format(pol), admittance.incident.name, locus.eta0.real, locus.eta0.imag, 0, 0])
    return rows


class Admittance:
    """The admittance locus of one coated side at one wavelength, for s and
    p, as design.admittance() computes it and the Admittance Diagram window
    draws it. Complex values are Python complex numbers in Macleod's sign, the
    window's: an absorbing material's admittance has a negative imaginary
    part.

    Example::

        design = tf.new_design("Mirror")
        design.stack("(HL)^3 H")
        locus = design.admittance(550).s
        for b in locus.boundaries:
            print(b.layer, b.name, b.Y)
    """

    def __init__(self, loci):
        self._values = {
            "mode": loci["mode"], "wavelength": loci["wavelength"], "angle": loci["angle"], "plane": loci["plane"],
            "incident": Medium(loci["incident"]["material"], loci["incident"]["name"]),
            "substrate": Medium(loci["substrate"]["material"], loci["substrate"]["name"]),
            "s": _locus(loci["s"]), "p": _locus(loci["p"]), "out_of_range": loci["outOfRange"],
        }

    mode = _reading("mode", """The side computed: "front" or "back".

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.admittance(550).mode)
        """)
    wavelength = _reading("wavelength", """The wavelength, nm.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.admittance().wavelength, "nm")
        """)
    angle = _reading("angle", """The angle of incidence, degrees in the medium light comes from.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.admittance(550, angle=30).angle, "degrees")
        """)
    plane = _reading("plane", """The plane the arcs are in: "admittance", the Y plane, or "reflection",
        the plane of the reflection coefficient Γ.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.admittance(550, plane="reflection").plane)
        """)
    incident = _reading("incident", """The medium light comes from, a named tuple (material, name): the
        incident medium on the front, the exit medium on the back.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.admittance(550).incident)
        """)
    substrate = _reading("substrate", """The substrate, a named tuple (material, name).

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.admittance(550).substrate.name)
        """)
    s = _reading("s", """The s locus, a named tuple (eta0, eta_substrate, boundaries, arcs): eta0
        and eta_substrate the admittances of the medium and the substrate; boundaries the window's
        table, one named tuple (layer, material, name, Y, gamma) per boundary from the substrate
        out, layer 0 the bare substrate and then each layer with a thickness by its number as
        design.layers numbers it, Y the admittance at its outer surface and gamma the reflection
        coefficient there, the last at the outer surface of the coating; arcs one named tuple
        (layer, material, re, im) per layer with a thickness, from the substrate out, re and im
        lists of the points the window draws it through, in the plane chosen.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            gamma = design.admittance(550, angle=45).s.boundaries[-1].gamma
            print("Rs", abs(gamma) ** 2)
        """)
    p = _reading("p", """The p locus, as for s.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print("Y at the front surface, p:", design.admittance(550, angle=45).p.boundaries[-1].Y)
        """)
    out_of_range = _reading("out_of_range", """The materials of the side computed whose data do not reach
        the wavelength, a list of dicts with id, name, rangeNm and heldFlat: their n and k there are
        held at the last value (heldFlat True) or extrapolated. Empty when every material covers it.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print([m["id"] for m in design.admittance(5000).out_of_range])
        """)

    def save_csv(self, path):
        """Writes the loci to a CSV file as the window's Copy CSV writes its
        table with both polarizations shown: for s and then p, a row for the
        substrate, one for each layer from the substrate out and one for the
        medium light comes from, with Re(Y), Im(Y), Re(Γ) and Im(Γ). The
        numbers are the window's, written in Python's float notation. A file
        that is there is written over.

        Args:
            path: The file to write. A relative path is taken from the
                program's working folder: in the Script Console, the script's
                folder, or the data folder for a script not saved.

        Example::

            import time

            name = "admittance-{}.csv".format(time.time_ns())
            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            design.admittance(550, angle=45).save_csv(name)
            print("Wrote", name)
        """
        write_rows(path, _table_rows(self))

    def __repr__(self):
        return "<Admittance {} at {} nm, {} degrees: {} layers, {} plane>".format(
            self.mode, self.wavelength, self.angle, len(self.s.arcs), self.plane)
