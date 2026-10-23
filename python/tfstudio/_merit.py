"""A design's merit function: its rows, and their values."""

from ._errors import TFStudioError
from ._names import api_name, api_names
from ._refusals import Words, worded

# add() makes its row with setMerit, whose refusals begin with the row's place;
# start and end are its lambdaStart and lambdaEnd, and type, start and end its
# arguments.
_ADD_WORDS = Words("setMerit: row 0", "add", {"lambdaStart": "start", "lambdaEnd": "end"},
                   ("type", "lambdaStart", "lambdaEnd"))


def _refuse_argument_fields(fields):
    """Refuses a keyword argument that names a field add() takes as an
    argument, which the argument would otherwise replace without a word. A
    field is known by its API name, so lambdaStart is refused as lambda_start
    is."""
    argument = next((name for name in fields if api_name(name) in ("lambdaStart", "lambdaEnd")), None)
    if argument:
        raise TFStudioError("add: unknown option {!r}; a row's type, start and end are add()'s arguments".format(argument))


def _reading(name, doc):
    return property(lambda self: self._values.get(name), doc=doc)


class MeritRow:
    """One row of a design's merit function, with its value for the design
    as it was when design.merit.rows was read. A field the row does not read
    is None.

    Example::

        design = tf.new_design("AR")
        design.stack("(HL)^2")
        design.merit.add("RAV", 450, 650, target=0)
        for row in design.merit.rows:
            print(row.type, row.start, row.end, row.value, row.target)
    """

    def __init__(self, row):
        self._values = dict(row, start=row.get("lambdaStart"), end=row.get("lambdaEnd"))

    type = _reading("type", """The operand, such as "RAV" or "MNT".

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            print(design.merit.rows[0].type)
        """)
    start = _reading("start", """The row's wavelength, or the first wavelength of its band, nm; the first
        layer for MNT and MXT.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            print(design.merit.rows[0].start)
        """)
    end = _reading("end", """The last wavelength of the row's band, nm; the last layer for MNT and MXT.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            print(design.merit.rows[0].end)
        """)
    aoi = _reading("aoi", """The angle of incidence, degrees in the incident medium.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0, aoi=45)
            print(design.merit.rows[0].aoi)
        """)
    pol = _reading("pol", """The polarization the row is scored in, "avg", "s" or "p"; None on a row
        scored on both, such as PSI.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0, aoi=45, pol="s")
            print(design.merit.rows[0].pol)
        """)
    cmp = _reading("cmp", """For TT and STR, the comparison: "eq", "le" or "ge".

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            design.merit.add("TT", target=2000, cmp="le")
            print(design.merit.rows[0].cmp)
        """)
    target = _reading("target", """The value the row drives toward, or its bound: R, T and A as fractions
        of 1, a thickness in nm for MNT and MXT.

        Example::

            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            design.merit.add("RAV", 520, 580, target=0.99)
            print(design.merit.rows[0].target)
        """)
    weight = _reading("weight", """How much the row counts.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0, weight=2)
            print(design.merit.rows[0].weight)
        """)
    enabled = _reading("enabled", """False for a row left out of the merit.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0, enabled=False)
            print(design.merit.rows[0].enabled)
        """)
    value = _reading("value", """The row's value for the design; NaN for a row that cannot be evaluated.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            row = design.merit.rows[0]
            print(row.value - row.target)
        """)
    error = _reading("error", """Why the row cannot be evaluated, or None.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            for row in design.merit.rows:
                print(row.type, row.error or "evaluated")
        """)

    def __repr__(self):
        return "<MeritRow {} {}..{}: {} for {}>".format(self.type, self.start, self.end, self.value, self.target)


