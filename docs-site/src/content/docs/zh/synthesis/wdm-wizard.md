---
title: 滤光片设计
description: 通过几个引导步骤构建一个多腔法布里-珀罗带通原型（DWDM、LWDM 或陷波）。
ribbonIcon: filter-design
---

**滤光片设计（Filter Design）** 向导用六个步骤，由少量物理参数构建一个多腔带通滤光片（DWDM、LWDM 或窄陷波），并返回一个已填好评价函数行、可直接用于[精炼](/zh/synthesis/refinement/)的设计。它构建的膜系是由四分之一波反射镜块和法布里-珀罗间隔腔交替组成的：

$$
\text{Substrate} \mid M_1 S_1 M_2 S_2 \cdots M_q S_q M_{q+1} \mid \text{(optional AR)}
$$

每个 $M_i$ 是一个四分之一波反射镜块，每个 $S_i$ 是 $k$ 个半波的间隔层。从基底数起，整个膜系 H 和 L 交替，因此层数为偶数的反射镜会结束在另一种材料上，使它两侧的间隔层材料不同。两个外侧反射镜比内侧的弱，内侧反射镜把相邻的腔耦合起来：正是这一点使通带顶部变平。

<!-- shot: filter-design | the Global Integer Search step after Start on a four-cavity DWDM target: the candidate list with the seed row, and the embedded preview with the scored points drawn over it -->
![滤光片设计](/screenshots/filter-design-zh.png)

![滤光片设计的各步骤：材料、参数、腔数、原型、全局整数搜索和调整到入射介质，然后得到带评价函数行的新设计，供精炼使用。第 2 到第 5 步把滤光片嵌入基底中设计。第 5 步内部，以所选原型为种子，对反射镜整数层数和间隔层阶次做下降搜索，保留每一个降低评价函数的移动，并从扰动后的起点重复。](/diagrams/filter-design-zh.svg)

第 2 到第 5 步按**嵌入**情况设计滤光片，即假设入射介质的折射率与基底相同，这样前表面不反射；第 6 步才引入真实的介质。精炼之前，一个对称的 $N$ 腔原型会显示 $N$ 个跨在 $\lambda_0$ 两侧的小波纹：这是预期的切比雪夫响应，精炼会把它们合并为一个平顶。

## 计算量

- **形状因子**：阻带半宽与通带半宽之比。
- **腔数量**：由形状因子和两个水平求出的切比雪夫数 $q$；向导推荐大于 $q$ 的腔数，并给出 $q + 1$。
- **原型规格**中的各行 $(m, k)$：一个反射镜强度 $m$，配上能给出所要求通带宽度的最小间隔层阶次 $k$，反射镜最强的在前。
- **全局整数搜索**的候选：搜索找到的设计，按评价函数排列，原型本身标为**种子**。

## 控件与设置

**材料选择**：高折射率（H）和低折射率（L）镀膜材料、基底和入射介质；**斜入射**可设定工作**角度**和**偏振**。设计波长处 $k$ 超过 $10^{-5}$ 时向导会警告，因为高 Q 腔中的损耗会降低峰值透射率。向导会记住这些选择供下次使用。

**滤光片参数**：**滤光片波长** $\lambda_0$、在**通带水平**（默认 89.13 %，0.5 dB）处的通带半宽，以及在**截止水平**（0.1 %，30 dB）处的阻带半宽。

**腔数量**：要构建的腔数；给出的值可以修改。

**原型规格**：选择作为起点的行；**间隔层材料**显示间隔层为 H、L 或**任意**的行。

**全局整数搜索**：**开始**在所选原型附近搜索反射镜的整数层数和间隔层阶次，寻找最低的评价函数；**重启次数**设定加入多少个扰动后的起点，默认 14。选中要构建的候选。

**对称反射镜**和**对称腔**：让膜系的两半保持相同。

**通带保持 ±θ 范围**：在比工作角度再倾斜 $\theta$ 的条件下对每个设计再评分一次，因此随角度彼此失谐的腔会被淘汰。

**启动时清除历史**：默认勾选；不勾选时，之前运行的候选会留在列表中。

**调整到入射介质**：在入射介质和滤光片之间选择**无减反镀膜**、**1 层镀膜**或**2 层"V"型镀膜**，并为设计命名。

