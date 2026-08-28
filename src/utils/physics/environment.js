// src/utils/physics/environment.js
export function resolveEnvironment(design, envIndex) {
  const envs = (design && design.meritEnvironments) || [];
  const idx = typeof envIndex === 'number' ? envIndex : -1;
  if (idx >= 0 && idx < envs.length && envs[idx]) {
    const e = envs[idx];
    return {
      incidentMedium: e.incidentMedium ?? (design && design.incidentMedium),
      exitMedium: e.exitMedium ?? (design && design.exitMedium),
      substrate: e.substrate ?? (design && design.substrate),
      environmentIndex: idx,
    };
  }
  return {
    incidentMedium: design ? design.incidentMedium : undefined,
    exitMedium: design ? design.exitMedium : undefined,
    substrate: design ? design.substrate : undefined,
    environmentIndex: -1,
  };
}

export function environmentLabel(env) {
  if (!env) return '';
  const inc = env.incidentMedium || '?';
  const ext = env.exitMedium || '?';
  return `E?: ${inc} → ${ext}`.replace('E?', `E${(env._n ?? 0) + 1}`);
}

export function environmentOptions(design) {
  const envs = (design && design.meritEnvironments) || [];
  const opts = [{ value: -1, label: 'designLevel' }];
  envs.forEach((e, i) => {
    opts.push({ value: i, label: `E${i + 1}` });
  });
  return opts;
}
