// Needle helpers of the deep synthesis (needle.c; giga4.c floor_bound), in
// three parts: the scan (the needle function over a window of layers and its
// local minima along the depth), the insertion (a needle at a set or at its
// best thickness, the floor-thick pair, the layers held at the floor), and the
// probe-needle cycle. The other modules import them from here.

export * from './needleScan.js';
export * from './needleInsert.js';
export * from './needleProbe.js';
