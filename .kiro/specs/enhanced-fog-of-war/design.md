# Enhanced Fog of War System Design

## Overview

Enhanced Fog of War система представляет собой модульную систему управления видимостью объектов в космической игре, основанную на радиусе радара корабля игрока. Система интегрируется с существующей архитектурой Phaser.js и использует конфигурационный подход для максимальной гибкости.

Основные принципы:
- Статические объекты (звезды, планеты, станции) всегда видимы
- Динамические объекты (NPC, снаряды) скрыты за пределами радара
- Плавные переходы прозрачности на границе радара
- Конфигурируемые параметры без хардкода
- Оптимизированная производительность

## Architecture

### Core Components

#### 1. EnhancedFogOfWar (Main System)
Центральный класс системы, заменяющий существующий `FogOfWar.ts`.

**Responsibilities:**
- Управление видимостью объектов
- Расчет прозрачности на основе расстояния от радара
- Интеграция с системой рендеринга Phaser
- Обработка конфигурации

#### 2. VisibilityManager (Object Visibility Controller)
Управляет видимостью отдельных объектов и групп объектов.

**Responsibilities:**
- Регистрация/дерегистрация объектов для отслеживания
- Классификация объектов (статические/динамические)
- Применение эффектов видимости к объектам

#### 3. RadarSystem (Radar Range Calculator)
Вычисляет радиус радара и зоны видимости.

**Responsibilities:**
- Получение радиуса радара из конфигурации корабля
- Расчет зон видимости (полная, переходная, скрытая)
- Обработка изменений радиуса радара

#### 4. FogOfWarConfig (Configuration Handler)
Управляет конфигурацией системы fog of war.

**Responsibilities:**
- Загрузка параметров из конфигурационных файлов
- Валидация конфигурации
- Предоставление значений по умолчанию

### Integration Points

#### StarSystemScene Integration
- Инициализация системы в методе `create()`
- Регистрация статических объектов (звезды, планеты, станции)
- Интеграция с циклом обновления сцены

#### CombatManager Integration
- Регистрация динамических объектов (NPC, снаряды)
- Обработка появления/исчезновения объектов
- Синхронизация с системой боя

#### ConfigManager Integration
- Расширение существующей конфигурации
- Добавление секции `fogOfWar` в gameplay.json
- Интеграция с системой загрузки конфигов

## Components and Interfaces

### EnhancedFogOfWar Interface

```typescript
interface IEnhancedFogOfWar {
  init(): void;
  update(deltaTime: number): void;
  registerStaticObject(obj: Phaser.GameObjects.GameObject, type: StaticObjectType): void;
  registerDynamicObject(obj: Phaser.GameObjects.GameObject, type: DynamicObjectType): void;
  unregisterObject(obj: Phaser.GameObjects.GameObject): void;
  setPlayerPosition(x: number, y: number): void;
  setRadarRange(range: number): void;
  setEnabled(enabled: boolean): void;
}
```

### VisibilityManager Interface

```typescript
interface IVisibilityManager {
  updateObjectVisibility(obj: Phaser.GameObjects.GameObject, distance: number, radarRange: number): void;
  calculateAlpha(distance: number, radarRange: number, fadeZone: number): number;
  setObjectVisible(obj: Phaser.GameObjects.GameObject, visible: boolean): void;
  setObjectAlpha(obj: Phaser.GameObjects.GameObject, alpha: number): void;
}
```

### Configuration Structure

```typescript
interface FogOfWarConfig {
  enabled: boolean;
  dimming: {
    enabled: boolean;
    alpha: number;
    color: string;
  };
  fadeZone: {
    innerRadius: number; // Процент от радара для начала затухания
    outerRadius: number; // Процент от радара для полного скрытия
  };
  staticObjects: {
    alwaysVisible: boolean;
    types: StaticObjectType[];
  };
  dynamicObjects: {
    hideOutsideRadar: boolean;
    types: DynamicObjectType[];
  };
  performance: {
    updateInterval: number; // ms
    maxObjectsPerFrame: number;
  };
}
```

## Data Models

### Object Classification

```typescript
enum StaticObjectType {
  STAR = 'star',
  PLANET = 'planet',
  STATION = 'station',
  POI_VISIBLE = 'poi_visible',
  POI_HIDDEN = 'poi_hidden',
  CELESTIAL_BODY = 'celestial_body'
}

enum DynamicObjectType {
  NPC = 'npc',
  PROJECTILE = 'projectile',
  EFFECT = 'effect',
  DEBRIS = 'debris'
}
```

### Visibility Zones

```typescript
interface VisibilityZone {
  innerRadius: number;    // Полная видимость (alpha = 1.0)
  fadeStartRadius: number; // Начало затухания
  fadeEndRadius: number;   // Конец затухания (alpha = 0.5)
  outerRadius: number;     // Полное скрытие (alpha = 0.0)
}
```

### Tracked Object

```typescript
interface TrackedObject {
  gameObject: Phaser.GameObjects.GameObject;
  type: StaticObjectType | DynamicObjectType;
  isStatic: boolean;
  lastDistance: number;
  lastAlpha: number;
  needsUpdate: boolean;
}
```

## Error Handling

### Configuration Errors
- Отсутствие конфигурационного файла → использование значений по умолчанию
- Некорректные значения → валидация и коррекция
- Отсутствие радара у корабля → использование базового радиуса

### Runtime Errors
- Уничтоженные объекты → автоматическая дерегистрация
- Отсутствие игрока → отключение системы
- Ошибки рендеринга → логирование и продолжение работы

### Performance Safeguards
- Ограничение количества обновлений объектов за кадр
- Кэширование расчетов расстояний
- Пропуск обновлений для статических объектов

## Testing Strategy

### Unit Tests
- Тестирование расчета прозрачности
- Валидация конфигурации
- Проверка классификации объектов

### Integration Tests
- Интеграция с StarSystemScene
- Взаимодействие с CombatManager
- Загрузка конфигурации

### Performance Tests
- Тестирование с большим количеством объектов
- Измерение влияния на FPS
- Оптимизация алгоритмов

### Visual Tests
- Проверка плавности переходов
- Корректность отображения статических объектов
- Правильность работы зон видимости

## Implementation Phases

### Phase 1: Core System
- Создание базовых классов
- Реализация расчета видимости
- Базовая интеграция с существующей системой

### Phase 2: Configuration System
- Расширение конфигурации
- Загрузка параметров из файлов
- Валидация конфигурации

### Phase 3: Object Management
- Система регистрации объектов
- Классификация статических/динамических объектов
- Автоматическая дерегистрация

### Phase 4: Visual Effects
- Реализация плавных переходов
- Система приглушения фона
- Оптимизация рендеринга

### Phase 5: Integration & Cleanup
- Полная интеграция с игровыми системами
- Удаление старого кода
- Тестирование и отладка