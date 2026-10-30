"""A design and its parts: the substrate, the layers of each side, and the
computations made on it."""

import copy
import numbers

from ._admittance import Admittance
from ._band_feature import EdgeShift, answered
from ._measured import curves_argument, measured_argument, measured_difference
from ._color import Color
from ._design_edits import differences_of
from ._electric_field import ElectricField
from ._ellipsometry import Ellipsometry
from ._errors import TFStudioError
from ._group_delay import GroupDelay
from ._inhomogeneities import Inhomogeneities
from ._roughness import Roughness
from ._integrals import Integrals
from ._production import edge_filter_of, monitor_worksheet_of, process_steps_of, run_options
from ._merit import Merit
from ._names import api_names
from ._needle import candidate_argument, needle_profile_of
from ._pulse import Pulse
from ._refusals import Words, refuse_arguments, worded
from ._results import CleanReport, LayerSensitivity, MonteCarlo, RunResult, Spectrum
from ._specification import Specification
from ._stack_views import IndexProfile, LayerThicknesses
from ._stop import run_hooks

# design.sides by the API's surfaceMode, and design.score_on by its mfEvalMode.
SIDES = {"front": "front_only", "back": "back_only", "both": "both_independent", "symmetric": "symmetric"}
SCORE_ON = {"side": "side", "whole part": "total"}
# layer_sensitivity()'s step by the API's mode for it.
STEPS = {"nm": "absolute", "percent": "relative"}

# design.stack()'s options by the API's names for them.
_STACK_OPTIONS = {"at": "referenceWavelength", "side": "side", "from_substrate": "startFromSubstrate"}
_STACK_WORDS = Words("stackFromFormula", "stack", {name: option for option, name in _STACK_OPTIONS.items()})
# The attributes that set what setDesignSetup's options set, where their
# names are not the options' snake_case.
_SETUP_WORDS = Words("setDesignSetup", names={"referenceWavelength": "reference", "substrate": "substrate.material",
                                              "substrateThicknessMm": "substrate.thickness"})
_MONTE_CARLO_WORDS = Words("monteCarlo", "monte_carlo", hidden=("from", "to"), extra=("progress", "stop"))
# design.clean()'s names for cleanDesign's options, where they are not their snake_case.
_CLEAN_WORDS = Words("cleanDesign", "clean", {"mergeAdjacent": "merge", "cleanBack": "back"})
# design.electric_field() takes the wavelength as its argument and the rest as keywords.
_FIELD_WORDS = Words("electricField", "electric_field", hidden=("wavelength",))
# design.ellipsometry() takes the range as its arguments, and
# design.ellipsometry_vs_angle() the wavelength and the angles, the step by
# the name step.
_ELLIPSOMETRY_WORDS = Words("ellipsometry", "ellipsometry", hidden=("from", "to"))
_SWEEP_WORDS = Words("ellipsometryVsAngle", "ellipsometry_vs_angle", {"angleStep": "step"},
                     hidden=("wavelength", "angleStart", "angleEnd"))
# The keywords each takes; the API's names for their arguments are not among them.
_ELLIPSOMETRY_OPTIONS = ("step", "angles", "side", "delta_convention")
_SWEEP_OPTIONS = ("step", "side", "delta_convention")
_MONTE_CARLO_OPTIONS = ("quantity", "step", "angle", "polarization", "runs", "thickness_rel_pct", "thickness_abs_nm",
                        "index_re", "index_im", "distribution", "seed", "progress", "stop")
# design.group_delay() takes the range as its arguments.
_EDGE_SHIFT_WORDS = Words("edgeShift", "edge_shift", hidden=("from", "to", "angles"))
_EDGE_SHIFT_OPTIONS = ("quantity", "level", "edge_side", "direction", "step")
_COMPARE_OPTIONS = ("curve", "angle", "pol", "quantity", "scale", "x_unit", "grid", "step", "thin_every", "start",
                    "end", "db", "level_free")
# design.compare_measured()'s names for measuredDifference's from and to,
# which Python cannot take as keywords.
_COMPARE_NAMES = {"start": "from", "end": "to"}
_COMPARE_WORDS = Words("measuredDifference", "compare_measured", names={"from": "start", "to": "end"})
_FIT_OPTIONS = ("grid", "step", "thin_every", "start", "end", "db", "weight", "output", "constraints")
_FIT_WORDS = Words("fitMeasured", "fit_measured", names={"from": "start", "to": "end"})
_GROUP_DELAY_WORDS = Words("groupDelay", "group_delay", hidden=("from", "to"))
_GROUP_DELAY_OPTIONS = ("step", "angle", "pol", "response", "side", "reference")
_PULSE_WORDS = Words("pulseAnalysis", "pulse")
_SET_PULSE_SPECTRUM_WORDS = Words("setPulseSpectrum", "set_pulse_spectrum")
# design.edge_filter()'s pass_ is the API's pass, a keyword in Python.
_EDGE_FILTER_WORDS = Words("edgeFilter", "edge_filter", names={"pass": "pass_"})
_APPLY_EDGE_FILTER_WORDS = Words("applyEdgeFilter", "apply_edge_filter", names={"pass": "pass_"})
# design.needle_profile() takes the pool as its argument.
_NEEDLE_PROFILE_WORDS = Words("needleProfile", "needle_profile", hidden=("pool",))
# design.process_steps() and export_process() take the range as their arguments.
_PROCESS_WORDS = Words("processSteps", "process_steps", hidden=("from", "to"))
_PROCESS_OPTIONS = ("step", "side", "other_side", "quantity", "angle", "pol", "chips")
_EXPORT_WORDS = Words("exportProcess", "export_process", hidden=("from", "to"))
_EXPORT_OPTIONS = _PROCESS_OPTIONS + ("format", "files", "header", "delimiter", "scale", "decimals", "decimal_mark")
_WORKSHEET_WORDS = Words("monitorWorksheet", "monitor_worksheet")


def mode_of(data):
    """What a computation on the design `data` scores, as the API's evaluation
    mode names it: 'total', the whole part, for a design coated on both sides
    or scored as the whole part, else 'back' or 'front', the coated side
    alone."""
    sides = data.get("surfaceMode") or "front_only"
    if sides in ("both_independent", "symmetric") or data.get("mfEvalMode") == "total":
        return "total"
    return "back" if sides == "back_only" else "front"


def _named(mapping, what, value):
    """The API's name of `value`, one of the names `mapping` holds for the
    attribute `what`."""
    if value not in mapping:
        names = [repr(name) for name in mapping]
        raise TFStudioError("{} is {} or {}, not {!r}".format(what, ", ".join(names[:-1]), names[-1], value))
    return mapping[value]


class Layer:
    """One layer of a design, by its number on its side: 1 is next to the
    substrate. Reading an attribute reads the design as it is then, and
    setting one changes the design, as an edit in the Design Editor does.

    Example::

        design = tf.new_design("Mirror")
        design.stack("(HL)^4 H")
        layer = design.layers[1]
        layer.thickness += 5
        print(layer.number, layer.material, layer.thickness, layer.locked)
    """

    def __init__(self, layers, number):
        self._layers = layers
        self._number = number

    @property
    def number(self):
        """The layer's number on its side, 1 next to the substrate.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            for layer in design.layers:
                print(layer.number, layer.material)
        """
        return self._number

    @property
    def side(self):
        """The layer's side, "front" or "back".

        Example::

            design = tf.new_design("Two-sided AR")
            design.sides = "both"
            design.back_layers.append("MgF2", 100)
            print(design.back_layers[1].side)
        """
        return self._layers._side

    @property
    def material(self):
        """The layer's material, by id; set it to change the material.

        Raises:
            TFStudioError: a material id that resolves to nothing, or a side
                the design does not let you edit.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            design.layers[1].material = "Ta2O5"
            print(design.layers[1].material)
        """
        return self._stored()["material"]

    @material.setter
    def material(self, material):
        self._layers._set(self._number, material=material)

    @property
    def thickness(self):
        """The layer's physical thickness, nm; set it to change the thickness.

        Raises:
            TFStudioError: a thickness of 0 or less, or a side the design
                does not let you edit.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            design.layers[1].thickness = 12.5
            print(design.layers[1].thickness, "nm")
        """
        return self._stored()["thickness"]

    @thickness.setter
    def thickness(self, thickness):
        self._layers._set(self._number, thickness=thickness)

    @property
    def qwot(self):
        """The layer's quarter-wave optical thickness, 4 n d / λ0, with n its
        material's index at the design's reference wavelength λ0, as the
        Design Editor's QW column shows it; None for a layer whose material
        resolves to nothing or has n of 0 or less there, which has no
        quarter wave. Set it to change the thickness, converted to nm as the
        QW column converts a value typed in it. A locked layer changes too: a
        lock holds a layer in refinement and synthesis.

        Raises:
            TFStudioError: a value of 0 or less, a layer with no quarter
                wave, or a side the design does not let you edit.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            design.layers[1].qwot = 2
            print(design.layers[1].qwot, "quarter waves,", design.layers[1].thickness, "nm")
        """
        side = self._layers._side
        self._layers._index(self._number)
        design = self._layers._design
        return design._calls.designFacts(design._data, {"side": side})["qwot"][side][self._number - 1]

    @qwot.setter
    def qwot(self, qwot):
        self._layers._set(self._number, qwot=qwot)

    @property
    def locked(self):
        """True for a locked layer, which refinement and synthesis leave as
        it is; set it to lock or free the layer.

        Raises:
            TFStudioError: a value other than True or False, or a side the
                design does not let you edit.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            design.layers[1].locked = True
            print(design.layers[1].locked)
        """
        return bool(self._stored().get("locked"))

    @locked.setter
    def locked(self, locked):
        self._layers._set(self._number, locked=locked)

    def _stored(self):
        return self._layers._stored()[self._layers._index(self._number)]

    def __repr__(self):
        return "<Layer {} on the {}: {} {} nm{}>".format(self.number, self.side, self.material, self.thickness,
                                                       ", locked" if self.locked else "")


class Layers:
    """The layers of one side of a design, numbered as the Design Editor
    numbers them: 1 is next to the substrate. ``layers[n]`` is layer n,
    ``len(layers)`` how many there are, and a for loop goes from layer 1
    outward. The methods change the design.

    Example::

        design = tf.new_design("AR")
        design.stack("(HL)^2")
        design.layers.append("MgF2", 95)
        for layer in design.layers:
            print(layer.number, layer.material, layer.thickness)
    """

    def __init__(self, design, side):
        self._design = design
        self._side = side

    def __len__(self):
        """How many layers the side has.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(len(design.layers), "layers on the front")
        """
        return len(self._stored())

    def __getitem__(self, number):
        """Layer `number`, a Layer: 1 is next to the substrate.

        Args:
            number: The layer's number, from 1 to as many as the side has.

        Returns:
            A Layer.

        Raises:
            TFStudioError: a number the side has no layer of.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(design.layers[1], design.layers[len(design.layers)])
        """
        self._index(number)
        return Layer(self, number)

    def __iter__(self):
        """The layers from 1, next to the substrate, outward, each a Layer. The
        layers are the ones the side has when the loop starts.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            for layer in design.layers:
                print(layer.number, layer.material, layer.thickness)
        """
        return iter([Layer(self, number) for number in range(1, len(self) + 1)])

    def append(self, material, thickness, *, locked=False):
        """Adds a layer outside the others: the new outermost layer.

        Args:
            material: The layer's material, by id.
            thickness: The layer's physical thickness, nm.
            locked: True locks the layer, so that refinement and synthesis
                leave it as it is. Default False.

        Raises:
            TFStudioError: a material id that resolves to nothing, a
                thickness of 0 or less, or a side the design does not let you
                edit, such as the back of a symmetric design.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.layers.append("MgF2", 95)
            print(len(design.layers), "layers, the outermost", design.layers[len(design.layers)].material)
        """
        self._insert("append", len(self) + 1, material=material, thickness=thickness, locked=locked)

    def insert(self, number, material, thickness, *, locked=False):
        """Adds a layer that becomes layer `number`; the layers from that
        number outward move one out.

        Args:
            number: The new layer's number, from 1, next to the substrate, to
                one more than the side has, which adds it outermost.
            material: The layer's material, by id.
            thickness: The layer's physical thickness, nm.
            locked: True locks the layer. Default False.

        Raises:
            TFStudioError: a number outside 1 to one more than the side has,
                a material id that resolves to nothing, a thickness of 0 or
                less, or a side the design does not let you edit.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            design.layers.insert(1, "Al2O3", 20)
            print(design.layers[1].material, "is now on the substrate")
        """
        self._insert("insert", number, material=material, thickness=thickness, locked=locked)

    def remove(self, number):
        """Takes layer `number` out; the layers outside it move one in.

        Args:
            number: The layer's number, 1 next to the substrate.

        Raises:
            TFStudioError: a number the side has no layer of, or a side the
                design does not let you edit.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            design.layers.remove(len(design.layers))
            print(len(design.layers), "layers")
        """
        self._change("remove", "deleteLayer", index=self._index(number))

    def flip(self):
        """Reverses the side's layer order on the substrate, as the Design
        Editor's Invert button does: layer 1 becomes the outermost. On a
        symmetric design the back follows the flipped front.

        Raises:
            TFStudioError: a side the design does not let you edit, such as
                the back of a symmetric design.

        Example::

            design = tf.new_design("Graded")
            design.stack("H 2L M")
            design.layers.flip()
            print(design.layers[1].material, "is now on the substrate")
        """
        self._change("flip", "flipLayers")

    def _insert(self, method, number, **layer):
        self._change(method, "insertLayer", index=self._index(number, insert=True), **layer)

    def _set(self, number, **changes):
        self._change("layer {}".format(number), "setLayer", index=self._index(number), **changes)

    def _change(self, method, call, **options):
        """The design changed by the API's call `call` on this side, for the
        method `method`, whose name its refusals then begin with."""
        design = self._design
        with worded(Words(call, method)):
            design._data = getattr(design._calls, call)(design._data, dict(options, side=self._side))

    def _stored(self):
        return self._design._data.get("frontLayers" if self._side == "front" else "backLayers") or []

    def _index(self, number, insert=False):
        """The API's index of layer `number`: the front stores its layers
        from the outermost in, the back from the substrate out."""
        count = len(self)
        last = count + 1 if insert else count
        if not isinstance(number, numbers.Integral) or isinstance(number, bool) or not 1 <= number <= last:
            raise TFStudioError("layer {!r}: the {} has {} layers, numbered from 1 next to the substrate{}".format(
                number, self._side, count, ", and a new one can be layer {}".format(last) if insert else ""))
        if self._side == "back":
            return number - 1
        return last - number

    def __repr__(self):
        return "<{} layers: {}>".format(self._side.capitalize(), ", ".join(
            "{} {} nm".format(layer["material"], layer["thickness"]) for layer in reversed(self._stored())
        ) if self._side == "front" else ", ".join(
            "{} {} nm".format(layer["material"], layer["thickness"]) for layer in self._stored()))


