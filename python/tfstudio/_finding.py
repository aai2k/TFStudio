"""Where the TFStudio that serves the API is, and the command that starts its
API server: TFStudio's executable run with --api, or, in a TFStudio source
checkout, src/apiServer/server.js run with Node.js.

TFStudio ships this package in resources/python of its install folder, and
install.py there makes Python import it from that folder, so the package
first looks for the TFStudio it came with."""

import os
import shutil
import sys

from ._errors import ServerError

if sys.platform == "win32":
    import winreg

# The environment variable that names TFStudio's executable or a source
# checkout's folder.
ENV = "TFSTUDIO_EXE"

# The folder this package's folder is in: resources/python in an installed
# TFStudio, whose executable is then two folders up, or python in a source
# checkout.
PACKAGE_HOME = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# TFStudio's executable in its install folder.
EXE_NAME = "TFStudio.exe" if sys.platform == "win32" else "tfstudio"

# The registry key the TFStudio installer records the install folder under, as
# InstallLocation: in HKEY_CURRENT_USER for an install for one user, in
# HKEY_LOCAL_MACHINE for one for all users. The name is electron-builder's
# key for the app id com.tfstudio.app.
INSTALL_KEY = r"Software\f8b21802-5f9b-588f-acb9-fd29df71c7a1"

# The file an open TFStudio writes in its settings folder while it listens
# for programs, after Interactive is clicked on its Optimization tab. It says
# where the app listens.
LINK_FILE = "live-bridge.json"


def find_server(exe, live, data_dir):
    """The command that starts the API server of `exe`, else of the TFStudio
    TFSTUDIO_EXE names, else of the TFStudio this package came with, else of
    the source checkout this package is in, else of the TFStudio the
    installer recorded. `live` is True to link the server to the app that is
    open, or, for a source checkout, the live link file to read; `data_dir`
    the data folder to use in place of the app's, or None. A linked server
    names this program to the app as this Python's executable, python.exe
    on Windows."""
    kind, path = _found(exe)
    if kind == "exe":
        if live not in (True, False):
            raise ServerError("live names a live link file only for a TFStudio source checkout; "
                              "TFStudio's executable reads the one of its own app: give live=True")
        command = [path, "--api"]
        linked = ["--live"] if live else []
    else:
        command = [_node(), os.path.join(path, "src", "apiServer", "server.js")]
        linked = ["--live", _link_file(path, live)] if live else []
    if data_dir is not None:
        command += ["--data", os.path.abspath(os.fspath(data_dir))]
    if live:
        linked += ["--program", os.path.basename(sys.executable) or "python"]
    return command + linked


def _found(exe):
    """("exe", TFStudio's executable) or ("checkout", a source checkout's
    folder), from where find_server looks."""
    if exe is not None:
        return _named(os.fspath(exe), "TFStudio(exe)")
    if os.environ.get(ENV):
        return _named(os.environ[ENV], ENV)
    # The package matches the TFStudio it came with, or the source checkout
    # it is in; another TFStudio can be of another version.
    own = os.path.join(os.path.dirname(os.path.dirname(PACKAGE_HOME)), EXE_NAME)
    if os.path.isfile(own):
        return "exe", own
    root = os.path.dirname(PACKAGE_HOME)
    looked = ["the TFStudio this package came with, " + own,
              "a source checkout with its node_modules around this package, " + root]
    if _is_checkout(root) and _has_packages(root):
        return "checkout", root
    for where, path in _installed():
        looked.append(where)
        if path is not None and os.path.isfile(path):
            return "exe", path
    raise ServerError("TFStudio was not found. Looked for: {}. Name TFStudio's executable, "
                      "or a TFStudio source checkout's folder, as TFStudio(exe) or in {}."
                      .format("; ".join(looked), ENV))


def _named(path, what):
    """What `path`, as `what` gives it, names: TFStudio's executable, or a
    source checkout's folder."""
    if os.path.isdir(path):
        if not _is_checkout(path):
            raise ServerError("{} names the folder {}, which is not a TFStudio source checkout; "
                              "name TFStudio's executable or such a folder".format(what, path))
        if not _has_packages(path):
            raise ServerError("{} names the TFStudio source checkout {}, which has no node_modules: "
                              "run npm ci in it".format(what, path))
        return "checkout", path
    if not os.path.isfile(path):
        raise ServerError("{} names {}, which is not there".format(what, path))
    return "exe", path


def _installed():
    """Where the installer recorded TFStudio, each as (where it was looked
    for, its executable or None)."""
    if sys.platform != "win32":
        return []
    return [("the install folder the registry records in " + name, _registered(root))
            for name, root in (("HKEY_CURRENT_USER", winreg.HKEY_CURRENT_USER),
                               ("HKEY_LOCAL_MACHINE", winreg.HKEY_LOCAL_MACHINE))]


def _registered(root):
    """TFStudio.exe in the install folder the registry records under `root`,
    or None."""
    try:
        with winreg.OpenKey(root, INSTALL_KEY, 0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY) as key:
            folder = winreg.QueryValueEx(key, "InstallLocation")[0]
    except OSError:
        return None
    return os.path.join(folder, "TFStudio.exe")


def _is_checkout(folder):
    return os.path.isfile(os.path.join(folder, "src", "apiServer", "server.js"))


def _has_packages(root):
    """Whether the source checkout `root` holds the packages its server
    imports, which npm ci puts there."""
    return os.path.isdir(os.path.join(root, "node_modules", "tmmcore"))


def _node():
    node = shutil.which("node")
    if node is None:
        raise ServerError("a TFStudio source checkout runs on Node.js, and node is not on PATH")
    return node


def _link_file(root, live):
    """The live link file a source checkout's server reads: the one `live`
    names, else the one an app started from `root` or the installed app
    wrote, whichever was written last. Before either app has written one,
    the checkout's own: the server reads the file once a call needs the app,
    so an app started later is still reached."""
    if live is not True:
        return os.path.abspath(os.fspath(live))
    if sys.platform == "win32":
        settings = os.path.join(os.environ.get("APPDATA", ""), "TFStudio")
    else:
        settings = os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"), "TFStudio")
    files = [os.path.join(root, "AppData", LINK_FILE), os.path.join(settings, LINK_FILE)]
    written = [file for file in files if os.path.isfile(file)]
    return max(written, key=os.path.getmtime) if written else files[0]
