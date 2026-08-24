export const NODE_FAMILY_DETAILS = {
  draw: 'Everything that makes a colour out of nothing',
  transform: 'Everything that takes a picture and gives one back where it is',
  geometry: 'Moving the point a picture is read at',
  Ableton: 'Three questions you can ask the set, and nothing else can answer',
  numbers: 'Numbers, and the arithmetic between them',
  'the end': 'What leaves the flow',
} as const;

export type NodeFamily = keyof typeof NODE_FAMILY_DETAILS;
export type NodeBrowser = 'modes' | 'node' | 'shelf' | 'fixed';

/**
 * The metadata one node folder contributes to the vocabulary.
 *
 * It deliberately imports nothing from the protocol or renderer. The generated
 * manifest is imported by both, so keeping this leaf pure prevents a registry
 * cycle while still letting its literal `kind` become the `NodeKind` union.
 */
export interface NodeDescriptor<Kind extends string = string> {
  kind: Kind;
  family: NodeFamily;
  /** Order within the family in the node browser. */
  order: number;
  /** How this kind appears: as presets, one row, the flow shelf, or never addable. */
  browser: NodeBrowser;
  /** A browser label that is intentionally more specific than the faceplate name. */
  label?: string;
  /** The mode selected when a single browser row drops the node. */
  defaultOp?: string;
}

export function defineNode<const Definition extends NodeDescriptor>(
  definition: Definition,
): Definition {
  return definition;
}
