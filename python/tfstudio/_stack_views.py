"""A design's stack read at one wavelength, as design.index_profile() and
design.layer_thicknesses() answer."""

import collections
import csv

# The parts of an IndexProfile: a layer, the medium light comes from, and the
# substrate.
ProfileLayer = collections.namedtuple("ProfileLayer", "side number material n k thickness start end")
ProfileMedium = collections.namedtuple("ProfileMedium", "material n k")
ProfileSubstrate = collections.namedtuple("ProfileSubstrate", "material n k thickness")
# A row of a LayerThicknesses.
ThicknessRow = collections.namedtuple("ThicknessRow", "side number material thickness optical_thickness qwot fwot")

# The Refractive Index Profile window's names for the parts of its Total view,
# which its CSV export writes in the region column.
_REGIONS = {"front": "Front", "substrate": "Substrate", "back": "Back"}


def _reading(name, doc):
    """A read-only attribute giving self._values[name], documented as `doc`."""
    return property(lambda self: self._values[name], doc=doc)


def _table_rows(profile):
    """The rows of the window's table of `profile`, as its CSV export writes
    them: each step of n and k with the depth it starts at, the last at the
    substrate, without the stretch of medium and substrate the window draws
    at each end. On the whole part each part has rows of its own, depths
    counted from its start: the front, the substrate in mm, the back."""
    substrate = profile.substrate
    if profile.mode != "total":
        return ([["z (nm)", "n", "k"]] + [[layer.start, layer.n, layer.k] for layer in profile.layers]
                + [[profile.thickness, substrate.n, substrate.k]])

    def coat(side):
        layers = [layer for layer in profile.layers if layer.side == side]
        if not layers:
            return []
        last = layers[-1]
        return ([[_REGIONS[side], layer.start, layer.n, layer.k] for layer in layers]
                + [[_REGIONS[side], last.end, last.n, last.k]])

    bulk = [] if substrate is None else [[_REGIONS["substrate"], 0, substrate.n, substrate.k],
                                         [_REGIONS["substrate"], substrate.thickness, substrate.n, substrate.k]]
    return [["region", "z", "n", "k"]] + coat("front") + bulk + coat("back")


