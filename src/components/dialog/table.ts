export const EDITOR_PAGE_SIZE = 100;
export const EDITOR_PAGE_SIZE_MOBILE = 25;

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

function rewriteHeaderGridColumns(dialogId: string, hidden: Set<string>): void {
  const dialog = document.getElementById(dialogId);
  const header = dialog
    ? Array.from(dialog.querySelectorAll<HTMLElement>(".header")).find(el => el.style.gridTemplateColumns)
    : null;
  if (!header) return;
  if (!header.dataset.gridColumns) header.dataset.gridColumns = header.style.gridTemplateColumns;
  const original = header.dataset.gridColumns as string;
  if (original.includes("(")) return;
  const tracks = original.trim().split(/\s+/);
  const children = Array.from(header.children) as HTMLElement[];
  if (tracks.length !== children.length) return;
  // hiding a header cell shifts grid auto-placement, sliding later cells into earlier tracks; drop the matching tracks too
  header.style.gridTemplateColumns = tracks.filter((_, i) => !hidden.has(children[i].dataset.col ?? "")).join(" ");
}

function applyColumnVisibility(dialogId: string, hidden: Set<string>): void {
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
  rewriteHeaderGridColumns(dialogId, hidden);
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
  applyColumnVisibility(dialogId, loadHiddenColumns(storageKey, columns));
  bindColumnsPicker(button, {
    dialogId,
    storageKey,
    columns,
    onChange: hidden => applyColumnVisibility(dialogId, hidden)
  });
}
