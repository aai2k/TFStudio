"""Test helper for tests/python_client.mjs: runs the manual's Python examples
as a reader runs them, and prints one JSON object per example.

    python -B -I tests/_pythonExamples.py examples <folder holding tfstudio>

The first line on stdin is {"examples": [text, ...], "link": path, "open":
bool}. An example that starts a TFStudio of its own is a program, run as one;
its TFStudio(live=True) is pointed at the live link file `link`, where the
test's stand-in for the app listens. A program's TFStudio() and
TFStudio(live=...) are the one already open the same way, kept running past
the program's with block and close(), so the programs do not each start a
server; starting and ending one is what python_client.mjs's sections 4 and 5
check. A TFStudio called any other way starts as it does for a reader. Any
other example is a Script Console
script: it gets `tf`, one TFStudio for all of them, with no design open. When
"open" is true, as it is for the Script Console page, each such script starts
as the console starts it: on an open design with a merit function when it
reads tf.design, with no design open otherwise.

Each example runs in the working folder. One that writes files there runs a
second time, and the files of its first run must be as it left them: a
reader who runs an example twice loses nothing. Each answer is
{"example": i, "printed": text, "error": traceback or None,
"rewrote": [files the second run wrote over]}.
"""

import contextlib
import io
import json
import os
import re
import sys
import traceback

sys.path.insert(0, sys.argv[2])

import tfstudio

PROGRAM = "tfstudio.TFStudio("

# Matches a script that reads tf.design. A script that only assigns a design to
# tf.design reads nothing of the open one, so it does not match.
READS_OPEN_DESIGN = re.compile(r"tf\.design(?!\s*=[^=])")


def open_design(tf):
    """The design open when a Script Console example that reads tf.design
    runs: an antireflection coating with a merit function, as a reader's open
    design has one."""
    design = tf.new_design("Open design")
    design.stack("(HL)^2")
    design.merit.add("RAV", 450, 650, target=0)
    return design


class Kept:
    """A program's TFStudio that stays open after the program: its with block
    hands over the TFStudio itself and leaves it running, close() leaves it
    running, and everything else is the TFStudio's."""

    def __init__(self, tf):
        object.__setattr__(self, "_tf", tf)

    def __enter__(self):
        return self._tf

    def __exit__(self, *exc):
        return False

    def close(self):
        pass

    def __getattr__(self, name):
        return getattr(self._tf, name)

    def __setattr__(self, name, value):
        setattr(self._tf, name, value)


def opener(start, kept):
    """tfstudio.TFStudio as a program calls it: with no arguments, or with
    live= alone, the TFStudio `kept` holds for that live=, started on first
    use; called any other way, `start` itself."""
    def TFStudio(*args, **kwargs):
        if args or set(kwargs) - {"live"}:
            return start(*args, **kwargs)
        key = repr(kwargs.get("live", False))
        if key not in kept:
            kept[key] = start(**kwargs)
        return Kept(kept[key])
    return TFStudio


def files():
    """The files in the working folder, each with the time it was last written."""
    return {name: os.stat(name).st_mtime_ns for name in os.listdir(".") if os.path.isfile(name)}


def ran(text, tf, given, kept):
    """What running `text` printed, and the traceback it raised or None."""
    start = tfstudio.TFStudio
    if PROGRAM in text:
        text = text.replace("live=True", "live={!r}".format(given["link"]))
        namespace = {"__name__": "__main__"}
        tfstudio.TFStudio = opener(start, kept)
    else:
        if given.get("open"):
            tf.design = open_design(tf) if READS_OPEN_DESIGN.search(text) else None
        namespace = {"__name__": "__main__", "tf": tf}
    printed = io.StringIO()
    try:
        with contextlib.redirect_stdout(printed):
            exec(compile(text, "example.py", "exec"), namespace)
    except Exception:
        return printed.getvalue(), traceback.format_exc()
    finally:
        tfstudio.TFStudio = start
    return printed.getvalue(), None


def examples(given):
    kept = {}
    with tfstudio.TFStudio() as tf:
        for i, text in enumerate(given["examples"]):
            before = files()
            printed, error = ran(text, tf, given, kept)
            written = {name: at for name, at in files().items() if before.get(name) != at}
            rewrote = []
            if written and error is None:
                _, error = ran(text, tf, given, kept)
                now = files()
                rewrote = [name for name, at in written.items() if now.get(name) != at]
            print(json.dumps({"example": i, "printed": printed, "error": error, "rewrote": rewrote}), flush=True)
    for program_tf in kept.values():
        program_tf.close()


if __name__ == "__main__":
    globals()[sys.argv[1]](json.loads(sys.stdin.readline()))
