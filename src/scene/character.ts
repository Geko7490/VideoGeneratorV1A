import { alpha, type Ctx, rng, shade, type StyleSpec, stroked, styled } from './palette';
import type { ActionType, CharacterDef, CharacterInScene, Emotion } from './types';

/**
 * PROCEDURAL CHARACTER ENGINE
 * Supports human, animal, creature, monster, robot, alien, object, vehicle, shadow and abstract
 * subjects. Humans are built from a parametric skeleton (head/hair/eyes/mouth/torso/arms/hands/
 * legs/shoes/clothes/accessory); non-humans use dedicated procedural bodies.
 *
 * Actions are CHAINED: ['walk','stand','look','react'] is spread across the scene duration,
 * blended at the boundaries so motion is continuous.
 */

interface V { x: number; y: number }
const v = (x: number, y: number): V => ({ x, y });

export interface Skeleton {
  hip: V; chest: V; neck: V; head: V; headR: number; headTilt: number;
  shoulderL: V; shoulderR: V; elbowL: V; elbowR: V; handL: V; handR: V;
  hipL: V; hipR: V; kneeL: V; kneeR: V; footL: V; footR: V;
  lean: number; bob: number; crouch: number;
}

const BUILD: Record<string, { w: number; h: number }> = {
  slim: { w: 0.86, h: 1.02 }, average: { w: 1, h: 1 }, heavy: { w: 1.24, h: 0.97 }, tall: { w: 0.94, h: 1.08 },
};
const AGE_SCALE: Record<string, { body: number; head: number }> = {
  child: { body: 0.72, head: 1.25 }, teen: { body: 0.9, head: 1.1 }, young_adult: { body: 1, head: 1 },
  adult: { body: 1.02, head: 0.97 }, elder: { body: 0.95, head: 1.0 },
};

/** Splits the scene duration across the action chain and returns the active action + its phase. */
export function resolveAction(actions: ActionType[], t: number, duration: number): { action: ActionType; phase: number; next: ActionType; blend: number } {
  const list = actions.length ? actions : (['idle'] as ActionType[]);
  const slot = Math.max(0.6, duration / list.length);
  const idx = Math.min(list.length - 1, Math.floor(t / slot));
  const local = t - idx * slot;
  const phase = Math.min(1, Math.max(0, local / slot));
  const next = list[Math.min(list.length - 1, idx + 1)];
  // cross-blend over the last 25% of a slot so chained actions do not pop
  const blend = phase > 0.75 && idx < list.length - 1 ? (phase - 0.75) / 0.25 : 0;
  return { action: list[idx], phase, next, blend };
}

function skeletonFor(action: ActionType, def: CharacterDef, t: number, seed: number): Skeleton {
  const b = BUILD[def.build] ?? BUILD.average;
  const a = AGE_SCALE[def.age] ?? AGE_SCALE.young_adult;
  const W = b.w;
  const r = rng(seed);
  const idle = Math.sin(t * 1.6 + r() * 6) * 0.004;

  const s: Skeleton = {
    hip: v(0, 0.5 * a.body), chest: v(0, 0.72 * a.body), neck: v(0, 0.795 * a.body), head: v(0, 0.885 * a.body), headR: 0.072 * a.head, headTilt: 0,
    shoulderL: v(-0.085 * W, 0.775 * a.body), shoulderR: v(0.085 * W, 0.775 * a.body),
    elbowL: v(-0.115 * W, 0.635 * a.body), elbowR: v(0.115 * W, 0.635 * a.body),
    handL: v(-0.12 * W, 0.5 * a.body), handR: v(0.12 * W, 0.5 * a.body),
    hipL: v(-0.052 * W, 0.5 * a.body), hipR: v(0.052 * W, 0.5 * a.body),
    kneeL: v(-0.055 * W, 0.26 * a.body), kneeR: v(0.055 * W, 0.26 * a.body),
    footL: v(-0.062 * W, 0.015), footR: v(0.062 * W, 0.015),
    lean: 0, bob: idle, crouch: 0,
  };
  const sw = (f: number, amp: number, o = 0) => Math.sin(t * f + o) * amp;

  switch (action) {
    case 'walk': {
      const ph = t * 4.2;
      const L = Math.sin(ph), R = Math.sin(ph + Math.PI);
      s.bob = Math.abs(Math.sin(ph)) * 0.012;
      s.footL = v(L * 0.11, Math.max(0.01, 0.015 + Math.max(0, -L) * 0.045));
      s.footR = v(R * 0.11, Math.max(0.01, 0.015 + Math.max(0, -R) * 0.045));
      s.kneeL = v(L * 0.055, 0.25); s.kneeR = v(R * 0.055, 0.25);
      s.handL = v(-0.1 * W + R * 0.07, 0.5); s.handR = v(0.1 * W + L * 0.07, 0.5);
      s.lean = 0.03;
      break;
    }
    case 'run':
    case 'flee': {
      const ph = t * 7.5;
      const L = Math.sin(ph), R = Math.sin(ph + Math.PI);
      s.bob = Math.abs(Math.sin(ph)) * 0.028;
      s.footL = v(L * 0.17, Math.max(0.01, 0.02 + Math.max(0, -L) * 0.11));
      s.footR = v(R * 0.17, Math.max(0.01, 0.02 + Math.max(0, -R) * 0.11));
      s.kneeL = v(L * 0.1 + 0.02, 0.27); s.kneeR = v(R * 0.1 + 0.02, 0.27);
      s.handL = v(-0.08 * W + R * 0.12, 0.56 + R * 0.05); s.handR = v(0.08 * W + L * 0.12, 0.56 + L * 0.05);
      s.lean = action === 'flee' ? 0.14 : 0.1;
      break;
    }
    case 'sit': {
      s.hip = v(-0.01, 0.3); s.chest = v(0, 0.52); s.neck = v(0, 0.6); s.head = v(0.005, 0.69);
      s.hipL = v(-0.05 * W, 0.3); s.hipR = v(0.05 * W, 0.3);
      s.kneeL = v(0.11 * W, 0.3); s.kneeR = v(0.14 * W, 0.3);
      s.footL = v(0.12 * W, 0.015); s.footR = v(0.16 * W, 0.015);
      s.shoulderL = v(-0.082 * W, 0.585); s.shoulderR = v(0.082 * W, 0.585);
      s.elbowL = v(-0.105 * W, 0.46); s.elbowR = v(0.105 * W, 0.46);
      s.handL = v(-0.04 * W, 0.37); s.handR = v(0.05 * W, 0.37);
      s.bob = idle * 0.6;
      break;
    }
    case 'hide': {
      s.crouch = 0.28;
      s.hip = v(0, 0.34); s.chest = v(0.01, 0.52); s.neck = v(0.01, 0.58); s.head = v(0.02, 0.66);
      s.kneeL = v(-0.08 * W, 0.17); s.kneeR = v(0.08 * W, 0.17);
      s.footL = v(-0.07 * W, 0.015); s.footR = v(0.07 * W, 0.015);
      s.handL = v(-0.08 * W, 0.42); s.handR = v(0.08 * W, 0.42);
      s.headTilt = -0.1;
      break;
    }
    case 'fall': {
      s.headTilt = -0.35; s.lean = -0.22;
      s.handL = v(-0.22 * W, 0.78); s.handR = v(0.22 * W, 0.82);
      s.footL = v(-0.14 * W, 0.08); s.footR = v(0.12 * W, 0.12);
      s.bob = Math.sin(t * 6) * 0.01;
      break;
    }
    case 'jump': {
      const j = Math.abs(Math.sin(t * 2.6));
      s.bob = j * 0.09;
      s.footL = v(-0.08 * W, 0.04 + j * 0.03); s.footR = v(0.08 * W, 0.04 + j * 0.03);
      s.handL = v(-0.16 * W, 0.8 + j * 0.08); s.handR = v(0.16 * W, 0.8 + j * 0.08);
      break;
    }
    case 'reach':
    case 'grab': {
      const g = action === 'grab' ? 0.5 + Math.sin(t * 3) * 0.5 : 1;
      s.handR = v(0.25 * W * g + 0.08, 0.8 + sw(1.2, 0.015));
      s.elbowR = v(0.16 * W, 0.74);
      s.lean = 0.06;
      break;
    }
    case 'drop': {
      s.handR = v(0.18 * W, 0.42);
      s.elbowR = v(0.15 * W, 0.6);
      s.headTilt = 0.12;
      break;
    }
    case 'open':
    case 'close': {
      const d = action === 'open' ? 1 : -1;
      s.handR = v(0.24 * W + d * Math.sin(t * 1.6) * 0.03, 0.66);
      s.elbowR = v(0.17 * W, 0.68);
      s.lean = 0.05 * d;
      break;
    }
    case 'talk': {
      s.handL = v(-0.14 * W + sw(2.4, 0.02), 0.56 + sw(2.1, 0.015));
      s.handR = v(0.14 * W + sw(2.2, 0.02, 1), 0.56 + sw(2.6, 0.015, 2));
      s.headTilt = sw(1.1, 0.04);
      break;
    }
    case 'react': {
      const k = Math.exp(-t * 1.4) * Math.sin(t * 9);
      s.lean = -0.09 - k * 0.05;
      s.headTilt = -0.12 + k * 0.08;
      s.handL = v(-0.17 * W, 0.66); s.handR = v(0.17 * W, 0.66);
      s.bob = Math.abs(k) * 0.02;
      break;
    }
    case 'attack': {
      const a2 = (t * 1.8) % 1;
      const punch = a2 < 0.3 ? a2 / 0.3 : 1 - (a2 - 0.3) / 0.7;
      s.handR = v(0.1 * W + punch * 0.22, 0.7);
      s.elbowR = v(0.13 * W + punch * 0.1, 0.72);
      s.lean = 0.05 + punch * 0.08;
      break;
    }
    case 'turn': {
      s.lean = Math.sin(t * 0.9) * 0.08;
      s.headTilt = Math.sin(t * 0.9) * 0.18;
      break;
    }
    case 'look': {
      s.headTilt = Math.sin(t * 0.7) * 0.14 + 0.05;
      break;
    }
    case 'breathe': {
      s.bob = Math.sin(t * 1.1) * 0.012;
      s.chest = v(0, 0.72 + Math.sin(t * 1.1) * 0.006);
      break;
    }
    case 'blink':
    case 'stand':
    case 'idle':
    default:
      s.handL = v(-0.12 * W, 0.5 + idle * 2);
      s.handR = v(0.12 * W, 0.5 + idle * 2);
      break;
  }
  return s;
}

