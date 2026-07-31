// Editor table pagination + data-driven sorting — fork addition (upstream PR #1469).
// Consumed as window globals by cultures/religions/states/rivers/routes editors.
// Ported from public/modules/ui/editors.js (pre-1.139.7 upstream sync).

const EDITOR_PAGE_SIZE = 200;

// Read the active sort column from a header element, or null if none is active.
// Mirrors how applySorting reads the icon-sort-* class set by sortLines.
function getActiveSort(headers: HTMLElement | null) {
  if (!headers) return null;
  const header = headers.querySelector("div[class*='icon-sort']") as HTMLElement | null;
  if (!header) return null;
  return {
    sortby: header.dataset.sortby as string,
    name: header.classList.contains("alphabetically"),
    desc: header.className.includes("-down") ? -1 : 1
  };
}

// Sort `data` IN PLACE to match the header's active column.
// `accessors` maps a data-sortby key to a value getter, e.g. {name: s => s.name}.
export function sortDataByActiveHeader<T>(
  headers: HTMLElement | null,
  data: T[],
  accessors: Record<string, (item: T) => unknown>
): T[] {
  const sort = getActiveSort(headers);
  if (!sort) return data;
  const get = accessors[sort.sortby];
  if (!get) return data;
  return data.sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (sort.name) {
      const as = String(av);
      const bs = String(bv);
      return (as > bs ? 1 : as < bs ? -1 : 0) * sort.desc;
    }
    return ((av as number) - (bv as number)) * sort.desc;
  });
}

// Clamp the page and return the slice for the current page.
// `pageRef` is a mutable {page} holder so the clamped value persists across calls.
export function getEditorPage<T>(
  data: T[],
  pageRef: { page: number },
  size: number = EDITOR_PAGE_SIZE
): { items: T[]; page: number; totalPages: number; total: number } {
  const total = data.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  pageRef.page = Math.min(Math.max(1, pageRef.page || 1), totalPages);
  const start = (pageRef.page - 1) * size;
  return { items: data.slice(start, start + size), page: pageRef.page, totalPages, total };
}

// Inject/refresh pagination controls inside `footerEl`. Calls onGoto(page) on navigation.
// Hidden when there is a single page. Rebuilding innerHTML drops stale listeners.
export function renderEditorPagination(
  footerEl: HTMLElement | null,
  info: { page: number; totalPages: number },
  onGoto: (page: number) => void
): void {
  if (!footerEl) return;
  let nav = footerEl.querySelector(":scope > .editorPagination") as HTMLElement | null;
  if (!nav) {
    // The editor dialogs are sized with fit-content (max-content of their children). If the footer
    // were allowed to grow with the pager it would become the widest child for narrow tables
    // (e.g. Rivers) and stretch the whole dialog, leaving an empty gutter beside the rows.
    // width:0 + min-width:100% makes the footer fill the table-driven width WITHOUT contributing
    // to it; flex-wrap lets the pager drop to its own line instead of widening the dialog.
    footerEl.style.display = "flex";
    footerEl.style.flexWrap = "wrap";
    footerEl.style.alignItems = "center";
    footerEl.style.width = "0";
    footerEl.style.minWidth = "100%";
    nav = document.createElement("div");
    nav.className = "editorPagination";
    nav.style.cssText = "margin-left: auto; display: inline-flex; gap: 0.3em; align-items: center;";
    footerEl.appendChild(nav);
  }
  if (info.totalPages <= 1) {
    nav.style.display = "none";
    nav.innerHTML = "";
    return;
  }
  nav.style.display = "inline-flex";
  nav.innerHTML = /* html */ `
    <button class="icon-left-open editorPagePrev" data-tip="Previous page" style="padding: 0 4px;" ${info.page <= 1 ? "disabled" : ""}></button>
    <span>Page&nbsp;<input class="editorPageInput" type="number" min="1" max="${info.totalPages}" value="${info.page}" style="width: 3.5em" data-tip="Jump to page" />&nbsp;of&nbsp;${info.totalPages}</span>
    <button class="icon-right-open editorPageNext" data-tip="Next page" style="padding: 0 4px;" ${info.page >= info.totalPages ? "disabled" : ""}></button>`;
  (nav.querySelector(".editorPagePrev") as any).on("click", () => onGoto(info.page - 1));
  (nav.querySelector(".editorPageNext") as any).on("click", () => onGoto(info.page + 1));
  (nav.querySelector(".editorPageInput") as any).on("change", (e: Event) =>
    onGoto(+(e.target as HTMLInputElement).value)
  );
}

// Bind sort-header clicks to reset to page 1 and re-render.
// Register AFTER sortLines is bound so the icon-sort-* class is toggled first.
export function bindEditorSortReset(headerEl: HTMLElement | null, onSort: () => void): void {
  if (!headerEl) return;
  headerEl.querySelectorAll(".sortable").forEach(el => (el as any).on("click", () => onSort()));
}

window.sortDataByActiveHeader = sortDataByActiveHeader;
window.getEditorPage = getEditorPage;
window.renderEditorPagination = renderEditorPagination;
window.bindEditorSortReset = bindEditorSortReset;
