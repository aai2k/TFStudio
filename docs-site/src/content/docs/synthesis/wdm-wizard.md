---
title: Filter Design
description: Build a multi-cavity Fabry-Perot bandpass prototype (DWDM, LWDM, or notch) in a few guided steps.
ribbonIcon: filter-design
---

The **Filter Design** wizard builds a multi-cavity bandpass filter (DWDM, LWDM or a narrow notch) from a few physical parameters in six steps, and hands back a design with its merit rows filled in, ready for [Refinement](/synthesis/refinement/). The stack it builds is quarter-wave mirror blocks separated by Fabry-Perot spacer cavities:

```
Substrate | M₁ S₁ M₂ S₂ … Mq Sq M(q+1) | (optional AR)
```

Each Mᵢ is a quarter-wave mirror block and each Sᵢ a spacer of k half waves. The whole stack alternates H and L counting from the substrate, so a mirror with an even layer count ends on the other material and puts the spacers on its two sides in different materials. The two outer mirrors are weaker than the inner ones, which couple neighbouring cavities: that is what flattens the top of the passband.

<!-- shot: filter-design | the Global Integer Search step after Start on a four-cavity DWDM target: the candidate list with the seed row, and the embedded preview with the scored points drawn over it -->

![The Filter Design steps: materials, parameters, cavity count, prototype, global integer search and adjustment to the incident medium, then a new design with its merit rows for Refinement. Steps 2 to 5 design the filter embedded in the substrate. Inside step 5, the chosen prototype seeds a descent over the integer mirror counts and spacer orders that keeps every move that lowers the merit, repeated from perturbed restarts.](/diagrams/filter-design.svg)

Steps 2 to 5 design the filter **embedded**, as if the incident medium had the substrate's index, so the front surface does not reflect; step 6 brings in the real medium. Before refinement, a symmetric N-cavity prototype shows N small ripples straddling λ₀: that is the expected Chebyshev response, and Refinement merges them into a flat top.

## Computed quantities

- **Shape factor**: the stopband half-width over the passband half-width.
- **Number of Cavities**: the Chebyshev count q the shape factor and the two levels call for; the wizard recommends more than q and offers q + 1.
- **Prototype Specification** rows (m, k): a mirror strength m with the smallest spacer order k that gives the asked passband width, strongest mirror first.
- **Global Integer Search** candidates: the designs the search found, listed by merit, the prototype itself tagged **seed**.

## Controls and settings

**Material Selection**: the high-index (H) and low-index (L) coating materials, the substrate and the incident medium; **Oblique incidence** sets a working **Angle** and **Polarization**. The wizard warns above k = 10⁻⁵ at the design wavelength, since loss in a high-Q cavity cuts the peak transmittance. It remembers these choices for the next time.

**Filter Parameters**: the **Filter wavelength** λ₀, the passband half-width at the **Pass level** (89.13 %, 0.5 dB, by default) and the stopband half-width at the **Stop level** (0.1 %, 30 dB).

**Number of Cavities**: the count to build; the one offered can be changed.

**Prototype Specification**: pick the row to start from; **Spacer material** shows the rows whose spacers are H, L or **Any**.

**Global Integer Search**: **Start** searches the integer mirror layer counts and spacer orders around the chosen prototype for the lowest merit; **Restarts** sets how many perturbed starts it adds, 14 by default. Select the candidate to build.

**Symmetrical mirrors** and **Symmetrical cavities**: keep the two halves of the stack alike.

**Hold the passband over ±θ**: score every design a second time at θ more tilt than the working angle, so cavities that drift apart with angle lose.

**Clear history on start**: on by default; off keeps the candidates of earlier runs in the list.

**Adjust to Incident Medium**: **No AR coating**, a **1-layer coating** or a **2-layer "V" coating** between the incident medium and the filter, and a name for the design.

**Finish** makes a new design with the stack and these rows in the [Merit Function Editor](/design/merit-function-editor/): transmittance 100 % across the passband and 0 % across each stopband, at the working angle and polarization, and `MNT` 7 nm and `MXT` 9999 nm over every layer. Its reference wavelength is the one its quarter waves were laid at.

## How it is computed

### Number of cavities

```
ρ = 1/T_p − 1                         T_p, T_s: pass and stop levels as fractions
q = smallest whole number with  T_q(SF) > √( (1/T_s − 1) / ρ )
T_0 = 1,  T_1 = SF,  T_j = 2·SF·T_(j−1) − T_(j−2)
```

T_q is the Chebyshev polynomial of order q and SF the shape factor. With the default levels the threshold is about 100, and SF = 3 gives q = 3, so the wizard offers four cavities.

### Prototype

