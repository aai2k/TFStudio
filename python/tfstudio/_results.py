"""What computations answer with: a spectrum and its curves, a run's result
and its progress, a Monte Carlo run and a layer sensitivity ranking."""

import csv

from ._errors import TFStudioError

# The quantities of a spectrum: R, T and A for unpolarized light, then for s
# and p, as the API's spectrum gives them.
QUANTITIES = ("R", "T", "A", "Rs", "Rp", "Ts", "Tp", "As", "Ap")


def _reading(name, doc):
    """A read-only attribute giving self._values[name], documented as `doc`."""
    return property(lambda self: self._values[name], doc=doc)


class Curve(list):
    """One value per wavelength: a list of floats, so ``max(curve)``,
    ``sum(curve)`` and plotting libraries take it as they take any list.

    mean(), min() and max() summarize it over a band of wavelengths, and
    ``wavelength`` holds the wavelength of each value, nm.

    Example::

        design = tf.new_design("Mirror")
        design.stack("(HL)^4 H")
        s = design.spectrum(400, 700)
        print(max(s.R), s.R.mean(450, 650))
    """

    def __init__(self, values, wavelength):
        super().__init__(values)
        self._wavelength = wavelength

    @property
    def wavelength(self):
        """The wavelength of each value, nm.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            s = design.spectrum(400, 700, step=50)
            print(s.R.wavelength)
        """
        return self._wavelength

    def mean(self, start=None, end=None):
        """The mean of the values whose wavelength is from `start` to `end`,
        both included.

        Args:
            start: The first wavelength of the band, nm. Default: the curve's first.
            end: The last wavelength of the band, nm. Default: the curve's last.

        Returns:
            The mean; NaN when a value in the band is NaN.

        Raises:
            TFStudioError: a band no wavelength of the curve is in.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            s = design.spectrum(400, 700)
            print("Mean R from 450 to 650 nm:", s.R.mean(450, 650))
        """
        values = self._band("mean", start, end)
        total = 0.0
        for value in values:
            total += value
        return total / len(values)

    def min(self, start=None, end=None):
        """The lowest value whose wavelength is from `start` to `end`, both
        included, NaN values left out.

        Args:
            start: The first wavelength of the band, nm. Default: the curve's first.
            end: The last wavelength of the band, nm. Default: the curve's last.

        Returns:
            The lowest value; inf when every value in the band is NaN.

        Raises:
            TFStudioError: a band no wavelength of the curve is in.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            s = design.spectrum(400, 700)
            print("Lowest T from 450 to 650 nm:", s.T.min(450, 650))
        """
        lowest = float("inf")
        for value in self._band("min", start, end):
            if value < lowest:
                lowest = value
        return lowest

    def max(self, start=None, end=None):
        """The highest value whose wavelength is from `start` to `end`, both
        included, NaN values left out.

        Args:
            start: The first wavelength of the band, nm. Default: the curve's first.
            end: The last wavelength of the band, nm. Default: the curve's last.

        Returns:
            The highest value; -inf when every value in the band is NaN.

        Raises:
            TFStudioError: a band no wavelength of the curve is in.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            s = design.spectrum(400, 700)
            print("Highest R from 450 to 650 nm:", s.R.max(450, 650))
        """
        highest = float("-inf")
        for value in self._band("max", start, end):
            if value > highest:
                highest = value
        return highest

    def _band(self, what, start, end):
        values = [value for wavelength, value in zip(self.wavelength, self)
                  if (start is None or wavelength >= start) and (end is None or wavelength <= end)]
        if not values:
            raise TFStudioError("{}: no wavelength of this curve is from {} to {} nm"
                                .format(what, self.wavelength[0] if start is None else start,
                                        self.wavelength[-1] if end is None else end))
        return values


def _quantity(name, doc):
    """The curve `name` at the first angle, a read-only attribute documented as `doc`."""
    return property(lambda self: self._curves[0][name], doc=doc)


