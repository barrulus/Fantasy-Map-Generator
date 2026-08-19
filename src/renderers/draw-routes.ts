import { select } from "d3";
import type { Route } from "@/generators/routes-generator";
import { applyRouteLineStyle, readPresetAttrs, routeGroupStyle, routeTypeStyle } from "@/renderers/route-styles";
import { ensureEl } from "@/utils";

// The route groups whose content drawRoutes owns. airroutes and traderoutes are fork additions.
const ROUTE_GROUPS = ["roads", "trails", "searoutes", "airroutes", "traderoutes"];
const GROUP_STYLE_ATTRS = ["stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "opacity", "filter", "mask"];

function applyRouteTypeStyle(el: Element, type: string): void {
  applyRouteLineStyle(el, routeTypeStyle(type), style.routes[type]);
}

export function drawRoutes(): void {
  TIME && console.time("drawRoutes");
  // routes of the same group are split by type so each type can carry its own line style
  const typedPaths: Record<string, { group: string; type: string; paths: string[] }> = {};

  for (const route of pack.routes) {
    const { i, group, points } = route;
    if (!points || points.length < 2) continue;
    const type = route.type || "";
    const key = type ? `${group}/${type}` : group;
    if (!typedPaths[key]) typedPaths[key] = { group, type, paths: [] };
    typedPaths[key].paths.push(/* html */ `<path id="route${i}" d="${Routes.getPath(route)}"/>`);
  }

  const routes = select(ensureEl<SVGGElement>("routes"));
  routes.attr("fill", "none");
  routes.selectAll(ROUTE_GROUPS.map(g => `#${g}`).join(", ")).html("");

  const styledGroups = new Set<string>();

  for (const key in typedPaths) {
    const { group, type, paths } = typedPaths[key];
    const groupEl = routes.select<SVGGElement>(`#${group}`);
    if (groupEl.empty()) continue;

    if (!styledGroups.has(group)) {
      styledGroups.add(group);
      // Read the group's own attributes first so a preset's values win over the default
      // hierarchy instead of being clobbered by it.
      const groupNode = groupEl.node()!;
      applyRouteLineStyle(groupNode, routeGroupStyle(group), readPresetAttrs(groupNode, GROUP_STYLE_ATTRS));
    }

    if (type) {
      const subGroup = groupEl.append("g").attr("id", type);
      applyRouteTypeStyle(subGroup.node()!, type);
      subGroup.html(paths.join(""));
    } else {
      groupEl.html(groupEl.html() + paths.join(""));
    }
  }

  TIME && console.timeEnd("drawRoutes");
}

/** drop the paths, keeping the route groups: they are user data carrying the group styles */
export function removeRoutes(): void {
  for (const path of Array.from(document.querySelectorAll("#routes path"))) path.remove();
}

export function drawRoute(route: Route): void {
  const groupEl = select(ensureEl<SVGGElement>("routes")).select<SVGGElement>(`#${route.group}`);
  if (groupEl.empty()) return;

  const type = route.type || "";
  if (!type) {
    groupEl.append("path").attr("d", Routes.getPath(route)).attr("id", `route${route.i}`);
    return;
  }

  let subGroup = groupEl.select<SVGGElement>(`#${type}`);
  if (subGroup.empty()) {
    subGroup = groupEl.append("g").attr("id", type);
    applyRouteTypeStyle(subGroup.node()!, type);
  }
  subGroup.append("path").attr("d", Routes.getPath(route)).attr("id", `route${route.i}`);
}