```
δ = round( ln(n_s / n_H) / ln(n_L / n_H) )
mirrors:   outer m quarter waves,  inner 2m + 2δ − 1,  spacers 2k quarter waves
Δλ/λ₀ = (4/π) · (n_L/n_H)^(m+δ) · (n_H − n_L) / ( k·(n_H − n_L) + n_L )
k = smallest order with  Δλ/λ₀ ≤ 0.98 · r_q · 2Δλ_p / λ₀,    r_q = cosh( acosh(√(1/ρ)) / q )
```

δ is Thelen's coupling order, the extra mirror strength that matches the inner mirrors to the substrate (1 for most material pairs). The width formula is Thelen's passband width of a multiple-cavity filter (Macleod Eqs. 8.59-8.61), and r_q turns the asked width at the pass level into the half-power width of a q-cavity Chebyshev response; 0.98 is a fitted factor that makes the table aim slightly narrower than asked, since the search widens the band. The rows run from m = 1 to the first m that reaches the width with k = 1, inside the range the search can hold, mirror counts 1 to 41 and orders 1 to 400.

### Merit of the search

```
pass points:  17, evenly over λ₀ ± Δλ_p;  target 100 %, the two outermost at the pass level;  σ = 1
stop points:  λ₀ ± {1, 1.1, 1.2, 2}·Δλ_s;  target 0 %;  σ = 0.2
residual:     pass  min(0, T − target),   stop  max(0, T)        (T in %)
MF = √( Σ (residual / σ)² / N_points )
```

Every point is one-sided: a pass point counts only when T falls below it, a stop point only when T is above zero, so a design may use the pass-level allowance at the band edges. The stop points weigh five times more so the rejection edge can compete with the flat top. At an angle the passband moves to shorter wavelengths whatever the integers are, so the band centre is found first and the points are moved onto it; what is scored is the band's shape. With **Hold the passband over ±θ**, the same points are scored again at the working angle plus θ and MF is the RMS over both sets. Embedded, the angle of incidence becomes the angle in the substrate, n_inc sin θ_inc = n_s sin θ_s.

### Integer search

```
moves:     each mirror ±1, ±2;  each spacer ±1, ±2;
           spacer i ±1 or ±2 with mirrors i and i+1 the other way by 1 or 2;
           every spacer ±1 with every inner mirror the other way by 1
descent:   keep each move that lowers MF; stop when a whole round lowers nothing
restarts:  mirrors + round(6·(u − 0.5)), outer mirrors 2 lower;  spacers + round(2·(u − 0.5))
```

u is uniform in [0, 1). The paired moves exist because a cavity's width goes as the mirror term (n_L/n_H)^2x over its order (Macleod Eqs. 8.24-8.25): a higher spacer order alone narrows that cavity and is uphill from almost any start, while the same step with weaker mirrors keeps the width and reaches higher-order designs. The prototype row is always kept in the list, so a clean prototype stays available even when a design with ripple scores lower.

### Adjusting to the incident medium

```
r_1 = (η_0 − η_1)/(η_0 + η_1),   r_2 = (η_1 − η_2)/(η_1 + η_2),   r_3 = (η_2 − Y)/(η_2 + Y)
Re( r_3 · e^(−2iδ_2) ) = [ r_2² + |r_3|² − r_1² − r_1² r_2² |r_3|² ] / [ 2 r_2 (r_1² − 1) ]
e^(−2iδ_1) = −r_1 (1 + r_2 r_3 e^(−2iδ_2)) / (r_2 + r_3 e^(−2iδ_2))
```

Y is the admittance the embedded filter presents at λ₀, η_0 that of the incident medium, η_1 and η_2 those of the two coat layers, all tilted for the working angle and polarization (η = n cos θ for s, n / cos θ for p). The first line's equation has a root on each side, which gives the two V-coat solutions, for either order of H and L. The coat kept is the thinnest that brings the reflectance at λ₀ below 10⁻⁶, else the one that leaves the least; with averaged polarization the roots of both planes are scored on the mean reflectance. A 1-layer coat takes the phase thickness that leaves the least reflectance. When the coat's inner layer has the material of the filter's outer layer, the two merge into one.

At an oblique working angle the passband sits below the wavelength the quarter waves were laid at, so the wizard lays them at a longer reference λ_ref, moving it by λ₀ / λ_centre after measuring where the coated filter's band lands, twice, and keeping the reference whose band came closest to λ₀.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §4.3 (two-layer antireflection coatings), §8.2 (multiple-cavity filters, Eqs. 8.24-8.25 and 8.59-8.61, tilting in §8.2.5), §9.2 (tilted admittances).
- A. Thelen, *J. Opt. Soc. Am.* **56**, 1533 (1966): equivalent layers in multilayer filters.
- A. Thelen, *Design of Optical Interference Coatings* (McGraw-Hill, 1988): multiple-cavity bandpass filters.
- A. V. Tikhonravov and M. K. Trubetskov, *Appl. Opt.* **41**, 3176 (2002), §3: automated design of WDM filters, the Chebyshev cavity count and Thelen's prototype.