class Spectrum:
    """R, T and A of a design over a range of wavelengths, at one angle of
    incidence or several, as design.spectrum() computes them. ``s.R`` and
    the other quantities are at the first angle asked; ``s.angle(45)`` is the
    spectrum at another.

    Example::

        design = tf.new_design("Mirror")
        design.stack("(HL)^4 H")
        s = design.spectrum(400, 800, step=1, angles=[0, 45])
        print(s.mode, max(s.R), min(s.angle(45).Tp))
    """

    def __init__(self, mode, wavelength, angles, series, out_of_range):
        self._values = {"mode": mode, "wavelength": wavelength, "angles": angles, "out_of_range": out_of_range}
        self._series = series
        self._curves = [{name: Curve(values[name], wavelength) for name in QUANTITIES} for values in series]

    mode = _reading("mode", """What the spectrum was computed on, as the design's sides and score_on
        say: "front" or "back", the coated side alone, or "total", the whole part.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(design.spectrum(400, 700).mode)
        """)
    wavelength = _reading("wavelength", """The wavelengths, nm.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(design.spectrum(400, 700, step=50).wavelength)
        """)
    angles = _reading("angles", """The angles of incidence, degrees in the incident medium, in the order
        they were asked.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            s = design.spectrum(400, 700, angles=[0, 45])
            for a in s.angles:
                print(a, max(s.angle(a).R))
        """)
    out_of_range = _reading("out_of_range", """The materials whose data stop inside the range, a list
        of dicts { id, name, rangeNm, heldFlat }: outside rangeNm, [first, last] in nm, their n and k
        are held at the last value (heldFlat True) or extrapolated. Empty when every material covers
        the range.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            s = design.spectrum(200, 2500, step=10)
            for m in s.out_of_range:
                print(m["id"], "has data from", m["rangeNm"])
            print(len(s.out_of_range), "materials stop inside the range")
        """)
    R = _quantity("R", """Reflectance for unpolarized light at the first angle, a Curve of fractions
        of 1, one per wavelength.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(max(design.spectrum(400, 700).R))
        """)
    T = _quantity("T", """Transmittance for unpolarized light at the first angle, a Curve of
        fractions of 1, one per wavelength.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(min(design.spectrum(400, 700).T))
        """)
    A = _quantity("A", """Absorptance for unpolarized light at the first angle, a Curve of fractions
        of 1, one per wavelength.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(max(design.spectrum(400, 700).A))
        """)
    Rs = _quantity("Rs", """Reflectance for s-polarized light at the first angle, a Curve of fractions
        of 1, one per wavelength.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(max(design.spectrum(400, 700, angles=[45]).Rs))
        """)
    Rp = _quantity("Rp", """Reflectance for p-polarized light at the first angle, a Curve of fractions
        of 1, one per wavelength.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(max(design.spectrum(400, 700, angles=[45]).Rp))
        """)
    Ts = _quantity("Ts", """Transmittance for s-polarized light at the first angle, a Curve of
        fractions of 1, one per wavelength.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(min(design.spectrum(400, 700, angles=[45]).Ts))
        """)
    Tp = _quantity("Tp", """Transmittance for p-polarized light at the first angle, a Curve of
        fractions of 1, one per wavelength.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(min(design.spectrum(400, 700, angles=[45]).Tp))
        """)
    As = _quantity("As", """Absorptance for s-polarized light at the first angle, a Curve of fractions
        of 1, one per wavelength.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(max(design.spectrum(400, 700, angles=[45]).As))
        """)
    Ap = _quantity("Ap", """Absorptance for p-polarized light at the first angle, a Curve of fractions
        of 1, one per wavelength.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(max(design.spectrum(400, 700, angles=[45]).Ap))
        """)

    def angle(self, angle):
        """The spectrum at one of the angles it was computed at.

        Args:
            angle: The angle of incidence, degrees in the incident medium.

        Returns:
            A Spectrum of that angle alone.

        Raises:
            TFStudioError: an angle the spectrum was not computed at.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            s = design.spectrum(400, 700, angles=[0, 45])
            print(min(s.angle(45).Tp))
        """
        for i, computed in enumerate(self.angles):
            if computed == angle:
                return Spectrum(self.mode, self.wavelength, [computed], [self._series[i]], self.out_of_range)
        raise TFStudioError("angle: the spectrum was computed at {}, not at {}".format(self.angles, angle))

    def save_csv(self, path):
        """Writes the spectrum to a CSV file: a column of wavelengths, then
        R, T, A, Rs, Rp, Ts, Tp, As and Ap at each angle, as fractions of 1,
        each headed with its quantity and angle. A file that is there is
        written over.

        Args:
            path: The file to write. A relative path is taken from the
                program's working folder: in the Script Console, the script's
                folder, or the data folder for a script not saved.

        Example::

            import time

            name = "spectrum-{}.csv".format(time.time_ns())
            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            design.spectrum(400, 700, step=10, angles=[0, 45]).save_csv(name)
            print("Wrote", name)
        """
        with open(path, "w", newline="", encoding="utf-8") as file:
            writer = csv.writer(file)
            writer.writerow(["Wavelength (nm)"] + ["{} at {:g} deg".format(name, angle)
                                                   for angle in self.angles for name in QUANTITIES])
            for i, wavelength in enumerate(self.wavelength):
                writer.writerow([wavelength] + [curves[name][i] for curves in self._curves for name in QUANTITIES])

    def __repr__(self):
        return "<Spectrum {} to {} nm, {} points, angles {}, {}>".format(
            self.wavelength[0], self.wavelength[-1], len(self.wavelength), self.angles, self.mode)


