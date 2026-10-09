import Phaser from 'phaser';

const MAX_ZOOM = 8;
const WHEEL_ZOOM_STEP = 1.0015;

/** Screen pixels covered by overlays along the top and bottom edges. */
export interface Insets {
  top: number;
  bottom: number;
}

/**
 * Pan and zoom for a world of fixed size: drag to pan, pinch or mouse wheel to zoom toward the
 * pointer, and smooth following of a target. Works the same with mouse, touch and pen.
 *
 * The camera may scroll past the top and bottom of the map by the height of the overlays there
 * (HUD, touch controls), so a unit at the edge of the map can still be seen clear of them.
 */
export class CameraControls {
  private readonly scene: Phaser.Scene;
  private readonly cam: Phaser.Cameras.Scene2D.Camera;
  private readonly worldWidth: number;
  private readonly worldHeight: number;
  private pinchDistance = 0;
  /** When the user last panned by hand; following pauses for a moment after that. */
  private lastManual = -Infinity;
  private insets: Insets = { top: 0, bottom: 0 };

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

  /** Sets how much of the screen the overlays cover, in screen pixels. */
  setInsets(insets: Insets): void {
    this.insets = insets;
    this.setZoom(this.cam.zoom);
  }

  /** Eases the camera toward (x, y), placed in the middle of the uncovered area, unless the user recently panned by hand. */
  follow(x: number, y: number, delta: number): void {
    if (this.scene.time.now - this.lastManual < 2500) return;
    const cam = this.cam;
    const t = 1 - Math.exp(-delta / 120);
    const cx = cam.scrollX + cam.width / 2;
    const cy = cam.scrollY + cam.height / 2;
    const ty = y - (this.insets.top - this.insets.bottom) / 2 / cam.zoom;
    cam.centerOn(cx + (x - cx) * t, cy + (ty - cy) * t);
  }

  /** Jump to a spot chosen by the user (e.g. on the minimap), pausing following for a moment. */
  lookAt(x: number, y: number): void {
    this.lastManual = this.scene.time.now;
    this.cam.centerOn(x, y);
  }

  /** Resume following straight away (e.g. when the player moves). */
  resumeFollowing(): void {
    this.lastManual = -Infinity;
  }

  private minZoom(): number {
    const { width, height } = this.scene.scale;
    return Math.min(width / this.worldWidth, height / this.worldHeight);
  }

  private clampZoom(): void {
    this.setZoom(Phaser.Math.Clamp(this.cam.zoom, this.minZoom(), MAX_ZOOM));
  }

  /**
   * Sets the zoom and the camera bounds: the map plus room under the overlays, widened on any
   * axis where that is smaller than the view, so it stays centred.
   */
  private setZoom(zoom: number): void {
    const viewW = this.scene.scale.width / zoom;
    const viewH = this.scene.scale.height / zoom;
    const top = -this.insets.top / zoom;
    const height = this.worldHeight - top + this.insets.bottom / zoom;
    const boundsW = Math.max(this.worldWidth, viewW);
    const boundsH = Math.max(height, viewH);
    this.cam.setZoom(zoom);
    this.cam.setBounds((this.worldWidth - boundsW) / 2, top + (height - boundsH) / 2, boundsW, boundsH);
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
      this.lastManual = this.scene.time.now;
      const dx = (pointer.x - pointer.prevPosition.x) / this.cam.zoom;
      const dy = (pointer.y - pointer.prevPosition.y) / this.cam.zoom;
      this.cam.setScroll(this.cam.scrollX - dx, this.cam.scrollY - dy);
    }
  }

  private onWheel(pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, deltaY: number): void {
    this.zoomBy(Math.pow(WHEEL_ZOOM_STEP, -deltaY), pointer.x, pointer.y);
  }
}
