# tfstudio

Design and compute optical thin-film coatings from Python with [TFStudio](https://tfstudio.xyz), the open-source thin-film design program. The package computes with the code TFStudio's windows compute with, so its numbers are the app's.

```python
import tfstudio

with tfstudio.TFStudio() as tf:
    design = tf.new_design("Mirror 550", substrate="BK7", reference=550)
    design.stack("(HL)^4 H", H="TiO2", L="SiO2")
    s = design.spectrum(400, 700, step=5)
    print(max(s.R))
```

`TFStudio()` starts a TFStudio with no window that computes for the program, and the end of the `with` block ends it. With `live=True`, once Interactive is clicked on the TFStudio app's Optimization tab, `tf.app.open_design()` reads the design open in the app, and `design.push()` writes it back.

## Install

The package needs Python 3.8 or newer and no other package. It comes with TFStudio, in the `resources/python` folder of TFStudio's install folder, the folder that holds this file. Run `install.py` from there with the Python your programs use:

```bash
python "C:\Users\you\AppData\Local\Programs\TFStudio\resources\python\install.py"
```

It writes `tfstudio.pth`, which points that Python at this folder, into its site-packages folder, or into your own when that one cannot be written, and prints where it wrote it; to uninstall, delete that file. The package is then the one of the TFStudio it came with, updated with it, and it starts that TFStudio. For a virtual environment, run `install.py` with the environment's Python.

On Linux, the deb package puts the folder at `/opt/TFStudio/resources/python`. An AppImage's files exist only while it runs: run it once with `--appimage-extract`, which writes them to a `squashfs-root` folder in the current folder, and run `install.py` from `squashfs-root/resources/python`.

## Documentation

- [Python](https://docs.tfstudio.xyz/automation/python/): starting TFStudio, designs and their layers, spectra, merit, runs and their progress, and working on the open design.
- [API Reference](https://docs.tfstudio.xyz/automation/api-reference/): each object, method and attribute in Python and in JavaScript, with the settings the runs take and the reasons they end.

## From a source checkout

A source checkout of TFStudio, after `npm ci`, serves the API on Node.js: name its folder as `TFStudio(r"path\to\TFStudio")` or in `TFSTUDIO_EXE`. Its server has the built-in materials and the ones a design carries, unless `data_dir=` names a data folder.

License: MIT.
