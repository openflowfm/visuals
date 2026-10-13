// The lab entry of the app's UI (`app/src/ui/lab.ts`): visual[flow]'s preset editor, for a lab
// build only, loaded by `Lab.tsx`. It is its own module (its styles in each part's own CSS) so an
// app built without the lab never bundles the editor or its commands (`model/lab.ts`): the app's
// CI fails when `apply`, `set_value`, `previews` or `default_shader` reach its page.
//
//   import { VisualsApp } from './ui';
//   import { VisualsEditor } from './ui/lab';
//   <VisualsApp lab={VisualsEditor} />;

export { Editor as VisualsEditor, type EditorProps as VisualsEditorProps } from './Editor/Editor';
export { StageGraph, type StageGraphProps } from './StageGraph/StageGraph';
export { StageInspector } from './StageInspector/StageInspector';
