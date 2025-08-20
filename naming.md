## Глоссарий и соглашения по именованию

Краткий справочник терминов проекта и перечень технических систем. Все названия и ключи приведены так, как используются в коде и конфигах.

### Соглашения по именованию и единицы измерения
- **Координаты**: `x`, `y` — пиксели игровой сцены.
- **Углы**: `Deg` — градусы, например `angularSpeedDegPerSec`, `noseOffsetDeg`.
- **Время**: `Ms` — миллисекунды, например `tickMs`, `durationMs`, `intervalMs`.
- **Проценты**: `Pct` — доли от 0 до 1, например `retreatHpPct`, `initialSpawnRadiusPct`.
- **Диапазоны**: объекты вида `{ "min": N, "max": M }`.
- **Сущности по умолчанию**: узел `current` указывает активное определение в `defs`.

### Игровые термины
- **Звёздная система (Star System)**: мир игрового уровня. Типы: `static` (по конфигу) и `procedural` (генерация по профилю). Поля: `name`, `sector`, `size {width,height}`, `star {x,y}`, `planets[]`, `poi[]`, `stations[]`.
- **Профиль системы (System Profile)**: шаблон генерации. Ключевые поля: `starRadius`, `orbits`, `orbitGap`, `planetSize`, `satellitesPerPlanet`, `planetTypes[]`, `encounters` (события/встречи), `systemSize`.
- **Планета (Planet)**: `id`, `name`, `orbit { radius, angularSpeedDegPerSec }`, `color`, опционально `dockRange`, `spawn { quotas }`.
- **Орбита (Orbit)**: радиус в пикселях от звезды, угловая скорость в градусах/сек.
- **Станция (Station)**: стационарный объект с `type` (например, `pirate_base`), координатами и `spawn`/`wave` параметрами.
- **Точки интереса (POI)**: интерактивные/событийные объекты. Поля: `id`, `name`, `x`, `y`, `discovered`.
- **Встречи (Encounters)**: параметры появления событий/групп: `count`, `radius`, `minSpacing`, `types[]` (`lost_treasure`, `pirates` и т.д.), `activation_range`.
- **Статические объекты (staticObjects)**: типы, всегда видимые при тумане войны: `star`, `planet`, `station`, `poi_visible`, `celestial_body`.
- **Динамические объекты (dynamicObjects)**: `npc`, `projectile`, `effect`, `debris`; могут скрываться вне радиуса радара.
- **Докинг (Dock / Docking)**: область стыковки к планете/станции. Общая настройка `dock_range`, либо `dockRange` у объекта.
- **Сектора (Sector)**: метка подрегиона вселенной (например, `Alpha`, `Gamma`, `Эридан`).

### Корабли и перемещение
- **Корабль (Ship)**: `displayName`, `hull`, `sprite { key, displaySize {width,height}, origin, noseOffsetDeg }`.
- **Движение (movement)**: `MAX_SPEED`, `ACCELERATION`, `DECELERATION`, `TURN_SPEED`, `SLOWING_RADIUS`, `TURN_PENALTY_MULTIPLIER`, `TURN_DECELERATION_FACTOR`, `ACCELERATION_PENALTY_AT_MAX`.
- **Сенсоры (sensors)**: `radar_range` — дальность обнаружения.
- **Бой (combat)**: `weaponSlots` — количество слотов; `accuracy`; `slots[]` — смещения дульных точек.
- **Игрок (player.json)**: `shipId` — активный корабль, `weapons[]` — доступные орудия, `start { x, y, headingDeg, zoom }`.

### Оружие и эффекты
- **Типы оружия (type)**: `beam` (луч), `burst` (очередь), `single` (одиночный выстрел).
- **Параметры урона/стрельбы**: `damage`, `range`, `fireRatePerSec`, `projectileSpeed`, `accuracy`.
- **Очередь (burst)**: `{ count, delayMs }` — размер и задержка в очереди.
- **Луч (beam)**: `tickMs`, `damagePerTick`, `durationMs`, `refreshMs`, визуальные параметры луча: `color`, `innerWidth`, `outerWidth`, `innerAlpha`, `outerAlpha`.
- **Снаряд (projectile)**: форма/размер/цвет (`shape: circle|rect`, `radius|width|height`, `color`).
- **Эффект попадания (hitEffect)**: `shape`, `radius`, `color`, `durationMs`.
- **Редкость (rarity)**: `common`, `uncommon`, `rare`, `epic`, `legendary` (см. `items.json` — локализованные названия и цвета).
- **Набор оружия (defs)**: `laser`, `laser_blue`, `cannon`, `missile`, `railgun`, `plasma`, `flak`.

### Туман войны и видимость
- **Fog of War**: `enabled`, затем блоки: `dimming { enabled, alpha, color }`, `fadeZone { innerRadius, outerRadius }`.
- **Поведение**: `staticObjects.alwaysVisible`, `dynamicObjects.hideOutsideRadar`.
- **Производительность**: `performance { updateInterval, maxObjectsPerFrame }`.
- **Радар (Radar)**: влияет на видимость динамических объектов.

### Пауза и тайминг
- **Пауза (pause.json)**: разделение систем на `pausable` (останавливаются) и `non_pausable` (продолжают работу). Особые случаи: `player_ship`, `timeManager`. Флаги отладки: `log_pause_events`, `show_pause_indicator`.
- **Симуляция (gameplay.simulation)**: `enabled`, `initialSpawnRadiusPct`, `lazySpawnRadarBufferPct`, `replenish { checkIntervalMs, spawnDelayMsRange }`.

