# Gamebook

## Версия v0.1 (этапы 1–5)

### Управление и исследование
- ПКМ: постановка маркер-цели, построение маршрута, следование по нему.
- Следование: разгон/торможение по профилю, ограничение скорости поворота, прибытие с V=0.
- Камера: колесо — зум; edge-pan у краёв экрана; F — переключение слежения за кораблём.
- Миникарта: отображает звезду, планеты (упрощённо), корабль.

### Конфиги (public/configs/*.json)
- settings.json
  - resolution.width/height: целевой размер окна.
  - scaleMode: RESIZE — подстраивание под экран.
  - ui: тема/шрифты/базовые отступы.
  - camera.minZoom/maxZoom: лимиты масштаба.
  - camera.edgePanMargin: ширина зоны «прилипания» у границ экрана.
  - camera.edgePanSpeed: скорость панорамирования в пикселях/сек.
- gameplay.json
  - movement.maxSpeed: максимальная скорость корабля (юн/сек).
  - movement.acceleration: ускорение (юн/сек²).
  - movement.deceleration: торможение (юн/сек²).
  - movement.turnRateDegPerSec: максимальная скорость поворота (°/сек).
  - pathfinder.gridCellSize: размер ячейки для сеточного планировщика (зарезервировано).
  - pathfinder.turnCostK: коэффициент штрафа поворота (зарезервировано).
  - pathfinder.obstaclePadding: буфер до препятствий (зарезервировано).
  - pathfinder.dynamicPredictionHorizonSec: горизонт предсказания препятствий (зарезервировано).
  - fov.radiusUnits/cellSize/fogColor/fogAlpha: параметры FOV/тумана (зарезервировано).
- system.json
  - size.width/height: размеры звёздной системы в юнитах.
  - star.x/y: координаты звезды (центр системы).
  - planets[i].orbit.radius/angularSpeedDegPerSec: круговая орбита планеты.
  - poi: точки интереса (для будущего открытия).
- keybinds.json: toggleFollow (F), zoomIn/zoomOut (резерв).
- modules.json: переключатели модулей.
- persistence.json: ключ хранилища сейва.

### Менеджеры/медиатор
- ConfigManager: загрузка конфигов, доступ к параметрам.
- SaveManager: позиция/курс/зум игрока; flush при завершении сцены.
- CameraManager: зум, слежение, edge-pan (через InputManager).
- InputManager: ПКМ, колесо, edge-pan.
- PathfindingManager: на прототипе — прямой путь (будет заменён на A* [x,y,heading]).
- MovementManager: PathFollower с профилем скорости без физики.
- MinimapManager: простая отрисовка миникарты.

### Параметры влияния
- Увеличение movement.deceleration уменьшает тормозной путь и улучшает точность остановки.
- Увеличение movement.turnRateDegPerSec делает траекторию резче при изгибах маршрута.
- camera.edgePanMargin/speed влияют на комфорт панорамирования.
- size.width/height системы масштабирует время перелётов (при прочих равных).

### Последовательность сцен
- BootScene → PreloadScene (rexUI прогресс-бар) → StarSystemScene (+ параллельный UIScene).
- Точка старта берётся из SaveManager (или дефолт возле звезды).

### Замечания
- FOV/туман войны, открытие POI и продвинутый планировщик — в следующих этапах.
- Все UI компоненты для прототипа используют rexUI-плагин.


