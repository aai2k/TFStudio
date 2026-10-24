"""TFStudio(): the TFStudio a program starts, with its designs, materials and
the app that is open."""

import numbers

from ._calls import Calls
from ._design import Design
from ._errors import TFStudioError
from ._material_dispersion import MaterialDispersion
from ._measured import ellipsometry_file, spectrum_file
from ._names import api_names
from ._refusals import Words, refuse_arguments, worded

# How designs may name a built-in material besides its bare id: the form the
# Design Editor and stack() write, which findMaterials does not list.
BUILTIN = "builtin:"
# material.dispersion() takes the range as its arguments.
_DISPERSION_WORDS = Words("materialDispersion", "dispersion", hidden=("from", "to"))
_DISPERSION_OPTIONS = ("thickness",)


class Material:
    """A material of TFStudio's catalogs, as tf.materials gives it.

    Example::

        tio2 = tf.materials["TiO2"]
        print(tio2.id, tio2.name, tio2.catalog, tio2.nk(550))
    """

    def __init__(self, calls, found):
        self._calls = calls
        self._found = found

    @property
    def id(self):
        """The id designs name the material by: a built-in material's short
        id, such as TiO2, which can differ from its name, such as
        TiO2 (anatase); or catalog:key for a material of another catalog. A
        design may also hold a built-in material as builtin:TiO2, the form
        the Design Editor and stack() write, which tf.materials takes too.

        Example::

            design = tf.new_design("AR")
            design.layers.append(tf.materials["MgF2"].id, 95)
            print(design.layers[1].material)
        """
        return self._found["id"]

    @property
    def name(self):
        """The name the app shows.

        Example::

            print(tf.materials["TiO2"].name)
        """
        return self._found["name"]

    @property
    def catalog(self):
        """The catalog the material is in, "builtin" for a built-in one.

        Example::

            print(tf.materials["TiO2"].catalog)
        """
        return self._found["catalog"]

    def nk(self, wavelengths):
        """n and k of the material, as the Material Dispersion window shows
        them; outside the range its data cover they are held at the edge
        value or extrapolated.

        Args:
            wavelengths: One wavelength, nm, or several.

        Returns:
            (n, k) for one wavelength; for several, (ns, ks), a list of n and
            a list of k, one of each per wavelength.

        Raises:
            TFStudioError: a wavelength of 0 or less.

        Example::

            n, k = tf.materials["TiO2"].nk(550)
            ns, ks = tf.materials["TiO2"].nk([400, 550, 700])
            print(n, k, ns, ks)
        """
        one = isinstance(wavelengths, numbers.Real)
        with worded(Words("materialNK", "nk")):
            nk = self._calls.materialNK(self.id, [wavelengths] if one else list(wavelengths))["nk"]
        n, k = [point["n"] for point in nk], [point["k"] for point in nk]
        return (n[0], k[0]) if one else (n, k)

    @property
    def range(self):
        """The range of wavelengths the material's data cover, [first, last]
        in nm, or None when it states none, as a formula with no stated
        range.

        Example::

            print("TiO2 has data from", tf.materials["TiO2"].range)
        """
        # materialNK reports the range beside n and k; the wavelength asked is any one.
        return self._calls.materialNK(self.id, [550])["rangeNm"]

    def dispersion(self, start=None, end=None, **options):
        """Phase, group delay, GDD, CDC and TOD of light through a slab of
        the material, and its group index, against wavelength, as the
        Material Dispersion window computes them: φ = −(d/c)·ω·n of the slab
        of thickness d and its derivatives against ω, from the material's
        formula or its table read as the app reads it, so the values are
        analytic at each wavelength and the phase is absolute. The
        wavelengths are the window's, 2000 steps over the range and never
        finer than 0.2 nm, with a sample on each table knot in range. Light
        the slab absorbs to an optical depth above 50 leaves no value.

        Args:
            start: The first wavelength, nm. Default 400.
            end: The last wavelength, nm, above start. Default 1100.
            thickness: The slab's thickness, mm, from 1e-9 (1 pm) to 100000
                (100 m). Default 1.

        Returns:
            A MaterialDispersion.

        Raises:
            TFStudioError: a range that is not one, or a thickness outside
                1e-9 to 100000 mm.

        Example::

            d = tf.materials["BK7"].dispersion(700, 900, thickness=2)
            print("2 mm of BK7: GDD from", round(d.gdd.min(), 1), "to", round(d.gdd.max(), 1), "fs²")
        """
        refuse_arguments("dispersion", options, ("from", "to"), _DISPERSION_OPTIONS)
        with worded(_DISPERSION_WORDS):
            return MaterialDispersion(self._calls.materialDispersion(
                self.id, api_names({**options, "from": start, "to": end})))

    def __repr__(self):
        return "<Material {} ({}, {})>".format(self.id, self.name, self.catalog)


