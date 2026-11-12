interface DiffModels {
  original: { dispose(): void };
  modified: { dispose(): void };
}
export interface DiffModelOwner {
  getModel(): DiffModels | null;
  setModel(model: null): void;
}

/** Monaco requires detachment before model disposal; the React wrapper owns editor disposal. */
export function detachDiffModels(editor: DiffModelOwner | null): void {
  if (!editor) return;
  const models = editor.getModel();
  editor.setModel(null);
  models?.original.dispose();
  models?.modified.dispose();
}
