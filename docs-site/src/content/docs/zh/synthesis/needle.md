---
title: 针法变异
description: 在能降低评价函数的位置插入极薄的“针层”，然后精炼所有厚度。
ribbonIcon: needle
---

**针法变异（Needle Variation）** 在能降低评价函数的位置放入薄层，即**针层**，精炼所有厚度，并重复这一过程，直到没有针层能再起作用。针层放在哪里有帮助，由 **P 函数**决定：如果在某个深度插入一层无限薄的池中材料，评价函数会以多快的速度下降。**针法自动**自行运行这一循环；**针法手动**让你手动插入一个针层。两者使用同一个材料池和同一种扫描。

## <span id="needle-automatic"></span>针法自动（Needle Automatic）

<!-- shot: needle | a finished Needle Automatic run on a multilayer target: the readout, MF Trend falling over the generations, Accepted Improvements and Top Designs -->
![针法变异](/screenshots/needle-zh.png)

![针法自动一次运行的流程图。按下运行后，先准备评价函数行，勾选时选出智能起始设计。每个循环重新采样波段行，检查是否还能加层，扫描 P 函数，按批精炼 K 个候选，并在去掉停在下限上的层试过之后，接受使 MF 降低 0.01% 的最好者。运行在达到目标评价函数、达到最大膜层数，或第二次达到针法最优时结束；第一次达到针法最优时，它从设计的更厚副本继续。](/diagrams/needle-automatic-zh.svg)

一代只有使 MF 至少降低 0.01 % 时才算数，这也是其中每次精炼停止的降幅：更小的增益只会用始终约一纳米厚的针层占满层数上限。针层必须插入已有的膜层中，薄的膜系在还有改进余地之前就先没有了可插入的位置；因此运行第一次达到针法最优时，会精炼厚度为原设计 2、4、8、16 倍的副本，并从其中最低者继续，记为一行**更厚的起点**。如果之后始终没有超过此前的设计，运行就以那个设计结束。

## <span id="needle-manual"></span>针法手动（Needle Manual）

<!-- shot: needle-manual | P-function profile of a multilayer design with two pool materials, a point below zero picked, the Insertion Preview with d_new and the OMF now and after -->
![针法变异](/screenshots/needle-manual-zh.png)

点击零线以下的一个点，即选中其位置和材料。**应用插入**以 **d_new** 插入针层，$d_\text{new}$ 的初值由与针法自动相同的线搜索给出。开启**插入后精炼**时，随后用序列二次规划（SQP）精炼膜系，最多**精炼迭代**步，并遵守 `MNT` 和 `MXT` 行。图中显示计算出的每一个点，包括那些会使某层的一部分低于**最小厚度**的拆分点。

## 计算量

- **P**，即 $P$ 函数：某种池中材料的针层在某个深度、厚度 $d$ 趋于零时，评价函数的斜率 $\partial\mathrm{MF}/\partial d$。低于零表示在那里插入针层会降低 MF。
- **MF**：[评价函数编辑器](/zh/design/merit-function-editor/)中的评价函数；**OMF**，即不含厚度行 `TT`、`STR`、`MNT` 和 `MXT` 的同一评价函数。
- **ΔMF**：已接受的改善中，相对此前最好设计的变化。**总厚**：总物理厚度，nm。
- **最佳设计**：在膜层数和 MF 两方面都没有被其他代同时超过的代。

## 控件与设置

**运行**、**停止**、**重置**、**最佳**、**清除历史**：停止会暂停运行并显示该运行最后接受的设计，下次按运行会从它出发在同一次运行中继续。重置撤销最近一次按下的运行。最佳把 MF 最低的一代放到设计上，任意一行的**恢复**也是如此。清除历史清除所有行，设计保持不变。

**材料池**：允许针法插入的材料。材料池一开始只勾选设计中前、后表面膜层所用的材料；基底和介质列在**此设计**下但不勾选，其他目录也都不勾选。**全部 / 清空**可一键选中或清空材料池。你一旦改动材料池，窗口就会对所有设计保留你的选择，只是每个设计的基底和介质在你于该设计上勾选之前保持不勾选；用**清空**清空的材料池，在下次打开窗口时重新从设计自身的材料开始。

**最大膜层数**：膜系达到这么多层后不再开始新的循环。默认 60。

**目标评价函数**：MF 低于此值即停止；设为 0 则运行到设计达到针法最优为止。

**智能起始设计**：从设计本身以及由材料池构建的四分之一波和半波减反设计中，取各自精炼后最好的一个作为起点。默认关闭。

**针法 δ (nm)**（针法手动中为**探测 δ**）：对 $P$ 没有精确斜率的行，以及精确扫描不运行的情况所用的探测针层。默认 0.5 nm。

**最小厚度 (nm)**：针层起始的最小厚度、精炼时的下限，以及拆分一层时每部分的最小厚度；默认 1 nm。综合期间保持这一值，只在之后的精炼和[设计清理器](/zh/synthesis/design-cleaner/)处理中才提高到你的制造下限，以免可制造的下限拖累综合。当 `MNT` 行与它不同时，字段下方会有提示。