class Materials:
    """The materials of TFStudio's catalogs: the built-in ones and those of
    the catalogs in the data folder.

    Example::

        n, k = tf.materials["TiO2"].nk(550)
        print(n, k, len(tf.materials.find("SiO2")))
    """

    def __init__(self, calls):
        self._calls = calls

    def __getitem__(self, id_or_name):
        """The material with this id, or else with this name. A built-in
        material's id may be given as builtin:TiO2, as a layer's material can
        hold it.

        Args:
            id_or_name: The material's id, or its name.

        Returns:
            A Material.

        Raises:
            TFStudioError: no material with this id or name, or several with
                this name and none with this id.

        Example::

            print(tf.materials["TiO2"])
        """
        key = id_or_name[len(BUILTIN):] if str(id_or_name).startswith(BUILTIN) else id_or_name
        found = self._calls.findMaterials(key)
        exact = [m for m in found if m["id"] == key] or [m for m in found if m["name"] == id_or_name]
        if len(exact) == 1:
            return Material(self._calls, exact[0])
        if exact:
            raise TFStudioError("materials: {} materials are named {!r}: take one by its id, {}"
                                .format(len(exact), id_or_name, ", ".join(m["id"] for m in exact)))
        raise TFStudioError("materials: no material has the id or name {!r}; tf.materials.find({!r}) lists those "
                            "whose id or name holds it".format(id_or_name, id_or_name))

    def find(self, text=""):
        """The materials whose id or name holds `text`, in upper or lower case.

        Args:
            text: The text to look for; empty finds every material. Default "".

        Returns:
            The materials found, each a Material.

        Example::

            for m in tf.materials.find("TiO2"):
                print(m.id, m.catalog)
        """
        return [Material(self._calls, found) for found in self._calls.findMaterials(text)]

    def __repr__(self):
        return "<Materials: tf.materials[id or name], tf.materials.find(text)>"


class AppDesign:
    """A design open in the TFStudio app, as tf.app.designs() lists it.

    Example::

        import tfstudio

        with tfstudio.TFStudio(live=True) as tf:
            for d in tf.app.designs():
                print(d.id, d.name, d.active)
    """

    def __init__(self, listed):
        self._listed = listed

    @property
    def id(self):
        """The design's id in the app, which tf.app.open_design() takes.

        Example::

            import tfstudio

            with tfstudio.TFStudio(live=True) as tf:
                first = tf.app.designs()[0]
                print(first.id, tf.app.open_design(first.id).name)
        """
        return self._listed["appDesignId"]

    @property
    def name(self):
        """The design's name.

        Example::

            import tfstudio

            with tfstudio.TFStudio(live=True) as tf:
                print([d.name for d in tf.app.designs()])
        """
        return self._listed["name"]

    @property
    def folder(self):
        """The project folder the design is in, as the Project Explorer shows
        it, or None.

        Example::

            import tfstudio

            with tfstudio.TFStudio(live=True) as tf:
                for d in tf.app.designs():
                    print(d.name, d.folder)
        """
        return self._listed.get("folder")

    @property
    def active(self):
        """True for the design open in the app now, the only one push() can
        write.

        Example::

            import tfstudio

            with tfstudio.TFStudio(live=True) as tf:
                print([d.name for d in tf.app.designs() if d.active])
        """
        return self._listed["active"]

    @property
    def unsaved(self):
        """True when the design has changes not saved to its file.

        Example::

            import tfstudio

            with tfstudio.TFStudio(live=True) as tf:
                print([d.name for d in tf.app.designs() if d.unsaved])
        """
        return self._listed.get("unsaved")

    @property
    def layer_count(self):
        """How many layers the design's front has.

        Example::

            import tfstudio

            with tfstudio.TFStudio(live=True) as tf:
                for d in tf.app.designs():
                    print(d.name, d.layer_count)
        """
        return self._listed.get("frontLayers")

    @property
    def back_layer_count(self):
        """How many layers the design's back has.

        Example::

            import tfstudio

            with tfstudio.TFStudio(live=True) as tf:
                for d in tf.app.designs():
                    print(d.name, d.back_layer_count)
        """
        return self._listed.get("backLayers")

    def __repr__(self):
        return "<AppDesign {} {!r}{}>".format(self.id, self.name, ", open" if self.active else "")


