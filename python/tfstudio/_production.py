"""What design.edge_filter() and design.process_steps() give: tf.edgeFilter()
and tf.processSteps()'s answers as named tuples of their fields in
snake_case."""

import collections

from ._names import api_names, python_name

EdgeFilter = collections.namedtuple("EdgeFilter", "pass_ edge angle materials indices absorbing periods solutions")
EdgeSolution = collections.namedtuple("EdgeSolution", "outer a b c sigma zone_s zone_p pass_width formula")
ProcessSteps = collections.namedtuple("ProcessSteps", "mode quantity wavelength bare steps")
ProcessStep = collections.namedtuple("ProcessStep", "step layer material thickness chip values")


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


def run_options(options):
    """design.process_steps()'s keywords by the API's names, the keys of a
    chips dict among them."""
    given = api_names(options)
    if isinstance(given.get("chips"), dict):
        given["chips"] = api_names(given["chips"])
    return given
