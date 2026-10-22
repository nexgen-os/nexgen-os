// @nexgen-os/energy-bill — the energy of a bill, from the invoice a generic
// reader returned (EN 16931) and the energy facts it cannot know.

export { readEnergyBill, projectedPrice, meanProjectedPrice, figure, KWH_PER_UNIT } from './read.js';
export {
  allHoursLines,
  bandGrid,
  billedKwh,
  componentsOf,
  contributionSummary,
  coverSameKwh,
  coveredKwh,
  deliveryBilling,
  lineDisagrees,
  periodOfLines,
  priceRevision,
  projection,
  reconcileLines,
  taxPerKwh,
  weightedMean,
  wholeSeasons,
  type Billed,
  type Delivery,
  type PriceRevision,
} from './prices.js';
export type * from './types.js';
