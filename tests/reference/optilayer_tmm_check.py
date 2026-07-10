#!/usr/bin/env python3
"""
Third-party cross-check of the OptiLayer design with Steven Byrnes'
`tmm` package — the SAME geometry OptiLayer reports: coated front surface on a
thick (incoherent) K8 substrate with a BARE back surface. Uses tmm.inc_tmm so
the substrate back-reflection is added incoherently, exactly like OptiLayer's Ta.

Materials are byte-identical to the JS side (ZrO2P / SiO2P user tables, K8 from
LZOS, all linear-interpolated). Emits `optilayer_tmm.json` with tmm's T on the
.res wavelength grid, and prints OptiLayer-vs-tmm agreement.

Requires: pip install tmm numpy
Run:      python tests/reference/optilayer_tmm_check.py
"""
import json, os, re
import numpy as np
from tmm import inc_tmm

RES_DIR = "X:/TFStudio Dev/reference/For spectrophotometer"
HERE = os.path.dirname(os.path.abspath(__file__))

ZrO2P = [[350,2.3],[370,2.2],[400,2.05],[420,2.0],[450,1.98],[470,1.965],[500,1.955],[550,1.953],[600,1.952],[700,1.952],[750,1.951],[800,1.95],[850,1.95]]
SiO2P = [[300,1.478],[350,1.472],[400,1.467],[450,1.463],[500,1.459],[550,1.455],[600,1.452],[650,1.45],[700,1.446],[900,1.437],[1000,1.434],[1100,1.432]]
K8    = [[365,1.53582],[404.66,1.52982],[435.83,1.526266],[479.99,1.522408],[486.13,1.521955],[488,1.52181],[514,1.52009],[520.8,1.51968],[530,1.51916],[546.07,1.518294],[568.2,1.51722],[587.56,1.516373],[589.29,1.5163],[632.8,1.51466],[643.85,1.514292],[647.1,1.51419],[656.27,1.513895],[694.3,1.51279],[706.52,1.51246],[768.2,1.511],[852.1,1.50937],[890,1.50872],[1013.9,1.50687],[1060,1.50625],[1128.6,1.50536]]

def interp(tab, lam):
    d = sorted(tab)
    if lam <= d[0][0]: return d[0][1]
    if lam >= d[-1][0]: return d[-1][1]
    for i in range(1, len(d)):
        if d[i][0] >= lam:
            f = (lam - d[i-1][0]) / (d[i][0] - d[i-1][0])
            return d[i-1][1] + f * (d[i][1] - d[i-1][1])
    return d[-1][1]

def parse_res(path):
    rows = []
    with open(path, "r", encoding="latin-1") as fh:
        in_data = False
        for line in fh:
            if re.search(r"Wavelength\s+Ta", line): in_data = True; continue
            if not in_data: continue
            m = re.match(r"\s*([\d.]+)\s+([\d.]+)\s*$", line)
            if m: rows.append((float(m.group(1)), float(m.group(2))))
    return rows

def tmm_T(lam):
    # incident air / SiO2 (outer) / ZrO2 / K8 (3mm, incoherent) / air ; bare back
    n_list = [1.0, interp(SiO2P, lam), interp(ZrO2P, lam), interp(K8, lam), 1.0]
    d_list = [np.inf, 199.251, 46.429, 3e6, np.inf]
    c_list = ['i', 'c', 'c', 'i', 'i']
    return inc_tmm('s', n_list, d_list, c_list, 0.0, lam)['T'] * 100

ref = parse_res(os.path.join(RES_DIR, "02.res"))
out = {"lam": [], "T_tmm": []}
n1 = s1 = mx1 = 0
for lam, ta in ref:
    t = tmm_T(lam)
    out["lam"].append(lam); out["T_tmm"].append(t)
    if 400 <= lam <= 850:
        d = abs(t - ta); n1 += 1; s1 += d*d; mx1 = max(mx1, d)

with open(os.path.join(HERE, "optilayer_tmm.json"), "w") as f:
    json.dump(out, f)

print("tmm inc_tmm  vs  OptiLayer 02.res (2-layer AR):")
print(f"  400-850 nm:  RMS = {(s1/n1)**0.5:.4f} %   max = {mx1:.4f} %")
print("   lam(nm)   tmm T%    OptiLayer Ta%    d%")
for lamT in (400, 500, 600, 700, 800):
    row = min(ref, key=lambda r: abs(r[0]-lamT))
    t = tmm_T(row[0])
    print(f"  {row[0]:7.1f}  {t:8.4f}     {row[1]:8.4f}    {t-row[1]:+.4f}")
print("Wrote optilayer_tmm.json")
