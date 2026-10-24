"""A spectrum written as JCAMP-DX, as Measured Spectra's Export tab writes a
design spectrum (designExportDocument and buildJcampDx in the app), byte for
byte."""

import decimal
import math

# The spectra the export writes at each angle, in its order: T, R and A for
# unpolarized light, then T and R for s and for p, by the spectrum's names.
_SPECTRA = (("", (("T", "T"), ("R", "R"), ("A", "A"))),
            (" s", (("T", "Ts"), ("R", "Rs"))),
            (" p", (("T", "Tp"), ("R", "Rp"))))
_Y_UNITS = {"T": "TRANSMITTANCE", "R": "REFLECTANCE", "A": "ABSORPTANCE"}


def _to_fixed(value, places):
    """`value` rounded to `places` decimals as JavaScript's toFixed rounds
    it: to the nearer, and a tie away from 0."""
    return float(decimal.Decimal(value).quantize(decimal.Decimal(1).scaleb(-places), rounding=decimal.ROUND_HALF_UP))


def _js_string(value):
    """A finite number as JavaScript's String() writes it."""
    if value == 0:
        return "0"
    _sign, digits, exponent = decimal.Decimal(repr(abs(value))).as_tuple()
    digits = "".join(map(str, digits))
    stripped = digits.rstrip("0")
    exponent += len(digits) - len(stripped)
    digits, point = stripped, exponent + len(stripped)
    sign = "-" if value < 0 else ""
    if len(digits) <= point <= 21:
        return sign + digits + "0" * (point - len(digits))
    if 0 < point <= 21:
        return sign + digits[:point] + "." + digits[point:]
    if -6 < point <= 0:
        return sign + "0." + "0" * -point + digits
    power = point - 1
    return "{}{}{}e{}{}".format(sign, digits[0], "." + digits[1:] if len(digits) > 1 else "", "+" if power > 0 else "-", abs(power))


def _number(value):
    """A number as the writer writes it: to 12 decimals, then as JavaScript writes that."""
    return _js_string(_to_fixed(value, 12)) if math.isfinite(value) else "0"


def _uniform(x):
    if len(x) < 3:
        return True
    step = x[1] - x[0]
    if not abs(step) > 0:
        return False
    return all(abs((x[i] - x[i - 1]) - step) <= abs(step) * 1e-4 for i in range(2, len(x)))


def _data_lines(x, y):
    """The data of one block: an abscissa and six ordinates a line on a uniform
    grid, four x,y pairs a line otherwise."""
    n = len(x)
    if _uniform(x):
        step = (x[-1] - x[0]) / (n - 1) if n > 1 else 1
        rows = [" ".join([_number(x[0] + i * step)] + [_number(v) for v in y[i:i + 6]]) for i in range(0, n, 6)]
        return ["##DELTAX=" + _number(step), "##XYDATA=(X++(Y..Y))"] + rows
    pairs = ["{},{}".format(_number(a), _number(b)) for a, b in zip(x, y)]
    return ["##XYPOINTS=(XY..XY)"] + [" ".join(pairs[i:i + 4]) for i in range(0, n, 4)]


def _block(title, quantity, x, y):
    lines = ["##TITLE=" + title, "##JCAMP-DX=4.24", "##DATA TYPE=UV/VIS SPECTRUM", "##XUNITS=NANOMETERS",
             "##YUNITS=" + _Y_UNITS[quantity], "##XFACTOR=1.0", "##YFACTOR=1.0",
             "##FIRSTX=" + _number(x[0]), "##LASTX=" + _number(x[-1]), "##FIRSTY=" + _number(y[0]),
             "##NPOINTS={}".format(len(x))]
    return "\r\n".join(lines + _data_lines(x, y))


def _angle_label(angle):
    return str(int(angle)) if float(angle).is_integer() else "{:.1f}".format(_to_fixed(angle, 1))


def design_spectrum_jcamp(name, wavelength, angles, series):
    """The JCAMP-DX text of a spectrum of the design named `name`, at
    `angles`, `series` holding each angle's quantities."""
    base = name or "design"
    blocks = []
    for angle, values in zip(angles, series):
        suffix = " @{}°".format(_angle_label(angle)) if len(angles) > 1 else ""
        for label, quantities in _SPECTRA:
            for quantity, key in quantities:
                title = "{} {}{}{}".format(base, quantity, label, suffix)
                blocks.append(_block(title, quantity, wavelength, values[key]))
    if len(blocks) == 1:
        return blocks[0] + "\r\n##END=\r\n"
    head = ["##TITLE={} spectrum".format(base), "##JCAMP-DX=4.24", "##DATA TYPE=LINK", "##BLOCKS={}".format(len(blocks))]
    return "\r\n".join(head + [block + "\r\n##END=" for block in blocks] + ["##END="]) + "\r\n"
