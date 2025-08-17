import type { SystemConfig, SystemProfilesConfig } from './ConfigManager';

function randBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function randInt(min: number, max: number) {
  return Math.floor(randBetween(min, max + 1));
}

function gaussianRand(mean = 0, stdev = 1) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + stdev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export function generateSystem(profile: SystemProfilesConfig['profiles'][string]): SystemConfig {
  const maxSize = 25000;
  const size = {
    width: Math.min(profile.systemSize.width, maxSize),
    height: Math.min(profile.systemSize.height, maxSize)
  };
  const star = { x: size.width / 2, y: size.height / 2 };
  const starRadius = randInt(profile.starRadius.min, profile.starRadius.max);

  // Orbits and planets
  const orbitCount = randInt(profile.orbits.min, profile.orbits.max);
  const planets: SystemConfig['planets'] = [];
  let currentOrbit = Math.min(starRadius + profile.orbitGap.min, 10000);
  for (let i = 0; i < orbitCount; i++) {
    const gap = randInt(profile.orbitGap.min, profile.orbitGap.max);
    currentOrbit = Math.min(currentOrbit + gap, 10000);
    if (currentOrbit > 10000) break;
    const type = profile.planetTypes[randInt(0, profile.planetTypes.length - 1)];
    planets.push({
      id: `pl_${i}`,
      name: `${type.name} ${i+1}`,
      orbit: { radius: currentOrbit, angularSpeedDegPerSec: randBetween(1, 8) },
      color: type.color,
      // дефолтный радиус докинга; может быть переопределён в статике
      dockRange: 220
    });
  }

  // Encounters
  const encCfg = profile.encounters;
  const encCount = randInt(encCfg.count.min, encCfg.count.max);
  const poi: SystemConfig['poi'] = [];
  const minR = encCfg.radius.min;
  const maxR = encCfg.radius.max;
  const spacing = encCfg.minSpacing;
  let placed = 0, attempts = 0;
  while (placed < encCount && attempts < encCount * 20) {
    attempts++;
    const r = Math.min(Math.max(Math.abs(gaussianRand(0, (maxR - minR) / 3)) + minR, minR), maxR);
    const a = Math.random() * Math.PI * 2;
    const x = star.x + Math.cos(a) * r;
    const y = star.y + Math.sin(a) * r;
    const ok = poi.every(p => Math.hypot(p.x - x, p.y - y) >= spacing);
    if (!ok) continue;
    const type = encCfg.types[randInt(0, encCfg.types.length - 1)];
    poi.push({ id: `enc_${placed}`, name: type.name, x, y, discovered: false });
    placed++;
  }

  return { size, star, planets, poi, dynamicObjects: [] };
}