class Progress:
    """What a run has reported so far, given to the function passed as
    ``progress`` each time the run reports. An attribute the run has not
    reported, or does not report, is None.

    Example::

        design = tf.new_design("AR")
        design.stack("(HL)^2")
        design.merit.add("RAV", 450, 650, target=0)
        design.refine(method="dls", max_iter=5, progress=lambda p: print(p.iteration, p.merit))
    """

    def __init__(self, reported):
        self._values = reported

    merit = property(lambda self: self._values.get("mf"), doc="""The merit the run reports now: of the
        layers it is on (refinement), or of the design it goes on from (synthesis).

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            design.refine(max_iter=5, progress=lambda p: print(p.merit))
        """)
    best_merit = property(lambda self: self._values.get("mfBest"), doc="""The best merit so far, where the
        run reports one.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            design.refine(max_iter=5, progress=lambda p: print(p.best_merit))
        """)
    optical_merit = property(lambda self: self._values.get("omf"), doc="""The merit without the
        manufacturing rows MNT, MXT, TT and STR, where the run reports it.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            design.merit.add("MNT", target=10)
            design.refine(max_iter=5, progress=lambda p: print(p.merit, p.optical_merit))
        """)
    iteration = property(lambda self: self._values.get("iter"), doc="""The iteration under way:
        refinement, and Structural synthesis.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            design.refine(max_iter=5, progress=lambda p: print(p.iteration))
        """)
    generation = property(lambda self: self._values.get("genNum"), doc="""The last generation the run
        accepted: Needle, Gradual Evolution and Structural synthesis.

        Example::

            design = tf.new_design("AR")
            design.layers.append("SiO2", 100)
            design.merit.add("RAV", 420, 680, target=0)
            design.synthesize("needle", pool=["TiO2", "SiO2"], max_layers=8,
                              progress=lambda p: print(p.generation, p.layer_count))
        """)
    layer_count = property(lambda self: self._values.get("layerCount"), doc="""The layers of the design
        the run goes on from: synthesis.

        Example::

            design = tf.new_design("AR")
            design.layers.append("SiO2", 100)
            design.merit.add("RAV", 420, 680, target=0)
            design.synthesize("needle", pool=["TiO2", "SiO2"], max_layers=8, progress=lambda p: print(p.layer_count))
        """)
    method = property(lambda self: self._values.get("method"), doc="""The refinement method under way, such
        as "dls", for a refinement that tries several.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            design.refine(method=["dls", "cg"], progress=lambda p: print(p.method))
        """)
    seed = property(lambda self: self._values.get("seed"), doc="""The seed the run's random draws start
        from, once the run has started; None for a run that draws none.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            design.refine(method="sa", max_iter=5, progress=lambda p: print(p.seed))
        """)
    trial = property(lambda self: self._values.get("trial"), doc="""The trials made so far: Monte Carlo.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.monte_carlo(400, 700, step=10, runs=20, progress=lambda p: print(p.trial, "of", p.total))
        """)
    total = property(lambda self: self._values.get("total"), doc="""The trials the run makes: Monte Carlo.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.monte_carlo(400, 700, step=10, runs=20, progress=lambda p: print(p.trial / p.total))
        """)
    activity = property(lambda self: self._values.get("activity"), doc="""What a synthesis is doing, a
        dict such as {"id": "scanning"}, or None.

        Example::

            design = tf.new_design("AR")
            design.layers.append("SiO2", 100)
            design.merit.add("RAV", 420, 680, target=0)
            design.synthesize("needle", pool=["TiO2", "SiO2"], max_layers=8, progress=lambda p: print(p.activity))
        """)

    @property
    def reported(self):
        """Everything the run has reported so far, by name, such as design,
        the layers the run is on.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            design.refine(max_iter=5, progress=lambda p: print(", ".join(sorted(p.reported))))
        """
        return self._values