function lerpSk(a: Skeleton, b: Skeleton, k: number): Skeleton {
  const L = (p: V, q: V): V => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
  return {
    hip: L(a.hip, b.hip), chest: L(a.chest, b.chest), neck: L(a.neck, b.neck), head: L(a.head, b.head),
    headR: a.headR, headTilt: a.headTilt + (b.headTilt - a.headTilt) * k,
    shoulderL: L(a.shoulderL, b.shoulderL), shoulderR: L(a.shoulderR, b.shoulderR),
    elbowL: L(a.elbowL, b.elbowL), elbowR: L(a.elbowR, b.elbowR),
    handL: L(a.handL, b.handL), handR: L(a.handR, b.handR),
    hipL: L(a.hipL, b.hipL), hipR: L(a.hipR, b.hipR),
    kneeL: L(a.kneeL, b.kneeL), kneeR: L(a.kneeR, b.kneeR),
    footL: L(a.footL, b.footL), footR: L(a.footR, b.footR),
    lean: a.lean + (b.lean - a.lean) * k, bob: a.bob + (b.bob - a.bob) * k, crouch: a.crouch + (b.crouch - a.crouch) * k,
  };
}

// ---------------------------------------------------------------- emotion

interface FaceParams { eyeOpen: number; browAngle: number; browY: number; mouthCurve: number; mouthOpen: number; blush: boolean; tear: boolean; sweat: boolean; glowEyes: boolean }
const F = (eyeOpen: number, browAngle: number, browY: number, mouthCurve: number, mouthOpen: number, extra: Partial<FaceParams> = {}): FaceParams => ({ eyeOpen, browAngle, browY, mouthCurve, mouthOpen, blush: false, tear: false, sweat: false, glowEyes: false, ...extra });

const FACES: Record<Emotion, FaceParams> = {
  neutral: F(1, 0, 0, 0.05, 0.06),
  happy: F(0.62, 0.1, 0.004, 1, 0.3, { blush: true }),
  sad: F(0.82, -0.42, -0.001, -0.85, 0.08, { tear: true }),
  angry: F(0.95, 0.65, -0.006, -0.55, 0.18),
  scared: F(1.45, -0.3, 0.009, -0.3, 0.6, { sweat: true }),
  confused: F(1.0, 0.3, 0.006, -0.2, 0.1, { sweat: true }),
  surprised: F(1.55, 0, 0.013, 0, 0.78),
  worried: F(0.95, -0.3, 0.003, -0.45, 0.08, { sweat: true }),
  shocked: F(1.75, -0.1, 0.016, -0.1, 0.95, { sweat: true }),
  evil: F(0.72, 0.75, -0.008, 0.85, 0.22, { glowEyes: true }),
  tired: F(0.32, -0.18, -0.004, -0.3, 0.12),
  excited: F(1.25, 0.12, 0.009, 0.95, 0.52, { blush: true }),
};

// ---------------------------------------------------------------- drawing helpers

