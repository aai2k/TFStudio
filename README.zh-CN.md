<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)"
          srcset="https://raw.githubusercontent.com/aai2k/TFStudio/main/assets/banner-on-dark.png">
  <img width="320" alt="TFStudio"
       src="https://raw.githubusercontent.com/aai2k/TFStudio/main/assets/banner-on-light.png" />
</picture>

**开源的光学薄膜设计、分析与优化环境**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![Version](https://img.shields.io/badge/version-1.5.0-informational)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey)
[![Maintainability](https://qlty.sh/gh/aai2k/projects/TFStudio/maintainability.svg)](https://qlty.sh/gh/aai2k/projects/TFStudio)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21196149.svg)](https://doi.org/10.5281/zenodo.21196149)

**[官网](https://tfstudio.xyz)** · **[教程](https://tfstudio.xyz/blog)** · **[在线演示](https://tfstudio.xyz/demo/)** · **[文档](https://docs.tfstudio.xyz)** · **[下载](../../releases)**

[English](./README.md) · **简体中文**

</div>

## TFStudio 是什么？

TFStudio 是一款用于**光学薄膜**设计与分析的专业桌面软件，适用于增透膜、高反射膜、分光膜、带通滤光片、截止滤光片等各类膜系。它将严格的双精度光学计算引擎、现代化的优化与自动合成算法，以及完整的分析工具集，整合在一个可停靠的多窗口界面中。

> ⚠️ **声明：** TFStudio 为独立开发的软件。在将设计结果投入实际镀膜生产之前，请务必用您自己的计算和实测数据加以验证。

## 主要功能

**设计与计算**
- 传输矩阵法（TMM），支持**吸收性和色散性**介质在**斜入射**下的 **s 偏振与 p 偏振**计算
- 完整系统建模：正面膜系、基底（含吸收）与背面膜系，并计入基底内部的非相干多次反射
- 反射率 / 透射率 / 吸收率光谱、颜色计算、积分评价指标
- 膜层编辑器支持物理厚度、光学厚度、四分之一波长与全波长厚度的同步表示

**优化与自动合成**
- **阻尼最小二乘法（DLS / Levenberg–Marquardt）**优化，采用**解析雅可比矩阵**
- 其他优化算法：牛顿法、牛顿共轭梯度法、序列二次规划（SQP）、共轭梯度法、差分进化、模拟退火
- **针式优化（needle）**与**逐步演化（gradual evolution）**自动合成，可从零开始自动插入膜层
- 针对膜层数本身的结构优化
- 灵活的评价函数：光谱目标值、斜坡目标、波段平均、最差值操作数、厚度约束
- 基于 Web Worker 线程池的多线程计算，核心运算采用 **WebAssembly (SIMD)** 加速

**分析窗口**
- 光学性能计算、导纳图、电场分布、群延迟与群延迟色散（GD / GDD）、椭偏参数、颜色计算、折射率剖面
- 容差与工艺分析：蒙特卡罗误差分析、膜层灵敏度、折射率不均匀性、粗糙度与散射、系统性偏差

**材料**
- 内置材料库，由 [refractiveindex.info](https://refractiveindex.info) 数据库生成（CC0 公有领域）
- 支持 Sellmeier、Cauchy 及表格型色散模型；复折射率约定明确
- 支持导入外部材料库，并内置 refractiveindex.info 在线浏览器

**镀膜工艺**
- 镀膜与监控过程仿真（宽带光学监控与单色光监控）
- 工艺导出，以及光学镀膜数据交换（含 Zemax OpticStudio 膜系导入/导出）

**平台**
- 跨平台桌面应用（Electron + React，纯 JavaScript 实现）
- 内置帮助文档，界面支持英文与俄文

## 科学依据

TFStudio 实现的是成熟的薄膜光学理论，并标注一手文献出处：

- **传输矩阵法：** H. A. Macleod, *Thin-Film Optical Filters*, 5th ed.
- **数值针式合成：** Sullivan & Dobrowolski, *Appl. Opt.* **35**, 5484 (1996)；Tikhonravov et al., *Appl. Opt.* **35**, 5493 (1996)
- **逐步演化法：** Tikhonravov et al. (2007)

所有计算均采用双精度。在经过验证的测试算例中，TMM 引擎与独立参考计算的偏差在个位数 ppm 量级以内。

传输矩阵引擎已作为 **[tmmcore](https://github.com/aai2k/tmmcore)** 独立发布，无需安装 TFStudio 即可验证其精度：两条命令即可复现与另一独立实现之间 8.6e-14 的一致性。详见其[验证页面](https://aai2k.github.io/tmmcore/validation/)。

## 安装

### 直接下载（推荐）

请从 [**Releases**](../../releases) 页面获取对应平台的最新版本。

**Windows：** `TFStudio Setup <ver>.exe` 为常规安装程序；`TFStudio-<ver>-Portable.exe` 为免安装的单文件版本，适合权限受限的镀膜机控制电脑。同时另有 Windows 7 / 8.1 版本发布。

**Linux：** 在 Debian 与 Ubuntu 上推荐使用 `TFStudio-<ver>-amd64.deb`：

```bash
sudo apt install ./TFStudio-*-amd64.deb
tfstudio
```

以 root 身份安装才能保持 Chromium 沙箱处于启用状态。`.deb` 是唯一保留沙箱的 Linux 安装包，同时会将 TFStudio 添加到应用程序菜单。

`TFStudio-<ver>-x86_64.AppImage` 是便携式方案：

```bash
chmod +x TFStudio-*-x86_64.AppImage
./TFStudio-*-x86_64.AppImage
```

AppImage 需要 FUSE 2，而 Ubuntu 22.04 及更高版本默认不再安装。可以自行安装（`sudo apt install libfuse2`）、以 `--appimage-extract-and-run` 方式运行，或改用 `TFStudio-<ver>-x64.tar.gz` 压缩包，后者解压后即可运行，无此依赖。

使用 `.tar.gz` 时，请通过附带的启动脚本运行，而不要直接执行二进制文件：

```bash
tar xzf TFStudio-*-x64.tar.gz
cd TFStudio-*-x64
./tfstudio.sh
```

`tfstudio.sh` 用于规避 Chromium 的一项限制：沙箱辅助程序必须归 root 所有，而以普通用户解压的压缩包无法满足这一点。直接运行 `tfstudio` 二进制文件会在启动时报错 `The SUID sandbox helper binary was found, but is not configured correctly`。该脚本仅在确无其他可行方案时才关闭沙箱，因此安装 `.deb` 仍是更安全的选择。

想先试用？可直接运行 **[在线演示](https://tfstudio.xyz/demo/)**，在浏览器中查看示例膜系与实时光谱，无需任何安装。

### 从源码构建

需要 [Node.js](https://nodejs.org) 18+ 与 git。

```bash
git clone https://github.com/aai2k/TFStudio.git
cd TFStudio
npm install
npm start          # 启动应用
```

WebAssembly 传输矩阵内核随 `tmmcore` 依赖以预编译形式提供，因此无需 Emscripten 工具链，源码构建可获得与发行版二进制相同的性能。

`npm run build` 会自动检出 refractiveindex.info 数据库子模块并安装文档站点依赖。该数据库体积较大；如需提前拉取而非在首次构建时下载，请使用 `--recursive` 克隆。

其他常用脚本：

```bash
npm test              # 运行测试套件
npm run docs:install  # 安装文档站点依赖（docs:dev 之前需先执行）
npm run docs:dev      # 预览文档站点
npm run build         # 打包可分发版本（electron-builder）
```

用户文档托管于 **[docs.tfstudio.xyz](https://docs.tfstudio.xyz)**，同时内置于应用中（帮助菜单），源码位于 [`docs-site/`](./docs-site)。

## 引用 TFStudio

如果 TFStudio 对您的工作有所帮助，欢迎引用。引用信息见 [`CITATION.cff`](./CITATION.cff)，GitHub 会据此生成 “Cite this repository” 按钮。

## 参与贡献

欢迎提交 issue 与 pull request。由于 TFStudio 是一款科学计算工具，涉及光学引擎的贡献需满足物理正确性要求：注明文献出处、与参考结果对比验证、并补充测试。提交 pull request 前请先阅读 [**CONTRIBUTING.md**](./CONTRIBUTING.md)。

提交贡献即表示您同意以本项目的 MIT 许可证授权您的贡献。

## 许可证

[MIT](./LICENSE) © 2026 Andrey Achapovsky

## 作者

**Andrey Achapovsky：** [ORCID 0009-0005-1497-6279](https://orcid.org/0009-0005-1497-6279)

## 致谢

- 材料数据来源于 [refractiveindex.info](https://refractiveindex.info) 数据库（CC0，公有领域）。
- 基于 [Electron](https://www.electronjs.org/)、[React](https://react.dev/)、[Plotly.js](https://plotly.com/javascript/) 与 [KaTeX](https://katex.org/) 构建。
