# QGIS Styles for Fantasy Map GeoJSON

This folder contains ready-to-use QGIS (.qml) styles that match the Fantasy Map Generator exports.

How to use
- Import each GeoJSON into QGIS (GeoJSON is now WGS84 / EPSG:4326).
- Right‑click the layer → Properties → Symbology → Style → Load Style… → pick the matching .qml from `qgis/styles`.
- If you also load the ASCII Grid height raster (.asc), it is in a local engineering CRS (meters). Set the Project CRS to a suitable projected CRS for measurements, or reproject the raster as needed.

Included styles
- cells.qml: Graduated fill by `height` (water → mountains).
- rivers.qml: Blue lines, width driven by `width` attribute.
- routes.qml: Rule-based by `type`/`group` (sea routes dashed blue; roads brown; trails dashed, etc.).
- markers.qml: Simple point symbols, categorized by `type` where present.
- burgs.qml: Rule-based (capitals, ports, fortified, towns).
- regiments.qml: Square markers with label = `totalUnits`.
- states.qml: Polygon fill color from `color` attribute, labeled with `name`.
- provinces.qml: Polygon fill color from `color`, labeled with `name`.
- cultures.qml: Polygon fill color from `color`, labeled with `name`.
- religions.qml: Polygon fill color from `color`, labeled with `name`.
- zones.qml: Polygon fill color from `color`, labeled with `description`.

Notes
- Color fields for polygons use data-defined overrides; make sure your exported GeoJSON includes a `color` property (added by the new exporters).
- You can tweak line widths and colors per project scale.
- For cells, you can switch to a categorized style by `biome` if you prefer; this style uses elevation for a generic land scheme.
 - For `markers.qml` font icons: ensure an emoji-capable font is installed and available to QGIS (e.g., `Noto Color Emoji` on Linux, `Segoe UI Emoji` on Windows, `Apple Color Emoji` on macOS). The style binds the Font Marker’s character directly to the `icon` attribute; the `icon` field should contain the desired glyph (e.g., 🏰, ⛏️). Some QGIS/Qt builds may render emoji as monochrome.
