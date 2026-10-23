"""What computations answer with: a spectrum and its curves, a curve over
angle of incidence, a run's result and its progress, a Monte Carlo run and
the yield of trials against a specification, the verdict on a specification,
a layer sensitivity ranking, and what a cleanup did."""

import bisect
import collections
import csv
import math

from ._errors import TFStudioError

# The quantities of a spectrum: R, T and A for unpolarized light, then for s
# and p, as the API's spectrum gives them.
QUANTITIES = ("R", "T", "A", "Rs", "Rp", "Ts", "Tp", "As", "Ap")
# The quantities an optical density is read from, and the T below which a
# density reads as 15, the floor of the merit's logarithmic rows
# (LOG_READING_FLOOR in the app).
_TRANSMITTANCES = ("T", "Ts", "Tp")
_DENSITY_FLOOR = 1e-15


def _log10(value):
    """log10 as JavaScript's Math.log10 reads it: -inf at 0 and NaN below
    it, where math.log10 raises."""
    if not value >= 0:
        return float("nan")
    return math.log10(value) if value > 0 else float("-inf")


def _ratio(high, low):
    """high / low as JavaScript divides, inf or NaN where Python raises."""
    if low == 0:
        return float("nan") if high == 0 else math.copysign(float("inf"), high) * math.copysign(1, low)
    return high / low


def _js_number(value):
    """A number as JavaScript's String() writes it: a whole number without a
    decimal point."""
    return str(int(value)) if float(value).is_integer() else repr(float(value))


def _reading(name, doc):
    """A read-only attribute giving self._values[name], documented as `doc`."""
    return property(lambda self: self._values[name], doc=doc)


def _mean(values):
    """The mean of `values`; NaN when one of them is NaN."""
    total = 0.0
    for value in values:
        total += value
    return total / len(values)


def _lowest(values):
    """The lowest of `values`, NaN left out; inf when every one is NaN."""
    lowest = float("inf")
    for value in values:
        if value < lowest:
            lowest = value
    return lowest


def _highest(values):
    """The highest of `values`, NaN left out; -inf when every one is NaN."""
    highest = float("-inf")
    for value in values:
        if value > highest:
            highest = value
    return highest


class _CurveOverX(list):
    """One value per x, with what the mean(), min() and max() of a curve
    share. A curve holds its x in _x, and its class names that x and its unit
    in _AXIS, and in _quantity the spectrum's quantity it holds, such as "T",
    or None."""

    def __init__(self, values, xs):
        super().__init__(values)
        self._x = xs
        self._quantity = None

    def _over(self, reduce, what, start, end):
        """`reduce` of the values whose x is from `start` to `end`, both
        included, for the method `what`; a band no x is in is refused."""
        values = [value for x, value in zip(self._x, self) if (start is None or x >= start) and (end is None or x <= end)]
        if not values:
            raise TFStudioError("{}: no {} of this curve is from {} to {} {}".format(
                what, self._AXIS[0], self._x[0] if start is None else start, self._x[-1] if end is None else end,
                self._AXIS[1]))
        return reduce(values)


