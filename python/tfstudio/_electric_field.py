"""The electric field through a coated side at one wavelength, as
design.electric_field() answers."""

import collections

# One polarization's field, a list per curve, one value per sample.
Field = collections.namedtuple("Field", "e2 e2_tangential e2_normal amplitude")
# A layer of the field, in the order light meets it.
FieldLayer = collections.namedtuple("FieldLayer", "number material start end depth_start depth_end")

# The window's column heading for the depth in each unit.
_DEPTH_COLUMNS = {"nm": "z (nm)", "OT": "n·d (nm)", "QWOT": "QWOT", "FWOT": "FWOT"}
# The window's curves in the order its table lists them with avg chosen, and
# the name each carries in a column heading.
_CURVES = (("avg", "avg"), ("s", "s-pol"), ("p", "p-pol"))


def _reading(name, doc):
    """A read-only attribute giving self._values[name], documented as `doc`."""
    return property(lambda self: self._values[name], doc=doc)


def _field(field):
    return Field(field["e2"], field["e2Tangential"], field["e2Normal"], field["amplitude"])


def _table_rows(field):
    """The rows of the window's table as its Copy CSV writes them, with its
    factory display: the amplitude of the whole field, avg with s and p,
    against depth in the field's depth unit."""
    curves = [getattr(field, pol).amplitude for pol, _ in _CURVES]
    header = [_DEPTH_COLUMNS[field.depth_unit]] + ["E ({}) [V/m]".format(suffix) for _, suffix in _CURVES]
    return [header] + [[depth] + [curve[i] for curve in curves] for i, depth in enumerate(field.depth)]


class ElectricField:
    """The electric field through one coated side at one wavelength, for s, p
    and unpolarized light, as design.electric_field() computes it and the
    Electric Field window draws it.

    Example::

        design = tf.new_design("Mirror", reference=1064)
        design.stack("(HL)^4 H")
        field = design.electric_field(1064)
        print("peak |E|², s:", max(field.s.e2), "over", len(field.z), "samples")
    """

    def __init__(self, field):
        self._values = {
            "mode": field["mode"], "wavelength": field["wavelength"], "angle": field["angle"],
            "reference": field["reference"], "depth_unit": field["depthUnit"], "points_per_layer": field["pointsPerLayer"],
            "z": field["z"], "depth": field["depth"],
            "layers": [FieldLayer(layer["number"], layer["material"], layer["start"], layer["end"], layer["depthStart"],
                                  layer["depthEnd"]) for layer in field["layers"]],
            "s": _field(field["s"]), "p": _field(field["p"]), "avg": _field(field["avg"]),
            "incident_amplitude": field["incidentAmplitude"], "out_of_range": field["outOfRange"],
        }

    mode = _reading("mode", """The side computed: "front" or "back".

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.electric_field(550).mode)
        """)
    wavelength = _reading("wavelength", """The wavelength the field was computed at, nm.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.electric_field().wavelength, "nm")
        """)
    angle = _reading("angle", """The angle of incidence, degrees in the medium light comes from.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.electric_field(550, angle=30).angle, "degrees")
        """)
    reference = _reading("reference", """The wavelength λ0 the depth was read at, nm.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.electric_field(633, depth_unit="QWOT").reference, "nm")
        """)
    depth_unit = _reading("depth_unit", """The unit depth is in: "nm", "OT", "QWOT" or "FWOT"; "nm" where an
        optical unit was asked for and a material has no index at the reference wavelength.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.electric_field(550, depth_unit="FWOT").depth_unit)
        """)
    points_per_layer = _reading("points_per_layer", """The samples taken across each layer.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.electric_field(550, points_per_layer=200).points_per_layer)
        """)
    z = _reading("z", """The depth of each sample from the outer surface, nm, a list: the first at
        the surface, the last at the substrate.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            z = design.electric_field(550).z
            print(len(z), "samples down to", z[-1], "nm")
        """)
    depth = _reading("depth", """The depth of each sample in depth_unit, a list.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.electric_field(550, depth_unit="QWOT").depth[-1], "quarter waves")
        """)
    layers = _reading("layers", """One named tuple (number, material, start, end, depth_start, depth_end)
        per layer with a thickness, in the order light meets them: number as design.layers and
        design.back_layers number it; material by id; start and end its depth from the outer
        surface in nm, depth_start and depth_end in depth_unit.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            for l in design.electric_field(550).layers:
                print(l.number, l.material, round(l.start, 1), "to", round(l.end, 1), "nm")
        """)
    s = _reading("s", """The s field, a named tuple (e2, e2_tangential, e2_normal, amplitude) of lists,
        one value per sample: |E|² of the whole field and of its components along and normal to
        the layers, as fractions of the incident |E|², and the whole field's amplitude in V/m for
        1 W/m² incident.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print("peak |E|², s:", max(design.electric_field(550).s.e2))
        """)
    p = _reading("p", """The p field, as for s.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print("peak normal component, p:", max(design.electric_field(550, angle=45).p.e2_normal))
        """)
    avg = _reading("avg", """The unpolarized field, the mean of the s and p fields sample by sample, as
        for s.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print("peak amplitude, avg:", max(design.electric_field(550, angle=45).avg.amplitude), "V/m")
        """)
    incident_amplitude = _reading("incident_amplitude", """The incident beam's amplitude in V/m for
        1 W/m², from the index of the medium light comes from: |E|² of 1 reads this amplitude.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.electric_field(550).incident_amplitude, "V/m")
        """)
    out_of_range = _reading("out_of_range", """The materials of the side computed whose data do not reach
        the wavelength, a list of dicts with id, name, rangeNm and heldFlat, as for an Admittance.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(len(design.electric_field(5000).out_of_range), "materials stop short of 5000 nm")
        """)

    def save_csv(self, path):
        """Writes the field to a CSV file as the window's Copy CSV writes its
        table with its factory display: a row per sample with the depth in
        depth_unit and the amplitude of the whole field in V/m for 1 W/m², for
        avg, s and p. The numbers are the window's, written in Python's float
        notation. A file that is there is written over.

        Args:
            path: The file to write. A relative path is taken from the
                program's working folder: in the Script Console, the script's
                folder, or the data folder for a script not saved.

        Example::

            import time

            design = tf.new_design("Laser mirror", reference=1064)
            design.stack("(HL)^5 H")
            field = design.electric_field(1064, depth_unit="QWOT")
            name = "field-{}.csv".format(time.time_ns())
            field.save_csv(name)
            print("Wrote", len(field.z), "rows to", name)
        """
        lines = (",".join(str(value) for value in row) for row in _table_rows(self))
        with open(path, "w", newline="", encoding="utf-8") as file:
            file.write("\n".join(lines))

    def __repr__(self):
        return "<ElectricField {} at {} nm, {} degrees: {} layers, {} samples>".format(
            self.mode, self.wavelength, self.angle, len(self.layers), len(self.z))
