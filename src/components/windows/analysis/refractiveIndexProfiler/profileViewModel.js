const singleColumns = [
    { key: 'z', label: 'z (nm)', align: 'left', fmt: v => v.toFixed(1) },
    { key: 'n', label: 'n',                      fmt: v => v.toFixed(4) },
    { key: 'k', label: 'k',                      fmt: v => v.toFixed(5) },
];

const totalColumns = [
    { key: 'region', label: 'region', align: 'left', fmt: v => v },
    { key: 'z',      label: 'z',       align: 'left', fmt: (v, row) => `${(+v).toFixed(3)} ${row?.unit || ''}`.trim() },
    { key: 'n',      label: 'n',                       fmt: v => v.toFixed(4) },
    { key: 'k',      label: 'k',                       fmt: v => v.toFixed(5) },
];

function accumulateNRange(summary, values) {
    for (const value of values) {
        if (value < summary.minN) summary.minN = value;
        if (value > summary.maxN) summary.maxN = value;
    }
}

function accumulateCoating(summary, layers) {
    for (const layer of layers) {
        summary.coatThk += layer.d;
        summary.coatOpt += layer.n * layer.d;
        summary.coatN++;
    }
}

function buildTotalSummary(regions, hasProfile) {
    const summary = { minN: Infinity, maxN: -Infinity, coatThk: 0, coatOpt: 0, coatN: 0 };
    for (const region of regions) {
        accumulateNRange(summary, region.n || []);
        if (region.key !== 'substrate') {
            accumulateCoating(summary, region.validLayers || []);
        }
    }
    return {
        nRangeStr: hasProfile && isFinite(summary.minN)
            ? `${summary.minN.toFixed(3)} – ${summary.maxN.toFixed(3)}`
            : '—',
        totalThkStr: hasProfile ? summary.coatThk.toFixed(1) : '—',
        optThkStr: hasProfile ? summary.coatOpt.toFixed(1) : '—',
        layerCount: summary.coatN,
    };
}

function buildSingleSummary(profile) {
    return {
        nRangeStr: profile ? `${profile.minN.toFixed(3)} – ${profile.maxN.toFixed(3)}` : '—',
        totalThkStr: profile ? profile.totalThk.toFixed(1) : '—',
        optThkStr: profile ? profile.optThk.toFixed(1) : '—',
        layerCount: profile?.validLayers?.length ?? 0,
    };
}

export function buildProfileTable(isTotal, profile, regions) {
    if (!isTotal) {
        return {
            columns: singleColumns,
            rows: profile?.z
                ? profile.z.map((z, i) => ({ z, n: profile.n[i], k: profile.k[i] }))
                : [],
        };
    }

    const rows = [];
    for (const r of regions) {
        if (!r.z) continue;
        for (let i = 0; i < r.z.length; i++) {
            rows.push({ region: r.label, unit: r.unit, z: r.z[i], n: r.n[i], k: r.k[i] });
        }
    }
    return { columns: totalColumns, rows };
}

export function buildProfileViewModel(side, profile, regions) {
    const isTotal = side === 'total';
    const hasProfile = isTotal ? regions.length > 0 : !!profile;
    const summary = isTotal
        ? buildTotalSummary(regions, hasProfile)
        : buildSingleSummary(profile);
    const table = buildProfileTable(isTotal, profile, regions);
    return { isTotal, hasProfile, ...summary, tableColumns: table.columns, tableRows: table.rows };
}
