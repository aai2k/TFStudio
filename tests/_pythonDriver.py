"""Test helper for tests/python_client.mjs: drives the tfstudio package
(python/) through one scenario and prints what it got, one JSON object per
line.

    python -B -I tests/_pythonDriver.py <scenario> <folder holding tfstudio>

The first line on stdin is the scenario's input, as JSON; a scenario that
waits for the test to act reads one more line for each wait. The package in
python/ starts the server of the source checkout it is in. The scenarios of
the calls the objects are made on reach them as studio._calls.
"""

import gc
import json
import math
import os
import subprocess
import sys
import threading
import time

# The package is imported from the folder given, ahead of any installed one.
sys.path.insert(0, sys.argv[2])

import tfstudio

# How long a scenario waits for a run in another thread to report; a run that
# has not reported by then is not going.
REPORT_WAIT_S = 60

# How long a server whose stdin closed may take to end: it ends within 2 s.
END_WAIT_S = 5

# How long a scenario waits for a stand-in server's answer, which comes in a
# fraction of a second once its log is read.
ANSWER_WAIT_S = 10

# What a stand-in server writes to its log before it answers: more than a
# pipe holds unread, 64 KiB on Linux and less on Windows.
LOG_BYTES = 1 << 20


def out(value):
    print(json.dumps(value), flush=True)


def wait(what):
    """Waits until the test has done `what` and says so with a line."""
    out({"waiting": what})
    sys.stdin.readline()


def refused(make):
    """The message of the TFStudioError `make()` raises, or None."""
    try:
        make()
    except tfstudio.TFStudioError as err:
        return str(err)
    return None


def process_of(studio):
    return studio._calls._connection._process


def calls(given):
    """Each call of `given`, [name, args], made on one server, and its
    answer, after the server's hello and the names of the calls."""
    with tfstudio.TFStudio() as studio:
        tf = studio._calls
        names = [name for name in dir(tf) if not name.startswith("_") and callable(getattr(tf, name))]
        out({"hello": tf.info, "methods": [name for name in names if name not in ("close", "app")]})
        for name, args in given:
            try:
                out({"result": getattr(tf, name)(*args)})
            except tfstudio.TFStudioError as err:
                out({"error": str(err)})


class Wavelengths:
    """A list that is not one, as a NumPy array is not: it has tolist()."""

    def tolist(self):
        return [400, 550, 700]


def values(given):
    """Values as Python holds them, crossing to TFStudio and back."""
    stack, saved = given["stack"], given["saved"]
    with tfstudio.TFStudio() as studio:
        tf = studio._calls
        s = tf.spectrum(stack, {"from": 400, "to": 700, "step": 10, "angles": [0, 45]})
        out({"keys": sorted(s["angles"]), "summary": tf.summarize(s, {"bands": [{"from": 450, "to": 650}]})})
        unread = {"lambda": [500, 510], "angles": {"0": {q: [math.nan, math.nan] for q in given["quantities"]}}}
        r = tf.summarize(unread)["0"][0]["R"]
        out({"nan": [math.isnan(r["mean"]), r["min"] == math.inf, r["max"] == -math.inf]})
        out({"nanRefused": refused(lambda: tf.insertLayer(stack, {"material": "TiO2", "thickness": math.nan}))})
        out({"tolist": tf.materialNK("TiO2", Wavelengths())})
        out({"trailingNone": tf.findMaterials(None) == tf.findMaterials()})
        try:
            tf.spectrum(stack, {"from": 400, "to": 500, "angles": {0, 45}})
        except TypeError as err:
            out({"unsendable": str(err)})
        # The server's working folder stays the one the program started in.
        os.mkdir("moved")
        os.chdir("moved")
        out({"relativePath": tf.saveDesign(stack, saved), "opened": tf.openDesign(saved)["name"]})
        tf.info["calls"].remove("merit")
        out({"missingCall": refused(lambda: tf.merit(stack))})


def hooks(given):
    """Each hook's calls, the arguments of each in order, in the runs given."""
    with tfstudio.TFStudio() as studio:
        for run in given:
            called = {name: [] for name in run["hooks"]}

            def keep(name):
                return lambda *args: called[name].append(list(args))

            getattr(studio._calls, run["call"])(*run["args"], {name: keep(name) for name in called})
            out({run["name"]: called})


