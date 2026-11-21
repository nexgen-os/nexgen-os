// The computations of the modules shipped here that are code rather than
// functions of the schema, under the names the MCP server and the command
// line call them by (`Computations`, decision 0046). A surface started from
// a checkout passes this; each computation writes its own estimate or
// settlement with its provenance.
import type { Computations } from '@nexgen-os/core';
import { size as sizeCharging } from './charging/src/size.js';
import { settleSharing } from './community/src/sharing.js';
import { size as sizeSolar } from './solar/src/size.js';
import { estimateYield } from './solar/src/yield.js';
import { size as sizeBattery } from './battery/src/estimates.js';

export const MODULE_COMPUTATIONS: Computations = {
  'solar.size': sizeSolar as Computations['solar.size'],
  'solar.yield': ((db, request) => estimateYield(db, request)) as Computations['solar.yield'],
  'battery.size': sizeBattery as Computations['battery.size'],
  'community.settle': settleSharing as Computations['community.settle'],
  'charging.size': sizeCharging as Computations['charging.size'],
};
