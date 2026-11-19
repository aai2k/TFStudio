---
title: 实测椭偏
description: 导入光谱椭偏仪测得的一对 Ψ 与 Δ，与设计比较，并把实测或计算的 Ψ/Δ 导出为 CSV。
ribbonIcon: measured-ellipsometry
---

实测椭偏把光谱椭偏仪测得的 $\Psi$ 与 $\Delta$ 带入设计：**导入**从仪器文件读取这一对曲线并保存在设计上，**导出**把导入的曲线或设计计算出的 $\Psi$ 与 $\Delta$ 写成 CSV。这些曲线与[实测光谱](/zh/data-exchange/measured-spectra/)中的光度曲线分开保存，因为它们没有百分比刻度，也没有偏振可选，没有入射角就毫无意义，而且 $\Delta$ 的符号因仪器而异。在这里导入的一对曲线正是 [n,k 表征](/zh/data-exchange/nk-characterization/)所读取的数据。

<!-- shot: measured-ellipsometry | Ψ and Δ at 70° of an as-built 500 nm TiO2 film on BK7 read from CSV and added to the design -->
![实测椭偏](/screenshots/measured-ellipsometry-zh.png)

## 计算的量

- 预览画出正在设置的列；单击卡片时画出设计上的该曲线。
- 在[椭偏测量](/zh/analysis/ellipsometry/)上，曲线和拟合目标画在设计的 $\Psi$ 与 $\Delta$ 之上，采用该图所显示的 $\Delta$ 约定。
- 拟合目标把设计的 $\Psi$ 或 $\Delta$ 与实测点比较，$\Delta$ 沿圆周的短路径计算。

## 本窗口接受何种测量

