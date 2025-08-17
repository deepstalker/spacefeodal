# Implementation Plan

- [x] 1. Setup configuration system for fog of war


  - Create fog of war configuration structure in gameplay.json
  - Add configuration types to ConfigManager.ts
  - Implement configuration loading and validation with default values
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 2. Create core EnhancedFogOfWar system class


  - Implement main EnhancedFogOfWar class with initialization and update methods
  - Add player position tracking and radar range management
  - Create object registration/deregistration system for static and dynamic objects
  - _Requirements: 1.1, 1.2, 1.3, 2.4, 3.1_

- [x] 3. Implement VisibilityManager for object visibility control

  - Create VisibilityManager class for handling object visibility calculations
  - Implement alpha calculation based on distance from radar center
  - Add smooth fade transitions for objects entering/leaving radar range
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 4. Develop RadarSystem for range calculations

  - Create RadarSystem class to handle radar range retrieval from ship configuration
  - Implement visibility zone calculations (inner, fade, outer zones)
  - Add support for dynamic radar range changes
  - _Requirements: 1.3, 5.3_

- [x] 5. Integrate static object visibility system

  - Register all static objects (stars, planets, stations) as always visible
  - Implement POI visibility state management (hidden/visible based on discovery)
  - Add support for conditional visibility (e.g., pirate bases after POI discovery)
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 6. Implement dynamic object hiding system

  - Register all dynamic objects (NPCs, projectiles, effects) for radar-based visibility
  - Hide dynamic objects completely when outside radar range
  - Implement smooth appearance/disappearance with 50% alpha at radar boundary
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 7. Add world dimming overlay system

  - Create configurable world dimming overlay outside radar range
  - Implement blend mode rendering for fog effect
  - Add option to enable/disable dimming through configuration
  - _Requirements: 1.1, 1.4_

- [x] 8. Integrate with StarSystemScene


  - Initialize EnhancedFogOfWar system in StarSystemScene.create()
  - Register existing static objects (star, planets, stations, POI markers)
  - Connect system to scene update loop for continuous visibility updates
  - _Requirements: 1.3, 2.1, 2.4_

- [x] 9. Integrate with CombatManager for dynamic objects


  - Register NPCs and projectiles as dynamic objects when spawned
  - Automatically deregister objects when destroyed or removed
  - Handle combat-related visibility changes (e.g., cloaking effects)
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 10. Implement performance optimizations

  - Add update interval limiting to prevent excessive calculations
  - Implement object batching for visibility updates
  - Add distance-based update frequency (closer objects update more often)
  - _Requirements: 5.4_

- [x] 11. Add comprehensive error handling


  - Handle missing radar configuration gracefully with fallback values
  - Implement automatic cleanup of destroyed objects
  - Add logging for debugging and monitoring system health
  - _Requirements: 5.4_

- [x] 12. Create unit tests for core functionality

  - Write tests for visibility calculations and alpha blending
  - Test configuration loading and validation
  - Verify object registration and deregistration workflows
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 13. Remove legacy fog of war implementation


  - Delete unused FogOfWar.ts file and related code
  - Remove commented fog of war code from StarSystemScene
  - Clean up any remaining references to old system
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 14. Final integration testing and polish


  - Test complete system with various ship configurations and radar ranges
  - Verify smooth transitions and performance under load
  - Validate all configuration options work correctly
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.1, 4.2, 4.3, 4.4_