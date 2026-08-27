import { pointer } from "d3";
import { closeDialogs, refreshEditors } from "@/components/dialog/dialog-helpers";
import { Layers } from "@/components/layers";
import { stopMapPlacement, toggleMapPlacement } from "@/components/map-placement";
import { tip } from "@/components/tooltips";
import { redrawEmblem } from "@/renderers/draw-emblems";

function toggle(): void {
  if (isActive()) {
    stop();
    return;
  }

  closeDialogs(".stable");
  toggleMapPlacement(
    "addBurgTool",
    addOnClick,
    "Click on the map to create a new burg. Hold Shift to add multiple",
    "warn",
    unpressProxyButton
  );
  document.getElementById("addNewBurg")?.classList.add("pressed");

  Layers.show("burgIcons", "labels");
}

function addOnClick(event: MouseEvent): void {
  const point = pointer(event, event.currentTarget as SVGGElement);
  const cell = findCell(point[0], point[1]);
  if (cell === undefined) return;

  if (pack.cells.h[cell] < 20) {
    tip("You cannot place a burg in the water. Please click on a land cell", false, "error");
    return;
  }
  // Fork: multiple burgs may share a cell (megalopolis slots) — no occupied-cell rejection.

  const burgId = Burgs.add(point);
  redrawEmblem("burg", burgId);
  refreshEditors();
  Layers.draw("burgIcons", "labels", "routes");

  if (!event.shiftKey) stop();
}

function toggleSky(): void {
  if (isActive()) {
    stop();
    return;
  }

  closeDialogs(".stable");
  toggleMapPlacement(
    "addBurgTool",
    addSkyOnClick,
    "Click anywhere on the map to create a flying sky-city. Hold Shift to add multiple",
    "warn",
    unpressSkyProxyButton
  );
  document.getElementById("addNewSkyBurg")?.classList.add("pressed");

  Layers.show("burgIcons", "labels");
}

function addSkyOnClick(event: MouseEvent): void {
  const point = pointer(event, event.currentTarget as SVGGElement);
  Burgs.add(point as [number, number], { flying: true } as any);
  refreshEditors();

  if (!event.shiftKey) stop();
}

function unpressSkyProxyButton(): void {
  document.getElementById("addNewSkyBurg")?.classList.remove("pressed");
}

function stop(): void {
  if (isActive()) stopMapPlacement();
  else unpressProxyButton();
}

function isActive(): boolean {
  return document.getElementById("addBurgTool")?.classList.contains("pressed") ?? false;
}

function unpressProxyButton(): void {
  document.getElementById("addNewBurg")?.classList.remove("pressed");
}

export const BurgCreator = { toggle, toggleSky, stop };