**完成**生成一个新设计，带有该膜系，并在[评价函数编辑器](/zh/design/merit-function-editor/)中写入以下各行：在工作角度和偏振下，整个通带上透射率 100 %、每个阻带上 0 %，以及覆盖所有膜层的 `MNT` 7 nm 和 `MXT` 9999 nm。它的参考波长就是铺设其四分之一波所用的波长。

## 计算方法

### 腔数

$$
\begin{aligned}
\rho &= \frac{1}{T_p} - 1 && T_p, T_s\text{：以小数表示的通带水平和截止水平} \\
q &= \text{使 } T_q(\mathrm{SF}) > \sqrt{\frac{1/T_s - 1}{\rho}} \text{ 成立的最小整数} \\
T_0 &= 1, \quad T_1 = \mathrm{SF}, \quad T_j = 2\, \mathrm{SF}\, T_{j-1} - T_{j-2}
\end{aligned}
$$

$T_q$ 是 $q$ 阶切比雪夫多项式，$\mathrm{SF}$ 是形状因子。在默认水平下阈值约为 100，$\mathrm{SF} = 3$ 时 $q = 3$，因此向导给出四个腔。

### 原型

$$
\begin{aligned}
\delta &= \operatorname{round}\!\left(\frac{\ln(n_s / n_H)}{\ln(n_L / n_H)}\right) \\
\text{反射镜：} \quad & \text{外侧 } m \text{ 个四分之一波，内侧 } 2m + 2\delta - 1 \text{ 个，间隔层 } 2k \text{ 个四分之一波} \\
\frac{\Delta\lambda}{\lambda_0} &= \frac{4}{\pi} \left(\frac{n_L}{n_H}\right)^{m+\delta} \frac{n_H - n_L}{k\,(n_H - n_L) + n_L} \\
k &= \text{使 } \frac{\Delta\lambda}{\lambda_0} \le 0.98\, r_q\, \frac{2\Delta\lambda_p}{\lambda_0} \text{ 成立的最小阶次，} \qquad r_q = \cosh\!\left(\frac{\operatorname{acosh}\sqrt{1/\rho}}{q}\right)
\end{aligned}
$$

$\delta$ 是 Thelen 的耦合阶次，即让内侧反射镜与基底匹配所需的额外反射镜强度（对大多数材料组合为 1）。宽度公式是 Thelen 给出的多腔滤光片通带宽度（Macleod 式 8.59-8.61），$r_q$ 把在通带水平处要求的宽度换算为 q 腔切比雪夫响应的半功率宽度；0.98 是一个拟合系数，使表格瞄准比要求略窄的宽度，因为搜索会把通带拓宽。表中各行从 $m = 1$ 到第一个在 $k = 1$ 时就达到该宽度的 $m$，并限制在搜索能处理的范围内，即反射镜层数 1 到 41、阶次 1 到 400。

### 搜索的评价函数

$$
\begin{aligned}
\text{通带点：} \quad & \text{17 个，均匀分布在 } \lambda_0 \pm \Delta\lambda_p \text{ 上；目标 100 \%，最外两个为通带水平；} \sigma = 1 \\
\text{阻带点：} \quad & \lambda_0 \pm \{1, 1.1, 1.2, 2\} \cdot \Delta\lambda_s \text{；目标 0 \%；} \sigma = 0.2 \\
\text{残差：} \quad & \text{通带 } \min(0,\, T - \text{target}), \quad \text{阻带 } \max(0,\, T) \qquad (T \text{ 以 \% 计}) \\
& \mathrm{MF} = \sqrt{\frac{\sum (\text{残差} / \sigma)^2}{N_\text{points}}}
\end{aligned}
$$

每个点都是单侧的：通带点只在 T 低于它时计入，阻带点只在 T 高于零时计入，因此设计可以在带边用掉通带水平所允许的余量。阻带点的权重是通带点的五倍，使截止边能与平顶相抗衡。在某个角度下，无论整数取什么，通带都会移向短波，因此先找到通带中心，再把各点移到它上面；评分的是通带的形状。开启**通带保持 ±θ 范围**时，在工作角度加 $\theta$ 的条件下再对同样的点评分一次，MF 是两组点的均方根。嵌入时，入射角换算为基底中的角度，$n_\text{inc} \sin\theta_\text{inc} = n_s \sin\theta_s$。

