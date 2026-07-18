/**
 * Quarter-wave optical-thickness → physical thickness (nm) at λ0.
 * d = m · λ0 / (4 · n(λ0)), m = number of quarter waves (1 = QW, 2 = HW).
 */
export function qwThickness(nAtLambda0, lambda0, quarterWaves) {
    if (!(nAtLambda0 > 0) || !(lambda0 > 0)) return 0;
    return quarterWaves * lambda0 / (4 * nAtLambda0);
}