class RunResult:
    """How a refinement or a synthesis ended. The run has already left its
    answer in the design it was made on: the new layers when it finished, the
    layers as they were when it was stopped.

    Example::

        design = tf.new_design("AR")
        design.stack("(HL)^2")
        design.merit.add("RAV", 450, 650, target=0)
        run = design.refine(method="dls", max_iter=20)
        print(run.merit, run.stop_reason)
    """

    def __init__(self, result, mode):
        self._result = result
        self._values = {
            "completed": result.get("completed"), "stop_reason": result.get("stopReason"),
            "merit": result.get("mf"), "optical_merit": result.get("omf"), "initial_merit": result.get("mfInitial"),
            "iterations": result.get("iter", result.get("iters")), "seed": result.get("seed"), "mode": mode,
        }

    completed = _reading("completed", """True when the run ended on its own, False when it was stopped
        or could not run.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            run = design.refine(max_iter=20)
            print("ended on its own" if run.completed else "ended: " + run.stop_reason)
        """)
    stop_reason = _reading("stop_reason", """Why the run ended: such as "target", "maxiter", "stalled" or
        "stopped" for a refinement, "maxLayers" or "needleOptimal" for Needle. The API Reference lists
        them under refine and synthesize.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            print(design.refine(max_iter=20).stop_reason)
        """)
    merit = _reading("merit", """The merit at the end, as the run's window shows it, or None when the
        run has no answer.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            print(design.refine(max_iter=20).merit)
        """)
    optical_merit = _reading("optical_merit", """The merit at the end without the manufacturing rows MNT,
        MXT, TT and STR, or None where the run does not report it.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            design.merit.add("MNT", target=10)
            run = design.refine(max_iter=20)
            print(run.merit, run.optical_merit)
        """)
    initial_merit = _reading("initial_merit", """The merit at the start: refinement; None otherwise.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            run = design.refine(max_iter=20)
            print(run.initial_merit, "->", run.merit)
        """)
    iterations = _reading("iterations", """The iterations a refinement took, or the generations a
        Structural synthesis ran; None for the other runs.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            print(design.refine(max_iter=20).iterations)
        """)
    seed = _reading("seed", """The seed the run's random draws started from: the same seed, design and
        settings repeat the run. None for a run that draws none.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            before = design.copy()
            run = design.refine(method="sa", max_iter=20)
            again = before.refine(method="sa", max_iter=20, seed=run.seed)
            print(run.seed, run.merit == again.merit)
        """)
    mode = _reading("mode", """What the run scored: "front" or "back", the coated side alone, or
        "total", the whole part, as the design's sides and score_on said.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            design.score_on = "whole part"
            print(design.refine(max_iter=20).mode)
        """)

    @property
    def reported(self):
        """Everything the run answered, by name, such as geSteps, the forced
        steps of a Gradual Evolution run, or reheats, the restarts of a
        Structural deep search.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            run = design.refine(max_iter=20)
            print(", ".join(run.reported))
        """
        return self._result

    def __repr__(self):
        return "<RunResult {}: merit {}>".format(self.stop_reason, self.merit)


