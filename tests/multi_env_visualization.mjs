import assert from 'node:assert';
import { computeOpticalSpectrum } from '../src/components/windows/analysis/opticalEvaluation/spectrum.js';
import { computeDesignSpectrum } from '../src/utils/io/designSpectrum.js';
import { resolveEnvironment, environmentOptions, environmentLabel } from '../src/utils/physics/environment.js';
import { opticalEnvSession } from '../src/components/windows/analysis/opticalEvaluation/envSession.js';
import { computeVariatorSpectrum } from '../src/components/windows/optimization/variator/model.js';
import { computeColorReport } from '../src/components/windows/analysis/colorEvaluation/colorModel.js';
import { sideMedia } from '../src/components/windows/analysis/ellipsometryEvaluation/model.js';
import { computeSpectral } from '../src/components/windows/analysis/ellipsometryEvaluation/spectrum.js';
import { computeProfile } from '../src/components/windows/analysis/eFieldEvaluation/profileModel.js';
import { buildDiagramData } from '../src/components/windows/analysis/admittanceDiagram/model.js';
import { buildExpandedStacks, computeInhomogeneitySpectra } from '../src/components/windows/analysis/inhomogeneities/model.js';
import { computeSpectrumForMode } from '../src/components/windows/analysis/integralValues/spectrum.js';
import { computeTotalRegions, computeProfileForSide } from '../src/components/windows/analysis/refractiveIndexProfiler/profileModel.js';
import { buildInterfaceLabels, calculateRoughness, getRoughnessContext } from '../src/components/windows/analysis/roughnessScattering/model.js';
import { buildEvaluationContext } from '../src/components/windows/analysis/plotEngine/materialContext.js';
import { buildSpectrum, buildResponseFn } from '../src/utils/report/reportData/engines.js';
import { buildAllProcessFiles } from '../src/utils/io/processFileExport.js';
import { perEnvMfFor } from '../src/components/windows/optimization/refinement/refinementEnvMf.js';
import { makeOperand } from '../src/utils/physics/optimizer/operandModel.js';

// 不用 makeDefaultDesign：DesignContext.js 依赖全局 React（Electron renderer），
// 纯 node 测试直接构造普通对象即可。
const design = {
  incidentMedium: 'Air',
  exitMedium: 'Air',
  substrate: { material: 'BK7', thickness: 1.0 },
  meritEnvironments: [
    { id: 'e1', incidentMedium: 'Air', exitMedium: 'Water', substrate: { material: 'BK7', thickness: 1.0 } },
    { id: 'e2', incidentMedium: 'misc:SEAWATER', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1.0 } },
  ],
};

// 默认 = 设计级
const d = resolveEnvironment(design, -1);
assert(d.environmentIndex === -1, 'default index -1');
assert(d.incidentMedium === 'Air', 'design-level incident');

// 选环境 0
const e0 = resolveEnvironment(design, 0);
assert(e0.environmentIndex === 0, 'env0 index');
assert(e0.exitMedium === 'Water', 'env0 exit overridden');
assert(e0.substrate.material === 'BK7', 'env0 substrate');

// 越界回退设计级
const oob = resolveEnvironment(design, 99);
assert(oob.environmentIndex === -1, 'oob falls back');

// 选项与标签
const opts = environmentOptions(design);
assert(opts.length === 3 && opts[0].value === -1, 'options include design + 2 envs');
assert(environmentLabel(design.meritEnvironments[0]) === 'E1: Air → Water', 'label format E{n}: inc → exit');
console.log('resolveEnvironment OK');

// ── Task 2: 光谱计算按 envIndex 取介质 ──────────────────────────
// 注意：'front' 模式只使用入射介质 + 基底 + 正面膜层（不含出射介质），
// 且 'Water' 非内置材料（会回退 Air）。故用"基底 BK7 → SiO2"制造可观测差异：
// BK7 与 SiO2 均为内置材料、折射率不同（1.52 vs 1.46），'front' 反射谱必然不同。
const design2 = {
  frontLayers: [{ material: 'TiO2', thickness: 100 }],
  incidentMedium: 'Air', exitMedium: 'Air',
  substrate: { material: 'BK7', thickness: 1.0 },
  meritEnvironments: [{ id: 'e1', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'SiO2', thickness: 1.0 } }],
};
const params2 = { lambdaStart: 400, lambdaEnd: 700, lambdaStep: 100, thetas: [0] };

