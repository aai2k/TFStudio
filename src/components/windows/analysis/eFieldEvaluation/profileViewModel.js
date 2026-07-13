export function selectPlottedCurves(profileData, pol) {
    if (!profileData) return [];
    const curves = [];
    const push = (e2arr, z, label) => {
        if (!e2arr || !z) return;
        curves.push({ label, z, y: e2arr.map(v => v * 100) });
    };
    if (pol === 'avg' && profileData.avg) {
        push(profileData.avg.e2, profileData.avg.z, '|E|² (avg)');
        push(profileData.s.e2, profileData.s.z, '|E|² (s)');
        push(profileData.p.e2, profileData.p.z, '|E|² (p)');
    } else if (pol === 's' && profileData.s) {
        push(profileData.s.e2, profileData.s.z, '|E|² (s)');
    } else if (pol === 'p' && profileData.p) {
        push(profileData.p.e2, profileData.p.z, '|E|² (p)');
    }
    return curves;
}

export function buildProfileViewModel(profile, pol) {
    const profileForInfo = profile
        ? (pol === 'avg' ? profile.avg : profile[pol])
        : null;
    const maxE2pct = profileForInfo
        ? (Math.max(...profileForInfo.e2) * 100).toFixed(1)
        : '—';
    const totalThkNm = profileForInfo?.layerBounds
        ? profileForInfo.layerBounds[profileForInfo.layerBounds.length - 1].toFixed(1)
        : '—';
    return {
        maxE2pct,
        totalThkNm,
        layerCount: profile?.validLayers?.length ?? 0,
    };
}

export function buildProfileTable(profile, pol) {
    const curves = selectPlottedCurves(profile, pol);
    if (!curves.length) return null;
    const zArr = curves[0].z;
    const columns = [
        { key: 'z', label: 'z (nm)', align: 'left', fmt: v => v.toFixed(1) },
        ...curves.map((cv, i) => ({ key: 'c' + i, label: cv.label, fmt: v => (v == null ? '' : v.toFixed(4)) })),
    ];
    const rows = zArr.map((z, i) => {
        const row = { z };
        curves.forEach((cv, j) => { row['c' + j] = cv.y[i]; });
        return row;
    });
    return { columns, rows };
}