### NPC, фракции и ИИ
- **Фракции (factions.json)**: `player`, `pirate`, `planet_traders`; отношения: `ally`, `neutral`, `confrontation`.
- **Префабы NPC (stardwellers.json)**: заготовки спавна с `shipId`, `aiProfile`, `combatAI`, `faction`, `weapons`.
- **AI-профили (ai_profiles.json)**: `behavior` (`aggressive`, `static`, `planet_trader`, `patrol`), реакции сенсоров `onFaction` (`attack`, `ignore`, `seekEscort`), `combat.retreatHpPct`, параметры `random`.
- **Профили боевого ИИ (combat_ai_profiles.json)**: `retreatHpPct`, `movementMode` (`orbit`), `movementDistance`, `outdistance_attack` (`target|flee`), `targetPriority`.
- **Имена NPC (npc-names.json)**: двуязычные списки по фракциям/культурам.

### Управление и интерфейс
- **Клавиши (keybinds.json)**: `toggleFollow: F`, `zoomIn: +`, `zoomOut: -`, `pause: Space`, `systemMenu: M`.
- **Настройки UI (settings.json)**: `ui.theme`, `fontFamily`, `baseFontSize`, `spacing`, `ui.combat.weaponRanges`.
- **Камера (settings.json)**: `camera { minZoom, maxZoom, edgePanMargin, edgePanSpeed }`.

### Ассеты и визуал
- **Плагины (assets.json)**: `rexUI`, `spine`.
- **Процедурные формы**: `ship`, `planet`, `poiUnknown`.
- **Спрайты**: ключи и размеры для `ship_alpha`, `ship_explorer`, `ship_trader` и т.д.

### Модули
- **Глобальные флаги (modules.json)**: `navigation`, `combat`, `llm` — включение/отключение функций.

---

## Технические системы (код)

### Менеджеры ядра (`src/sys`)
- **BackgroundTiler**: отрисовка/укладка фоновых тайлов, звёздных полей и небул.
- **CameraManager**: управление зумом/панорамированием камеры, edge-pan.
- **CombatManager**: логика боя, применение урона, циклы стрельбы.
- **ConfigManager**: загрузка и доступ к игровым конфигам (`public/configs/**`).
- **InputManager**: обработка ввода и биндов клавиш.
- **MinimapManager**: миникарта, синхронизация с миром/радаром.
- **MovementManager**: перемещение, ускорение/замедление, поворот.
- **NPCLazySimulationManager**: «ленивая» симуляция NPC вне экрана/радара.
- **NPCMovementManager**: маршрутизация и перемещение NPC.
- **NPCStateManager**: состояния NPC, профили поведения и боевого ИИ.
- **PathfindingManager**: поиск пути и построение траекторий.
- **PauseManager**: применение политики паузы к подсистемам (см. `pause.json`).
- **SaveManager**: сохранение/загрузка прогресса (персистентность).
- **SpaceStationManager**: логика станций, докинг, спавн волн/квот.
- **SystemGenerator**: генерация процедурных систем по профилям.
- **TimeManager**: глобальный тайминг, циклы, обновления UI в паузе.

### Туман войны (`src/sys/fog-of-war`)
- **EnhancedFogOfWar**: основной модуль тумана войны и затемнения.
- **RadarSystem**: радиолокация, определение видимости динамических объектов.
- **VisibilityManager**: маскирование/демаскирование объектов и обновление карты видимости.
- **types.ts**: типы и контракты подсистем FOW.

### Сцены (`src/scene`)
- **BootScene**: начальная сцена; подготовка плагинов/настроек.
- **PreloadScene**: загрузка ассетов и конфигов.
- **StarSystemScene**: основная игровая сцена звёздной системы.
- **UIScene**: сцена пользовательского интерфейса.

### UI (`src/ui`)
- **hud/HUDManager**: менеджер HUD: слоты оружия, индикаторы, оверлеи.
- **RadialMenuManager**: радиальное меню взаимодействий/команд.
- **theme/dimensions**, **theme/typography**: базовые токены размеров и типографики.

### Сервисы (`src/services`)
- **StarfieldRenderer**: фоновая отрисовка (звёзды/небулы) и дополнительный starfield.
- **SystemInitializer**: создание звезды, планет, POI; регистрация в тумане войны.
- **EncounterManager**: активация энкаунтеров/баннеры/очистка маркеров.
- **PlanetOrbitManager**: обновление орбит планет и их меток, проксирование координат в конфиг.
- **GameUpdateManager**: единая точка подписки на UPDATE (рефактор в процессе интеграции).
- **InputHandler**: обработка ПКМ/радиального меню, выдача команд движения игроку.
- **NPCBehaviorManager**: патруль и торговые маршруты NPC с делегированием в `CombatManager`.
- **PathRenderService**: отрисовка линии цели и пользовательского пути.
- **SystemLoaderService**: загрузка активной звёздной системы (static/procedural) по индексам и профилям.

### Конфигурация и данные (`public/configs`)
- **general/**: `assets.json`, `gameplay.json`, `items.json`, `keybinds.json`, `modules.json`, `pause.json`, `persistence.json`, `player.json`, `settings.json`.
- **npc/**: профили ИИ, боевого ИИ, фракции, имена, префабы (`stardwellers.json`).
- **ships/**: `ships.json` (характеристики кораблей), `weapons.json` (параметры оружия).
- **systems/**: список систем, профили генерации, конкретные конфиги систем.

### Ассеты (`public/assets`)
- Изображения звёздных полей, небул, планет, кораблей, оружия и пр.


