---
title: Filter Design
description: Build a multi-cavity Fabry-Perot bandpass prototype (DWDM, LWDM, or notch) in a few guided steps.
ribbonIcon: filter-design
---

The **Filter Design** wizard builds a multi-cavity bandpass filter (DWDM, LWDM or a narrow notch) from a few physical parameters in six steps, and hands back a design with its merit rows filled in, ready for [Refinement](/synthesis/refinement/). The stack it builds is quarter-wave mirror blocks separated by Fabry-Perot spacer cavities:

$$
\text{Substrate} \mid M_1 S_1 M_2 S_2 \cdots M_q S_q M_{q+1} \mid \text{(optional AR)}
$$

Each $M_i$ is a quarter-wave mirror block and each $S_i$ a spacer of $k$ half waves. The whole stack alternates H and L counting from the substrate, so a mirror with an even layer count ends on the other material and puts the spacers on its two sides in different materials. The two outer mirrors are weaker than the inner ones, which couple neighbouring cavities: that is what flattens the top of the passband.

<!-- shot: filter-design | the Global Integer Search step after Start on a four-cavity DWDM target: the candidate list with the seed row, and the embedded preview with the scored points drawn over it -->
![Filter Design](/screenshots/filter-design.png)

![The Filter Design steps: materials, parameters, cavity count, prototype, global integer search and adjustment to the incident medium, then a new design with its merit rows for Refinement. Steps 2 to 5 design the filter embedded in the substrate. Inside step 5, the chosen prototype seeds a descent over the integer mirror counts and spacer orders that keeps every move that lowers the merit, repeated from perturbed restarts.](/diagrams/filter-design.svg)

Steps 2 to 5 design the filter **embedded**, as if the incident medium had the substrate's index, so the front surface does not reflect; step 6 brings in the real medium. Before refinement, a symmetric $N$-cavity prototype shows $N$ small ripples straddling $\lambda_0$: that is the expected Chebyshev response, and Refinement merges them into a flat top.

## Computed quantities

- **Shape factor**: the stopband half-width over the passband half-width.
- **Number of Cavities**: the Chebyshev count $q$ the shape factor and the two levels call for; the wizard recommends more than $q$ and offers $q + 1$.
- **Prototype Specification** rows $(m, k)$: a mirror strength $m$ with the smallest spacer order $k$ that gives the asked passband width, strongest mirror first.
- **Global Integer Search** candidates: the designs the search found, listed by merit, the prototype itself tagged **seed**.

## Controls and settings

**Material Selection**: the high-index (H) and low-index (L) coating materials, the substrate and the incident medium; **Oblique incidence** sets a working **Angle** and **Polarization**. The wizard warns above $k = 10^{-5}$ at the design wavelength, since loss in a high-Q cavity cuts the peak transmittance. It remembers these choices for the next time.

**Filter Parameters**: the **Filter wavelength** $\lambda_0$, the passband half-width at the **Pass level** (89.13 %, 0.5 dB, by default) and the stopband half-width at the **Stop level** (0.1 %, 30 dB).

**Number of Cavities**: the count to build; the one offered can be changed.

**Prototype Specification**: pick the row to start from; **Spacer material** shows the rows whose spacers are H, L or **Any**.

**Global Integer Search**: **Start** searches the integer mirror layer counts and spacer orders around the chosen prototype for the lowest merit; **Restarts** sets how many perturbed starts it adds, 14 by default. Select the candidate to build.

**Symmetrical mirrors** and **Symmetrical cavities**: keep the two halves of the stack alike.

**Hold the passband over ±θ**: score every design a second time at $\theta$ more tilt than the working angle, so cavities that drift apart with angle lose.

**Clear history on start**: on by default; off keeps the candidates of earlier runs in the list.

**Adjust to Incident Medium**: **No AR coating**, a **1-layer coating** or a **2-layer "V" coating** between the incident medium and the filter, and a name for the design.

