"""A design's environments, by their numbers from 1: environment 1 is the
design itself, and each later one another condition the same coating is
used in."""

import numbers

from ._errors import TFStudioError
from ._names import api_names, python_name
from ._refusals import Words, worded

# The attributes that set what setEnvironment's options set, where their
# names are not the options' snake_case.
_SET_WORDS = Words("setEnvironment", names={"substrate": "substrate.material",
                                            "substrateThicknessMm": "substrate.thickness"})


def _replacing(held, given):
    """`given` as a whole new map in place of `held`: each material `held`
    has and `given` leaves out is given None, which drops it. Anything but a
    dict goes to the call as it is, None to drop them all and any other to
    be refused."""
    if not isinstance(given, dict):
        return given
    replaced = {material: None for material in held}
    replaced.update(given)
    return replaced


def _counted(count):
    return "{} environment{}".format(count, "" if count == 1 else "s")


class EnvironmentSubstrate:
    """The substrate of one environment: its material and thickness, its own
    or environment 1's. Setting either gives the environment its own;
    setting it to None makes the environment follow environment 1's again.

    Example::

        design = tf.new_design("Window AR")
        thick = design.environments.add(name="Thick plate")
        thick.substrate.thickness = 6
        print(thick.substrate.material, thick.substrate.thickness, "mm")
    """

    def __init__(self, environment):
        self._environment = environment

    @property
    def material(self):
        """The substrate's material in this environment, by id: its own, or
        environment 1's. Set it to None to follow environment 1's again.

        Raises:
            TFStudioError: a material id that resolves to nothing, or any
                value on environment 1, whose substrate is the design's.

        Example::

            design = tf.new_design("Window AR")
            sapphire = design.environments.add(name="Sapphire")
            sapphire.substrate.material = "Al2O3"
            print(sapphire.substrate.material, "in place of", design.substrate.material)
        """
        return self._environment._entry()["substrate"]["material"]

    @material.setter
    def material(self, material):
        self._environment._set(substrate=material)

    @property
    def thickness(self):
        """The substrate's thickness in this environment, mm: its own, or
        environment 1's. Set it to None to follow environment 1's again.

        Raises:
            TFStudioError: a thickness of 0 or less, or any value on
                environment 1, whose substrate is the design's.

        Example::

            design = tf.new_design("Window AR")
            thick = design.environments.add(name="Thick plate")
            thick.substrate.thickness = 6
            print(thick.substrate.thickness, "mm in place of", design.substrate.thickness, "mm")
        """
        return self._environment._entry()["substrate"]["thickness"]

    @thickness.setter
    def thickness(self, thickness):
        self._environment._set(substrateThicknessMm=thickness)

    def __repr__(self):
        return "<EnvironmentSubstrate of environment {}: {} {} mm>".format(self._environment.number, self.material,
                                                                          self.thickness)


