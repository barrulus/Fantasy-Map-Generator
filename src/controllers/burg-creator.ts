import { pointer } from "d3";
import { closeDialogs, refreshEditors } from "@/components/dialog/dialog-helpers";
import { Layers } from "@/components/layers";
import { stopMapPlacement, toggleMapPlacement } from "@/components/map-placement";
import { tip } from "@/components/tooltips";
import { redrawEmblem } from "@/renderers/draw-emblems";
import { errorText } from "@/utils/stringUtils";

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
  let burgId: number;
  try {
    burgId = Burgs.add(...point);
  } catch (error) {
    tip(errorText(error), false, "error");
    return;
  }
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
  const burgId = Burgs.add(...point, { flying: true });
  redrawEmblem("burg", burgId);
  Layers.draw("burgIcons", "labels", "routes");
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
