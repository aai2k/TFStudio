"""Test helper for tests/python_client.mjs: runs the manual's Python examples
as a reader runs them, and prints one JSON object per example.

    python -B -I tests/_pythonExamples.py examples <folder holding tfstudio>

The first line on stdin is {"examples": [text, ...], "link": path}. An example
that starts a TFStudio of its own is a program, run as one; its
TFStudio(live=True) is pointed at the live link file `link`, where the test's
stand-in for the app listens. Any other example is a Script Console script:
it gets `tf`, one TFStudio for all of them, with no design open.

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
import sys
import traceback

sys.path.insert(0, sys.argv[2])

import tfstudio

PROGRAM = "tfstudio.TFStudio("


def files():
    """The files in the working folder, each with the time it was last written."""
    return {name: os.stat(name).st_mtime_ns for name in os.listdir(".") if os.path.isfile(name)}


def ran(text, tf, link):
    """What running `text` printed, and the traceback it raised or None."""
    if PROGRAM in text:
        text = text.replace("live=True", "live={!r}".format(link))
        namespace = {"__name__": "__main__"}
    else:
        namespace = {"__name__": "__main__", "tf": tf}
    printed = io.StringIO()
    try:
        with contextlib.redirect_stdout(printed):
            exec(compile(text, "example.py", "exec"), namespace)
    except Exception:
        return printed.getvalue(), traceback.format_exc()
    return printed.getvalue(), None


def examples(given):
    with tfstudio.TFStudio() as tf:
        for i, text in enumerate(given["examples"]):
            before = files()
            printed, error = ran(text, tf, given["link"])
            written = {name: at for name, at in files().items() if before.get(name) != at}
            rewrote = []
            if written and error is None:
                _, error = ran(text, tf, given["link"])
                now = files()
                rewrote = [name for name, at in written.items() if now.get(name) != at]
            print(json.dumps({"example": i, "printed": printed, "error": error, "rewrote": rewrote}), flush=True)


if __name__ == "__main__":
    globals()[sys.argv[1]](json.loads(sys.stdin.readline()))