各向同性样品的反射椭偏：在给定入射角下以反射方式测得、以度为单位、随波长变化的 $\Psi$ 或 $\Delta$，其定义与[椭偏测量](/zh/analysis/ellipsometry/)窗口相同（[理论](#理论)）。厚度拟合可以只用其中一条曲线；[n,k 表征](/zh/data-exchange/nk-characterization/)需要同一测量的两半，因为它在每个波长上求解两个未知数。

| 不支持 | 替代办法 |
|---|---|
| **透射椭偏**，与反射的一对曲线是不同的量 | 以反射方式测量该样品。 |
| **广义椭偏或 Mueller 矩阵椭偏**，各向异性或退偏的样品 | 这里不涉及；薄膜按各向同性处理。 |
| **Is、Ic 与 Ic′**，相位调制椭偏仪的原始输出 | 在仪器自己的软件中导出 $\Psi$ 与 $\Delta$。 |
| **$\tan\Psi$ 与 $\cos\Delta$**，有时写在 `PSI` 和 `DELTA` 标题下 | 先换算为度。从不超出 −1 到 1 的 $\Delta$ 列会被标出，而不会被拟合。 |
| **单一波长下的角度扫描** | 使用[椭偏测量](/zh/analysis/ellipsometry/)的角度模式。 |

哪些仪器的导出文件已完整读取通过，见[椭偏文件](/zh/data-exchange/spectrum-file-formats/#椭偏文件)。

## 控件与设置

曲线属于项目浏览器中所选的设计，与实测光谱相同。

**打开文件…**读取文件。面板报告解析结果，并允许设定波长单位、列、$\Psi$ 或 $\Delta$ 以及名称。$\Psi$ 与 $\Delta$ 按数值而非列的顺序区分：$\Psi$ 不会超出 0 到 90°，因此超出该范围的列是 $\Delta$；名为 `Psi` 或 `Delta` 的列按其名称采用，单击一次即可互换。然后是文件可能未说明、保存在每条曲线上并可在其卡片上修改的内容：

- **入射角**，某列没有入射角时询问。正入射时任何薄膜都给出 $\Psi = 45^\circ$ 和 $\Delta = 180^\circ$，因此拟合会拒绝 0° 的曲线。它从 70° 开始，接近硅的主角，大多数固定角度仪器都工作在这里。
- **Δ 约定**：**Azzam–Bashara**，即测量文件所用的约定，也是默认值；或 **360° − Δ**，用于另一种时间约定的数据。它必须与[椭偏测量](/zh/analysis/ellipsometry/)窗口的选择一致；$\Delta$ 看起来像设计的镜像时，说明两者不一致。
- **入射面**，在两面镀膜的设计上：测量的是哪一面的镀膜。背面的曲线画在椭偏测量的背面上，暂时不能拟合。

**添加此列**添加设置好的列；**添加全部已标注列**添加每个已指定物理量的列，适合两列的 $\Psi$/$\Delta$ 文件。每条曲线的卡片显示是否绘制、颜色、属于哪一半、名称、入射角、所在面、$\Delta$ 约定、点数和范围。

**新建曲线**和**编辑**打开[实测光谱](/zh/data-exchange/measured-spectra/#输入曲线或修改其数据点)的曲线编辑器，带有以度为单位的 $\Psi$ 列和 $\Delta$ 列，绘在设计于该曲线入射角下的 $\Psi$ 或 $\Delta$ 之上。超出 0 到 90° 的 $\Psi$ 显示为红色，$\Delta$ 按展开后的角度平滑和重采样。新曲线以正入射加入；在**应用**之后，到其卡片上设定入射角和约定。

**导出**：**实测**写出勾选的曲线。**由设计计算**按你选择的范围、步长和入射角写出设计的 $\Psi$ 与 $\Delta$，采用按钮旁设定的 $\Delta$ 约定，与导入标签页的约定无关；仪器软件读取的是 Azzam–Bashara。X 轴可为 nm、µm 或 eV。

把设计计算出的 $\Psi$ 与 $\Delta$ 导出，再在 n,k 表征中拟合回来，应当得到最初的薄膜，残差接近零；若这一往返不闭合，首先检查 $\Delta$ 约定和入射角。

## 把设计拟合到测量

曲线上的**拟合…**把它变为评价函数目标，使[精炼](/zh/synthesis/refinement/)移动膜层厚度，直到计算的 $\Psi$ 或 $\Delta$ 与之吻合，网格、范围、权重和约束与[实测光谱](/zh/data-exchange/measured-spectra/#将设计拟合到测量)相同。它表征已知的膜系；同时放开折射率则是 [n,k 表征](/zh/data-exchange/nk-characterization/)的工作。

- 每条曲线单独拟合，成为保存其数据点的一行。在一段光谱范围上，单独的 $\Psi$ 就能确定已知膜系的厚度，$\Delta$ 也是如此，另一个入射角下的 $\Delta$ 只是又一个目标；对两半各按一次**拟合…**即可同时使用。
- $\Delta$ 约定随该行保存，并在进入评价函数时换算；约定错误时偏差可达几十度。
- 相对于反射率行，$\Psi$ 与 $\Delta$ 有自己的[单位尺度](/zh/design/operands/#单位尺度)，按椭偏仪的分辨能力设定，而不是按 90° 和 360° 的范围。
- $\Delta$ 的均匀重采样对展开后的角度插值，因此在测量越过 360° 的地方不会凭空造出穿过 180° 的目标。
- 正入射下的曲线以及背面的曲线会被拒绝拟合，因为 $\Psi$ 与 $\Delta$ 只在正面膜系上计算，设计也必须在其正面上评价。

无论曲线是否还在，椭偏测量都会画出目标，导入标签页会提出恢复曲线。

## 理论

$\Psi$ 与 $\Delta$ 来自反射的 p 与 s 振幅之比：

$$
\begin{aligned}
\rho = r_p / r_s &= \tan\Psi \cdot \exp(i\Delta) \\
\Delta' &= 360^\circ - \Delta && \text{other time convention} \\
r &= \bigl((\Delta_\text{design} - \Delta_\text{meas} + 180^\circ) \bmod 360^\circ\bigr) - 180^\circ
\end{aligned}
$$

$\Psi$ 是幅值比的反正切，因此保持在 0 到 90° 之内，而 $\Delta$ 覆盖整整一周；$r$ 是沿短路径计算的 $\Delta$ 残差，因此 359° 与 1° 相差 2°。

## 参考文献

- R. M. A. Azzam and N. M. Bashara, *Ellipsometry and Polarized Light* (North-Holland, 1977): the definition of $\Psi$ and $\Delta$ and the sign convention.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 14.2, pp. 544–560 (Eq. 14.17)：镀膜的椭偏参数。
