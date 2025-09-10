# FMG Terrain Implementation - Detailed Task List

## Project Overview
**Status**: Ready for implementation  
**Estimated Timeline**: 6 weeks  
**Priority**: High Impact - Major improvement to map realism

---

## Phase 1: Core Infrastructure (Week 1)
**Goal**: Establish foundational terrain data structures and surface calculations

### 1.1 Data Structure Setup
- [ ] **T1.1.1** Add terrain data arrays to pack.cells object
  - [ ] Add `pack.cells.terrain = new Uint8Array(n)`
  - [ ] Add `pack.cells.terrainSubtype = new Uint8Array(n)` 
  - [ ] Add `pack.cells.terrainBase = new Uint8Array(n)`
  - [ ] Add `pack.cells.cultivatedIntensity = new Uint8Array(n)`
  - [ ] Add `pack.cells.cultivatedBy = new Int16Array(n)`

- [ ] **T1.1.2** Add derived surface arrays to pack.cells
  - [ ] Add `pack.cells.slope = new Float32Array(n)`
  - [ ] Add `pack.cells.ruggedness = new Float32Array(n)`
  - [ ] Add `pack.cells.hydricIndex = new Float32Array(n)`
  - [ ] Add `pack.cells.distToRiver = new Float32Array(n)`
  - [ ] Add `pack.cells.distToCoast = new Float32Array(n)`
  - [ ] Add `pack.cells.floodplainIndex = new Float32Array(n)`

### 1.2 Environmental Surfaces Module
- [ ] **T1.2.1** Create `modules/env-surfaces.js`
  - [ ] Create EnvironmentalSurfaces class structure
  - [ ] Add module imports and dependencies
  - [ ] Set up error handling and validation

- [ ] **T1.2.2** Implement slope calculation
  - [ ] Write `computeSlope(cells)` method
  - [ ] Calculate slope from height differences with neighbors
  - [ ] Handle edge cases and boundary conditions
  - [ ] Add performance timing instrumentation

- [ ] **T1.2.3** Implement ruggedness calculation
  - [ ] Write `computeRuggedness(cells)` method
  - [ ] Implement Terrain Ruggedness Index (TRI)
  - [ ] Optimize for performance with neighbor averaging

- [ ] **T1.2.4** Implement hydric index calculation
  - [ ] Write `computeHydricIndex(cells)` method
  - [ ] Combine moisture + flatness + water proximity
  - [ ] Weight factors appropriately for wetland detection

- [ ] **T1.2.5** Implement floodplain detection
  - [ ] Write `computeFloodplain(cells, rivers)` method
  - [ ] Use river order data if available
  - [ ] Factor in low slope areas near rivers
  - [ ] Handle river network traversal

- [ ] **T1.2.6** Implement aridity calculation
  - [ ] Write `computeAridity(cells, moisture, windward)` method
  - [ ] Add rain shadow effects calculation
  - [ ] Handle cases where windward data unavailable

### 1.3 Terrain Constants and Types
- [ ] **T1.3.1** Define terrain type constants
  - [ ] Create TERRAIN_TYPES object with all classifications
  - [ ] Add water bodies (ocean, coast, lake)
  - [ ] Add orography (glacier, mountains, highlands, hills, plains)
  - [ ] Add vegetation/climate types
  - [ ] Add wetlands and surface forms
  - [ ] Add human land-use (cultivated)

- [ ] **T1.3.2** Create terrain type utilities
  - [ ] Add terrain type validation functions
  - [ ] Add terrain type conversion utilities
  - [ ] Create terrain hierarchy/priority system

### 1.4 Core Module Creation
- [ ] **T1.4.1** Create `modules/terrain-generator.js`
  - [ ] Set up main TerrainGenerator class
  - [ ] Add initialization and configuration methods
  - [ ] Create public API interface
  - [ ] Add integration hooks for existing pipeline

- [ ] **T1.4.2** Integration point setup
  - [ ] Identify insertion point in generation pipeline (after burgs, before routes)
  - [ ] Add terrain generation call to main workflow
  - [ ] Ensure proper data dependencies are met

---

## Phase 2: Classification System (Week 2)
**Goal**: Implement comprehensive terrain classification with priority rules

### 2.1 Base Terrain Classifier
- [ ] **T2.1.1** Create classification priority system
  - [ ] Implement water bodies (highest priority)
  - [ ] Add glaciers/ice classification
  - [ ] Add volcanic/barren rock detection
  - [ ] Set up classification order enforcement