def stops(given):
    """Runs stopped by a Stop, by a hook that raises and by Ctrl+C in a hook,
    the last two with the seconds they took to end and followed by a run of
    their own, which a server still making the stopped run would refuse; and
    a Monte Carlo run in another thread."""
    start, monte_carlo = given["start"], given["monteCarlo"]
    short = {"method": "dls", "maxIter": 5}
    with tfstudio.TFStudio() as studio:
        tf = studio._calls
        stop = tfstudio.Stop()
        answer = tf.synthesize(start, given["needle"], {"onProgress": lambda patch: stop.stop(), "signal": stop})
        out({"signalled": answer})
        out({"alreadyStopped": tf.refine(start, short, {"signal": stop})["result"]["stopReason"]})

        def fails(patch):
            raise ValueError("a hook failed")

        began = time.monotonic()
        try:
            tf.monteCarlo(start, monte_carlo, {"onProgress": fails})
        except ValueError as err:
            out({"raised": [str(err), time.monotonic() - began, tf.refine(start, short)["result"]["stopReason"]]})

        def interrupts(patch):
            raise KeyboardInterrupt

        began = time.monotonic()
        try:
            tf.monteCarlo(start, monte_carlo, {"onProgress": interrupts})
        except KeyboardInterrupt:
            out({"interrupted": [time.monotonic() - began, tf.refine(start, short)["result"]["stopReason"]]})

        stop = tfstudio.Stop()
        going = threading.Event()
        answers = {}
        thread = threading.Thread(target=lambda: answers.update(tf.monteCarlo(
            start, monte_carlo, {"onProgress": lambda patch: going.set(), "signal": stop})))
        thread.start()
        going.wait(REPORT_WAIT_S)
        spectrum = tf.spectrum(start, {"from": 400, "to": 700, "step": 10})
        answered_while_going = thread.is_alive() and len(spectrum["lambda"]) == 31
        second = refused(lambda: tf.refine(start, short))
        stop.stop()
        thread.join()
        out({"thread": {"answeredWhileGoing": answered_while_going, "second": second, "trials": answers["nTrials"]}})


def stopped_together(stop, start, monte_carlo, servers, meanwhile=lambda: None):
    """The trials of a Monte Carlo run on each of `servers` at once, each in
    a thread and given `stop`, which is stopped once every run is going and
    `meanwhile` has been called."""
    answers = [{} for _ in servers]
    going = [threading.Event() for _ in servers]

    def run(tf, answer, event):
        answer.update(tf.monteCarlo(start, monte_carlo, {"onProgress": lambda patch: event.set(), "signal": stop}))

    threads = [threading.Thread(target=run, args=together) for together in zip(servers, answers, going)]
    for thread in threads:
        thread.start()
    for event in going:
        event.wait(REPORT_WAIT_S)
    meanwhile()
    stop.stop()
    for thread in threads:
        thread.join()
    return [answer.get("nTrials") for answer in answers]


def shared(given):
    """One Stop given to a run on each of two servers, and to a second run
    on one server, which refuses it."""
    start, monte_carlo = given["start"], given["monteCarlo"]
    with tfstudio.TFStudio() as a, tfstudio.TFStudio() as b:
        out({"twoServers": stopped_together(tfstudio.Stop(), start, monte_carlo, [a._calls, b._calls])})
        stop = tfstudio.Stop()
        second = []
        trials = stopped_together(stop, start, monte_carlo, [a._calls],
                                  lambda: second.append(refused(lambda: a._calls.monteCarlo(start, monte_carlo,
                                                                                            {"signal": stop}))))
        out({"oneServer": {"refused": [message for message in second if message], "trials": trials}})


def ended(process):
    """Whether `process` has ended, or ends within END_WAIT_S."""
    try:
        process.wait(END_WAIT_S)
        return True
    except subprocess.TimeoutExpired:
        return False


def kept(make):
    """What `make` gives of a TFStudio() that is dropped as this returns."""
    return make(tfstudio.TFStudio())


# What a program keeps of a TFStudio() it drops, by name, each with how it
# is made and a computation it still makes: a design, a material,
# tf.materials and tf.app.
KEPT = (("design", lambda tf: tf.new_design("Kept"), lambda design: len(design.spectrum(500, 510, step=10).R) == 2),
        ("material", lambda tf: tf.materials["TiO2"], lambda material: len(material.nk(550)) == 2),
        ("materials", lambda tf: tf.materials, lambda materials: materials["TiO2"].id == "TiO2"),
        ("app", lambda tf: tf.app, lambda app: "onProgress" in app._calls.runHooks("refine")))


def dropped(given):
    """The servers of TFStudio() objects the program drops without closing
    them: one whose name is given to another TFStudio(), as a notebook cell
    run again gives it, that one deleted, and each whose design, material,
    tf.materials or tf.app the program keeps, until it deletes that. The
    garbage collector is off, so dropping the last name must be enough."""
    gc.disable()
    tf = tfstudio.TFStudio()
    first = process_of(tf)
    tf = tfstudio.TFStudio()
    out({"rebound": ended(first), "otherAnswers": tf.new_design().name == "New Design"})
    second = process_of(tf)
    del tf
    out({"deleted": ended(second)})
    for name, make, computes in KEPT:
        held = kept(make)
        process = held._calls._connection._process
        try:
            out({name + "Kept": computes(held)})
        except tfstudio.ServerError as err:
            out({name + "Kept": str(err)})
        del held
        out({name + "Dropped": ended(process)})


