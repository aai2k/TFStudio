"""What a spectrum curve's peak(), edge() and fwhm() and design.edge_shift()
give: tf.bandFeature() and tf.edgeShift()'s answers as named tuples of their
fields in snake_case, and the band a curve's feature is found over."""

import collections

from ._errors import TFStudioError
from ._names import api_names, python_name
from ._refusals import Words, worded

_FOUND = "feature mode quantity angle direction step peak peak_value"
Peak = collections.namedtuple("Peak", _FOUND)
Edge = collections.namedtuple("Edge", _FOUND + " level level_value edge reason")
Width = collections.namedtuple("Width", _FOUND + " level level_value left right width centre reason")
EdgeShift = collections.namedtuple("EdgeShift", "mode quantity direction step level angles edge shift peak peak_value "
                                                "level_value reason")

# Each feature's named tuple and the keywords its method takes.
_FEATURES = {
    "peak": (Peak, ("direction", "step")),
    "edge": (Edge, ("level", "edge_side", "direction", "step")),
    "fwhm": (Width, ("level", "direction", "step")),
}
# bandFeature's options a curve's method takes as its arguments or from the curve.
_HIDDEN = ("feature", "from", "to", "quantity", "angle")


def answered(record, answer):
    """The answer `answer` of tf.bandFeature() or tf.edgeShift() as the named
    tuple `record`."""
    return record(**{python_name(key): value for key, value in answer.items()})


def computed_on(curves, angles, calls, design):
    """Gives each spectrum curve of `curves`, one dict of curves by quantity
    per angle of `angles`, the calls, the design and the angle its feature is
    found with; with no design, none."""
    if design is None:
        return
    for by_quantity, angle in zip(curves, angles):
        for curve in by_quantity.values():
            curve._source = (calls, design, angle)


def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _band(curve, feature, start, end):
    """The band from `start` to `end`, the curve's ends where they are None,
    after refusing one that is not inside the curve."""
    xs = curve._x
    low, high = xs[0] if start is None else start, xs[-1] if end is None else end
    if not (_is_number(low) and _is_number(high) and xs[0] <= low and high <= xs[-1]):
        raise TFStudioError("{}: the curve is from {} to {} nm, and the band {!r} to {!r} nm is not inside it".format(
            feature, xs[0], xs[-1], low, high))
    return low, high


def band_feature(curve, feature, start, end, options):
    """What bandFeature finds of `feature` over a band of `curve`, on the
    design and at the angle its spectrum was computed with, for the curve's
    method of that name, given the keywords `options`."""
    record, known = _FEATURES[feature]
    for name in options:
        if name not in known:
            raise TFStudioError("{}: unknown option {!r}; the options are {}".format(feature, name, ", ".join(known)))
    if curve._source is None:
        raise TFStudioError("{0}: only a spectrum's curves have {0}(), since it is found on the design the "
                            "spectrum was computed on".format(feature))
    low, high = _band(curve, feature, start, end)
    calls, design, angle = curve._source
    given = dict(api_names(options), feature=feature, quantity=curve._quantity, angle=angle, **{"from": low, "to": high})
    with worded(Words("bandFeature", feature, hidden=_HIDDEN)):
        return answered(record, calls.bandFeature(design, given))
