export const EDITOR_PAGE_SIZE = 100;
export const EDITOR_PAGE_SIZE_MOBILE = 20;

// MOBILE is a bare global set by main.js after ES modules evaluate, so it must be read lazily here, never at module scope
const defaultPageSize = () => (typeof MOBILE !== "undefined" && MOBILE ? EDITOR_PAGE_SIZE_MOBILE : EDITOR_PAGE_SIZE);

export type TableView<T> = { rows: T[]; all: T[]; page: number; totalPages: number; total: number };

export type EditorTable<T> = {
  view: () => TableView<T>;
  goto: (page: number) => void;
  refresh: () => void;
  reset: () => void;
};

export function initEditorTable<T>(options: {
  getData: () => T[];
  onUpdate: (view: TableView<T>) => void;
  pageSize?: number;
}): EditorTable<T> {
  const { getData, onUpdate, pageSize } = options;
  let page = 1;
  let current: TableView<T> = { rows: [], all: [], page: 1, totalPages: 1, total: 0 };

  const refresh = () => {
    const size = pageSize ?? defaultPageSize();
    const all = getData();
    const total = all.length;
    const totalPages = Math.max(1, Math.ceil(total / size));
    page = Math.min(Math.max(1, page), totalPages);
    const start = (page - 1) * size;
    current = { rows: all.slice(start, start + size), all, page, totalPages, total };
    onUpdate(current);
  };

  return {
    view: () => current,
    goto: (p: number) => {
      page = p;
      refresh();
    },
    refresh,
    reset: () => {
      page = 1;
      refresh();
    }
  };
}

export function renderEditorPagination(
  footer: HTMLElement,
  view: { page: number; totalPages: number },
  onGoto: (page: number) => void
): void {
  let nav = footer.querySelector<HTMLElement>(":scope > .editorPagination");
  if (!nav) {
    // width:0 + min-width:100% fills fit-content dialog footers without widening them
    footer.style.display = "flex";
    footer.style.flexWrap = "wrap";
    footer.style.alignItems = "center";
    footer.style.width = "0";
    footer.style.minWidth = "100%";
    nav = document.createElement("div");
    nav.className = "editorPagination";
    nav.style.cssText = "margin-left: auto; display: inline-flex; gap: 0.3em; align-items: center;";
    footer.appendChild(nav);
  }

  const dialogId = footer.closest<HTMLElement>(".editorDialog")?.id;
  // deferred so the jQuery UI dialog() call (which runs after the first render) has finished sizing the dialog
  if (dialogId) requestAnimationFrame(() => restretchColumns(dialogId));

  if (view.totalPages <= 1) {
    nav.style.display = "none";
    nav.innerHTML = "";
    return;
  }
  nav.style.display = "inline-flex";
  nav.innerHTML = /* html */ `
    <button class="icon-left-open editorPagePrev" data-tip="Previous page" style="padding: 0 4px;" ${view.page <= 1 ? "disabled" : ""}></button>
    <span>Page&nbsp;<input class="editorPageInput" type="number" min="1" max="${view.totalPages}" value="${view.page}" style="width: 3.5em" data-tip="Jump to page" />&nbsp;of&nbsp;${view.totalPages}</span>
    <button class="icon-right-open editorPageNext" data-tip="Next page" style="padding: 0 4px;" ${view.page >= view.totalPages ? "disabled" : ""}></button>`;
  nav.querySelector<HTMLElement>(".editorPagePrev")?.addEventListener("click", () => onGoto(view.page - 1));
  nav.querySelector<HTMLElement>(".editorPageNext")?.addEventListener("click", () => onGoto(view.page + 1));
  nav.querySelector<HTMLInputElement>(".editorPageInput")?.addEventListener("change", event => {
    onGoto(Number((event.target as HTMLInputElement).value));
  });
}

export type EditorColumn = { key: string; label: string; hideable?: boolean; mobileHidden?: boolean };

const columnsStorageKey = (storageKey: string) => `columnsHidden:${storageKey}`;

export function loadHiddenColumns(storageKey: string, columns: EditorColumn[]): Set<string> {
  const hideable = new Set(columns.filter(column => column.hideable !== false).map(column => column.key));
  const stored = localStorage.getItem(columnsStorageKey(storageKey));
  if (stored === null && typeof MOBILE !== "undefined" && MOBILE) {
    const mobileDefaults = columns.filter(column => column.mobileHidden).map(column => column.key);
    return new Set(mobileDefaults.filter(key => hideable.has(key)));
  }
  let keys: unknown;
  try {
    keys = JSON.parse(stored ?? "[]");
  } catch {
    keys = [];
  }
  if (!Array.isArray(keys)) keys = [];
  return new Set((keys as string[]).filter(key => hideable.has(key)));
}

