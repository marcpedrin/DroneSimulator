/**
 * controls.js — Keyboard bindings, on-screen DJI joystick UI, visual feedback
 *
 * Left stick:   Throttle (W/S) + Yaw (A/D)
 * Right stick:  Pitch (↑/↓)   + Roll (←/→)
 * Space:        Arm / Disarm
 * R:            Reset
 * G:            Wind Gust
 * C:            Toggle Camera Mode
 */

'use strict';

const KEY_MAP = {
  KeyW:         { stick: 'left',  axis: 'y',  dir:  1, label: 'W',   action: 'Throttle ↑' },
  KeyS:         { stick: 'left',  axis: 'y',  dir: -1, label: 'S',   action: 'Throttle ↓' },
  KeyA:         { stick: 'left',  axis: 'x',  dir: -1, label: 'A',   action: 'Yaw ←' },
  KeyD:         { stick: 'left',  axis: 'x',  dir:  1, label: 'D',   action: 'Yaw →' },
  ArrowUp:      { stick: 'right', axis: 'y',  dir:  1, label: '↑',   action: 'Pitch Fwd' },
  ArrowDown:    { stick: 'right', axis: 'y',  dir: -1, label: '↓',   action: 'Pitch Back' },
  ArrowLeft:    { stick: 'right', axis: 'x',  dir: -1, label: '←',   action: 'Roll ←' },
  ArrowRight:   { stick: 'right', axis: 'x',  dir:  1, label: '→',   action: 'Roll →' },
  Space:        { action: 'arm'   },
  KeyR:         { action: 'reset' },
  KeyG:         { action: 'gust'  },
  KeyC:         { action: 'camera' },
};

export class ControlInterface {
  /**
   * @param {HTMLElement} container  — bottom-right panel
   * @param {Object}      callbacks  — { onInput, onArm, onReset, onGust, onCamera }
   */
  constructor(container, callbacks) {
    this.container = container;
    this.cb        = callbacks;
    this.mode      = 'qr';    // 'qr' | 'keyboard'

    // Mode 2: left Y = throttle (starts at bottom = 0%, holds on release)
    //         left X = yaw (springs to center)
    //         right X/Y = roll/pitch (spring to center)
    this.leftStick  = { x: 0, y: -1 }; // throttle starts at 0 (bottom)
    this.rightStick = { x: 0, y: 0 };
    this.heldKeys   = new Set();

    this._buildUI();
    this._bindKeyboard();
    this._startInputLoop();
  }

  // ─── UI Construction ──────────────────────────────────────────────────────