- [ ] **T2.1.2** Implement orography detection
  - [ ] Add mountain detection (slope + elevation thresholds)
  - [ ] Add highland classification (moderate elevation)
  - [ ] Add hills detection (moderate slope, lower elevation)
  - [ ] Add plains classification (low slope, low elevation)

- [ ] **T2.1.3** Implement wetland detection
  - [ ] Use hydric index for wetland identification
  - [ ] Add proximity to water bodies check
  - [ ] Implement wetland subtypes (swamp, marsh, bog)
  - [ ] Add delta/floodplain special case handling

### 2.2 Vegetation Classification
- [ ] **T2.2.1** Climate-based vegetation mapping
  - [ ] Map temperature + moisture to biome types
  - [ ] Add desert classification (hot + dry)
  - [ ] Add cold desert classification (cold + dry)
  - [ ] Add steppe/grassland (moderate conditions)

- [ ] **T2.2.2** Forest type classification
  - [ ] Add broadleaf forest (warm + wet)
  - [ ] Add conifer forest (cold/temperate)
  - [ ] Add rainforest (very warm + very wet)
  - [ ] Add savanna (warm + seasonal moisture)

### 2.3 Special Surface Forms
- [ ] **T2.3.1** Implement special terrain detection
  - [ ] Add dunes detection (desert + wind patterns if available)
  - [ ] Add bare rock detection (high slope + low vegetation)
  - [ ] Add volcanic terrain detection
  - [ ] Add salt flat detection (very dry + flat + no drainage)

### 2.4 Classification Pipeline
- [ ] **T2.4.1** Create main classification method
  - [ ] Implement priority-based classification algorithm
  - [ ] Add conflict resolution for overlapping conditions
  - [ ] Ensure single terrain type per cell
  - [ ] Add validation and error handling

- [ ] **T2.4.2** Add smoothing and post-processing
  - [ ] Implement neighbor-based smoothing passes
  - [ ] Add noise reduction for isolated pixels
  - [ ] Preserve important terrain boundaries
  - [ ] Add configurable smoothing intensity

---

## Phase 3: Farmland System (Week 3)
**Goal**: Implement historically-accurate farmland allocation system

### 3.1 Farmland Allocator Module
- [ ] **T3.1.1** Create `modules/farmland-allocator.js`
  - [ ] Set up FarmlandAllocator class structure
  - [ ] Add medieval agricultural constants and parameters
  - [ ] Create burg demand calculation system

- [ ] **T3.1.2** Implement burg demand calculation
  - [ ] Calculate population-based food needs (250 kg/year per capita)
  - [ ] Add 20% surplus buffer for bad years
  - [ ] Factor in import capabilities for ports vs inland towns
  - [ ] Convert food needs to required farmland area

- [ ] **T3.1.3** Implement yield calculation system
  - [ ] Create base yield by biome type
  - [ ] Add moisture bonus/penalty factors
  - [ ] Add slope penalty (max farming slope limit)
  - [ ] Add elevation penalty for high altitude
  - [ ] Add floodplain fertility bonus

### 3.2 Suitability Assessment
- [ ] **T3.2.1** Create farmland suitability scoring
  - [ ] Check terrain type compatibility
  - [ ] Apply slope limitations (default max 12°)
  - [ ] Check moisture requirements
  - [ ] Factor in distance from settlement

- [ ] **T3.2.2** Implement exclusion rules
  - [ ] Exclude water bodies, glaciers, mountains
  - [ ] Exclude wetlands (except with drainage)
  - [ ] Exclude very steep terrain
  - [ ] Exclude existing urban areas

### 3.3 Multi-Source Region Growing
- [ ] **T3.3.1** Implement priority queue system
  - [ ] Create efficient priority queue for expansion
  - [ ] Initialize seeds from all burgs simultaneously
  - [ ] Track remaining area demands per burg

- [ ] **T3.3.2** Implement expansion algorithm
  - [ ] Expand from most suitable neighboring cells first
  - [ ] Handle distance costs (transport economics)
  - [ ] Resolve conflicts when multiple burgs compete
  - [ ] Stop expansion when demands met or no suitable cells

- [ ] **T3.3.3** Add allocation tracking
  - [ ] Track which burg "owns" each cultivated cell
  - [ ] Calculate cultivation intensity based on suitability
  - [ ] Store original terrain type for toggle functionality

### 3.4 Settlement Pattern Implementation
- [ ] **T3.4.1** Add settlement-size based patterns
  - [ ] Hamlet pattern (radius 2km, intensity 0.6)
  - [ ] Village pattern (radius 3km, intensity 0.7)  
  - [ ] Small town pattern (radius 6km, intensity 0.8)
  - [ ] Market town pattern (radius 10km, intensity 0.85)
  - [ ] City pattern (radius 15km, intensity 0.9)