class Curve(_CurveOverX):
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

    _AXIS = ("wavelength", "nm")

    @property
    def wavelength(self):
        """The wavelength of each value, nm.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            s = design.spectrum(400, 700, step=50)
            print(s.R.wavelength)
        """
        return self._x

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
        return self._over(_mean, "mean", start, end)

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
        return self._over(_lowest, "min", start, end)

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
        return self._over(_highest, "max", start, end)

    def ripple(self, start=None, end=None, unit="fraction"):
        """The ripple over a band: the highest value whose wavelength is
        from `start` to `end`, both included, less the lowest, NaN values
        left out, so max(start, end) - min(start, end); with unit="dB", the
        ratio of the two in decibels, 10·log10(max/min), for a curve of
        values above 0.

        Args:
            start: The first wavelength of the band, nm. Default: the curve's first.
            end: The last wavelength of the band, nm. Default: the curve's last.
            unit: "fraction", the difference in the curve's own unit, a
                fraction of 1 for R, T and A; or "dB". Default "fraction".

        Returns:
            The ripple; NaN when every value in the band is NaN.

        Raises:
            TFStudioError: a band no wavelength of the curve is in, or a unit
                it does not have.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            s = design.spectrum(400, 800)
            print("T ripple from 650 to 750 nm:", s.T.ripple(650, 750), "or", s.T.ripple(650, 750, unit="dB"), "dB")
        """
        if unit not in ("fraction", "dB"):
            raise TFStudioError("ripple: unit is 'fraction' or 'dB', not {!r}".format(unit))
        lowest, highest = self._over(lambda values: (_lowest(values), _highest(values)), "ripple", start, end)
        if lowest > highest:
            return float("nan")
        return 10 * _log10(_ratio(highest, lowest)) if unit == "dB" else highest - lowest

    def at(self, wavelength):
        """The value at a wavelength, read off the straight line between the
        two samples either side of it, as the plot draws the curve; at a
        sample, that sample's value.

        Args:
            wavelength: The wavelength, nm, from the curve's first to its last.

        Returns:
            The value; NaN when a sample it is read from is NaN.

        Raises:
            TFStudioError: a wavelength outside the curve, or one that is not a number.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            s = design.spectrum(400, 700, step=5)
            print("R at 532.1 nm:", s.R.at(532.1))
        """
        xs = self._x
        number = isinstance(wavelength, (int, float)) and not isinstance(wavelength, bool)
        if not number or not xs[0] <= wavelength <= xs[-1]:
            raise TFStudioError("at: the curve is from {} to {} nm, not at {}".format(
                xs[0], xs[-1], wavelength if number else repr(wavelength)))
        high = min(bisect.bisect_right(xs, wavelength), len(xs) - 1)
        low = high - 1 if high > 0 else 0
        if xs[low] == wavelength:
            return self[low]
        if xs[high] == wavelength:
            return self[high]
        return self[low] + (self[high] - self[low]) * (wavelength - xs[low]) / (xs[high] - xs[low])

    def density(self):
        """The optical density at each wavelength, −log10 T, a Curve, as the
        ODMN merit row reads it: a T below 1e-15 reads as a density of 15. A
        spectrum's T, Ts and Tp have one; other curves do not.

        Returns:
            A Curve of densities over the same wavelengths.

        Raises:
            TFStudioError: a curve that is not a spectrum's T, Ts or Tp.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            s = design.spectrum(400, 700)
            print("Highest optical density from 500 to 600 nm:", s.T.density().max(500, 600))
        """
        if self._quantity not in _TRANSMITTANCES:
            raise TFStudioError("density: optical density is read from a spectrum's T, Ts or Tp, not from {}".format(
                self._quantity or "this curve"))
        return Curve([-_log10(max(value, _DENSITY_FLOOR)) for value in self], self._x)


class AngleCurve(_CurveOverX):
    """One value per angle of incidence: a list of floats, so ``max(curve)``,
    ``sum(curve)`` and plotting libraries take it as they take any list.

    mean(), min() and max() summarize it over a range of angles, and
    ``angle`` holds the angle of each value, degrees in the medium light
    comes from.

    Example::

        design = tf.new_design("Mirror")
        design.stack("(HL)^3 H")
        e = design.ellipsometry_vs_angle(633, 45, 80)
        print(min(e.psi), e.psi.mean(60, 70))
    """

    _AXIS = ("angle", "degrees")
    angle = property(lambda self: self._x, doc="""The angle of incidence of each value, degrees.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            e = design.ellipsometry_vs_angle(633, 45, 80, step=5)
            print(e.psi.angle)
        """)

    def mean(self, start=None, end=None):
        """The mean of the values whose angle is from `start` to `end`, both
        included.

        Args:
            start: The first angle of the range, degrees. Default: the curve's first.
            end: The last angle of the range, degrees. Default: the curve's last.

        Returns:
            The mean; NaN when a value in the range is NaN.

        Raises:
            TFStudioError: a range no angle of the curve is in.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            e = design.ellipsometry_vs_angle(633, 45, 80)
            print("Mean Psi from 60 to 70 degrees:", e.psi.mean(60, 70))
        """
        return self._over(_mean, "mean", start, end)

    def min(self, start=None, end=None):
        """The lowest value whose angle is from `start` to `end`, both
        included, NaN values left out.

        Args:
            start: The first angle of the range, degrees. Default: the curve's first.
            end: The last angle of the range, degrees. Default: the curve's last.

        Returns:
            The lowest value; inf when every value in the range is NaN.

        Raises:
            TFStudioError: a range no angle of the curve is in.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            e = design.ellipsometry_vs_angle(633, 45, 80)
            print("Lowest Psi from 60 to 70 degrees:", e.psi.min(60, 70))
        """
        return self._over(_lowest, "min", start, end)

    def max(self, start=None, end=None):
        """The highest value whose angle is from `start` to `end`, both
        included, NaN values left out.

        Args:
            start: The first angle of the range, degrees. Default: the curve's first.
            end: The last angle of the range, degrees. Default: the curve's last.

        Returns:
            The highest value; -inf when every value in the range is NaN.

        Raises:
            TFStudioError: a range no angle of the curve is in.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^3 H")
            e = design.ellipsometry_vs_angle(633, 45, 80)
            print("Highest Delta from 60 to 70 degrees:", e.delta.max(60, 70))
        """
        return self._over(_highest, "max", start, end)


