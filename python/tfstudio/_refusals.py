"""The API's refusals in the package's words. A refusal of the API names its
own call and options, such as setMerit and lambdaStart, which a program
using the package never wrote. So each method words the refusals of the
calls it makes in its own names: from the code and fields a refusal carries,
or, for a refusal without them, by giving the method's name in place of the
call's at the start."""

import collections
import contextlib
import re

from ._errors import AppError, TFStudioError
from ._names import python_name


class Words(collections.namedtuple("Words", "call method names hidden extra", defaults=("", None, (), ()))):
    """What a method's refusals are worded from. `call` is the API's call the
    method makes, as the call's refusals begin, such as "setLayer"; `method`
    the method's name, which its refusals then begin with, or "" for an
    attribute's setter, whose refusals name the attribute alone; `names` the
    method's names for the call's options where they are not their
    snake_case; `hidden` the call's options the method takes as its
    arguments, which it does not list among its options; `extra` the
    method's options the call does not take, which it lists after the
    call's."""

    __slots__ = ()

    def name(self, option):
        """The method's name for the call's option `option`."""
        return (self.names or {}).get(option) or python_name(option)


_OTHER_SIDE = {"front": "back", "back": "front"}


def _closed_side(fields):
    if fields["surfaceMode"] == "symmetric":
        return "the back of a symmetric design mirrors its front; edit the front"
    return ("a design coated on the {} alone and scored on that side does not evaluate the {}; to edit it, set sides "
            "to 'both', or score_on to 'whole part'".format(_OTHER_SIDE[fields["side"]], fields["side"]))


def _no_specification(fields):
    # checkSpecification takes a design whose checks are all disabled, and
    # estimateYield does not.
    if fields["call"] == "checkSpecification":
        return "the design has no specification check; add one with specification.add()"
    return "the design has no enabled specification check; add one with specification.add()"


def _unknown_option(fields, words):
    listed = [words.name(option) for option in fields["options"] if option not in words.hidden] + list(words.extra)
    return "unknown option {!r}; the options are {}".format(words.name(fields["option"]), ", ".join(listed))


# The API writes the values true, false and null in what an option takes as
# JSON writes them; a program using the package writes them True, False and None.
_PYTHON_VALUES = {"true": "True", "false": "False", "null": "None"}


def _python_takes(takes):
    """The API's text of what an option takes, its values true, false and
    null written as Python writes them."""
    return re.sub(r"\b(?:true|false|null)\b", lambda found: _PYTHON_VALUES[found.group()], takes)


# Each refusal code in the package's words, from the refusal's fields and the
# Words of the method that made the call.
_WORDS = {
    "unknownOption": _unknown_option,
    "badValue": lambda fields, words: "{} is {}, not {!r}".format(words.name(fields["option"]),
                                                                  _python_takes(fields["takes"]), fields["value"]),
    "noMerit": lambda fields, words: "the design has no merit function; add a row with merit.add()",
    "noSpecification": lambda fields, words: _no_specification(fields),
    "noLayers": lambda fields, words: "the design has no layers; add them with layers.append() or stack()",
    "closedSide": lambda fields, words: _closed_side(fields),
    "wavelengthRange": lambda fields, words: "start and end are wavelengths in nm, 0 < start < end",
    "bandOrder": lambda fields, words: "start {} is above end {}".format(fields["start"], fields["end"]),
    "fileExists": lambda fields, words: "{} exists; pass overwrite=True to write over it".format(fields["path"]),
    "formulaMedia": lambda fields, words: "the formula names media; write the layers alone, such as '(HL)^5 H', "
                                          "and set the media with incident_medium, exit_medium and substrate.material",
}


def _said(err, words):
    """What the refusal `err` says in `words`, or None for an error that is
    no refusal of the call words.call."""
    code, fields = getattr(err, "code", None), getattr(err, "fields", None)
    if code in _WORDS and fields:
        return _WORDS[code](fields, words)
    prefix = words.call + ": "
    message = str(err)
    return message[len(prefix):] if message.startswith(prefix) else None


@contextlib.contextmanager
def worded(words):
    """A with block in which a refusal of the call words.call is raised again
    in the Words `words` of the method making it; an AppError stays one, with
    its code."""
    try:
        yield
    except TFStudioError as err:
        text = _said(err, words)
        if text is None:
            raise
        message = "{}: {}".format(words.method, text) if words.method else text
        raise (AppError(message, err.code) if isinstance(err, AppError) else TFStudioError(message)) from None