### 整数搜索

$$
\begin{aligned}
\text{移动：} \quad & \text{每个反射镜 } \pm 1, \pm 2 \text{；每个间隔层 } \pm 1, \pm 2 \text{；} \\
& \text{间隔层 } i \text{ 变化 } \pm 1 \text{ 或 } \pm 2 \text{，同时反射镜 } i \text{ 和 } i + 1 \text{ 反向变化 1 或 2；} \\
& \text{所有间隔层 } \pm 1 \text{，同时所有内侧反射镜反向变化 1} \\
\text{下降：} \quad & \text{保留每一个降低 MF 的移动；一整轮都没有降低时停止} \\
\text{重启：} \quad & \text{反射镜} + \operatorname{round}\bigl(6 (u - 0.5)\bigr) \text{，外侧反射镜再减 2；间隔层} + \operatorname{round}\bigl(2 (u - 0.5)\bigr)
\end{aligned}
$$

$u$ 在 $[0, 1)$ 上均匀分布。之所以有成对的移动，是因为一个腔的宽度正比于反射镜项 $(n_L/n_H)^{2x}$ 除以其阶次（Macleod 式 8.24-8.25）：单独提高间隔层阶次会使该腔变窄，几乎从任何起点出发都是上坡；而配合减弱反射镜的同一步能保持宽度，从而到达更高阶的设计。原型行始终保留在列表中，因此即使有波纹的设计评分更低，干净的原型仍然可选。

### 调整到入射介质

$$
\begin{aligned}
r_1 &= \frac{\eta_0 - \eta_1}{\eta_0 + \eta_1}, \qquad r_2 = \frac{\eta_1 - \eta_2}{\eta_1 + \eta_2}, \qquad r_3 = \frac{\eta_2 - Y}{\eta_2 + Y} \\
\operatorname{Re}\!\left(r_3\, e^{-2i\delta_2}\right) &= \frac{r_2^2 + \lvert r_3\rvert^2 - r_1^2 - r_1^2 r_2^2 \lvert r_3\rvert^2}{2 r_2 (r_1^2 - 1)} \\
e^{-2i\delta_1} &= \frac{-r_1 \left(1 + r_2 r_3\, e^{-2i\delta_2}\right)}{r_2 + r_3\, e^{-2i\delta_2}}
\end{aligned}
$$

$Y$ 是嵌入滤光片在 $\lambda_0$ 处呈现的导纳，$\eta_0$ 是入射介质的导纳，$\eta_1$ 和 $\eta_2$ 是两层镀膜的导纳，都按工作角度和偏振取倾斜导纳（s 偏振 $\eta = n \cos\theta$，p 偏振 $\eta = n / \cos\theta$）。第一行方程在两侧各有一个根，对 H、L 的两种顺序各给出两个 V 型镀膜解。保留的镀膜是能使 $\lambda_0$ 处反射率低于 $10^{-6}$ 的最薄者，否则取剩余反射率最小者；偏振取平均时，两个平面的根都按平均反射率评分。1 层镀膜取剩余反射率最小的相位厚度。当镀膜的内层与滤光片外层材料相同时，两者合并为一层。

在斜的工作角度下，通带位于铺设四分之一波所用的波长之下，因此向导把它们铺在一个更长的参考波长 $\lambda_\text{ref}$ 上：测出加了镀膜的滤光片的通带落在哪里后，把参考波长乘以 $\lambda_0 / \lambda_\text{centre}$，做两次，并保留通带最接近 $\lambda_0$ 的那个参考波长。

## 参考文献

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §4.3（双层减反膜），§8.2（多腔滤光片，式 8.24-8.25 和 8.59-8.61，倾斜见 §8.2.5），§9.2（倾斜导纳）。
- A. Thelen, *J. Opt. Soc. Am.* **56**, 1533 (1966)：多层滤光片中的等效层。
- A. Thelen, *Design of Optical Interference Coatings* (McGraw-Hill, 1988)：多腔带通滤光片。
- A. V. Tikhonravov and M. K. Trubetskov, *Appl. Opt.* **41**, 3176 (2002), §3：WDM 滤光片的自动设计、切比雪夫腔数和 Thelen 原型。
