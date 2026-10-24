---
title: Python
description: Design and compute thin-film coatings from a Python program, on designs of its own or on the design open in the app.
---

A Python program can work with TFStudio's designs through the `tfstudio` package: the same objects a Python script in the [Script Console](/automation/script-console/) has, which the [API Reference](/automation/api-reference/) lists. The package starts a TFStudio of its own with no window, which computes for the program, and ends it when the program is done with it. The program can build designs and clean their stacks, scale, round, perturb, flip and copy a side's layers and list what differs between two designs, search and put in a non-polarizing edge filter, find where a needle lowers the merit and put one in as the Needle Manual does, read a stack's index profile, layer thicknesses and total thickness, compute a side's admittance locus, electric field, Ψ and Δ, and phase, group delay and GDD, compute a material's dispersion, compute spectra, colour, integral values and merit functions, find a band's peak, edge and FWHM and how an edge moves with angle, read measured spectrum and ellipsometer files, add their curves to a design with the merit rows that fit it to them, compare it with them and write them to a file, compute the spectrum after each layer of a deposition run and write the Process Exporter's files, check a design against its specification and count its yield, run refinement and synthesis, and save what it finds; with `live=True` it can also read and change the design open in the app. The objects compute with the code the windows compute with, so their numbers are the app's.

## Install

You install Python yourself; the package needs Python 3.8 or newer and no other package. TFStudio ships the package in the `resources\python` folder of its install folder. To install it, run `install.py` from that folder with the Python your programs use:

```bash
python "C:\Users\you\AppData\Local\Programs\TFStudio\resources\python\install.py"
```

`install.py` adds one file to that Python, `tfstudio.pth`, which points it at the folder, and prints where it wrote the file. Nothing is downloaded: the package is the one in TFStudio's install folder, so it is updated with TFStudio. To uninstall it, delete that file. For a virtual environment, run `install.py` with the environment's Python.

On Linux, the deb package puts the folder at `/opt/TFStudio/resources/python`. An AppImage's files exist only while it runs: run it once with `--appimage-extract`, which writes them to a `squashfs-root` folder in the current folder, and run `install.py` from `squashfs-root/resources/python`.

A Python script in the Script Console needs none of this: the console gives it the package.

## Start TFStudio

```python
import tfstudio

with tfstudio.TFStudio() as tf:
    print("TFStudio", tf.info["version"], "on the data folder", tf.info["dataDir"])
    design = tf.new_design("Mirror 550")
    design.stack("(HL)^4 H")
    print(len(design.layers), "layers, highest R", max(design.spectrum(400, 700).R))
```

`tfstudio.TFStudio()` starts TFStudio as a server, with no window, and the end of the `with` block ends it. Outside a `with` block, call `tf.close()` when the program is done with it; a program that ends without it ends its servers too. Each `TFStudio()` is a TFStudio of its own, so a program can start several and run them at the same time.

It looks for TFStudio in this order:

- the executable you name, as in `tfstudio.TFStudio(r"D:\Apps\TFStudio\TFStudio.exe")`
- the executable the environment variable `TFSTUDIO_EXE` names
- the TFStudio whose `resources\python` folder holds the package
- on Windows, the folder the installer recorded

`TFStudio()` refuses a TFStudio whose protocol version differs from the package's, with a message that says so.

The server uses the app's data folder, `Documents\TFStudio` unless you moved it in Preferences, so it sees the same materials. The app makes that folder on its first start. `data_dir=` names another one. `tf.info` says what it started with, such as `version`, `dataDir` and `unreadable`, the catalogs it could not read. The server keeps a log of its own, `api-server.log` next to the app.

## How the objects read in Python

- **Names.** Names are snake_case, and optional arguments are keyword arguments: `design.spectrum(400, 700, step=5, angles=[0, 45])`. The API Reference gives each name in Python beside its JavaScript form.
- **Designs change in place.** `stack()`, the layer edits, `refine()` and `synthesize()` change the design they are called on; `design.copy()` keeps a copy first.
- **Layers by number.** `design.layers[1]` is the layer next to the substrate, as the Design Editor numbers it; `len(design.layers)` counts them, and a `for` loop goes from layer 1 outward. `design.back_layers` are the back's.
- **Front, back and total.** `design.sides` and `design.score_on` decide what every spectrum, merit and run computes on, and each result's `mode` says which it was; the first table of the API Reference lists them.
- **Curves are lists.** `s.R` and the other quantities of a spectrum are lists of floats, one per wavelength in `s.wavelength`, so `max(s.R)`, `sum(s.R)` and plotting libraries take them; `s.R.mean(450, 650)`, `min()` and `max()` summarize a band.
- **Materials.** `tf.materials["TiO2"]` is a material by its id or name, `tf.materials.find("SiO2")` the materials whose id or name holds the text, and `.nk(550)` their n and k.
- **Paths.** A relative path in `tf.open_design()`, `save()` or `save_csv()` is taken from the program's working folder.
- **Refusals.** A call TFStudio refuses raises `tfstudio.TFStudioError`, with a message that starts with the method's name and says what it takes.

```python
import tfstudio

with tfstudio.TFStudio() as tf:
    design = tf.new_design("Mirror 550")
    design.stack("(HL)^3 H")
    s = design.spectrum(400, 700, step=10, angles=[0, 45])
    print("Rs at 400 nm and 45 degrees:", s.angle(45).Rs[0])
    try:
        design.layers.append("TiO2", -5)
    except tfstudio.TFStudioError as err:
        print(err)
```

## Runs

`refine()`, `synthesize()`, `monte_carlo()` and `specification.estimate_yield()` compute in the program's TFStudio, and the call returns when the run ends. `progress=` takes a function, which is called with a `tfstudio.Progress` each time the run reports. `stop=` takes a `tfstudio.Stop`, whose `stop()`, called from the progress function or from another thread, ends the run at its next step. A refinement or synthesis that is stopped leaves the design as it was.

