export interface EditableNodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditableNode {
  id: string;
  kind: 'text' | 'image' | 'link' | 'container';
  label: string;
  tagName: string;
  className: string;
  text: string;
  rect: EditableNodeRect;
  fields: Record<string, string>;
  attributes: Record<string, string>;
  styles: Record<string, string>;
  isLayoutContainer: boolean;
  isHidden?: boolean;
  outerHtml?: string;
  parentId?: string;
  depth: number;
  classList: string[];
  selector: string;
  editable: boolean;
  parentDisplay?: string;
  childCount: number;
}

export type CanvasEditBridgeMessage =
  | { type: 'vd-edit-targets'; targets: EditableNode[] }
  | { type: 'vd-edit-hover'; target: EditableNode | null }
  | { type: 'vd-edit-select'; target: EditableNode | null }
  | { type: 'vd-edit-text-commit'; id: string; value: string }
  | { type: 'vd-edit-preview-style-applied'; id: string };

export type CanvasEditHostCommand =
  | { type: 'vd-edit-selected-target'; id: string | null }
  | { type: 'vd-edit-hovered-target'; id: string | null }
  | { type: 'vd-edit-preview-text'; id: string; value: string }
  | { type: 'vd-edit-preview-text-reset'; id: string }
  | { type: 'vd-edit-preview-style'; id: string; styles: Record<string, string> }
  | { type: 'vd-edit-preview-style-reset'; id: string }
  | { type: 'vd-edit-theme'; theme: 'light' | 'dark' };
