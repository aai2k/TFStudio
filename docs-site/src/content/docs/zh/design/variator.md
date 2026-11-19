---
title: 参数变化器
description: 每层厚度、基底厚度以及每种材料 n 和 k 的滑块，拖动时光谱随即重绘。
ribbonIcon: variator
---

参数变化器显示设计中哪个参数起作用。拖动滑块，光谱会立即叠加在未改动的设计上重绘。厚度滑块移动的是设计本身，因此所有打开的窗口都随之变化；$n$ 和 $k$ 滑块只作用于参数变化器自身的预览。

<!-- shot: variator | the 550 nm bandpass with its spacer 2 nm thicker and TiO2 0.01 higher in index, solid curves over the dotted unmoved design and the bandpass target, preview narrowed to 450-660 nm -->
![参数变化器](/screenshots/variator-zh.png)

## 计算的量

移动后的设计（实线）与任何滑块移动之前的设计（虚线）的 T 和 R，以百分比表示，计算面取自[设计编辑器](/zh/design/design-editor/)，对 s 与 p 取平均；设计带有入射锥角时还对锥角取平均。两者之间的差距就是滑块的作用。只要有滑块不在零位，标题栏就显示**已修改**。

## 控件与设置

| 滑块 | 范围 | 步长 |
|---|---|---|
| 膜层厚度，正面与背面每层一个 | 向下到 0，向上为该层厚度与 20 nm 中较大者 | 0.1 nm |
| 基底厚度 | ± 厚度的一半，至少 ± 0.5 mm | 0.01 mm |
| 每种材料的 Δn | ± 0.5 | 0.001 |
| 每种材料的 Δk | ± 0.1 | 0.0005 |

膜层滑块标有设计编辑器的层号、材料和起始厚度。在对称设计上，背面镜像正面，没有自己的滑块。材料滑块覆盖设计中的每一种材料，包括入射介质、基底和出射介质。

行上的 **×** 或双击其滑块可把它归零；**还原**把所有滑块归零并恢复设计。

**λ** 范围和**入射角**设定预览，**目标**画出评价函数的目标，**显示基线叠加**画出虚线曲线。

## 撤销与基线

- 第一次移动厚度时记下一个撤销步骤，因此一次 Ctrl+Z 就能撤回整个调整过程。
- 切换到其他窗口再切换回来时，滑块保持原位。
- 如果设计以其他方式发生变化，例如 Ctrl+Z 或在其他窗口中编辑，参数变化器会以设计的当前状态作为基线，并把厚度滑块归零。$n$ 和 $k$ 滑块保留其数值，因为它们不属于设计。

## 理论

每个滑块都加在本次调整开始时的数值上：

$$
\begin{aligned}
d' &= \max(0,\ d + \Delta d) \\
n'(\lambda) &= n(\lambda) + \Delta n \\
k'(\lambda) &= \max(0,\ k(\lambda) + \Delta k)
\end{aligned}
$$

偏移在所有波长上相同，因此材料色散的形状保持不变。两条曲线都由膜堆的特征矩阵算出（Macleod，第 2.6 节），与[光学评价](/zh/analysis/optical-evaluation/)相同。滑块小幅移动时曲线移动多少，表明该膜层或材料在镀膜机中需要控制得多严格（Macleod，第 13.7 节）。

## 参考文献

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 2.6, pp. 42–44：薄膜组合的特征矩阵。
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 13.7, pp. 514–524：膜层厚度的公差与误差。
