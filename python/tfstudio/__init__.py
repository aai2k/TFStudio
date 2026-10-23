"""TFStudio in Python programs: design, compute and optimize optical
thin-film coatings with the code TFStudio's windows compute with.

    import tfstudio

    with tfstudio.TFStudio() as tf:
        design = tf.new_design("Mirror 550", substrate="BK7", reference=550)
        design.stack("(HL)^4 H", H="TiO2", L="SiO2")
        s = design.spectrum(400, 700, step=5)
        print(max(s.R))

TFStudio() starts a TFStudio with no window that computes for the program,
and the end of the with block ends it. Units are the app's: wavelengths and
layer thicknesses in nm, angles in degrees in the incident medium, the
substrate's thickness in mm, R, T and A as fractions of 1. The manual's
Python page (https://docs.tfstudio.xyz/automation/python/) says more.
"""

from ._design import Design, Layer, Layers, Substrate
from ._errors import AppError, ServerError, TFStudioError
from ._merit import Merit, MeritRow
from ._results import (CheckResult, Curve, LayerSensitivity, MonteCarlo, Progress, RunResult, SensitivityRow, SpecReport,
                       Spectrum, Yield)
from ._specification import SpecCheck, Specification
from ._stop import Stop
from ._studio import App, AppDesign, Material, Materials, TFStudio

__version__ = "0.1.0"

__all__ = ["TFStudio", "Design", "Substrate", "Layers", "Layer", "Merit", "MeritRow", "Specification", "SpecCheck",
           "SpecReport", "CheckResult", "Yield", "Spectrum", "Curve", "Progress", "RunResult", "MonteCarlo",
           "LayerSensitivity", "SensitivityRow", "Materials", "Material", "App", "AppDesign", "Stop", "TFStudioError",
           "AppError", "ServerError"]
