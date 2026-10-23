"""The API server's process: started apart from the program's console, and
ended by closing its stdin, or by force. Or the pipe to a server that is
running already, which TFStudio's Script Console gives the script it runs."""

import io
import os
import signal
import subprocess

# How long a server whose stdin is closed is waited for. It ends within 2 s,
# after stopping a run at the run's next step; the rest is room for a loaded
# machine. Past that it is ended by force.
CLOSE_WAIT_S = 10


def own_console():
    """Popen's arguments that keep the console's Ctrl+C from the server, so
    that Ctrl+C reaches this program alone, which then stops the run."""
    if os.name == "nt":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW}
    return {"start_new_session": True}


def end(process):
    """Closes the server's stdin, on which it stops a run and exits, and ends
    it by force if it is still there after CLOSE_WAIT_S."""
    try:
        process.stdin.close()
    except OSError:
        pass
    try:
        process.wait(CLOSE_WAIT_S)
    except subprocess.TimeoutExpired:
        end_by_force(process)


def end_by_force(process):
    """Ends the server and the processes it started: TFStudio's executable
    serves from a process of its own, which outlives a parent ended alone."""
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except OSError:
            pass
    process.kill()
    process.wait()


class Pipe:
    """The pipe to an API server that is running already, which TFStudio's
    Script Console starts for the script it runs (_console.py), in the place
    of the server's process: `reader` the server's messages come in on and
    `writer` the requests go out on, both binary files. The app keeps the
    server's log."""

    def __init__(self, reader, writer):
        self.stdin = writer
        self.stdout = reader
        self.stderr = io.BytesIO()


def leave(pipe):
    """Ends nothing: the server at the other end of a Pipe is the app's to
    end, and the pipe closes as the program ends."""