Ctrl+C during a run stops it, then raises `KeyboardInterrupt`; the design keeps the layers it had. A run looks for the stop between its steps; if it has not stopped after 15 seconds, or you press Ctrl+C again, the server is ended, and the `TFStudio()` takes no more calls. An exception the progress function raises stops the run, and the exception goes on to the program.

A TFStudio makes one run at a time. Other calls, from other threads, are answered while it runs, and a second run is refused; for two runs at once, start a second `TFStudio()`.

```python
import tfstudio

with tfstudio.TFStudio() as tf:
    design = tf.new_design("AR 450-650")
    design.stack("(HL)^2")
    design.merit.add("RAV", 450, 650, target=0)
    run = design.refine(method="dls", max_iter=100, progress=lambda p: print("iteration", p.iteration, "merit", p.merit))
    print(run.stop_reason, "merit", run.merit)
```

## Work on the open design

With `live=True`, `tf.app` reaches the designs open in TFStudio, while TFStudio listens for programs. In TFStudio, click **Interactive** in the **Scripts** group of the **Optimization** tab. A window then holds the rest of the app. It reads "Waiting for a program to connect.", and once the program connects, "Connected:" and the program's name, `python.exe` on Windows. While it is open you cannot edit, switch designs or start runs, and the windows behind it keep showing the design as the program changes it. **Terminate** lets the program go and gives the app back; each change the program made stays, one Ctrl+Z step each.

`tf.app.designs()` lists the designs the app holds, and `tf.app.open_design()` copies the open one, or one named by its name or id, as a design the program changes as it changes any other. `design.push()` writes it back over the design it was read from, as one step Undo takes back; only the open design takes a push, and a design pushed can be changed and pushed again. The app treats what a program writes as it treats an AI agent's; the rules are on the [AI agents](/automation/ai-agents/#work-on-the-open-design) page.

**Start listening when TFStudio starts**, in Preferences, then Automation, has TFStudio listen from the moment it starts, for a program that runs while you are away from the app. TFStudio then asks before a program connects for the first time, with **Allow** and **Deny**, and only then holds the app; the answer stands until TFStudio closes. A program denied, or let go with Terminate, gets back in only through Interactive. The setting is off by default: while it is on, any program you run can ask to work on your designs, so leave it off unless you need it.

A call to `tf.app`, or a push, that the app does not take raises `tfstudio.AppError`, whose `code` says why:

| Code | Meaning |
| ---- | ------- |
| `off` | TFStudio is not running, it is not listening for programs, or Terminate let this program go. Click Interactive, then try again. |
| `timeout` | TFStudio did not answer in time; it may be busy. |
| `protocol` | The TFStudio that is open speaks another version of the link; start the program's TFStudio from that install. |
| `denied` | Deny was clicked when this program asked to connect. Interactive lets it in without asking. |
| `edited` | The design changed in TFStudio since it was read. Nothing was written; read it again and make the change on that copy. |
| `switched` | The design it was read from is no longer the open one. Nothing was written. |
| `optimizing` | A run is going in a TFStudio window. Nothing was written; push again once it ends. |
| `noDesign` | No design is open, and none was named. |
| `unknown` | TFStudio holds no design under that id. |
| `invalid` | TFStudio cannot take what was sent, such as a design it would not open from a file; the message says why. |

A design that was not read from the app, or that holds NaN or infinity, is refused before anything is sent, with `tfstudio.TFStudioError`.

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    design = tf.app.open_design()
    print("Open design:", design.name, "merit", design.merit.value)
    run = design.refine(method="dls", max_iter=100)
    design.push()
    print("Pushed, merit", run.merit, "(" + run.stop_reason + ")")
```

## Examples

### Write R, T and A for s and p to a file

A CSV file in the program's working folder, named by the time so that it writes over nothing, with the mirror's R, T and A for unpolarized light and for s and p at 45 degrees, one row per wavelength:

```python
import time
import tfstudio

with tfstudio.TFStudio() as tf:
    design = tf.new_design("Mirror 550")
    design.stack("(HL)^4 H")
    name = "mirror-45deg-{}.csv".format(time.time_ns())
    design.spectrum(400, 800, step=2, angles=[45]).save_csv(name)
    print("Wrote", name)
```

### Grow a design with Needle for at most a minute, and save it

Needle grows an antireflection coating over 420-680 nm from one SiO2 layer, with TiO2 and SiO2, up to 12 layers, and is stopped if it is still going after a minute. A run stopped this way leaves the design as it was, so the program saves the design, in its working folder, only when the run ended on its own:

```python
import time
import tfstudio

with tfstudio.TFStudio() as tf:
    design = tf.new_design("AR 420-680")
    design.layers.append("SiO2", 100)
    design.merit.add("RAV", 420, 680, target=0)
    stop = tfstudio.Stop()
    started = time.monotonic()

    def watch(p):
        if time.monotonic() - started > 60:
            stop.stop()

    run = design.synthesize("needle", pool=["TiO2", "SiO2"], max_layers=12, progress=watch, stop=stop)
    if run.stop_reason == "stopped":
        print("Stopped after a minute, with the design as it was; nothing saved")
    else:
        name = "needle-ar-{}.tfs".format(time.time_ns())
        design.save(name)
        print("Saved", name, "with", len(design.layers), "layers (" + run.stop_reason + ")")
```

`refine()` and `synthesize()` work against the design's merit function: set it in the [Merit Function Editor](/design/merit-function-editor/) and save the design for `tf.open_design()` to read, or add its rows with `design.merit.add()` as above.
