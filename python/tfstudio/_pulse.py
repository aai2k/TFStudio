"""A pulse's passage through a design, as design.pulse() answers."""

import collections
import math

from ._csv import write_rows
from ._names import python_name

PulseMetrics = collections.namedtuple(
    "PulseMetrics", "flp_fwhm input_fwhm output_fwhm output_rms peak_vs_flp transform_limited_ratio energy_ratio delay "
                    "residual_gdd residual_tod input_bandwidth output_bandwidth time_bandwidth")
TimeCurve = collections.namedtuple("TimeCurve", "t intensity")
PulseTime = collections.namedtuple("PulseTime", "flp input output")
SpectrumCurve = collections.namedtuple("SpectrumCurve", "wavelength values")
PulseSpectrum = collections.namedtuple("PulseSpectrum", "input output coating_gdd compensating_gdd band")

# The window's Results table (pulseAnalysis/viewModel.js resultsTable, and the
# English pulseAnalysis and units): its headings, then each row's quantity,
# metric, unit and whether it is shown in percent. The input's FWHM is listed
# only when the input is chirped.
_HEADINGS = ["Quantity", "Value", "Unit"]
_INPUT_ROW = ("FWHM, chirped input", "input_fwhm", "fs", False)
_ROWS = (("FWHM, Fourier-limited pulse", "flp_fwhm", "fs", False), _INPUT_ROW,
         ("FWHM, output", "output_fwhm", "fs", False), ("RMS width, output", "output_rms", "fs", False),
         ("Peak, against the Fourier-limited pulse", "peak_vs_flp", "%", True),
         ("Peak, against the output's own transform limit", "transform_limited_ratio", "%", True),
         ("Energy out", "energy_ratio", "%", True), ("Delay", "delay", "fs", False),
         ("Residual GDD", "residual_gdd", "fs²", False), ("Residual TOD", "residual_tod", "fs³", False),
         ("Spectral FWHM, input", "input_bandwidth", "nm", False), ("Spectral FWHM, output", "output_bandwidth", "nm", False),
         ("Time-bandwidth product, output", "time_bandwidth", "", False))
# NaN and the infinities as the window's export writes them, JavaScript's way.
_NOT_FINITE = {"nan": "NaN", "inf": "Infinity", "-inf": "-Infinity"}


def _reading(name, doc):
    """A read-only attribute giving self._values[name], documented as `doc`."""
    return property(lambda self: self._values[name], doc=doc)


def _number(value):
    """A number as the window's export writes it."""
    return value if value is None or math.isfinite(value) else _NOT_FINITE[str(value)]


def _spectrum_curve(curve):
    return SpectrumCurve(curve["wavelength"], curve["values"])


def _time_of(time):
    return PulseTime(*(TimeCurve(time[name]["t"], time[name]["intensity"]) for name in PulseTime._fields))


def _spectrum_of(spectrum):
    curves = [_spectrum_curve(spectrum[name]) for name in ("input", "output", "coatingGdd", "compensatingGdd")]
    return PulseSpectrum(*curves, spectrum["band"])