**精炼迭代/代**：每次插入后最多的精炼步数。默认 60。

**综合精炼器**：每次插入后用于精炼的方法；针法默认用**信赖域牛顿法**，它在基准测试的大多数案例中得到的结果低于共轭梯度。见[优化方法](/zh/synthesis/optimization-methods/)。

**候选搜索**：在设计被视为针法最优之前，一个循环尝试多少批候选：**快速**一批，**均衡**两批（默认），**彻底**全部。

**针法灵敏度**：丢弃预测降幅低于扫描中最强候选 1 %、5 % 或 15 % 的候选；默认**关闭**。它在取批之前裁剪候选列表。

**线程数**：一批包含并同时精炼的候选数；结果与它有关。默认值由电脑的核心数决定，因此只有**线程数**相同时，同一次运行才会在另一台电脑上重复。

**每层剖面点数**、**面**、**插入后精炼**、**精炼迭代**：针法手动在每层内部计算的点数（16）、**表面**设为**两面**时扫描的面，以及插入后的精炼（开启，80 步）。

针法自动不计入 `MNT` 和 `MXT` 行，因此之后请运行[精炼](/zh/synthesis/refinement/)；针法手动只在扫描和起始厚度中不计入它们。`PPEF` 行以及读取它的数学行也被略去：它的梯度只来自误差最大和最小的两个波长，针法搜索会因此停滞。**设置**下方有一行提示说明这一点，之后运行一次精炼即可把峰峰误差降下来。

## 计算方法

### 评价函数

$$
\mathrm{MF} = \sqrt{\frac{\sum_i w_i \, (r_i / \sigma_i)^2}{W}}
$$

$r_i$ 为第 $i$ 行的偏差，$w_i$ 为其权重，$\sigma_i$ 为其尺度，$W$ 为权重之和。扫描和起始厚度搜索使用 OMF；精炼和 0.01 % 规则使用 MF。在带有[环境](/zh/design/environments/)的设计上，$\mathrm{MF}^2$ 是各环境 $\mathrm{MF}^2$ 的平均值，扫描也以同样的方式把各环境的斜率相加。

### P 函数

