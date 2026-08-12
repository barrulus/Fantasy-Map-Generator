import { afterEach, describe, expect, it, vi } from "vitest";
import { bindColumnSorting, sortData, sortDataByColumns } from "./sorting";

const rows = () => [
  { name: "Bree", pop: 300 },
  { name: "Anor", pop: 1000 },
  { name: "Cair", pop: 50 }
];

describe("sortData", () => {
  it("sorts alphabetically ascending and descending", () => {
    const accessors = { name: (r: { name: string }) => r.name };
    expect(sortData(rows(), { sortby: "name", alphabetically: true, direction: 1 }, accessors).map(r => r.name)) //
      .toEqual(["Anor", "Bree", "Cair"]);
    expect(sortData(rows(), { sortby: "name", alphabetically: true, direction: -1 }, accessors).map(r => r.name)) //
      .toEqual(["Cair", "Bree", "Anor"]);
  });

  it("sorts numerically", () => {
    const accessors = { pop: (r: { pop: number }) => r.pop };
    expect(sortData(rows(), { sortby: "pop", alphabetically: false, direction: 1 }, accessors).map(r => r.pop)) //
      .toEqual([50, 300, 1000]);
  });

  it("returns data untouched for an unknown sort key", () => {
    const data = rows();
    expect(sortData(data, { sortby: "nope", alphabetically: true, direction: 1 }, {})).toBe(data);
  });
});

// the sorting helpers resolve the header off the dialog id, so it has to be in the document
let mounted = 0;
const mountHeader = (html: string) => {
  const dialogId = `testDialog${++mounted}`;
  const el = document.createElement("div");
  el.id = `${dialogId}Header`;
  el.innerHTML = html;
  document.body.append(el);
  return { dialogId, el };
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("sort icon toggling", () => {
  it("sorts a fresh alphabetical column ascending", () => {
    const { dialogId, el } = mountHeader(`<div class="sortable alphabetically" data-sortby="name"></div>`);
    bindColumnSorting(dialogId, () => {});
    const cell = el.firstElementChild as HTMLElement;
    cell.click();
    expect(cell.className).toContain("icon-sort-name-up");
  });

  it("flips direction on a second click", () => {
    const { dialogId, el } = mountHeader(`<div class="sortable" data-sortby="pop"></div>`);
    bindColumnSorting(dialogId, () => {});
    const cell = el.firstElementChild as HTMLElement;
    cell.click();
    cell.click();
    expect(cell.className).toContain("icon-sort-number-up");
    expect(cell.className).not.toContain("icon-sort-number-down");
  });

  it("clears the icon from the previously sorted column", () => {
    const { dialogId, el } = mountHeader(
      `<div class="sortable icon-sort-number-down" data-sortby="pop"></div><div class="sortable" data-sortby="area"></div>`
    );
    bindColumnSorting(dialogId, () => {});
    (el.children[1] as HTMLElement).click();
    expect(el.children[0].className).not.toContain("icon-sort");
  });
});

describe("bindColumnSorting", () => {
  it("fires the callback when a sortable header is clicked", () => {
    const { dialogId, el } = mountHeader(
      `<div class="sortable" data-sortby="pop"></div><div data-col="actions"></div>`
    );
    const onSort = vi.fn();
    bindColumnSorting(dialogId, onSort);
    (el.firstElementChild as HTMLElement).click();
    expect(onSort).toHaveBeenCalledTimes(1);
    expect((el.firstElementChild as HTMLElement).className).toContain("icon-sort");
  });

  it("ignores clicks on non-sortable cells", () => {
    const { dialogId, el } = mountHeader(
      `<div class="sortable" data-sortby="pop"></div><div data-col="actions"></div>`
    );
    const onSort = vi.fn();
    bindColumnSorting(dialogId, onSort);
    (el.children[1] as HTMLElement).click();
    expect(onSort).not.toHaveBeenCalled();
  });
});

describe("sortDataByColumns", () => {
  const columns = [
    { key: "name", label: "Name", width: "8em", sortBy: (r: { name: string }) => r.name, sortType: "alpha" as const },
    { key: "pop", label: "Pop", width: "5em", sortBy: (r: { pop: number }) => r.pop }
  ];

  it("sorts by the active header using that column's accessor", () => {
    const { dialogId } = mountHeader(`<div class="sortable icon-sort-number-up" data-sortby="pop"></div>`);
    const data = [
      { name: "Bree", pop: 300 },
      { name: "Anor", pop: 50 }
    ];
    expect(sortDataByColumns(dialogId, data, columns).map(r => r.pop)).toEqual([50, 300]);
  });

  it("returns data untouched when no column is sorted", () => {
    const { dialogId } = mountHeader(`<div class="sortable" data-sortby="pop"></div>`);
    const data = [{ name: "Bree", pop: 300 }];
    expect(sortDataByColumns(dialogId, data, columns)).toBe(data);
  });
});
