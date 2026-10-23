---
title: Python
description: 在 Python 程序中设计和计算薄膜镀膜，处理程序自己的设计，或应用中打开的设计。
---

Python 程序可以通过 `tfstudio` 包处理 TFStudio 的设计：使用的对象与[脚本控制台](/zh/automation/script-console/)中 Python 脚本可用的相同，[API 参考](/zh/automation/api-reference/)列出了它们。该包会启动一个属于它自己、不打开任何窗口的 TFStudio 来为程序计算，并在程序用完后将其结束。程序可以构建设计并清理其膜层堆栈、读取膜层堆栈的折射率分布、膜层厚度和总厚度、计算一个镀膜面的导纳轨迹、电场、Ψ 和 Δ 以及相位、群延迟和 GDD、计算光谱、颜色、积分值和评价函数、判定设计是否满足其规格并统计其良率、运行精炼与合成，并保存得到的结果；加上 `live=True` 后，它还可以读取和修改应用中打开的设计。这些对象与各窗口使用同一套计算代码，因此给出的数值与应用显示的一致。

## 安装

Python 需要你自己安装；该包需要 Python 3.8 或更高版本，不依赖其他包。TFStudio 把该包放在安装文件夹的 `resources\python` 文件夹中。安装时，用你的程序所用的 Python 运行该文件夹中的 `install.py`：

```bash
python "C:\Users\you\AppData\Local\Programs\TFStudio\resources\python\install.py"
```

`install.py` 会在该 Python 中添加一个文件 `tfstudio.pth`，让它指向这个文件夹，并输出该文件写在哪里。不会下载任何东西：使用的就是 TFStudio 安装文件夹中的包，因此它随 TFStudio 一起更新。要卸载，删除该文件即可。在虚拟环境中使用时，请用该环境的 Python 运行 `install.py`。

在 Linux 上，deb 包把该文件夹放在 `/opt/TFStudio/resources/python`。AppImage 的文件只在它运行时存在：先用 `--appimage-extract` 运行它一次，它会把文件写入当前文件夹中的 `squashfs-root` 文件夹，然后从 `squashfs-root/resources/python` 运行 `install.py`。

脚本控制台中的 Python 脚本不需要这些：控制台会把该包交给脚本。

## 启动 TFStudio

```python
import tfstudio

with tfstudio.TFStudio() as tf:
    print("TFStudio", tf.info["version"], "on the data folder", tf.info["dataDir"])
    design = tf.new_design("Mirror 550")
    design.stack("(HL)^4 H")
    print(len(design.layers), "layers, highest R", max(design.spectrum(400, 700).R))
```

`tfstudio.TFStudio()` 把 TFStudio 作为服务器启动，不打开任何窗口，`with` 块结束时将其结束。不使用 `with` 块时，程序用完后请调用 `tf.close()`；程序即使没有调用它就结束，也会结束它的服务器。每个 `TFStudio()` 都是一个独立的 TFStudio，因此程序可以启动多个，并让它们同时运行。

它按以下顺序查找 TFStudio：

- 你指定的可执行文件，例如 `tfstudio.TFStudio(r"D:\Apps\TFStudio\TFStudio.exe")`
- 环境变量 `TFSTUDIO_EXE` 指定的可执行文件
- `resources\python` 文件夹中存放该包的那个 TFStudio
- 在 Windows 上，安装程序记录的文件夹

如果 TFStudio 的协议版本与该包不同，`TFStudio()` 会拒绝它，并给出说明原因的信息。

服务器使用应用的数据文件夹，默认是 `Documents\TFStudio`，除非你在首选项中移动过它，因此它看到的材料与应用相同。应用首次启动时会建立这个文件夹。`data_dir=` 可以指定另一个数据文件夹。`tf.info` 说明它启动时的情况，例如 `version`、`dataDir`，以及 `unreadable`（无法读取的材料目录）。服务器在应用旁保留自己的日志 `api-server.log`。

## 对象在 Python 中的写法

