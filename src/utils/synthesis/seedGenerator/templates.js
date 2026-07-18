/**
 * Canonical AR template family + per-seed layer id generator.
 */

let _seedCounter = 0;
export const seedLayerId = () => `seed${(_seedCounter++).toString(36)}${Math.round(performance?.now?.() ?? 0).toString(36)}`;

// Canonical AR template family. Each template is a role sequence written
// AIR→SUBSTRATE; entry = [role, quarterWaves]. `needs` lists the roles the
// template requires (so it is skipped when the pool lacks that role).
//   • low / high are always present (pool sorted by n); med needs ≥3 materials.
export const AR_TEMPLATES = [
    { key: 'L1',        name: '1-layer (L¼)',                roles: [['low', 1]],                       needs: ['low'] },
    { key: 'L1_H1',     name: '2-layer (L¼ H¼)',             roles: [['low', 1], ['high', 1]],          needs: ['low', 'high'] },
    { key: 'L1_M1',     name: '2-layer (L¼ M¼)',             roles: [['low', 1], ['med', 1]],           needs: ['low', 'med'] },
    { key: 'L1_H2_M1',  name: '3-layer QHQ (L¼ H½ M¼)',      roles: [['low', 1], ['high', 2], ['med', 1]], needs: ['low', 'med', 'high'] },
    { key: 'L1_M2_H1',  name: '3-layer QHQ (L¼ M½ H¼)',      roles: [['low', 1], ['med', 2], ['high', 1]], needs: ['low', 'med', 'high'] },
    { key: 'L1_M1_H1',  name: '3-layer QQQ (L¼ M¼ H¼)',      roles: [['low', 1], ['med', 1], ['high', 1]], needs: ['low', 'med', 'high'] },
    { key: 'L1_H2_L1',  name: '3-layer (L¼ H½ L¼)',          roles: [['low', 1], ['high', 2], ['low', 1]], needs: ['low', 'high'] },
    { key: 'L1_H1_L1_H1', name: '4-layer (L¼ H¼ L¼ H¼)',     roles: [['low', 1], ['high', 1], ['low', 1], ['high', 1]], needs: ['low', 'high'] },
    { key: 'L1_H2_M2_H1', name: '4-layer (L¼ H½ M½ H¼)',     roles: [['low', 1], ['high', 2], ['med', 2], ['high', 1]], needs: ['low', 'med', 'high'] },
];