- [ ] **T3.4.2** Implement distance-based intensity
  - [ ] Higher intensity near settlements
  - [ ] Gradual falloff with distance
  - [ ] Account for transport costs in medieval period

---

## Phase 4: Route Integration (Week 4)
**Goal**: Integrate terrain data with route generation system

### 4.1 Route Cost Modification
- [ ] **T4.1.1** Modify `modules/routes-generator.js`
  - [ ] Locate existing cost calculation functions
  - [ ] Add terrain-based cost modifiers to buildRouteCostCache()
  - [ ] Preserve existing elevation and river crossing costs

- [ ] **T4.1.2** Implement terrain-specific costs
  - [ ] Mountains: 3.0x cost multiplier
  - [ ] Wetlands: 2.5x cost multiplier  
  - [ ] Forests: 1.8x cost multiplier
  - [ ] Dunes: 2.2x cost multiplier
  - [ ] Plains/Grassland: 0.9x cost multiplier
  - [ ] Cultivated land: variable based on intensity

### 4.2 Agricultural Road Networks
- [ ] **T4.2.1** Add farmland path preferences
  - [ ] Slightly prefer routes between fields vs through intensive farms
  - [ ] Add field boundary following logic
  - [ ] Ensure roads connect settlements to their farmlands

- [ ] **T4.2.2** Test route integration
  - [ ] Generate test maps with farmland
  - [ ] Verify routes avoid intensive agricultural areas when possible
  - [ ] Check that trade routes still function correctly
  - [ ] Validate performance impact is acceptable

### 4.3 Slope Integration
- [ ] **T4.3.1** Add slope-based cost modifiers
  - [ ] Integrate slope data into route costs
  - [ ] Use formula: cost *= (1 + slope/10)
  - [ ] Ensure consistency with existing elevation costs

---

## Phase 5: Rendering & UI (Week 5)
**Goal**: Create visual representation and user controls

### 5.1 Rendering System
- [ ] **T5.1.1** Create terrain rendering layer
  - [ ] Set up proper z-order (water → wetlands → farmland → vegetation → elevation → mountains)
  - [ ] Create SVG layer structure for terrain
  - [ ] Add toggle functionality for terrain visibility

- [ ] **T5.1.2** Implement terrain styles
  - [ ] Create base color scheme for each terrain type
  - [ ] Add texture patterns for mountains, wetlands, etc.
  - [ ] Implement farmland patterns (strip fields, open fields, pastures)
  - [ ] Add opacity controls based on intensity values

### 5.2 Pattern Generation
- [ ] **T5.2.1** Create SVG pattern definitions
  - [ ] Design strip field pattern for intensive agriculture
  - [ ] Design open field pattern for extensive agriculture
  - [ ] Design pasture pattern for livestock areas
  - [ ] Create wetland stipple pattern

- [ ] **T5.2.2** Implement pattern assignment logic
  - [ ] Assign patterns based on distance from settlements
  - [ ] Close fields: strip pattern
  - [ ] Middle distance: open field pattern
  - [ ] Far fields: pasture pattern

### 5.3 UI Controls
- [ ] **T5.3.1** Create terrain configuration panel
  - [ ] Add sliders for classification thresholds
  - [ ] Mountain slope threshold (default 25°)
  - [ ] Hill slope threshold (default 10°)  
  - [ ] Wetland threshold (default 0.6)
  - [ ] Maximum farming slope (default 12°)

- [ ] **T5.3.2** Add farmland controls
  - [ ] Farmland generation enable/disable checkbox
  - [ ] Yield multiplier slider (0.5-2.0x)
  - [ ] Fallow ratio slider (0-50%, default 33%)
  - [ ] Import factor slider (0-50%, default 10%)

- [ ] **T5.3.3** Add visual controls
  - [ ] Terrain texture toggle
  - [ ] Terrain opacity slider (30-100%)
  - [ ] Smoothing passes slider (0-3)
  - [ ] Show farmland intensity toggle

### 5.4 Integration with Existing UI
- [ ] **T5.4.1** Add terrain panel to interface
  - [ ] Integrate with existing style/options panels
  - [ ] Add terrain menu item
  - [ ] Ensure consistent styling with existing UI

- [ ] **T5.4.2** Add terrain legend
  - [ ] Create legend showing terrain types and colors
  - [ ] Add farmland intensity scale
  - [ ] Make legend toggleable

---

## Phase 6: Testing & Optimization (Week 6)
**Goal**: Ensure quality, performance, and reliability

