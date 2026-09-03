// Low-emissivity and solar-control coatings. Field reference: ../entryModel.js.
export const LOW_E = [
    {
        id: 'heat-mirror-zns-ag-zns',
        name: 'Heat mirror, ZnS/Ag/ZnS, 3 layers',
        type: 'lowE',
        tags: ['visible', 'nir', 'solar', 'glazing', 'heat-mirror', 'induced-transmission', 'metal-dielectric', 'silver'],
        use: 'Use this on a window that has to stay clear to the eye but turn back the heat: architectural glazing, a lamp envelope, or the front glass of an instrument standing in sunlight. One thin silver layer does the reflecting and the two zinc sulphide layers match it into air and glass so the silver still transmits.',
        limitations: 'The silver layer is 20 nm and needs diffusion barriers in production, otherwise it tarnishes; the design here is the optical stack only. Visible transmission falls to about 66% at the blue end of the band. Reflection is claimed to 1900 nm because the built-in silver data stops at 1937 nm; the real gain of a heat mirror lies further out in the thermal infrared, which this data cannot describe.',
        source: 'Macleod, Thin-Film Optical Filters, 5th ed., section 11.4.3 Heat-Reflecting Metal-Dielectric Coatings: the three-layer Air | ZnS | Ag | ZnS | Glass design of Figure 11.39, quoted there with optical thicknesses of 0.146 and 0.141 of a wavelength at a reference wavelength of 600 nm. Those optical thicknesses were converted with the built-in ZnS data and the silver set to 20 nm, thick enough to reflect the near infrared and thin enough to stay transmitting in the visible. The same section names the TiO2/Ag/TiO2 transparent heat mirror of Fan, Bachner, Foley et al., Applied Physics Letters 25, 693 (1974) as the origin of this family.',
        incidentMedium: 'builtin:Air',
        substrate: 'builtin:BK7',
        referenceWavelength: 600,
        bands: [[420, 680], [1000, 1900]],
        aoi: 0,
        polarization: 'avg',
        preview: [380, 1900],
        layers: [
            { material: 'builtin:ZnS', thickness: 35.92 },
            { material: 'builtin:Ag', thickness: 20.00 },
            { material: 'builtin:ZnS', thickness: 37.20 },
        ],
        spec: [
            { kind: 'T_AVG', channel: 'T', cmp: 'ge', band: 0, target: 0.80, label: 'T avg 420-680 nm ≥ 80%' },
            { kind: 'MIN_MAX', channel: 'T', direction: 'min', cmp: 'ge', band: 0, target: 0.60, label: 'T min 420-680 nm ≥ 60%' },
            { kind: 'R_AVG', channel: 'R', cmp: 'ge', band: 1, target: 0.85, label: 'R avg 1000-1900 nm ≥ 85%' },
            { kind: 'MIN_MAX', channel: 'R', direction: 'min', cmp: 'ge', band: 1, target: 0.70, label: 'R min 1000-1900 nm ≥ 70%' },
        ],
    },
];