- **名称。** 名称采用 snake_case，可选参数以关键字参数给出：`design.spectrum(400, 700, step=5, angles=[0, 45])`。API 参考在每个名称的 JavaScript 写法旁给出其 Python 写法。
- **设计直接修改。** `stack()`、各项膜层编辑、`refine()` 和 `synthesize()` 会直接修改调用它们的设计；`design.copy()` 可以先保留一份副本。
- **按编号访问膜层。** `design.layers[1]` 是紧邻基底的那一层，与设计编辑器的编号相同；`len(design.layers)` 给出层数，`for` 循环从第 1 层向外进行。`design.back_layers` 是背面的膜层。
- **正面、背面与整体。** `design.sides` 和 `design.score_on` 决定每个光谱、评价函数和运行的计算对象，每个结果的 `mode` 说明是哪一个；API 参考的第一个表格列出了它们。
- **曲线是 list。** 光谱的 `s.R` 及其他量都是由 float 组成的 list，每个值对应 `s.wavelength` 中的一个波长，因此 `max(s.R)`、`sum(s.R)` 和绘图库都能直接使用它们；`s.R.mean(450, 650)`、`min()` 和 `max()` 对一个波段做统计。
- **材料。** `tf.materials["TiO2"]` 按 id 或名称给出一种材料，`tf.materials.find("SiO2")` 给出 id 或名称中含有该文本的材料，`.nk(550)` 给出它们的 n 和 k。
- **路径。** `tf.open_design()`、`save()` 或 `save_csv()` 中的相对路径以程序的工作文件夹为基准。
- **拒绝。** 被 TFStudio 拒绝的调用会引发 `tfstudio.TFStudioError`，其信息以方法名开头，并说明它接受什么。

```python
import tfstudio

with tfstudio.TFStudio() as tf:
    design = tf.new_design("Mirror 550")
    design.stack("(HL)^3 H")
    s = design.spectrum(400, 700, step=10, angles=[0, 45])
    print("Rs at 400 nm and 45 degrees:", s.angle(45).Rs[0])
    try:
        design.layers.append("TiO2", -5)
    except tfstudio.TFStudioError as err:
        print(err)
```

## 运行

`refine()`、`synthesize()`、`monte_carlo()` 和 `specification.estimate_yield()` 在程序的 TFStudio 中计算，运行结束时调用才返回。`progress=` 接受一个函数，运行每次报告时以一个 `tfstudio.Progress` 调用它。`stop=` 接受一个 `tfstudio.Stop`，在 progress 函数中或另一个线程中调用其 `stop()`，就会在下一步结束运行。被停止的精炼或合成会保持设计原样。

运行期间按 Ctrl+C 会停止运行，然后引发 `KeyboardInterrupt`；设计保留原来的膜层。运行在各步之间检查停止请求；如果 15 秒后仍未停止，或你再次按下 Ctrl+C，服务器会被结束，该 `TFStudio()` 不再接受调用。progress 函数引发的异常会停止运行，该异常随后在程序中引发。

一个 TFStudio 同一时间只进行一次运行。运行期间，来自其他线程的其他调用照常得到响应，第二次运行则会被拒绝；要同时进行两次运行，请再启动一个 `TFStudio()`。

```python
import tfstudio

with tfstudio.TFStudio() as tf:
    design = tf.new_design("AR 450-650")
    design.stack("(HL)^2")
    design.merit.add("RAV", 450, 650, target=0)
    run = design.refine(method="dls", max_iter=100, progress=lambda p: print("iteration", p.iteration, "merit", p.merit))
    print(run.stop_reason, "merit", run.merit)
```

## 处理打开的设计

加上 `live=True` 后，`tf.app` 可以访问 TFStudio 中打开的设计，前提是 TFStudio 正在等待程序连接。在 TFStudio 中，点击**优化**选项卡**脚本**组中的**交互**。随后会有一个窗口挡住应用的其余部分。它显示“正在等待程序连接。”，程序连接后显示“已连接：”和程序的名称，在 Windows 上为 `python.exe`。窗口打开期间，你不能编辑、切换设计或启动运行，它后面的各窗口会随着程序的修改继续显示设计。**终止**会放开该程序，把应用交还给你；程序所做的每次修改都会保留，每次可按一次 Ctrl+Z 撤销。

