"""Rows written to a CSV file as the windows' Copy CSV writes them
(csvFromRows in the app)."""


def _cell(value):
    """A CSV cell: a number in Python's float notation, an empty cell for
    None, a name with each comma made a semicolon."""
    if value is None:
        return ""
    return str(value) if isinstance(value, (int, float)) else str(value).replace(",", ";")


def write_rows(path, rows):
    """Writes `rows`, lists of cells, to the file `path`, one line each,
    over a file that is there."""
    with open(path, "w", newline="", encoding="utf-8") as file:
        file.write("\n".join(",".join(_cell(value) for value in row) for row in rows))
