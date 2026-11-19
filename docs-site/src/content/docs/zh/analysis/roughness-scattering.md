---
title: 粗糙度 / 散射
description: 查看界面粗糙度如何改变设计的镜面 R 和 T，以及有多少光被散射出光束。
ribbonIcon: roughness
---

真实界面从来不是完全光滑的。粗糙度 / 散射把设计中每个粗糙界面替换为一个薄过渡层，把由此得到的镜面 R 和 T 与光滑设计的 R 和 T 并列显示，并给出从镜面光束中损失的光。

<!-- shot: roughness | quarter-wave mirror with 1 nm of long-range roughness on every interface, rough R and T over smooth, specular loss in ppm -->
![粗糙度 / 散射](/screenshots/roughness-zh.png)

## 计算的量

- **R** 和 **T**，以百分比表示，粗糙的画为实线，光滑的画为淡色点线。
- 右轴上的**镜面损耗**，以 ppm 或分数表示：光滑的 $R + T$ 减去粗糙的 $R + T$。

非吸收设计上的小尺度粗糙度不损失光；它的作用体现在点线与实线之间的差距上。大尺度损耗像吸收一样随各界面处的电场变化：反射镜在其高反射带内损失很少，因为光到不了内部界面，而在两侧的谷中损失多得多。在吸收设计中，过渡层也会改变吸收，当过渡层替换了吸收层的一部分时，损耗甚至可能低于零。

## 控件与设置

**T / R** 包含**平均**、**s** 和 **p**，每项都画光滑与粗糙两条。**ppm / 分数**设定损耗轴。

**设置**：**λ** 范围与步长，以及**入射角**。

**粗糙度**条：**均匀 σ** 给每个界面同一个均方根粗糙度 $\sigma$ 和类型；**逐界面**分别设置每个界面，界面以其分隔的两种介质命名，各有自己的 $\sigma$ 以及**小尺度**或**大尺度**。**重置**把每个界面恢复为 $\sigma = 1$ nm、大尺度。界面遵循在[设计编辑器](/zh/design/design-editor/)中设置的计算方式：正面、背面，或两面且中间为基底。

**环境**：在有多个[环境](/zh/design/environments/)的设计上，**当前**跟随设计编辑器显示的环境，按编号选中的环境即使已关闭也让窗口停留在它上面。$\sigma$ 和类型对所有环境是同一份列表；在所显示的环境中，每个过渡层位于该处相接的两种材料之间。这一选择不随设计保存。

## 小尺度与大尺度

**小尺度**是比波长细得多的粗糙度。光把它看作折射率的逐渐变化，因此界面成为一个厚 $2\sigma$ 的渐变层，$n$ 和 $k$ 从一种材料线性变到另一种材料，相当于一个不损失光的弱增透层。

**大尺度**是起伏宽于波长、会把光散射出镜面光束的粗糙度。界面成为一个厚 $2\sigma$ 的均匀层，其折射率介于两种材料之间，并带有一个代表散射光的小 $k$。

两种层的厚度都取自界面下方的膜层，即先沉积的那一层，因此设计的其余部分保持原位。基底从不被减薄，因此基底上的过渡层使镀膜增加 $2\sigma$。比从中扣除的过渡层更薄的膜层被设为零，窗口会给出提示。没有膜层的面保持其光滑的裸表面。

大尺度层是针对两种透明材料之间的单个表面、正入射、$\sigma$ 小到可以忽略 $(\sigma/\lambda)^2$ 以上各项的情况推导的。窗口把它用于多层膜的每个界面、任意入射角和入射锥角，此时会给出提示：请把这些结果当作估算。紧邻吸收材料时只取其折射率的实部。

## 理论

小尺度：在材料 a 与 b 之间厚 $2\sigma$ 的层，按[不均匀性](/zh/analysis/inhomogeneities/)中的方式切片：

$$
N(s) = (1 - s) \cdot N_a + s \cdot N_b \qquad \text{层内 } 0 \le s \le 1
$$

大尺度：Carniglia 与 Jensen 的单层模型（式 16、42、43），与 Macleod 式 16.32 相同：

$$
\begin{aligned}
d &= 2\sigma \\
n^2 &= \frac{n_a^2 + n_b^2}{2} \\
k &= \frac{\pi (n_a - n_b)^2 (n_a + n_b)\, d}{4 n \lambda}
\end{aligned}
$$

在单个表面上，它在 $(\sigma/\lambda)^2$ 项以内重现标量散射理论给出的镜面变化，对两侧入射的光都成立：

$$
\begin{aligned}
\Delta R &= -R_0 \left( \frac{4\pi n_a \sigma}{\lambda} \right)^2 \\
\Delta T &= -T_0 \left[ \frac{2\pi (n_a - n_b)\, \sigma}{\lambda} \right]^2
\end{aligned}
$$

因此单个表面的损耗按 $(\sigma/\lambda)^2$ 增长，在红外中无害的粗糙度在紫外中可能很重要。过渡层随后作为普通膜层进入膜系，按[光学评价](/zh/analysis/optical-evaluation/)中的方式计算。

## 参考文献

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 16.5, pp. 623–628（式 16.32）：散射以及把粗糙度表示为过渡层。
- C. K. Carniglia and D. G. Jensen, "Single-layer model for surface roughness", *Appl. Opt.* **41**, 3167 (2002).
