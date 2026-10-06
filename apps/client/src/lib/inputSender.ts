// inputSender.ts — Captures mouse/keyboard/touch events from the canvas
// and sends them as normalized input events to the host via WebRTC DataChannel

export interface InputSenderOptions {
  canvas: HTMLCanvasElement;
  remoteWidth: number;
  remoteHeight: number;
  send: (event: object) => void;
}

export class InputSender {
  private canvas: HTMLCanvasElement;
  private rw: number;
  private rh: number;
  private send: (e: object) => void;
  private listeners: Array<[string, EventListener]> = [];
  private lastTouchDist = 0;

  constructor(opts: InputSenderOptions) {
    this.canvas = opts.canvas;
    this.rw = opts.remoteWidth;
    this.rh = opts.remoteHeight;
    this.send = opts.send;
    this.attach();
  }

  /** Normalize canvas pixel coords to 0.0–1.0 */
  private normalize(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
      screenWidth: this.rw,
      screenHeight: this.rh,
    };
  }

  private on(type: string, handler: EventListener, opts?: AddEventListenerOptions) {
    this.canvas.addEventListener(type, handler, opts);
    this.listeners.push([type, handler]);
  }

  private attach() {
    // ── Mouse events ──────────────────────────

    this.on('mousemove', (e: Event) => {
      const me = e as MouseEvent;
      this.send({ type: 'mouse_move', ...this.normalize(me.clientX, me.clientY) });
    });

    this.on('mousedown', (e: Event) => {
      const me = e as MouseEvent;
      e.preventDefault();
      this.send({
        type: 'mouse_click',
        ...this.normalize(me.clientX, me.clientY),
        button: me.button === 2 ? 'right' : me.button === 1 ? 'middle' : 'left',
        action: 'press',
      });
    });

    this.on('mouseup', (e: Event) => {
      const me = e as MouseEvent;
      this.send({
        type: 'mouse_click',
        ...this.normalize(me.clientX, me.clientY),
        button: me.button === 2 ? 'right' : me.button === 1 ? 'middle' : 'left',
        action: 'release',
      });
    });

    this.on('dblclick', (e: Event) => {
      const me = e as MouseEvent;
      this.send({
        type: 'mouse_click',
        ...this.normalize(me.clientX, me.clientY),
        button: 'left',
        action: 'double_click',
      });
    });

    this.on('contextmenu', (e: Event) => {
      e.preventDefault(); // Block browser context menu
    });

    this.on('wheel', (e: Event) => {
      const we = e as WheelEvent;
      e.preventDefault();
      this.send({
        type: 'mouse_scroll',
        delta_x: Math.round(we.deltaX / 10),
        delta_y: Math.round(we.deltaY / 10),
      });
    }, { passive: false });

    // ── Touch events (mobile trackpad) ────────

    this.on('touchstart', (e: Event) => {
      const te = e as TouchEvent;
      e.preventDefault();
      if (te.touches.length === 2) {
        this.lastTouchDist = this.getTouchDist(te);
      }
    }, { passive: false });

    this.on('touchmove', (e: Event) => {
      const te = e as TouchEvent;
      e.preventDefault();

      if (te.touches.length === 1) {
        // Single finger → relative mouse move (trackpad style)
        const t = te.touches[0];
        this.send({ type: 'mouse_move', ...this.normalize(t.clientX, t.clientY) });
      } else if (te.touches.length === 2) {
        // Two fingers → scroll
        const dist = this.getTouchDist(te);
        const delta = this.lastTouchDist - dist;
        this.lastTouchDist = dist;
        this.send({ type: 'mouse_scroll', delta_x: 0, delta_y: Math.round(delta / 5) });
      }
    }, { passive: false });

    this.on('touchend', (e: Event) => {
      const te = e as TouchEvent;
      e.preventDefault();
      if (te.changedTouches.length === 1 && te.touches.length === 0) {
        const t = te.changedTouches[0];
        this.send({
          type: 'mouse_click',
          ...this.normalize(t.clientX, t.clientY),
          button: 'left',
          action: 'click',
        });
      }
    }, { passive: false });

    // ── Keyboard events ───────────────────────
    // Attached to window (canvas can't receive keyboard)

    const keyHandler = (e: Event) => {
      const ke = e as KeyboardEvent;
      // Don't capture browser shortcuts (F5, F12, Ctrl+W, etc.)
      if (ke.key === 'F5' || ke.key === 'F12') return;
      if (ke.ctrlKey && (ke.key === 'w' || ke.key === 't' || ke.key === 'n')) return;

      ke.preventDefault();
      this.send({
        type: 'key_event',
        key: ke.code,
        action: ke.type === 'keydown' ? 'press' : 'release',
      });
    };

    window.addEventListener('keydown', keyHandler as EventListener);
    window.addEventListener('keyup', keyHandler as EventListener);
    this.listeners.push(['_window_keydown', keyHandler as EventListener]);
  }

  private getTouchDist(te: TouchEvent): number {
    const dx = te.touches[0].clientX - te.touches[1].clientX;
    const dy = te.touches[0].clientY - te.touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  updateRemoteSize(w: number, h: number) {
    this.rw = w;
    this.rh = h;
  }

  destroy() {
    for (const [type, handler] of this.listeners) {
      if (type.startsWith('_window_')) {
        const realType = type.replace('_window_', '');
        window.removeEventListener(realType, handler);
      } else {
        this.canvas.removeEventListener(type, handler);
      }
    }
    this.listeners = [];
  }
}
