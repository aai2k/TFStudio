"""What design.differences() gives: tf.designDifferences()'s answer as named
tuples, its settings by the package's names for them."""

import collections

Differences = collections.namedtuple("Differences", "same setup layers")
SetupChange = collections.namedtuple("SetupChange", "setting before after")
LayerChange = collections.namedtuple("LayerChange", "side number before after change")
LayerState = collections.namedtuple("LayerState", "material thickness locked")

# The package's names for the settings designDifferences compares, where they
# are not their snake_case.
_SETTINGS = {"incidentMedium": "incident_medium", "exitMedium": "exit_medium", "substrate": "substrate.material",
             "substrateThicknessMm": "substrate.thickness", "referenceWavelength": "reference",
             "surfaceMode": "sides", "mfEvalMode": "score_on", "stressTemperatureC": "stress_temperature",
             "depositionTemperatureC": "deposition_temperature", "substrateDiameterMm": "substrate.diameter"}


def _state(layer):
    return None if layer is None else LayerState(layer["material"], layer["thickness"], layer["locked"])


def differences_of(found, sides, score_on):
    """tf.designDifferences()'s answer `found` as Differences, the values of
    sides and score_on by the names `sides` and `score_on` give them (dicts
    of the package's name by the API's)."""
    words = {"surfaceMode": sides, "mfEvalMode": score_on}
    setup = []
    for row in found["setup"]:
        named = words.get(row["setting"], {})
        setup.append(SetupChange(_SETTINGS[row["setting"]], named.get(row["before"], row["before"]),
                                 named.get(row["after"], row["after"])))
    layers = [LayerChange(row["side"], row["number"], _state(row["before"]), _state(row["after"]), row["change"])
              for row in found["layers"]]
    return Differences(found["same"], setup, layers)
