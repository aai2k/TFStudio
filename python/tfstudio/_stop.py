"""Stop: the Stop button of a run made from Python."""

import threading


class Stop:
    """A Stop button for runs. Give it to a run as ``stop=``, and ``stop()``
    ends the run at its next step, as the Stop button of the run's window
    does: a refinement or synthesis then leaves the design as it was, and a
    Monte Carlo run answers with the trials it made.

    One Stop can be given to several runs, on one TFStudio() or on several,
    and stop() ends them all. stop() may be called from any thread, from the
    run's progress function, or before the run starts, which then ends at
    once. Once stopped, a Stop stays stopped: make a new one for the next run.

    Example::

        import time
        import tfstudio

        design = tf.new_design("AR")
        design.layers.append("SiO2", 100)
        design.merit.add("RAV", 420, 680, target=0)
        stop = tfstudio.Stop()
        started = time.monotonic()

        def watch(p):
            if time.monotonic() - started > 60:
                stop.stop()

        run = design.synthesize("needle", pool=["TiO2", "SiO2"], max_layers=12, progress=watch, stop=stop)
        print(run.stop_reason, len(design.layers), "layers")
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._stopped = False
        self._stops = set()

    @property
    def stopped(self):
        """True once stop() has been called.

        Example::

            import tfstudio

            stop = tfstudio.Stop()
            print(stop.stopped)
            stop.stop()
            print(stop.stopped)
        """
        return self._stopped

    def stop(self):
        """Ends the runs this Stop is given to, at their next step, and every
        run it is given to later, at once.

        Example::

            import tfstudio

            design = tf.new_design("AR")
            design.stack("(HL)^2")
            design.merit.add("RAV", 450, 650, target=0)
            stop = tfstudio.Stop()

            def watch(p):
                if p.iteration is not None and p.iteration >= 10:
                    stop.stop()

            run = design.refine(method="dls", progress=watch, stop=stop)
            print("Ended:", run.stop_reason)
        """
        with self._lock:
            self._stopped = True
            stops = list(self._stops)
        for stop in stops:
            stop()

    def _watch(self, stop):
        """Has stop() call `stop` until _unwatch(stop), and calls it at once
        when stop() was called already."""
        with self._lock:
            self._stops.add(stop)
            stopped = self._stopped
        if stopped:
            stop()

    def _unwatch(self, stop):
        with self._lock:
            self._stops.discard(stop)
