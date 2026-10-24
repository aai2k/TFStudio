"""What tf.read_spectrum_file(), tf.read_ellipsometry_file() and
design.compare_measured() give: the API's answers as named tuples of their
fields in snake_case, and a curve given back as the API takes it."""

import collections

from ._names import api_names, python_name

SpectrumFile = collections.namedtuple("SpectrumFile", "format file_name x_unit skipped_rows curves")
MeasuredCurve = collections.namedtuple("MeasuredCurve", "name quantity angle pol wavelength values")
EllipsometryFile = collections.namedtuple("EllipsometryFile", "file_name x_unit skipped_rows curves")
EllipsometryCurve = collections.namedtuple("EllipsometryCurve", "name quantity angle side delta_convention cos_delta "
                                                                "wavelength values")
MeasuredDifference = collections.namedtuple("MeasuredDifference", "mode name quantity angle pol grid db level_free "
                                                                  "clipped rms ppef level wavelength measured design "
                                                                  "deviation")


def _record(record, answer):
    return record(**{python_name(key): value for key, value in answer.items()})


def spectrum_file(answer):
    """tf.readSpectrumFile()'s answer `answer` as a SpectrumFile of
    MeasuredCurves."""
    return _record(SpectrumFile, dict(answer, curves=[_record(MeasuredCurve, curve) for curve in answer["curves"]]))


def ellipsometry_file(answer):
    """tf.readEllipsometryFile()'s answer `answer` as an EllipsometryFile of
    EllipsometryCurves."""
    return _record(EllipsometryFile, dict(answer, curves=[_record(EllipsometryCurve, curve) for curve in answer["curves"]]))


def measured_difference(answer):
    """tf.measuredDifference()'s answer `answer` as a MeasuredDifference."""
    return _record(MeasuredDifference, answer)


def measured_argument(measured):
    """`measured` as the API takes it: a MeasuredCurve or an
    EllipsometryCurve as the dict of its fields in the API's names, a dict
    with its keys in them, anything else as it is."""
    if isinstance(measured, (MeasuredCurve, EllipsometryCurve)):
        return api_names(measured._asdict())
    return api_names(measured) if isinstance(measured, dict) else measured


def curves_argument(curves):
    """`curves`, one curve or a list of them, as the API takes them."""
    if isinstance(curves, (list, tuple)) and not isinstance(curves, (MeasuredCurve, EllipsometryCurve)):
        return [measured_argument(curve) for curve in curves]
    return measured_argument(curves)