class Pulse:
    """A pulse's passage through a design, in time and in its spectrum, as
    design.pulse() computes it and the Pulse Analysis window shows it: its
    metrics, the window's Results table, and its curves.

    Example::

        design = tf.new_design("Mirror")
        design.stack("(HL)^8 H")
        p = design.pulse(centre=550, duration=20)
        print(p.mode, "output FWHM", round(p.metrics.output_fwhm, 2), "fs, delay", round(p.metrics.delay, 2), "fs")
    """

    def __init__(self, result):
        self._values = {
            "mode": result["mode"], "response": result["response"], "pol": result["pol"], "angle": result["angle"],
            "passes": result["passes"], "source": result["source"], "centre": result["centre"],
            "converged": result["converged"], "chirped": result["chirped"],
            "metrics": PulseMetrics(**{python_name(key): value for key, value in result["metrics"].items()}),
            "time": _time_of(result["time"]), "spectrum": _spectrum_of(result["spectrum"]),
            "echo_delay": result["echoDelay"], "out_of_range": result["outOfRange"],
        }

    mode = _reading("mode", """The sides computed: "front" or "back", one coated side, or "total",
        the whole part in transmission.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print(design.pulse(centre=550).mode, design.pulse(centre=550, response="T", side="total").mode)
        """)
    response = _reading("response", """The pulse taken: "R", the reflected one, or "T", the
        transmitted one.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print(design.pulse(centre=550, response="T").response)
        """)
    pol = _reading("pol", """The polarization: "avg", "s" or "p".

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print(design.pulse(centre=550, angle=45, pol="p").pol)
        """)
    angle = _reading("angle", """The angle of incidence, degrees in the medium light comes from.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print(design.pulse(centre=550, angle=30).angle, "degrees")
        """)
    passes = _reading("passes", """The bounces off the coating, or passes through it.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print(design.pulse(centre=550, passes=4).passes, "bounces")
        """)
    source = _reading("source", """Where the spectrum comes from: "model", the shape, or "design",
        the spectrum the design holds.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print(design.pulse(centre=550).source)
        """)
    centre = _reading("centre", """The centre wavelength, nm: the one given, 800 nm, or with the
        design's spectrum its centroid.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print(design.pulse().centre, "nm")
        """)
    converged = _reading("converged", """False when the time window reached its largest size before
        the output fitted inside it, so part of the output may wrap round from one end to the other
        and the curves and metrics are not reliable; True otherwise.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print(design.pulse(centre=550).converged)
        """)
    chirped = _reading("chirped", """Whether the input's own chirp changes its shape anywhere by more
        than 1e-4 of the Fourier-limited peak; the window's table lists the input's FWHM only then.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print(design.pulse(centre=550).chirped, design.pulse(centre=550, gdd=50).chirped)
        """)
    metrics = _reading("metrics", """The window's Results table, a PulseMetrics named tuple:
        flp_fwhm, input_fwhm and output_fwhm, the intensity FWHM of the Fourier-limited pulse, the
        input and the output, fs; output_rms, the output's RMS width, fs; peak_vs_flp, the output's
        peak over the Fourier-limited pulse's, and transform_limited_ratio, over the peak the
        output's own spectrum would reach with a flat phase, fractions of 1; energy_ratio, the
        energy out over the energy in; delay, the output's delay after the input, fs; residual_gdd
        and residual_tod, the output's GDD, fs², and TOD, fs³, averaged over its spectrum;
        input_bandwidth and output_bandwidth, the spectral intensity FWHM, nm; time_bandwidth, the
        output's time-bandwidth product.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            m = design.pulse(centre=550, duration=20).metrics
            print("FLP", round(m.flp_fwhm, 2), "fs, out", round(m.output_fwhm, 2), "fs, residual GDD", round(m.residual_gdd, 2), "fs²")
        """)
    time = _reading("time", """The time curves, a PulseTime named tuple of flp, input and output,
        each a TimeCurve of t, fs, and intensity, on the scale where the Fourier-limited pulse
        peaks at 1. They hold the transform's samples from the first to the last above 1e-4 of
        that peak, and past 4000 samples the lowest and highest of each run in turn, so each curve
        has its own t. The output is at its absolute delay; the window's Delay removed view moves
        it back by metrics.delay.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            output = design.pulse(centre=550).time.output
            print(len(output.t), "samples, peak", round(max(output.intensity), 4))
        """)
    spectrum = _reading("spectrum", """The spectrum curves, a PulseSpectrum named tuple, each curve a
        SpectrumCurve of wavelength, nm rising, and values: input and output, the spectral
        intensity on the scale where the input peaks at 1; coating_gdd, the response's GDD times the
        passes, fs², the mean of s and p with pol="avg"; compensating_gdd, the GDD that undoes the
        input's own chirp, fs². They hold the transform's samples where the input is above 1e-3 of
        its peak, or a fresh evaluation at least 600 points across that band when the transform has
        fewer. Past 4000 samples each keeps the lowest and highest of each run of its own values in
        turn, so each curve then has its own wavelengths. band is [low, high], nm, the band they
        cover.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            s = design.pulse(centre=550).spectrum
            print("from", round(s.band[0], 1), "to", round(s.band[1], 1), "nm,", len(s.coating_gdd.wavelength), "points")
        """)
    echo_delay = _reading("echo_delay", """On the whole part, the time from this pulse to the first
        echo reflected inside the substrate, fs, the substrate's group delay there and back at the
        centre wavelength; None on one side.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print(round(design.pulse(centre=550, response="T", side="total").echo_delay), "fs")
        """)
    out_of_range = _reading("out_of_range", """The materials of the sides computed whose data stop
        inside the spectrum's band, a list of dicts with id, name, rangeNm and heldFlat: outside
        rangeNm their n and k are held at the last value (heldFlat True) or extrapolated. Empty
        when every material covers it.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            print([m["id"] for m in design.pulse(centre=550).out_of_range])
        """)

    def save_csv(self, path):
        """Writes the metrics to a CSV file as the window's Copy CSV writes
        its Results table: Quantity, Value and Unit, a row for each metric in
        the window's words, the peaks and the energy in percent, and the
        input's FWHM only when the input is chirped. The numbers are the
        window's, written in Python's float notation. A file that is there
        is written over.

        Args:
            path: The file to write. A relative path is taken from the
                program's working folder: in the Script Console, the script's
                folder, or the data folder for a script not saved.

        Example::

            import time

            name = "pulse-{}.csv".format(time.time_ns())
            design = tf.new_design("Mirror")
            design.stack("(HL)^8 H")
            design.pulse(centre=550).save_csv(name)
            print("Wrote", name)
        """
        metrics = self.metrics._asdict()
        rows = [row for row in _ROWS if row is not _INPUT_ROW or self.chirped]
        write_rows(path, [_HEADINGS] + [[quantity, _number(100 * metrics[name] if percent else metrics[name]), unit]
                                        for quantity, name, unit, percent in rows])

    def __repr__(self):
        values = self._values
        passes = values["passes"]
        return "<Pulse {} {} {} at {} degrees, centre {} nm, {} pass{}>".format(
            values["mode"], values["response"], values["pol"], values["angle"], values["centre"], passes,
            "" if passes == 1 else "es")
