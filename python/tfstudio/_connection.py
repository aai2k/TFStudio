"""The pipe to a TFStudio API server: the process, the messages each way, and
a run's progress and stop.

The server reads one JSON message per line on its stdin and writes one per
line on its stdout; src/apiServer/server.js in the TFStudio source documents
them. NaN, Infinity and -Infinity travel as the bare tokens Python's json
module writes and reads, so a float crosses unchanged both ways.
"""

import collections
import functools
import itertools
import json
import os
import queue
import subprocess
import threading
import time
import weakref

from ._errors import ServerError
from ._process import end, end_by_force, leave, own_console

# The version of the messages this package reads and writes. The server's
# hello names its own, and a TFStudio that speaks another is refused at the
# start rather than misread.
PROTOCOL = 1

# How long TFStudio may take to start and say hello: seconds as a rule, more
# on the first start after an install or on a busy machine.
HELLO_WAIT_S = 60

# How long a stopped run may take to answer. A run looks for a stop between
# its steps, and one step on a large design can take seconds; past this the
# server is taken to be stuck and is ended by force.
STOP_WAIT_S = 15

# How often a wait wakes. A wait with no timeout does not wake for Ctrl+C on
# Windows, so each wait is a loop of short ones, and this is how soon Ctrl+C
# acts.
WAKE_S = 0.2

# The server's log lines an error quotes when the server ended: enough for
# the message and the start of the stack trace that ended it.
LOG_LINES = 20

# What _take gives when its time is up before a message came.
_NOTHING = object()


