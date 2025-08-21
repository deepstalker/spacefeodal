export function getBeamVisualParams(w: any) {
  const colorHex = (w?.beam?.color || w?.hitEffect?.color || w?.projectile?.color || '#60a5fa').replace('#','0x');
  const outerW = Math.max(1, Math.floor(w?.beam?.outerWidth ?? 6));
  const innerW = Math.max(1, Math.floor(w?.beam?.innerWidth ?? 3));
  const outerA = Phaser.Math.Clamp(w?.beam?.outerAlpha ?? 0.25, 0, 1);
  const innerA = Phaser.Math.Clamp(w?.beam?.innerAlpha ?? 0.9, 0, 1);
  return { colorHex, outerW, innerW, outerA, innerA };
}