def _quantity(name, doc):
    """The curve `name` at the first angle, a read-only attribute documented as `doc`."""
    return property(lambda self: self._curves[0][name], doc=doc)


def _spectrum_curve(values, wavelength, quantity):
    """`values` as a Curve over `wavelength` holding the spectrum's quantity `quantity`."""
    curve = Curve(values, wavelength)
    curve._quantity = quantity
    return curve


def _condition_lines(name, angles, mode):
    """The conditions of a spectrum as Measured Spectra's export writes them
    on # lines (spectrumConditionLines in the app): the design's name, the
    angle when there is one and the side light comes in on, and the
    polarization, which the columns name."""
    side = "back" if mode == "back" else "front"
    conditions = "AOI {} deg, {} side".format(_js_number(angles[0]), side) if len(angles) == 1 else "{} side".format(side)
    return ["# {}".format(name or "design"), "# " + conditions, "# Polarization: per column"]


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
        self._name = None
        self._series = series
        self._curves = [{quantity: _spectrum_curve(values[quantity], wavelength, quantity) for quantity in QUANTITIES}
                        for values in series]

    def _named(self, name):
        """The spectrum with the name of the design it was computed on,
        which its CSV file gives."""
        self._name = name
        return self

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
                return Spectrum(self.mode, self.wavelength, [computed], [self._series[i]], self.out_of_range)._named(self._name)
        raise TFStudioError("angle: the spectrum was computed at {}, not at {}".format(self.angles, angle))

    def save_csv(self, path):
        """Writes the spectrum to a CSV file: the conditions on # lines as
        Measured Spectra's export writes them, which its import reads back
        (the design's name; the angle of incidence when the spectrum has one
        angle, and the side light comes in on, the back for a design scored
        on its back alone and the front otherwise; and "Polarization: per
        column"), then a column of wavelengths and R, T, A, Rs, Rp, Ts, Tp, As
        and Ap at each angle, as fractions of 1, each headed with its quantity
        and angle. A file that is there is written over.

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
            file.write("".join(line + "\r\n" for line in _condition_lines(self._name, self.angles, self.mode)))
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
        spec = result.get("spec")
        self._values = {"wavelength": wavelength, "runs": result["nTrials"], "quantity": result["char"],
                        "seed": result["seed"], "spec": Yield(dict(spec, seed=result["seed"], mode=mode)) if spec else None,
                        "mode": mode}

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
    spec = _reading("spec", """With the design's specification, the share of the trials that meet it, a
        Yield, as specification.estimate_yield() counts it; None for a design without one.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
            mc = design.monte_carlo(400, 700, step=10, runs=20, seed=1)
            print("yield", mc.spec.value, "of", mc.spec.runs, "trials")
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


# A check of a Yield: its label and the share of the trials it failed in.
YieldCheck = collections.namedtuple("YieldCheck", "label fail_rate")


