"""The calls of TFStudio's API as the server takes them: one method per call,
with the API Reference's names and arguments, options as dicts and answers as
dicts and lists. TFStudio, Design and the other objects of the package are
made on them."""

import os
import weakref

from ._connection import PROTOCOL, Connection
from ._errors import AppError, ServerError, TFStudioError
from ._finding import find_server
from ._stop import Stop


class Calls:
    """The API server that `exe`, `live` and `data_dir` name (find_server
    says how), started, and its calls. info is the server's hello: the
    TFStudio version, wasm, dataDir, unreadable, live and calls. `pipe`, a
    Pipe to a server that is running already, as the Script Console gives
    one, is used in place of finding and starting one.

    The TFStudio() and every design, material and app it gives hold this
    object, so the server ends once the program holds none of them, or at
    close()."""

    def __init__(self, exe=None, live=False, data_dir=None, pipe=None):
        if pipe is None:
            self._connection = Connection(find_server(exe, live, data_dir))
        else:
            self._connection = Connection(["TFStudio's Script Console"], pipe)
        try:
            hello = self._connection.hello()
            if "error" in hello:
                raise ServerError("TFStudio could not start its API: " + hello["error"]["message"])
            if hello.get("protocol") != PROTOCOL:
                raise ServerError("this tfstudio package speaks protocol {} and TFStudio {} speaks {}; use the "
                                  "package that TFStudio ships, by running install.py in its resources/python folder"
                                  .format(PROTOCOL, hello.get("version"), hello.get("protocol")))
        except BaseException:
            self._connection.close()
            raise
        self.info = hello
        # The finalizer holds the connection, not this object, so it does not
        # keep this object alive; nothing the connection holds refers to it.
        weakref.finalize(self, self._connection.close)

    def close(self):
        """Ends the server, after stopping a run it is making."""
        self._connection.close()

    def openDesign(self, filePath):
        return self._call("openDesign", _absolute(filePath))

    def saveDesign(self, design, filePath, options=None):
        return self._call("saveDesign", design, _absolute(filePath), options)

    def newDesign(self, options=None):
        return self._call("newDesign", options)

    def setDesignSetup(self, design, options):
        return self._call("setDesignSetup", design, options)

    def insertLayer(self, design, options):
        return self._call("insertLayer", design, options)

    def deleteLayer(self, design, options):
        return self._call("deleteLayer", design, options)

    def setLayer(self, design, options):
        return self._call("setLayer", design, options)

    def stackFromFormula(self, design, options):
        return self._call("stackFromFormula", design, options)

    def cleanDesign(self, design, options=None):
        return self._call("cleanDesign", design, options)

    def findMaterials(self, query=None):
        return self._call("findMaterials", query)

    def materialNK(self, id, wavelengths, design=None):
        return self._call("materialNK", id, wavelengths, design)

    def materialDispersion(self, id, options=None, design=None):
        return self._call("materialDispersion", id, options, design)

    def spectrum(self, design, options):
        return self._call("spectrum", design, options)

    def summarize(self, result, options=None):
        return self._call("summarize", result, options)

    def indexProfile(self, design, options=None):
        return self._call("indexProfile", design, options)

    def layerThicknesses(self, design, options=None):
        return self._call("layerThicknesses", design, options)

    def designFacts(self, design, options=None):
        return self._call("designFacts", design, options)

    def admittance(self, design, options=None):
        return self._call("admittance", design, options)

    def electricField(self, design, options=None):
        return self._call("electricField", design, options)

    def color(self, design, options=None):
        return self._call("color", design, options)

    def integrals(self, design, options=None):
        return self._call("integrals", design, options)

    def ellipsometry(self, design, options=None):
        return self._call("ellipsometry", design, options)

    def ellipsometryVsAngle(self, design, options=None):
        return self._call("ellipsometryVsAngle", design, options)

    def groupDelay(self, design, options=None):
        return self._call("groupDelay", design, options)

    def monteCarlo(self, design, options, hooks=None):
        return self._run("monteCarlo", design, options, hooks)

    def layerSensitivity(self, design, options=None):
        return self._call("layerSensitivity", design, options)

    def setMerit(self, design, rows):
        return self._call("setMerit", design, rows)

    def merit(self, design):
        return self._call("merit", design)

    def setSpecification(self, design, checks):
        return self._call("setSpecification", design, checks)

    def checkSpecification(self, design):
        return self._call("checkSpecification", design)

    def estimateYield(self, design, options=None, hooks=None):
        return self._run("estimateYield", design, options, hooks)

    def refine(self, design, settings, hooks=None):
        return self._run("refine", design, settings, hooks)

    def synthesize(self, design, request, hooks=None):
        return self._run("synthesize", design, request, hooks)

    def runHooks(self, method):
        return self._call("runHooks", method)

    def app(self, call, options=None):
        """The answer of the app call `call` ('designs', 'read' or 'apply'),
        for a server started with live."""
        if not self.info["live"]:
            raise TFStudioError("tf.app: this TFStudio() was started without live=True, so it reaches no app")
        return self._call("app." + call, options)

    def _call(self, call, *args, hooks=None, run_stop=None):
        """What `call` answers to `args`, with the trailing Nones left out so
        that the API's defaults apply. A refusal of the app raises AppError;
        any other raises TFStudioError in the API's words, with the code and
        fields of a refusal the API words from them (src/api/check.js), which
        the package's objects word again in their own names."""
        if not call.startswith("app.") and call not in self.info["calls"]:
            raise TFStudioError("{}: the TFStudio this program started, version {}, does not have this call"
                                .format(call, self.info["version"]))
        args = list(args)
        while args and args[-1] is None:
            args.pop()
        answer = self._connection.call(call, args, hooks, run_stop)
        error = answer.get("error")
        if error is None:
            return answer.get("result")
        # The server gives the API's own refusals a code too; only the app's
        # make an AppError.
        if call.startswith("app.") and "code" in error:
            raise AppError(error["message"], error["code"])
        refused = TFStudioError(error["message"])
        refused.code, refused.fields = error.get("code"), error.get("fields")
        raise refused

    def _run(self, call, design, options, hooks):
        """A run's answer, its hooks given as the API takes them: functions
        by hook name, and signal a Stop."""
        hooks = {} if hooks is None else hooks
        if not isinstance(hooks, dict):
            raise TFStudioError("{}: hooks is a dict of functions by hook name, with signal a tfstudio.Stop"
                                .format(call))
        given = {name: hook for name, hook in hooks.items() if hook is not None}
        run_stop = given.pop("signal", None)
        if run_stop is not None and not isinstance(run_stop, Stop):
            raise TFStudioError("{}: signal is a tfstudio.Stop".format(call))
        for name, hook in given.items():
            if not callable(hook):
                raise TFStudioError("{}: {} is a function".format(call, name))
        return self._call(call, design, options, hooks=given, run_stop=run_stop)


def _absolute(path):
    """`path` made absolute against this program's working folder as it is
    now; the server's own stays the one the program had when it started."""
    return os.path.abspath(os.fspath(path))
