# Combat Weapons Subsystem

Краткий обзор сервисов и потоков данных.

- TargetService (`services/TargetService.ts`)
  - Хранит назначения целей по слотам игрока.
  - Эмитит события об очистке и выходе из дальности.
  - Не содержит кулдаун-логики.

- CooldownService (`services/CooldownService.ts`)
  - Управляет временем зарядки обычного оружия (playerChargeUntil) и refresh лучей (beamCooldowns) по стрелку/слоту.
  - Предоставляет прогрессы `getWeaponChargeProgress()` и `getBeamRefreshProgress()` и флаг `isWeaponCharging()`.

- BeamService (`services/BeamService.ts`)
  - Отвечает за жизненный цикл луча: ensure/stop, тики урона, отрисовка, duration/refresh.
  - При завершении duration устанавливает refresh в CooldownService.

- ProjectileService (`services/ProjectileService.ts`)
  - Спавн снарядов, регистрация в FoW, полёт (линейный/хоминг), коллизии и эффекты попаданий, таймеры жизни.

- WeaponManager (`../WeaponManager.ts`)
  - Координатор: слоты, цели, делегация в сервисы, расчёт прицеливания, события игрока.

## EventBus

Централизованный контракт событий (`services/EventBus.ts`). События дублируются с легаси-строками для обратной совместимости.

- `combat.weapon.out_of_range` — { slotKey, inRange }
- `combat.player.weapon_fired` — { slotKey, target }
- `combat.player.weapon_target_cleared` — { target, slots }
- `combat.beam.start` — { slotKey, durationMs }
- `combat.beam.refresh` — { slotKey, refreshMs }

Использование:

```ts
import { EventBus, EVENTS } from './services/EventBus';
new EventBus(scene).emit(EVENTS.PlayerWeaponFired, { slotKey: 'laser', target });
```
