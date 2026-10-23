"""Keyword arguments by the names the API gives them: a run's settings, a
Monte Carlo run's options and a merit row's fields are the API Reference's,
written in snake_case in Python."""

import re

# Names whose API name is not the plain camelCase of their snake_case name,
# because the API writes an acronym or a symbol in capitals.
_EXCEPTIONS = {"target_mf": "targetMF", "t0": "T0"}


def api_name(name):
    """The API's name of a keyword argument's snake_case name, such as
    maxLayers for max_layers."""
    if name in _EXCEPTIONS:
        return _EXCEPTIONS[name]
    first, *rest = name.split("_")
    return first + "".join(part[:1].upper() + part[1:] for part in rest)


def python_name(name):
    """The snake_case name of the API's name `name`, such as max_layers for
    maxLayers: an underscore before each capital that follows a small letter
    or a digit, all in small letters."""
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name).lower()


def api_names(options):
    """`options`, keyword arguments in snake_case, by the API's names, without
    those given as None, so that the API's defaults apply."""
    return {api_name(name): value for name, value in options.items() if value is not None}
