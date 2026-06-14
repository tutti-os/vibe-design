# HTML 属性面板 Cursor 化改造方案（可执行版 · 对齐 Cursor 2.2 Visual Editor）

> 目标：把 vibe-design `CanvasInspectorPanel` 改造成与 **Cursor 2.2 Visual Editor**（cursor.com 浏览器内的 Design Sidebar）一致的属性面板。
> 范围：`web/src/features/canvas-workspace/canvas-property-inspector/*`、`CanvasInspectorPanel.tsx`、`canvas-edit/types.ts`、`canvas-edit/bridge.ts`、`canvas-edit/apply-html-edit.ts`。
> 来源：本方案的能力清单来自 Cursor 官方文档与官方博客（见 §0「来源」），不再凭截图推断。

---

## 0. 来源（Authoritative References）

| 来源 | 说明 |
| --- | --- |
| [Cursor Docs — Browser](https://cursor.com/docs/agent/tools/browser) | 官方文档，正面列出 Design Sidebar 的 5 个能力分组（**唯一权威列表**） |
| [Cursor Blog — A visual editor for the Cursor Browser](https://cursor.com/blog/browser-visual-editor) | 2.2 发布说明，包含 React props 面板、token 集成、point-and-prompt |
| [Cursor Forum — Cursor 2.2: Visual Editor](https://forum.cursor.com/t/cursor-2-2-visual-editor-for-cursor-browser/145958) | 官方释义贴 + 用户讨论 |
| [Builder.io — Cursor Design Mode Explained](https://www.builder.io/blog/cursor-design-mode-visual-editing) | 第三方实测，明确指出 Cursor 当前**不**支持的能力（多选、可靠 undo、layers、画布拖拽） |
| [StarkInsider — Cursor's New Visual Editor](https://www.starkinsider.com/2025/12/cursor-visual-editor-ide-web-design.html) | 第三方走查 |

---

## 1. Cursor 2.2 Visual Editor 实际能力清单（官方）

> 引用自 [Cursor Docs / Browser](https://cursor.com/docs/agent/tools/browser)：

| 官方分组 | 官方描述 | 包含字段（直读 + 推断） |
| --- | --- | --- |
| **Position and layout** | "Move and rearrange elements on the page. Change flex direction, alignment, and grid layouts." | position-type、flex-direction、justify/align、gap、display: grid、grid alignment |
| **Dimensions** | "Adjust width, height, padding, and margins with precise pixel values." | width、height、padding、margin（pixel 精确） |
| **Colors** | "Update colors from your design system or add new gradients. Access color tokens through a visual picker." | color、background-color、gradient、color token picker |
| **Appearance** | "Experiment with shadows, opacity, and border radius using visual sliders." | box-shadow、opacity、border-radius |
| **Theme testing** | "Test your designs across light and dark themes instantly." | light/dark theme 切换（不是 hover/focus 变体） |

> 引用自 [Cursor Blog](https://cursor.com/blog/browser-visual-editor)：

- **React props 面板**："surface these props in the sidebar so you can make changes across different variants of a component"
- **Design tokens**："your own color tokens and design system"
- **Drag & drop**：在渲染页面上拖拽元素重排 DOM
- **Point and prompt**：选中元素后直接对 AI 发指令
- **Sliders + 颜色选择器 + token picker**：交互形式

> 第三方实测 ([Builder.io](https://www.builder.io/blog/cursor-design-mode-visual-editing)) 明确指出 Cursor **当前不支持** 的能力（对我们设计目标的含义在 §6）：
- 多元素选择
- 可靠的 Cmd+Z（Undo 不稳定）
- 组件级（vs DOM 级）选择
- 可靠的 Layers/Outliner 导航
- 画布拖拽 / 缩放
- 字段默认输出"raw values"而非 token 映射

---

## 2. 对照：vibe-design 现状 vs Cursor 实际 vs 本方案

| 维度 | vibe-design 现状 | Cursor 2.2 官方 | 本方案目标 |
| --- | --- | --- | --- |
| Header | `Edit div` + X | `Components` + 元素操作 | **匹配 Cursor**：Components + Edit 数 + Undo + Apply |
| 选中标识 | 标题文字 | selector chip + props 元信息 | **匹配 Cursor**：selector chip |
| 元素导航 | 扁平 Elements/Structure | Layers 不可靠（Builder.io 实测） | **超越 Cursor**：稳定 DOM 树 Outliner（这是 Cursor 缺失) |
| 编辑模型 | 单元素 + Save/Cancel | 即时 Apply，Undo 不可靠 | **超越 Cursor**：编辑栈 + Undo/Apply（修正 Cursor 缺陷） |
| Position & Layout | 仅 flow segmented，X/Y/Z/angle 简陋 | flex-direction / alignment / grid / position-type | **匹配 Cursor** |
| Dimensions | W/H 固定 px | width/height/padding/margin pixel | **匹配 Cursor** |
| Colors | 单 swatch | color/bg/gradient + token picker | **匹配 Cursor**（含 token） |
| Appearance | opacity + radius | shadow + opacity + radius slider | **匹配 Cursor** |
| Theme 切换 | 无 | light/dark 切换 | **匹配 Cursor**（Header 右侧） |
| React props | 无 | 组件实例 props 面板 | **匹配 Cursor**（vibe-design 项目为 HTML/Tailwind，先做 props 检测兜底，无 props 时不渲染该 Tab） |
| Typography | 仅 text 元素 | 未在官方文档明列；但博客提"typography" | **匹配 Cursor**：常用字段一组（family/size/weight/line/letter/color/align/decoration） |
| Border | 四边相同 | 未在官方文档明列 | **保守**：仅 radius（属于 Appearance）；side-by-side border 暂不做 |
| 多元素选择 | 无 | 不支持 | **超越 Cursor**：可选，作为可关掉的可选项 |
| 多变体 (hover/focus) | 无 | 不支持 | **不做**（与 Cursor 对齐，避免过度设计；用 `:hover` 字面写需用户在 CSS Tab） |
| 多断点 | 无 | 不支持 | **不做** |
| Classes 编辑 | 无 | 不支持显式 chip 编辑 | **不做**（class 改动通过 Apply 时按 Tailwind 反向映射，单独项目可启 phase 2） |
| Attributes 编辑 | 无 | 不支持 | **不做** |
| CSS 源码 Tab | 无 | 未明列 | **保留**作为只读辅助（小成本） |
| Point and prompt | 现有 vibe-design chat 已具备类似能力 | 有 | 复用 vibe-design 既有 chat 入口 |

> **方案原则**：以 Cursor 实际能力为基线（§1），修正 Cursor 已知缺陷（稳定 Outliner、可靠 Undo），不额外引入「Cursor 没做的高级特性」（hover/focus/breakpoint/classes/attrs/transform 3D/filter/transition list）。这样既准确对标，又避免范围爆炸。

---

## 3. 一图导览（最终面板，对齐 Cursor）

```
┌──────────────────────────────────────────────────────────┐
│ Components       3 Edits  ↶ Undo  ✓Apply   ☀/🌙   ✕      │  Header（含 theme 切换）
├──────────────────────────────────────────────────────────┤
│ section.relative.grid.min-h-0.flex-1.overflow-hidden …    │  Selector chip
├──────────────────────────────────────────────────────────┤
│ ▾ div#root                                                │
│  ▾ main                                                   │  DOM Tree Outliner
│   ▾ div.flex                                              │  （Cursor Layers 不稳，我们补完）
│    > header                                               │
│    ▾ section.relative …  ●                                │
├──────────────────────────────────────────────────────────┤
│ [Design] [Props] [CSS]                                    │  Tabs（Props 仅 React 组件时启用）
├── Design ───────────────────────────────────────────────┤
│ ▸ Position & Layout                                       │
│   • Position type  static/relative/absolute/fixed/sticky │
│   • X Y Z  (top/left/right/bottom + z-index)             │
│   • Flow icons: Row / Col / Wrap / Grid / Block          │
│   • Alignment 3×3 grid + Gap                              │
│ ▸ Dimensions                                              │
│   • W [px▾]  H [px▾]                                     │
│   • Padding  V/H | T R B L              🔗               │
│   • Margin   V/H | T R B L              🔗               │
│ ▸ Colors                                                  │
│   • Text color (Swatch + Token picker)                   │
│   • Background (Solid / Gradient)                         │
│ ▸ Appearance                                              │
│   • Opacity slider                                        │
│   • Border radius (4-corner separate)                     │
│   • Box shadow (X Y Blur Spread Color)                    │
│ ▸ Typography                                              │
│   • Family Weight Size Line Letter                        │
│   • Align ⟸⟺⟹  Decoration  Color                       │
├── Props ────────────────────────────────────────────────┤
│ 检测到 React 组件时展示其 props（vibe-design 主要是       │
│ HTML/Tailwind，此 Tab 默认隐藏；后续扩展） │
├── CSS ─────────────────────────────────────────────────┤
│ 只读源码 + Copy                                           │
└──────────────────────────────────────────────────────────┘
```

---

## 4. 全量属性矩阵（按官方 5 分组组织）

> 这是面板的**单一信息源**。所有新增 style key、控件、normalize、测试都从此推。
> 类型：N=number、S=string、E=enum、U=number+unit、C=color、Toggle=布尔。

### 4.1 Position & Layout

| 字段 | CSS | 控件 | 备注 |
| --- | --- | --- | --- |
| positionType | `position` | E: static/relative/absolute/fixed/sticky | 影响 X/Y/right/bottom enabled |
| positionX | `left` | U(px/%/auto) | static → disable |
| positionY | `top` | U(px/%/auto) | 同上 |
| positionRight | `right` | U(px/%/auto) | 展开后可见 |
| positionBottom | `bottom` | U(px/%/auto) | 同上 |
| positionZ | `z-index` | N | |
| displayMode | `display` + `flex-direction` + `flex-wrap` | 4 icon: Row / Col / Wrap / Grid + Select for block/inline/inline-block/none | 展开规则见 §5.2 |
| justifyContent | `justify-content` | 3×3 grid（前 3 列）+ select 列出 space-between/around/evenly | |
| alignItems | `align-items` | 3×3 grid（前 3 行） | |
| gap | `gap` | U | 展开后 rowGap/columnGap 拆开 |
| rowGap | `row-gap` | U | |
| columnGap | `column-gap` | U | |
| (display: grid 子项) gridTemplateColumns | `grid-template-columns` | ComboBox + chip 预设 `1fr / auto / repeat(N,1fr)` | Cursor 官方提"grid layouts"含模板 |
| gridTemplateRows | `grid-template-rows` | ComboBox + chip 预设 | |

> Cursor 官方未明列 grid-area / auto-flow / grid template areas，本方案不实现以匹配范围。需要时升级阶段处理。

### 4.2 Dimensions

| 字段 | CSS | 控件 |
| --- | --- | --- |
| width | `width` | U（px/%/auto/rem） |
| widthUnit | (辅助) | E: px/%/rem/auto |
| height | `height` | U |
| heightUnit | (辅助) | E: 同上 |
| paddingVertical / Horizontal / Top / Right / Bottom / Left | `padding-*` | LinkBoxField |
| marginVertical / Horizontal / Top / Right / Bottom / Left | `margin-*` | LinkBoxField |

> Cursor 官方未明列 min/max-width-height、aspect-ratio。本方案放在「Beyond Cursor」（§4.6），默认不显，按需开启。

### 4.3 Colors

| 字段 | CSS | 控件 |
| --- | --- | --- |
| color | `color` | SwatchField + token picker |
| backgroundFill | (Solid / Gradient 二选一) | SegmentedControl 切换两种模式 |
| backgroundColor | `background-color` | Swatch + opacity |
| backgroundGradient | `background-image: linear-gradient(...)` | GradientStopsEditor（2–4 stop 简化版）+ angle |

> Cursor 官方提"new gradients"但未明列径向/锥形；本方案先只做 linear，其它放 Beyond Cursor。
> Token picker：读取项目 Tailwind / CSS 变量列表，作为 Swatch 的快捷面板。

### 4.4 Appearance

| 字段 | CSS | 控件 |
| --- | --- | --- |
| opacity | `opacity` | N(0..100, %) slider + input |
| borderRadius | `border-radius` | U slider + input |
| radiusTopLeft / TopRight / BottomRight / BottomLeft | `border-*-radius` | U（展开后 4 角独立） |
| shadowX / Y / Blur / Spread | `box-shadow` 拆分 | N |
| shadowColor | `box-shadow` color | Swatch |
| shadowOpacity | （辅助 → 合到 shadowColor） | N(%) |

> Cursor 官方"shadows"用单数 sliders；本方案仅实现一条 box-shadow，多层 shadow 放 Beyond Cursor。

### 4.5 Theme Testing

| 能力 | 实现 |
| --- | --- |
| light/dark 切换 | Header 右侧 `☀/🌙` 切换按钮 |
| 落地方式 | 给 iframe 根 `<html>` 加 `data-theme="dark"` 或切换 `class="dark"`（项目已用 Tailwind dark 变体） |
| 持久化 | 仅本地 UI 态，不写源码 |

### 4.6 Typography（Cursor 博客提及，但官方分组未明列；保守纳入）

| 字段 | CSS | 控件 |
| --- | --- | --- |
| fontFamily | `font-family` | ComboBox |
| fontWeight | `font-weight` | E: 100..900 |
| fontSize | `font-size` | U(px/rem/em) |
| lineHeight | `line-height` | S |
| letterSpacing | `letter-spacing` | U |
| textAlign | `text-align` | Segmented icons: left/center/right/justify |
| textDecoration | `text-decoration` | E: none/underline/line-through |

### 4.7 Beyond Cursor（**不在 Cursor 官方范围**，本方案默认不开，作为后续 phase 的扩展位）

| 项 | 决策 |
| --- | --- |
| min/max-width/height、aspect-ratio | 折叠开关 `Show advanced sizing`（关闭默认） |
| 多层 background / box-shadow | 单项满足后续扩展 |
| 径向/锥形 gradient | 同上 |
| Border 四边独立 + style + outline | 不实现 |
| Transform 3D / Filter / Backdrop / Transition / Animation | 不实现 |
| Hover/Focus/Active 状态变体 | 不实现（Cursor 也不支持） |
| 断点 sm/md/lg/xl | 不实现 |
| Classes Tab / Attrs Tab | 不实现 |

> 这些字段如果将来要做，可挂到 `<details>` 折叠或独立 phase。**MVP 不做**。

---

## 5. 协议 / bridge 变更

### 5.1 [`canvas-edit/types.ts`](../web/src/features/canvas-workspace/canvas-edit/types.ts)

```ts
export interface EditableNode {
  // 已有
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

  // 新增（Outliner 用）
  parentId?: string;
  depth: number;
  classList: string[];
  selector: string;            // tag(#id)?(.cls)*
  editable: boolean;
  parentDisplay?: string;      // computed parent display；决定要不要显 Flex 子项控件（本 MVP 不做子项，仅用于禁用 align-self 之类）
  childCount: number;
}
```

> **未引入** `pseudoStyles / breakpointStyles`（与 Cursor 范围对齐）。

### 5.2 bridge.ts

- `emitTargets()` 改为 `body.querySelectorAll('*')` 全遍历，过滤 host + `script/style/meta/link/title/head/noscript/template`。
- `targetForElement` 内填充：`parentId / depth / classList / selector / editable / parentDisplay / childCount`。
- 重发节流：`requestIdleCallback` + 单帧上限 5000。
- 不新增 preview-style-rule / preview-state 命令（无需，沿用现有 `vd-edit-preview-style`）。

### 5.3 兼容回退

宿主收到无 `parentId` 的 targets → 退化为扁平 Outliner，避免老 srcdoc 崩。

---

## 6. 状态层

### 6.1 `useInspectorEditSession`（精简版，与 Cursor 对齐）

```ts
type StyleKey = CanvasInspectorStyleKey;
type StyleDraft = Partial<Record<StyleKey, string>>;

interface EditEntry {
  entryId: string;
  targetId: string;
  key: StyleKey | '__text__';
  prev: string;
  next: string;
  ts: number;
}

interface DraftBucket {
  baseline: StyleDraft;
  current: StyleDraft;
  text?: { baseline: string; current: string };
}

interface InspectorEditSession {
  drafts: Record<string, DraftBucket>;          // 按 targetId 索引，无 variant/breakpoint 维度
  edits: EditEntry[];
  dirtyTargetIds: Set<string>;
  beginTarget(t: EditableNode): void;
  setStyle(targetId: string, key: StyleKey, next: string): void;
  setText(targetId: string, next: string): void;
  undoLast(): EditEntry | null;
  applyAll(): Array<{ id: string; text?: string; styles: StyleDraft }>;
  resetTarget(targetId: string): void;
}
```

实现风格：`useReducer`，action `BEGIN / SET_STYLE / SET_TEXT / UNDO / APPLY_OK / RESET`。

### 6.2 预览

每次 dirty 变化对 iframe 发原有 `vd-edit-preview-style`（按 target），切换选中节点时对老 target 发 `vd-edit-preview-style-reset` 并对新 target 发 draft。

### 6.3 Apply

按 dirtyTargetIds 输出 patch，逐个调宿主 `onSaveDraft`（保持现有签名，不破坏后端）。成功后 baseline 刷新、edits 清空。

---

## 7. 新增 / 调整 style keys

在 `CanvasInspectorStyleKey` union 中**追加**：

```ts
| 'positionType' | 'positionRight' | 'positionBottom'
| 'displayMode' | 'widthUnit' | 'heightUnit'
| 'justifyContent' | 'alignItems' | 'gap' | 'rowGap' | 'columnGap'
| 'gridTemplateColumns' | 'gridTemplateRows'
| 'backgroundFillType'   // 'solid' | 'gradient'
| 'fontStyle' | 'textDecoration'
```

> 与之前方案比，**砍掉了 60+ 个 key**（state variants/breakpoints/transform 3D/filter/transition list 等都不做）。

`STYLE_FIELD_CSS_NAMES` 同步映射；`expandCanvasInspectorStyleValue` 中加入：

1. **dimensions + unit**：`width: auto` 时禁数值；否则 `${value}${unit}`。
2. **displayMode**：
   - `'flex'`     → `display:flex; flex-direction:row; flex-wrap:nowrap;`
   - `'flex-col'` → `display:flex; flex-direction:column; flex-wrap:nowrap;`
   - `'flex-wrap'`→ `display:flex; flex-direction:row; flex-wrap:wrap;`
   - `'grid'`     → `display:grid;`
   - 其他透传到 `display`。
3. **shadow 拼装**：把 `shadowX/Y/Blur/Spread/shadowColor/shadowOpacity` 合为单条 `box-shadow`。
4. **gradient 拼装**：`backgroundGradient` 已是完整 `linear-gradient(...)` 字符串，直接走 `background-image`。

---

## 8. 组件结构

```
canvas-property-inspector/
  CanvasPropertyInspector.tsx
  useInspectorEditSession.ts
  selector.ts                       # buildTree / flattenVisible / selectorOf
  context/
    InspectorContext.tsx
  header/
    InspectorHeader.tsx             # Components + Edits + Undo + Apply + ThemeToggle + Close
    InspectorSelectorChip.tsx
    ThemeToggle.tsx
  tree/
    InspectorTreeOutliner.tsx       # 修补 Cursor Layers 不稳的痛点
    TreeRow.tsx
  tabs/
    InspectorTabs.tsx               # Design / Props / CSS
    DesignTab.tsx
    PropsTab.tsx                    # 仅 React 组件时启用；MVP 显占位"No props detected"
    CssTab.tsx
  sections/
    PositionLayoutSection.tsx       # 合并 Cursor 官方 "Position and layout"
    DimensionsSection.tsx
    ColorsSection.tsx
    AppearanceSection.tsx
    TypographySection.tsx
    shared/
      PropertySection.tsx
      AddRemoveSection.tsx
      SectionHeading.tsx
      Subheading.tsx
      FieldRow.tsx
      StackedField.tsx
      ExpandButton.tsx
  controls/
    NumberField.tsx
    UnitNumberField.tsx
    LinkBoxField.tsx
    AlignmentGrid.tsx               # 3×3
    FlowSelector.tsx                # 4 icon
    SwatchField.tsx                 # 含 token picker（项目 Tailwind/CSS 变量）
    GradientStopsEditor.tsx
    ComboBox.tsx                    # 自建
    Select.tsx                      # 自建
    Popover.tsx                     # 自建
    ToggleIconButton.tsx
  index.ts
```

> 砍掉了 `VariantTabs / BreakpointTabs / ChipInput / KeyValueRows / FlexChildSection / GridSection（容器/子项）/ EffectsSection 多层 / TransformSection / TransitionSection / AnimationSection / InteractionSection / BorderSection 四边`。最终大约 **15 个组件文件**，相比之前的 40+ 砍掉一半以上。

---

## 9. 各分区实现细节

### 9.1 PositionLayoutSection

```tsx
<PropertySection title="Position & Layout">
  <FieldRow>
    <Select label="Position" value={draft.positionType ?? 'static'} options={POSITION_TYPES} onChange={...}/>
    <NumberField label="Z" value={draft.positionZ} onChange={...}/>
  </FieldRow>
  <FieldRow>
    <UnitNumberField label="X" value={draft.positionX} unit="px" disabled={draft.positionType === 'static'} .../>
    <UnitNumberField label="Y" value={draft.positionY} unit="px" disabled={...} .../>
  </FieldRow>
  <ExpandButton expanded={showSides} label="right / bottom" onClick={...}/>
  {showSides && (<FieldRow>
    <UnitNumberField label="Right" .../>
    <UnitNumberField label="Bottom" .../>
  </FieldRow>)}

  <Subheading>Flow</Subheading>
  <FlowSelector value={draft.displayMode ?? 'block'} onChange={v => setStyle('displayMode', v)} />

  <Subheading>Alignment</Subheading>
  <div className="grid grid-cols-[1fr,80px] gap-3">
    <AlignmentGrid justify={draft.justifyContent} align={draft.alignItems} onChange={(j,a) => {...}}/>
    <NumberField label="Gap" value={draft.gap} suffix="px" onChange={v => setStyle('gap', v)}/>
  </div>

  {draft.displayMode === 'grid' && (<>
    <Subheading>Grid template</Subheading>
    <ComboBox label="Cols" value={draft.gridTemplateColumns} presets={['1fr','auto','repeat(2, 1fr)','repeat(3, 1fr)']} onChange={...}/>
    <ComboBox label="Rows" value={draft.gridTemplateRows} presets={...} onChange={...}/>
  </>)}
</PropertySection>
```

### 9.2 DimensionsSection

```tsx
<PropertySection title="Dimensions">
  <FieldRow>
    <UnitNumberField label="W" value={draft.width} unit={draft.widthUnit ?? 'px'} onValueChange={...} onUnitChange={...}/>
    <UnitNumberField label="H" value={draft.height} unit={draft.heightUnit ?? 'px'} onValueChange={...} onUnitChange={...}/>
  </FieldRow>
  <LinkBoxField label="Padding"
    axis={{ v: draft.paddingVertical, h: draft.paddingHorizontal }}
    sides={{ t: draft.paddingTop, r: draft.paddingRight, b: draft.paddingBottom, l: draft.paddingLeft }}
    onChange={patch => Object.entries(patch).forEach(([k,v]) => setStyle(k as StyleKey, v))}/>
  <LinkBoxField label="Margin" ... />
</PropertySection>
```

### 9.3 ColorsSection

```tsx
<PropertySection title="Colors">
  <SwatchField label="Text" value={draft.color} onChange={v => setStyle('color', v)} tokens={projectTokens}/>
  <SegmentedControl label="Fill"
    value={draft.backgroundFillType ?? 'solid'}
    options={[{label:'Solid', value:'solid'}, {label:'Gradient', value:'gradient'}]}
    onChange={...}/>
  {draft.backgroundFillType === 'solid'
    ? <SwatchField label="Background" value={draft.backgroundColor} onChange={...} tokens={projectTokens}/>
    : <GradientStopsEditor value={draft.backgroundGradient} onChange={v => setStyle('backgroundGradient', v)}/>}
</PropertySection>
```

`tokens` 来源：在 host 侧解析项目 `tailwind.config.*` / CSS 变量（`--color-*`），同步发到 inspector。

### 9.4 AppearanceSection

```tsx
<PropertySection title="Appearance">
  <FieldRow>
    <NumberField label="Opacity" min={0} max={100} suffix="%" .../>
    <NumberField label="Radius" suffix="px" .../>
  </FieldRow>
  <ExpandButton label="Separate corner radius" expanded={radiusExpanded} onClick={...}/>
  {radiusExpanded && <RadiusFourCorners ...  />}

  <Subheading>Shadow</Subheading>
  <FieldRow><NumberField label="X" .../><NumberField label="Y" .../></FieldRow>
  <FieldRow><NumberField label="Blur" .../><NumberField label="Spread" .../></FieldRow>
  <SwatchField label="Color" value={draft.shadowColor} onChange={...}/>
  <NumberField label="Shadow opacity" min={0} max={100} suffix="%" .../>
</PropertySection>
```

### 9.5 TypographySection

```tsx
<PropertySection title="Typography">
  <ComboBox label="Family" value={draft.fontFamily} presets={projectFonts} onChange={...}/>
  <FieldRow>
    <Select label="Weight" value={draft.fontWeight} options={FONT_WEIGHTS} onChange={...}/>
    <UnitNumberField label="Size" value={draft.fontSize} unit="px" .../>
  </FieldRow>
  <FieldRow>
    <NumberField label="Line" value={draft.lineHeight} .../>
    <UnitNumberField label="Letter" value={draft.letterSpacing} unit="px" .../>
  </FieldRow>
  <SwatchField label="Color" value={draft.color} .../>
  <SegmentedIconControl label="Align" value={draft.textAlign} options={ALIGN_ICONS} onChange={...}/>
  <Select label="Decoration" value={draft.textDecoration} options={['none','underline','line-through']} .../>
</PropertySection>
```

### 9.6 Header / ThemeToggle

```tsx
<header className="h-12 flex items-center justify-between px-3 border-b border-border-1">
  <div className="flex items-center gap-2">
    <h1 className="text-sm font-medium">Components</h1>
    {editCount > 0 ? <Badge>{editCount} Edits</Badge> : null}
  </div>
  <div className="flex items-center gap-1">
    <Button size="xs" variant="chrome" disabled={!canUndo} onClick={onUndo}>↶ Undo</Button>
    <Button size="xs" disabled={!canApply} onClick={onApply}>Apply</Button>
    <ThemeToggle value={theme} onChange={onThemeChange}/>
    <Button size="icon-sm" variant="chrome" onClick={onClose}><CloseIcon/></Button>
  </div>
</header>
```

`ThemeToggle` 把 `data-theme="dark"` / `class="dark"` 切换发给 iframe（不进编辑栈，纯 UI 态）。

### 9.7 PropsTab（vibe-design 暂未广泛使用 React 组件）

```tsx
const detected = props.targetReactProps;   // bridge 检测：节点是否有 React fiber 且 ownerComponent 暴露 props
if (!detected) return <EmptyState>This element is not a React component instance.</EmptyState>;
return <PropEditor schema={detected.schema} values={detected.values} onChange={...}/>;
```

> 检测方式：iframe 在 dev 模式下读 `__REACT_DEVTOOLS_GLOBAL_HOOK__` 拿到 fiber tree，取选中 DOM 节点对应 fiber 的 `memoizedProps`。MVP 只 read-only 展示；编辑能力放下一 phase。

### 9.8 CssTab

```tsx
const css = `${selector} {\n${
  Object.entries(serializeDraftToCss(draft)).map(([k,v]) => `  ${k}: ${v};`).join('\n')
}\n}`;
<pre>{css}</pre>
<Button onClick={() => navigator.clipboard.writeText(css)}>Copy</Button>
```

---

## 10. 文件级 Diff 清单

| 文件 | 改动 |
| --- | --- |
| `canvas-edit/types.ts` | +`parentId / depth / classList / selector / editable / parentDisplay / childCount` |
| `canvas-edit/bridge.ts` | 全 DOM emit + 节流；React fiber props 检测（可选） |
| `CanvasInspectorPanel.tsx` | 接 `useInspectorEditSession`、Save/Cancel → Apply/Undo；新增 `theme` 状态 + `onThemeChange` |
| `canvas-property-inspector/CanvasPropertyInspector.tsx` | 重写为 §8 shell |
| `canvas-property-inspector/useInspectorEditSession.ts` | 新增（§6） |
| `canvas-property-inspector/selector.ts` | 新增 |
| `canvas-property-inspector/header/*` | 3 个文件 |
| `canvas-property-inspector/tree/*` | 2 个文件 |
| `canvas-property-inspector/tabs/*` | 4 个文件（含 PropsTab 占位） |
| `canvas-property-inspector/sections/*` | 5 个文件 + shared |
| `canvas-property-inspector/controls/*` | ~10 个文件 |
| `CanvasInspectorPanel.test.tsx` | Save→Apply、新增 Undo / theme |
| `canvas-property-inspector/__tests__/*` | 每个 section/控件/hook 都有 case |

---

## 11. 测试矩阵

**Hook**
- set / undo / apply / reset 基本行为。
- 跨 target：编辑 A、切到 B、再切回 A，A 的草稿仍在。
- apply 后 baseline 刷新；edits 清空。

**Tree**
- 全 DOM 平铺转树。
- 自动展开到选中节点。
- 不可编辑节点点击 noop。
- dirty 节点圆点。

**Sections**
- PositionLayout：position-type 切 static → disable X/Y；FlowSelector 切 col → display+flex-direction 写入；3×3 写 justify+align。
- Dimensions：单位下拉 `auto` 禁数值；LinkBox link/unlink。
- Colors：solid/gradient 切换；token picker 选 token → 写入 `var(--token)`。
- Appearance：opacity slider；radius 4 角独立；shadow 拼装。
- Typography：family/weight/size/align decoration 联动。

**Theme**
- 切 dark → iframe `data-theme="dark"` 出现；切回 light → 移除。
- Theme 不入 edits 栈。

**Apply**
- Apply 按 dirty target 数量调 `onSaveDraft`；Undo 弹栈触发预览回滚。

**兼容**
- 老 bridge（无 parentId）→ 退化扁平 Outliner snapshot。

---

## 12. Phase 排期

| Phase | 内容 | 周期 |
| --- | --- | --- |
| P1 | bridge 全 DOM emit + 类型扩展 + 兼容回退 + bridge.test | 0.5d |
| P2 | useInspectorEditSession + 旧 UI 接入（行为兼容） | 1d |
| P3 | Header + SelectorChip + Outliner + Tabs（Design/Props/CSS）+ ThemeToggle | 1d |
| P4 | PositionLayoutSection + DimensionsSection + 新控件（FlowSelector / UnitNumberField / AlignmentGrid / LinkBoxField / Select / Popover） | 1.5d |
| P5 | ColorsSection（含 token picker）+ GradientStopsEditor + AppearanceSection（含 shadow） | 1.5d |
| P6 | TypographySection + PropsTab 占位 + CssTab + 键盘 / 虚拟化 / a11y | 1d |

总计 **~6.5 人日**（对比之前 11.5d，砍掉的 5d 全是 Beyond Cursor 项）。

---

## 13. 风险 & 决策

| 项 | 决策 |
| --- | --- |
| Cursor 官方文档不暴露完整字段表 | 以官方 5 分组为骨架；Typography 据博客提及保守纳入；Beyond Cursor 项明确标记，默认不开 |
| Token picker 的数据源 | host 侧解析 `tailwind.config.*` / 全局 CSS 变量，发到 inspector |
| React props 检测 | dev 模式读 `__REACT_DEVTOOLS_GLOBAL_HOOK__`；prod 兜底为不显 Props Tab |
| Theme 切换 | 仅 UI 态，不写源码；持久化到 inspector localStorage |
| `apply-html-edit` 写法 | base 走 inline `style=""`（不动现有路径）；hover/breakpoint 不做 |
| Outliner 性能 | >1000 节点用 fixed-height 虚拟化（28px） |
| 不引入外部库 | Tabs / Select / Popover / Slider 全部自建 |
| Cursor 自身 Undo 不可靠 | 我们用 edit stack 修正，行为上比 Cursor 更稳 |
| Cursor 没有 Layers | 我们提供稳定 Outliner |
| Cursor 默认 raw value 而非 token | 我们 token picker 默认优先 |

---

## 14. 验收清单

- [ ] Header 显示 `Components` + Edit 数 + Undo + Apply + ThemeToggle + 关闭。
- [ ] Selector chip 显示 `tag(#id)(.cls)*`。
- [ ] Outliner 渲染全 DOM 树，>1000 节点不卡。
- [ ] Position & Layout：position-type 影响字段 enabled；Flow 4 icon；Alignment 3×3；Gap；Grid template 在 display:grid 时显示。
- [ ] Dimensions：W/H 含单位；Padding/Margin LinkBox link/unlink。
- [ ] Colors：Solid / Gradient 切换；token picker 写入 `var(--token)`。
- [ ] Appearance：Opacity slider；Radius 4 角；Shadow 5 字段拼装。
- [ ] Typography：family/weight/size/line/letter/color/align/decoration。
- [ ] Theme 切换：iframe 切 light/dark，不入编辑栈。
- [ ] Apply 按 dirty target 数量调 `onSaveDraft`；Undo 弹栈并触发预览回滚。
- [ ] 切换节点、关闭面板都不丢草稿。
- [ ] 老 bridge / 老 srcdoc → 自动回退到扁平 Outliner。
- [ ] PropsTab：无 React fiber 时显示空态；有时只读展示 props。
- [ ] CssTab：拼接当前 draft 为 CSS 文本，Copy 可用。
- [ ] 测试：`pnpm -F web test` 全绿；新增 case ≥ 40 条覆盖 §11。

---

## 15. PR 拆分顺序

1. types + bridge 协议升级 + bridge.test
2. useInspectorEditSession + selector util + 旧 UI 接入
3. Header + SelectorChip + Outliner + Tabs + ThemeToggle
4. PositionLayoutSection + DimensionsSection + 新控件
5. ColorsSection（token picker）+ AppearanceSection
6. TypographySection + PropsTab + CssTab + 抛光

每个 PR 独立可 revert。

---

## 16. Sources

- [Cursor Docs — Browser](https://cursor.com/docs/agent/tools/browser)（**唯一权威能力清单**：Position and layout / Dimensions / Colors / Appearance / Theme testing）
- [Cursor Blog — A visual editor for the Cursor Browser](https://cursor.com/blog/browser-visual-editor)（React props 面板、token、point-and-prompt）
- [Cursor Forum — Cursor 2.2: Visual Editor](https://forum.cursor.com/t/cursor-2-2-visual-editor-for-cursor-browser/145958)
- [Builder.io — Cursor's Design Mode Explained](https://www.builder.io/blog/cursor-design-mode-visual-editing)（实测 Cursor 不支持：多选、可靠 Undo、Layers、画布拖拽；默认输出 raw values）
- [StarkInsider — Cursor's New Visual Editor](https://www.starkinsider.com/2025/12/cursor-visual-editor-ide-web-design.html)