在 TFStudio 的约定 $\tilde n = n + ik$、$\exp(-i\omega t)$ 下（见[约定](/zh/#本手册中的约定)），层矩阵就是 Macleod 式 2.111 把 $i$ 的符号反过来：

$$
M_j = \begin{bmatrix} \cos\delta_j & -i \sin\delta_j / \eta_j \\ -i \eta_j \sin\delta_j & \cos\delta_j \end{bmatrix}, \qquad \delta_j = \frac{2\pi \tilde n_j d_j \cos\theta_j}{\lambda}
$$

$$
\begin{bmatrix} B \\ C \end{bmatrix} = M_1 M_2 \cdots M_N \begin{bmatrix} 1 \\ \eta_m \end{bmatrix}
$$

$$
\begin{aligned}
\rho &= \frac{\eta_0 B - C}{\eta_0 B + C}, & \tau &= \frac{2 \eta_0}{\eta_0 B + C} \\
R &= \lvert\rho\rvert^2, & T &= \frac{\operatorname{Re}(\eta_m)}{\operatorname{Re}(\eta_0)}\, \lvert\tau\rvert^2
\end{aligned}
$$

在深度 $z$ 处插入材料 $a$ 的针层，把膜系分为其上方的矩阵乘积 $\mathrm{Pre}(z)$ 和其下方的向量 $\mathrm{Post}(z)$；厚度 $d$ 很小时，针层的矩阵等于单位矩阵加上 $d$ 乘以它的导数：

$$
\begin{bmatrix} B \\ C \end{bmatrix}(d) = \mathrm{Pre}(z)\, M_a(d)\, \mathrm{Post}(z), \qquad M_a(d) = I + d\, G_a + O(d^2)
$$

$$
G_a = \begin{bmatrix} 0 & -i Q_a / \eta_a \\ -i \eta_a Q_a & 0 \end{bmatrix}, \qquad Q_a = \frac{2\pi \tilde n_a \cos\theta_a}{\lambda}
$$

$$
\frac{\partial}{\partial d} \begin{bmatrix} B \\ C \end{bmatrix} = \mathrm{Pre}(z)\, G_a\, \mathrm{Post}(z)
$$

$$
\begin{aligned}
\frac{\partial\rho}{\partial d} &= \frac{2 \eta_0 (C\, \partial B - B\, \partial C)}{(\eta_0 B + C)^2} \\
\frac{\partial\tau}{\partial d} &= -\tau\, \frac{\eta_0\, \partial B + \partial C}{\eta_0 B + C} \\
\frac{\partial R}{\partial d} &= 2 \operatorname{Re}\!\left(\rho^* \frac{\partial\rho}{\partial d}\right), & \frac{\partial T}{\partial d} &= \frac{2 \operatorname{Re}(\eta_m)}{\operatorname{Re}(\eta_0)} \operatorname{Re}\!\left(\tau^* \frac{\partial\tau}{\partial d}\right) \\
\frac{\partial A}{\partial d} &= -\frac{\partial R}{\partial d} - \frac{\partial T}{\partial d}
\end{aligned}
$$

入射介质有吸收时，$\partial A/\partial d$ 还多一项，与 $\operatorname{Im} \partial\rho/\partial d$ 有关。每一行的斜率按精炼对层厚度所用的链式法则得到，$P$ 就是评价函数的斜率：

$$
\begin{aligned}
P(z, a) &= d = 0 \text{ 处的 } \frac{\partial\mathrm{MF}}{\partial d} = \frac{\sum_i w_i\, r_i\, (\partial r_i / \partial d) / \sigma_i^2}{W \cdot \mathrm{MF}} \\
\text{预测降幅：} \quad \Delta\mathrm{MF} &\approx P(z, a)\, \delta
\end{aligned}
$$

这是 Sullivan 和 Dobrowolski 的前后矩阵针法在 $d \to 0$ 时的极限，也是 Tikhonravov 等人级数 $\Delta F = P_1(z, n)\,\Delta + P_2(z, n)\,\Delta^2 + \ldots$ 的第一个系数 $P_1$；每个位置上的每种材料各自是一个候选。没有精确针层斜率的行，例如相位、群延迟和椭偏行，用插入与不插入厚度为 $\delta$ 的针层来比较。精确扫描不运行时，即在裸基底上，或**表面**设为正面或背面且**忽略另一面**未勾选时（[表面与评价模式](/zh/design/evaluation-modes/)），$P = (\mathrm{MF}(\delta) - \mathrm{MF}(0)) / \delta$。

### 偏振、角度与锥角

$$
\text{s:}\quad \eta = \tilde n \cos\theta \qquad \text{p:}\quad \eta = \tilde n / \cos\theta \qquad n_0 \sin\theta_0 = \tilde n \sin\theta
$$

$\eta$ 以自由空间导纳为单位，$n_0$ 为入射介质的实折射率。对 s 和 p 取平均的行，或在照明锥上评分的行（[设计编辑器](/zh/design/design-editor/)），以它平均 R、T 或 A 时所用的同样权重平均斜率。**表面**设为**两面**时，斜率经过两面与基底的非相干叠加；勾选**对称（背面 = 正面）**时，针层同时插入两面，两个斜率相加。

### 起始厚度、精炼与接受

$$
\begin{aligned}
\text{拆分一层：} \quad & f d_h \mid \text{针层} \mid (1 - f) d_h, \quad f = k / 17,\ k = 1 \ldots 16 \\
& \text{仅当 } f d_h \ge d_{\min} \text{ 且 } (1 - f) d_h \ge d_{\min} \text{ 时提出} \\
\text{起始厚度：} \quad & d_0 \text{ 使 } \mathrm{OMF}(d) \text{ 在 } d_{\min} \le d \le \max(4 d_{\min},\ 60\ \text{nm}) \text{ 上最小} \\
& \text{黄金分割搜索到 0.5 nm；除非 } \mathrm{OMF}(d_0) < \mathrm{OMF}(d_{\min}) \text{，否则 } d_0 = d_{\min} \\
\text{精炼停止：} \quad & k = N_\text{iter} \text{，或 } (\mathrm{MF}_{k-6} - \mathrm{MF}_k) / \mathrm{MF}_{k-6} < 10^{-4} \\
\text{接受：} \quad & \mathrm{MF}_\text{new} < (1 - 10^{-4})\, \mathrm{MF}_\text{best} \\
\text{停在下限的层：} \quad & d_j = d_{\min} \text{，} \partial\mathrm{MF} / \partial d_j > 0 \text{，未锁定} \\
\text{更厚的起点：} \quad & \text{未锁定的层 } d_j \to s\, d_j \text{，} s = 2, 4, 8, 16
\end{aligned}
$$

$d_h$ 是被拆分层的厚度，$d_{\min}$ 为**最小厚度**，$N_\text{iter}$ 为**精炼迭代/代**，$k$ 为精炼步数。

Tikhonravov 等人让新层取使评价函数降低最多的任意厚度。这里的搜索在 60 nm 处停止：在大范围内，固定膜系的评价函数有许多极小值，这样找到的厚板可能降低评价函数却破坏设计；之后由精炼使针层增厚。Sullivan 和 Dobrowolski 去掉精炼后低于设定厚度的层；带下限的精炼器会把这样的层停在下限上，因此是否去掉它，按 Tikhonravov 等人在渐变演化中的判断方式决定：去掉，精炼，只有评价函数不变差时才保留结果。

## 参考文献

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Eq. 2.111（层矩阵），Eqs. 2.123-2.125（反射率与透射率），§2.6.4（基底的两个面），第 3 章（自动设计与针法）。
- B. T. Sullivan and J. A. Dobrowolski, *Appl. Opt.* **35**, 5484 (1996)：用前后矩阵实现的数值针法。
- A. V. Tikhonravov, M. K. Trubetskov and G. W. DeBell, *Appl. Opt.* **35**, 5493 (1996)：P 函数与综合循环。
- A. V. Tikhonravov, M. K. Trubetskov and G. W. DeBell, *Appl. Opt.* **46**, 704 (2007)：总光学厚度与渐变演化。