class Substrate:
    """A design's substrate: its material and thickness. Setting either
    changes the design.

    Example::

        design = tf.new_design("Bare SiO2")
        design.substrate.material = "SiO2"
        design.substrate.thickness = 3
        print(design.substrate.material, design.substrate.thickness, "mm")
    """

    def __init__(self, design):
        self._design = design

    @property
    def material(self):
        """The substrate's material, by id.

        Raises:
            TFStudioError: a material id that resolves to nothing.

        Example::

            design = tf.new_design("Bare SiO2")
            design.substrate.material = "SiO2"
            print(design.substrate.material)
        """
        return self._design._data["substrate"]["material"]

    @material.setter
    def material(self, material):
        self._design._setup(substrate=material)

    @property
    def thickness(self):
        """The substrate's thickness, mm.

        Raises:
            TFStudioError: a thickness of 0 or less.

        Example::

            design = tf.new_design("Bare BK7")
            design.substrate.thickness = 3
            print(design.substrate.thickness, "mm")
        """
        return self._design._data["substrate"]["thickness"]

    @thickness.setter
    def thickness(self, thickness):
        self._design._setup(substrateThicknessMm=thickness)

    def __repr__(self):
        return "<Substrate {} {} mm>".format(self.material, self.thickness)


class Design:
    """A thin-film design, as a .tfs file holds it: its media and substrate,
    the layers of each side, and its merit function. tf.new_design(),
    tf.open_design() and copy() give one; in the Script Console, tf.design is
    the open design.

    Methods that change a design change it in place: stack(), the layer
    edits, clean(), refine() and synthesize(). copy() keeps a copy first.

    In a program started with live=True, tf.app.open_design() reads one from
    the app, and push() writes it back.

    Example::

        design = tf.new_design("Mirror 550", substrate="BK7", reference=550)
        design.stack("(HL)^4 H", H="TiO2", L="SiO2")
        print(design)
    """

    def __init__(self, calls, data, app=None):
        self._calls = calls
        self._data = data
        # (the design's id in the app, the revision it was read or pushed at),
        # for a design that tf.app.open_design() read; None for any other.
        self._app = app

    @property
    def name(self):
        """The design's name. In the Script Console, a new name of tf.design
        is not applied to the open design, whose name is its file's.

        Raises:
            TFStudioError: a name that is not text, or is empty.

        Example::

            design = tf.new_design("Bare BK7")
            design.name = "BK7 window"
            print(design.name)
        """
        return self._data.get("name")

    @name.setter
    def name(self, name):
        self._setup(name=name)

    @property
    def reference(self):
        """The reference wavelength, nm, at which stack formulas count
        quarter waves. Setting it rescales every layer to keep its count of
        quarter waves, as the Design Editor's reference wavelength field does.

        Raises:
            TFStudioError: a wavelength of 0 or less.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            design.reference = 600
            print(design.reference, "nm, layer 1", design.layers[1].thickness, "nm")
        """
        return self._data.get("referenceWavelength")

    @reference.setter
    def reference(self, wavelength):
        self._setup(referenceWavelength=wavelength)

    @property
    def sides(self):
        """Which sides carry layers: "front", "back", "both", or "symmetric",
        whose back mirrors its front. Making a design symmetric gives it the
        mirror of its front as its back.

        With score_on, it decides what a spectrum, the merit and every run
        compute on: the front alone, the back alone, or the whole part, which
        each result gives as its mode.

        Raises:
            TFStudioError: any other value.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.sides = "both"
            print(design.sides, design.spectrum(400, 700).mode)
        """
        return {mode: side for side, mode in SIDES.items()}[self._data.get("surfaceMode") or "front_only"]

    @sides.setter
    def sides(self, sides):
        self._setup(surfaceMode=_named(SIDES, "sides", sides))

    @property
    def score_on(self):
        """How a design coated on one side is scored: "side", its coated side
        alone, or "whole part", the substrate's other surface included. A
        design coated on both sides is scored as the whole part. It is the
        Design Editor's Ignore other side: "side" with it ticked.

        Raises:
            TFStudioError: any other value.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.score_on = "whole part"
            print(design.score_on, design.spectrum(400, 700).mode)
        """
        return {mode: name for name, mode in SCORE_ON.items()}[self._data.get("mfEvalMode") or "side"]

    @score_on.setter
    def score_on(self, score_on):
        self._setup(mfEvalMode=_named(SCORE_ON, "score_on", score_on))

    @property
    def incident_medium(self):
        """The medium the light comes from, by material id.

        Raises:
            TFStudioError: a material id that resolves to nothing.

        Example::

            design = tf.new_design("Prism coating")
            design.stack("(HL)^2")
            design.incident_medium = "BK7"
            print(design.incident_medium)
        """
        return self._data.get("incidentMedium")

    @incident_medium.setter
    def incident_medium(self, material):
        self._setup(incidentMedium=material)

    @property
    def exit_medium(self):
        """The medium behind the substrate, by material id.

        Raises:
            TFStudioError: a material id that resolves to nothing.

        Example::

            design = tf.new_design("Cemented")
            design.exit_medium = "BK7"
            print(design.exit_medium)
        """
        return self._data.get("exitMedium")

    @exit_medium.setter
    def exit_medium(self, material):
        self._setup(exitMedium=material)

    @property
    def substrate(self):
        """The substrate: its material and thickness, a Substrate.

        Example::

            design = tf.new_design("Bare BK7")
            design.substrate.thickness = 3
            print(design.substrate)
        """
        return Substrate(self)

    @property
    def layers(self):
        """The front's layers, a Layers numbered from 1 next to the
        substrate.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            design.layers[1].thickness = 12.5
            print(design.layers)
        """
        return Layers(self, "front")

    @property
    def back_layers(self):
        """The back's layers, a Layers numbered from 1 next to the
        substrate. On a symmetric design they mirror the front and cannot be
        changed here.

        Example::

            design = tf.new_design("Two-sided AR")
            design.sides = "both"
            design.back_layers.append("MgF2", 100)
            print(design.back_layers)
        """
        return Layers(self, "back")

    @property
    def merit(self):
        """The merit function, a Merit: its rows and the merit they add up to.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 420, 680, target=0)
            print(design.merit.value)
        """
        return Merit(self)

    @property
    def specification(self):
        """The specification, a Specification: the pass or fail checks of
        the Specification window, the verdict on them and the yield against
        them.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
            print(design.specification.check().passed)
        """
        return Specification(self)

    def stack(self, formula, **options):
        """Replaces the layers of one side with those a stack formula builds,
        as the Stack Formula dialog's Replace builds them. Each letter is a
        quarter wave at the reference wavelength, so "(HL)^5 H" is eleven
        quarter-wave layers. Filling a side a design coated on one side does
        not score makes it coated on both, as the dialog does.

        Args:
            formula: The layers alone, such as "(HL)^5 H"; the media stay the
                design's.
            at: The wavelength, nm, the quarter waves are counted at, which
                the design then keeps as its reference. Default: the design's
                reference wavelength.
            side: "front" or "back"; a symmetric design takes the front.
                Default "front".
            from_substrate: True makes the formula's first letter the layer on
                the substrate, False the layer next to the incident medium.
                Default True.
            H: The material of the letter H, by id, such as "Ta2O5"; any other
                letter of the formula likewise. A letter left out is H TiO2,
                L SiO2 or M Al2O3.

        Raises:
            TFStudioError: a formula that does not read, saying where the
                reading stopped; a formula that names media; a letter the
                formula does not use; an option stack does not take; the back
                of a symmetric design; or a material id that resolves to
                nothing.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H", H="Ta2O5", L="SiO2", at=600)
            print(len(design.layers), "layers at", design.reference, "nm")
        """
        settings = {name: value for name, value in options.items() if len(name) > 1}
        unknown = sorted(set(settings) - set(_STACK_OPTIONS))
        if unknown:
            raise TFStudioError("stack: unknown option {!r}; the options are at, side, from_substrate, and a letter "
                                "for each symbol".format(unknown[0]))
        symbols = {name: value for name, value in options.items() if len(name) == 1}
        given = {_STACK_OPTIONS[name]: value for name, value in settings.items() if value is not None}
        with worded(_STACK_WORDS):
            self._data = self._calls.stackFromFormula(self._data, dict(given, formula=formula, symbols=symbols))

    def clean(self, *, min_thickness=5, merge=True, back=True):
        """Cleans the stack as the Design Cleaner window does: adjacent layers
        of one material merged into one, and layers thinner than
        min_thickness taken out, in passes, since taking a layer out can leave
        two layers of one material touching. Locked layers are never merged or
        taken out, and a symmetric design's back follows its front. The
        design then holds the cleaned layers.

        The merit usually worsens a little, since the stack changed. To do
        what the window's Re-optimize does, add an MNT row at min_thickness
        and refine with sqp: design.merit.add("MNT", target=5), then
        design.refine(method="sqp", max_iter=80). The layers end on the
        thicknesses the window's pass gives. The window's pass keeps each
        layer at min_thickness or above, and sqp keeps each layer inside the
        MNT row; without that row refine keeps layers at 1 nm or above.

        Args:
            min_thickness: The thinnest layer kept, nm: a layer below it is
                taken out. 0 takes none out. Default 5.
            merge: True merges adjacent layers of one material. Default True.
            back: True cleans the back too, also on a design scored on its
                front alone, whose back the layer edits refuse to change;
                False cleans the front alone, also on a design coated on the
                back alone. Default True.

        Returns:
            A CleanReport.

        Raises:
            TFStudioError: a min_thickness that is not a number of 0 or more,
                a merge or back other than True or False, or a design with no
                layers.

        Example::

            design = tf.new_design("Stack with a thin layer")
            design.stack("(HL)^2 0.03H L")
            report = design.clean(min_thickness=5)
            for op in report.operations:
                print(op.kind, op.side, "layer", op.number, op.material, op.thickness)
            print(len(design.layers), "layers now")
        """
        options = {"minThickness": min_thickness, "mergeAdjacent": merge, "cleanBack": back}
        with worded(_CLEAN_WORDS):
            cleaned = self._calls.cleanDesign(self._data, options)
        self._data = cleaned["design"]
        return CleanReport(cleaned)

    def scale_thicknesses(self, factor, *, side=None):
        """Makes every unlocked layer of one side thicker or thinner by one
        factor. Locked layers stay as they are, and a symmetric design's back
        follows its front.

        Args:
            factor: What each thickness is multiplied by, above 0: 1.02 makes
                every unlocked layer 2% thicker.
            side: "front" or "back". Default: the front, or the back of a
                design coated on the back alone.

        Raises:
            TFStudioError: a factor that is not a number above 0, a side other
                than "front" or "back", or a side the design does not let you
                edit, such as the back of a symmetric design.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            design.scale_thicknesses(1.05)
            print(design.layers[1].thickness, "nm")
        """
        self._edit("scaleThicknesses", "scale_thicknesses", factor=factor, side=side)

    def quantize(self, mode="step", value=None, *, side=None):
        """Rounds the unlocked layers of one side as the Design Editor's
        Round / quantize dialog does: to a number of decimal places of a nm,
        to the nearest whole number of controller steps, or to the nearest
        whole number of a QWOT increment at the reference wavelength. Locked
        layers stay as they are, and a symmetric design's back follows its
        front. A layer thinner than half a step rounds to 0 nm, as in the
        dialog; in "qwot" mode a layer whose material has no quarter wave
        stays as it is.

        Args:
            mode: "decimals", "step" (a controller step in nm) or "qwot" (a
                QWOT increment). Default "step".
            value: The number of decimal places, from 0 to 8, the step in nm,
                or the QWOT increment, as the mode takes. Default: what the
                dialog opens with: 2 places, 0.1 nm or 1 QWOT.
            side: "front" or "back". Default: the front, or the back of a
                design coated on the back alone.

        Raises:
            TFStudioError: a mode other than "decimals", "step" or "qwot", a
                value the mode does not take, a side other than "front" or
                "back", or a side the design does not let you edit.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            design.quantize("step", 0.5)
            print(design.layers)
        """
        self._edit("quantize", "quantize", mode=mode, value=value, side=side)

    def perturb(self, percent=2, *, side=None, seed=None):
        """Gives the unlocked layers of one side random thickness errors, as
        the Design Editor's Perturb dialog does: each thickness is multiplied
        by 1 + k · percent / 100, with k drawn for each layer uniformly from
        -1 to 1. Locked layers stay as they are, and a symmetric design's back
        follows its front. The same seed, design and percent give the same
        errors.

        Args:
            percent: The largest error, ± % of each thickness, above 0 and up
                to 100. Default 2.
            side: "front" or "back". Default: the front, or the back of a
                design coated on the back alone.
            seed: The number the draws start from, a whole number from 1 to
                2^32 - 1. Default: a fresh one.

        Returns:
            The seed the draws started from.

        Raises:
            TFStudioError: a percent that is not above 0 and up to 100, a seed
                that is not a whole number from 1 to 2^32 - 1, a side other
                than "front" or "back", or a side the design does not let you
                edit.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            seed = design.perturb(3, seed=7)
            print("seed", seed, design.layers)
        """
        with worded(Words("perturb", "perturb")):
            kicked = self._calls.perturb(self._data, api_names({"percent": percent, "side": side, "seed": seed}))
        self._data = kicked["design"]
        return kicked["seed"]

    def copy_front_to_back(self):
        """Copies the front's layers onto the back, as the Design Editor's
        Copy to back does: the back gets the same stack outward from the
        substrate, and its own layers are replaced. sides stays as it was, so
        set it to "both" to coat both.

        Raises:
            TFStudioError: a front the design does not let you edit, on a
                design coated on the back alone and scored on that side.

        Example::

            design = tf.new_design("Two-sided AR")
            design.stack("H L")
            design.sides = "both"
            design.copy_front_to_back()
            print(design.back_layers)
        """
        self._edit("copySide", "copy_front_to_back", **{"from": "front"})

    def copy_back_to_front(self):
        """Copies the back's layers onto the front, as the Design Editor's
        Copy to front does: the front gets the same stack outward from the
        substrate, and its own layers are replaced. sides stays as it was.

        Raises:
            TFStudioError: a back the design does not let you edit: the back
                of a symmetric design, or of a design coated on the front
                alone and scored on that side.

        Example::

            design = tf.new_design("Two-sided AR")
            design.sides = "both"
            design.back_layers.append("MgF2", 100)
            design.copy_back_to_front()
            print(design.layers)
        """
        self._edit("copySide", "copy_back_to_front", **{"from": "back"})

    def differences(self, other):
        """What differs between this design and `other`: their setup and
        their layers, compared side by side by number from the substrate, so
        a layer added near the substrate shows every layer outside it as
        changed. Values are compared exactly. The name, merit rows,
        specification checks, the cone of incidence and the materials a
        design carries are not compared.

        Args:
            other: The Design compared with this one.

        Returns:
            A named tuple Differences: same, True when nothing compared
            differs; setup, each setting that differs as a SetupChange
            (setting, before, after), setting by the package's name
            ("incident_medium", "exit_medium", "substrate.material",
            "substrate.thickness", "reference", "sides" or "score_on"),
            before its value here and after in other; layers, each layer that
            differs, the front's first, as a LayerChange (side, number,
            before, after, change), before and after a LayerState (material,
            thickness, locked) or None where that design has no layer of the
            number, change after's thickness less before's in nm, or None.

        Raises:
            TFStudioError: an other that is not a Design.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            kicked = design.copy()
            kicked.perturb(2, seed=3)
            for layer in design.differences(kicked).layers:
                print(layer.side, layer.number, layer.change)
        """
        if not isinstance(other, Design):
            raise TFStudioError("differences: other is a Design, as tf.new_design() or copy() give one")
        found = self._calls.designDifferences(self._data, other._data)
        return differences_of(found, {mode: side for side, mode in SIDES.items()},
                              {mode: name for name, mode in SCORE_ON.items()})

    def edge_filter(self, **options):
        """The periods of a non-polarizing edge filter, as the Edge Filter
        window searches them: the five-layer period (aA bB cA bB aA), or
        (aB bA cB bA aB), whose s and p zone edges meet at the edge
        wavelength at the angle of incidence, a, b and c quarter waves at the
        edge wavelength, best first: the widest rejection band, then the
        widest pass region. At 0° the search gives the quarter-wave period
        both ways round, with c None. A and B are taken as lossless, at their
        real indices at the edge wavelength. Without keywords, the window's
        opening settings on this design.

        Args:
            pass_: "short", a shortwave pass, or "long", a longwave pass.
                Default "short".
            edge: The edge wavelength, nm. Default: the design's reference
                wavelength.
            angle: The angle of incidence, degrees in the incident medium, 0
                up to but not including 90. Default 0.
            a: Material A, by id. Default: the lowest index of the front
                layers, or SiO2 when the front has fewer than two materials.
            b: Material B, by id. Default: the highest index of the front
                layers, or TiO2.
            incident: The medium the light arrives from, by id. Default: the
                design's incident medium.
            lower: The first a searched, quarter waves, from 0. Default 0.1.
            upper: The last a searched, quarter waves, above lower and up to
                2. Default 1.
            step: The step of a, 0.0001 or more; at an angle above 0 the
                finest step over the widest range takes minutes. Default 0.05.
            periods: The number of periods each solution's formula repeats.
                Default 10.

        Returns:
            An EdgeFilter, a named tuple: pass_, edge (nm), angle; materials
            and indices, each a dict of a, b and incident, the ids searched
            and their real indices at the edge; absorbing, the ids of A and B
            with k above 0 there; periods; and solutions, best first, each an
            EdgeSolution: outer, "A" or "B", the material of the outer and
            centre layers; a, b and c in quarter waves; sigma, N11 at the
            edge, +1 or -1; zone_s and zone_p the widths of the s and p zones
            and pass_width that of the pass region, nm, inf where it does not
            end; formula, the filter as Stack Formula writes it, H the higher
            index of A and B.

        Raises:
            TFStudioError: an option it does not take or a value an option
                cannot take, a material id that resolves to nothing, a
                material with no index at the edge wavelength, A and B of one
                index there, or a material past its critical angle.

        Example::

            design = tf.new_design("Edge")
            found = design.edge_filter(edge=1000, angle=45, a="SiO2", b="TiO2")
            print(len(found.solutions), "periods; best", found.solutions[0].formula)
        """
        with worded(_EDGE_FILTER_WORDS):
            return edge_filter_of(self._calls.edgeFilter(self._data, api_names(options)))

    def apply_edge_filter(self, **options):
        """Puts an edge filter in, as the Edge Filter window's Replace or
        Append puts the period it lists in: the search is edge_filter()'s
        with the same keywords, and the solution chosen is built through
        Stack Formula with each pair of touching outer layers joined into
        one. Replace puts the filter in place of the side's layers, makes the
        edge wavelength the reference wavelength, and makes the medium
        searched the incident medium of a front filter or the exit medium of
        a back one; Append adds the layers outside the side's own. Filling the
        side a one-sided design does not coat makes it coated on both when its
        other side has layers, and on the filled side alone when it has none,
        as the window does. It takes edge_filter()'s keywords too, which give
        the search.

        Args:
            solution: Which solution, its place in edge_filter()'s list, from
                0, the best. Default 0.
            side: "front" or "back". Default: the front, or the back of a
                design coated on the back alone. A symmetric design takes the
                front.
            mode: "replace" or "append". Default "replace".

        Raises:
            TFStudioError: what edge_filter() raises, a solution that is not
                in the list, a side other than "front" or "back", the back of
                a symmetric design, or a mode other than "replace" or
                "append".

        Example::

            design = tf.new_design("Short-wave pass")
            design.apply_edge_filter(edge=700, a="SiO2", b="TiO2", periods=8)
            print(len(design.layers), "layers; reference", design.reference, "nm")
        """
        with worded(_APPLY_EDGE_FILTER_WORDS):
            self._data = self._calls.applyEdgeFilter(self._data, api_names(options))

    def needle_profile(self, pool, *, side=None, step=0.5, intra_samples=16):
        """Where a thin layer of each material would lower the merit, as the
        Needle Manual window's Compute P-function finds it: the slope of the
        optical merit against the thickness of a needle of each pool material
        put in at each interface of one side's layers and at points inside
        each layer. A negative gradient is a place where a needle lowers the
        merit. The scan scores the enabled merit rows less the MNT, MXT and
        PPEF rows, as the window does.

        Args:
            pool: The materials a needle may be, a list of ids: one or more,
                none twice.
            side: "front" or "back". Default: the front, or the back of a
                design coated on the back alone. A side the window does not
                scan is refused: the back of a symmetric design, or the
                uncoated side of a one-sided design.
            step: The probe needle's thickness, nm, 0.05 or more, over which a
                slope with no exact formula is differenced: the window's
                Probe δ. Default 0.5.
            intra_samples: Points inside each layer, a whole number from 2 to
                60: the window's Profile pts / layer. Default 16.

        Returns:
            A NeedleProfile, a named tuple: mode, the side scanned; mf0, the
            optical merit of the design as the scan scores it, None when there
            is no candidate; and candidates, in the scan's order, none when
            the window would call the design needle-optimal, each a
            NeedleCandidate: material; kind, "gap" or "inside"; layer, for
            "inside", the number of the layer split, 1 next to the substrate,
            else None; position, for "gap", how many layers lie between the
            gap and the substrate, else None; fraction, for "inside", where
            the layer is split, from the side light reaches first (the
            incident medium on the front, the substrate on the back), else
            None; depth in nm from that same side; gradient, the slope of the
            optical merit per nm. The needle becomes layer position + 1 or
            layer + 1.

        Raises:
            TFStudioError: a value an argument cannot take, a side the window
                does not scan, a design with no merit row the scan scores, or
                a pool material id that resolves to nothing.

        Example::

            design = tf.new_design("AR")
            design.stack("H L")
            design.merit.add("RAV", 450, 650, target=0)
            profile = design.needle_profile(["TiO2", "SiO2", "MgF2"])
            best = min(profile.candidates, key=lambda c: c.gradient)
            print(len(profile.candidates), "candidates; steepest", best.material, best.kind, best.gradient)
        """
        options = {"pool": pool, "side": side, "step": step, "intra_samples": intra_samples}
        with worded(_NEEDLE_PROFILE_WORDS):
            return needle_profile_of(self._calls.needleProfile(self._data, api_names(options)))

    def insert_needle(self, candidate, *, thickness=None, side=None):
        """Puts one needle in, as the Needle Manual window's Apply puts in the
        candidate picked from its profile: a layer of the candidate's
        material at its gap, or splitting its layer in two at its fraction. A
        symmetric design's back follows its front. Without thickness the
        needle starts where the window starts it: at the thickness between 1
        and 60 nm where golden-section search finds the optical merit lowest,
        or at 1 nm when no thickness there beats it.

        To do what Apply does with Refine after insert, add an MNT row at
        1 nm, the window's minimum thickness, and refine with sqp:
        design.merit.add("MNT", target=1), then
        design.refine(method="sqp", max_iter=80). The layers end on the
        thicknesses the window's refine gives.

        Args:
            candidate: A NeedleCandidate from needle_profile() on this design
                and side, or a dict of its fields.
            thickness: The needle's thickness, nm, from 1 to 200 at a gap and
                from 1 to the split layer's thickness less 1 inside one (at
                least 2): the window's slider range. Default: the window's
                starting thickness.
            side: needle_profile()'s side.

        Raises:
            TFStudioError: a side needle_profile() refuses, a thickness
                outside the window's range there, a candidate this design and
                side do not have, or, without a thickness, a design with no
                merit row the scan scores.

        Example::

            design = tf.new_design("AR")
            design.stack("H L")
            design.merit.add("RAV", 450, 650, target=0)
            profile = design.needle_profile(["TiO2", "SiO2", "MgF2"])
            design.insert_needle(min(profile.candidates, key=lambda c: c.gradient))
            print(len(design.layers), "layers; optical merit", design.merit.optical_value)
        """
        with worded(Words("insertNeedle", "insert_needle")):
            self._data = self._calls.insertNeedle(self._data, candidate_argument(candidate),
                                                  api_names({"thickness": thickness, "side": side}))

    def _edit(self, call, method, **options):
        """The design changed by the API's call `call` with `options`, for the
        method `method`, whose name its refusals then begin with."""
        with worded(Words(call, method)):
            self._data = getattr(self._calls, call)(self._data, api_names(options))

    def spectrum(self, start, end, *, step=1, angles=(0,)):
        """R, T and A over a range of wavelengths, for unpolarized light and
        for s and p, as the Optical Evaluation window computes them. What it
        is computed on follows the design's sides and score_on, and the
        spectrum's mode says which it was. A design under a cone of incidence
        is averaged over its cone.

        Args:
            start: The first wavelength, nm.
            end: The last wavelength, nm, above `start`.
            step: The wavelength step, nm. Default 1.
            angles: The angles of incidence, degrees in the incident medium,
                each from 0 up to but not including 90. Default [0].

        Returns:
            A Spectrum.

        Raises:
            TFStudioError: a range that is not one, an angle outside 0 to 90,
                a design that names a material that resolves to nothing, or
                more than a million points (wavelengths times angles): take a
                larger step or fewer angles.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            s = design.spectrum(400, 800, step=1, angles=[0, 45])
            print(s.mode, max(s.R), min(s.angle(45).Tp))
        """
        angles = list(angles)
        with worded(Words("spectrum", "spectrum")):
            answer = self._calls.spectrum(self._data, {"from": start, "to": end, "step": step, "angles": angles})
        computed = answer["angles"]
        series = [next(computed[key] for key in computed if float(key) == angle) for angle in angles]
        return (Spectrum(answer["evalMode"], answer["lambda"], angles, series, answer["outOfRange"])
                ._named(self.name)._computed_on(self._calls, copy.deepcopy(self._data)))

    def edge_shift(self, start, end, angles, **options):
        """Where the design's spectrum crosses a level beside the peak of a
        band at each of several angles of incidence, and how far that edge
        has moved from where it is at the first angle, each found as an
        EDGE_LAMBDA check of the Specification window finds it, as a spectrum
        curve's edge() finds it. What it is computed on follows the design's
        sides and score_on, as a spectrum does, and a design under a cone of
        incidence is averaged over its cone.

        Args:
            start: The first wavelength of the band, nm.
            end: The last wavelength of the band, nm, above start.
            angles: The angles of incidence, degrees in the incident medium,
                each from 0 up to but not including 90.
            quantity: "R", "T" or "A" for unpolarized light, or "Rs", "Rp",
                "Ts", "Tp", "As" or "Ap". Default "T".
            level: The level crossed, a fraction from 0 to 1; below 0.001 or
                above 0.999 it is taken as 0.001 or 0.999. Default 0.5.
            edge_side: "right" for the crossing above the peak. Default: the
                one below it, or the one above where there is none below.
            direction: "max", the level a fraction of the band's highest
                value, or "min", a fraction of the way from its lowest value
                up to 1. Default "max".
            step: The step the peak is searched at, nm: 1, 0.1, 0.01 or
                0.001. The crossing is bracketed on a scan of the band no
                coarser than it, of 301 samples at the least. Default 1.

        Returns:
            An EdgeShift, a named tuple: angles, and one value per angle in
            each of edge, the crossing, nm, shift, the edge less the edge at
            the first angle, nm, both None where the spectrum does not cross
            the level inside the band, reason, then "edgeNotCrossed" and
            otherwise None, peak, peak_value and level_value; and level, the
            level used, mode, quantity, direction and step.

        Raises:
            TFStudioError: a band that is not one, an empty list of angles or
                an angle outside 0 to 90, an option it does not take or a
                value an option cannot take, or a design that names a
                material that resolves to nothing.

        Example::

            design = tf.new_design("Long-wave pass")
            design.stack("(0.5H L 0.5H)^8")
            moved = design.edge_shift(600, 760, [0, 15, 30, 45], level=0.5)
            for angle, edge, shift in zip(moved.angles, moved.edge, moved.shift):
                print(angle, "degrees:", round(edge, 2), "nm, moved", round(shift, 2), "nm")
        """
        refuse_arguments("edge_shift", options, ("from", "to", "angles"), _EDGE_SHIFT_OPTIONS)
        with worded(_EDGE_SHIFT_WORDS):
            answer = self._calls.edgeShift(self._data, dict(api_names(options), angles=angles, **{"from": start, "to": end}))
        return answered(EdgeShift, answer)

    def compare_measured(self, measured, **options):
        """How the design differs from a measured curve, as the MCURVE merit
        row the Fit... dialog writes scores it: Measured Spectra's for R, T
        and A, Measured Ellipsometry's for Psi and Delta. The curve is sampled
        on the dialog's grid and kept to the span every material of the
        design has data for, and the design read at each point at the curve's
        angle and polarization. R, T and A are read on what the design's
        sides and score_on say, as the merit function scores them, averaged
        over a cone of incidence the design has; Psi and Delta on the front
        side alone, each Delta difference taken the short way round the
        circle.

        Args:
            measured: The path of a spectrum file, read as
                tf.read_spectrum_file() reads it, or a MeasuredCurve that gives,
                an EllipsometryCurve tf.read_ellipsometry_file() gives, or a
                dict of wavelength, values, quantity, angle, pol and name, its
                values fractions of 1, quantity "T" unless given, angle 0 and
                pol "avg"; a Psi or Delta curve also takes side and
                delta_convention, its values in degrees.
            curve: For a file of several curves, the one compared, by its
                name or its number from 0.
            angle: For a file, as tf.read_spectrum_file() takes it.
            pol: For a file, as tf.read_spectrum_file() takes it.
            quantity: For a file, as tf.read_spectrum_file() takes it.
            scale: For a file, as tf.read_spectrum_file() takes it.
            x_unit: For a file, as tf.read_spectrum_file() takes it.
            grid: "measured", the curve's own points; "thinned", every
                thin_every-th of them and the last; or "uniform", every step
                nm, the curve read between its points as the dialog reads it.
                Default "measured".
            step: With grid "uniform", the step, nm. Default: the curve's
                median spacing.
            thin_every: With grid "thinned", which points are kept. Default 2.
            start: The first wavelength compared, nm. Default: the curve's first.
            end: The last wavelength compared, nm. Default: the curve's last.
            db: For a T curve, True compares in dB, as the dialog's dB scale
                does. Default False.
            level_free: For R, T and A, True takes off the mean difference
                before the RMS, as an MCURVE row with its level free scores.
                Default False.

        Returns:
            A MeasuredDifference, a named tuple: rms, the MCURVE row's value,
            a fraction of 1, dB with db, or degrees for Psi and Delta; ppef,
            a PPEF row's value against it, dB, None for Psi and Delta;
            level, the mean difference taken off with level_free,
            otherwise None; wavelength, the wavelengths compared, nm, and at
            each measured, design and deviation, design less measured (less
            level); clipped, True when fewer wavelengths were compared than
            asked for; and mode, name, quantity, angle, pol, grid, db and
            level_free.

        Raises:
            TFStudioError: a measured that is not a file path or a curve, a
                file that cannot be read or holds no spectrum, a file of
                several curves without curve, an option it does not take or a
                value an option cannot take, no point to compare, a Psi or
                Delta curve at normal incidence or on the back side or one on
                a design scored on its back alone, or a design that names a
                material that resolves to nothing.

        Example::

            design = tf.new_design("AR")
            design.stack("0.5H L")
            scan = {"quantity": "R", "wavelength": [450, 550, 650], "values": [0.021, 0.009, 0.018]}
            d = design.compare_measured(scan)
            print("RMS", round(d.rms, 4), "PPEF", round(d.ppef, 2), "dB")
        """
        refuse_arguments("compare_measured", options, ("from", "to"), _COMPARE_OPTIONS)
        given = api_names({_COMPARE_NAMES.get(name, name): value for name, value in options.items()})
        with worded(_COMPARE_WORDS):
            answer = self._calls.measuredDifference(self._data, measured_argument(measured), given)
        return measured_difference(answer)

    def add_measured_curves(self, curves):
        """Adds measured curves to the design as the import of Measured
        Spectra and Measured Ellipsometry adds them, each with an id of its
        own: R, T and A to the design's spectra, Psi and Delta to its
        ellipsometry, after the curves it holds. The design saves them, the
        windows show them, and fit_measured() turns one into merit rows. A
        curve holds what it is given: the file it came from, the unit that
        file was written in and whether it was in percent are not part of it.

        Args:
            curves: A curve or a list of curves: MeasuredCurves as
                tf.read_spectrum_file() gives them, EllipsometryCurves as
                tf.read_ellipsometry_file() gives them, or dicts of
                wavelength, values, quantity, angle, pol and name, R, T and A
                as fractions of 1, quantity "T" unless given, angle 0 and pol
                "avg"; a Psi or Delta curve also takes side and
                delta_convention, "front" and "azzam" unless given, its values
                in degrees.

        Raises:
            TFStudioError: a curve that is not one of those, or a value a
                field cannot take.

        Example::

            design = tf.new_design("AR")
            design.add_measured_curves({"name": "Bench R", "quantity": "R",
                                        "wavelength": [450, 550, 650], "values": [0.021, 0.009, 0.018]})
            print(design.compare_measured({"quantity": "R", "wavelength": [450, 550, 650],
                                           "values": [0.021, 0.009, 0.018]}).rms)
        """
        with worded(Words("addMeasuredCurves", "add_measured_curves")):
            self._data = self._calls.addMeasuredCurves(self._data, curves_argument(curves))

    def fit_measured(self, curve, **options):
        """Adds the merit rows the Fit... dialog adds for a measured curve the
        design holds: Measured Spectra's for R, T and A, Measured
        Ellipsometry's for Psi and Delta. The MCURVE block holds the curve
        sampled on the dialog's grid, kept to the span every material of the
        design has data for; a Psi or Delta block is scored on the front side
        alone. With constraints, an MNT and an MXT row follow it, as the
        dialog's thickness constraints add them. compare_measured() with the
        same keywords gives the block's value.

        Args:
            curve: The name of a curve the design holds.
            grid: "measured", the curve's own points; "thinned", every
                thin_every-th of them and the last; or "uniform", every step
                nm, the curve read between its points as the dialog reads it.
                Default "measured".
            step: With grid "uniform", the step, nm. Default: the curve's
                median spacing.
            thin_every: With grid "thinned", which points are kept. Default 2.
            start: The first wavelength kept, nm. Default: the curve's first.
            end: The last wavelength kept, nm. Default: the curve's last.
            db: For a T curve, True fits in dB, as the dialog's dB scale does.
                Default False.
            weight: The block's weight, 0 or more. Default 1.
            output: "append" adds the rows after the merit rows the design
                has; "replace" puts them in place of all of them. Default
                "append".
            constraints: A dict of min, max and weight, thicknesses in nm,
                10, 1000 and 1 unless given, to add the dialog's MNT and MXT
                rows over every layer. Default: none.

        Raises:
            TFStudioError: a curve the design does not hold or two of that
                name, an option it does not take or a value an option cannot
                take, no point to keep, a Psi or Delta curve at normal
                incidence or on the back side or one on a design scored on its
                back alone, or a design that names a material that resolves to
                nothing.

        Example::

            design = tf.new_design("AR")
            design.stack("0.5H L")
            design.add_measured_curves({"name": "Bench R", "quantity": "R", "wavelength": [450, 500, 550, 600, 650],
                                        "values": [0.021, 0.012, 0.009, 0.011, 0.018]})
            design.fit_measured("Bench R", start=470, end=640)
            print(design.merit.value)
        """
        refuse_arguments("fit_measured", options, ("from", "to"), _FIT_OPTIONS)
        given = api_names({_COMPARE_NAMES.get(name, name): value for name, value in options.items()})
        with worded(_FIT_WORDS):
            self._data = self._calls.fitMeasured(self._data, curve, given)

    def index_profile(self, wavelength=None, side=None):
        """The refractive index of the layers at one wavelength, laid out by
        depth, as the Refractive Index Profile window shows it. The sides
        follow the design's sides and score_on, as a spectrum does, unless
        side is given: on one side, the layers in the order light meets them
        coming from that side's medium; on the whole part, the front, the
        substrate and the back, as the window's Total view lays them. A
        layer with no thickness is left out, as the window leaves it out.

        Args:
            wavelength: The wavelength n and k are read at, nm. Default: the
                design's reference wavelength.
            side: "front", "back" or "total", the whole part. Default: what
                the design is scored on.

        Returns:
            An IndexProfile.

        Raises:
            TFStudioError: a wavelength of 0 or less, a side other than
                "front", "back" or "total", a side with no layer thicker than
                0 nm, or a design that names a material that resolves to
                nothing.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            profile = design.index_profile(wavelength=633)
            for l in profile.layers:
                print(l.number, l.material, round(l.n, 4), round(l.start, 1), "to", round(l.end, 1), "nm")
        """
        return IndexProfile(self._read("indexProfile", "index_profile", wavelength=wavelength, side=side))

    def layer_thicknesses(self, wavelength=None, side=None):
        """Each layer's physical and optical thickness, as the Layer
        Thicknesses window lists them, with the optical ones taken at one
        wavelength. The sides follow the design's sides and score_on, as a
        spectrum does, unless side is given; on the whole part, the front's
        layers and then the back's. Every layer has its row, one with no
        thickness too.

        Args:
            wavelength: The wavelength λ0 the optical thicknesses are taken
                at, nm. Default: the design's reference wavelength.
            side: "front", "back" or "total", both sides. Default: what the
                design is scored on.

        Returns:
            A LayerThicknesses.

        Raises:
            TFStudioError: a wavelength of 0 or less, a side other than
                "front", "back" or "total", a side with no layers, or a design
                that names a material that resolves to nothing.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            for row in design.layer_thicknesses(wavelength=600).rows:
                print(row.number, row.material, round(row.thickness, 2), "nm, QWOT", round(row.qwot, 4))
        """
        return LayerThicknesses(self._read("layerThicknesses", "layer_thicknesses", wavelength=wavelength, side=side))

    def total_thickness(self, side=None):
        """The physical thickness of the layers, nm. Without side, of the
        sides a TT merit row sums, as the row reads it: the front of a design
        coated on the front or symmetric, the back of one coated on the back,
        both of one coated on both. So a symmetric design counts its front
        once. "total" counts the front and the back the design holds, a
        symmetric design's back as the mirror of its front.

        Args:
            side: "front", "back" or "total", both sides. Default: the coated
                sides.

        Returns:
            The thickness, nm.

        Raises:
            TFStudioError: a side other than "front", "back" or "total".

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.sides = "symmetric"
            print(design.total_thickness(), "nm coated,", design.total_thickness(side="total"), "nm on both sides")
        """
        return self._read("designFacts", "total_thickness", side=side)["thickness"]

    def optical_thickness(self, side=None):
        """The optical thickness of the layers, the sum of n times thickness
        at the design's reference wavelength, nm, over the layers
        total_thickness() counts with the same side.

        Args:
            side: "front", "back" or "total", both sides. Default: the coated
                sides.

        Returns:
            The optical thickness, nm; None when a material of a layer counted
            resolves to nothing.

        Raises:
            TFStudioError: a side other than "front", "back" or "total".

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            print(design.optical_thickness(), "nm, seven quarter waves of", design.reference / 4, "nm")
        """
        return self._read("designFacts", "optical_thickness", side=side)["opticalThickness"]

    def layer_counts(self, side=None):
        """How many layers of each material, over the layers
        total_thickness() counts with the same side.

        Args:
            side: "front", "back" or "total", both sides. Default: the coated
                sides.

        Returns:
            A dict of counts by material id.

        Raises:
            TFStudioError: a side other than "front", "back" or "total".

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H", H="Ta2O5", L="SiO2")
            print(design.layer_counts())
        """
        return self._read("designFacts", "layer_counts", side=side)["layerCounts"]

    def admittance(self, wavelength=None, *, angle=0, side=None, plane="admittance"):
        """The admittance locus of one coated side at one wavelength, for s
        and p, as the Admittance Diagram window draws it and lists it in its
        table: from the substrate's admittance through the admittance at the
        outer surface of each layer to the coating's outer surface. It is
        computed on the front, or on the back of a design coated on the back
        alone, unless side is given. The design's cone of incidence is not
        used, as the window does not use it. Complex values are Python complex
        numbers in Macleod's sign, the window's: an absorbing material's index
        is n − ik.

        Args:
            wavelength: The wavelength, nm. Default: the design's reference
                wavelength.
            angle: The angle of incidence, degrees in the medium light comes
                from, 0 up to but not including 90. Default 0.
            side: "front" or "back". Default: the back of a design coated on
                the back alone and the front of any other.
            plane: What the arcs are drawn in: "admittance", the Y plane, or
                "reflection", the plane of the reflection coefficient Γ.
                Default "admittance".

        Returns:
            An Admittance.

        Raises:
            TFStudioError: a wavelength of 0 or less, an angle outside 0 to
                90, a side other than "front" or "back", a plane other than
                "admittance" or "reflection", a side with no layers, or a
                design that names a material that resolves to nothing.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            locus = design.admittance(550, angle=45)
            front = locus.s.boundaries[-1]
            print(locus.mode, "Y", front.Y, "Rs", abs(front.gamma) ** 2)
        """
        return Admittance(self._read("admittance", "admittance", wavelength=wavelength, angle=angle, side=side,
                                     plane=plane))

    def electric_field(self, wavelength=None, **options):
        """The electric field through one coated side at one wavelength, for
        s, p and unpolarized light, as the Electric Field window computes it,
        from the medium light comes from to the substrate. It is computed on
        the front, or on the back of a design coated on the back alone, unless
        side is given. The design's cone of incidence is not used, as the
        window does not use it. |E|² is a fraction of the incident |E|², and
        the amplitude is in V/m for 1 W/m² incident.

        Args:
            wavelength: The wavelength, nm. Default: the design's reference
                wavelength.
            angle: The angle of incidence, degrees in the medium light comes
                from, 0 up to but not including 90. Default 0.
            side: "front" or "back". Default: the back of a design coated on
                the back alone and the front of any other.
            points_per_layer: The samples taken across each layer, a whole
                number of 2 or more. Default 60.
            depth_unit: What depth is in: "nm", "OT" (n times thickness
                summed, nm), "QWOT" or "FWOT". Default "nm".
            reference: The wavelength λ0, nm, the optical depth units read n
                at. Default: the design's reference wavelength.

        Returns:
            An ElectricField.

        Raises:
            TFStudioError: a wavelength or reference of 0 or less, an angle
                outside 0 to 90, a side other than "front" or "back", a depth
                unit it does not have, a points_per_layer that is not a whole
                number of 2 or more, more than a million samples, a side with
                no layer thicker than 0 nm, or a design that names a material
                that resolves to nothing.

        Example::

            design = tf.new_design("Mirror", reference=1064)
            design.stack("(HL)^4 H")
            field = design.electric_field(1064, angle=45)
            peak = field.p.e2.index(max(field.p.e2))
            print("peak |E|², p:", round(field.p.e2[peak], 4), "at", round(field.z[peak], 1), "nm")
        """
        with worded(_FIELD_WORDS):
            return ElectricField(self._calls.electricField(self._data, api_names({**options, "wavelength": wavelength})))

    def color(self, **options):
        """The CIE colour of the design's reflectance or transmittance, as
        the Color Evaluation window computes it: the tristimulus values of R
        or T on the 380-780 nm band under one illuminant, and the colour
        spaces, dominant wavelength, correlated colour temperature and sRGB
        swatch the window shows. What it is computed on follows the design's
        sides and score_on, as a spectrum does, unless side is given, and a
        design under a cone of incidence is averaged over its cone, as the
        window averages it. A side with no layers gives the colour of its
        bare surface.

        Args:
            quantity: What is coloured: "R" or "T". Default "R".
            angle: The angle of incidence, degrees in the incident medium, 0
                up to but not including 90. Default 0.
            pol: The polarization: "avg", unpolarized, "s" or "p". Default
                "avg".
            observer: The CIE standard observer, by its field in degrees: 2
                (CIE 1931) or 10 (CIE 1964). Default 2.
            illuminant: The CIE illuminant: "D65", "D50", "A" or "E".
                Default "D65".
            step: The wavelength step of the spectrum the colour is
                integrated on, nm. Default 0.5.
            side: "front", "back" or "total", the whole part. Default: what
                the design is scored on.

        Returns:
            A Color.

        Raises:
            TFStudioError: a quantity, polarization, observer, illuminant or
                side it does not have, an angle outside 0 to 90, a step of 0
                or less, more than a million wavelengths, or a design that
                names a material that resolves to nothing.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            c = design.color(quantity="R", illuminant="D65")
            print(c.mode, "x", round(c.x, 4), "y", round(c.y, 4), "Y", round(c.Y, 2), "%, dominant",
                  c.dominant.wavelength, "nm")
        """
        return Color(self._read("color", "color", **options))

    def integrals(self, **options):
        """Weighted averages of the design's T, R and A, as the Integral
        Values window computes them: each integral is ∫ C(λ) w(λ) dλ / ∫ w(λ)
        dλ over its weighting's band, on the spectrum's grid. The built-in
        rows are the window's, Tvis to RNIR; rows of your own come in custom.
        What it is computed on follows the design's sides and score_on, as a
        spectrum does, unless side is given, and a design under a cone of
        incidence is averaged over its cone, as the window averages it. A row
        whose band the spectrum does not span has no value: its numbers are
        nan and covered is False. A row whose weighting is 0 over the whole
        band has no value either, though covered is True.

        Args:
            start: The first wavelength of the spectrum, nm. Default 300.
            end: The last wavelength, nm, above start. Default 2500.
            step: The wavelength step, nm. Default 0.5.
            angle: The angle of incidence, degrees in the incident medium, 0
                up to but not including 90. Default 0.
            pol: The polarization: "avg", unpolarized, "s" or "p". Default
                "avg".
            custom: Rows of your own, each a dict with key, quantity, source,
                detector and band: key its name, which no other row has;
                quantity "T", "R" or "A"; source {"id": ...} with an id of
                "D65", "D50", "A", "AM1.5G", "E", "blackbody" with "T", its
                temperature in K, or "custom" with "table", its [nm, value]
                rows, at least two at different wavelengths; detector
                {"id": ...} with an id of "photopic", "flat" or "custom" with
                its "table"; band [start, end] in nm, which the weighting's
                own range narrows. Left out: "T", D65, photopic and 380-780
                nm; a blackbody's T 5778 K. Default: no rows of your own.
            side: "front", "back" or "total", the whole part. Default: what
                the design is scored on.

        Returns:
            An Integrals.

        Raises:
            TFStudioError: a range that is not one, an angle outside 0 to 90,
                a polarization or side it does not have, more than a million
                wavelengths, a custom row with a field it does not have or
                cannot use, a key another row has, or a design that names a
                material that resolves to nothing.

        Example::

            design = tf.new_design("AR")
            design.stack("HL")
            iv = design.integrals(custom=[{"key": "T3000K", "source": {"id": "blackbody", "T": 3000},
                                           "band": [400, 700]}])
            print("Tvis", round(iv["Tvis"].value, 4), "T3000K", round(iv["T3000K"].value, 4))
        """
        return Integrals(self._read("integrals", "integrals", **options))

    def ellipsometry(self, start=None, end=None, **options):
        """Ψ and Δ of one coated side against wavelength, at one angle of
        incidence or several, as the Ellipsometry window's spectral sweep
        computes them, from ρ = r_p / r_s = tan Ψ · exp(i Δ). It is computed
        on the front, or on the back of a design coated on the back alone,
        unless side is given; a side with no layers gives its bare surface.
        The design's cone of incidence is not used, as the window does not
        use it.

        Args:
            start: The first wavelength, nm. Default 400.
            end: The last wavelength, nm, above start. Default 800.
            step: The wavelength step, nm. Default 0.5.
            angles: The angles of incidence, degrees in the medium light comes
                from, each 0 up to but not including 90. Default [65].
            side: "front" or "back". Default: the back of a design coated on
                the back alone and the front of any other.
            delta_convention: The sign of Δ: "azzam", the Azzam-Bashara sign
                an ellipsometer writes, or "reversed", 360 degrees minus that.
                Ψ is the same in both. Default "azzam".

        Returns:
            An Ellipsometry.

        Raises:
            TFStudioError: a range that is not one, an angle outside 0 to 90,
                a side other than "front" or "back", a convention other than
                "azzam" or "reversed", more than a million points (wavelengths
                times angles), or a design that names a material that
                resolves to nothing.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            e = design.ellipsometry(400, 800, step=1, angles=[55, 70])
            print(e.mode, "Psi at 55 degrees from", round(min(e.psi), 2), "to", round(max(e.psi), 2))
        """
        return Ellipsometry(self._over_range(_ELLIPSOMETRY_WORDS, _ELLIPSOMETRY_OPTIONS, start, end, options))._named(self.name)

    def ellipsometry_vs_angle(self, wavelength=None, start=None, end=None, **options):
        """Ψ and Δ of one coated side against angle of incidence at one
        wavelength, as the Ellipsometry window's angular sweep computes them.
        The angles run from start by step, each rounded to 0.001 degree, to
        end. It is computed on the front, or on the back of a design coated
        on the back alone, unless side is given; a side with no layers gives
        its bare surface. The design's cone of incidence is not used, as the
        window does not use it.

        Args:
            wavelength: The wavelength, nm. Default: the design's reference
                wavelength.
            start: The first angle of incidence, degrees in the medium light
                comes from, 0 or more. Default 45.
            end: The last angle, degrees, above start and at most 89.5.
                Default 80.
            step: The angle step, degrees, from 0.05 up to the span, end minus
                start. Default 0.5.
            side: "front" or "back". Default: the back of a design coated on
                the back alone and the front of any other.
            delta_convention: The sign of Δ: "azzam", the Azzam-Bashara sign
                an ellipsometer writes, or "reversed", 360 degrees minus that.
                Ψ is the same in both. Default "azzam".

        Returns:
            An Ellipsometry.

        Raises:
            TFStudioError: a wavelength of 0 or less, angles that are not a
                range from 0 to 89.5, a step below 0.05 degrees or above the
                span, a side other than "front" or "back", a convention other
                than "azzam" or "reversed", or a design that names a material
                that resolves to nothing.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            e = design.ellipsometry_vs_angle(633, 45, 80, step=0.5)
            print("lowest Psi", round(e.psi.min(), 3), "at", e.psi.angle[e.psi.index(e.psi.min())], "degrees")
        """
        refuse_arguments("ellipsometry_vs_angle", options, ("angleStart", "angleEnd", "angleStep"), _SWEEP_OPTIONS)
        sweep = api_names({"wavelength": wavelength, "angle_start": start, "angle_end": end, "angle_step": options.pop("step", None)})
        given = api_names(options)
        with worded(_SWEEP_WORDS):
            return Ellipsometry(self._calls.ellipsometryVsAngle(self._data, {**given, **sweep}))

    def group_delay(self, start=None, end=None, **options):
        """Phase, group delay, GDD, TOD and CDC of the design's reflected or
        transmitted light against wavelength, as the Group Delay / GDD window
        computes them. They are computed on the front, or on the back of a
        design coated on the back alone, unless side is given; a side with no
        layers gives its bare surface. side="total", with response="T" alone,
        is the whole part as Pulse Analysis computes it: the front coating,
        one pass through the substrate and the back coating. The design's
        cone of incidence is not used, as the window does not use it.

        GD, GDD and TOD are analytic values at each wavelength, so they do not
        depend on the grid. The phase is unwrapped along the grid, so on a
        uniform grid it can land 2π off across a resonance narrower than the
        step. On the whole part the substrate's own phase, −2π n d cosθ / λ,
        n, d and θ its index, thickness and the angle in it, is added as it
        is, so only the coatings' phase is unwrapped. step="auto" gives the
        window's own grid, which adds points at reflection minima and table
        knots, so a mean over it leans toward the spikes there.

        Args:
            start: The first wavelength, nm. Default 400.
            end: The last wavelength, nm, above start. Default 800.
            step: The wavelength step, nm, or "auto", the window's own grid.
                Default 0.5.
            angle: The angle of incidence, degrees in the medium light comes
                from, 0 up to but not including 90. Default 0.
            pol: The polarization: "avg", "s" or "p". Default "avg".
            response: The light whose phase is taken: "R", reflected, or "T",
                transmitted. Default "R".
            side: "front", "back", or with response="T" "total", the whole
                part. Default: the back of a design coated on the back alone
                and the front of any other.
            reference: A wavelength, nm: the phase is then 0 at the sample
                nearest it, as the window plots it; when that sample has no
                value, the phase stays absolute and reference is None.
                Default: the phase is absolute.

        Returns:
            A GroupDelay.

        Raises:
            TFStudioError: a range that is not one, a step that is not a
                positive number or "auto", an angle outside 0 to 90, a
                polarization, response or side it does not have, "total" with
                response="R", a reference that is not a wavelength above 0,
                more than a million wavelengths, or a design that names a
                material that resolves to nothing.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            g = design.group_delay(500, 600, step=1)
            print(g.mode, "GDD from 520 to 580 nm:", round(g.gdd.min(520, 580), 3), "to", round(g.gdd.max(520, 580), 3), "fs²")
        """
        return GroupDelay(self._over_range(_GROUP_DELAY_WORDS, _GROUP_DELAY_OPTIONS, start, end, options))

    def set_pulse_spectrum(self, file_or_rows):
        """Sets the spectrum the design holds for Pulse Analysis, as the
        window's Load file… and Apply set it: a text table read as the curve
        editor reads it, its wavelength column in the unit its heading names,
        or rows given. Each row is a wavelength, an intensity and, when a
        third column is given, the spectral phase in rad; against wavelength
        the intensity is read as per unit wavelength, as a spectrometer
        records it. The rows are kept in the units given, in rising order,
        and the design saves them. pulse() with source="design" reads them,
        its centre then their centroid, where the window's Apply moves its
        centre.

        Args:
            file_or_rows: The path of a text table, or rows [wavelength nm,
                intensity] or [wavelength nm, intensity, phase rad]. A
                relative path is taken from the program's working folder.

        Raises:
            TFStudioError: a file that cannot be read or holds no wavelength
                and intensity columns, a row that is not two or three
                numbers, fewer than two rows with a wavelength above 0 and an
                intensity not below 0, no row with an intensity above 0, or a
                phase on some rows and not on others.

        Example::

            import math

            rows = [[w, math.exp(-((w - 800) / 20) ** 2)] for w in range(760, 841, 2)]
            design = tf.new_design("Mirror", reference=800)
            design.stack("(HL)^8 H")
            design.set_pulse_spectrum(rows)
            print("centre", design.pulse(source="design").centre, "nm")
        """
        with worded(_SET_PULSE_SPECTRUM_WORDS):
            self._data = self._calls.setPulseSpectrum(self._data, file_or_rows)

    def pulse(self, **options):
        """A pulse's passage through the design, in time and in its spectrum,
        as the Pulse Analysis window computes it: the pulse is reflected off
        or transmitted through one coated side, or through the whole part,
        the front coating, one pass through the substrate and the back
        coating, the first pulse to come out of it; passes bounces or passes
        in a row. Its spectrum is a Gaussian, sech² or super-Gaussian about
        the centre wavelength, or with source="design" the spectrum the
        design holds (set_pulse_spectrum()), with the chirp of gdd and tod on
        top. The design's cone of incidence is not used, as the window does
        not use it. Without keywords, the window's opening settings, on the
        side the PR, GD, GDD and TOD merit rows score: the back of a design
        coated on the back alone and the front of any other. The window opens
        on the front unless only the back holds layers, so with one side empty
        the two can differ; a side with no layers gives its bare surface.

        Args:
            source: "model", the spectrum of shape, or "design", the spectrum
                the design holds. Default "model".
            shape: "gaussian" or "sech2", a pulse of duration, or
                "superGaussian", a spectrum of bandwidth and order. Default
                "gaussian".
            centre: The centre wavelength, nm, the carrier the chirp is taken
                about. Default: 800 nm, or with source="design" the
                spectrum's centroid in frequency to the hundredth of a
                nanometre, as Apply sets it.
            duration: The intensity FWHM of the transform-limited pulse, fs,
                for "gaussian" and "sech2". Default 10.
            bandwidth: The intensity FWHM of the spectrum, nm, for
                "superGaussian". Default 100.
            order: The super-Gaussian's order, above 0; 2 is a Gaussian, and
                a higher order flattens the top of the spectrum. Default 2.
            gdd: The input's own GDD, fs², about the centre wavelength.
                Default 0.
            tod: The input's own TOD, fs³, about the centre wavelength.
                Default 0.
            side: "front", "back", or with response="T" "total", the whole
                part. Default: the back of a design coated on the back alone
                and the front of any other.
            response: "R", the reflected pulse, or "T", the transmitted one.
                Default "R".
            pol: The polarization: "avg", "s" or "p". Default "avg".
            angle: The angle of incidence, degrees in the medium light comes
                from, 0 up to but not including 90. Default 0.
            passes: The bounces off the coating, or passes through it, a whole
                number. Default 1.

        Returns:
            A Pulse.

        Raises:
            TFStudioError: an option it does not take or a value an option
                cannot take, "total" with response="R", source="design" on a
                design that holds no spectrum with light in it, a design that
                names a material that resolves to nothing, a pulse too short
                for its centre wavelength, a response that cannot be computed
                across the spectrum, or no light out of the part.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            p = design.pulse(centre=550, duration=20, passes=2)
            print("output FWHM", round(p.metrics.output_fwhm, 2), "fs, peak", round(100 * p.metrics.peak_vs_flp, 1), "% of the Fourier-limited pulse")
        """
        with worded(_PULSE_WORDS):
            return Pulse(self._calls.pulseAnalysis(self._data, api_names(options)))

    def process_steps(self, start=None, end=None, **options):
        """The spectrum a monitor in the chamber reads after each layer of
        one side, as the Process Exporter window computes its finished-layer
        curves: the layers deposited from the substrate out, an empty layer
        left out, the piece read in air. On the part the other side stays
        bare or carries its whole coating for the run; on witness chips each
        chip is a run of its own from bare chip glass, each layer
        witness_ratio times its thickness on the part. The design's cone of
        incidence is not used.

        Args:
            start: The first wavelength, nm. Default 400.
            end: The last wavelength, nm, above start. Default 1100.
            step: The wavelength step, nm. Default 0.5.
            side: "front" or "back", the side deposited. Default: the front,
                or the back of a design coated on the back alone.
            other_side: "bare" or "coated": the other side of the part,
                without or with its coating. Not used on chips. Default
                "bare".
            quantity: "T", "R" or "A". Default "T".
            angle: The angle of incidence, degrees in air, 0 up to but not
                including 90. Default 0.
            pol: "avg", "s" or "p". Default "avg".
            chips: On witness chips, a dict of layers_per_chip, plan, glass
                and witness_ratio, each optional: plan a chip number for each
                layer of the side from the substrate out, empty layers
                included, in place of layers_per_chip layers to a chip (3
                without either); glass the chip glass by id, the substrate
                without it; witness_ratio the witness thickness over the
                part's, from 0.05 to 10, 1 without it. Default: the part.

        Returns:
            A ProcessSteps, a named tuple: mode, the side deposited;
            quantity; wavelength (nm); bare, the spectrum before the first
            layer; and steps, one ProcessStep per layer deposited: step from
            1, layer its Design Editor number from 1 next to the substrate,
            material by id, thickness on the piece read in nm, chip its chip
            number or None on the part, values the spectrum when it is
            finished, fractions of 1.

        Raises:
            TFStudioError: an option it does not take or a value an option
                cannot take, a range that is not one, more than a million
                wavelengths, a chip plan whose length is not the side's layer
                count, a chip glass that resolves to nothing, or a design that
                names a material that resolves to nothing.

        Example::

            design = tf.new_design("AR")
            design.stack("H L")
            run = design.process_steps(400, 800, step=5)
            at = run.wavelength.index(550)
            for s in run.steps:
                print("step", s.step, s.material, "T at 550 nm", round(s.values[at], 4))
        """
        refuse_arguments("process_steps", options, ("from", "to"), _PROCESS_OPTIONS)
        with worded(_PROCESS_WORDS):
            answer = self._calls.processSteps(self._data, dict(run_options(options), **api_names({"from": start, "to": end})))
        return process_steps_of(answer)

    def export_process(self, folder, start=None, end=None, **options):
        """Writes the files the Process Exporter window's Save writes for a
        run into a folder: one .res file a step (01.res, 02.res, ...), or
        CSV or text files, one a step or one table a run, each spectrum as
        process_steps() computes it. On witness chips each chip's files go in
        a folder of its own inside it. A file of the same name already there
        is replaced, as Save replaces it. It takes process_steps()'s keywords
        too, which give the run.

        Args:
            folder: The folder the files go in, which must be there.
            start: The first wavelength written, nm. Default 400.
            end: The last wavelength written, nm, above start. Default 1100.
            format: "res", "csv" or "txt". A .res file has one layout, which
                the keywords below do not change. Default "res".
            files: "step", one file a step, or "table", one file a run with a
                column a step. Default "step".
            header: "layers", the .res header with its layer table;
                "conditions", the lines Measured Spectra's import reads back;
                or "none". Default "layers".
            delimiter: ",", ";", a tab or a space. Default ",".
            scale: "percent" or "fraction". Default "percent".
            decimals: The decimals of each value, a whole number from 0 to
                12. Default 5.
            decimal_mark: "." or ","; a comma takes a delimiter other than a
                comma. Default ".".

        Returns:
            The paths of the files written, in run order.

        Raises:
            TFStudioError: what process_steps() raises, an output option or
                value it does not take, a folder that is not there, or a side
                with no layers to deposit.

        Example::

            import tempfile
            design = tf.new_design("AR")
            design.stack("H L")
            print(design.export_process(tempfile.mkdtemp(), 400, 800, step=1))
        """
        refuse_arguments("export_process", options, ("from", "to"), _EXPORT_OPTIONS)
        with worded(_EXPORT_WORDS):
            return self._calls.exportProcess(self._data, folder, dict(run_options(options), **api_names({"from": start, "to": end})))

    def monitor_worksheet(self, **options):
        """Whether each layer of one side can be stopped on an optical
        monitor, as the Monitor Worksheet window works it out: the layers
        deposited from the substrate out on witness chips, each chip a short
        coating of its own from bare chip glass, read in air, each layer
        witness_ratio times its thickness on the part. Each row gives the
        signal at its chip's wavelength when the layer is cut, the turning
        points in it, the swing there is to stop on and the thickness a
        signal error of the monitor's own size costs, flagged past
        max_termination_err_pct of the layer. Every layer is a row, an empty
        one included. The chip plan is process_steps()'s chips:
        process_steps() given the same chips gives the Process Exporter's
        spectra of these chips, and needs them given, {} for 3 layers to a
        chip, as without chips it runs on the part. A plan given here does
        not reach the window or the Report. The design's cone of incidence is
        not used.

        Args:
            side: "front" or "back", the side deposited. Default: the front,
                or the back of a design coated on the back alone; the window
                has the front alone.
            quantity: "T" or "R", what the monitor reads. Default "T".
            angle: The angle of incidence on the chip, degrees in air, 0 up to
                but not including 90. Default 0.
            pol: "avg", "s" or "p". Default "avg".
            chips: The chip plan, a dict of layers_per_chip, plan, glass and
                witness_ratio, each optional: plan a chip number for each
                layer of the side from the substrate out, empty layers
                included, in place of layers_per_chip layers to a chip (3
                without either); glass the chip glass by id, the substrate
                without it; witness_ratio the witness thickness over the
                part's, from 0.05 to 10, 1 without it.
            wavelengths: The monitor wavelengths, nm: "auto", the window's
                Auto button, each chip at the reference wavelength or one of
                25 from 0.7 to 1.3 times it, whichever its worst layer stops
                most closely at, to the whole nm; a number, every chip there,
                as Set all does; or a list of one for each layer of the side
                from the substrate out, empty layers included, a chip read at
                the one given for its first layer. Default: every chip at the
                design's reference wavelength.
            signal_error_pct: The monitor's signal error, % of the reading,
                from 0.001 to 50. Default 0.3.
            noise_floor_pct: The monitor's noise floor, % of full scale, from
                0 to 10. Default 0.1.
            max_termination_err_pct: The termination error a layer is flagged
                past, % of its thickness, from 0.01 to 100. Default 1.

        Returns:
            A MonitorWorksheet, a named tuple: mode, the side deposited; rows,
            one WorksheetRow per layer in deposition order; chips, one
            WorksheetChip per chip in the order it enters the run, its chip,
            its wavelength in nm, its bare reading initial_level and the
            steps on it; and run_length, the run's optical thickness on the
            witnesses in quarter waves at the reference wavelength, the length
            of the window's chart. A WorksheetRow holds step from 1; layer its
            Design Editor number from 1 next to the substrate, the same as
            step; chip its chip number and on_chip its place on that chip
            from 1; material by id; wavelength the chip's, nm; thickness the
            witness's, nm; signal the reading when the layer is cut, a
            fraction of 1 (the window shows %); turning_points how many lie
            inside the layer; amplitude the swing from the reading the cut is taken
            against, the last turning point at or before the cut on the chip
            or else the chip's bare reading, to the next turning point, None
            with none after the cut; swing_in and swing_out the swing from
            that reading to the layer's start and to the cut, fractions of 1;
            cutoff_ratio swing_out over amplitude, or None; termination_error
            the thickness a signal error of the monitor's own size leaves, nm,
            None for a layer cut on time and inf where the signal has no slope
            or turn to read; crystal the part's thickness, nm, which a quartz
            monitor runs to (the window shows kÅ); initial_level the chip's
            bare reading on its first layer, None on the others; poor True
            when the layer has no turning point after its cut or its
            termination error is past the budget; strategy "turning", "level"
            or "time", how the layer is cut; curve a WorksheetCurve of
            thickness and signal, the reading against the layer's own
            thickness on the chip, nm, from 0 to 1.35 quarter waves of the
            layer past the cut, beyond the next turning point where there is
            one.

        Raises:
            TFStudioError: an option it does not take or a value an option
                cannot take, a chip plan or a list of wavelengths whose length
                is not the side's layer count, a chip glass that resolves to
                nothing, a design that names a material that resolves to
                nothing, or a material with no refractive index at the
                reference wavelength or at a chip's wavelength, named by id.

        Example::

            design = tf.new_design("AR")
            design.stack("H L H L")
            sheet = design.monitor_worksheet(chips={"layers_per_chip": 2}, wavelengths="auto")
            for r in sheet.rows:
                error = r.termination_error
                print("step", r.step, "chip", r.chip, "at", r.wavelength, "nm: error", error if error is None else round(error, 2), "nm", "flagged" if r.poor else "")
        """
        with worded(_WORKSHEET_WORDS):
            return monitor_worksheet_of(self._calls.monitorWorksheet(self._data, run_options(options)))

    def import_zemax_coating(self, path, coating=None, wavelength=550, side=None):
        """Puts the layers of a COAT record of a Zemax OpticStudio
        COATING.DAT file on one side of the design, as the Zemax Coatings
        window's Import to front coating puts them on the front: a relative
        thickness converted at wavelength with the index the file gives. A
        COAT lists its layers from the incident medium, so on the back they
        go in reversed. The side's layers are replaced; the media and the
        substrate stay the design's. Each layer's material takes the id an
        import in the app gives it, in the catalog of the file, and the design
        carries its definition, so it computes and saves with it: nothing is
        written to a catalog. On a computer where the app imported the file
        before, the ids are that catalog's and the materials it holds are
        used, edits included; otherwise each import draws a new random part
        of the catalog id, as a first import does.

        Args:
            path: The file. A relative path is taken as tf.open_design()
                takes it.
            coating: The COAT record, by its name or its place among the
                file's coatings from 0. Default: the first stack of layers.
            wavelength: The wavelength, nm, at which a thickness the file
                gives in waves is converted to nm. Default 550.
            side: "front" or "back". Default: the front, or the back of a
                design coated on the back alone.

        Returns:
            The layers left out, each with why: a material the file does not
            define, or a relative thickness whose material it gives no index
            for.

        Raises:
            TFStudioError: a file that cannot be read or holds neither a MATE
                record nor a coating, a coating the file does not hold or one
                that is not a stack of layers, one none of whose layers
                converts, a side the Design Editor does not let you edit, or
                a value an argument cannot take.

        Example::

            import time

            name = "COATING-{}.DAT".format(time.time_ns())
            with open(name, "w") as f:
                f.write("MATE TIO2\\n0.4 2.35 0\\n0.8 2.25 0\\nMATE SIO2\\n0.4 1.47 0\\n0.8 1.45 0\\nCOAT AR\\nTIO2 0.25 0\\nSIO2 0.25 0\\n")
            design = tf.new_design("AR")
            print(design.import_zemax_coating(name))
            for layer in design.layers:
                print(layer.material, round(layer.thickness, 2), "nm")
        """
        with worded(Words("importZemaxCoating", "import_zemax_coating")):
            imported = self._calls.importZemaxCoating(self._data, path, api_names({"coating": coating, "wavelength": wavelength, "side": side}))
        self._data = imported["design"]
        return imported["warnings"]

    def import_codev_coating(self, path, side=None):
        """Puts the layers of a CODE V coating file, a .seq or a .mul, on one
        side of the design, as the CODE V Coatings window's Import to front
        coating and Import to back coating put them: physical thickness in
        nm, a layer of code 100 locked. The file lists its layers from the
        incident medium, so on the back they go in reversed. The side's
        layers are replaced; the media and the substrate stay the design's,
        and the file's INC and SUB are not taken. The materials are carried
        in the design under the ids an import in the app gives them, as
        import_zemax_coating() carries them.

        Args:
            path: The file; a name ending in .mul is read as a saved .mul, any
                other as commands. A relative path is taken as
                tf.open_design() takes it.
            side: "front" or "back". Default: the front, or the back of a
                design coated on the back alone.

        Returns:
            What the reader and the conversion noted, as tf.read_codev_coating()
            and the window's report give it.

        Raises:
            TFStudioError: a file that cannot be read, or that does not enter
                a stack the reader can read, a side the Design Editor does not
                let you edit, or a value an argument cannot take.

        Example::

            import time

            name = "ar-{}.seq".format(time.time_ns())
            with open(name, "w") as f:
                f.write("MUL\\nMDA\\nPHT Y\\nTIT 'AR'\\nWLG 400 700 50\\nREF 550\\nCOA 99.6 100 1.38\\nCOA 59.8 0 2.3\\nSUB 1.52\\nEND\\nMEX\\n")
            design = tf.new_design("AR")
            print(design.import_codev_coating(name))
            for layer in design.layers:
                print(layer.material, layer.thickness, "nm", "locked" if layer.locked else "")
        """
        with worded(Words("importCodevCoating", "import_codev_coating")):
            imported = self._calls.importCodevCoating(self._data, path, api_names({"side": side}))
        self._data = imported["design"]
        return imported["warnings"]

    def inhomogeneities(self, **options):
        """The spectrum of the design with graded interlayers at its
        interfaces, against the design as it stands, as the Inhomogeneities
        window computes it: each interlayer is put in between the two
        materials that meet at its interface, adding its thickness to the
        coating, and is cut into slices of one index each, the share of the
        second material rising along its profile, n and k mixed in
        proportion. What it is computed on follows the design's sides and
        score_on, as a spectrum does, unless side is given, and a design
        under a cone of incidence is averaged over its cone, as the window
        averages it. A side with no layers has no interface, and gives its
        bare surface.

        Interface k of a side is the top of its layer k, numbered from the
        substrate as layers numbers them: 0 is the substrate's surface and N,
        on a side of N layers, the surface that meets the medium. A layer of
        0 nm keeps its number and its interfaces. On the front the grading
        runs from the material farther from the substrate to the nearer one,
        and on the back from the nearer to the farther, as the window grades
        them; a linear or sigmoid profile reads the same either way. When the
        design has a specification, specification is its verdict with the
        interlayers in, as the badge under the window's chart reads it.

        Args:
            interlayers: One dict per interlayer, with side, interface,
                thickness, profile and slices: side "front" or "back", the
                side computed, or the coated side on a whole part coated on
                one side, and given on each row of a whole part coated on
                both sides; interface from 0, the
                substrate's surface, to the side's layer count; thickness in
                nm, 0 or more, 5 when left out; profile "linear",
                "parabolic", "invParabolic", "exponential" or "sigmoid",
                "linear" when left out; slices a whole number, 2 or more, 10
                when left out. One row to an interface. Default: none.
            start: The first wavelength, nm. Default 400.
            end: The last wavelength, nm, above start. Default 800.
            step: The wavelength step, nm. Default 0.5.
            angle: The angle of incidence, degrees in the incident medium, 0
                up to but not including 90. Default 0.
            side: "front", "back" or "total", the whole part. Default: what
                the design is scored on.

        Returns:
            An Inhomogeneities.

        Raises:
            TFStudioError: an option it does not take, a range that is not
                one, an angle outside 0 to 90, a side it does not have, more
                than a million wavelengths, a row with a field it does not
                have, a row for a side not computed or with no side on a
                whole part coated on both sides, an interface the side does
                not have or one another row names, a thickness below 0, a
                profile it does not have, slices that are not a whole number
                of 2 or more, or a design that names a material that resolves
                to nothing.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            r = design.inhomogeneities(interlayers=[{"interface": 4, "thickness": 3, "profile": "sigmoid"}],
                                       start=450, end=650, step=1)
            print(" to ".join(r.interlayers[0].materials), "adds", r.added_thickness, "nm; R at 550 nm",
                  round(r.homogeneous.R.at(550), 5), "becomes", round(r.graded.R.at(550), 5))
        """
        return Inhomogeneities(self._read("inhomogeneities", "inhomogeneities", **options))

    def roughness(self, **options):
        """The specular R and T of the design with rough interfaces, against
        the smooth design, as the Roughness / Scattering window computes
        them: each rough interface becomes a transition layer 2σ thick, σ
        the rms roughness. Short range is a graded layer whose n and k run in
        a straight line from one material to the other, and loses no light;
        long range is one layer whose extinction coefficient stands for the
        light scattered out of the specular beams, derived for one surface at
        normal incidence, so at an angle, under a cone or in a multilayer it
        is an estimate. What it is computed on follows the design's sides and
        score_on, as a spectrum does, unless side is given, and a design
        under a cone of incidence is averaged over its cone, as the window
        averages it.

        Interface k of a side is the top of its layer k, numbered from the
        substrate as layers numbers them: 0 is the substrate's surface and N,
        on a side of N layers, the surface that meets the medium. The front
        keeps interface 0 with no layers; a back with no layers has none. A
        transition layer takes its thickness out of the layer beneath its
        interface, and the substrate is not thinned; a layer thinner than 2σ
        is set to 0 nm and listed in thinned. A layer of 0 nm is not in the
        coating: the σ set on its top is not used, and the layer beneath it
        meets the next layer there is, at the interface on top of the layer
        beneath.

        Args:
            sigma: The rms roughness of every interface, nm, 0 or more.
                Default 1.
            range: The kind of roughness of every interface, "short" or
                "long". Default "long".
            interfaces: The interfaces that differ from sigma and range, one
                dict each, with side, interface, sigma and range, as the
                per-interface editor sets them: side "front" or "back", the
                side computed, or the coated side on a whole part coated on
                one side, and given on each row of a whole part coated on
                both sides; interface from 0, the
                substrate's surface, to the side's layer count; sigma and
                range as above, the call's own when left out. One row to an
                interface. One rough interface alone is sigma=0 with that
                interface listed. Default: none.
            start: The first wavelength, nm. Default 400.
            end: The last wavelength, nm, above start. Default 800.
            step: The wavelength step, nm. Default 0.5.
            angle: The angle of incidence, degrees in the incident medium, 0
                up to but not including 90. Default 0.
            side: "front", "back" or "total", the whole part. Default: what
                the design is scored on.

        Returns:
            A Roughness.

        Raises:
            TFStudioError: an option it does not take, a range that is not
                one, an angle outside 0 to 90, a side it does not have, more
                than a million wavelengths, a sigma below 0 or a range other
                than "short" or "long", a row with a field it does not have,
                a row for a side not computed or with no side on a whole part
                coated on both sides, an interface the side does not have or
                one another row names, or a design that names a material that
                resolves to nothing.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            r = design.roughness(sigma=0, interfaces=[{"interface": 9, "sigma": 3}], start=400, end=700, step=1)
            print("R at 550 nm", round(r.smooth.R.at(550), 5), "becomes", round(r.rough.R.at(550), 5), "; loss",
                  round(r.loss.at(550) * 1e6, 1), "ppm")
        """
        return Roughness(self._read("roughness", "roughness", **options))

    def _read(self, call, method, **options):
        """What the API's call `call` reads of the design with `options`, for
        the method `method`, whose name its refusals then begin with."""
        with worded(Words(call, method)):
            return getattr(self._calls, call)(self._data, api_names(options))

    def _over_range(self, words, known, start, end, options):
        """What the API's call `words.call` reads of the design over the
        wavelengths `start` to `end` with `options`, the keywords of the
        method `words.method`, which takes `known`; the API's names for the
        range are refused among them."""
        refuse_arguments(words.method, options, ("from", "to"), known)
        with worded(words):
            return getattr(self._calls, words.call)(self._data, api_names({**options, "from": start, "to": end}))

    def refine(self, method="dls", **settings):
        """Refines the layer thicknesses against the merit function, as the
        Refinement window does; no layer is added or taken out. The design
        then holds the refined layers, or, when the run is stopped, the
        layers it had. The layers it moves follow the design's sides.

        Args:
            method: The method: an id from the API Reference's table of refine
                methods, such as "dls", "cg" or "de"; "all" for each of them
                in turn; or a list of ids tried one by one from the same
                start, keeping the best. The Refinement window opens with
                "sqp" until you pick another method in it. Default "dls".
            max_iter: The iterations a one-method run may take. Default: the
                method's own.
            n_restarts: The restarts of a multi-start method.
            perturb_pct: How far a multi-start method moves each thickness at
                a restart, %.
            seed: The number the random draws of a method that makes them
                start from, a whole number from 1 to 2^32 - 1; the same seed,
                design and settings repeat the run. Default: a fresh one,
                which the result reports.
            threads: The workers multi-start and parallel differential
                evolution use at once. Default 1.
            progress: A function called with a Progress each time the run
                reports. An exception it raises stops the run and goes on.
            stop: A tfstudio.Stop whose stop() ends the run.

        Returns:
            A RunResult.

        Raises:
            TFStudioError: a design with no merit function, a method or
                setting the run does not know, or a value it cannot take.
            KeyboardInterrupt: Ctrl+C during the run, after stopping it; the
                design keeps the layers it had.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            run = design.refine(method="dls", max_iter=50, progress=lambda p: print(p.iteration, p.merit))
            print(run.merit, run.stop_reason)
        """
        hooks = run_hooks(settings, lambda: self._calls.runHooks("refine"))
        return self._run("refine", dict(api_names(settings), method=method), hooks)

    def synthesize(self, method, pool, **settings):
        """Grows or restructures the design against its merit function with a
        synthesis method, inserting materials from a pool, as the method's
        window does. The design then holds the run's answer, or, when the run
        is stopped, the layers it had. Each method's settings, with their
        defaults, are in the API Reference under synthesize; a setting left
        out takes its default.

        Args:
            method: "needle", "ge" (Gradual Evolution) or "structural".
            pool: The materials the run may insert, by id, none twice.
            max_layers: The most layers the design may grow to.
            target_mf: The merit at which the run stops.
            refine_iter: The refinement steps after each insertion.
            threads: How many candidates are refined as one batch; the answer
                depends on it.
            seed: Structural: the number its random draws start from.
            d_min: Any other setting of the method, such as d_min.
            progress: A function called with a Progress each time the run
                reports. An exception it raises stops the run and goes on.
            stop: A tfstudio.Stop whose stop() ends the run.

        Returns:
            A RunResult.

        Raises:
            TFStudioError: a design with no merit function, a method or
                setting the run does not know, a value it cannot take, or a
                pool material id that resolves to nothing.
            KeyboardInterrupt: Ctrl+C during the run, after stopping it; the
                design keeps the layers it had.

        Example::

            design = tf.new_design("AR")
            design.layers.append("SiO2", 100)
            design.merit.add("RAV", 420, 680, target=0)
            run = design.synthesize("needle", pool=["TiO2", "SiO2"], max_layers=12)
            print(run.stop_reason, len(design.layers), "layers, merit", run.merit)
        """
        hooks = run_hooks(settings, lambda: self._calls.runHooks(method))
        return self._run("synthesize", {"method": method, "pool": pool, "settings": api_names(settings)}, hooks)

    def monte_carlo(self, start, end, **settings):
        """Monte Carlo trials of the design with random layer errors, as the
        Monte Carlo window runs them: the spread of one quantity over a range
        of wavelengths, computed on what the design's sides and score_on say.
        With the design's specification, the share of trials that meet it is
        counted too. The design is not changed.

        Args:
            start: The first wavelength, nm.
            end: The last wavelength, nm, above `start`.
            runs: How many trials. Default 100.
            step: The wavelength step, nm. Default 1.
            quantity: "R", "T" or "A". Default "R".
            angle: The angle of incidence, degrees in the incident medium.
                Default 0.
            polarization: "avg", "s" or "p". Default "avg".
            thickness_rel_pct: The thickness error, % of each layer. Default 1.
            thickness_abs_nm: A thickness error in nm added to every layer's.
                Default 0.
            index_re: The error on n, an absolute amount: one standard
                deviation with "gaussian", a bound with "uniform" and
                "truncated". Default 0.
            index_im: The error on k, an amount as index_re is on n; k does not
                go below 0. Default 0.
            distribution: "gaussian", "uniform" or "truncated" (a bound at
                three standard deviations). Default "gaussian".
            seed: The number the draws start from, a whole number from 1 to
                2^32 - 1; the same seed and settings repeat the run. Default:
                a fresh one, which the result reports.
            progress: A function called with a Progress (trial and total) as
                the trials go. An exception it raises stops the run and goes
                on.
            stop: A tfstudio.Stop whose stop() ends the run, which then
                answers with the trials it made.

        Returns:
            A MonteCarlo.

        Raises:
            TFStudioError: a design with no layer the trials can change on the
                side it is scored on, a setting it does not take, a value
                outside its range, or a design that names a material that
                resolves to nothing.
            KeyboardInterrupt: Ctrl+C during the run, after stopping it.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            mc = design.monte_carlo(400, 700, runs=50, step=5, thickness_rel_pct=2, seed=1)
            print("Largest spread of R:", max(mc.stdev))
        """
        refuse_arguments("monte_carlo", settings, ("from", "to"), _MONTE_CARLO_OPTIONS)
        hooks = run_hooks(settings, lambda: ["onProgress"])
        mode = mode_of(self._data)
        with worded(_MONTE_CARLO_WORDS):
            result = self._calls.monteCarlo(self._data, dict(api_names(settings), **{"from": start, "to": end}), hooks)
        return MonteCarlo(result, mode)

    def layer_sensitivity(self, *, step="nm", delta_nm=1, rel_pct=1, include_locked=False):
        """How much the merit moves when each layer's thickness is off, as
        the Layer Sensitivity window ranks the layers: each layer is made
        thicker and thinner by a step, and the mean change of the merit is
        its score. The merit here leaves out the MNT and MXT rows.

        Args:
            step: How the step is given: "nm", delta_nm for every layer, or
                "percent", rel_pct % of each layer. Default "nm".
            delta_nm: The step, nm, with step "nm". Default 1.
            rel_pct: The step, % of each layer, with step "percent". Default 1.
            include_locked: True scores the locked layers too. Default False.

        Returns:
            A LayerSensitivity.

        Raises:
            TFStudioError: a design with no merit function, a step other
                than "nm" or "percent", or a value a setting cannot take.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            for row in design.layer_sensitivity(delta_nm=2).rows:
                print(row.side, row.number, row.material, row.sensitivity)
        """
        options = {"mode": _named(STEPS, "step", step), "deltaNm": delta_nm, "relPct": rel_pct,
                   "includeLocked": include_locked}
        front_count = len(self._data.get("frontLayers") or [])
        with worded(Words("layerSensitivity", "layer_sensitivity")):
            ranked = self._calls.layerSensitivity(self._data, options)
        return LayerSensitivity(ranked, front_count, mode_of(self._data))

    def copy(self):
        """A copy of the design, which changes apart from it.

        Returns:
            A Design.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            before = design.copy()
            design.refine(method="dls", max_iter=20)
            print("Merit", before.merit.value, "before,", design.merit.value, "after")
        """
        return Design(self._calls, copy.deepcopy(self._data), self._app)

    def save(self, path, *, overwrite=False):
        """Writes the design to a .tfs file as TFStudio saves it, with the
        materials it uses that are not built in carried inside the file.

        Args:
            path: The file to write. A relative path is taken from the
                program's working folder: in the Script Console, the script's
                folder, or the data folder for a script not saved.
            overwrite: True writes over a file that is there. Default False.

        Raises:
            TFStudioError: a file that is there, without overwrite=True.

        Example::

            import time

            name = "mirror-{}.tfs".format(time.time_ns())
            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            design.save(name)
            print("Saved", name)
        """
        with worded(Words("saveDesign", "save")):
            self._calls.saveDesign(self._data, path, {"overwrite": overwrite})

    def push(self):
        """Writes the design over the one it was read from in the TFStudio
        app, as one step the app can undo. Only a design from
        tf.app.open_design() has one; push again after more changes.

        Raises:
            TFStudioError: a design that was not read from the app.
            AppError: the app refused: with code "edited" when its design
                changed since it was read or last pushed, "switched" when it
                is no longer the open one, "off" when the app is closed or
                not listening for this program.

        Example::

            import tfstudio

            with tfstudio.TFStudio(live=True) as tf:
                design = tf.app.open_design()
                design.layers[1].thickness += 5
                design.push()
                print("Pushed", design.name)
        """
        if self._app is None:
            raise TFStudioError("push: this design was not read from the TFStudio app, so there is no design there "
                                "to write it over; tf.app.open_design() reads one")
        app_design_id, revision = self._app
        options = {"appDesignId": app_design_id, "revision": revision, "design": self._data}
        with worded(Words("app.apply", "push")):
            answer = self._calls.app("apply", options)
        self._data = answer["design"]
        self._app = (answer["appDesignId"], answer["revision"])

    def _setup(self, **options):
        with worded(_SETUP_WORDS):
            self._data = self._calls.setDesignSetup(self._data, options)

    def _run(self, call, request, hooks):
        """Makes the run `call` and returns how it ended. The design then
        holds the run's answer, unless the run was stopped, which leaves it
        as it was: a stopped Deep Synthesis run answers with its best design
        so far."""
        mode = mode_of(self._data)
        with worded(Words(call, call, extra=("progress", "stop"))):
            answer =getattr(self._calls, call)(self._data, request, hooks)
        if answer["result"].get("stopReason") != "stopped":
            self._data = answer["design"]
        return RunResult(answer["result"], mode)

    def __repr__(self):
        return "<Design {!r} on {}: {} front layers, {} back layers, sides {}>".format(
            self.name, self.substrate.material, len(self.layers), len(self.back_layers), self.sides)
