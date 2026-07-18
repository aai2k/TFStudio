/**
 * Canonical antireflection SEED generator — PUBLIC BARREL.
 *
 * Macleod (Thin-Film Optical Filters 5th ed., "Automatic Design") notes that
 * synthesis "most effectively works when the total number of layers is not
 * large", and that a design is often best reached "by … establishing a very
 * good starting design and then carrying out a minimum of refinement." Needle /
 * Gradual-Evolution synthesis-from-nothing struggles to discover compact
 * classic designs — in particular the 3-layer quarter–half–quarter (QHQ)
 * broadband AR, whose HALF-WAVE middle layer is *absentee* at λ0 and therefore
 * has near-zero needle-insertion sensitivity (the P-function ≈ 0 there), so the
 * needle scan never wants to grow it.
 *
 * This module emits the small, canonical family of QW/HW antireflection
 * starting designs built from the user's material pool (classified low / medium
 * / high by refractive index at λ0). The caller refines each candidate with the
 * production refiner and keeps the best — no knowledge of the answer required.
 *
 * Pure (no DOM / worker / engine imports): given resolved materials it returns
 * plain design candidates. Refinement + ranking is done by the caller (so it
 * can reuse the worker pool / makeEngine).
 *
 * Convention: frontLayers are stored AIR-FIRST (frontLayers[0] = the layer next
 * to the incident medium), matching the rest of TFStudio's design model. A
 * classic AR puts the LOW-index layer outermost (air side); higher-index layers
 * sit toward the substrate. Template role sequences below are written air→sub.
 *
 * Reference: Macleod ch.4 (antireflection coatings); the QHQ / "W-coating"
 * broadband AR (e.g. MgF2 ¼λ / high ½λ / medium ¼λ on glass).
 *
 * The implementation is split into focused modules under ./seedGenerator/:
 *   thickness   → qwThickness (QW/HW physical thickness at λ0)
 *   classify    → classifyPoolByIndex (low/med/high role assignment)
 *   templates   → AR_TEMPLATES + per-seed layer id generator
 *   candidates  → per-role candidate selection + combination enumeration
 *   layers      → per-template layer-stack construction
 *   generate    → generateARSeeds
 *   rank        → rankSeeds
 * This file re-exports their full surface so every existing importer
 * (components, tests) is unchanged.
 */

export * from './seedGenerator/classify.js';
export * from './seedGenerator/generate.js';
export * from './seedGenerator/rank.js';
