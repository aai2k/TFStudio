"""A design and its parts: the substrate, the layers of each side, and the
computations made on it."""

import copy
import numbers

from ._errors import TFStudioError
from ._merit import Merit
from ._names import api_names
from ._refusals import Words, worded
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
        return Spectrum(answer["evalMode"], answer["lambda"], angles, series, answer["outOfRange"])

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

    def _read(self, call, method, **options):
        """What the API's call `call` reads of the design with `options`, for
        the method `method`, whose name its refusals then begin with."""
        with worded(Words(call, method)):
            return getattr(self._calls, call)(self._data, api_names(options))

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
