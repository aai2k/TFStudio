---
title: 材料色散
description: 穿过体材料传播的相位、群延迟、GDD 与 TOD。
ribbonIcon: material-dispersion
---

材料色散（Material Dispersion）窗口计算单次穿过所选厚度体材料所增加的延迟。它将基底或窗口色散与镀膜色散分离，并为[GD / GDD 窗口](/zh/analysis/gd-gdd/)中的整体（Total）模式提供闭式检验。

对于厚度 `d`、折射率 `n(ω)` 与角频率 `ω`，报告的传播项为：

```
GD  = (d/c) [n + ω dn/dω]
GDD = (d/c) [2 dn/dω + ω d²n/dω²]
TOD = (d/c) [3 d²n/dω² + ω d³n/dω³]
```

## 设置

**材料（Material）**：活动设计与材料目录中可用的任何材料。

**厚度（Thickness）**：单次传播距离。选择 nm、µm 或 mm 以直接使用薄膜与基底尺寸。对于不透明路径，控制行上的警告徽标报告使完整所选范围可评估的最大厚度。

**量（Quantity）**：相位、GD、GDD 或 TOD。

**波长范围**：绘制与导出的跨度。TFStudio 自动选择采样，因为每个波长逐点评估。

## 材料模型

公式导数对存储系数精确。PCHIP 导数对穿过所提供表格的三次分段精确，但更高阶仍描述该插值选择。PCHIP 通过其第一导数连续；GDD 与 TOD 可能在表格节点处跳变。图在这些跳变处留空，而非连接无关的单向值。用户创建的平滑拟合仅在随材料存储的有效范围内使用。超出模型范围的点留空，窗口报告省略了多少个。

对于吸收材料，k 不直接进入传播相位。它设定直接脉冲存活多少。TFStudio 屏蔽所选厚度使场光学深度超过 50 的波长，相当于内部强度透射低于 exp(-100)。在那里报告延迟将描述已被熄灭的脉冲的相位。

作为参考，附带的熔融石英 Sellmeier 模型在 800 nm 处给出约 36.2 fs²/mm。此检验仅为体传播，不包含镀膜界面相位。

## 参考文献

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 11.
- I. H. Malitson, "Interspecimen Comparison of the Refractive Index of Fused Silica," *Journal of the Optical Society of America* **55**, 1205-1209 (1965), [doi:10.1364/JOSA.55.001205](https://doi.org/10.1364/JOSA.55.001205).
- OptiLayer, "Material Dispersion", 体材料相位与群延迟定义。
