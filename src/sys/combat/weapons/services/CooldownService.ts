export class CooldownService {
  // Время последнего выстрела по стрелку (для обычного оружия)
  private lastFireTimesByShooter: WeakMap<any, Record<string, number>> = new WeakMap();
  // Перезарядка, инициированная назначением цели игроком (для обычного оружия)
  private playerChargeUntil: Record<string, number> = {};
  // Обновление (refresh) для лучевого оружия по стрелку
  private beamCooldowns: WeakMap<any, Record<string, number>> = new WeakMap();

  // Унифицированный доступ к карте времен по стрелку
  public getShooterTimes(shooter: any): Record<string, number> {
    let times = this.lastFireTimesByShooter.get(shooter);
    if (!times) { times = {}; this.lastFireTimesByShooter.set(shooter, times); }
    return times;
  }

  // Работа с chargeUntil (обычное оружие у игрока)
  public getChargeUntil(slotKey: string): number | undefined {
    return this.playerChargeUntil[slotKey];
  }
  public setChargeUntil(slotKey: string, until: number): void {
    this.playerChargeUntil[slotKey] = until;
  }
  public clearCharge(slotKey: string): void {
    if (this.playerChargeUntil[slotKey]) delete this.playerChargeUntil[slotKey];
  }

  // Прогресс перезарядки оружия игрока [0..1]
  public getWeaponChargeProgress(slotKey: string, now: number, w: any): number {
    const chargeUntil = this.playerChargeUntil[slotKey];
    if (!chargeUntil) return 1;
    if (now >= chargeUntil) return 1;
    if (!w) return 1;
    const cooldownMs = 1000 / Math.max(0.001, (w.fireRatePerSec ?? 1));
    const chargeStartTime = chargeUntil - cooldownMs;
    const elapsed = now - chargeStartTime;
    return Math.max(0, Math.min(1, elapsed / cooldownMs));
  }

  // Лучи: время готовности по стрелку/слоту
  public getBeamReadyAt(shooter: any, slotKey: string): number {
    const map = this.beamCooldowns.get(shooter);
    return map ? (map[slotKey] ?? 0) : 0;
  }
  public setBeamReadyAt(shooter: any, slotKey: string, readyAt: number): void {
    const map = this.beamCooldowns.get(shooter) ?? {};
    map[slotKey] = readyAt;
    this.beamCooldowns.set(shooter, map);
  }

  // Прогресс refresh лучевого оружия [0..1]
  public getBeamRefreshProgress(slotKey: string, now: number, w: any, playerShip: any): number {
    const map = this.beamCooldowns.get(playerShip);
    if (!map || !map[slotKey]) return 1;
    const refreshUntil = map[slotKey];
    if (now >= refreshUntil) return 1;
    if (!w) return 1;
    const refreshMs = Math.max(0, w?.beam?.refreshMs ?? 500);
    const refreshStartTime = refreshUntil - refreshMs;
    const elapsed = now - refreshStartTime;
    return Math.max(0, Math.min(1, elapsed / refreshMs));
  }

  // Проверка, заряжается ли оружие игрока (учитывает обычный charge и лучи)
  public isWeaponCharging(slotKey: string, now: number, playerShip: any): boolean {
    const chargeUntil = this.playerChargeUntil[slotKey];
    if (chargeUntil && now < chargeUntil) return true;
    const map = this.beamCooldowns.get(playerShip);
    if (map && map[slotKey] && now < map[slotKey]) return true;
    return false;
  }
}
