export type WeaponType = 'single' | 'burst' | 'homing' | 'beam';

// Возвращает тип оружия, по умолчанию 'single'
export function getWeaponType(w: any): WeaponType {
  const t = w?.type;
  if (t === 'burst' || t === 'homing' || t === 'beam') return t;
  return 'single';
}

export function isBeam(w: any): boolean {
  return getWeaponType(w) === 'beam';
}

export function isHoming(w: any): boolean {
  return getWeaponType(w) === 'homing';
}

// Burst-оружие: явный тип burst ИЛИ burst.count > 1
export function isBurstWeapon(w: any): boolean {
  const explicit = getWeaponType(w) === 'burst';
  const byCount = ((w?.burst?.count ?? 1) > 1);
  return explicit || byCount;
}