def chatty(given):
    """A server that writes more to its log than a pipe holds before it
    answers: the package reads the log as it comes, so the server is not
    stopped by a full pipe."""
    from tfstudio import _connection
    server = _connection.Connection(saying({"hello": "tfstudio-api", "protocol": 1},
                                           "sys.stdin.readline()\nsys.stderr.write('x' * {})\nsys.stderr.flush()\n"
                                           "print({!r}, flush=True)\n".format(LOG_BYTES, json.dumps({"id": 1, "result": True}))))
    server.hello()
    answers = []
    thread = threading.Thread(target=lambda: answers.append(server.call("runHooks", ["refine"])), daemon=True)
    thread.start()
    thread.join(ANSWER_WAIT_S)
    out({"answered": answers == [{"id": 1, "result": True}]})


def saying(hello, then=""):
    """The command of a server that says `hello`, runs the Python `then`, and
    then answers nothing until its stdin closes."""
    return [sys.executable, "-c", "import sys\nprint({!r}, flush=True)\n{}sys.stdin.read()\n".format(json.dumps(hello), then)]


def asked(given):
    """What a run's request says, as a stand-in server that answers each
    request with the request shows it: with a Stop stopped before the run,
    and with one that is not."""
    from tfstudio import _connection
    server = _connection.Connection(saying({"hello": "tfstudio-api", "protocol": 1},
                                           "import json\nfor line in sys.stdin:\n    message = json.loads(line)\n"
                                           "    if 'call' in message:\n"
                                           "        print(json.dumps({'id': message['id'], 'result': message}), flush=True)\n"))
    server.hello()
    early = tfstudio.Stop()
    early.stop()
    sent = [server.call("refine", [{}, {}], {}, stop)["result"] for stop in (early, tfstudio.Stop())]
    out({"asked": [message.get("stopped") for message in sent]})


def hellos(given):
    """Hellos the package refuses: of another protocol, and of a server whose
    API could not start."""
    from tfstudio import _calls
    for name, hello in (("otherProtocol", {"hello": "tfstudio-api", "protocol": 2, "version": "9.9.9"}),
                        ("initFailed", {"hello": "tfstudio-api", "protocol": 1, "error": {"message": "no Materials"}})):
        _calls.find_server = lambda exe, live, data_dir, hello=hello: saying(hello)
        try:
            tfstudio.TFStudio()
        except tfstudio.ServerError as err:
            out({name: str(err)})


def unanswered(given):
    """A run whose server does not answer its stop, interrupted as Ctrl+C
    interrupts it, and then again while the stop is waited for."""
    import _thread
    from tfstudio import _connection
    server = _connection.Connection(saying({"hello": "tfstudio-api", "protocol": 1}))
    server.hello()
    threading.Timer(0.5, _thread.interrupt_main).start()
    threading.Timer(1.5, _thread.interrupt_main).start()
    began = time.monotonic()
    try:
        server.call("refine", [{}, {}], hooks={})
    except KeyboardInterrupt:
        out({"interrupted": time.monotonic() - began, "exitCode": server._process.poll()})
    try:
        server.call("runHooks", ["refine"])
    except tfstudio.ServerError as err:
        out({"after": str(err)})


def closes(given):
    """A server's process, while the with block lasts and after it."""
    with tfstudio.TFStudio() as tf:
        out({"pid": process_of(tf).pid, "answers": tf.new_design().name})
    out({"exitCode": process_of(tf).returncode})
    try:
        tf.new_design()
    except tfstudio.ServerError as err:
        out({"afterClose": str(err)})


def forgotten(given):
    """A program that ends without closing its server, or its own exit."""
    tf = tfstudio.TFStudio()
    out({"pid": process_of(tf).pid})
    os._exit(0)


def two(given):
    """Two servers at once, one closed while the other goes on."""
    with tfstudio.TFStudio() as a, tfstudio.TFStudio() as b:
        pids = [process_of(a).pid, process_of(b).pid]
        both = [bool(a.new_design()), bool(b.new_design())]
        a.close()
        try:
            a.new_design()
            closed = None
        except tfstudio.ServerError as err:
            closed = str(err)
        out({"pids": pids, "both": both, "closed": closed, "otherAnswers": bool(b.new_design())})


