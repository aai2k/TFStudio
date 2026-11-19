---
title: AI 助手（MCP）
description: 通过模型上下文协议（MCP），让 AI 助手打开、计算、精炼并保存 TFStudio 设计。
---

TFStudio 可以通过模型上下文协议（MCP）把它的设计工具交给 Claude 等 AI 助手使用。助手随后可以打开和构建设计、计算光谱和评价函数、运行精炼与合成，并把结果保存为 `.tfs` 文件，供你在应用中打开。它与应用各窗口使用同一套计算代码，因此给出的数值与应用显示的一致。

## 连接助手

已安装的应用本身就是服务器。以 `--mcp` 启动时，TFStudio 不打开任何窗口，通过标准输入和标准输出与助手通信。应用打开时它也可以同时运行。

**Claude Desktop**：依次打开 Settings、Developer、Edit Config，在 `claude_desktop_config.json` 的 `mcpServers` 下加入 TFStudio，并填写你的安装路径：

```json
{
  "mcpServers": {
    "tfstudio": {
      "command": "C:\\Users\\you\\AppData\\Local\\Programs\\TFStudio\\TFStudio.exe",
      "args": ["--mcp"]
    }
  }
}
```

**Claude Code**：在终端中添加。

```bash
claude mcp add tfstudio -- "C:\Users\you\AppData\Local\Programs\TFStudio\TFStudio.exe" --mcp
```

**其他助手**：凡是能自行启动 MCP 服务器的助手，都使用同样的两项设置：以 `TFStudio.exe` 的路径作为命令，以 `--mcp` 作为参数。Codex、Cursor、Cline 和 Cherry Studio 都是如此，无论你在其中使用哪个模型。ChatGPT 应用只连接通过互联网访问的服务器，因此无法启动 TFStudio。

添加服务器后重启助手。

服务器使用应用所用的数据文件夹：默认是 `Documents\TFStudio`，除非你在首选项中移动过它。它看到的材料，包括你自己的材料目录和库目录，与应用看到的相同。它只读取设计和材料目录，只写入助手保存的 `.tfs` 文件，已存在的文件只有在助手明确要求时才会被覆盖。此外它在应用旁保留自己的日志 `mcp-server.log`。

## 助手能做什么

| 类别 | 工具 |
| ---- | ---- |
| 设计方法 | `designMethod` |
| 设计 | `openDesign`、`newDesign`、`setDesignSetup`、`saveDesign`、`showDesign`、`listDesigns`、`copyDesign`、`designDifferences` |
| 膜层堆栈 | `insertLayer`、`deleteLayer`、`setLayer`、`stackFromFormula`、`cleanDesign`、`scaleThicknesses`、`quantize`、`perturb`、`flipLayers`、`copySide`、`edgeFilter`、`applyEdgeFilter`、`needleProfile`、`insertNeedle` |
| 环境 | `environments`、`addEnvironment`、`setEnvironment`、`removeEnvironment` |
| 评价函数 | `setMerit`、`merit` |
| 规格 | `setSpecification`、`checkSpecification` |
| 材料 | `findMaterials`、`materialNK`、`materialDispersion` |
| 分析 | `spectrum`、`layerSensitivity`、`indexProfile`、`layerThicknesses`、`designFacts`、`admittance`、`electricField`、`color`、`integrals`、`ellipsometry`、`ellipsometryVsAngle`、`groupDelay`、`pulseAnalysis`、`setPulseSpectrum`、`inhomogeneities`、`roughness`、`stress`、`bandFeature`、`edgeShift`、`readSpectrumFile`、`measuredDifference`、`readEllipsometryFile`、`addMeasuredCurves`、`fitMeasured`、`exportMeasuredCurves`、`processSteps`、`exportProcess`、`monitorWorksheet` |
| 镀膜文件 | `saveZemaxCoating`、`readZemaxCoating`、`importZemaxCoating`、`saveCodevCoating`、`readCodevCoating`、`importCodevCoating` |
| 运行 | `refine`、`synthesize`、`monteCarlo`、`jobStatus`、`stopJob`、`listJobs` |
| 打开的设计（需 `--live`） | `listAppDesigns`、`selectAppDesign`、`readAppDesign`、`applyToApp`、`addAppDesign`、`deleteAppDesign` |

每个工具都按其窗口的方式、用同样的代码计算，因此数值与应用中显示的一致：

