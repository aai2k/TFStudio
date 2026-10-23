"""The errors the tfstudio package raises."""


class TFStudioError(Exception):
    """A call TFStudio refused, with a message saying why in the package's
    names: it starts with the name of the method called, such as "refine: ",
    or, for an attribute that was set, names the attribute. A refusal of no
    one call, such as of a material id that resolves to nothing, says what
    was wrong alone.

    Example::

        import tfstudio

        design = tf.new_design("Bare BK7")
        try:
            design.layers.append("SiO2", -5)
        except tfstudio.TFStudioError as err:
            print(err)
    """


class AppError(TFStudioError):
    """A call to the app (tf.app) refused, with ``code`` saying why: 'off',
    'timeout', 'protocol', 'denied', 'edited', 'switched', 'optimizing',
    'noDesign', 'unknown' or 'invalid'.

    Example::

        import tfstudio

        try:
            with tfstudio.TFStudio(live=True) as tf:
                print(tf.app.open_design().name)
        except tfstudio.AppError as err:
            print(err.code, err)
    """

    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


class ServerError(Exception):
    """TFStudio could not be found or started, or the TFStudio serving the
    calls ended or was closed. When it ended on its own, the message ends with
    the last lines it wrote to its log.

    Example::

        import tfstudio

        try:
            tfstudio.TFStudio("no TFStudio here")
        except tfstudio.ServerError as err:
            print(err)
    """
