"""What tf.read_zemax_coating() and tf.read_codev_coating() give: the API's
answers as named tuples of their fields in snake_case."""

import collections

from ._names import python_name

ZemaxCoatingFile = collections.namedtuple("ZemaxCoatingFile", "file_name materials coatings")
ZemaxMaterial = collections.namedtuple("ZemaxMaterial", "name repeat imported_as wavelength n k")
ZemaxCoating = collections.namedtuple("ZemaxCoating", "name type layers")
ZemaxLayer = collections.namedtuple("ZemaxLayer", "material thickness file_thickness mode")
CodevCoatingFile = collections.namedtuple("CodevCoatingFile", "file_name title reference wavelengths angles incident "
                                                              "substrate layers warnings")
CodevIndex = collections.namedtuple("CodevIndex", "label n k")
CodevLayer = collections.namedtuple("CodevLayer", "index thickness code locked")


def _record(record, answer):
    return record(**{python_name(key): value for key, value in answer.items()})


def _zemax_coating(coating):
    layers = coating["layers"]
    if layers is not None:
        layers = [_record(ZemaxLayer, layer) for layer in layers]
    return _record(ZemaxCoating, dict(coating, layers=layers))


def zemax_coating_file(answer):
    """The API's readZemaxCoating answer `answer` as a ZemaxCoatingFile of
    ZemaxMaterials and ZemaxCoatings."""
    materials = [_record(ZemaxMaterial, material) for material in answer["materials"]]
    coatings = [_zemax_coating(coating) for coating in answer["coatings"]]
    return _record(ZemaxCoatingFile, dict(answer, materials=materials, coatings=coatings))


def codev_coating_file(answer):
    """The API's readCodevCoating answer `answer` as a CodevCoatingFile of
    CodevIndexes and CodevLayers."""
    layers = [_record(CodevLayer, dict(layer, index=_record(CodevIndex, layer["index"]))) for layer in answer["layers"]]
    return _record(CodevCoatingFile, dict(answer, incident=_record(CodevIndex, answer["incident"]),
                                          substrate=_record(CodevIndex, answer["substrate"]), layers=layers))
