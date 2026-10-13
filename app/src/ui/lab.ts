// The lab entry of @satoramoto/zen: `@satoramoto/zen/visuals/lab`, visual[flow]'s preset editor, for
// a lab build only. It is its own entry (`lib/visuals-lab.js`, its stylesheets in
// `lib/visuals-lab.css`) so an app built without the lab never bundles the editor or its commands
// (`model/lab.ts`): the app's CI fails when `apply`, `set_value`, `previews` or `default_shader`
// reach its page.
//
//   import { VisualsApp } from '@satoramoto/zen/visuals';
//   import { VisualsEditor } from '@satoramoto/zen/visuals/lab';
//   import '@satoramoto/zen/visuals-lab.css';
//   <VisualsApp lab={VisualsEditor} />;

export { Editor as VisualsEditor, type EditorProps as VisualsEditorProps } from './Editor/Editor';
export { StageGraph, type StageGraphProps } from './StageGraph/StageGraph';
export { StageInspector } from './StageInspector/StageInspector';
