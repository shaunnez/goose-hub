export { buildRouteIndex } from './builder.js';
export type { BuildRouteIndexOptions, BuildRouteIndexResult } from './builder.js';
export { defaultRouteIndexDbPath, openRouteIndexDb } from './db.js';
export { assessRouteIndexFreshness, ensureRouteIndexFresh } from './freshness.js';
export type { RouteIndexFreshness } from './freshness.js';
export { findComponentUsages, lookupRoute, routeForComponent } from './lookup.js';
export type { ComponentUsageRow, RouteRow } from './types.js';