  _buildUI() {
    this.container.innerHTML = `
      <div class="ctrl-panel">
        <div class="ctrl-header">
          <span class="ctrl-title">🎮 Controller</span>
          <div class="ctrl-mode-btns">
            <button class="ctrl-mode-btn active" id="btn-qr-mode">
              📷 QR Code
            </button>
            <button class="ctrl-mode-btn" id="btn-kb-mode">
              ⌨ Keyboard
            </button>
          </div>
        </div>

        <!-- QR Section -->
        <div class="ctrl-section" id="section-qr">
          <div class="qr-wrapper">
            <div class="qr-label">Scan to open mobile controller</div>
            <div class="qr-canvas-wrap" id="qr-canvas-wrap" style="display:flex;justify-content:center;align-items:center;"></div>
            <a class="qr-url" id="qr-url-text" href="#" target="_blank" rel="noopener noreferrer">Loading...</a>
            <div class="qr-status" id="qr-conn-status">
              <span class="conn-dot disconnected"></span>
              <span id="conn-label">Awaiting connection</span>
            </div>
          </div>
        </div>

        <!-- Keyboard Section (hidden by default) -->
        <div class="ctrl-section hidden" id="section-keyboard">
          <div class="dji-controller">

            <!-- Left stick area -->
            <div class="stick-area left-stick-area">
              <div class="stick-label-top">THROTTLE / YAW</div>
              <div class="stick-housing" id="stick-left">
                <div class="stick-knob" id="knob-left"></div>
                <div class="stick-key-hint hint-top"   id="hint-left-top">W</div>
                <div class="stick-key-hint hint-bottom" id="hint-left-bot">S</div>
                <div class="stick-key-hint hint-left"  id="hint-left-left">A</div>
                <div class="stick-key-hint hint-right"  id="hint-left-right">D</div>
              </div>
            </div>

            <!-- Center buttons -->
            <div class="center-buttons">
              <div class="hud-badge">
                <div class="hud-badge-label">ALT</div>
                <div class="hud-badge-value" id="hud-alt">0.0m</div>
              </div>
              <button class="center-btn arm-btn" id="ctrl-arm">
                <span>ARM</span>
                <kbd>SPACE</kbd>
              </button>
              <button class="center-btn action-btn" id="ctrl-gust">
                <span>💨 GUST</span>
                <kbd>G</kbd>
              </button>
              <button class="center-btn action-btn" id="ctrl-reset">
                <span>↺ RESET</span>
                <kbd>R</kbd>
              </button>
              <button class="center-btn action-btn" id="ctrl-camera">
                <span>📷 CAM</span>
                <kbd>C</kbd>
              </button>
              <div class="hud-badge">
                <div class="hud-badge-label">MODE</div>
                <div class="hud-badge-value" id="hud-mode">FREE</div>
              </div>
            </div>

            <!-- Right stick area -->
            <div class="stick-area right-stick-area">
              <div class="stick-label-top">PITCH / ROLL</div>
              <div class="stick-housing" id="stick-right">
                <div class="stick-knob" id="knob-right"></div>
                <div class="stick-key-hint hint-top"    id="hint-right-top">↑</div>
                <div class="stick-key-hint hint-bottom" id="hint-right-bot">↓</div>
                <div class="stick-key-hint hint-left"   id="hint-right-left">←</div>
                <div class="stick-key-hint hint-right"  id="hint-right-right">→</div>
              </div>
            </div>

          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-qr-mode').addEventListener('click', () => this._setMode('qr'));
    document.getElementById('btn-kb-mode').addEventListener('click', () => this._setMode('keyboard'));
    document.getElementById('ctrl-arm').addEventListener('click',    () => this._triggerArm());
    document.getElementById('ctrl-reset').addEventListener('click',  () => this.cb.onReset?.());
    document.getElementById('ctrl-gust').addEventListener('click',   () => this.cb.onGust?.());
    document.getElementById('ctrl-camera').addEventListener('click', () => this._triggerCamera());
  }

  _setMode(mode) {
    this.mode = mode;
    document.getElementById('section-qr').classList.toggle('hidden',      mode !== 'qr');
    document.getElementById('section-keyboard').classList.toggle('hidden', mode !== 'keyboard');
    document.getElementById('btn-qr-mode').classList.toggle('active', mode === 'qr');
    document.getElementById('btn-kb-mode').classList.toggle('active', mode === 'keyboard');
  }

  // ─── QR Code ──────────────────────────────────────────────────────────────

  showQR(url) {
    this._qrUrl = url;
    this._tryRenderQR();
  }

  _tryRenderQR() {
    const wrap   = document.getElementById('qr-canvas-wrap');
    const urlText = document.getElementById('qr-url-text');
    if (!wrap) return;

    if (window.QRCode) {
      wrap.innerHTML = ''; // clear previous
      new QRCode(wrap, {
        text:          this._qrUrl,
        width:         156,
        height:        156,
        colorDark:     '#e94560',
        colorLight:    '#0a0e1a',
        correctLevel:  QRCode.CorrectLevel.M,
      });
      if (urlText) {
        const u = this._qrUrl;
        urlText.textContent = u.length > 50 ? u.slice(0, 47) + '\u2026' : u;
        urlText.href = u;
      }
    } else {
      // Retry after 500ms if QRCode library not yet loaded
      setTimeout(() => this._tryRenderQR(), 500);
    }
  }

  setConnectedStatus(connected) {
    const dot   = this.container.querySelector('.conn-dot');
    const label = document.getElementById('conn-label');
    if (!dot || !label) return;
    dot.className   = `conn-dot ${connected ? 'connected' : 'disconnected'}`;
    label.textContent = connected ? '📱 Controller connected' : 'Awaiting connection';
  }

  // ─── Keyboard Bindings ────────────────────────────────────────────────────

  _bindKeyboard() {
    // Prevent arrow keys from scrolling the page
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) {
        e.preventDefault();
      }

      if (this.heldKeys.has(e.code)) return; // already held
      this.heldKeys.add(e.code);

      const mapping = KEY_MAP[e.code];
      if (!mapping) return;

      if (mapping.action === 'arm')    { this._triggerArm();       return; }
      if (mapping.action === 'reset')  { this.cb.onReset?.();      return; }
      if (mapping.action === 'gust')   { this.cb.onGust?.();       return; }
      if (mapping.action === 'camera') { this._triggerCamera();     return; }

      // Visual feedback on stick hints
      this._highlightHint(e.code, true);
    });

    window.addEventListener('keyup', (e) => {
      this.heldKeys.delete(e.code);
      this._highlightHint(e.code, false);
    });
  }

  _highlightHint(code, active) {
    const map = {
      'KeyW':       'hint-left-top',
      'KeyS':       'hint-left-bot',
      'KeyA':       'hint-left-left',
      'KeyD':       'hint-left-right',
      'ArrowUp':    'hint-right-top',
      'ArrowDown':  'hint-right-bot',
      'ArrowLeft':  'hint-right-left',
      'ArrowRight': 'hint-right-right',
    };
    const id = map[code];
    if (id) document.getElementById(id)?.classList.toggle('active', active);
  }

  // ─── Continuous Input Loop ────────────────────────────────────────────────

  _startInputLoop() {
    const RAMP   = 0.022;  // per-frame ramp speed at ~60fps
    const SPRING = 0.055;  // spring-back speed for yaw/pitch/roll

    const update = () => {
      if (this.mode === 'keyboard') {
        let lx = 0, ly = 0, rx = 0, ry = 0;

        for (const code of this.heldKeys) {
          const m = KEY_MAP[code];
          if (!m || !m.stick) continue;
          if (m.stick === 'left')  { if (m.axis === 'x') lx += m.dir; else ly += m.dir; }
          if (m.stick === 'right') { if (m.axis === 'x') rx += m.dir; else ry += m.dir; }
        }

        const rampTo = (cur, target, spd) =>
          cur + Math.sign(target - cur) * Math.min(Math.abs(target - cur), spd);

        // ── Left X (Yaw): spring to center when released ──────────────────
        if (lx !== 0) this.leftStick.x = rampTo(this.leftStick.x, lx, RAMP);
        else          this.leftStick.x = rampTo(this.leftStick.x,  0, SPRING);

        // ── Left Y (Throttle — Mode 2): HOLD when released, no spring ────
        if (ly !== 0) this.leftStick.y = rampTo(this.leftStick.y, ly, RAMP);
        // ← intentionally no else: throttle stays wherever it is

        // ── Right X (Roll): spring to center ─────────────────────────────
        if (rx !== 0) this.rightStick.x = rampTo(this.rightStick.x, rx, RAMP);
        else          this.rightStick.x = rampTo(this.rightStick.x,  0, SPRING);

        // ── Right Y (Pitch): spring to center ────────────────────────────
        if (ry !== 0) this.rightStick.y = rampTo(this.rightStick.y, ry, RAMP);
        else          this.rightStick.y = rampTo(this.rightStick.y,  0, SPRING);

        // Clamp all axes to [-1, 1]
        this.leftStick.x  = Math.max(-1, Math.min(1, this.leftStick.x));
        this.leftStick.y  = Math.max(-1, Math.min(1, this.leftStick.y));
        this.rightStick.x = Math.max(-1, Math.min(1, this.rightStick.x));
        this.rightStick.y = Math.max(-1, Math.min(1, this.rightStick.y));

        // Update visual knobs
        this._updateKnob('knob-left',  this.leftStick);
        this._updateKnob('knob-right', this.rightStick);

        // Emit control input every frame
        // throttle: leftY [-1..1] → [0..1]  (bottom=-1=0%, top=+1=100%)
        this.cb.onInput?.({
          throttle: (this.leftStick.y + 1) / 2,
          yaw:      this.leftStick.x,
          pitch:    this.rightStick.y,
          roll:     this.rightStick.x,
        });
      }

      requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  }

  _updateKnob(id, stick) {
    const knob = document.getElementById(id);
    if (!knob) return;
    const maxOffset = 28; // pixels
    knob.style.transform = `translate(calc(-50% + ${stick.x * maxOffset}px), calc(-50% + ${-stick.y * maxOffset}px))`;
  }

  // ─── External input (from mobile / Socket.io) ─────────────────────────────

  applyRemoteInput(data) {
    // Map phone throttle [0..1] → leftStick.y [-1..1]
    this.leftStick.x  = data.yaw      ?? 0;
    this.leftStick.y  = (data.throttle ?? 0) * 2 - 1; // [0..1] → [-1..1]
    this.rightStick.x = data.roll     ?? 0;
    this.rightStick.y = data.pitch    ?? 0;

    this._updateKnob('knob-left',  this.leftStick);
    this._updateKnob('knob-right', this.rightStick);

    // Arm toggle from phone
    if (data.arm_toggle) {
      this._triggerArm();
    }
    // Land command from phone — zero throttle
    if (data.land) {
      this.leftStick.y = -1; // throttle to zero
      this._updateKnob('knob-left', this.leftStick);
    }

    // Always pass through input to simulator
    this.cb.onInput?.({
      throttle: data.throttle ?? 0,
      yaw:      data.yaw     ?? 0,
      pitch:    data.pitch   ?? 0,
      roll:     data.roll    ?? 0,
    });
  }

  // ─── Arm / Camera helpers ─────────────────────────────────────────────────

  _triggerArm() {
    const armed = this.cb.onArm?.();
    const btn   = document.getElementById('ctrl-arm');
    if (btn) {
      btn.classList.toggle('armed', armed);
      btn.querySelector('span').textContent = armed ? '🔴 ARMED' : 'ARM';
    }
  }

  _triggerCamera() {
    const mode = this.cb.onCamera?.();
    const hud  = document.getElementById('hud-mode');
    if (hud) hud.textContent = mode === 'drone-lock' ? 'LOCK' : 'FREE';
  }

  // ─── HUD update ───────────────────────────────────────────────────────────

  updateHUD(telemetry) {
    const altEl = document.getElementById('hud-alt');
    if (altEl) altEl.textContent = telemetry.altitude?.toFixed(1) + 'm';
  }
}