class Yield:
    """The yield of Monte Carlo trials with random layer errors against a
    design's specification, as the Monte Carlo window counts it: the share of
    the trials that meet every enabled check, each check read at its own Step.

    Example::

        design = tf.new_design("Mirror")
        design.stack("(HL)^5 H")
        design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
        y = design.specification.estimate_yield(50, thickness_rel_pct=2, seed=1)
        print("yield", y.value, "from", y.interval[0], "to", y.interval[1])
    """

    def __init__(self, result):
        self._values = {"value": result.get("yield"), "pass_count": result["passCount"], "evaluated": result["evaluated"],
                        "interval": result.get("yieldInterval"),
                        "checks": [YieldCheck(check["label"], check["failRate"]) for check in result["perQualifier"]],
                        "runs": result["nTrials"], "seed": result["seed"], "mode": result["mode"]}

    value = _reading("value", """The yield: the share of the trials checked that met every enabled check,
        0 to 1; None when no trial was checked.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
            print(design.specification.estimate_yield(20, seed=1).value)
        """)
    pass_count = _reading("pass_count", """How many trials met every enabled check.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
            y = design.specification.estimate_yield(20, seed=1)
            print(y.pass_count, "of", y.evaluated)
        """)
    evaluated = _reading("evaluated", """How many trials were checked: those run, less any whose checks could
        not be evaluated.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
            print(design.specification.estimate_yield(20, seed=1).evaluated)
        """)
    interval = _reading("interval", """The 95 % interval of the yield, [low, high], 0 to 1; None when no
        trial was checked.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
            low, high = design.specification.estimate_yield(20, seed=1).interval
            print(low, high)
        """)
    checks = _reading("checks", """One named tuple (label, fail_rate) per check of the specification, in
        its order: the check's label, or its kind when it has none, and the share of all the trials
        run in which it failed. A check left out of the verdict fails in none.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
            design.specification.add("R_AT", 550, cmp="ge", target=0.99)
            y = design.specification.estimate_yield(20, thickness_rel_pct=2, seed=1)
            for check in y.checks:
                print(check.label, check.fail_rate)
        """)
    runs = _reading("runs", """The trials run: as many as asked, or fewer when the run was stopped.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
            print(design.specification.estimate_yield(20, seed=1).runs)
        """)
    seed = _reading("seed", """The seed the draws started from: the same seed, design and settings repeat
        the trials.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
            y = design.specification.estimate_yield(20)
            again = design.specification.estimate_yield(20, seed=y.seed)
            print(y.seed, y.value == again.value)
        """)
    mode = _reading("mode", """What the trials scored: "front" or "back", the coated side alone, or
        "total", the whole part, as the design's sides and score_on said.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.97)
            print(design.specification.estimate_yield(20, seed=1).mode)
        """)

    def __repr__(self):
        return "<Yield {} ({} of {} checked), seed {}>".format(self.value, self.pass_count, self.evaluated, self.seed)


# The comparison a CheckResult's value is held to, as its check holds it.
Threshold = collections.namedtuple("Threshold", "cmp target tol lo hi")


class CheckResult:
    """One check of a design's specification as specification.check() judged
    it, as the Specification window shows its row.

    Example::

        design = tf.new_design("Mirror")
        design.stack("(HL)^5 H")
        design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
        for row in design.specification.check().rows:
            print(row.kind, row.value, row.passed, row.margin)
    """

    def __init__(self, row):
        held = row["threshold"]
        self._values = dict(row, threshold=Threshold(*(held.get(field) for field in Threshold._fields)))

    kind = _reading("kind", """The check's kind, such as "R_AVG".

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
            print(design.specification.check().rows[0].kind)
        """)
    label = _reading("label", """The check's label, "" when it has none.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9, label="Stop band")
            print(design.specification.check().rows[0].label)
        """)
    value = _reading("value", """The check's value: T, R and A as fractions of 1, wavelengths, widths and
        thicknesses in nm, PPEF in dB, a layer count as a count; None when there is none, as for a
        check left out of the verdict.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
            print(design.specification.check().rows[0].value)
        """)
    unit = _reading("unit", """The value's unit: "fraction", "nm" or "dB", or "" for a layer count and for
        a check left out of the verdict.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("THICKNESS_BUDGET", cmp="le", target=2000)
            row = design.specification.check().rows[0]
            print(row.value, row.unit)
        """)
    passed = _reading("passed", """Whether the value meets the threshold, as the window marks it: False when
        there is no value, None for a check left out of the verdict.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("LAYER_COUNT", cmp="le", target=9)
            print(design.specification.check().rows[0].passed)
        """)
    margin = _reading("margin", """How far the value is from the nearest bound, in its unit: positive by the
        room left, negative by how far it is out, so passed is True exactly when it is 0 or more;
        None when there is no value. A bound lies half the last digit the window shows past the
        stated one, so a value the window shows on its bound passes: 0.000005 for a fraction,
        0.005 nm, 0.0005 dB, nothing for a layer count.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AT", 550, cmp="between", lo=0.95, hi=1)
            print(design.specification.check().rows[0].margin)
        """)
    threshold = _reading("threshold", """The comparison the value is held to, as the check holds it: a named
        tuple (cmp, target, tol, lo, hi).

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AT", 550, cmp="eq", target=0.98, tol=0.01)
            held = design.specification.check().rows[0].threshold
            print(held.cmp, held.target, held.tol)
        """)
    reason = _reading("reason", """Why there is no value, or None: "disabled", a check left out of the
        verdict; "notComputable", a value that came out as no number; "noCurve", a PPEF check whose
        curve the design does not hold; "fwhmNotBracketed" or "edgeNotCrossed", a width or an edge
        whose crossing is not inside the band; "unknownKind".

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9, enabled=False)
            print(design.specification.check().rows[0].reason)
        """)

    def __repr__(self):
        # A disabled check is not judged.
        if self.passed is None:
            return "<CheckResult {}: disabled>".format(self.kind)
        value = "{} {}".format(self.value, self.unit) if self.unit else str(self.value)
        return "<CheckResult {}: {}, {}>".format(self.kind, value, "passed" if self.passed else "not passed")