export function saveHiddenColumns(storageKey: string, hidden: Set<string>): void {
  localStorage.setItem(columnsStorageKey(storageKey), JSON.stringify(Array.from(hidden)));
}

function getEditorHeader(dialog: HTMLElement): HTMLElement | null {
  return Array.from(dialog.querySelectorAll<HTMLElement>(".header")).find(el => el.style.gridTemplateColumns) ?? null;
}

function rewriteHeaderGridColumns(header: HTMLElement, hidden: Set<string>): void {
  if (!header.dataset.gridColumns) header.dataset.gridColumns = header.style.gridTemplateColumns;
  const original = header.dataset.gridColumns as string;
  if (original.includes("(")) return;
  const tracks = original.trim().split(/\s+/);
  const children = Array.from(header.children) as HTMLElement[];
  if (tracks.length !== children.length) return;
  // hiding a header cell shifts grid auto-placement, sliding later cells into earlier tracks; drop the matching tracks too
  header.style.gridTemplateColumns = tracks.filter((_, i) => !hidden.has(children[i].dataset.col ?? "")).join(" ");
}

// scale visible columns up to fill the dialog's available width, preserving their relative proportions
function stretchRules(dialog: HTMLElement, dialogId: string, header: HTMLElement, hidden: Set<string>): string {
  // before dialog() initializes the element its width is meaningless, and rules computed from it are garbage
  if (!dialog.classList.contains("ui-dialog-content")) return "";
  const computed = getComputedStyle(header)
    .gridTemplateColumns.trim()
    .split(/\s+/)
    .map(t => Number.parseFloat(t));
  if (computed.some(Number.isNaN) || !computed.length) return "";

  // some columns (e.g. states' type/expansionism) are hidden by an unrelated toggle, not our hidden set;
  // their track still occupies grid space, so exclude it from the fill target or the scale undershoots
  const trackedChildren = Array.from(header.children).filter(
    child => !hidden.has((child as HTMLElement).dataset.col ?? "")
  );
  const actuallyVisible = trackedChildren.map(child => getComputedStyle(child).display !== "none");

  const body = dialog.querySelector<HTMLElement>(":scope > .table");
  const sampleRow = body?.querySelector<HTMLElement>(":scope > .states");
  if (!body || !sampleRow) return "";

  const scrollbarWidth = body.offsetWidth - body.clientWidth;
  const dialogStyle = getComputedStyle(dialog);
  const available =
    dialog.clientWidth -
    Number.parseFloat(dialogStyle.paddingLeft) -
    Number.parseFloat(dialogStyle.paddingRight) -
    scrollbarWidth;

  const visibleTotal = computed.reduce((sum, n, i) => sum + (actuallyVisible[i] ? n : 0), 0);
  if (!(available > visibleTotal + 0.5)) return "";

  const seen = new Map<string, number>();
  const cells: { tag: string; key: string; width: number }[] = [];
  let taggedActual = 0;
  let taggedApplied = 0;
  Array.from(sampleRow.children).forEach(child => {
    const cell = child as HTMLElement;
    const key = cell.dataset.col;
    if (!key || hidden.has(key)) return;
    const width = cell.getBoundingClientRect().width;
    if (!width) return;
    taggedActual += width;
    const signature = `${cell.tagName}:${key}`;
    if (!seen.has(signature)) {
      seen.set(signature, width);
      cells.push({ tag: cell.tagName.toLowerCase(), key, width });
    }
    taggedApplied += seen.get(signature) as number;
  });
  if (!taggedApplied) return "";

  // width rules only reach tagged cells: untagged cells, inter-cell whitespace, row padding/border and
  // the body scrollbar keep their natural size, so reserve them (plus slack) or the row overflows and wraps
  const range = document.createRange();
  range.selectNodeContents(sampleRow);
  const untouched = Math.max(0, range.getBoundingClientRect().width - taggedActual);
  const rowStyle = getComputedStyle(sampleRow);
  const rowChrome =
    sampleRow.offsetWidth -
    sampleRow.clientWidth +
    Number.parseFloat(rowStyle.paddingLeft) +
    Number.parseFloat(rowStyle.paddingRight);
  const budget = available - scrollbarWidth - rowChrome - untouched - 2;
  if (!(budget > taggedApplied + 0.5)) return "";
  const bodyScale = budget / taggedApplied;

  const headerScale = available / visibleTotal;
  header.style.gridTemplateColumns = computed.map(px => `${(px * headerScale).toFixed(2)}px`).join(" ");
  // pin the body's own box to the measured available width, otherwise widening its cells widens its
  // max-content size too, which widens the dialog, which widens "available" — an unbounded feedback loop
  const rules: string[] = [`#${dialogId} > .table {width: ${available.toFixed(2)}px}`];
  // !important so the computed width beats the template's inline width on cells like the cultures/routes name
  cells.forEach(({ tag, key, width }) => {
    rules.push(
      `#${dialogId} .states ${tag}[data-col="${key}"] {width: ${(width * bodyScale).toFixed(2)}px !important}`
    );
  });
  return rules.join("\n");
}

