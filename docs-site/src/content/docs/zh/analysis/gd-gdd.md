---
title: 群延迟 / GDD
description: 用于啁啾镜与超快镀膜的频谱相位及其导数。
ribbonIcon: gd-gdd
---

GD/GDD 窗口计算镀膜的频谱相位及其对角频率的导数：群延迟（GD, group delay）、群延迟色散（GDD, group-delay dispersion）与三阶色散（TOD, third-order dispersion）。这些量描述镀膜如何延迟光脉冲的不同部分。

相位来自复反射或透射系数：

```
φ(ω) = arg(r)  or  arg(t)
GD  = -dφ/dω       [fs]
GDD = -d²φ/dω²     [fs²]
TOD = -d³φ/dω³     [fs³]
```

## 设置

**量（Quantity）**：相位 φ、GD、GDD 或 TOD。

**反射 / 透射（Reflection / Transmission）**：从反射或透射的复振幅取相位。

**偏振（Polarization）**：s 与 p 的平均、s 或 p。该平均使用与评价函数（merit function）中匹配操作数相同的逐偏振算术平均。

**面（Side）**：评估**前（front）**镀膜还是**后（back）**镀膜。

**波长范围**：绘制与导出的跨度，单位为 nm。TFStudio 自动选择采样，并在明显的反射或透射极小值附近添加局部采样点。没有可调的导数或采样步长。

**AOI**：入射角，单位为度，在入射介质中测量。

**参考波长（Reference wavelength）**：将显示的相位在所选波长处平移为零。该常数偏移不改变 GD、GDD 或 TOD。

**目标（Targets）**：显示与所选反射或透射响应、偏振和 AOI 匹配的已启用 GD、GDD 或 TOD 评价函数目标。点操作数显示为 X 标记。平坦度操作数显示其目标水平与波长带。相位目标不叠加，因为显示的相位可能带有任意参考偏移。当前的相位色散评价函数操作数通常评估前镀膜，对仅后镀膜设计则评估后镀膜，因此其叠加仅出现在它们评分的那一侧。

## 数值如何计算

GD、GDD 与 TOD 通过特征矩阵中的三阶泰勒算术逐点评估。导数来自 `r` 或 `t` 的复对数导数；相位解缠（unwrapping）仅用于绘制相位曲线。TFStudio 使用 `n + ik` 与 `exp(-iωt)` 时间因子，然后应用一次共轭-Macleod 约定，使材料渡越时间为正，符号与材料色散窗口相同。

公式材料被精确微分。列表材料给出其保形 PCHIP 曲线的精确导数。PCHIP 为 C1：GD 连续，而高阶导数在表格节点处可能出现有限阶跃，TOD 对稀疏数据的表示方式尤其敏感。对于镀膜反射与透射，列表的 `n` 与 `k` 都对该连续性极限有贡献。GDD 与 TOD 图在节点跳变处留空，控制行上的警告徽标会标明涉及的表格模型。保存的平滑拟合仅在所述有效范围内替换表格，并在那里注明名称。

超出任何材料模型范围的波长留空并给出原因，而不是将钳制端点当作非色散数据。

## 如何解读

对于啁啾镜，GD 应跨带跟随目标斜坡，GDD 应保持用于脉冲补偿的预期值。反射零点旁一个窄的正或负 GD 特征是预期的相位行为。结合系数幅度阅读：占据深反射极小值的反射能量很少，尽管当镀膜用于透射时同一特征可能很重要。

数据表列出相位与全部三个导数相对波长的数值，便于导出。

## 参考文献

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 11, 式 11.17.
- J. Birge and F. X. Kärtner, "Efficient analytic computation of higher-order dispersion from optical interferometers," *Applied Optics* **45**, 1478-1483 (2006), [doi:10.1364/AO.45.001478](https://doi.org/10.1364/AO.45.001478).
- S. Diddams and J.-C. Diels, *Journal of the Optical Society of America B* **13**, 1120 (1996).