### 6.1 Performance Optimization
- [ ] **T6.1.1** Implement surface calculation caching
  - [ ] Cache slope, hydric, and ruggedness calculations
  - [ ] Add cache invalidation on relevant data changes
  - [ ] Measure performance improvements

- [ ] **T6.1.2** Memory optimization
  - [ ] Use typed arrays consistently (Uint8Array, Float32Array)
  - [ ] Minimize object allocations in hot paths
  - [ ] Profile memory usage and optimize large allocations

- [ ] **T6.1.3** Web Worker implementation (optional)
  - [ ] Move terrain classification to web worker
  - [ ] Implement progress reporting for long operations
  - [ ] Add fallback for non-worker environments

### 6.2 Testing Implementation
- [ ] **T6.2.1** Create unit tests
  - [ ] Test terrain classification edge cases
  - [ ] Test farmland allocation with various burg configurations
  - [ ] Test suitability calculations
  - [ ] Test surface calculations accuracy

- [ ] **T6.2.2** Property-based testing
  - [ ] Verify cultivated cells respect slope limits
  - [ ] Check wetlands are near water sources
  - [ ] Ensure no farmland on inappropriate terrain
  - [ ] Validate total farmland area matches demands ±10%

- [ ] **T6.2.3** Integration testing
  - [ ] Test full pipeline from heightmap to rendered terrain
  - [ ] Test with various map sizes and configurations
  - [ ] Test save/load functionality
  - [ ] Test terrain regeneration

### 6.3 Save/Load Support
- [ ] **T6.3.1** Extend save format
  - [ ] Add terrain data arrays to save format
  - [ ] Add terrain configuration parameters
  - [ ] Ensure backward compatibility

- [ ] **T6.3.2** Implement load functionality
  - [ ] Load terrain data arrays from saved maps
  - [ ] Restore terrain configuration
  - [ ] Handle legacy maps without terrain data

### 6.4 Documentation
- [ ] **T6.4.1** Code documentation
  - [ ] Add JSDoc comments to all public methods
  - [ ] Document algorithm choices and trade-offs
  - [ ] Create API reference

- [ ] **T6.4.2** User documentation
  - [ ] Create terrain generation guide
  - [ ] Document UI controls and their effects
  - [ ] Add troubleshooting section

---

## Additional Tasks

### 7.1 Export Functionality (Optional)
- [ ] **T7.1.1** GeoJSON export
  - [ ] Export terrain polygons with properties
  - [ ] Include farmland ownership and intensity data
  - [ ] Add terrain type and yield information

- [ ] **T7.1.2** Raster export
  - [ ] Export terrain classification as indexed PNG
  - [ ] Export intensity data as grayscale
  - [ ] Optional: Multi-band GeoTIFF export

### 7.2 Advanced Features (Future)
- [ ] **T7.2.1** Seasonal variations
  - [ ] Winter/summer field states
  - [ ] Crop rotation visualization
  - [ ] Seasonal road conditions

- [ ] **T7.2.2** Irrigation systems
  - [ ] Canal networks near rivers
  - [ ] Irrigated vs rain-fed agriculture
  - [ ] Water rights and distribution

---

## Task Completion Criteria

Each task should be considered complete when:
1. ✅ **Functional**: The feature works as specified
2. ✅ **Tested**: Unit tests pass and integration testing is successful  
3. ✅ **Performant**: No significant performance regression
4. ✅ **Integrated**: Works correctly with existing FMG systems
5. ✅ **Documented**: Code is properly documented
6. ✅ **UI Complete**: User-facing features have appropriate controls

---

## Dependencies and Blockers

### Critical Dependencies:
- Heightmap generation system (existing)
- Biome classification system (existing)
- Burg/population system (existing)
- Route generation system (existing - will be modified)

### Potential Blockers:
- Performance issues with large maps (>100k cells)
- Memory constraints on mobile devices
- Integration conflicts with existing rendering pipeline
- Complexity of medieval agricultural patterns

---

## Success Metrics

### Quantitative:
- Terrain classification completes in <5 seconds for 100k cell map
- Farmland allocation matches population demands within 10%
- No memory leaks during terrain regeneration
- All unit tests pass

### Qualitative:
- Terrain patterns look historically plausible
- Farmland distribution appears realistic for medieval period
- Integration with routes produces believable road networks
- UI controls are intuitive and responsive

---

**Total Estimated Tasks: 87**  
**Estimated Effort: 240 hours (6 weeks @ 40 hours/week)**  
**Risk Level: Medium-High** (Complex integration, performance critical)