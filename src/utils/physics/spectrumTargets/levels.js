/**
 * How a plot reads an operand's level on its vertical axis.
 *
 * An R/T/A operand holds a fraction and is drawn in percent, and a level drawn
 * past the top of that axis is a physical impossibility, so it is clamped. A
 * GD, GDD or TOD operand holds the plotted unit itself, and nothing bounds it.
 *
 *   toAxis    operand target to the axis unit
 *   fromAxis  axis unit to the operand target
 */

import { clampFrac } from './style.js';

export const PERCENT_LEVEL = {
    toAxis: target => target * 100,
    fromAxis: level => clampFrac(level / 100),
};

export const UNIT_LEVEL = {
    toAxis: target => target,
    fromAxis: level => level,
};
