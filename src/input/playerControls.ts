import type { PlayerInput } from '../sim/player.ts';

type Pressable = 'special' | 'switchUnit' | 'cycleSpecial' | 'yell';

/** Modern defaults; the original used a QWE/AD/ZXC grid with Ctrl to fire. */
const KEYS: Record<string, { move?: [number, number]; hold?: 'fire' | 'alternate'; press?: Pressable }> = {
  KeyW: { move: [0, -1] },
  ArrowUp: { move: [0, -1] },
  KeyS: { move: [0, 1] },
  ArrowDown: { move: [0, 1] },
  KeyA: { move: [-1, 0] },
  ArrowLeft: { move: [-1, 0] },
  KeyD: { move: [1, 0] },
  ArrowRight: { move: [1, 0] },
  Space: { hold: 'fire' },
  KeyJ: { hold: 'fire' },
  ShiftLeft: { hold: 'alternate' },
  ShiftRight: { hold: 'alternate' },
  KeyE: { press: 'special' },
  KeyK: { press: 'special' },
  KeyQ: { press: 'cycleSpecial' },
  Tab: { press: 'switchUnit' },
  KeyF: { press: 'yell' },
};

const STICK_DEADZONE = 0.35;

/**
 * Collects player 1's input from keyboard, gamepad and the on-screen touch controls. Held
 * state is sampled each tick; button presses are latched until the next tick consumes them.
 */
export class PlayerControls {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<Pressable>();
  private touchMove: [number, number] = [0, 0];
  private touchFire = false;
  private touchAlternate = false;
  private padPressedLast = new Set<number>();
  /** Called on the first input, e.g. to start the battle. */
  onActivity?: () => void;
  private readonly cleanup: (() => void)[] = [];

  constructor(touchRoot: HTMLElement | null) {
    const down = (e: KeyboardEvent) => {
      const binding = KEYS[e.code];
      if (!binding || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      if (binding.press && !e.repeat) this.pressed.add(binding.press);
      this.held.add(e.code);
      this.onActivity?.();
    };
    const up = (e: KeyboardEvent) => this.held.delete(e.code);
    const blur = () => this.held.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    this.cleanup.push(() => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    });
    if (touchRoot) this.bindTouch(touchRoot);
  }

  /** Samples input for one tick and clears latched presses. */
  read(): PlayerInput {
    let moveX = 0;
    let moveY = 0;
    let fire = this.touchFire;
    let alternate = this.touchAlternate;
    for (const code of this.held) {
      const b = KEYS[code];
      if (b?.move) {
        moveX += b.move[0];
        moveY += b.move[1];
      }
      if (b?.hold === 'fire') fire = true;
      if (b?.hold === 'alternate') alternate = true;
    }
    moveX += this.touchMove[0];
    moveY += this.touchMove[1];

    const pad = this.readGamepad();
    moveX += pad.moveX;
    moveY += pad.moveY;
    fire ||= pad.fire;
    alternate ||= pad.alternate;

    const input: PlayerInput = {
      moveX: Math.sign(moveX),
      moveY: Math.sign(moveY),
      fire,
      alternate,
      special: this.pressed.has('special'),
      switchUnit: this.pressed.has('switchUnit'),
      cycleSpecial: this.pressed.has('cycleSpecial'),
      yell: this.pressed.has('yell'),
    };
    this.pressed.clear();
    return input;
  }

  destroy(): void {
    this.cleanup.forEach((fn) => fn());
  }

  /** Standard gamepad: left stick/d-pad moves, A fires, B special, Y yell, X switch, LB cycle, RB alternate. */
  private readGamepad(): { moveX: number; moveY: number; fire: boolean; alternate: boolean } {
    const pad = navigator.getGamepads?.().find((p) => p?.connected);
    if (!pad) return { moveX: 0, moveY: 0, fire: false, alternate: false };
    const button = (i: number) => pad.buttons[i]?.pressed ?? false;
    let moveX = Math.abs(pad.axes[0] ?? 0) > STICK_DEADZONE ? Math.sign(pad.axes[0]) : 0;
    let moveY = Math.abs(pad.axes[1] ?? 0) > STICK_DEADZONE ? Math.sign(pad.axes[1]) : 0;
    if (button(12)) moveY = -1;
    if (button(13)) moveY = 1;
    if (button(14)) moveX = -1;
    if (button(15)) moveX = 1;

    const presses: [number, Pressable][] = [[1, 'special'], [2, 'switchUnit'], [3, 'yell'], [4, 'cycleSpecial']];
    const now = new Set<number>();
    for (const [i, action] of presses) {
      if (button(i)) {
        now.add(i);
        if (!this.padPressedLast.has(i)) this.pressed.add(action);
      }
    }
    this.padPressedLast = now;
    const fire = button(0) || button(7);
    if (moveX || moveY || fire || now.size) this.onActivity?.();
    return { moveX, moveY, fire, alternate: button(5) };
  }

  /** On-screen joystick plus action buttons for phones and tablets. */
  private bindTouch(root: HTMLElement): void {
    const stick = root.querySelector<HTMLElement>('.stick');
    const knob = root.querySelector<HTMLElement>('.stick-knob');
    if (stick && knob) {
      let pointer: number | null = null;
      const move = (e: PointerEvent) => {
        const r = stick.getBoundingClientRect();
        const radius = r.width / 2;
        let dx = (e.clientX - (r.left + radius)) / radius;
        let dy = (e.clientY - (r.top + radius)) / radius;
        const len = Math.hypot(dx, dy);
        if (len > 1) {
          dx /= len;
          dy /= len;
        }
        knob.style.transform = `translate(${dx * radius * 0.6}px, ${dy * radius * 0.6}px)`;
        // Eight-way: each axis counts once it passes the deadzone.
        this.touchMove = [Math.abs(dx) > STICK_DEADZONE ? Math.sign(dx) : 0, Math.abs(dy) > STICK_DEADZONE ? Math.sign(dy) : 0];
        this.onActivity?.();
      };
      const end = (e: PointerEvent) => {
        if (e.pointerId !== pointer) return;
        pointer = null;
        this.touchMove = [0, 0];
        knob.style.transform = '';
      };
      stick.addEventListener('pointerdown', (e) => {
        pointer = e.pointerId;
        stick.setPointerCapture(e.pointerId);
        move(e);
      });
      stick.addEventListener('pointermove', (e) => e.pointerId === pointer && move(e));
      stick.addEventListener('pointerup', end);
      stick.addEventListener('pointercancel', end);
    }

    for (const el of root.querySelectorAll<HTMLElement>('[data-touch]')) {
      const action = el.dataset.touch!;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        el.classList.add('down');
        if (action === 'fire') this.touchFire = true;
        else if (action === 'alternate') {
          this.touchAlternate = !this.touchAlternate;
          el.classList.toggle('on', this.touchAlternate);
        } else this.pressed.add(action as Pressable);
        this.onActivity?.();
      });
      const release = () => {
        el.classList.remove('down');
        if (action === 'fire') this.touchFire = false;
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
    }
  }
}