class Environment:
    """One environment of a design: environment 1, the design itself, or
    another condition the same coating is used in. An environment holds what
    it sets and follows environment 1 for the rest. Reading an attribute
    reads the design as it is then, and setting one changes the design. It
    stays the same environment when an earlier one is removed, and takes its
    new number.

    Example::

        design = tf.new_design("Window AR")
        design.stack("(HL)^2")
        water = design.environments.add(name="Under water")
        water.incident_medium = "H2O"
        print(water.number, water.name, water.incident_medium, water.follows)
    """

    def __init__(self, environments, env_id):
        self._environments = environments
        self._id = env_id
        self._generation = environments._generation(env_id)

    @property
    def number(self):
        """The environment's number, from 1: environment 1 is the design
        itself.

        Example::

            design = tf.new_design("Window AR")
            design.environments.add(name="Under water", incident_medium="H2O")
            for env in design.environments:
                print(env.number, env.name)
        """
        return self._entry()["number"]

    @property
    def id(self):
        """The environment's id, which a .tfs file names it by; environment
        1's is "base".

        Example::

            design = tf.new_design("Window AR")
            water = design.environments.add(name="Under water", incident_medium="H2O")
            print(design.environments[1].id, water.id)
        """
        return self._entry()["id"]

    @property
    def name(self):
        """The environment's name, or None; set it to name the environment,
        or to None for none.

        Raises:
            TFStudioError: a name that is not text, or is empty, or
                environment 1 of a design with one environment, which holds
                no name until another is added.

        Example::

            design = tf.new_design("Window AR")
            water = design.environments.add()
            design.environments[1].name = "In air"
            water.name = "Under water"
            print(design.environments[1].name, water.name)
        """
        return self._entry()["name"]

    @name.setter
    def name(self, name):
        self._set(name=name)

    @property
    def enabled(self):
        """False for an environment switched off; set it to switch the
        environment off or on.

        Raises:
            TFStudioError: a value other than True or False, or environment 1
                of a design with one environment, which holds no switch until
                another is added.

        Example::

            design = tf.new_design("Window AR")
            water = design.environments.add(name="Under water", incident_medium="H2O")
            water.enabled = False
            print(water.name, water.enabled)
        """
        return self._entry()["enabled"]

    @enabled.setter
    def enabled(self, enabled):
        self._set(enabled=enabled)

    @property
    def incident_medium(self):
        """The medium the light comes from in this environment, by material
        id: its own, or environment 1's. Set it to None to follow environment
        1's again.

        Raises:
            TFStudioError: a material id that resolves to nothing, or any
                value on environment 1, whose media are the design's.

        Example::

            design = tf.new_design("Window AR")
            water = design.environments.add(name="Under water")
            water.incident_medium = "H2O"
            print(water.incident_medium, "in place of", design.incident_medium)
        """
        return self._entry()["incidentMedium"]

    @incident_medium.setter
    def incident_medium(self, material):
        self._set(incidentMedium=material)

    @property
    def exit_medium(self):
        """The medium behind the substrate in this environment, by material
        id: its own, or environment 1's. Set it to None to follow environment
        1's again.

        Raises:
            TFStudioError: a material id that resolves to nothing, or any
                value on environment 1, whose media are the design's.

        Example::

            design = tf.new_design("Window AR")
            cemented = design.environments.add(name="Cemented")
            cemented.exit_medium = "BK7"
            print(cemented.exit_medium, "in place of", design.exit_medium)
        """
        return self._entry()["exitMedium"]

    @exit_medium.setter
    def exit_medium(self, material):
        self._set(exitMedium=material)

    @property
    def substrate(self):
        """The environment's substrate, an EnvironmentSubstrate: its material
        and thickness, its own or environment 1's.

        Example::

            design = tf.new_design("Window AR")
            sapphire = design.environments.add(name="Sapphire", substrate="Al2O3")
            print(sapphire.substrate)
        """
        return EnvironmentSubstrate(self)

    @property
    def thickness_factors(self):
        """The environment's thickness factors, a map of material id to
        factor: each layer of that material is that many times as thick in
        this environment, as at a chamber position where the films grow
        thinner. Reading it gives a copy; setting it replaces every factor
        with those given, ``{}`` or None leaving none.

        Raises:
            TFStudioError: a map whose factor is not a number above 0, a
                material id that resolves to nothing, or any value on
                environment 1, whose layers are the design's.

        Example::

            design = tf.new_design("Window AR")
            design.stack("(HL)^2")
            edge = design.environments.add(name="Dome edge")
            edge.thickness_factors = {"TiO2": 0.95, "SiO2": 0.97}
            print(edge.thickness_factors)
        """
        return self._entry()["thicknessFactors"]

    @thickness_factors.setter
    def thickness_factors(self, factors):
        self._set(thicknessFactors=_replacing(self._entry()["thicknessFactors"], factors))

    @property
    def material_swaps(self):
        """The environment's material swaps, a map of material id to material
        id: each layer of the first is made of the second in this
        environment. Reading it gives a copy; setting it replaces every swap
        with those given, ``{}`` or None leaving none.

        Raises:
            TFStudioError: a map whose value is not a material id, a material
                id that resolves to nothing, or any value on environment 1,
                whose layers are the design's.

        Example::

            design = tf.new_design("Window AR")
            design.stack("(HL)^2")
            tantala = design.environments.add(name="Tantala")
            tantala.material_swaps = {"TiO2": "Ta2O5"}
            print(tantala.material_swaps)
        """
        return self._entry()["materialSwaps"]

    @material_swaps.setter
    def material_swaps(self, swaps):
        self._set(materialSwaps=_replacing(self._entry()["materialSwaps"], swaps))

    @property
    def follows(self):
        """What the environment takes from environment 1, by the names
        environments.add() takes: any of "incident_medium", "exit_medium",
        "substrate" and "substrate_thickness_mm". Environment 1 follows none.

        Example::

            design = tf.new_design("Window AR")
            water = design.environments.add(name="Under water", incident_medium="H2O")
            print(water.follows)
        """
        return [python_name(option) for option in self._entry()["follows"]]

    def remove(self):
        """Takes the environment out of the design, with the merit rows
        scored in it alone, the rows that read them and the specification
        checks judged in it alone. The environments after it move one number
        down.

        Raises:
            TFStudioError: environment 1, the design itself.

        Example::

            design = tf.new_design("Window AR")
            water = design.environments.add(name="Under water", incident_medium="H2O")
            water.remove()
            print(len(design.environments), "environment")
        """
        self._entry()
        self._environments._remove("remove", self._id)

    def _entry(self):
        # A removed environment's id can be given to one added later; that one
        # is another environment, which this object does not reach.
        if self._environments._generation(self._id) != self._generation:
            raise self._environments._missing(self._id)
        return self._environments._entry(self._id)

    def _set(self, **options):
        self._entry()
        self._environments._set(self._id, options)

    def __repr__(self):
        env = self._entry()

        def listed(held, join):
            return ", ".join("{} {}{}".format(material, join, value) for material, value in held.items())

        return "<Environment {}{}: incident {}, substrate {} {} mm, exit {}{}{}{}>".format(
            env["number"], " '{}'".format(env["name"]) if env["name"] else "", env["incidentMedium"],
            env["substrate"]["material"], env["substrate"]["thickness"], env["exitMedium"],
            ", factors " + listed(env["thicknessFactors"], "x") if env["thicknessFactors"] else "",
            ", swaps " + listed(env["materialSwaps"], "to ") if env["materialSwaps"] else "",
            "" if env["enabled"] else ", switched off")