def _monte_carlo_curve(name, doc):
    return property(lambda self: self._curves[name], doc=doc)


class MonteCarlo:
    """Monte Carlo trials of a design with random layer errors, as
    design.monte_carlo() runs them: the spread of one quantity over a range
    of wavelengths. Each spread is a Curve of fractions of 1.

    Example::

        design = tf.new_design("AR")
        design.stack("(HL)^2")
        mc = design.monte_carlo(400, 700, step=10, runs=20, seed=1)
        print(mc.runs, "trials, largest spread:", max(mc.stdev))
    """

    def __init__(self, result, mode):
        wavelength = list(result["lambda"])
        self._curves = {name: Curve(result[key], wavelength) for name, key in (
            ("theory", "theory"), ("mean", "mean"), ("stdev", "stdev"), ("lower", "lower"), ("upper", "upper"),
            ("lowest", "envLower"), ("highest", "envUpper"))}
        self._values = {"wavelength": wavelength, "runs": result["nTrials"], "quantity": result["char"],
                        "seed": result["seed"], "spec": result.get("spec"), "mode": mode}

    wavelength = _reading("wavelength", """The wavelengths, nm.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            print(design.monte_carlo(400, 700, step=50, runs=5).wavelength)
        """)
    theory = _monte_carlo_curve("theory", """The quantity for the design without errors, a Curve.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            print(max(design.monte_carlo(400, 700, step=10, runs=5).theory))
        """)
    mean = _monte_carlo_curve("mean", """The mean over the trials, a Curve.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            print(design.monte_carlo(400, 700, step=10, runs=5).mean.mean(450, 650))
        """)
    stdev = _monte_carlo_curve("stdev", """The standard deviation over the trials, a Curve.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            print(max(design.monte_carlo(400, 700, step=10, runs=5).stdev))
        """)
    lower = _monte_carlo_curve("lower", """The mean less one standard deviation, 0 at the least, a Curve.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            print(min(design.monte_carlo(400, 700, step=10, runs=5).lower))
        """)
    upper = _monte_carlo_curve("upper", """The mean plus one standard deviation, 1 at the most, a Curve.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            print(max(design.monte_carlo(400, 700, step=10, runs=5).upper))
        """)
    lowest = _monte_carlo_curve("lowest", """The lowest value over the trials, a Curve.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            print(min(design.monte_carlo(400, 700, step=10, runs=5).lowest))
        """)
    highest = _monte_carlo_curve("highest", """The highest value over the trials, a Curve.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            print(max(design.monte_carlo(400, 700, step=10, runs=5).highest))
        """)
    runs = _reading("runs", """The trials made: as many as asked, or fewer when the run was stopped.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            print(design.monte_carlo(400, 700, step=10, runs=5).runs)
        """)
    quantity = _reading("quantity", """The quantity, "R", "T" or "A".

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            print(design.monte_carlo(400, 700, step=10, runs=5, quantity="T").quantity)
        """)
    seed = _reading("seed", """The seed the draws started from: the same seed and settings repeat the run.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            print(design.monte_carlo(400, 700, step=10, runs=5).seed)
        """)
    spec = _reading("spec", """With the design's specification, the share of trials that meet it: a
        dict { yield, passCount, evaluated, yieldInterval }, yieldInterval the 95 % interval of the
        share; None for a design without one.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            mc = design.monte_carlo(400, 700, step=10, runs=5)
            print("yield {}".format(mc.spec["yield"]) if mc.spec else "no specification")
        """)
    mode = _reading("mode", """What the trials scored: "front" or "back", the coated side alone, or
        "total", the whole part, as the design's sides and score_on said.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            print(design.monte_carlo(400, 700, step=10, runs=5).mode)
        """)

    def __repr__(self):
        return "<MonteCarlo {} trials of {}, seed {}>".format(self.runs, self.quantity, self.seed)


