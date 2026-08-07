import { describe, expect, it, vi } from "vitest";
import { bindColumnSorting, sortData, sortDataByColumns, toggleSortIcon } from "./sorting";

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

const header = (html: string) => {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
};

describe("toggleSortIcon", () => {
  it("sorts a fresh alphabetical column ascending", () => {
    const headers = header(`<div class="sortable alphabetically" data-sortby="name"></div>`);
    const cell = headers.firstElementChild as HTMLElement;
    toggleSortIcon(cell);
    expect(cell.className).toContain("icon-sort-name-up");
  });

  it("flips direction on a second click", () => {
    const headers = header(`<div class="sortable" data-sortby="pop"></div>`);
    const cell = headers.firstElementChild as HTMLElement;
    toggleSortIcon(cell);
    toggleSortIcon(cell);
    expect(cell.className).toContain("icon-sort-number-up");
    expect(cell.className).not.toContain("icon-sort-number-down");
  });

  it("clears the icon from the previously sorted column", () => {
    const headers = header(
      `<div class="sortable icon-sort-number-down" data-sortby="pop"></div><div class="sortable" data-sortby="area"></div>`
    );
    toggleSortIcon(headers.children[1] as HTMLElement);
    expect(headers.children[0].className).not.toContain("icon-sort");
  });
});

describe("bindColumnSorting", () => {
  it("fires the callback when a sortable header is clicked", () => {
    const headers = header(`<div class="sortable" data-sortby="pop"></div><div data-col="actions"></div>`);
    const onSort = vi.fn();
    bindColumnSorting(headers, onSort);
    (headers.firstElementChild as HTMLElement).click();
    expect(onSort).toHaveBeenCalledTimes(1);
    expect((headers.firstElementChild as HTMLElement).className).toContain("icon-sort");
  });

  it("ignores clicks on non-sortable cells", () => {
    const headers = header(`<div class="sortable" data-sortby="pop"></div><div data-col="actions"></div>`);
    const onSort = vi.fn();
    bindColumnSorting(headers, onSort);
    (headers.children[1] as HTMLElement).click();
    expect(onSort).not.toHaveBeenCalled();
  });
});

describe("sortDataByColumns", () => {
  const columns = [
    { key: "name", label: "Name", width: "8em", sortBy: (r: { name: string }) => r.name, sortType: "alpha" as const },
    { key: "pop", label: "Pop", width: "5em", sortBy: (r: { pop: number }) => r.pop }
  ];

  it("sorts by the active header using that column's accessor", () => {
    const headers = header(`<div class="sortable icon-sort-number-up" data-sortby="pop"></div>`);
    const data = [
      { name: "Bree", pop: 300 },
      { name: "Anor", pop: 50 }
    ];
    expect(sortDataByColumns(headers, data, columns).map(r => r.pop)).toEqual([50, 300]);
  });

  it("returns data untouched when no column is sorted", () => {
    const headers = header(`<div class="sortable" data-sortby="pop"></div>`);
    const data = [{ name: "Bree", pop: 300 }];
    expect(sortDataByColumns(headers, data, columns)).toBe(data);
  });
});
