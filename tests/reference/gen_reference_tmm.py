#!/usr/bin/env python3
"""
Independent third-party reference generator for the TFStudio cross-tool
validation. Uses Steven Byrnes' `tmm` package (MIT; Byrnes, "Multilayer optical
calculations", arXiv:1603.02720) — a peer-reviewed, community-standard transfer-
matrix implementation written by a different author in a different language.

It emits `reference_tmm.json`, a set of coating cases with R, T, A, the complex
reflection/transmission amplitudes r, t (which pin BOTH magnitude and phase, so
they underlie GD/GDD), ellipsometric Psi/Delta, and |E|^2 field values at fixed
depths. The JS side (`cross_tool_validation.mjs`) feeds the SAME complex indices
and thicknesses into the TFStudio engine and diffs against these numbers.

Convention note: `tmm` uses n = n + i*k with k > 0 for loss, angle in radians,
thicknesses and wavelengths in the same length unit (nm here) — identical to
TFStudio, so the inputs are byte-identical and only the MATH is under test.

Requires: pip install tmm numpy
Run:      python tests/reference/gen_reference_tmm.py
"""
import json, cmath, math
import numpy as np
from tmm import coh_tmm, ellips, position_resolved

INF = np.inf

# ── Non-dispersive complex indices (identical on both sides) ─────────────────
# Chosen to span the regimes; values are representative, NOT tied to a
# dispersion model, so the comparison is a pure MATH test free of any material-
# data confound.
AIR   = 1.0
GLASS = 1.52
MgF2  = 1.38
SiO2  = 1.46
TiO2  = 2.35
Ta2O5 = 2.10
aSi   = 3.90 + 0.02j      # weakly absorbing high-index semiconductor
Ag    = 0.055 + 3.32j     # silver near 520 nm
Cr    = 3.00 + 3.30j      # lossy metal

def qw(n, lam0):           # quarter-wave physical thickness at lam0
    return lam0 / (4 * n.real if isinstance(n, complex) else 4 * n)

# ── Case definitions ─────────────────────────────────────────────────────────
# Each case: n_list / d_list in tmm order (incident … substrate), first & last
# thickness = INF. `spectral` points sample R/T/A/r/t; `ellips` sample Psi/Delta;
# `efield` sample |E|^2 at (layer, distance-from-layer-front).
cases = []

def C(x):  # complex → [re, im] for JSON
    z = complex(x); return [z.real, z.imag]

def add_case(name, desc, n_list, d_list, spectral, ellips_pts=None, efield_pts=None):
    cases.append(dict(name=name, desc=desc,
                      n_list=[C(n) for n in n_list],
                      d_list=[('inf' if (d == INF) else d) for d in d_list],
                      spectral=spectral, ellips=ellips_pts or [], efield=efield_pts or []))

lam_grid = [400, 450, 500, 532, 550, 600, 633, 700, 800, 1000, 1064]

# 1) Single-layer MgF2 AR (quarter-wave) on glass — the classic v-coat check
d1 = qw(MgF2, 550)
add_case("MgF2 QW AR / glass",
         "Single quarter-wave MgF2 on glass, normal incidence (classic AR).",
         [AIR, MgF2, GLASS], [INF, d1, INF],
         [dict(lam=l, th=0, pol='s') for l in lam_grid])

# 2) Quarter-wave dielectric mirror (H L)^8 H on glass — high reflector
HR = []
for _ in range(8):
    HR += [(TiO2, qw(TiO2, 550)), (SiO2, qw(SiO2, 550))]
HR += [(TiO2, qw(TiO2, 550))]
n2 = [AIR] + [n for n, _ in HR] + [GLASS]
d2 = [INF] + [d for _, d in HR] + [INF]
add_case("(H L)^8 H dielectric mirror / glass",
         "17-layer quarter-wave TiO2/SiO2 high reflector, normal incidence.",
         n2, d2,
         [dict(lam=l, th=0, pol='s') for l in [450, 500, 532, 550, 600, 650, 700]],
         efield_pts=[dict(lam=550, th=0, pol='s', layer=li, dist=d2_i * f)
                     for li, d2_i in [(1, HR[0][1]), (3, HR[2][1]), (9, HR[8][1])]
                     for f in (0.0, 0.5, 1.0)])

# 3) Oblique dielectric 5-layer at 45°, s AND p (R/T + ellipsometry)
five = [(TiO2, 65), (SiO2, 94), (TiO2, 65), (SiO2, 94), (TiO2, 65)]
n3 = [AIR] + [n for n, _ in five] + [GLASS]
d3 = [INF] + [d for _, d in five] + [INF]
add_case("5-layer dielectric @45°",
         "Non-QW 5-layer TiO2/SiO2 stack, oblique 45°, s and p, plus ellipsometry.",
         n3, d3,
         [dict(lam=l, th=45, pol=p) for l in [450, 500, 550, 600, 650, 700] for p in ('s', 'p')],
         ellips_pts=[dict(lam=l, th=45) for l in [450, 500, 550, 600, 650, 700]])

