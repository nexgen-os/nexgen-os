// Time zones: `offsetAt()` lives with the computations of `@nexgen-os/solar`
// (MIT, decision 0063), which cut local days and years without the core; the
// core reads the same function, so that there is one implementation.
export { offsetAt } from '@nexgen-os/solar';