const sd = computeOpticalSpectrum(design2, params2, 'front', -1); // 基底 BK7
const se = computeOpticalSpectrum(design2, params2, 'front', 0);  // 基底 SiO2
let diff2 = 0;
for (let i = 0; i < sd.series[0].R.length; i++) diff2 += Math.abs(sd.series[0].R[i] - se.series[0].R[i]);
assert.ok(diff2 > 1e-6, 'env spectrum differs from design-level (substrate BK7 vs SiO2)');
const dsd = computeDesignSpectrum(design2, params2, 'front', 0);
assert.ok(dsd.series && dsd.series[0].R[0] !== undefined, 'computeDesignSpectrum env path works');
const dsdDesign = computeDesignSpectrum(design2, params2, 'front', -1); // 设计级基底 BK7
let dsdDiff = 0;
for (let i = 0; i < dsdDesign.series[0].R.length; i++) dsdDiff += Math.abs(dsdDesign.series[0].R[i] - dsd.series[0].R[i]);
assert.ok(dsdDiff > 1e-6, 'designSpectrum env differs from design-level (substrate BK7 vs SiO2)');
console.log('spectrum envIndex OK');

// ── Task 3: envSession store 行为 ──────────────────────────────
const designA = { id: 'design-A', meritEnvironments: [{ id: 'e1', incidentMedium: 'Air', exitMedium: 'Water' }] };
const designB = { id: 'design-B', meritEnvironments: [] };

// 默认值
let s0 = opticalEnvSession.read(designA);
assert.equal(s0.envIndex, -1, 'default envIndex -1');
assert.equal(s0.locked, false, 'default unlocked');
assert.equal(s0.lockedEnvIndex, -1, 'default lockedEnvIndex -1');

// 写入 envIndex + 锁定快照
opticalEnvSession.write(designA, { envIndex: 0, locked: true, lockedEnvIndex: 0 });
let s1 = opticalEnvSession.read(designA);
assert.equal(s1.envIndex, 0, 'envIndex persists');
assert.equal(s1.locked, true, 'locked persists');

// 切换 design → onDesignChange 复位
let s2 = opticalEnvSession.read(designB);
assert.equal(s2.envIndex, -1, 'design switch resets envIndex');
assert.equal(s2.locked, false, 'design switch unlocks');

// 复位后不再影响 designA
opticalEnvSession.write(designB, { envIndex: 5 });
let s3 = opticalEnvSession.read(designA);
assert.equal(s3.envIndex, 0, 'per-slot isolation preserved');

// onDesignChange 复位分支：存储的索引在新 design 上越界（环境列表收缩）→
// 切回时守卫返回复位补丁（设计级 + 解锁）。仅 1 个环境却存了索引 2。
const designC = { id: 'design-C', meritEnvironments: [{ id: 'e1', incidentMedium: 'Air', exitMedium: 'Water' }] };
const designD = { id: 'design-D', meritEnvironments: [] };
opticalEnvSession.read(designC); // 建立 designC 槽位
opticalEnvSession.write(designC, { envIndex: 2, locked: true, lockedEnvIndex: 2 }); // 2 越界（1 个环境）
opticalEnvSession.read(designD); // 切到别的 design
let s4 = opticalEnvSession.read(designC); // 切回 → 触发 onDesignChange，索引已无效
assert.equal(s4.envIndex, -1, 'out-of-range envIndex resets to design level');
assert.equal(s4.locked, false, 'out-of-range lock cleared');
assert.equal(s4.lockedEnvIndex, -1, 'out-of-range lockedEnvIndex resets');
console.log('envSession OK');

