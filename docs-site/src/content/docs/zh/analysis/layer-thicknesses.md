---
title: 膜层厚度
description: 镀膜的每一层画为一个条形，以物理或光学厚度为单位，按材料着色。
ribbonIcon: layer-thicknesses
---

膜层厚度把镀膜画成每层一个条形，按材料着色。它显示列表看不出的厚度序列形状：啁啾镜的渐变、针法运行插入的薄层，或经优化后比相邻层厚得多的某一层。

<!-- shot: layer-thicknesses | chirped mirror in QW at its 700 nm reference wavelength, the chirp reading as a taper -->
![膜层厚度](/screenshots/layer-thicknesses-zh.png)

## 计算的量

- **nm**：物理厚度 $d$。
- **OT**：光学厚度 $n \cdot d$，单位 nm。
- **QW**：四分之一波数，$4 \cdot n \cdot d / \lambda_0$。四分之一波层读数为 1，半波腔层为 2。
- **FW**：全波数，$n \cdot d / \lambda_0$。

膜层从基底开始编号，与[设计编辑器](/zh/design/design-editor/)相同，厚度为零的层保留其编号。**结果**以四种单位列出每一层。

## 控件与设置

**单位**和**面**选择条形显示的内容。**设置**中是 **λ₀**，即光学单位读取各折射率所用的波长；它跟随设计的参考波长，因此 QW 与设计编辑器的 QW 列一致。

**环境**：在有多个[环境](/zh/design/environments/)的设计上，**当前**跟随设计编辑器显示的环境，按编号选中的环境即使已关闭也让窗口停留在它上面。每个条形是该环境沉积出的膜层，计入其材料的厚度系数和温度带来的变化，光学单位读取该材料在那里的折射率。这一选择不随设计保存。

## 理论

$n$ 为该层在 $\lambda_0$ 处折射率的实部：

$$
\begin{aligned}
\mathrm{OT} &= n \cdot d \\
\mathrm{QW} &= \frac{4 \cdot n \cdot d}{\lambda_0} \\
\mathrm{FW} &= \frac{n \cdot d}{\lambda_0} \\
\delta &= \frac{2\pi \cdot n \cdot d}{\lambda_0} = \frac{\pi}{2} \cdot \mathrm{QW}
\end{aligned}
$$

$\delta$ 是正入射时 $\lambda_0$ 处的相位厚度。$\mathrm{QW} = 1$ 的膜层 $\delta = \pi/2$，把导纳从 $Y'$ 变为 $n^2/Y'$；$\mathrm{QW} = 2$ 的膜层是半波层，在 $\lambda_0$ 处不起任何作用，称为虚设层（Macleod，第 3.1 节）。

## 参考文献

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 3.1, pp. 65–66：四分之一波与半波光学厚度。
