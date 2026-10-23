"""Installs the tfstudio package in this folder for the Python that runs this
script:

    python install.py

It writes tfstudio.pth, a file that names this folder, into that Python's
site-packages folder (inside a virtual environment, the environment's), or
into the user's own site-packages folder when that one cannot be written.
Python reads such a file as it starts and imports packages from the folder
it names. The file names this folder rather than holding a copy, so the
package is always the one of the TFStudio installed here, through its
updates. Deleting the file uninstalls the package; running the script again
writes the same file.
"""

import locale
import os
import site
import sys
import sysconfig

HERE = os.path.dirname(os.path.abspath(__file__))
NAME = "tfstudio.pth"


def pth_encoding(version):
    """The encoding the Python of `version` (as sys.version_info gives it)
    reads a .pth file in, so that a folder name outside ASCII is read as it
    was written: UTF-8 from 3.13; in 3.11 and 3.12 the locale's encoding as
    locale.getencoding() gives it, which UTF-8 mode does not change; before
    3.11 the encoding open() takes by default."""
    if version >= (3, 13):
        return "utf-8"
    if version >= (3, 11):
        return locale.getencoding()
    return locale.getpreferredencoding(False)


def write(folder):
    """Writes the .pth file into `folder` and answers its path."""
    encoding = pth_encoding(sys.version_info)
    try:
        text = (HERE + "\n").encode(encoding)
    except UnicodeEncodeError:
        sys.exit("The folder {} cannot be written in {}, the encoding this Python reads {} in. Move TFStudio to a "
                 "folder whose name it can write, or use Python 3.13 or newer, which reads the file as UTF-8."
                 .format(HERE, encoding, NAME))
    path = os.path.join(folder, NAME)
    with open(path, "wb") as file:
        file.write(text)
    return path


def main():
    try:
        path = write(sysconfig.get_path("purelib"))
    except OSError:
        if not site.ENABLE_USER_SITE:
            sys.exit("{} cannot be written, and this Python reads no user site-packages folder: run this "
                     "script as an administrator, or with the Python of a virtual environment"
                     .format(sysconfig.get_path("purelib")))
        os.makedirs(site.getusersitepackages(), exist_ok=True)
        path = write(site.getusersitepackages())
    print("Wrote " + path)
    print("{} now imports the tfstudio package from {}.".format(sys.executable, HERE))
    print("To uninstall it, delete that file.")


if __name__ == "__main__":
    main()