// ── Task 5: Variator 多环境感知 ──────────────────────────────
// 'front' 模式只使用入射介质 + 基底 + 正面膜层（不含出射介质），
// 故用"基底 BK7 → SiO2"制造差异（两者均内置、折射率 1.52 vs 1.46）。
const vdesign = {
  frontLayers: [{ id: 'l1', material: 'TiO2', thickness: 100 }],
  incidentMedium: 'Air', exitMedium: 'Air',
  substrate: { material: 'BK7', thickness: 1.0 },
  meritEnvironments: [{ id: 'e1', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'SiO2', thickness: 1.0 } }],
};
const vparams = { lambdaStart: 400, lambdaEnd: 700, lambdaStep: 100, thetas: [0] };
const vcache = { baseFront: [{ id: 'l1', thickness: 100 }], baseBack: [], baseSubstrateMm: 1.0 };
const vdN = {}; const vdK = {};

const va = computeVariatorSpectrum({ design: vdesign, params: vparams, evalMode: 'front', dN: vdN, dK: vdK, cache: vcache, envIndex: -1 });
const vb = computeVariatorSpectrum({ design: vdesign, params: vparams, evalMode: 'front', dN: vdN, dK: vdK, cache: vcache, envIndex: 0 });
let vdiff = 0;
for (let i = 0; i < va.R.length; i++) vdiff += Math.abs(va.R[i] - vb.R[i]);
assert.ok(vdiff > 1e-6, 'variator env differs (substrate BK7 vs SiO2)');
console.log('variator env OK');

// ── Task 6: 其余分析窗口模型层接入 resolveEnvironment ──────────
// 共享设计：设计级基底 BK7，环境 0 = SiO2（均内置、n 1.52 vs 1.46）。
// 判别手段统一为"基底材料切换"；envIndex = -1 必须等于设计级行为。
const mkDesign = () => ({
    frontLayers: [{ material: 'TiO2', thickness: 100 }],
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    meritEnvironments: [{ id: 'e1', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'SiO2', thickness: 1.0 } }],
});
const p6 = { lambdaStart: 400, lambdaEnd: 700, lambdaStep: 100, thetas: [0] };
const sumAbsDiff = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0);

// (a) plotEngine materialContext —— 解析后介质对象 nk 直接可比
const ctx0 = buildEvaluationContext(mkDesign(), -1);
const ctx1 = buildEvaluationContext(mkDesign(), 0);
assert.ok(Math.abs(ctx0.subMat.getNK(550)[0] - ctx1.subMat.getNK(550)[0]) > 1e-6, 'plotEngine env substrate nk differs');

// (b) refractiveIndexProfiler —— computeTotalRegions 返回 regions 数组（非 {regions}），
//     以 key==='substrate' 的区折射率判别
const r0 = computeTotalRegions(mkDesign(), 550, {}, -1);
const r1 = computeTotalRegions(mkDesign(), 550, {}, 0);
const subR0 = r0.find(g => g.key === 'substrate');
const subR1 = r1.find(g => g.key === 'substrate');
assert.ok(subR0 && subR1, 'profiler substrate region present');
assert.ok(Math.abs(subR0.n[0] - subR1.n[0]) > 1e-6, 'profiler substrate n differs');
const pf0 = computeProfileForSide(mkDesign(), 550, 'front', -1);
assert.ok(pf0 && pf0.z?.length > 0, 'profiler per-side profile default -1 runs');

// (c) admittanceDiagram —— conditions 包带 envIndex；etaS 为基底导纳（实部≈ns）
const cond = { lambda_nm: 550, theta_deg: 0, pol: 's', side: 'front', view: 'admittance' };
const adm0 = buildDiagramData(mkDesign(), { ...cond, envIndex: -1 });
const adm1 = buildDiagramData(mkDesign(), { ...cond, envIndex: 0 });
assert.ok(adm0 && adm1, 'admittance diagram data built');
assert.ok(Math.abs(adm0[0].etaS[0] - adm1[0].etaS[0]) > 1e-6, 'admittance substrate admittance differs');

// (d) integralValues —— 'front' 模式反射谱随基底变化
const iv0 = computeSpectrumForMode(mkDesign(), p6, 'front', -1);
const iv1 = computeSpectrumForMode(mkDesign(), p6, 'front', 0);
assert.ok(sumAbsDiff(iv0.R, iv1.R) > 1e-6, 'integralValues env R differs');