def missing(given):
    """Where TFStudio is not: a path that is not there, a folder that is no
    source checkout, the same in TFSTUDIO_EXE, and nothing named with no
    checkout around the package and no install, the installs being left out
    by this test."""
    from tfstudio import _finding
    _finding._installed = lambda: [("installs, which this test leaves out", None)]
    nowhere = os.path.join(os.getcwd(), "nowhere", "TFStudio.exe")
    for name, exe in (("notThere", nowhere), ("notCheckout", os.getcwd())):
        try:
            tfstudio.TFStudio(exe)
        except tfstudio.ServerError as err:
            out({name: str(err)})
    for name, exe in (("envNotThere", nowhere), ("notFound", "")):
        os.environ["TFSTUDIO_EXE"] = exe
        try:
            tfstudio.TFStudio()
        except tfstudio.ServerError as err:
            out({name: str(err)})


def commands(given):
    """The commands that start the server of an executable and of a source
    checkout, and the order the finder looks in: the argument before
    TFSTUDIO_EXE, and the source checkout the package is in before an
    install the registry records."""
    from tfstudio import _finding
    out({"exe": _finding.find_server(given["exe"], True, "data")})
    try:
        _finding.find_server(given["exe"], "link.json", None)
    except tfstudio.ServerError as err:
        out({"exeLinkFile": str(err)})
    out({"checkout": _finding.find_server(given["checkout"], "link.json", None)})
    os.environ["TFSTUDIO_EXE"] = given["other"]
    out({"argumentFirst": _finding.find_server(given["exe"], False, None)})
    del os.environ["TFSTUDIO_EXE"]
    _finding._installed = lambda: [("a stand-in install", given["other"])]
    out({"checkoutFirst": _finding.find_server(None, False, None)})


def live(given):
    """The app's designs opened, changed and pushed back, through the live
    link file given, and refused as the app refuses them."""
    with tfstudio.TFStudio(live=given["link"]) as tf:
        listed_ = [[d.id, d.name, d.folder, d.active, d.unsaved, d.layer_count, d.back_layer_count] for d in tf.app.designs()]
        design = tf.app.open_design()
        opened = [design.name, design._app[0]]
        read_at = design._app[1]
        design.layers[len(design.layers)].thickness = 40
        design.push()
        pushed = [design.layers[len(design.layers)].thickness, design._app[1] != read_at]
        # A copy keeps the link. The app does not take a design's name, so
        # the copy then differs from what it pushed and holds the app's design.
        again = design.copy()
        again.name = "Renamed here"
        again.layers[len(again.layers)].thickness = 41
        again.push()
        out({"listed": listed_, "opened": opened, "pushed": pushed, "again": again.layers[len(again.layers)].thickness,
             "afterPush": again._data == tf.app.open_design()._data})
        stale = tf.app.open_design()
        wait("edit")
        try:
            stale.push()
        except tfstudio.AppError as err:
            out({"edited": [err.code, str(err)]})
        mirror = tf.app.open_design("Mirror")
        try:
            mirror.push()
        except tfstudio.AppError as err:
            out({"switched": err.code})
        # A design holding NaN is refused before it is sent, with no code.
        mirror._data["frontLayers"][0]["thickness"] = math.nan
        try:
            mirror.push()
        except tfstudio.TFStudioError as err:
            out({"notFinite": [type(err).__name__, str(err)]})
        out({"byId": tf.app.open_design("app-hr").name, "byListed": tf.app.open_design(tf.app.designs()[1]).name,
             "unknown": refused(lambda: tf.app.open_design("Nothing")), "notRead": refused(lambda: tf.new_design().push())})
        wait("close")
        for name, call in (("off", tf.app.designs), ("offOpen", tf.app.open_design),
                           ("offOpenByName", lambda: tf.app.open_design("Mirror"))):
            try:
                call()
            except tfstudio.AppError as err:
                out({name: [err.code, str(err)]})
    with tfstudio.TFStudio() as tf:
        out({"notLive": refused(tf.app.open_design)})


def interrupt(given):
    """A run Ctrl+C reaches from outside, as SIGINT, once it is going."""
    with tfstudio.TFStudio() as studio:
        tf = studio._calls
        reported = []

        def going(patch):
            if not reported:
                reported.append(True)
                out({"going": True})

        began = time.monotonic()
        try:
            tf.monteCarlo(given["start"], given["monteCarlo"], {"onProgress": going})
        except KeyboardInterrupt:
            out({"interrupted": [time.monotonic() - began, tf.refine(given["start"], {"method": "dls", "maxIter": 5})["result"]["stopReason"]]})
        out({"pid": process_of(studio).pid})
    out({"closed": True})


if __name__ == "__main__":
    scenario = globals()[sys.argv[1]]
    scenario(json.loads(sys.stdin.readline() or "null"))