function limb(ctx: Ctx, a: V, b: V, c: V, width: number, color: string, s: StyleSpec, scale: number) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(b.x, b.y, c.x, c.y);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.outline) {
    ctx.strokeStyle = s.outline;
    ctx.lineWidth = width + Math.max(1.2, s.outlineWidth * scale * 1.6);
    ctx.stroke();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

export interface CharDrawOpts {
  def: CharacterDef;
  inScene: CharacterInScene;
  t: number;              // scene-local time
  duration: number;       // scene duration (for the action chain)
  x: number;
  groundY: number;
  height: number;
  style: StyleSpec;
  shadowAlpha: number;
  rim: string | null;
  rimAlpha: number;
  seed: number;
  quality: 'low' | 'medium' | 'high' | 'ultra';
}

/** Draws a character of any kind. Returns the head position and right-hand position. */
export function drawCharacter(ctx: Ctx, o: CharDrawOpts): { head: V; handR: V } {
  const { def, inScene, style: st } = o;
  const { action, next, blend } = resolveAction(inScene.actions, o.t * st.animSpeed, Math.max(1, o.duration));
  const unit = o.height;

  // ground shadow for every kind
  ctx.save();
  ctx.globalAlpha = o.shadowAlpha;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(o.x, o.groundY, unit * 0.12, unit * 0.024 * st.shadowSoftness, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  switch (def.kind) {
    case 'human':
      return drawHuman(ctx, o, action, next, blend);
    case 'animal':
      return drawAnimal(ctx, o, action);
    case 'robot':
      return drawRobot(ctx, o, action);
    case 'alien':
      return drawAlien(ctx, o, action);
    case 'monster':
      return drawMonster(ctx, o, action);
    case 'creature':
      return drawCreature(ctx, o, action);
    case 'vehicle':
      return drawVehicle(ctx, o, action);
    case 'shadow':
      return drawShadowFigure(ctx, o, action, next, blend);
    case 'object':
      return drawObjectBeing(ctx, o, action);
    case 'abstract':
    default:
      return drawAbstract(ctx, o, action);
  }
}

// ---------------------------------------------------------------- HUMAN

function drawHuman(ctx: Ctx, o: CharDrawOpts, action: ActionType, next: ActionType, blend: number): { head: V; handR: V } {
  const { def, inScene, style: st } = o;
  const tt = o.t * st.animSpeed;
  let sk = skeletonFor(action, def, tt, o.seed);
  if (blend > 0) sk = lerpSk(sk, skeletonFor(next, def, tt, o.seed), blend);

  const unit = o.height;
  const flip = inScene.facing === 'left' ? -1 : 1;
  const jit = st.animJitter ? (i: number) => Math.sin(tt * 13 + i) * st.animJitter * 0.004 : () => 0;
  const P = (p: V, i = 0): V => ({
    x: o.x + (p.x + jit(i)) * unit * flip + sk.lean * unit * 0.35 * flip * (p.y / 0.9),
    y: o.groundY - (p.y + sk.bob) * unit,
  });

  const skin = styled(def.skin, st);
  const top = styled(def.topColor, st);
  const bottom = styled(def.bottomColor, st);
  const shoe = styled(def.shoeColor, st);
  const hair = styled(def.hairColor, st);
  const lw = unit * 0.001;
  const bW = (BUILD[def.build] ?? BUILD.average).w;
  const legW = unit * 0.049 * bW;
  const armW = unit * 0.038 * bW;
  const torsoW = unit * 0.17 * bW;

  limb(ctx, P(sk.hipL, 1), P(sk.kneeL, 2), P(sk.footL, 3), legW, shade(bottom, -0.18), st, lw);
  limb(ctx, P(sk.shoulderL, 4), P(sk.elbowL, 5), P(sk.handL, 6), armW, shade(top, -0.2), st, lw);

  const shoeAt = (p: V, dark: boolean) => {
    const q = P(p);
    ctx.beginPath();
    ctx.ellipse(q.x + unit * 0.012 * flip, q.y, unit * 0.034, unit * 0.017, 0, 0, Math.PI * 2);
    ctx.fillStyle = dark ? shade(shoe, -0.2) : shoe;
    ctx.fill();
    stroked(ctx, st, lw);
  };
  shoeAt(sk.footL, true);

  const hip = P(sk.hip), chest = P(sk.chest), neck = P(sk.neck);
  ctx.beginPath();
  ctx.moveTo(hip.x - torsoW * 0.42, hip.y);
  ctx.quadraticCurveTo(chest.x - torsoW * 0.56, chest.y, neck.x - torsoW * 0.3, neck.y);
  ctx.lineTo(neck.x + torsoW * 0.3, neck.y);
  ctx.quadraticCurveTo(chest.x + torsoW * 0.56, chest.y, hip.x + torsoW * 0.42, hip.y);
  ctx.closePath();
  if (st.flat) ctx.fillStyle = top;
  else {
    const g = ctx.createLinearGradient(hip.x - torsoW, 0, hip.x + torsoW, 0);
    g.addColorStop(0, shade(top, -0.22));
    g.addColorStop(0.55, top);
    g.addColorStop(1, shade(top, 0.12));
    ctx.fillStyle = g;
  }
  ctx.fill();
  stroked(ctx, st, lw);

  ctx.beginPath();
  ctx.moveTo(hip.x - torsoW * 0.44, hip.y - unit * 0.012);
  ctx.lineTo(hip.x + torsoW * 0.44, hip.y - unit * 0.012);
  ctx.lineTo(hip.x + torsoW * 0.36, hip.y + unit * 0.045);
  ctx.lineTo(hip.x - torsoW * 0.36, hip.y + unit * 0.045);
  ctx.closePath();
  ctx.fillStyle = bottom;
  ctx.fill();
  stroked(ctx, st, lw);

  limb(ctx, P(sk.hipR, 7), P(sk.kneeR, 8), P(sk.footR, 9), legW, bottom, st, lw);
  shoeAt(sk.footR, false);
  limb(ctx, P(sk.shoulderR, 10), P(sk.elbowR, 11), P(sk.handR, 12), armW, top, st, lw);

  const handAt = (p: V) => {
    const q = P(p);
    ctx.beginPath();
    ctx.arc(q.x, q.y, unit * 0.023, 0, Math.PI * 2);
    ctx.fillStyle = skin;
    ctx.fill();
    stroked(ctx, st, lw * 0.8);
    return q;
  };
  handAt(sk.handL);
  const handR = handAt(sk.handR);

  ctx.beginPath();
  ctx.rect(neck.x - unit * 0.026, neck.y - unit * 0.02, unit * 0.052, unit * 0.05);
  ctx.fillStyle = shade(skin, -0.14);
  ctx.fill();

  const headP = P(sk.head);
  const hr = sk.headR * unit;
  ctx.save();
  ctx.translate(headP.x, headP.y);
  ctx.rotate(sk.headTilt * flip);
  ctx.beginPath();
  ctx.ellipse(0, 0, hr * 0.88, hr, 0, 0, Math.PI * 2);
  if (st.flat) ctx.fillStyle = skin;
  else {
    const g = ctx.createRadialGradient(-hr * 0.3 * flip, -hr * 0.3, hr * 0.1, 0, 0, hr * 1.2);
    g.addColorStop(0, shade(skin, 0.14));
    g.addColorStop(1, shade(skin, -0.12));
    ctx.fillStyle = g;
  }
  ctx.fill();
  stroked(ctx, st, lw);
  ctx.beginPath();
  ctx.ellipse(-hr * 0.86 * flip, hr * 0.06, hr * 0.12, hr * 0.18, 0, 0, Math.PI * 2);
  ctx.fillStyle = shade(skin, -0.08);
  ctx.fill();

  drawFace(ctx, hr, FACES[inScene.emotion] ?? FACES.neutral, action === 'talk', tt, st, flip, action === 'blink');
  drawHair(ctx, hr, def, hair, st, lw);
  drawAccessory(ctx, hr, def, st, lw, flip);
  ctx.restore();

  if (o.rim && o.quality !== 'low') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = o.rimAlpha * 0.8;
    ctx.strokeStyle = o.rim;
    ctx.lineWidth = unit * 0.009;
    ctx.beginPath();
    ctx.ellipse(headP.x - hr * 0.2 * flip, headP.y, hr * 0.9, hr * 1.02, 0, Math.PI * 0.55, Math.PI * 1.45);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(neck.x - torsoW * 0.3, neck.y);
    ctx.quadraticCurveTo(chest.x - torsoW * 0.56, chest.y, hip.x - torsoW * 0.42, hip.y);
    ctx.stroke();
    ctx.restore();
  }
  return { head: headP, handR };
}

function drawFace(ctx: Ctx, hr: number, f: FaceParams, talking: boolean, t: number, st: StyleSpec, flip: number, forceBlink: boolean) {
  const blink = forceBlink ? (Math.sin(t * 4) > 0 ? 0.08 : 1) : Math.sin(t * 1.35) > 0.985 ? 0.08 : 1;
  const open = Math.max(0.06, f.eyeOpen * blink);
  const ex = hr * 0.33, ey = hr * 0.06;
  const ink = st.outline ?? '#16181c';

  for (const side of [-1, 1]) {
    const x = side * ex + flip * hr * 0.04;
    ctx.beginPath();
    ctx.ellipse(x, ey, hr * 0.15, hr * 0.17 * open, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#fdfdfd';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + flip * hr * 0.03, ey + hr * 0.01, hr * 0.075, hr * 0.095 * Math.max(0.2, open), 0, 0, Math.PI * 2);
    ctx.fillStyle = f.glowEyes ? '#ff4d4d' : ink;
    ctx.fill();
    if (f.glowEyes) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, ey, 0, x, ey, hr * 0.5);
      g.addColorStop(0, 'rgba(255,60,60,0.7)');
      g.addColorStop(1, 'rgba(255,60,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, ey, hr * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (open > 0.5 && !f.glowEyes) {
      ctx.beginPath();
      ctx.arc(x + flip * hr * 0.05, ey - hr * 0.03, hr * 0.028, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fill();
    }
    if (f.eyeOpen < 0.7) {
      ctx.beginPath();
      ctx.moveTo(x - hr * 0.16, ey - hr * 0.04);
      ctx.lineTo(x + hr * 0.16, ey - hr * 0.04);
      ctx.strokeStyle = ink;
      ctx.lineWidth = hr * 0.05;
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(x, ey - hr * 0.3 - f.browY * 14);
    ctx.rotate(f.browAngle * 0.5 * side * -1);
    ctx.beginPath();
    ctx.moveTo(-hr * 0.16, 0);
    ctx.quadraticCurveTo(0, -hr * 0.06, hr * 0.16, 0);
    ctx.strokeStyle = ink;
    ctx.lineWidth = hr * 0.065;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  ctx.beginPath();
  ctx.moveTo(flip * hr * 0.06, ey + hr * 0.18);
  ctx.lineTo(flip * hr * 0.12, ey + hr * 0.3);
  ctx.lineTo(flip * hr * 0.03, ey + hr * 0.32);
  ctx.strokeStyle = alpha(ink, 0.5);
  ctx.lineWidth = hr * 0.035;
  ctx.stroke();

  const mo = talking ? f.mouthOpen * 0.5 + Math.abs(Math.sin(t * 9.5)) * 0.55 : f.mouthOpen;
  const my = hr * 0.52;
  ctx.beginPath();
  if (mo > 0.3) {
    ctx.ellipse(flip * hr * 0.03, my, hr * 0.17, hr * 0.1 + hr * 0.16 * mo, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#5b2130';
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = hr * 0.03;
    ctx.stroke();
  } else {
    ctx.moveTo(flip * hr * 0.03 - hr * 0.17, my);
    ctx.quadraticCurveTo(flip * hr * 0.03, my + f.mouthCurve * hr * 0.2, flip * hr * 0.03 + hr * 0.17, my);
    ctx.strokeStyle = ink;
    ctx.lineWidth = hr * 0.05;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  if (f.blush) {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * hr * 0.46, hr * 0.33, hr * 0.14, hr * 0.08, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,120,120,0.32)';
      ctx.fill();
    }
  }
  if (f.tear) {
    ctx.beginPath();
    ctx.ellipse(-ex, ey + hr * 0.3 + (Math.sin(t * 1.5) * 0.5 + 0.5) * hr * 0.3, hr * 0.05, hr * 0.08, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(150,210,255,0.85)';
    ctx.fill();
  }
  if (f.sweat) {
    ctx.beginPath();
    ctx.ellipse(hr * 0.62, -hr * 0.35, hr * 0.06, hr * 0.09, 0.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(160,220,255,0.8)';
    ctx.fill();
  }
}

function drawHair(ctx: Ctx, hr: number, def: CharacterDef, hair: string, st: StyleSpec, lw: number) {
  if (def.hairStyle === 'bald') return;
  ctx.fillStyle = hair;
  const H = def.hairStyle;
  ctx.beginPath();
  if (H === 'long' || H === 'ponytail') {
    ctx.moveTo(-hr * 0.92, hr * 0.1);
    ctx.quadraticCurveTo(-hr * 1.05, -hr * 1.15, 0, -hr * 1.06);
    ctx.quadraticCurveTo(hr * 1.05, -hr * 1.15, hr * 0.92, hr * 0.1);
    ctx.lineTo(hr * 0.78, hr * (H === 'long' ? 1.25 : 0.4));
    ctx.quadraticCurveTo(hr * 0.5, hr * 0.1, hr * 0.5, -hr * 0.25);
    ctx.lineTo(-hr * 0.5, -hr * 0.25);
    ctx.quadraticCurveTo(-hr * 0.5, hr * 0.1, -hr * 0.78, hr * (H === 'long' ? 1.25 : 0.4));
  } else if (H === 'messy') {
    ctx.moveTo(-hr * 0.95, hr * 0.05);
    for (let i = 0; i <= 9; i++) {
      const a = Math.PI + (i / 9) * Math.PI;
      const rr = hr * (1.02 + (i % 2 ? 0.16 : -0.02));
      ctx.lineTo(Math.cos(a) * rr * 0.95, Math.sin(a) * rr - hr * 0.04);
    }
    ctx.lineTo(hr * 0.95, hr * 0.05);
    ctx.quadraticCurveTo(0, -hr * 0.3, -hr * 0.95, hr * 0.05);
  } else if (H === 'curly') {
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI + (i / 10) * Math.PI;
      ctx.moveTo(Math.cos(a) * hr * 0.9, Math.sin(a) * hr * 0.95 - hr * 0.08);
      ctx.arc(Math.cos(a) * hr * 0.9, Math.sin(a) * hr * 0.95 - hr * 0.08, hr * 0.26, 0, Math.PI * 2);
    }
  } else if (H === 'bun') {
    ctx.arc(0, -hr * 1.1, hr * 0.33, 0, Math.PI * 2);
    ctx.moveTo(-hr * 0.9, 0);
    ctx.quadraticCurveTo(0, -hr * 1.25, hr * 0.9, 0);
    ctx.quadraticCurveTo(0, -hr * 0.55, -hr * 0.9, 0);
  } else if (H === 'hat' || H === 'hood') {
    ctx.moveTo(-hr * 1.08, -hr * 0.1);
    ctx.quadraticCurveTo(0, -hr * 1.5, hr * 1.08, -hr * 0.1);
    ctx.lineTo(hr * 1.2, -hr * 0.02);
    ctx.lineTo(-hr * 1.2, -hr * 0.02);
  } else {
    ctx.moveTo(-hr * 0.92, hr * 0.02);
    ctx.quadraticCurveTo(-hr * 1.0, -hr * 1.12, 0, -hr * 1.04);
    ctx.quadraticCurveTo(hr * 1.0, -hr * 1.12, hr * 0.92, hr * 0.02);
    ctx.quadraticCurveTo(hr * 0.55, -hr * 0.42, 0, -hr * 0.38);
    ctx.quadraticCurveTo(-hr * 0.55, -hr * 0.42, -hr * 0.92, hr * 0.02);
  }
  ctx.closePath();
  ctx.fill();
  stroked(ctx, st, lw);
}

function drawAccessory(ctx: Ctx, hr: number, def: CharacterDef, st: StyleSpec, lw: number, flip: number) {
  const c = styled(def.accessoryColor, st);
  switch (def.accessory) {
    case 'glasses':
      ctx.strokeStyle = c;
      ctx.lineWidth = hr * 0.05;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * hr * 0.33 + flip * hr * 0.04, hr * 0.06, hr * 0.2, hr * 0.18, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(-hr * 0.13, hr * 0.06);
      ctx.lineTo(hr * 0.13, hr * 0.06);
      ctx.stroke();
      break;
    case 'cap':
      ctx.beginPath();
      ctx.moveTo(-hr, -hr * 0.2);
      ctx.quadraticCurveTo(0, -hr * 1.5, hr, -hr * 0.2);
      ctx.lineTo(hr * (flip > 0 ? 1.65 : 1), -hr * 0.1);
      ctx.lineTo(-hr * (flip > 0 ? 1 : 1.65), -hr * 0.1);
      ctx.closePath();
      ctx.fillStyle = c;
      ctx.fill();
      stroked(ctx, st, lw);
      break;
    case 'hood':
      ctx.beginPath();
      ctx.moveTo(-hr * 1.22, hr * 0.5);
      ctx.quadraticCurveTo(-hr * 1.3, -hr * 1.3, 0, -hr * 1.22);
      ctx.quadraticCurveTo(hr * 1.3, -hr * 1.3, hr * 1.22, hr * 0.5);
      ctx.quadraticCurveTo(hr * 0.75, hr * 0.1, hr * 0.8, -hr * 0.25);
      ctx.lineTo(-hr * 0.8, -hr * 0.25);
      ctx.quadraticCurveTo(-hr * 0.75, hr * 0.1, -hr * 1.22, hr * 0.5);
      ctx.closePath();
      ctx.fillStyle = c;
      ctx.fill();
      stroked(ctx, st, lw);
      break;
    case 'scarf':
      ctx.beginPath();
      ctx.ellipse(0, hr * 1.05, hr * 0.6, hr * 0.22, 0, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
      stroked(ctx, st, lw);
      break;
    case 'headphones':
      ctx.strokeStyle = c;
      ctx.lineWidth = hr * 0.11;
      ctx.beginPath();
      ctx.arc(0, -hr * 0.1, hr * 1.02, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * hr * 0.95, hr * 0.02, hr * 0.14, hr * 0.24, 0, 0, Math.PI * 2);
        ctx.fillStyle = c;
        ctx.fill();
      }
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------- NON-HUMAN KINDS

function bodyMotion(action: ActionType, t: number) {
  const moving = action === 'walk' || action === 'run' || action === 'flee';
  const speed = action === 'run' || action === 'flee' ? 7 : 3.4;
  return {
    bob: moving ? Math.abs(Math.sin(t * speed)) * 0.03 : Math.sin(t * 1.3) * 0.012,
    swing: moving ? Math.sin(t * speed) : Math.sin(t * 1.1) * 0.25,
    lean: action === 'attack' ? 0.12 : moving ? 0.05 : 0,
    jump: action === 'jump' ? Math.abs(Math.sin(t * 2.6)) * 0.12 : 0,
  };
}

function drawAnimal(ctx: Ctx, o: CharDrawOpts, action: ActionType): { head: V; handR: V } {
  const { def, style: st } = o;
  const u = o.height * 0.55;
  const flip = o.inScene.facing === 'left' ? -1 : 1;
  const m = bodyMotion(action, o.t * st.animSpeed);
  const y = o.groundY - u * (0.42 + m.bob + m.jump);
  const x = o.x;
  const fur = styled(def.skin, st);
  const lw = u * 0.004;
  const tall = def.variant === 'horse' || def.variant === 'deer';
  const bodyW = u * (tall ? 0.78 : 0.68);
  const bodyH = u * (tall ? 0.34 : 0.38);

  // legs
  for (let i = 0; i < 4; i++) {
    const side = i < 2 ? -1 : 1;
    const lx = x + flip * side * bodyW * 0.33;
    const ph = Math.sin(o.t * st.animSpeed * (action === 'run' ? 7 : 3.4) + i * 1.6);
    const legLen = u * 0.42 * (1 + (tall ? 0.25 : 0));
    ctx.beginPath();
    ctx.moveTo(lx, y + bodyH * 0.4);
    ctx.quadraticCurveTo(lx + ph * u * 0.05, y + bodyH * 0.4 + legLen * 0.5, lx + (action === 'sit' ? side * u * 0.08 : ph * u * 0.09), o.groundY - (action === 'sit' ? u * 0.08 : 0));
    ctx.strokeStyle = shade(fur, i < 2 ? -0.18 : 0);
    ctx.lineWidth = u * 0.07;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  // body
  ctx.beginPath();
  ctx.ellipse(x, y, bodyW * 0.5, bodyH * 0.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = fur;
  ctx.fill();
  stroked(ctx, st, lw);
  // tail
  ctx.beginPath();
  ctx.moveTo(x - flip * bodyW * 0.48, y - bodyH * 0.1);
  ctx.quadraticCurveTo(x - flip * bodyW * 0.75, y - bodyH * (0.5 + m.swing * 0.3), x - flip * bodyW * 0.82, y - bodyH * 0.9);
  ctx.strokeStyle = fur;
  ctx.lineWidth = u * 0.05;
  ctx.stroke();
  // head
  const hx = x + flip * bodyW * 0.52;
  const hy = y - bodyH * 0.55;
  const hrad = u * 0.17;
  ctx.beginPath();
  ctx.ellipse(hx, hy, hrad, hrad * 0.92, 0, 0, Math.PI * 2);
  ctx.fillStyle = shade(fur, 0.06);
  ctx.fill();
  stroked(ctx, st, lw);
  // snout
  ctx.beginPath();
  ctx.ellipse(hx + flip * hrad * 0.75, hy + hrad * 0.25, hrad * 0.42, hrad * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = shade(fur, -0.12);
  ctx.fill();
  stroked(ctx, st, lw * 0.7);
  // ears
  for (const s2 of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(hx + s2 * hrad * 0.45, hy - hrad * 0.6);
    ctx.lineTo(hx + s2 * hrad * 0.72, hy - hrad * (1.45 + (def.variant === 'cat' ? 0.25 : 0)));
    ctx.lineTo(hx + s2 * hrad * 0.1, hy - hrad * 0.85);
    ctx.closePath();
    ctx.fillStyle = shade(fur, -0.15);
    ctx.fill();
    stroked(ctx, st, lw * 0.7);
  }
  // eye
  ctx.beginPath();
  ctx.arc(hx + flip * hrad * 0.3, hy - hrad * 0.1, hrad * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = o.inScene.emotion === 'evil' ? '#ff4d4d' : '#15181d';
  ctx.fill();
  return { head: v(hx, hy), handR: v(hx, hy + hrad) };
}

function drawRobot(ctx: Ctx, o: CharDrawOpts, action: ActionType): { head: V; handR: V } {
  const { def, style: st } = o;
  const u = o.height;
  const flip = o.inScene.facing === 'left' ? -1 : 1;
  const m = bodyMotion(action, o.t * st.animSpeed);
  const metal = styled(def.skin, st);
  const trim = styled(def.topColor, st);
  const lw = u * 0.0014;
  const by = o.groundY - u * (m.bob + m.jump);

  // legs
  for (const side of [-1, 1]) {
    const ph = Math.sin(o.t * st.animSpeed * (action === 'run' ? 7 : 3.6) + (side > 0 ? Math.PI : 0));
    const moving = action === 'walk' || action === 'run' || action === 'flee';
    ctx.save();
    ctx.fillStyle = shade(metal, -0.2);
    ctx.translate(o.x + side * u * 0.06, by - u * 0.3);
    ctx.rotate(moving ? ph * 0.25 : 0);
    ctx.fillRect(-u * 0.035, 0, u * 0.07, u * 0.3);
    stroked(ctx, st, lw);
    ctx.fillStyle = shade(metal, -0.35);
    ctx.fillRect(-u * 0.05, u * 0.28, u * 0.1, u * 0.04);
    ctx.restore();
  }
  // torso
  ctx.beginPath();
  ctx.roundRect?.(o.x - u * 0.1, by - u * 0.62, u * 0.2, u * 0.33, u * 0.03);
  if (!ctx.roundRect) ctx.rect(o.x - u * 0.1, by - u * 0.62, u * 0.2, u * 0.33);
  ctx.fillStyle = metal;
  ctx.fill();
  stroked(ctx, st, lw);
  // chest light
  ctx.beginPath();
  ctx.arc(o.x, by - u * 0.47, u * 0.03, 0, Math.PI * 2);
  const pulse = 0.5 + Math.sin(o.t * 3) * 0.3;
  ctx.fillStyle = alpha(trim, 0.6 + pulse * 0.4);
  ctx.fill();
  // arms
  for (const side of [-1, 1]) {
    const ph = Math.sin(o.t * st.animSpeed * 3.6 + (side > 0 ? 0 : Math.PI));
    const reach = action === 'reach' || action === 'grab' || action === 'attack' ? side * flip > 0 ? 0.9 : 0 : 0;
    ctx.save();
    ctx.translate(o.x + side * u * 0.11, by - u * 0.58);
    ctx.rotate((action === 'walk' || action === 'run' ? ph * 0.3 : 0) - reach * 1.4 * flip * side);
    ctx.fillStyle = shade(metal, -0.1);
    ctx.fillRect(-u * 0.028, 0, u * 0.056, u * 0.26);
    stroked(ctx, st, lw);
    ctx.restore();
  }
  // head
  const hy = by - u * 0.74;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(o.x - u * 0.075, hy - u * 0.075, u * 0.15, u * 0.15, u * 0.03);
  else ctx.rect(o.x - u * 0.075, hy - u * 0.075, u * 0.15, u * 0.15);
  ctx.fillStyle = shade(metal, 0.08);
  ctx.fill();
  stroked(ctx, st, lw);
  // visor eye
  const em = o.inScene.emotion;
  const eyeCol = em === 'angry' || em === 'evil' ? '#ff4040' : em === 'sad' || em === 'worried' ? '#5aa9ff' : trim;
  ctx.beginPath();
  ctx.roundRect?.(o.x - u * 0.05, hy - u * 0.02, u * 0.1, u * 0.028, u * 0.014);
  if (!ctx.roundRect) ctx.rect(o.x - u * 0.05, hy - u * 0.02, u * 0.1, u * 0.028);
  ctx.fillStyle = eyeCol;
  ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(o.x, hy, 0, o.x, hy, u * 0.18);
  g.addColorStop(0, alpha(eyeCol, 0.55));
  g.addColorStop(1, alpha(eyeCol, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(o.x, hy, u * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // antenna
  ctx.beginPath();
  ctx.moveTo(o.x, hy - u * 0.075);
  ctx.lineTo(o.x + flip * u * 0.02, hy - u * 0.14);
  ctx.strokeStyle = shade(metal, -0.25);
  ctx.lineWidth = u * 0.008;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(o.x + flip * u * 0.02, hy - u * 0.145, u * 0.012, 0, Math.PI * 2);
  ctx.fillStyle = alpha('#ff6b6b', 0.5 + pulse * 0.5);
  ctx.fill();
  return { head: v(o.x, hy), handR: v(o.x + u * 0.13 * flip, by - u * 0.36) };
}

function drawAlien(ctx: Ctx, o: CharDrawOpts, action: ActionType): { head: V; handR: V } {
  const { def, style: st } = o;
  const u = o.height;
  const flip = o.inScene.facing === 'left' ? -1 : 1;
  const m = bodyMotion(action, o.t * st.animSpeed);
  const skin = styled(def.skin, st);
  const lw = u * 0.0012;
  const by = o.groundY - u * (m.bob + m.jump);

  for (const side of [-1, 1]) {
    const ph = Math.sin(o.t * st.animSpeed * 3.4 + (side > 0 ? Math.PI : 0));
    const moving = action === 'walk' || action === 'run' || action === 'flee';
    ctx.beginPath();
    ctx.moveTo(o.x + side * u * 0.035, by - u * 0.34);
    ctx.quadraticCurveTo(o.x + side * u * 0.05, by - u * 0.18, o.x + side * u * 0.05 + (moving ? ph * u * 0.06 : 0), by);
    ctx.strokeStyle = shade(skin, -0.15);
    ctx.lineWidth = u * 0.03;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  // slim torso
  ctx.beginPath();
  ctx.ellipse(o.x, by - u * 0.46, u * 0.065, u * 0.14, 0, 0, Math.PI * 2);
  ctx.fillStyle = skin;
  ctx.fill();
  stroked(ctx, st, lw);
  // long arms
  for (const side of [-1, 1]) {
    const reach = action === 'reach' || action === 'grab' ? 0.7 : 0;
    ctx.beginPath();
    ctx.moveTo(o.x + side * u * 0.055, by - u * 0.56);
    ctx.quadraticCurveTo(o.x + side * u * 0.14, by - u * (0.4 - reach * 0.1), o.x + side * u * (0.1 + reach * 0.12), by - u * (0.26 + reach * 0.16));
    ctx.strokeStyle = skin;
    ctx.lineWidth = u * 0.022;
    ctx.stroke();
  }
  // big head
  const hy = by - u * 0.72;
  ctx.beginPath();
  ctx.ellipse(o.x, hy, u * 0.105, u * 0.125, 0, 0, Math.PI * 2);
  ctx.fillStyle = shade(skin, 0.1);
  ctx.fill();
  stroked(ctx, st, lw);
  // almond eyes
  const big = o.inScene.emotion === 'shocked' || o.inScene.emotion === 'surprised' ? 1.3 : 1;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(o.x + side * u * 0.042 + flip * u * 0.005, hy + u * 0.015);
    ctx.rotate(side * -0.45);
    ctx.beginPath();
    ctx.ellipse(0, 0, u * 0.038 * big, u * 0.022 * big, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#0b0d12';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-u * 0.01, -u * 0.005, u * 0.008, u * 0.005, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.moveTo(o.x - u * 0.016, hy + u * 0.065);
  ctx.quadraticCurveTo(o.x, hy + u * (o.inScene.emotion === 'happy' ? 0.085 : 0.055), o.x + u * 0.016, hy + u * 0.065);
  ctx.strokeStyle = shade(skin, -0.5);
  ctx.lineWidth = u * 0.006;
  ctx.stroke();
  return { head: v(o.x, hy), handR: v(o.x + u * 0.12 * flip, by - u * 0.3) };
}

function drawMonster(ctx: Ctx, o: CharDrawOpts, action: ActionType): { head: V; handR: V } {
  const { def, style: st } = o;
  const u = o.height * 1.15;
  const flip = o.inScene.facing === 'left' ? -1 : 1;
  const m = bodyMotion(action, o.t * st.animSpeed);
  const hide = styled(def.skin, st);
  const lw = u * 0.0016;
  const by = o.groundY - u * (m.bob + m.jump);
  const r = rng(o.seed);

  // hulking legs
  for (const side of [-1, 1]) {
    const ph = Math.sin(o.t * st.animSpeed * 3 + (side > 0 ? Math.PI : 0));
    const moving = action === 'walk' || action === 'run' || action === 'flee';
    ctx.beginPath();
    ctx.ellipse(o.x + side * u * 0.1 + (moving ? ph * u * 0.06 : 0), by - u * 0.12, u * 0.07, u * 0.14, 0, 0, Math.PI * 2);
    ctx.fillStyle = shade(hide, -0.22);
    ctx.fill();
    stroked(ctx, st, lw);
  }
  // body
  ctx.beginPath();
  ctx.moveTo(o.x - u * 0.2, by - u * 0.2);
  ctx.quadraticCurveTo(o.x - u * 0.26, by - u * 0.56, o.x, by - u * 0.62);
  ctx.quadraticCurveTo(o.x + u * 0.26, by - u * 0.56, o.x + u * 0.2, by - u * 0.2);
  ctx.closePath();
  ctx.fillStyle = hide;
  ctx.fill();
  stroked(ctx, st, lw);
  // arms
  for (const side of [-1, 1]) {
    const atk = action === 'attack' ? Math.abs(Math.sin(o.t * 4)) : 0;
    ctx.beginPath();
    ctx.moveTo(o.x + side * u * 0.17, by - u * 0.52);
    ctx.quadraticCurveTo(o.x + side * u * 0.3, by - u * (0.32 + atk * 0.2), o.x + side * u * (0.24 + atk * 0.12), by - u * (0.12 + atk * 0.3));
    ctx.strokeStyle = shade(hide, -0.1);
    ctx.lineWidth = u * 0.06;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  // head
  const hy = by - u * 0.68;
  ctx.beginPath();
  ctx.ellipse(o.x + flip * u * 0.02, hy, u * 0.14, u * 0.11, 0, 0, Math.PI * 2);
  ctx.fillStyle = shade(hide, 0.05);
  ctx.fill();
  stroked(ctx, st, lw);
  // horns
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(o.x + side * u * 0.08, hy - u * 0.08);
    ctx.quadraticCurveTo(o.x + side * u * 0.16, hy - u * 0.2, o.x + side * u * 0.1, hy - u * 0.24);
    ctx.strokeStyle = '#e9e2d0';
    ctx.lineWidth = u * 0.022;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  // glowing eyes
  for (const side of [-1, 1]) {
    const ex = o.x + flip * u * 0.03 + side * u * 0.05;
    ctx.beginPath();
    ctx.ellipse(ex, hy - u * 0.01, u * 0.02, u * 0.012, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ffdc4d';
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(ex, hy, 0, ex, hy, u * 0.08);
    g.addColorStop(0, 'rgba(255,200,60,0.6)');
    g.addColorStop(1, 'rgba(255,200,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ex, hy, u * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // teeth
  ctx.fillStyle = '#f3efe2';
  for (let i = 0; i < 5; i++) {
    const tx = o.x + flip * u * 0.02 - u * 0.07 + i * u * 0.035;
    ctx.beginPath();
    ctx.moveTo(tx, hy + u * 0.05);
    ctx.lineTo(tx + u * 0.012, hy + u * (0.09 + r() * 0.02));
    ctx.lineTo(tx + u * 0.024, hy + u * 0.05);
    ctx.closePath();
    ctx.fill();
  }
  return { head: v(o.x, hy), handR: v(o.x + u * 0.26 * flip, by - u * 0.2) };
}

function drawCreature(ctx: Ctx, o: CharDrawOpts, action: ActionType): { head: V; handR: V } {
  const { def, style: st } = o;
  const u = o.height * 0.8;
  const m = bodyMotion(action, o.t * st.animSpeed);
  const body = styled(def.skin, st);
  const float = Math.sin(o.t * 1.3) * u * 0.03;
  const cy = o.groundY - u * (0.34 + m.bob) + float;
  const lw = u * 0.0018;

  // tendrils
  for (let i = 0; i < 5; i++) {
    const ang = -Math.PI / 2 + (i / 4 - 0.5) * 1.8;
    const len = u * (0.2 + (i % 2) * 0.1);
    ctx.beginPath();
    ctx.moveTo(o.x + Math.cos(ang) * u * 0.1, cy + u * 0.1);
    ctx.quadraticCurveTo(
      o.x + Math.cos(ang) * u * 0.18 + Math.sin(o.t * 2 + i) * u * 0.04,
      cy + u * 0.1 + len * 0.6,
      o.x + Math.cos(ang) * u * 0.2 + Math.sin(o.t * 2.4 + i) * u * 0.06,
      cy + u * 0.1 + len,
    );
    ctx.strokeStyle = shade(body, -0.2);
    ctx.lineWidth = u * 0.022;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  // blobby body
  ctx.beginPath();
  const pts = 12;
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    const wob = 1 + Math.sin(a * 3 + o.t * 1.8) * 0.07;
    const px = o.x + Math.cos(a) * u * 0.2 * wob;
    const py = cy + Math.sin(a) * u * 0.17 * wob;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  if (st.flat) ctx.fillStyle = body;
  else {
    const g = ctx.createRadialGradient(o.x - u * 0.06, cy - u * 0.06, u * 0.02, o.x, cy, u * 0.24);
    g.addColorStop(0, shade(body, 0.22));
    g.addColorStop(1, shade(body, -0.18));
    ctx.fillStyle = g;
  }
  ctx.fill();
  stroked(ctx, st, lw);
  // eyes
  const n = o.inScene.emotion === 'evil' ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const ex = o.x + (i - (n - 1) / 2) * u * 0.08;
    const open = o.inScene.emotion === 'scared' || o.inScene.emotion === 'shocked' ? 1.4 : 1;
    ctx.beginPath();
    ctx.ellipse(ex, cy - u * 0.02, u * 0.03, u * 0.035 * open, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#f8f9fa';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex, cy - u * 0.02, u * 0.016, 0, Math.PI * 2);
    ctx.fillStyle = '#15181d';
    ctx.fill();
  }
  return { head: v(o.x, cy), handR: v(o.x + u * 0.2, cy + u * 0.1) };
}

function drawVehicle(ctx: Ctx, o: CharDrawOpts, action: ActionType): { head: V; handR: V } {
  const { def, style: st } = o;
  const u = o.height * 0.75;
  const flip = o.inScene.facing === 'left' ? -1 : 1;
  const moving = action === 'walk' || action === 'run' || action === 'flee';
  const bounce = moving ? Math.sin(o.t * 9) * u * 0.008 : Math.sin(o.t * 1.4) * u * 0.003;
  const y = o.groundY + bounce;
  const paint = styled(def.skin, st);
  const lw = u * 0.0018;

  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(o.x - u * 0.42, y - u * 0.24, u * 0.84, u * 0.18, u * 0.04);
  else ctx.rect(o.x - u * 0.42, y - u * 0.24, u * 0.84, u * 0.18);
  ctx.fillStyle = paint;
  ctx.fill();
  stroked(ctx, st, lw);
  ctx.beginPath();
  ctx.moveTo(o.x - u * 0.22, y - u * 0.24);
  ctx.lineTo(o.x - u * 0.12, y - u * 0.42);
  ctx.lineTo(o.x + u * 0.14, y - u * 0.42);
  ctx.lineTo(o.x + u * 0.24, y - u * 0.24);
  ctx.closePath();
  ctx.fillStyle = shade(paint, -0.08);
  ctx.fill();
  stroked(ctx, st, lw);
  ctx.fillStyle = '#9ad2f5';
  ctx.fillRect(o.x - u * 0.1, y - u * 0.39, u * 0.2, u * 0.13);
  // wheels
  ctx.fillStyle = '#16181c';
  for (const ox of [-0.25, 0.25]) {
    ctx.save();
    ctx.translate(o.x + u * ox, y - u * 0.04);
    if (moving) ctx.rotate(o.t * 9);
    ctx.beginPath();
    ctx.arc(0, 0, u * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4b5159';
    ctx.lineWidth = u * 0.012;
    ctx.beginPath();
    ctx.moveTo(-u * 0.05, 0);
    ctx.lineTo(u * 0.05, 0);
    ctx.stroke();
    ctx.restore();
  }
  // headlight
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const hx = o.x + flip * u * 0.42;
  const g = ctx.createRadialGradient(hx, y - u * 0.15, 0, hx, y - u * 0.15, u * 0.7);
  g.addColorStop(0, 'rgba(255,243,196,0.6)');
  g.addColorStop(1, 'rgba(255,243,196,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(hx, y - u * 0.15, u * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return { head: v(o.x, y - u * 0.4), handR: v(hx, y - u * 0.15) };
}

function drawShadowFigure(ctx: Ctx, o: CharDrawOpts, action: ActionType, next: ActionType, blend: number): { head: V; handR: V } {
  // A shadow is a humanoid silhouette: reuse the human skeleton but fill flat black with a soft edge.
  const sub: CharDrawOpts = { ...o, style: { ...o.style, outline: null, flat: true, bloom: 0 } };
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.filter = o.quality === 'low' ? 'none' : `blur(${Math.max(1, o.height * 0.004)}px)`;
  const def: CharacterDef = { ...o.def, skin: '#0a0b10', topColor: '#0a0b10', bottomColor: '#07080c', shoeColor: '#05060a', hairColor: '#07080c' };
  const res = drawHuman(ctx, { ...sub, def }, action, next, blend);
  ctx.restore();
  // faint glowing eyes so the silhouette reads as a presence
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const side of [-1, 1]) {
    const ex = res.head.x + side * o.height * 0.022;
    const g = ctx.createRadialGradient(ex, res.head.y, 0, ex, res.head.y, o.height * 0.03);
    g.addColorStop(0, 'rgba(220,240,255,0.75)');
    g.addColorStop(1, 'rgba(220,240,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ex, res.head.y, o.height * 0.03, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  return res;
}

function drawObjectBeing(ctx: Ctx, o: CharDrawOpts, action: ActionType): { head: V; handR: V } {
  const { def, style: st } = o;
  const u = o.height * 0.5;
  const float = Math.sin(o.t * 1.5) * u * 0.05;
  const cy = o.groundY - u * 0.6 + float;
  const spin = action === 'turn' || action === 'idle' ? o.t * 0.5 : o.t * 0.2;
  const c = styled(def.skin, st);
  ctx.save();
  ctx.translate(o.x, cy);
  ctx.rotate(Math.sin(spin) * 0.2);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const px = Math.cos(a) * u * 0.3;
    const py = Math.sin(a) * u * 0.3;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(-u * 0.3, -u * 0.3, u * 0.3, u * 0.3);
  g.addColorStop(0, shade(c, 0.25));
  g.addColorStop(1, shade(c, -0.25));
  ctx.fillStyle = st.flat ? c : g;
  ctx.fill();
  stroked(ctx, st, u * 0.004);
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const gg = ctx.createRadialGradient(o.x, cy, 0, o.x, cy, u * 0.9);
  gg.addColorStop(0, alpha(c, 0.4));
  gg.addColorStop(1, alpha(c, 0));
  ctx.fillStyle = gg;
  ctx.beginPath();
  ctx.arc(o.x, cy, u * 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return { head: v(o.x, cy), handR: v(o.x + u * 0.3, cy) };
}

function drawAbstract(ctx: Ctx, o: CharDrawOpts, action: ActionType): { head: V; handR: V } {
  const { def, style: st } = o;
  const u = o.height * 0.6;
  const cy = o.groundY - u * 0.7 + Math.sin(o.t * 1.1) * u * 0.04;
  const c = styled(def.skin, st);
  const n = 3;
  const energy = action === 'attack' || action === 'react' ? 1.5 : 1;
  ctx.save();
  ctx.globalCompositeOperation = st.flat ? 'source-over' : 'lighter';
  for (let i = 0; i < n; i++) {
    const r = u * (0.18 + i * 0.09);
    const a = o.t * (0.6 + i * 0.25) * energy;
    ctx.save();
    ctx.translate(o.x + Math.cos(a) * u * 0.05, cy + Math.sin(a * 1.3) * u * 0.05);
    ctx.rotate(a * 0.5);
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.72, 0, 0, Math.PI * 2);
    ctx.strokeStyle = alpha(i % 2 ? c : styled(def.topColor, st), 0.55 - i * 0.12);
    ctx.lineWidth = u * 0.022;
    ctx.stroke();
    ctx.restore();
  }
  const g = ctx.createRadialGradient(o.x, cy, 0, o.x, cy, u * 0.5);
  g.addColorStop(0, alpha(c, 0.75));
  g.addColorStop(1, alpha(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(o.x, cy, u * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return { head: v(o.x, cy), handR: v(o.x + u * 0.3, cy) };
}