// (e) ellipsometry —— sideMedia 直接给出介质 id；谱随基底变化
//     （正入射时 ψ/Δ 退化恒为 45°/180°，改用 60° 入射角）
assert.equal(sideMedia(mkDesign(), 'front', -1).nsId, 'BK7', 'ellipsometry design-level substrate');
assert.equal(sideMedia(mkDesign(), 'front', 0).nsId, 'SiO2', 'ellipsometry env substrate');
const es0 = computeSpectral(mkDesign(), { side: 'front', lambdaStart: 400, lambdaEnd: 600, lambdaStep: 50, thetaDeg: 60 }, -1);
const es1 = computeSpectral(mkDesign(), { side: 'front', lambdaStart: 400, lambdaEnd: 600, lambdaStep: 50, thetaDeg: 60 }, 0);
assert.ok(sumAbsDiff(es0.psi, es1.psi) > 1e-6, 'ellipsometry env psi differs');

// (f) inhomogeneities —— buildExpandedStacks 的 subMat 与基线谱均随基底变化
const inh = { interlayers: [], backInterlayers: [] };
const st0 = buildExpandedStacks(mkDesign(), inh, -1);
const st1 = buildExpandedStacks(mkDesign(), inh, 0);
assert.ok(Math.abs(st0.subMat.getNK(550)[0] - st1.subMat.getNK(550)[0]) > 1e-6, 'inhomogeneities env subMat differs');
const ih0 = computeInhomogeneitySpectra(mkDesign(), p6, inh, 'front', -1);
const ih1 = computeInhomogeneitySpectra(mkDesign(), p6, inh, 'front', 0);
assert.ok(sumAbsDiff(ih0.baseline.R, ih1.baseline.R) > 1e-6, 'inhomogeneities env baseline R differs');

// (g) roughnessScattering —— 界面标签的基底名与理想谱随基底变化
const lab0 = buildInterfaceLabels(mkDesign(), -1);
const lab1 = buildInterfaceLabels(mkDesign(), 0);
assert.ok(lab0.front.at(-1).label.endsWith('BK7'), 'roughness design-level sub label');
assert.ok(lab1.front.at(-1).label.endsWith('SiO2'), 'roughness env sub label');
const roughCtx = getRoughnessContext(mkDesign(), 'front');
const rough = { mode: 'uniform', sigma: 1, sigmas: [], backSigmas: [] };
const ro0 = calculateRoughness({ design: mkDesign(), params: p6, rough, evalMode: 'front', aoi: 0, context: roughCtx, envIndex: -1 });
const ro1 = calculateRoughness({ design: mkDesign(), params: p6, rough, evalMode: 'front', aoi: 0, context: roughCtx, envIndex: 0 });
assert.ok(ro0.data && ro1.data, 'roughness calculation runs');
assert.ok(sumAbsDiff(ro0.data.ideal.R, ro1.data.ideal.R) > 1e-6, 'roughness env ideal R differs');

// (h) eFieldEvaluation —— 场分布随基底介质变化（正常入射、s 偏振）
const ef0 = computeProfile(mkDesign(), 550, 0, 's', 'front', -1);
const ef1 = computeProfile(mkDesign(), 550, 0, 's', 'front', 0);
assert.ok(ef0 && ef1, 'efield profile runs');
assert.ok(sumAbsDiff(ef0.s.e2, ef1.s.e2) > 1e-6, 'efield env e2 differs');

// (i) colorEvaluation —— 色度坐标随基底变化（380-780 网格，略慢）
const colorOpts = { design: mkDesign(), evalMode: 'front', characteristic: 'R', pol: 'avg', theta: 0,
                    observer: '2', illuminant: 'D65', step: 5, setError: () => {} };
const c0 = computeColorReport({ ...colorOpts, envIndex: -1 });
const c1 = computeColorReport({ ...colorOpts, envIndex: 0 });
assert.ok(c0 && c1, 'color report runs');
assert.ok(Math.abs(c0.xy.x - c1.xy.x) > 1e-9, 'color env xy differs');
console.log('analysis windows env OK');