class SensitivityRow:
    """One layer of a layer sensitivity ranking.

    Example::

        design = tf.new_design("AR")
        design.stack("(HL)^2")
        design.merit.add("RAV", 450, 650, target=0)
        for row in design.layer_sensitivity().rows:
            print(row.side, row.number, row.material, row.sensitivity)
    """

    def __init__(self, row, front_count):
        number = front_count - row["layerIndex"] if row["side"] == "front" else row["layerIndex"] + 1
        self._values = {"side": row["side"], "number": number, "material": row["materialId"],
                        "thickness": row["thickness"], "step": row["deltaNm"], "merit_change": row["deltaMFAbs"],
                        "signed_merit_change": row["deltaMF"], "sensitivity": row["sensitivity"],
                        "locked": row["locked"]}

    side = _reading("side", """The layer's side, "front" or "back".

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            print(design.layer_sensitivity().rows[0].side)
        """)
    number = _reading("number", """The layer's number on its side, 1 next to the substrate, as
        design.layers and design.back_layers number it.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            row = design.layer_sensitivity().rows[0]
            print(row.number, design.layers[row.number].material)
        """)
    material = _reading("material", """The layer's material, by id.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            print(design.layer_sensitivity().rows[0].material)
        """)
    thickness = _reading("thickness", """The layer's thickness, nm.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            print(design.layer_sensitivity().rows[0].thickness)
        """)
    step = _reading("step", """The thickness step the layer was made thicker and thinner by, nm.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            print(design.layer_sensitivity(step="percent", rel_pct=2).rows[0].step)
        """)
    merit_change = _reading("merit_change", """The mean change of the merit over the two steps.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            print(design.layer_sensitivity().rows[0].merit_change)
        """)
    signed_merit_change = _reading("signed_merit_change", """The same change, positive when the thicker
        layer costs more and negative when the thinner one does.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            row = design.layer_sensitivity().rows[0]
            print("thicker costs more" if row.signed_merit_change > 0 else "thinner costs more")
        """)
    sensitivity = _reading("sensitivity", """The layer's score as a share of the highest, 0 to 100.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            print(design.layer_sensitivity().rows[0].sensitivity)
        """)
    locked = _reading("locked", """True for a locked layer.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            design.layers[1].locked = True
            for row in design.layer_sensitivity(include_locked=True).rows:
                print(row.number, row.locked)
        """)

    def __repr__(self):
        return "<SensitivityRow {} {} {}: {}>".format(self.side, self.number, self.material, self.sensitivity)


class LayerSensitivity:
    """How much the merit moves when each layer's thickness is off, as
    design.layer_sensitivity() ranks the layers.

    Example::

        design = tf.new_design("AR")
        design.stack("(HL)^2")
        design.merit.add("RAV", 450, 650, target=0)
        ls = design.layer_sensitivity()
        worst = max(ls.rows, key=lambda row: row.sensitivity)
        print("most sensitive: layer", worst.number, worst.material)
    """

    def __init__(self, result, front_count, mode):
        self._values = {"rows": [SensitivityRow(row, front_count) for row in result["rows"]],
                        "merit": result["mf0"], "mode": mode}

    rows = _reading("rows", """One SensitivityRow per layer scored, the front's first.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            for row in design.layer_sensitivity().rows:
                print(row.number, row.sensitivity)
        """)
    merit = _reading("merit", """The merit of the design as it is, without the MNT and MXT rows.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            print(design.layer_sensitivity().merit)
        """)
    mode = _reading("mode", """What was scored: "front" or "back", the coated side alone, or "total",
        the whole part, as the design's sides and score_on said.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            print(design.layer_sensitivity().mode)
        """)

    def __repr__(self):
        return "<LayerSensitivity of {} layers>".format(len(self.rows))
