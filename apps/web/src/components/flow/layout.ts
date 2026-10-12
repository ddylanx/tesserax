import ELK from 'elkjs/lib/elk.bundled.js';
import type { Edge, Node } from '@xyflow/react';

const elk = new ELK();

/** Left-to-right layered layout (like n8n's "Tidy up"); loops are kept but do not drive the layering. */
export async function tidyLayout<N extends Node, E extends Edge>(nodes: N[], edges: E[]): Promise<N[]> {
  const graph = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.spacing.nodeNode': '50',
      'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      // long chains wrap into several rows instead of one very wide line
      'elk.layered.wrapping.strategy': 'MULTI_EDGE',
      'elk.aspectRatio': '1.8',
      'elk.layered.wrapping.additionalEdgeSpacing': '30',
    },
    children: nodes.map(n => ({ id: n.id, width: n.measured?.width ?? 240, height: n.measured?.height ?? 130 })),
    edges: edges.map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  });
  const pos = new Map((graph.children ?? []).map(c => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
  return nodes.map(n => ({ ...n, position: pos.get(n.id) ?? n.position }));
}