// ── Task 7: 导出路径按 envIndex 取介质 ────────────────────────
// 设计级基底 BK7，环境 0 基底 SiO2（均内置、n 1.52 vs 1.46），
// 判别手段与 Task 2/5/6 一致：基底材料切换制造可观测差异。
const edesign = {
  frontLayers: [{ material: 'TiO2', thickness: 100 }],
  incidentMedium: 'Air', exitMedium: 'Air',
  substrate: { material: 'BK7', thickness: 1.0 },
  meritEnvironments: [{ id: 'e1', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'SiO2', thickness: 1.0 } }],
};
const ep = { lambdaStart: 400, lambdaEnd: 700, lambdaStep: 100, thetas: [0] };

// (a) buildSpectrum —— opts.envIndex 决定介质；-1 回设计级（BK7），0 用环境（SiO2）
const sp0 = buildSpectrum(edesign, { ...ep, envIndex: -1 });
const sp1 = buildSpectrum(edesign, { ...ep, envIndex: 0 });
let sdiff = 0;
for (let i = 0; i < sp0.series[0].R.length; i++) sdiff += Math.abs(sp0.series[0].R[i] - sp1.series[0].R[i]);
assert.ok(sdiff > 1e-6, 'buildSpectrum env differs (substrate BK7 vs SiO2)');

// (b) buildResponseFn —— 返回 (lam) => … 闭包；第 5 参 envIndex
const rf0 = buildResponseFn(edesign, 'R', 'avg', 0, -1);
const rf1 = buildResponseFn(edesign, 'R', 'avg', 0, 0);
assert.ok(Math.abs(rf0(550) - rf1(550)) > 1e-6, 'buildResponseFn env differs (substrate BK7 vs SiO2)');

// (c) buildAllProcessFiles —— .res 谱数据区随基底变化（只比数据行，
//     避开含秒级时间戳的头部，防止跨秒误判）
const edep = { activeSide: 'front', secondSurface: 'bare', quantity: 'R', aoi: 0, polarization: 'avg', lambdaStart: 400, lambdaEnd: 700, lambdaStep: 100 };
const exp0 = buildAllProcessFiles(edesign, { ...edep, envIndex: -1 });
const exp1 = buildAllProcessFiles(edesign, { ...edep, envIndex: 0 });
assert.ok(exp0.length === 1 && exp1.length === 1, 'process files built for 1-layer design');
const dataOf = (f) => f.content.split('\r\n').filter(l => /^\s*\d+\.\d{4}\s+/.test(l)).join('\n');
assert.notStrictEqual(dataOf(exp0[0]), dataOf(exp1[0]), 'process file spectrum differs (BK7 vs SiO2)');
console.log('export env OK');

// ── Task 8: per-env MF 分解（per-state 重算）────────────────────
// 两环境：环境 0 与设计级共用 RGT target 0，环境 1 target 0.5（差异可辨）。
// 注意：makeOperand 真实签名是单对象参数 makeOperand({...})（operandModel.js），
// 与 brief 中的 makeOperand('RGT', {...}) 不同——按真实 API 调整，断言不变。
const mdesign = {
  incidentMedium: 'Air', exitMedium: 'Air',
  substrate: { material: 'BK7', thickness: 1.0 },
  frontLayers: [{ material: 'TiO2', thickness: 100 }],
  meritEnvironments: [
    { id: 'e1', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1.0 } },
    { id: 'e2', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1.0 }, operands: [ makeOperand({ type: 'RGT', target: 0.5, weight: 1, lambdaStart: 400, lambdaEnd: 700 }) ] },
  ],
};
const mops = [ makeOperand({ type: 'RGT', target: 0, weight: 1, lambdaStart: 400, lambdaEnd: 700 }) ];

const envMf = perEnvMfFor(mdesign, mops);
assert.ok(Array.isArray(envMf) && envMf.length === 2, 'perEnvMfFor returns 2 env values');
assert.ok(Number.isFinite(envMf[0]) && Number.isFinite(envMf[1]), 'perEnvMf values finite');
assert.notStrictEqual(envMf[0], envMf[1], 'per-env MF differs across environments');

// 无多环境 → null
assert.equal(perEnvMfFor({ ...mdesign, meritEnvironments: [] }, mops), null, 'single-env returns null');
// 无操作数 → null
assert.equal(perEnvMfFor(mdesign, []), null, 'no operands returns null');
console.log('refinement env MF OK');
