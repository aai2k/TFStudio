import assert from 'node:assert';
import { resolveEnvironment, environmentOptions, environmentLabel } from '../src/utils/physics/environment.js';

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
