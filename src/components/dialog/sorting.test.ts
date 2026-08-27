// @ts-expect-error jsdom does not bundle TypeScript declarations
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySortingByHeader, bindColumnSorting, sortData, sortDataByColumns } from "./sorting";
import { dialogState } from "./state";

const rows = () => [
  { name: "Bree", pop: 300 },
  { name: "Anor", pop: 1000 },
  { name: "Cair", pop: 50 }
];

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => dialogState.clear());

describe("sortData", () => {
  it("sorts alphabetically ascending and descending", () => {
    const accessors = { name: (r: { name: string }) => r.name };
    expect(sortData(rows(), { sortBy: "name", alphabetically: true, direction: 1 }, accessors).map(r => r.name)) //
      .toEqual(["Anor", "Bree", "Cair"]);
    expect(sortData(rows(), { sortBy: "name", alphabetically: true, direction: -1 }, accessors).map(r => r.name)) //
      .toEqual(["Cair", "Bree", "Anor"]);
  });

  it("sorts numerically", () => {
    const accessors = { pop: (r: { pop: number }) => r.pop };
    expect(sortData(rows(), { sortBy: "pop", alphabetically: false, direction: 1 }, accessors).map(r => r.pop)) //
      .toEqual([50, 300, 1000]);
  });

  it("returns data untouched for an unknown sort key", () => {
    const data = rows();
    expect(sortData(data, { sortBy: "nope", alphabetically: true, direction: 1 }, {})).toBe(data);
  });
});

describe("sorting state", () => {
  it("restores column sorting when a controller header is rebuilt", () => {
    const dom = new JSDOM(`<div id="peopleHeader">
      <div class="sortable alphabetically" data-sortby="name"></div>
      <div class="sortable icon-sort-number-down" data-sortby="pop"></div>
    </div>`);
    vi.stubGlobal("document", dom.window.document);

    bindColumnSorting("people", () => {});
    dom.window.document.querySelector<HTMLElement>('[data-sortby="name"]')!.click();

    dom.window.document.body.innerHTML = `<div id="peopleHeader">
      <div class="sortable alphabetically" data-sortby="name"></div>
      <div class="sortable icon-sort-number-down" data-sortby="pop"></div>
    </div>`;
    bindColumnSorting("people", () => {});

    expect(dom.window.document.querySelector('[data-sortby="name"]')!.classList.contains("icon-sort-name-up")).toBe(
      true
    );
    expect(dom.window.document.querySelector('[data-sortby="pop"]')!.className.includes("icon-sort")).toBe(false);
  });

  it("restores sorting for legacy DOM-sorted tables", () => {
    const dom = new JSDOM(`<div id="legacyHeader">
      <div class="sortable alphabetically" data-sortby="name"></div>
      <div class="sortable icon-sort-number-up" data-sortby="pop"></div>
    </div><div><div data-name="Bree" data-pop="300"></div><div data-name="Anor" data-pop="1000"></div></div>`);
    vi.stubGlobal("document", dom.window.document);

    applySortingByHeader("legacy", "legacyHeader");
    dom.window.document.querySelector<HTMLElement>('[data-sortby="name"]')!.click();

    dom.window.document.body.innerHTML = `<div id="legacyHeader">
      <div class="sortable alphabetically" data-sortby="name"></div>
      <div class="sortable icon-sort-number-up" data-sortby="pop"></div>
    </div><div id="legacyBody"><div data-name="Bree" data-pop="300"></div><div data-name="Anor" data-pop="1000"></div></div>`;
    applySortingByHeader("legacy", "legacyHeader");

    expect(dom.window.document.querySelector('[data-sortby="name"]')!.classList.contains("icon-sort-name-up")).toBe(
      true
    );
    expect(
      Array.from(dom.window.document.querySelectorAll("#legacyBody > div")).map(
        row => (row as HTMLElement).dataset.name
      )
    ).toEqual(["Anor", "Bree"]);
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