class App:
    """The TFStudio app that is open, for a TFStudio() started with
    live=True, while the app listens for programs: click Interactive on its
    Optimization tab first. The app's window then waits for the program
    until Terminate is clicked there, and names it as this Python's
    executable, python.exe on Windows. Terminate lets the program go: the
    app then refuses it with "off", even while it listens for programs,
    until Interactive is clicked again. A design read here is changed as
    any design is, and design.push() writes it back as one step the app
    can undo.

    Example::

        import tfstudio

        with tfstudio.TFStudio(live=True) as tf:
            design = tf.app.open_design()
            design.layers[1].thickness += 5
            design.push()
            print("Layer 1 of", design.name, "is now", design.layers[1].thickness, "nm")
    """

    def __init__(self, calls):
        self._calls = calls

    def designs(self):
        """The designs the app holds.

        Returns:
            A list of AppDesign.

        Raises:
            TFStudioError: a TFStudio() started without live=True.
            AppError: the app cannot be reached, with code "off" when it is
                closed or not listening for this program, "denied" when
                Deny was clicked there for this program.

        Example::

            import tfstudio

            with tfstudio.TFStudio(live=True) as tf:
                for d in tf.app.designs():
                    print(d.name, "(open)" if d.active else "")
        """
        with worded(Words("app.designs", "designs")):
            listed = self._calls.app("designs")["designs"]
        return [AppDesign(design) for design in listed]

    def open_design(self, design=None):
        """A copy of a design the app holds, to change and push() back.

        Args:
            design: The design's id or name, or an AppDesign from designs().
                Default: the design open in the app.

        Returns:
            A Design.

        Raises:
            TFStudioError: a TFStudio() started without live=True, an id or
                name the app holds no design of, or a name several designs
                have.
            AppError: the app cannot be reached, or holds no design.

        Example::

            import tfstudio

            with tfstudio.TFStudio(live=True) as tf:
                design = tf.app.open_design()
                print("The open design:", design.name, len(design.layers), "layers")
                last = tf.app.open_design(tf.app.designs()[-1].name)
                print("By name:", last.name)
        """
        options = None if design is None else {"appDesignId": self._app_design_id(getattr(design, "id", design))}
        with worded(Words("app.read", "open_design")):
            answer = self._calls.app("read", options)
        return Design(self._calls, answer["design"], (answer["appDesignId"], answer["revision"]))

    def _app_design_id(self, id_or_name):
        with worded(Words("app.designs", "open_design")):
            listed = self._calls.app("designs")["designs"]
        exact = [d for d in listed if d["appDesignId"] == id_or_name] or [d for d in listed if d["name"] == id_or_name]
        if len(exact) == 1:
            return exact[0]["appDesignId"]
        if exact:
            raise TFStudioError("open_design: {} designs in the app are named {!r}: give one of their ids, {}"
                                .format(len(exact), id_or_name, ", ".join(d["appDesignId"] for d in exact)))
        raise TFStudioError("open_design: the app holds no design with the id or name {!r}; tf.app.designs() "
                            "lists them".format(id_or_name))

    def __repr__(self):
        return "<App: tf.app.designs(), tf.app.open_design()>"