# 4) Absorbing a-Si film on glass — energy balance, normal + 60° s/p
add_case("a-Si 200nm / glass (absorbing)",
         "Weakly absorbing 200 nm a-Si on glass; normal and 60° s/p — R+T+A=1.",
         [AIR, aSi, GLASS], [INF, 200, INF],
         [dict(lam=l, th=t, pol=p)
          for l in [450, 500, 550, 633, 700]
          for (t, p) in [(0, 's'), (60, 's'), (60, 'p')]],
         efield_pts=[dict(lam=550, th=0, pol='s', layer=1, dist=x) for x in (0, 50, 100, 150, 200)])

# 5) Silver 25nm on glass — R/T/A + ellipsometry at several angles
add_case("Ag 25nm / glass (metal film)",
         "Semi-transparent 25 nm silver on glass; R/T/A + ellipsometry 65/70/75°.",
         [AIR, Ag, GLASS], [INF, 25, INF],
         [dict(lam=l, th=0, pol='s') for l in [450, 500, 520, 550, 600, 650]],
         ellips_pts=[dict(lam=520, th=t) for t in (65, 70, 75)])

# 6) Bare lossy metal (Cr) — oblique ellipsometry across angles (pure interface)
add_case("Bare Cr substrate (ellipsometry)",
         "Bare chromium; ellipsometric Psi/Delta at 55/65/75° — single interface.",
         [AIR, Cr], [INF, INF],
         [dict(lam=550, th=t, pol=p) for t in (55, 65, 75) for p in ('s', 'p')],
         ellips_pts=[dict(lam=550, th=t) for t in (55, 65, 75)])

# 7) Gires–Tournois-style spacer on mirror — strong phase dispersion for GD/GDD.
#    (r phase compared pointwise; GD = -dφ/dω of exactly this phase.)
GT = [(SiO2, 500)] + [(TiO2, qw(TiO2, 800)), (SiO2, qw(SiO2, 800))] * 6 + [(TiO2, qw(TiO2, 800))]
n7 = [AIR] + [n for n, _ in GT] + [GLASS]
d7 = [INF] + [d for _, d in GT] + [INF]
add_case("Spacer-on-mirror (phase/GD)",
         "SiO2 spacer over a QW mirror @800nm — strong reflected-phase dispersion.",
         n7, d7,
         [dict(lam=l, th=0, pol='s') for l in np.round(np.linspace(760, 840, 41), 4).tolist()])

# ── Evaluate every point with tmm ────────────────────────────────────────────
def nd(case):
    n = [complex(re, im) for re, im in case['n_list']]
    d = [INF if v == 'inf' else float(v) for v in case['d_list']]
    return n, d

for case in cases:
    n, d = nd(case)
    for pt in case['spectral']:
        th = pt['th'] * math.pi / 180
        res = coh_tmm(pt['pol'], n, d, th, pt['lam'])
        r, t = res['r'], res['t']
        pt.update(R=res['R'], T=res['T'], A=1 - res['R'] - res['T'],
                  r=[r.real, r.imag], t=[t.real, t.imag])
    for pt in case['ellips']:
        th = pt['th'] * math.pi / 180
        e = ellips(n, d, th, pt['lam'])
        pt.update(psi_deg=e['psi'] * 180 / math.pi,
                  delta_deg=(e['Delta'] * 180 / math.pi) % 360)
    for pt in case['efield']:
        th = pt['th'] * math.pi / 180
        res = coh_tmm(pt['pol'], n, d, th, pt['lam'])
        pr = position_resolved(pt['layer'], pt['dist'], res)
        E2 = abs(pr['Ex'])**2 + abs(pr['Ey'])**2 + abs(pr['Ez'])**2
        pt.update(E2=E2)

# ── Fine-grid group-delay reference for the dispersive (GTI) mirror ──────────
# GD = −dφ/dω from tmm's reflected phase on a dense, uniform-in-ω-adjacent grid
# so the Gires–Tournois resonance is fully resolved (a coarse finite difference
# under-resolves the sharp GD peak). c = 299.792458 nm/fs.
C_NM_FS = 299.792458
def gd_reference(case, lo, hi, N):
    n, d = nd(case)
    lams = np.linspace(lo, hi, N)
    w = 2 * np.pi * C_NM_FS / lams
    ph = np.unwrap(np.array([cmath.phase(coh_tmm('s', n, d, 0.0, float(l))['r']) for l in lams]))
    gd = -np.gradient(ph, w)                     # fs
    return lams, gd