class Connection:
    """The API server `command` starts, and the calls sent to it. close() ends
    it, and so does the end of the program. `pipe`, a Pipe to a server that
    is running already, is used in place of starting one; `command` then only
    names it in errors, and ending the connection leaves the server alone."""

    def __init__(self, command, pipe=None):
        if pipe is None:
            self._process, ending, forcing = _started(command), end, end_by_force
        else:
            self._process, ending, forcing = pipe, leave, leave
        self._command = command
        self._lock = threading.Lock()
        self._writing = threading.Lock()
        self._waiting = {}
        self._ids = itertools.count(1)
        self._hello = queue.Queue()
        self._ended = False
        self._closed = None
        self._log = collections.deque(maxlen=LOG_LINES)
        self._logging = threading.Thread(target=self._keep_log, daemon=True)
        self._logging.start()
        threading.Thread(target=self._read, daemon=True).start()
        self._end = weakref.finalize(self, ending, self._process)
        self._end_by_force = forcing

    def hello(self):
        """The server's first message, once it has come."""
        message = _take(self._hello, time.monotonic() + HELLO_WAIT_S)
        if message is _NOTHING:
            raise ServerError("TFStudio did not start its API server within {} s ({}); a TFStudio "
                              "without one opens its window instead".format(HELLO_WAIT_S, self._command[0]))
        if message is None:
            raise self._gone()
        return message

    def call(self, call, args, hooks=None, run_stop=None):
        """The server's answer to `call` with `args`: { result } or { error }.
        For a run, `hooks` maps the names of the hooks it streams to the
        functions called, on this thread, with what each hook reports, and
        `run_stop` is its Stop or None. A run whose Stop was stopped before
        it is asked for starts stopped, so it ends at once; a stop that comes
        later is sent to the run. A run is stopped when this thread is
        interrupted or a hook raises, and the exception then goes on."""
        message = {"call": call, "args": args}
        if hooks is not None:
            message["hooks"] = list(hooks)
        if run_stop is not None and run_stop.stopped:
            message["stopped"] = True
        id, answers = self._register()
        try:
            self._send(dict(message, id=id))
        except BaseException:
            self._forget(id)
            raise
        stop = functools.partial(self._send_stop, id)
        if run_stop is not None:
            run_stop._watch(stop)
        try:
            return self._answer(answers, hooks)
        except BaseException:
            if hooks is not None:
                self._stop(id, answers)
            raise
        finally:
            if run_stop is not None:
                run_stop._unwatch(stop)
            self._forget(id)

    def close(self):
        """Ends the server: closes its stdin, on which it stops a run and
        exits, and ends it by force if it does not."""
        if self._closed is None:
            self._closed = "this TFStudio() is closed"
        self._end()

    def _register(self):
        with self._lock:
            ended = self._ended or self._closed is not None
            if not ended:
                id = next(self._ids)
                answers = queue.Queue()
                self._waiting[id] = answers
        if ended:
            raise self._gone()
        return id, answers

    def _forget(self, id):
        with self._lock:
            self._waiting.pop(id, None)

    def _send(self, message):
        line = json.dumps(message, allow_nan=True, separators=(",", ":"), default=_plain) + "\n"
        try:
            with self._writing:
                self._process.stdin.write(line.encode("ascii"))
                self._process.stdin.flush()
        except (OSError, ValueError):
            raise self._gone() from None

    def _send_stop(self, id):
        try:
            self._send({"stop": id})
        except ServerError:
            pass    # the server ended, which the run's caller is told

    def _answer(self, answers, hooks, until=None):
        """The answer on `answers`, or _NOTHING if it has not come by
        `until`. Progress on the way goes to `hooks`, or nowhere when it is
        None."""
        while True:
            message = _take(answers, until)
            if message is None:
                raise self._gone()
            if message is _NOTHING or "progress" not in message:
                return message
            if hooks is not None:
                hooks[message["progress"]["hook"]](*message["progress"]["args"])

    def _stop(self, id, answers):
        """Stops the run of `id` and waits for its answer, which is dropped.
        A run that does not answer within STOP_WAIT_S, and a second Ctrl+C
        while it is waited for, end the server by force."""
        try:
            self._send({"stop": id})
            if self._answer(answers, None, time.monotonic() + STOP_WAIT_S) is not _NOTHING:
                return
        except (KeyboardInterrupt, ServerError):
            pass
        self._closed = "this TFStudio() was ended while its run was being stopped"
        self._end_by_force(self._process)
        self._end()

    def _read(self):
        """Hands each message the server writes to the hello or to the call
        it answers, and tells them all when the server's output ends."""
        for line in self._process.stdout:
            message = _parsed(line)
            with self._lock:
                answers = self._hello if "hello" in message else self._waiting.get(message.get("id"))
            if answers is not None:
                answers.put(message)
        with self._lock:
            self._ended = True
            waiting = [self._hello, *self._waiting.values()]
        for answers in waiting:
            answers.put(None)

    def _keep_log(self):
        # Read as it comes: a server whose log is not read stops once the
        # pipe's buffer is full, and the computation writes to it as it goes.
        for line in self._process.stderr:
            self._log.append(line.decode("utf-8", "replace").rstrip())

    def _gone(self):
        """The error for a call to a server that is no longer there."""
        if self._closed is not None:
            return ServerError(self._closed)
        self._logging.join(1)
        log = "\n".join(self._log)
        return ServerError("the TFStudio serving the calls ended" + (". Its last lines:\n" + log if log else ""))


def _started(command):
    """The API server's process, started on `command`."""
    env = dict(os.environ)
    # Set, it would have TFStudio's executable run as Node.js rather than as
    # itself.
    env.pop("ELECTRON_RUN_AS_NODE", None)
    try:
        return subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, env=env, **own_console())
    except OSError as err:
        raise ServerError("TFStudio could not be started ({}): {}".format(command[0], err)) from None


def _take(messages, until=None):
    """The next message on `messages`, or _NOTHING once time.monotonic()
    passes `until`; None stands for the end of the server's output."""
    while until is None or time.monotonic() < until:
        try:
            return messages.get(timeout=WAKE_S)
        except queue.Empty:
            pass
    return _NOTHING


def _parsed(line):
    """The message a line holds, or {} for a line that holds none, such as
    the line break TFStudio's executable writes as it starts."""
    try:
        message = json.loads(line.decode("utf-8"))
    except ValueError:
        return {}
    return message if isinstance(message, dict) else {}


def _plain(value):
    """A value json cannot write, as one it can: an array with tolist(), such
    as NumPy's, as a list, and a path as text."""
    if hasattr(value, "tolist"):
        return value.tolist()
    if isinstance(value, os.PathLike):
        return os.fspath(value)
    raise TypeError("TFStudio takes numbers, text, True, False, None, lists and dicts, not a {}"
                    .format(type(value).__name__))
