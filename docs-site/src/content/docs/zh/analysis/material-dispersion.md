---
title: 材料色散
description: 光在块状材料中传播的相位、群延迟、GDD、CDC 和 TOD。
ribbonIcon: material-dispersion
---

材料色散计算光脉冲单次穿过给定厚度的块状材料时所受的影响：相位、群延迟和各色散项。用它来计算光路中的基底、窗口或其他玻璃，与镀膜分开；镀膜的色散由 [GD / GDD 窗口](/zh/analysis/gd-gdd/)给出。本窗口不需要设计。

<!-- shot: material-dispersion | GDD of 1 mm of fused silica from 400 to 1100 nm -->

## 计算的量

与 GD / GDD 窗口相同的五个量，只针对该平板：**相位**（度）、**GD**（fs）、**GDD**（fs²）、**CDC**（fs/nm）和 **TOD**（fs³）。作为核对，内置熔融石英在 800 nm 处的 GDD 约为 36.2 fs²/mm。

## 控件与设置

**材料**：设计或材料库中的任意材料。**物理量**：上述五者之一。

**设置**：**厚度**，即单次通过的光程，单位 nm、µm 或 mm，以及 **λ** 范围。采样自动选取。

**提示**：当 λ 范围超出材料的数据范围时，曲线画在一条标有其实际覆盖范围的阴影带上，徽标提供把图缩小到该范围的操作。表格材料在那里保持其端点值，因此平板被画成无色散；公式材料则被外推。完全没有数值的波长显示为空缺，徽标给出原因：吸收平板太厚，脉冲无法通过（同时给出使整个范围仍可计算的最大厚度），或模型无法给出三阶导数。

## 表格节点

公式材料被精确求导。表格材料用保形三次插值（PCHIP），只有数值和斜率连续，因此 GDD 和 TOD 在每个表格点处有台阶；图中把台阶画为经过两侧数值的阶跃，而不是空缺。拟合的色散公式只在其保存的有效范围内使用。

## 理论

对厚度 d、折射率 n(ω) 和角频率 ω：

```
φ   = −(d/c) ω n
GD  = (d/c) [n + ω dn/dω]
GDD = (d/c) [2 dn/dω + ω d²n/dω²]
TOD = (d/c) [3 d²n/dω² + ω d³n/dω³]
CDC = GDD · 2πc / λ²
```

这些就是 −dφ/dω 及其各阶导数，与镀膜各项符号相同，因此平板的 GDD 与镀膜的 GDD 相加，如 Macleod 式 11.19 所示。GD 中的括号就是群折射率。

消光系数 k 不进入相位；它决定脉冲还剩多少。当场的光学深度 `2π·k·d / λ` 超过 50，即内部透射率低于 e⁻¹⁰⁰ 时，该波长被屏蔽，因为那里的延迟描述的是一个已经不存在的脉冲。

## 参考文献

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 11.2, pp. 414–425（式 11.18–11.19）：介质的群速度色散与净 GDD。
- I. H. Malitson, "Interspecimen Comparison of the Refractive Index of Fused Silica," *Journal of the Optical Society of America* **55**, 1205-1209 (1965), [doi:10.1364/JOSA.55.001205](https://doi.org/10.1364/JOSA.55.001205).