gd_src = next(c for c in cases if c['name'].startswith('Spacer-on-mirror'))
gd_lams, gd_vals = gd_reference(gd_src, 740.0, 860.0, 2401)
# store a downsampled set of interior points (well clear of the grid edges)
sel = [i for i in range(60, len(gd_lams) - 60, 30)]
gd_case = dict(name=gd_src['name'], lo=740.0, hi=860.0, N=2401,
               lam=[float(gd_lams[i]) for i in sel],
               gd=[float(gd_vals[i]) for i in sel])
print(f"GD reference: {len(sel)} points, range {min(gd_case['gd']):.2f} … {max(gd_case['gd']):.2f} fs")

# ── Dense curves for plotting (tmm side; JS adds TFStudio on the same grid) ───
def find(name):
    return next(c for c in cases if c['name'].startswith(name))

def dense_spectral(case, lo, hi, N, pol='s', th=0.0):
    n, d = nd(case)
    lams = np.linspace(lo, hi, N)
    R, T, A = [], [], []
    for l in lams:
        r = coh_tmm(pol, n, d, th * math.pi / 180, float(l))
        R.append(r['R']); T.append(r['T']); A.append(1 - r['R'] - r['T'])
    return dict(lam=lams.tolist(), R=R, T=T, A=A, pol=pol, th=th)

def dense_ellips(case, lam, angs):
    n, d = nd(case)
    psi, dl = [], []
    for a in angs:
        e = ellips(n, d, a * math.pi / 180, lam)
        psi.append(e['psi'] * 180 / math.pi)
        dl.append(((e['Delta'] * 180 / math.pi) + 180) % 360)   # + 180: Macleod convention
    return dict(lam=lam, ang=list(angs), psi=psi, delta=dl)

def dense_efield(case, lam, pol='s', th=0.0, per=50):
    n, d = nd(case)
    res = coh_tmm(pol, n, d, th * math.pi / 180, lam)
    zs, E2 = [], []
    z0 = 0.0
    for li in range(1, len(d) - 1):
        dl = d[li]
        for j in range(per + 1):
            dist = min(dl * j / per, dl - 1e-9)   # clamp off the back interface (tmm asserts there)
            pr = position_resolved(li, dist, res)
            zs.append(z0 + dist)
            E2.append(abs(pr['Ex'])**2 + abs(pr['Ey'])**2 + abs(pr['Ez'])**2)
        z0 += dl
    return dict(lam=lam, pol=pol, th=th, z=zs, E2=E2)

def dense_gd(case, lo, hi, N):
    n, d = nd(case)
    lams = np.linspace(lo, hi, N)
    w = 2 * np.pi * C_NM_FS / lams
    ph = np.unwrap(np.array([cmath.phase(coh_tmm('s', n, d, 0.0, float(l))['r']) for l in lams]))
    gd = -np.gradient(ph, w)
    return dict(lam=lams.tolist(), gd_tmm=gd.tolist())   # TFStudio = −gd_tmm

plots = dict(
    ar     = dict(case=find('MgF2 QW AR')['name'],        data=dense_spectral(find('MgF2 QW AR'), 400, 800, 201)),
    mirror = dict(case=find('(H L)^8 H')['name'],         data=dense_spectral(find('(H L)^8 H'), 400, 750, 201)),
    absorb = dict(case=find('a-Si 200nm')['name'],        data=dense_spectral(find('a-Si 200nm'), 400, 800, 201)),
    metal  = dict(case=find('Ag 25nm')['name'],           data=dense_spectral(find('Ag 25nm'), 400, 700, 201)),
    ellips = dict(case=find('Bare Cr')['name'],           data=dense_ellips(find('Bare Cr'), 550, list(range(5, 90, 1)))),
    efield = dict(case=find('(H L)^8 H')['name'],         data=dense_efield(find('(H L)^8 H'), 550, per=40)),
    gd     = dict(case=find('Spacer-on-mirror')['name'],  data=dense_gd(find('Spacer-on-mirror'), 760, 840, 321)),
)

out = dict(
    generator="Steven Byrnes tmm (arXiv:1603.02720), MIT",
    note="Independent third-party TMM. Same complex-index convention as TFStudio "
         "(n+ik, k>0). Inputs are byte-identical to the JS side; only the math is tested.",
    cases=cases,
    gd_case=gd_case,
    plots=plots,
)
import os
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "reference_tmm.json"), "w") as f:
    json.dump(out, f, indent=1)
print(f"Wrote reference_tmm.json — {len(cases)} cases, "
      f"{sum(len(c['spectral']) for c in cases)} spectral + "
      f"{sum(len(c['ellips']) for c in cases)} ellips + "
      f"{sum(len(c['efield']) for c in cases)} efield points.")