class IndexProfile:
    """The refractive index of a design's layers at one wavelength, laid out
    by depth, as design.index_profile() reads it and the Refractive Index
    Profile window shows it.

    Example::

        design = tf.new_design("Mirror")
        design.stack("(HL)^3 H")
        profile = design.index_profile(wavelength=633)
        for l in profile.layers:
            print(l.number, l.material, l.n, l.start, l.end)
    """

    def __init__(self, profile):
        mode = profile["mode"]
        incident, substrate = profile["incident"], profile["substrate"]
        layers = [ProfileLayer(layer.get("side", mode), layer["number"], layer["material"], layer["n"], layer["k"],
                               layer["thickness"], layer["start"], layer["end"]) for layer in profile["layers"]]
        self._values = {
            "mode": mode, "wavelength": profile["wavelength"],
            "incident": None if incident is None else ProfileMedium(incident["material"], incident["n"], incident["k"]),
            "substrate": None if substrate is None else ProfileSubstrate(substrate["material"], substrate["n"], substrate["k"],
                                                                         substrate.get("thickness")),
            "layers": layers, "thickness": profile["thickness"], "optical_thickness": profile["opticalThickness"],
            "out_of_range": profile["outOfRange"],
        }

    mode = _reading("mode", """What it was laid out on: "front" or "back", that side alone, or "total",
        the whole part.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.index_profile().mode)
        """)
    wavelength = _reading("wavelength", """The wavelength n and k were read at, nm.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.index_profile().wavelength, "nm")
        """)
    incident = _reading("incident", """The medium light comes from, a named tuple (material, n, k): the
        incident medium on the front, the exit medium on the back; None on the whole part, whose
        profile starts at the front's outer layer.

        Example::

            design = tf.new_design("Prism coating")
            design.stack("(HL)^2")
            design.incident_medium = "BK7"
            incident = design.index_profile().incident
            print(incident.material, incident.n)
        """)
    substrate = _reading("substrate", """The substrate, a named tuple (material, n, k, thickness), thickness
        in mm on the whole part and None on one side; None on the whole part when the design gives
        the substrate no thickness.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            substrate = design.index_profile(side="total").substrate
            print(substrate.material, substrate.n, substrate.thickness, "mm")
        """)
    layers = _reading("layers", """One named tuple (side, number, material, n, k, thickness, start, end)
        per layer with a thickness: side the layer's side; number as design.layers and
        design.back_layers number it, 1 next to the substrate; material by id; thickness, start and
        end in nm, start and end the layer's depth from its side's outer surface. On one side the
        layers run from the outer surface in. On the whole part the front's come first, from its
        outer surface in, then the back's from the substrate out, with start and end from the
        substrate.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            for l in design.index_profile().layers:
                print(l.number, l.material, l.n, l.k, l.start, l.end)
        """)
    thickness = _reading("thickness", """The physical thickness of the layers, nm.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.index_profile().thickness, "nm")
        """)
    optical_thickness = _reading("optical_thickness", """The optical thickness of the layers, the sum of n
        times thickness at the wavelength, nm.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.index_profile(wavelength=550).optical_thickness, "nm")
        """)
    out_of_range = _reading("out_of_range", """The materials whose data do not reach the wavelength, a
        list of dicts with id, name, rangeNm and heldFlat: their n and k there are held at the last
        value (heldFlat True) or extrapolated. Empty when every material covers it.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print([m["id"] for m in design.index_profile(wavelength=5000).out_of_range])
        """)

    def save_csv(self, path):
        """Writes the profile to a CSV file, the table the window exports less
        the stretch of medium and substrate it draws at each end: a row for
        each step of n and k with the depth it starts at,
        z (nm), from the outer surface to the substrate, which the last row
        gives. On the whole part the columns are region, z, n and k, each
        part's depths counted from its start, the substrate's in mm. A file
        that is there is written over.

        Args:
            path: The file to write. A relative path is taken from the
                program's working folder: in the Script Console, the script's
                folder, or the data folder for a script not saved.

        Example::

            import time

            name = "profile-{}.csv".format(time.time_ns())
            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            design.index_profile(wavelength=633).save_csv(name)
            print("Wrote", name)
        """
        with open(path, "w", newline="", encoding="utf-8") as file:
            csv.writer(file).writerows(_table_rows(self))

    def __repr__(self):
        return "<IndexProfile {} at {} nm: {} layers, {} nm>".format(self.mode, self.wavelength, len(self.layers),
                                                                     self.thickness)


class LayerThicknesses:
    """Each layer's physical and optical thickness, as
    design.layer_thicknesses() lists them and the Layer Thicknesses window
    shows them.

    Example::

        design = tf.new_design("Mirror")
        design.stack("(HL)^3 H")
        for row in design.layer_thicknesses().rows:
            print(row.number, row.material, row.thickness, row.qwot)
    """

    def __init__(self, listed):
        mode = listed["mode"]
        rows = [ThicknessRow(row.get("side", mode), row["number"], row["material"], row["thickness"],
                             row["opticalThickness"], row["qwot"], row["fwot"]) for row in listed["rows"]]
        self._values = {"mode": mode, "wavelength": listed["wavelength"], "rows": rows, "out_of_range": listed["outOfRange"]}

    mode = _reading("mode", """What was listed: "front" or "back", that side's layers, or "total", both
        sides.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.layer_thicknesses().mode)
        """)
    wavelength = _reading("wavelength", """The wavelength λ0 the optical thicknesses were taken at, nm.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.layer_thicknesses().wavelength, "nm")
        """)
    rows = _reading("rows", """One named tuple (side, number, material, thickness, optical_thickness, qwot,
        fwot) per layer, from layer 1 next to the substrate outward: side the layer's side; number as
        design.layers and design.back_layers number it; material by id; thickness, nm;
        optical_thickness, n times thickness, nm; qwot, 4 n d / λ0, and fwot, n d / λ0, with n the
        material's index at the wavelength. The three optical values are None for a layer with no
        material. On both sides the front's rows come first.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            for row in design.layer_thicknesses(wavelength=600).rows:
                print(row.number, row.optical_thickness, row.qwot, row.fwot)
        """)
    out_of_range = _reading("out_of_range", """The materials whose data do not reach the wavelength, a
        list of dicts with id, name, rangeNm and heldFlat, as for an IndexProfile.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(len(design.layer_thicknesses(wavelength=5000).out_of_range), "materials stop short of 5000 nm")
        """)

    def __repr__(self):
        return "<LayerThicknesses {} at {} nm: {} layers>".format(self.mode, self.wavelength, len(self.rows))
