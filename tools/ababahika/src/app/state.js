// state.js - the shared layer list and a tiny event bus.
export const state = { layers: [], selected: null, map: null, results: [] };
const subs = new Map();
export const on = (ev, fn) => { if (!subs.has(ev)) subs.set(ev, []); subs.get(ev).push(fn); };
export const emit = (ev, data) => (subs.get(ev) || []).forEach((fn) => fn(data));
let nid = 1;
export const newId = () => `L${nid++}`;
export const byId = (id) => state.layers.find((l) => l.id === id);
export const vectors = (kind) => state.layers.filter((l) => l.type === 'vector' && (!kind || l.geom === kind));
export const rasters = () => state.layers.filter((l) => l.type === 'raster');