function applyColumnVisibility(dialogId: string, hidden: Set<string>): void {
  const dialog = document.getElementById(dialogId);
  const styleId = `${dialogId}ColumnsStyle`;
  let style = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = Array.from(hidden)
    .map(key => `#${dialogId} [data-col="${key}"] {display: none !important}`)
    .join("\n");

  const header = dialog ? getEditorHeader(dialog) : null;
  if (!dialog || !header) return;
  rewriteHeaderGridColumns(header, hidden);
  const extra = stretchRules(dialog, dialogId, header, hidden);
  if (extra) style.textContent += `\n${extra}`;
}

const dialogColumnsRegistry = new Map<string, { storageKey: string; columns: EditorColumn[] }>();

function restretchColumns(dialogId: string): void {
  const entry = dialogColumnsRegistry.get(dialogId);
  if (!entry) return;
  applyColumnVisibility(dialogId, loadHiddenColumns(entry.storageKey, entry.columns));
}

let resizeFrame = 0;
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      document.querySelectorAll<HTMLElement>(".editorDialog").forEach(dialog => {
        restretchColumns(dialog.id);
      });
    });
  });
}

function bindColumnsPicker(
  button: HTMLElement,
  options: { dialogId: string; storageKey: string; columns: EditorColumn[]; onChange: (hidden: Set<string>) => void }
): void {
  const { dialogId, storageKey, columns, onChange } = options;
  const popupId = `${dialogId}ColumnsPicker`;
  let closePopup: (() => void) | null = null;

  button.addEventListener("click", () => {
    const existing = document.getElementById(popupId);
    if (existing) {
      closePopup?.();
      return;
    }
    const hidden = loadHiddenColumns(storageKey, columns);
    const popup = document.createElement("div");
    popup.id = popupId;
    popup.style.cssText =
      "position: fixed; z-index: 100; background: var(--bg-main, #fff); border: 1px solid #999; " +
      "border-radius: 4px; padding: 0.4em 0.8em; box-shadow: 0 1px 4px rgba(0,0,0,0.3); max-height: 50vh; overflow-y: auto;";
    popup.innerHTML = columns
      .filter(column => column.hideable !== false)
      .map(
        column => /* html */ `<div><label>
          <input class="native" type="checkbox" data-key="${column.key}" ${hidden.has(column.key) ? "" : "checked"} />
          ${column.label}</label></div>`
      )
      .join("");
    popup.addEventListener("change", event => {
      const checkbox = event.target as HTMLInputElement;
      const updated = loadHiddenColumns(storageKey, columns);
      const key = checkbox.dataset.key as string;
      if (checkbox.checked) updated.delete(key);
      else updated.add(key);
      saveHiddenColumns(storageKey, updated);
      onChange(updated);
      // hiding/showing a column can reflow the fit-content dialog under the popup; re-anchor to the button
      requestAnimationFrame(() => positionPopup());
    });
    button.insertAdjacentElement("afterend", popup);
    const positionPopup = () => {
      const rect = button.getBoundingClientRect();
      const margin = 4;
      const { width: popupWidth, height: popupHeight } = popup.getBoundingClientRect();
      const fitsBelow = rect.bottom + 2 + popupHeight <= window.innerHeight - margin;
      const fitsAbove = rect.top - 2 - popupHeight >= margin;
      const top = fitsBelow || !fitsAbove ? rect.bottom + 2 : rect.top - popupHeight - 2;
      popup.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - popupHeight - margin))}px`;
      popup.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - popupWidth - margin))}px`;
    };
    positionPopup();

    closePopup = () => {
      popup.remove();
      document.removeEventListener("mousedown", close);
    };

    const close = (event: MouseEvent) => {
      if (!popup.contains(event.target as Node) && event.target !== button) {
        closePopup?.();
      }
    };
    document.addEventListener("mousedown", close);
  });
}

export function initColumnVisibility(options: {
  button: HTMLElement;
  dialogId: string;
  storageKey: string;
  columns: EditorColumn[];
}): void {
  const { button, dialogId, storageKey, columns } = options;
  dialogColumnsRegistry.set(dialogId, { storageKey, columns });
  applyColumnVisibility(dialogId, loadHiddenColumns(storageKey, columns));
  bindColumnsPicker(button, {
    dialogId,
    storageKey,
    columns,
    onChange: hidden => applyColumnVisibility(dialogId, hidden)
  });
}
