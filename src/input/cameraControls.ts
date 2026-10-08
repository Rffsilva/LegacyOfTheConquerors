import Phaser from 'phaser';

const MAX_ZOOM = 8;
const KEY_PAN_SPEED = 600; // screen pixels per second
const WHEEL_ZOOM_STEP = 1.0015;

/**
 * Pan and zoom for a world of fixed size: drag or arrow keys/WASD to pan, pinch or mouse wheel
 * to zoom toward the pointer. Works the same with mouse, touch and pen.
 */
export class CameraControls {
  private readonly scene: Phaser.Scene;
  private readonly cam: Phaser.Cameras.Scene2D.Camera;
  private readonly worldWidth: number;
  private readonly worldHeight: number;
  private pinchDistance = 0;
  private keys?: Record<'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

  constructor(scene: Phaser.Scene, worldWidth: number, worldHeight: number) {
    this.scene = scene;
    this.cam = scene.cameras.main;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;

    this.cam.setRoundPixels(true);
    scene.input.addPointer(1); // second touch for pinch

    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, () => (this.pinchDistance = 0));
    scene.input.on(Phaser.Input.Events.POINTER_WHEEL, this.onWheel, this);
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.clampZoom, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.scale.off(Phaser.Scale.Events.RESIZE, this.clampZoom, this));

    this.keys = scene.input.keyboard?.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D') as typeof this.keys;

    this.setZoom(this.defaultZoom());
  }

  /** Zoom that shows roughly the original 320x200 view, never smaller than fitting the map. */
  defaultZoom(): number {
    const { width, height } = this.scene.scale;
    return Phaser.Math.Clamp(Math.min(width / 320, height / 200), this.minZoom(), MAX_ZOOM);
  }

  centerOn(x: number, y: number): void {
    this.cam.centerOn(x, y);
  }

  /** Multiplies the zoom, keeping the world point under (screenX, screenY) fixed. */
  zoomBy(factor: number, screenX = this.cam.width / 2, screenY = this.cam.height / 2): void {
    const cam = this.cam;
    const oldZoom = cam.zoom;
    const newZoom = Phaser.Math.Clamp(oldZoom * factor, this.minZoom(), MAX_ZOOM);
    if (newZoom === oldZoom) return;
    const halfW = cam.width / 2;
    const halfH = cam.height / 2;
    const worldX = cam.scrollX + halfW + (screenX - halfW) / oldZoom;
    const worldY = cam.scrollY + halfH + (screenY - halfH) / oldZoom;
    this.setZoom(newZoom);
    cam.setScroll(worldX - halfW - (screenX - halfW) / newZoom, worldY - halfH - (screenY - halfH) / newZoom);
  }

  update(delta: number): void {
    if (!this.keys) return;
    const k = this.keys;
    const step = (KEY_PAN_SPEED * delta) / 1000 / this.cam.zoom;
    const dx = (k.RIGHT.isDown || k.D.isDown ? 1 : 0) - (k.LEFT.isDown || k.A.isDown ? 1 : 0);
    const dy = (k.DOWN.isDown || k.S.isDown ? 1 : 0) - (k.UP.isDown || k.W.isDown ? 1 : 0);
    if (dx || dy) this.cam.setScroll(this.cam.scrollX + dx * step, this.cam.scrollY + dy * step);
  }

  private minZoom(): number {
    const { width, height } = this.scene.scale;
    return Math.min(width / this.worldWidth, height / this.worldHeight);
  }

  private clampZoom(): void {
    this.setZoom(Phaser.Math.Clamp(this.cam.zoom, this.minZoom(), MAX_ZOOM));
  }

  /** Sets the zoom and widens the camera bounds on any axis where the map is smaller than the view, so it stays centred. */
  private setZoom(zoom: number): void {
    const viewW = this.scene.scale.width / zoom;
    const viewH = this.scene.scale.height / zoom;
    const boundsW = Math.max(this.worldWidth, viewW);
    const boundsH = Math.max(this.worldHeight, viewH);
    this.cam.setZoom(zoom);
    this.cam.setBounds((this.worldWidth - boundsW) / 2, (this.worldHeight - boundsH) / 2, boundsW, boundsH);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const input = this.scene.input;
    const a = input.pointer1;
    const b = input.pointer2;

    if (a.isDown && b.isDown) {
      const distance = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
      if (this.pinchDistance > 0) {
        this.zoomBy(distance / this.pinchDistance, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      this.pinchDistance = distance;
      return;
    }

    if (pointer.isDown) {
      const dx = (pointer.x - pointer.prevPosition.x) / this.cam.zoom;
      const dy = (pointer.y - pointer.prevPosition.y) / this.cam.zoom;
      this.cam.setScroll(this.cam.scrollX - dx, this.cam.scrollY - dy);
    }
  }

  private onWheel(pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, deltaY: number): void {
    this.zoomBy(Math.pow(WHEEL_ZOOM_STEP, -deltaY), pointer.x, pointer.y);
  }
}