**Finish** makes a new design with the stack and these rows in the [Merit Function Editor](/design/merit-function-editor/): transmittance 100 % across the passband and 0 % across each stopband, at the working angle and polarization, and `MNT` 7 nm and `MXT` 9999 nm over every layer. Its reference wavelength is the one its quarter waves were laid at.

## How it is computed

### Number of cavities

$$
\begin{aligned}
\rho &= \frac{1}{T_p} - 1 && T_p, T_s\text{: pass and stop levels as fractions} \\
q &= \text{smallest whole number with } T_q(\mathrm{SF}) > \sqrt{\frac{1/T_s - 1}{\rho}} \\
T_0 &= 1, \quad T_1 = \mathrm{SF}, \quad T_j = 2\, \mathrm{SF}\, T_{j-1} - T_{j-2}
\end{aligned}
$$

$T_q$ is the Chebyshev polynomial of order $q$ and $\mathrm{SF}$ the shape factor. With the default levels the threshold is about 100, and $\mathrm{SF} = 3$ gives $q = 3$, so the wizard offers four cavities.

### Prototype

$$
\begin{aligned}
\delta &= \operatorname{round}\!\left(\frac{\ln(n_s / n_H)}{\ln(n_L / n_H)}\right) \\
\text{mirrors:} \quad & \text{outer } m \text{ quarter waves, inner } 2m + 2\delta - 1\text{, spacers } 2k \text{ quarter waves} \\
\frac{\Delta\lambda}{\lambda_0} &= \frac{4}{\pi} \left(\frac{n_L}{n_H}\right)^{m+\delta} \frac{n_H - n_L}{k\,(n_H - n_L) + n_L} \\
k &= \text{smallest order with } \frac{\Delta\lambda}{\lambda_0} \le 0.98\, r_q\, \frac{2\Delta\lambda_p}{\lambda_0}, \qquad r_q = \cosh\!\left(\frac{\operatorname{acosh}\sqrt{1/\rho}}{q}\right)
\end{aligned}
$$

$\delta$ is Thelen's coupling order, the extra mirror strength that matches the inner mirrors to the substrate (1 for most material pairs). The width formula is Thelen's passband width of a multiple-cavity filter (Macleod Eqs. 8.59-8.61), and $r_q$ turns the asked width at the pass level into the half-power width of a q-cavity Chebyshev response; 0.98 is a fitted factor that makes the table aim slightly narrower than asked, since the search widens the band. The rows run from $m = 1$ to the first $m$ that reaches the width with $k = 1$, inside the range the search can hold, mirror counts 1 to 41 and orders 1 to 400.

### Merit of the search

$$
\begin{aligned}
\text{pass points:} \quad & \text{17, evenly over } \lambda_0 \pm \Delta\lambda_p\text{; target 100 \%, the two outermost at the pass level; } \sigma = 1 \\
\text{stop points:} \quad & \lambda_0 \pm \{1, 1.1, 1.2, 2\} \cdot \Delta\lambda_s\text{; target 0 \%; } \sigma = 0.2 \\
\text{residual:} \quad & \text{pass } \min(0,\, T - \text{target}), \quad \text{stop } \max(0,\, T) \qquad (T \text{ in \%}) \\
& \mathrm{MF} = \sqrt{\frac{\sum (\text{residual} / \sigma)^2}{N_\text{points}}}
\end{aligned}
$$

Every point is one-sided: a pass point counts only when T falls below it, a stop point only when T is above zero, so a design may use the pass-level allowance at the band edges. The stop points weigh five times more so the rejection edge can compete with the flat top. At an angle the passband moves to shorter wavelengths whatever the integers are, so the band centre is found first and the points are moved onto it; what is scored is the band's shape. With **Hold the passband over ±θ**, the same points are scored again at the working angle plus $\theta$ and MF is the RMS over both sets. Embedded, the angle of incidence becomes the angle in the substrate, $n_\text{inc} \sin\theta_\text{inc} = n_s \sin\theta_s$.