`tf.app.designs()` 列出应用中的设计，`tf.app.open_design()` 复制打开的设计，或按名称或 id 指定的设计，程序可以像修改其他设计一样修改这份副本。`design.push()` 把它写回它被读取时的那个设计，作为撤销可以撤回的一步；只有打开的设计接受 push，push 过的设计可以再次修改并再次 push。应用对待程序的写入，与对待 AI 助手的写入相同；规则见 [AI 助手（MCP）](/zh/automation/ai-agents/#处理打开的设计)页面。

首选项“自动化”中的 **TFStudio 启动时开始等待程序连接**让 TFStudio 从启动起就等待程序连接，适用于你不在应用前时运行的程序。此时 TFStudio 会在每个程序首次连接前先询问，提供**允许**和**拒绝**，允许后才挡住应用；该回答在 TFStudio 关闭之前一直有效。被拒绝或被“终止”放开的程序，只能通过“交互”再次连接。该设置默认关闭：开启期间，你运行的任何程序都可以请求处理你的设计，因此如非必要请保持关闭。

应用不接受的 `tf.app` 调用或 push 会引发 `tfstudio.AppError`，其 `code` 说明原因：

| 代码 | 含义 |
| ---- | ---- |
| `off` | TFStudio 未运行，没有等待程序连接，或者“终止”已放开本程序。请点击“交互”，然后重试。 |
| `timeout` | TFStudio 没有及时响应；它可能正忙。 |
| `protocol` | 打开的 TFStudio 使用另一个版本的连接协议；请用那个安装中的 TFStudio 运行程序。 |
| `denied` | 本程序请求连接时被点击了“拒绝”。“交互”无需询问即可让它连接。 |
| `edited` | 设计在被读取之后已在 TFStudio 中改变。没有写入任何内容；请重新读取，并在新副本上修改。 |
| `switched` | 它被读取时的那个设计已不再是打开的设计。没有写入任何内容。 |
| `optimizing` | TFStudio 的某个窗口中正在运行。没有写入任何内容；运行结束后再 push。 |
| `noDesign` | 没有打开的设计，也没有指定设计。 |
| `unknown` | TFStudio 中没有该 id 对应的设计。 |
| `invalid` | TFStudio 无法接受发送的内容，例如一个它不会作为文件打开的设计；信息说明原因。 |

不是从应用中读取的设计，或含有 NaN 或无穷大的设计，会在发送任何内容之前被拒绝，引发 `tfstudio.TFStudioError`。

```python
import tfstudio

with tfstudio.TFStudio(live=True) as tf:
    design = tf.app.open_design()
    print("Open design:", design.name, "merit", design.merit.value)
    run = design.refine(method="dls", max_iter=100)
    design.push()
    print("Pushed, merit", run.merit, "(" + run.stop_reason + ")")
```

## 示例

### 把 s 和 p 的 R、T、A 写入文件

在程序的工作文件夹中写入一个 CSV 文件，文件名带有时间，因此不会覆盖任何文件；其中是该反射镜在 45 度时非偏振光以及 s 和 p 偏振的 R、T 和 A，每个波长一行：

```python
import time
import tfstudio

with tfstudio.TFStudio() as tf:
    design = tf.new_design("Mirror 550")
    design.stack("(HL)^4 H")
    name = "mirror-45deg-{}.csv".format(time.time_ns())
    design.spectrum(400, 800, step=2, angles=[45]).save_csv(name)
    print("Wrote", name)
```

### 用针法生长设计，最多一分钟，然后保存

针法从一层 SiO2 开始，用 TiO2 和 SiO2 按 420 到 680 nm 的减反射目标生长设计，最多 12 层；如果一分钟后仍在运行，就将其停止。这样被停止的运行会保持设计原样，因此只有运行自行结束时，程序才把设计保存在其工作文件夹中：

```python
import time
import tfstudio

with tfstudio.TFStudio() as tf:
    design = tf.new_design("AR 420-680")
    design.layers.append("SiO2", 100)
    design.merit.add("RAV", 420, 680, target=0)
    stop = tfstudio.Stop()
    started = time.monotonic()

    def watch(p):
        if time.monotonic() - started > 60:
            stop.stop()

    run = design.synthesize("needle", pool=["TiO2", "SiO2"], max_layers=12, progress=watch, stop=stop)
    if run.stop_reason == "stopped":
        print("Stopped after a minute, with the design as it was; nothing saved")
    else:
        name = "needle-ar-{}.tfs".format(time.time_ns())
        design.save(name)
        print("Saved", name, "with", len(design.layers), "layers (" + run.stop_reason + ")")
```

`refine()` 和 `synthesize()` 按设计的评价函数运行：在[评价函数编辑器](/zh/design/merit-function-editor/)中设置它，并保存设计供 `tf.open_design()` 读取，或像上面那样用 `design.merit.add()` 添加它的行。
