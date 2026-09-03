/**
 * The medium the witness chip is monitored in.
 *
 * A design can be embedded in glass, a filter cemented between two
 * substrates, and its incident medium is then a glass. The witness chip hangs
 * in the chamber all the same, so the in-chamber monitor signal is read with
 * air above the growing coating whatever medium the finished part sits in.
 * Only the monitor signal uses this; the run's resulting spectrum is scored
 * in the design's own media.
 */
export const CHAMBER_MEDIUM_ID = 'Air';