### Integer search

$$
\begin{aligned}
\text{moves:} \quad & \text{each mirror } \pm 1, \pm 2\text{; each spacer } \pm 1, \pm 2\text{;} \\
& \text{spacer } i \ \pm 1 \text{ or } \pm 2 \text{ with mirrors } i \text{ and } i + 1 \text{ the other way by 1 or 2;} \\
& \text{every spacer } \pm 1 \text{ with every inner mirror the other way by 1} \\
\text{descent:} \quad & \text{keep each move that lowers MF; stop when a whole round lowers nothing} \\
\text{restarts:} \quad & \text{mirrors} + \operatorname{round}\bigl(6 (u - 0.5)\bigr)\text{, outer mirrors 2 lower; spacers} + \operatorname{round}\bigl(2 (u - 0.5)\bigr)
\end{aligned}
$$

$u$ is uniform in $[0, 1)$. The paired moves exist because a cavity's width goes as the mirror term $(n_L/n_H)^{2x}$ over its order (Macleod Eqs. 8.24-8.25): a higher spacer order alone narrows that cavity and is uphill from almost any start, while the same step with weaker mirrors keeps the width and reaches higher-order designs. The prototype row is always kept in the list, so a clean prototype stays available even when a design with ripple scores lower.

### Adjusting to the incident medium

$$
\begin{aligned}
r_1 &= \frac{\eta_0 - \eta_1}{\eta_0 + \eta_1}, \qquad r_2 = \frac{\eta_1 - \eta_2}{\eta_1 + \eta_2}, \qquad r_3 = \frac{\eta_2 - Y}{\eta_2 + Y} \\
\operatorname{Re}\!\left(r_3\, e^{-2i\delta_2}\right) &= \frac{r_2^2 + \lvert r_3\rvert^2 - r_1^2 - r_1^2 r_2^2 \lvert r_3\rvert^2}{2 r_2 (r_1^2 - 1)} \\
e^{-2i\delta_1} &= \frac{-r_1 \left(1 + r_2 r_3\, e^{-2i\delta_2}\right)}{r_2 + r_3\, e^{-2i\delta_2}}
\end{aligned}
$$

$Y$ is the admittance the embedded filter presents at $\lambda_0$, $\eta_0$ that of the incident medium, $\eta_1$ and $\eta_2$ those of the two coat layers, all tilted for the working angle and polarization ($\eta = n \cos\theta$ for s, $n / \cos\theta$ for p). The first line's equation has a root on each side, which gives the two V-coat solutions, for either order of H and L. The coat kept is the thinnest that brings the reflectance at $\lambda_0$ below $10^{-6}$, else the one that leaves the least; with averaged polarization the roots of both planes are scored on the mean reflectance. A 1-layer coat takes the phase thickness that leaves the least reflectance. When the coat's inner layer has the material of the filter's outer layer, the two merge into one.

At an oblique working angle the passband sits below the wavelength the quarter waves were laid at, so the wizard lays them at a longer reference $\lambda_\text{ref}$, moving it by $\lambda_0 / \lambda_\text{centre}$ after measuring where the coated filter's band lands, twice, and keeping the reference whose band came closest to $\lambda_0$.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §4.3 (two-layer antireflection coatings), §8.2 (multiple-cavity filters, Eqs. 8.24-8.25 and 8.59-8.61, tilting in §8.2.5), §9.2 (tilted admittances).
- A. Thelen, *J. Opt. Soc. Am.* **56**, 1533 (1966): equivalent layers in multilayer filters.
- A. Thelen, *Design of Optical Interference Coatings* (McGraw-Hill, 1988): multiple-cavity bandpass filters.
- A. V. Tikhonravov and M. K. Trubetskov, *Appl. Opt.* **41**, 3176 (2002), §3: automated design of WDM filters, the Chebyshev cavity count and Thelen's prototype.
