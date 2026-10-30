"""What design.edge_filter(), design.process_steps() and
design.monitor_worksheet() give: tf.edgeFilter(), tf.processSteps() and
tf.monitorWorksheet()'s answers as named tuples of their fields in
snake_case."""

import collections

from ._names import api_names, python_name

EdgeFilter = collections.namedtuple("EdgeFilter", "pass_ edge angle materials indices absorbing periods solutions")
EdgeSolution = collections.namedtuple("EdgeSolution", "outer a b c sigma zone_s zone_p pass_width formula")
ProcessSteps = collections.namedtuple("ProcessSteps", "mode quantity wavelength bare steps")
ProcessStep = collections.namedtuple("ProcessStep", "step layer material thickness chip values")
MonitorWorksheet = collections.namedtuple("MonitorWorksheet", "mode rows chips run_length")
WorksheetRow = collections.namedtuple("WorksheetRow", "step layer chip on_chip material wavelength thickness signal turning_points "
                                                      "amplitude swing_in swing_out cutoff_ratio termination_error crystal "
                                                      "initial_level poor strategy curve")
WorksheetChip = collections.namedtuple("WorksheetChip", "chip wavelength initial_level steps")
WorksheetCurve = collections.namedtuple("WorksheetCurve", "thickness signal")


def _fields(record, answer, renamed=None):
    renamed = renamed or {}
    return record(**{renamed.get(key) or python_name(key): value for key, value in answer.items()})


def edge_filter_of(answer):
    """tf.edgeFilter()'s answer `answer` as an EdgeFilter of EdgeSolutions."""
    found = dict(answer, solutions=[_fields(EdgeSolution, solution) for solution in answer["solutions"]])
    return _fields(EdgeFilter, found, {"pass": "pass_"})


def process_steps_of(answer):
    """tf.processSteps()'s answer `answer` as ProcessSteps of ProcessStep."""
    return _fields(ProcessSteps, dict(answer, steps=[_fields(ProcessStep, step) for step in answer["steps"]]))


def monitor_worksheet_of(answer):
    """tf.monitorWorksheet()'s answer `answer` as a MonitorWorksheet of
    WorksheetRows, each with its WorksheetCurve, and WorksheetChips."""
    rows = [_fields(WorksheetRow, dict(row, curve=_fields(WorksheetCurve, row["curve"]))) for row in answer["rows"]]
    return _fields(MonitorWorksheet, dict(answer, rows=rows, chips=[_fields(WorksheetChip, chip) for chip in answer["chips"]]))


def run_options(options):
    """design.process_steps()'s or design.monitor_worksheet()'s keywords by
    the API's names, the keys of a chips dict among them."""
    given = api_names(options)
    if isinstance(given.get("chips"), dict):
        given["chips"] = api_names(given["chips"])
    return given
