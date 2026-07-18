// "Nice" tick-value stepping shared by both chart axes — standard 1/2/5×10ⁿ
// rounding so gridlines land on round numbers instead of the raw data step.

function niceFactorRound(frac) {
  if (frac < 1.5) return 1;
  if (frac < 3) return 2;
  if (frac < 7) return 5;
  return 10;
}

function niceFactorFloor(frac) {
  if (frac <= 1) return 1;
  if (frac <= 2) return 2;
  if (frac <= 5) return 5;
  return 10;
}

function niceNum(range, round) {
  const exp = Math.floor(Math.log10(range || 1));
  const frac = (range || 1) / Math.pow(10, exp);
  const nf = round ? niceFactorRound(frac) : niceFactorFloor(frac);
  return nf * Math.pow(10, exp);
}

// Generate ~`count` "nice" tick values across [min,max].
export function ticks(min, max, count = 5) {
  if (!(max > min)) return [min];
  const range = niceNum(max - min, false);
  const step  = niceNum(range / (count - 1), true);
  const start = Math.ceil(min / step) * step;
  const out = [];
  for (let v = start; v <= max + step * 0.5; v += step) out.push(Math.round(v / step) * step);
  return out;
}

export const fmtTick = (v) => {
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 1e5)) return v.toExponential(1);
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 1000) / 1000);
};
