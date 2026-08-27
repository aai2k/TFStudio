import assert from 'node:assert';
import { computeOpticalSpectrum } from '../src/components/windows/analysis/opticalEvaluation/spectrum.js';
import { computeDesignSpectrum } from '../src/utils/io/designSpectrum.js';
import { resolveEnvironment, environmentOptions, environmentLabel } from '../src/utils/physics/environment.js';
import { opticalEnvSession } from '../src/components/windows/analysis/opticalEvaluation/envSession.js';
import { computeVariatorSpectrum } from '../src/components/windows/optimization/variator/model.js';

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