class Environments:
    """A design's environments, numbered from 1: environment 1 is the design
    itself, with its own media and substrate, and each later one another
    condition the same coating is used in, such as another substrate, the
    coating under water, or a chamber position where the films grow thinner.
    ``environments[n]`` is environment n, ``len(environments)`` how many
    there are, and a for loop goes from environment 1. A design without other
    environments has environment 1 alone. The methods change the design.

    Example::

        design = tf.new_design("Window AR")
        design.stack("(HL)^2")
        design.environments.add(name="Under water", incident_medium="H2O")
        for env in design.environments:
            print(env.number, env.name, env.incident_medium)
    """

    def __init__(self, design):
        self._design = design

    def __len__(self):
        """How many environments the design has, environment 1 among them.

        Example::

            design = tf.new_design("Window AR")
            design.environments.add(name="Under water", incident_medium="H2O")
            print(len(design.environments), "environments")
        """
        return len(self._listed())

    def __getitem__(self, number):
        """Environment `number`, an Environment: environment 1 is the design
        itself.

        Args:
            number: The environment's number, from 1 to as many as the design
                has.

        Returns:
            An Environment.

        Raises:
            TFStudioError: a number the design has no environment of.

        Example::

            design = tf.new_design("Window AR")
            design.environments.add(name="Under water", incident_medium="H2O")
            print(design.environments[1], design.environments[2])
        """
        return Environment(self, self._listed()[self._index(number)]["id"])

    def __iter__(self):
        """The environments from 1, each an Environment. The environments are
        the ones the design has when the loop starts.

        Example::

            design = tf.new_design("Window AR")
            design.environments.add(name="Under water", incident_medium="H2O")
            design.environments.add(name="Sapphire", substrate="Al2O3")
            for env in design.environments:
                print(env.number, env.name, env.incident_medium, env.substrate.material)
        """
        return iter([Environment(self, env["id"]) for env in self._listed()])

    def add(self, **options):
        """Adds an environment after the others. A medium, substrate or
        thickness left out, or given as None, follows environment 1. A factor
        or a swap is keyed by the material the layers name, under either form
        of a built-in id ("TiO2" or "builtin:TiO2").

        Args:
            name: The environment's name.
            enabled: False switches the environment off. Default True.
            incident_medium: The medium the light comes from, by material id.
            exit_medium: The medium behind the substrate, by material id.
            substrate: The substrate material, by id.
            substrate_thickness_mm: The substrate thickness, mm, above 0.
            thickness_factors: A map of material id to factor: each layer of
                that material is that many times as thick, the factor above 0.
            material_swaps: A map of material id to material id: each layer
                of the first is made of the second.

        Returns:
            The new Environment.

        Raises:
            TFStudioError: an option it does not take, a value the option
                cannot take, or a material id that resolves to nothing.

        Example::

            design = tf.new_design("Window AR")
            design.stack("(HL)^2")
            edge = design.environments.add(name="Dome edge", thickness_factors={"TiO2": 0.95})
            print(edge.number, edge.name, edge.thickness_factors)
        """
        design = self._design
        with worded(Words("addEnvironment", "add")):
            design._data = design._calls.addEnvironment(design._data, api_names(options))
        env_id = self._listed()[-1]["id"]
        added = design.__dict__.setdefault("_environment_adds", {})
        added[env_id] = added.get(env_id, 0) + 1
        return Environment(self, env_id)

    def remove(self, number):
        """Takes environment `number` out, with the merit rows scored in it
        alone, the rows that read them and the specification checks judged in
        it alone; the environments after it move one number down.

        Args:
            number: The environment's number, 2 or more: environment 1 is the
                design itself.

        Raises:
            TFStudioError: a number the design has no environment of, or 1.

        Example::

            design = tf.new_design("Window AR")
            design.environments.add(name="Under water", incident_medium="H2O")
            design.environments.add(name="Sapphire", substrate="Al2O3")
            design.environments.remove(2)
            print(design.environments[2].name)
        """
        self._remove("remove", self._listed()[self._index(number)]["id"])

    def _index(self, number):
        """The place of environment `number` in the list."""
        if not isinstance(number, numbers.Integral) or isinstance(number, bool) or not 1 <= number <= len(self):
            raise self._missing(number)
        return number - 1

    def _missing(self, environment):
        """The refusal of an environment the design does not have, by its
        number or, for an Environment whose environment was removed, its id."""
        return TFStudioError("environment {!r}: the design has {}, numbered from 1".format(environment, _counted(len(self))))

    def _generation(self, env_id):
        """How many times this design object has added an environment under
        `env_id`: an Environment made before the last of them reaches another
        environment."""
        return self._design.__dict__.get("_environment_adds", {}).get(env_id, 0)

    def _entry(self, env_id):
        for env in self._listed():
            if env["id"] == env_id:
                return env
        raise self._missing(env_id)

    def _set(self, env_id, options):
        design = self._design
        with worded(_SET_WORDS):
            design._data = design._calls.setEnvironment(design._data, env_id, options)

    def _remove(self, method, env_id):
        design = self._design
        with worded(Words("removeEnvironment", method)):
            design._data = design._calls.removeEnvironment(design._data, env_id)

    def _listed(self):
        design = self._design
        return design._calls.environments(design._data)

    def __repr__(self):
        return "<Environments: {}>".format(", ".join(
            "{} '{}'".format(env["number"], env["name"]) if env["name"] else str(env["number"]) for env in self._listed()))
