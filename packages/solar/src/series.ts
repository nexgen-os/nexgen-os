// A point of a series as the computations read it: the shape the series API of
// the core returns (`@nexgen-os/core` re-exports this type), so that a series
// read from an installation passes to a computation as it is.

/** One value at one instant, ISO 8601 with its offset, with its quality code (0 measured when absent; 3 missing). */
export interface SeriesPoint {
  at: string;
  value: number;
  quality?: number;
}