class SpecReport:
    """A design judged against its specification, as specification.check()
    judges it and the Specification window shows it: a CheckResult per check.

    Example::

        design = tf.new_design("Mirror")
        design.stack("(HL)^5 H")
        design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
        design.specification.add("LAYER_COUNT", cmp="le", target=9)
        report = design.specification.check()
        print(report.passing, "of", report.total, "checks pass")
    """

    def __init__(self, verdict):
        self._values = {"rows": [CheckResult(row) for row in verdict["rows"]], "passed": verdict["passed"],
                        "passing": verdict["passing"], "total": verdict["total"], "mode": verdict["mode"]}

    rows = _reading("rows", """One CheckResult per check, in the specification's order.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
            for row in design.specification.check().rows:
                print(row.kind, row.passed)
        """)
    passed = _reading("passed", """True when every enabled check passes and there is one at least.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
            print(design.specification.check().passed)
        """)
    passing = _reading("passing", """How many enabled checks pass.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
            design.specification.add("LAYER_COUNT", cmp="le", target=9)
            print(design.specification.check().passing)
        """)
    total = _reading("total", """How many checks are enabled.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
            design.specification.add("LAYER_COUNT", cmp="le", target=9, enabled=False)
            print(design.specification.check().total)
        """)
    mode = _reading("mode", """What the checks were computed on: "front" or "back", the coated side alone,
        or "total", the whole part, as the design's sides and score_on said.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^5 H")
            design.specification.add("R_AVG", 520, 580, cmp="ge", target=0.9)
            design.score_on = "whole part"
            print(design.specification.check().mode)
        """)

    def __repr__(self):
        return "<SpecReport {} of {} checks pass>".format(self.passing, self.total)


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


# An operation of a CleanReport: what the cleanup did to one layer.
CleanOperation = collections.namedtuple("CleanOperation", "side kind number material thickness merged_into")


class CleanReport:
    """What design.clean() did to the design, as the Design Cleaner window
    lists its operations: the layers it took out and those it merged into a
    neighbour.

    Example::

        design = tf.new_design("Stack with a thin layer")
        design.stack("(HL)^2 0.03H L")
        report = design.clean()
        print(report.removed, "taken out,", report.merged, "merged")
    """

    def __init__(self, cleaned):
        operations = [CleanOperation(op["side"], op["kind"], op["number"], op["material"], op["thickness"], op["mergedInto"])
                      for op in cleaned["operations"]]
        self._values = {"removed": cleaned["removed"], "merged": cleaned["merged"], "operations": operations}

    removed = _reading("removed", """How many layers were taken out.

        Example::

            design = tf.new_design("Stack with a thin layer")
            design.stack("(HL)^2 0.03H L")
            print(design.clean().removed)
        """)
    merged = _reading("merged", """How many layers were merged into a neighbour.

        Example::

            design = tf.new_design("Stack with a thin layer")
            design.stack("(HL)^2 0.03H L")
            print(design.clean().merged)
        """)
    operations = _reading("operations", """One named tuple (side, kind, number, material, thickness,
        merged_into) per operation, in the order they were made, the front's first. kind is
        "remove" or "merge"; number the layer's number on its side before the cleanup, 1 next to
        the substrate, as design.layers and design.back_layers numbered it then; material its
        material, by id; thickness, nm, for a layer taken out its thickness then, which counts
        any layer merged into it before, and for a merge what it adds to the layer it is merged
        into; merged_into, for a merge, the number of that layer, numbered as number is, and None
        for a layer taken out.

        Example::

            design = tf.new_design("Stack with a thin layer")
            design.stack("(HL)^2 0.03H L")
            for op in design.clean().operations:
                print(op.kind, op.side, op.number, op.material, op.thickness, op.merged_into)
        """)

    def __repr__(self):
        return "<CleanReport {} taken out, {} merged>".format(self.removed, self.merged)