class TFStudio:
    """TFStudio, started by this program with no window, computing as the
    app does. A with block ends it at its end, and close() ends it too.
    Without either, it ends once the program holds neither it nor anything
    it gave: a design, a material, tf.materials or tf.app. A design returned
    from a function that made its own TFStudio() therefore still computes.

    Args:
        exe: TFStudio's executable. Default: the one TFSTUDIO_EXE names,
            else the TFStudio this package came with, else the TFStudio the
            installer recorded.
        live: True links it to the TFStudio app that is open, whose designs
            tf.app reads and writes. Default False.
        data_dir: A TFStudio data folder whose material catalogs it uses in
            place of the app's. Default: the app's.

    Raises:
        ServerError: TFStudio was not found, could not start, or speaks
            another protocol than this package.

    Example::

        import tfstudio

        with tfstudio.TFStudio() as tf:
            design = tf.new_design("Mirror")
            design.stack("(HL)^4 H")
            print(max(design.spectrum(400, 700).R))
    """

    def __init__(self, exe=None, *, live=False, data_dir=None):
        self._use(Calls(exe, live, data_dir))

    @classmethod
    def _on(cls, calls):
        """A TFStudio on `calls`, the Calls of a server that is running
        already, as the Script Console gives the script it runs
        (_console.py)."""
        tf = cls.__new__(cls)
        tf._use(calls)
        return tf

    def _use(self, calls):
        self._calls = calls
        self._materials = Materials(calls)
        self._app = App(calls)
        self._design = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    @property
    def design(self):
        """In the Script Console, the design open in the app when the script
        started, a Design, or None when none was open; None in a program.
        When the script ends, the design left here, whether tf.design was
        changed in place or set to another Design, is applied to the open
        design as one step Undo takes back, if that design has not changed
        meanwhile. The open design
        keeps its name, which is its file's, so nothing is applied when the
        design holds what it started with but for its name.

        Example::

            if tf.design:
                print("The open design is", tf.design.name, "with", len(tf.design.layers), "front layers")
            else:
                print("No design is open")
        """
        return self._design

    @design.setter
    def design(self, design):
        self._design = design

    @property
    def info(self):
        """What the TFStudio serving this program said as it started, a
        dict: version, wasm (whether the fast kernel loaded), dataDir (the
        data folder, or None), unreadable (catalogs it could not read) and
        live.

        Example::

            print(tf.info["version"], tf.info["dataDir"])
        """
        return self._calls.info

    @property
    def materials(self):
        """The materials of TFStudio's catalogs, a Materials.

        Example::

            n, k = tf.materials["TiO2"].nk(550)
            print(n, k)
        """
        return self._materials

    @property
    def app(self):
        """The TFStudio app that is open, an App, for a TFStudio() started
        with live=True.

        Example::

            import tfstudio

            with tfstudio.TFStudio(live=True) as tf:
                print(tf.app.open_design().name)
        """
        return self._app

    def new_design(self, name="New Design", *, substrate="BK7", reference=550):
        """A new design as the app makes one: a bare substrate in air, with
        no layers, coated on the front and scored on its coated side.

        Args:
            name: The design's name. Default "New Design".
            substrate: The substrate material, by id. Default "BK7".
            reference: The reference wavelength, nm, at which stack formulas
                count quarter waves. Default 550.

        Returns:
            A Design.

        Raises:
            TFStudioError: a material id that resolves to nothing, or a
                reference wavelength of 0 or less.

        Example::

            design = tf.new_design("Mirror 550", substrate="BK7", reference=550)
            print(design)
        """
        with worded(Words("newDesign", "new_design", {"referenceWavelength": "reference"})):
            made = self._calls.newDesign({"name": name, "substrate": substrate, "referenceWavelength": reference})
        return Design(self._calls, made)

    def open_design(self, path):
        """A design read from a .tfs file, as File > Open reads it, with the
        same checks and repairs.

        Args:
            path: The file. A relative path is taken from the program's
                working folder: in the Script Console, the script's folder,
                or the data folder for a script not saved.

        Returns:
            A Design.

        Raises:
            TFStudioError: a file that cannot be read or does not hold a
                usable design.

        Example::

            import time

            name = "mirror-{}.tfs".format(time.time_ns())
            mirror = tf.new_design("Mirror")
            mirror.stack("(HL)^4 H")
            mirror.save(name)
            design = tf.open_design(name)
            print(design.name, len(design.layers), "layers, from", name)
        """
        return Design(self._calls, self._calls.openDesign(path))

    def read_spectrum_file(self, path, **options):
        """Reads a spectrum file as the Measured Spectra window's import
        reads it: a CSV or text table, one curve per column after the
        wavelength column, or a JCAMP-DX file, one curve per spectrum, each
        what the window would add to a design. The keywords take the place of
        the import panel's settings, which ask only what the file leaves
        unsaid: an angle or a polarization the file states, in its header
        lines or in a column's heading, is kept, as in the window.

        Args:
            path: The file. A relative path is taken as open_design() takes it.
            angle: The angle of incidence, degrees, for the curves whose file
                states none. Default: 0 where neither does.
            pol: "avg", "s" or "p", for the curves whose file states none.
                Default: "avg" where neither does. A column headed with its
                polarization, such as Rs, keeps it, and an A column headed
                with none is "avg".
            quantity: For a table, "T", "R" or "A" for every column. Default:
                what each column's heading says, and T where it says none.
            scale: For a table, how every column's values are written:
                "fraction", "percent" or "absorbance". Default: what the
                import makes of each column.
            x_unit: For a table, the unit of its wavelength column: "nm",
                "um", "cm-1" or "eV". Default: what the import makes of it.

        Returns:
            A SpectrumFile, a named tuple: format, "table" or "jcamp";
            file_name; x_unit, the unit a table's wavelengths were read in,
            or None; skipped_rows, lines of a table that held no row; and
            curves, each a MeasuredCurve, a named tuple of name, quantity,
            angle, pol, wavelength and values, the wavelengths in nm rising
            and R, T and A as fractions of 1, which design.compare_measured()
            takes.

        Raises:
            TFStudioError: a file that cannot be read or holds no spectrum the
                import reads, an option it does not take or a value an option
                cannot take, or for a JCAMP-DX file an option other than angle
                and pol.

        Example::

            import time

            name = "scan-{}.csv".format(time.time_ns())
            with open(name, "w") as f:
                f.write("Wavelength (nm),%R\\n450,2.1\\n550,0.9\\n650,1.8\\n")
            scan = tf.read_spectrum_file(name).curves[0]
            print(scan.name, scan.quantity, scan.wavelength, scan.values)
        """
        with worded(Words("readSpectrumFile", "read_spectrum_file")):
            return spectrum_file(self._calls.readSpectrumFile(path, api_names(options)))

    def read_ellipsometry_file(self, path, **options):
        """Reads an ellipsometer file as the Measured Ellipsometry window's
        import reads it: a table of a wavelength column and columns of Psi
        and Delta in degrees, each column typed as the window types it, the
        curves the window's Add all adds. The keywords take the place of the
        import panel's settings: an angle the file states, in its header
        lines or in a column's heading, is kept, as in the window, and the
        side its header states fills the panel, which side replaces.

        Args:
            path: The file. A relative path is taken as open_design() takes it.
            angle: The angle of incidence, degrees, for the columns whose file
                states none. Default: 70 where neither does.
            side: "front" or "back", the side measured. Default: the side the
                file's header states, or "front".
            delta_convention: The sign the file writes Delta in: "azzam" or
                "reversed", 360 degrees less it. Default "azzam".
            x_unit: The unit of the wavelength column: "nm", "um", "cm-1" or
                "eV". Default: what the import makes of it.
            quantities: Each column's type, in the file's order: "PSI", "DEL",
                or None for the type the import gives it; a column with no
                type is left out.

        Returns:
            An EllipsometryFile, a named tuple: file_name; x_unit, the unit
            the wavelengths were read in; skipped_rows, lines that held no
            row; and curves, each an EllipsometryCurve, a named tuple of name,
            quantity ("PSI" or "DEL"), angle, side, delta_convention (None for
            Psi), cos_delta (True for a Delta that looks like cos Delta),
            wavelength and values, the wavelengths in nm rising and the values
            in degrees, which design.add_measured_curves() and
            design.compare_measured() take.

        Raises:
            TFStudioError: a file that cannot be read or holds no table of
                numbers, an option it does not take or a value an option
                cannot take.

        Example::

            import time

            name = "witness-{}.csv".format(time.time_ns())
            with open(name, "w") as f:
                f.write("# AOI 65 deg, front side\\nWavelength (nm),Psi (deg),Delta (deg)\\n500,24.9,242.6\\n600,20.7,218.4\\n")
            psi, delta = tf.read_ellipsometry_file(name).curves
            print(psi.angle, psi.values, delta.values)
        """
        with worded(Words("readEllipsometryFile", "read_ellipsometry_file")):
            return ellipsometry_file(self._calls.readEllipsometryFile(path, api_names(options)))

    def export_measured_curves(self, design, path, **options):
        """Writes measured curves a design holds to a file as the Export tab
        writes them: Measured Spectra's for R, T and A, as CSV, its condition
        lines above the columns, or as JCAMP-DX; Measured Ellipsometry's for
        Psi and Delta, as CSV in degrees. Without keywords, the window's
        factory format: CSV, nm, R, T and A in percent.

        Args:
            design: The design, a Design.
            path: The file to write. A relative path is taken as
                open_design() takes it.
            curves: The names of the curves written, all R, T and A or all
                Psi and Delta. Default: every R, T and A curve the design
                holds, or its Psi and Delta when it holds none.
            format: "csv", or "jcamp" for JCAMP-DX, which R, T and A take.
                Default "csv".
            x_unit: The unit of the wavelength column: "nm", "um" or "cm-1"
                for R, T and A, "nm", "um" or "eV" for Psi and Delta. Default
                "nm".
            scale: For R, T and A, "percent" or "fraction". Default "percent".
            overwrite: True writes over a file that is already there.
                Default False.

        Raises:
            TFStudioError: a design that is not a Design or holds no measured
                curve, a name of a curve it does not hold, curves of both
                kinds, an option it does not take or a value an option cannot
                take, or a file that is already there, without overwrite.

        Example::

            import time

            name = "bench-{}.csv".format(time.time_ns())
            design = tf.new_design("AR")
            design.add_measured_curves({"name": "Bench R", "quantity": "R", "angle": 8,
                                        "wavelength": [450, 550, 650], "values": [0.021, 0.009, 0.018]})
            tf.export_measured_curves(design, name, scale="fraction")
            print(open(name).read())
        """
        if not isinstance(design, Design):
            raise TFStudioError("export_measured_curves: design is a Design, as tf.new_design() or tf.open_design() gives one")
        with worded(Words("exportMeasuredCurves", "export_measured_curves")):
            self._calls.exportMeasuredCurves(design._data, path, api_names(options))

    def close(self):
        """Ends the TFStudio serving this program, after stopping a run it
        is making. Designs from it cannot compute after this.

        Example::

            import tfstudio

            tf = tfstudio.TFStudio()
            print(tf.info["version"])
            tf.close()
        """
        self._calls.close()

    def __repr__(self):
        return "<TFStudio {}{}>".format(self.info.get("version"), ", live" if self.info.get("live") else "")
