"""A Python script run from TFStudio's Script Console. The desktop app starts
this module with this package first on Python's path, and an API server it
started for the run at the other end of stdin and stdout:

    python -m tfstudio._console

The first line on stdin is the run, one JSON object: the script's text, its
fileName and filePath (None for a script not saved to a file), and design,
the design open in the app or None. The server's messages follow it, and the
requests go out on stdout, as src/apiServer/server.js in the TFStudio source
documents them.

The script gets tf, a TFStudio on that server, with tf.design the open design
as a Design. What it prints, on stdout or stderr, goes to stderr, which the
console shows; it reads nothing, its stdin being empty. Its last message is
{"end": ...}, what tf.design held when the script ended, or what it raised:

    {"design": {...}}              tf.design holds a Design, whose data this is
    {"invalid": text}              tf.design holds something else
    {}                             tf.design is None, as it started
    {"error": text, "line": n}     the script raised; text is the traceback
                                   through the script's own lines, n the line
                                   it was raised at, or None

A script that calls sys.exit() ends with no "end" message, as one in the
JavaScript console that calls process.exit() does.
"""

import builtins
import json
import linecache
import os
import sys
import traceback

from ._calls import Calls
from ._design import Design
from ._process import Pipe
from ._studio import TFStudio


def _streams():
    """The pipe to the server, as (reader, writer), taken off stdin and
    stdout, which are then left to the script: stdout goes where stderr
    does, and stdin reads nothing."""
    reader = os.fdopen(os.dup(0), "rb")
    writer = os.fdopen(os.dup(1), "wb", buffering=0)
    nothing = os.open(os.devnull, os.O_RDONLY)
    os.dup2(nothing, 0)
    os.close(nothing)
    os.dup2(2, 1)
    return reader, writer


def _error_line(err, file_name):
    """The line of the script `err` was raised at: the line of a syntax error
    in it, or of the innermost call in it. None when there is none."""
    if isinstance(err, SyntaxError) and err.filename == file_name:
        return err.lineno
    lines = [frame.lineno for frame in traceback.extract_tb(err.__traceback__) if frame.filename == file_name]
    return lines[-1] if lines else None


def _error_text(err, file_name):
    """What `err` says, as Python prints it, with the script's own calls
    alone and none of this package's or of this module."""
    frames = [frame for frame in traceback.extract_tb(err.__traceback__) if frame.filename == file_name]
    shown = ["Traceback (most recent call last):\n"] + traceback.format_list(frames) if frames else []
    return "".join(shown + traceback.format_exception_only(type(err), err)).rstrip("\n")


def _left(design, started_with_one):
    """The "end" message for what tf.design holds when the script ends."""
    if isinstance(design, Design):
        return {"design": design._data}
    if design is None and not started_with_one:
        return {}
    if design is None:
        return {"invalid": "tf.design is None."}
    return {"invalid": "tf.design holds a value of type {}, not a Design.".format(type(design).__name__)}


def _ran(tf, run):
    """Runs the script, and returns its "end" message."""
    file_name = run["fileName"]
    # The script's lines, for a traceback to show as it shows a file's.
    linecache.cache[file_name] = (len(run["text"]), None, run["text"].splitlines(True), file_name)
    namespace = {"__name__": "__main__", "__builtins__": builtins, "tf": tf}
    if run["filePath"]:
        namespace["__file__"] = run["filePath"]
    sys.argv = [run["filePath"] or file_name]
    try:
        exec(compile(run["text"], file_name, "exec"), namespace)
    except SystemExit:
        raise
    except BaseException as err:
        return {"error": _error_text(err, file_name), "line": _error_line(err, file_name)}
    return _left(getattr(tf, "design", None), run["design"] is not None)


def main():
    reader, writer = _streams()
    run = json.loads(reader.readline().decode("utf-8"))
    tf = TFStudio._on(Calls(pipe=Pipe(reader, writer)))
    tf.design = None if run["design"] is None else Design(tf._calls, run["design"])
    end = _ran(tf, run)
    sys.stdout.flush()
    sys.stderr.flush()
    connection = tf._calls._connection
    try:
        connection._send({"end": end})
    except (TypeError, ValueError) as err:
        connection._send({"end": {"invalid": "tf.design holds data TFStudio cannot read: {}".format(err)}})


if __name__ == "__main__":
    main()