| 工具 | 计算方式 |
|---|---|
| `spectrum`、`bandFeature`、`edgeShift` | [光学评价](/zh/analysis/optical-evaluation/)：R、T、A、Rs 和 Rp；波段的峰值、边缘和 FWHM；边缘随入射角的移动 |
| `merit`、`setMerit` | [评价函数编辑器](/zh/design/merit-function-editor/)，总值和每一行，使用[操作数参考](/zh/design/operands/)中的操作数 |
| `refine`、`synthesize` | [精炼](/zh/synthesis/refinement/)的任一方法；[针法](/zh/synthesis/needle/)、[渐变演化](/zh/synthesis/gradual-evolution/)或[结构优化器](/zh/synthesis/structural-optimizer/) |
| `monteCarlo`、`layerSensitivity` | [蒙特卡洛](/zh/analysis/error-analysis/)，带检查项的设计还给出良率；[膜层灵敏度](/zh/analysis/layer-sensitivity/) |
| `setSpecification`、`checkSpecification` | [规格](/zh/design/specification/)，并给出每个值距其界限多远 |
| `cleanDesign`、`quantize`、`perturb`、`flipLayers`、`copySide`、`scaleThicknesses`、`designDifferences` | [设计清理器](/zh/synthesis/design-cleaner/)；[设计编辑器](/zh/design/design-editor/)的取整、扰动（带随机种子）、反转和复制；一个面按同一系数变厚或变薄；两个设计之间的差异 |
| `environments`、`addEnvironment`、`setEnvironment`、`removeEnvironment` | [环境](/zh/design/environments/)窗口 |
| `edgeFilter`、`applyEdgeFilter` | [边缘滤光片](/zh/design/edge-filter/)的搜索，以及其替换或追加 |
| `needleProfile`、`insertNeedle` | [针法手动](/zh/synthesis/needle/#needle-manual)的轮廓和应用 |
| `indexProfile`、`layerThicknesses`、`designFacts` | 单一波长下的[折射率分布](/zh/analysis/refractive-index-profile/)和[膜层厚度](/zh/analysis/layer-thicknesses/)；总厚度与光学厚度、每种材料的层数以及每层的 QWOT |
| `admittance`、`electricField` | [导纳图](/zh/analysis/admittance/)和[电场](/zh/analysis/efield/)，单一波长下的一个镀膜面 |
| `color`、`integrals` | [颜色评价](/zh/analysis/color-evaluation/)和[积分值](/zh/analysis/integral-values/)，在评分的面上并对锥角取平均 |
| `ellipsometry`、`ellipsometryVsAngle` | [椭偏测量](/zh/analysis/ellipsometry/)，随波长或入射角变化，$\Delta$ 可取任一符号 |
| `groupDelay`、`pulseAnalysis`、`setPulseSpectrum` | [群延迟 / GDD](/zh/analysis/gd-gdd/) 和[脉冲分析](/zh/analysis/pulse-analysis/)，脉冲取自模型或设计上设置的光谱 |
| `inhomogeneities`、`roughness`、`stress`、`materialDispersion` | 带规格判定的[不均匀性与过渡层](/zh/analysis/inhomogeneities/)、[粗糙度 / 散射](/zh/analysis/roughness-scattering/)、按材料常数和 `setDesignSetup` 计算的[应力](/zh/analysis/stress/)、[材料色散](/zh/analysis/material-dispersion/) |
| `processSteps`、`exportProcess`、`monitorWorksheet` | [工艺导出器](/zh/simulation/process-simulator/)及其保存；[监控工作表](/zh/simulation/monitor-worksheet/)的各行 |
| `saveZemaxCoating`、`readZemaxCoating`、`importZemaxCoating`，以及 `Codev` 的同样三个 | [Zemax 镀膜](/zh/data-exchange/zemax-coatings/)和 [CODE V 镀膜](/zh/data-exchange/codev-coatings/)窗口；导入时文件的材料随设计携带，而不加入目录 |

在有多个环境的设计上，评价函数行或规格检查用 `env` 指定只在一个环境中评分；`merit` 在总值旁给出每个环境的评价函数；`refine`、`synthesize` 和 `needleProfile` 在每个开启的环境中评分，`checkSpecification` 和良率也是如此。分析工具默认计算环境 1，`env` 可指定其他环境，`env: 'all'` 则给出每个开启的环境。

## 设计方法

`designMethod` 向助手给出镀膜工程师的工作顺序：需求、材料、起始膜层堆栈、评价函数、精炼与合成、镀膜机能够镀制的膜层堆栈、规格以及良率。服务器会告诉助手在开始设计任务前先读取它。

同一段文字也作为 Agent Skill（技能）随应用提供：这是一个文件夹，任务涉及镀膜时助手会自行加载它。它位于安装目录 `resources` 文件夹中的 `skills\coating-design`，例如 `C:\Users\you\AppData\Local\Programs\TFStudio\resources\skills\coating-design`，也位于 GitHub 上 TFStudio 仓库的 `skills` 文件夹中。把这个文件夹复制到你的助手读取技能的文件夹中，该文件夹见助手的文档；Claude Code 读取 `%USERPROFILE%\.claude\skills`，Claude Desktop 则在其设置中以 zip 文件的形式添加该文件夹。如果已安装 Node.js，`npx skills add aai2k/TFStudio -g` 会从 GitHub 为你选择的助手安装该技能。不读取技能的助手仍可通过该工具获得这套方法。

## 工作方式

- **按 id 处理设计。** 助手处理的是服务器以 `d1` 等 id 保存的设计。除非服务器以 `--live` 运行，它的操作不会影响应用中打开的设计；要查看结果，请打开它保存的文件。
- **完整路径。** 文件按完整路径打开和保存，例如 `C:\Users\you\Documents\TFStudio\Projects\AR.tfs`，因为服务器运行所在的文件夹取决于助手启动它的方式。
- **运行即任务。** `refine`、`synthesize` 和 `monteCarlo` 在独立线程上启动一个任务，并在半分钟内返回任务状态。对于更长的运行，助手用 `jobStatus` 跟踪，用 `stopJob` 停止。改变了设计的运行会把结果作为新设计加入，起始设计保持不变，便于比较。
- **单位。** 波长和膜层厚度单位为 nm，角度为入射介质中的度数，基底厚度单位为 mm。R、T 和 A 为 1 的分数，评价函数目标值也是如此，而评价函数编辑器中显示的是百分比。
- **拒绝。** 拼错的参数、未知的材料或工具无法使用的值都会被拒绝，并给出说明工具接受什么的信息，因此不会按助手未要求的值运行。

## 处理打开的设计

加上 `--live` 后，助手还可以处理 TFStudio 中打开的设计，你可以看着它变化。在添加服务器的地方，在 `--mcp` 后面加上 `--live`，使其参数为：

```json
"args": ["--mcp", "--live"]
```

在 Claude Code 中，命令以 `--mcp --live` 结尾。

然后，在让助手处理打开的设计之前，点击 TFStudio **优化**选项卡**脚本**组中的**交互**。助手工作期间，会有一个窗口挡住应用的其余部分。它显示“正在等待程序连接。”，然后显示“已连接：”和助手的名称。在此期间，你不能编辑、切换设计或启动运行，它后面的各窗口会随着助手的修改继续显示设计。**终止**会放开助手，把应用交还给你。助手在 TFStudio 没有等待连接时访问它，会被告知需要点击“交互”。

助手读取打开的设计的副本，用上面的工具修改副本，再把它写回：

- **一步撤销。** 它写回的每次修改都是设计历史中的一步，按 Ctrl+Z 即可撤销，并会有通知说明它修改了哪个设计。修改在你保存设计之前一直是未保存的。
- **只写打开的设计。** 助手可以读取项目资源管理器中的任何设计，但只写入当前打开的那一个。
- **打开、添加和删除。** 助手可以打开项目资源管理器中的任何设计，因此它连接时不需要已有打开的设计。它可以把设计添加到项目文件夹，可以是它创建的设计，也可以是空白设计，还可以删除设计：文件不经询问移到回收站，有未保存修改的设计不会被删除。每添加或删除一个设计，都会有通知说明是哪个设计。
- **你的编辑优先。** 如果设计在助手读取之后发生了变化，无论是编辑、撤销还是运行，它的写入都会被拒绝，并被告知重新读取设计，因此你所做的不会被覆盖。应用的某个窗口中正在运行时，写入也会被拒绝。
- **运行不打开窗口。** 助手启动的精炼或合成在服务器中运行。如果助手要求写回，运行结束时若设计仍与助手读取时相同，结果会作为一步写回。被停止的运行不写入任何内容。
- **新材料。** 服务器在启动时读取材料目录，因此你之后在应用中添加的材料，要在你重启助手后才能被助手使用。

首选项“自动化”中的 **TFStudio 启动时开始等待程序连接**让 TFStudio 从启动起就等待程序连接，无需点击“交互”，适用于你让其自行工作的助手。此时 TFStudio 会在每个程序首次连接前先询问，提供**允许**和**拒绝**，允许后才挡住应用；你拒绝过或用“终止”放开过的程序，只能通过“交互”再次连接。该设置开启期间，你运行的任何程序都可以请求处理你的设计；这台计算机的其他用户无法访问。它默认关闭，因此如非必要请保持关闭。

不加 `--live`、只处理文件的助手不需要这些：它在你身旁打开和保存 `.tfs` 文件，应用不必为它等待。
