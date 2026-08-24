import { defineNode } from '../descriptor.ts';
export default defineNode({ kind: 'tracks', family: 'draw', order: 10, browser: 'node', label: 'every playing track', defaultOp: 'by name' });