class Merit:
    """A design's merit function, as the Merit Function Editor holds it:
    rows in order, each an operand of the Operand Reference, and the merit
    they add up to. Reading ``value``, ``optical_value`` or ``rows``
    evaluates the design as it is then.

    Example::

        design = tf.new_design("AR")
        design.stack("(HL)^2")
        design.merit.add("RAV", 420, 680, target=0)
        design.merit.add("MNT", 1, len(design.layers), target=10)
        print(design.merit.value)
    """

    def __init__(self, design):
        self._design = design

    def add(self, type, start=None, end=None, **fields):
        """Adds a row at the end of the merit function, made as the Merit
        Function Editor makes one: a field left out takes the value a row
        added there starts with. ``start`` and ``end`` may be left out.

        Args:
            type: The operand, such as "RAV", "TAV" or "MNT"; the Operand
                Reference says what each computes and which fields it reads.
            start: The wavelength, or the first wavelength of the band, nm;
                for MNT and MXT the first layer, numbered from the substrate.
            end: The last wavelength of the band, nm; for MNT and MXT the
                last layer. MNT and MXT cover layers 1 to 1000 when both are
                left out, so layers a synthesis adds are covered too.
            target: The value the row drives toward, or its bound: R, T and A
                as fractions of 1 (the editor shows percent), a thickness in
                nm for MNT and MXT. Default: the editor's for the operand.
            weight: How much the row counts, 0 or more. Default 1.
            aoi: The angle of incidence, degrees in the incident medium.
                Default 0.
            pol: "avg", "s" or "p". Default "avg".
            target_end: The target at `end` of a target that slopes from
                `target` at `start`; None for a flat one.
            cmp: For TT and STR, the comparison: "eq", "le" or "ge".
            flag: The editor's Flag column, a whole number; the Operand
                Reference says what it does on each row.
            enabled: False leaves the row out of the merit. Default True.
            comment: The text of a BLNK row.
            id: A name for the row, which a math row names in ref_id,
                ref_id1 or ref_id2 to read it. Default: a fresh id, as a row
                added in the editor gets.
            ref_id: For a math row that reads one row, that row's id.
            ref_id1: For a math row that reads two rows, the first one's id.
            ref_id2: For a math row that reads two rows, the second one's id.

        Raises:
            TFStudioError: a type this version does not evaluate, a field no
                row has, a value a field cannot take, or start above end on a
                row that reads a band or a layer range.
            TFStudioError: the row's `start` or `end` among the keyword
                arguments.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            design.merit.add("TAV", 800, 900, target=0.95, weight=2, aoi=45, pol="p")
            design.merit.add("MNT", target=10)
            print(len(design.merit), "rows, merit", design.merit.value)
        """
        _refuse_argument_fields(fields)
        row = dict(api_names(dict(fields, lambda_start=start, lambda_end=end)), type=type)
        design = self._design
        with worded(_ADD_WORDS):
            made = design._calls.setMerit(design._data, [row])["meritOperands"]
        design._data = dict(design._data, meritOperands=list(design._data.get("meritOperands") or []) + made)

    def clear(self):
        """Takes every row out of the merit function.

        Example::

            design = tf.new_design("Bare BK7")
            design.merit.add("RAV", 450, 650, target=0)
            design.merit.clear()
            print(len(design.merit), "rows")
        """
        design = self._design
        design._data = design._calls.setMerit(design._data, [])

    @property
    def rows(self):
        """The rows, each a MeritRow with its value for the design as it is
        now.

        Raises:
            TFStudioError: a design that names a material that resolves to
                nothing.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            design.merit.add("MNT", target=10)
            for row in design.merit.rows:
                print(row.type, row.value)
        """
        return [MeritRow(row) for row in self._evaluated()["rows"]]

    @property
    def value(self):
        """The merit of the design as it is now, as the Merit Function
        Editor shows it; None while a row cannot be evaluated.

        Raises:
            TFStudioError: a design that names a material that resolves to
                nothing.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            print(design.merit.value)
        """
        return self._evaluated()["total"]

    @property
    def optical_value(self):
        """The merit without the manufacturing rows MNT, MXT, TT and STR;
        None while a row cannot be evaluated.

        Raises:
            TFStudioError: a design that names a material that resolves to
                nothing.

        Example::

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            design.merit.add("MNT", target=100)
            print(design.merit.value, design.merit.optical_value)
        """
        return self._evaluated()["optical"]

    def __len__(self):
        """How many rows the merit function has.

        Example::

            design = tf.new_design("Bare BK7")
            design.merit.add("RAV", 450, 650, target=0)
            print(len(design.merit), "row")
        """
        return len(self._design._data.get("meritOperands") or [])

    def __repr__(self):
        return "<Merit of {} rows>".format(len(self))

    def _evaluated(self):
        design = self._design
        return design._calls.merit(design._data)
