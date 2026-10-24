"""What tf.read_spectrum_file() and design.compare_measured() give:
tf.readSpectrumFile() and tf.measuredDifference()'s answers as named tuples
of their fields in snake_case, and a curve given back as the API takes it."""

import collections

from ._names import python_name

SpectrumFile = collections.namedtuple("SpectrumFile", "format file_name x_unit skipped_rows curves")
MeasuredCurve = collections.namedtuple("MeasuredCurve", "name quantity angle pol wavelength values")
MeasuredDifference = collections.namedtuple("MeasuredDifference", "mode name quantity angle pol grid db level_free "
                                                                  "clipped rms ppef level wavelength measured design "
                                                                  "deviation")


def _record(record, answer):
    return record(**{python_name(key): value for key, value in answer.items()})


def spectrum_file(answer):
    """tf.readSpectrumFile()'s answer `answer` as a SpectrumFile of
    MeasuredCurves."""
    return _record(SpectrumFile, dict(answer, curves=[_record(MeasuredCurve, curve) for curve in answer["curves"]]))


def measured_difference(answer):
    """tf.measuredDifference()'s answer `answer` as a MeasuredDifference."""
    return _record(MeasuredDifference, answer)


def measured_argument(measured):
    """`measured` as the API takes it: a MeasuredCurve as the dict of its
    fields, anything else as it is."""
    return dict(measured._asdict()) if isinstance(measured, MeasuredCurve) else measured
