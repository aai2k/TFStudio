"""The stress each film carries and what the coating does to the part, as
design.stress() answers."""

import collections

from ._csv import write_rows

# The temperatures of the run, in °C.
StressRun = collections.namedtuple("StressRun", "temperature deposition_temperature")
# The substrate: its material by id, its thickness and diameter in mm.
StressSubstrate = collections.namedtuple("StressSubstrate", "material thickness diameter")
# What the part does as a whole.
WholePart = collections.namedtuple("WholePart", "force radius deflection strain_energy cracking")
# One film, a row of the window's per-film table.
Film = collections.namedtuple("Film", "side number material name thickness stress strain_energy delamination shear")
# A material that leaves constants out, and the fields it lacks.
MissingConstants = collections.namedtuple("MissingConstants", "material name fields")

# The window's per-film table (stressAnalysis/tableModel.js, and the English
# stressAnalysis): the side column only when both faces are counted. Its Copy
# CSV writes each comma in a heading as a semicolon, as it does in a name, so
# each heading is one field.
_SIDE = "Side"
_HEADINGS = ("Layer", "Material", "d; nm", "Stress; MPa", "U; J/m²", "Delamination", "Edge shear; MPa")
_SIDE_NAMES = {"front": "Front", "back": "Back"}


def _reading(name, doc):
    """A read-only attribute giving self._values[name], documented as `doc`."""
    return property(lambda self: self._values[name], doc=doc)


def _table(films):
    """The heading and the rows of the window's per-film table of `films`."""
    both = {film.side for film in films} == {"front", "back"}
    heading = ((_SIDE,) if both else ()) + _HEADINGS
    rows = [([_SIDE_NAMES[film.side]] if both else []) + [film.number, film.name, film.thickness, film.stress,
                                                          film.strain_energy, film.delamination, film.shear]
            for film in films]
    return ",".join(heading), rows


class Stress:
    """The stress each film carries and what the coating does to the part,
    as design.stress() computes them and the Stress window shows them:
    ``s.films`` the per-film table and ``s.whole`` the whole part.

    Example::

        design = tf.new_design("Mirror")
        design.stack("(HL)^4 H")
        s = design.stress()
        print(s.mode, "force", s.whole.force, "N/m;", ", ".join(m.material for m in s.missing),
              "state no constants")
    """

    def __init__(self, result):
        run = result["run"]
        substrate = result["substrate"]
        whole = result["whole"]
        self._values = {
            "mode": result["mode"],
            "run": run and StressRun(run["temperature"], run["depositionTemperature"]),
            "substrate": StressSubstrate(substrate["material"], substrate["thickness"], substrate["diameter"]),
            "whole": WholePart(whole["force"], whole["radius"], whole["deflection"], whole["strainEnergy"],
                               whole["cracking"]),
            "films": [Film(film["side"], film["number"], film["material"], film["name"], film["thickness"],
                           film["stress"], film["strainEnergy"], film["delamination"], film["shear"])
                      for film in result["films"]],
            "missing": [MissingConstants(m["material"], m["name"], m["fields"]) for m in result["missing"]],
        }

    mode = _reading("mode", """The coatings counted: "front", "back" or "total", both faces.

        Example::

            design = tf.new_design("Two-sided")
            design.sides = "both"
            print(design.stress().mode)
        """)
    run = _reading("run", """The temperatures, a named tuple (temperature, deposition_temperature) in
        °C, the one not set reading 20, or None when the design sets neither and each film carries
        its intrinsic stress alone.

        Example::

            design = tf.new_design("Mirror")
            design.deposition_temperature = 250
            print(design.stress().run)
        """)
    substrate = _reading("substrate", """The substrate, a named tuple (material, thickness, diameter): the
        material by id, the thickness and the diameter in mm, the diameter None when it is not set.

        Example::

            design = tf.new_design("Mirror")
            design.substrate.diameter = 25.4
            print(design.stress().substrate)
        """)
    whole = _reading("whole", """The part, a named tuple: force, Σ σ·d over the films counted, N/m;
        radius, the radius of curvature, m, None at no force; deflection, the centre deflection, µm,
        None without a diameter; strain_energy, the films' total, J/m²; cracking, the sum over the
        films of U/2γ. With coatings on both faces the force is F_front − F_back; a coating on one
        face alone reads the same on the back as on the front. The radius and the deflection are
        positive for the convex face a compressive coating leaves. Each None when a constant it
        needs is missing; a film that states no stress counts as carrying none in the force, the
        radius and the deflection, and leaves the strain energy and the cracking parameter None.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(design.stress().whole)
        """)
    films = _reading("films", """One per film counted, front first, each a named tuple (side, number,
        material, name, thickness, stress, strain_energy, delamination, shear): number from 1 at the
        substrate, as layers numbers them; material by id and name as the window shows it; thickness
        in nm; stress in MPa, tensile positive; strain_energy in J/m²; delamination, at 1 the energy
        to let go at the interface below the film; shear, the peak shear at the coating's edge, MPa.
        stress is None when the material states none; strain_energy is then None too, and so is the
        delamination of that film and of every film below it, while shear counts it as carrying
        none. Each is None when another constant it needs is missing.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^2 H")
            for film in design.stress().films:
                print(film.number, film.name, round(film.thickness, 2), "nm", film.stress)
        """)
    missing = _reading("missing", """The materials that leave a constant out, the substrate's included,
        each a named tuple (material, name, fields): material by id, and fields the constants it
        lacks by their names on the material's mechanical record. Each material is listed once: one
        that is the substrate and a film, or that two ids name, as SiO2 and builtin:SiO2 do, is one
        entry, under the id the films name it by first. Empty when every material states every
        constant.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^2 H")
            for m in design.stress().missing:
                print(m.material, ", ".join(m.fields))
        """)

    def save_csv(self, path):
        """Writes the films to a CSV file as the window's Copy CSV writes its
        per-film table: the side when both faces are counted, then the
        layer, the material, d (nm), the stress (MPa), U (J/m²), the
        delamination factor and the edge shear (MPa), an empty cell where a
        constant is missing. The numbers are the window's, written in
        Python's float notation. A file that is there is written over.

        Args:
            path: The file to write. A relative path is taken from the
                program's working folder: in the Script Console, the script's
                folder, or the data folder for a script not saved.

        Example::

            import time

            name = "stress-{}.csv".format(time.time_ns())
            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            design.stress().save_csv(name)
            print("Wrote", name)
        """
        heading, rows = _table(self.films)
        write_rows(path, rows, lines=(heading,))

    def __repr__(self):
        films, missing = len(self.films), len(self.missing)
        return "<Stress {}: {} film{}, force {} N/m, {} material{} missing constants>".format(
            self.mode, films, "" if films == 1 else "s", self.whole.force, missing, "" if missing == 1 else "s")
