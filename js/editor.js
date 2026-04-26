/**
 * editor.js — Monaco Editor with Arduino UNO execution model
 *
 * Execution model:
 *   setup()  — called ONCE when user presses ▶ Apply
 *   loop()   — called every physics tick (~120 Hz) with state injected
 *
 * Motor output: user calls analogWrite(1-4, 0-255) inside loop()
 * State input:  `state` object available inside loop()
 */

'use strict';

const STORAGE_KEY_FLIGHT = 'dronesim_flight_code_v2';
const STORAGE_KEY_RC     = 'dronesim_rc_code_v2';

// ── Default Flight Controller (Arduino UNO style) ─────────────────────────────
const DEFAULT_FLIGHT_CODE = `// ════════════════════════════════════════════════════════════════════════
// DRONE FLIGHT CONTROLLER  —  Arduino UNO
// ════════════════════════════════════════════════════════════════════════
//
//  setup()  →  runs ONCE when you press ▶ Apply
//  loop()   →  runs every physics tick (~120 Hz)
//
//  ARDUINO FUNCTIONS AVAILABLE:
//    analogWrite(motor, 0-255)        set ESC signal per motor
//    constrain(val, low, high)        clamp a value to range
//    map(val, in1, in2, out1, out2)   remap a value between ranges
//    millis()                         ms since sketch started (long)
//    abs(x)   min(a,b)   max(a,b)
//    Serial.println(x)                prints to browser console
//
//  DRONE STATE  (read in loop via the global \`state\` object):
//    state.altitude    metres above ground
//    state.roll        degrees  (+right tilt)
//    state.pitch       degrees  (+nose up)
//    state.yaw         degrees  (compass heading)
//    state.rollRate    deg/s
//    state.pitchRate   deg/s
//    state.yawRate     deg/s
//    state.vx/vy/vz    m/s world-frame velocity
//    state.dt          seconds since last tick
//    state.throttle    stick throttle 0-1
//    state.yawCmd      stick yaw    -1..+1
//    state.pitchCmd    stick pitch  -1..+1
//    state.rollCmd     stick roll   -1..+1
//
//  MOTOR LAYOUT  (X-config, top view):
//      M2 (FL,CCW)  M1 (FR,CW)
//           \\  FRONT  /
//             [BODY]
//           /        \\
//      M3 (RL,CW)   M4 (RR,CCW)
// ════════════════════════════════════════════════════════════════════════

// ── Global variables (persist across loop calls) ──────────────────────
float integral_alt  = 0;
float prev_err_alt  = 0;

// PID gains
const float KP_ALT   = 35,  KI_ALT  = 3,  KD_ALT  = 18;
const float KP_ROLL  = 1.5,  KD_ROLL  = 0.5;
const float KP_PITCH = 1.5,  KD_PITCH = 0.5;
const float KP_YAW   = 2.0;

// ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.println("Flight controller initialized");
  integral_alt = 0;
  prev_err_alt = 0;
}

// ─────────────────────────────────────────────────────────────────────
void loop() {
  // Target altitude: stick maps 0-1 to 0.1-5.0 metres
  float TARGET_ALT = map(state.throttle, 0, 1, 0.1, 5.0);
  float dt = state.dt;

  // ── Altitude PID ────────────────────────────────────────────────────
  float err_alt = TARGET_ALT - state.altitude;
  integral_alt  = constrain(integral_alt + err_alt * dt, -20, 20);
  float d_alt   = (err_alt - prev_err_alt) / max(dt, 0.001);
  prev_err_alt  = err_alt;

  // Base PWM — 128 = hover point for 0.8 kg drone
  int base = constrain(
    128 + KP_ALT * err_alt + KI_ALT * integral_alt + KD_ALT * d_alt,
    0, 255
  );

  // ── Roll PD (+ stick command) ────────────────────────────────────────
  float roll_target = state.rollCmd * 20;         // ±20° from stick
  float err_roll    = roll_target - state.roll;
  int   dRoll       = constrain(KP_ROLL * err_roll - KD_ROLL * state.rollRate, -60, 60);

  // ── Pitch PD (+ stick command) ───────────────────────────────────────
  float pitch_target = state.pitchCmd * 20;       // + means nose down
  float err_pitch    = pitch_target - state.pitch; 
  int   dPitch       = constrain(KP_PITCH * err_pitch - KD_PITCH * state.pitchRate, -60, 60);

  // ── Yaw P (stick command) ────────────────────────────────────────────
  // + means yaw CW
  float yaw_err = (state.yawCmd * 30) - state.yawRate; // simple rate controller for yaw
  int dYaw = constrain(KP_YAW * yaw_err, -40, 40);

  // ── Motor mixing (X-config) ──────────────────────────────────────────
  //   Roll+  → right tilt: FR/RR less, FL/RL more
  //   Pitch+ → nose down:  rear more, front less
  //   Yaw+   → CW spin:    CCW motors (M2,M4) more, CW less
  analogWrite(1, constrain(base - dPitch - dRoll - dYaw, 0, 255)); // M1 FR (CW)
  analogWrite(2, constrain(base - dPitch + dRoll + dYaw, 0, 255)); // M2 FL (CCW)
  analogWrite(3, constrain(base + dPitch + dRoll - dYaw, 0, 255)); // M3 RL (CW)
  analogWrite(4, constrain(base + dPitch - dRoll + dYaw, 0, 255)); // M4 RR (CCW)
}
`;

// ── Default RC Logic (Arduino UNO style) ──────────────────────────────────────
const DEFAULT_RC_CODE = `// ════════════════════════════════════════════════════════════════════════
// REMOTE CONTROL LOGIC  —  Arduino UNO  (processes phone joystick input)
// ════════════════════════════════════════════════════════════════════════
//
//  setup() runs once on Apply.
//  loop()  runs each time a new packet arrives from the phone.
//
//  INPUT  (read via global \`rcInput\` object):
//    rcInput.leftX    [-1..+1]  Yaw stick
//    rcInput.leftY    [-1..+1]  Throttle (top = +1)
//    rcInput.rightX   [-1..+1]  Roll stick
//    rcInput.rightY   [-1..+1]  Pitch (back = -1)
//    rcInput.btnArm   true/false
//    rcInput.btnLand  true/false
//
//  OUTPUT  (write via global \`output\` object):
//    output.throttle  [0..1]
//    output.yaw       [-1..1]
//    output.pitch     [-1..1]
//    output.roll      [-1..1]
//    output.arm       true/false
// ════════════════════════════════════════════════════════════════════════

const float EXPO_RATE  = 0.30;  // 0=linear, 1=full expo
const float YAW_RATE   = 0.80;  // yaw sensitivity multiplier

// Expo curve: soft centre, sharp edges (matches real RC radios)
float applyExpo(float v, float e) {
  return v * (1.0 - e) + (v * abs(v)) * e;
}

void setup() {
  Serial.println("RC logic loaded");
}

void loop() {
  output.throttle = constrain(map(rcInput.leftY, -1, 1, 0, 1), 0, 1);
  output.yaw      = applyExpo(rcInput.leftX,  EXPO_RATE) * YAW_RATE;
  output.pitch    = applyExpo(-rcInput.rightY, EXPO_RATE); // fwd stick → +pitch
  output.roll     = applyExpo(rcInput.rightX,  EXPO_RATE);
  output.arm      = rcInput.btnArm;
}
`;

// ── Arduino stdlib shim ───────────────────────────────────────────────────────
// These functions are injected into the user's execution context
const ARDUINO_STDLIB = `
  const constrain = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const map = (v, i1, i2, o1, o2) => o1 + (o2 - o1) * ((v - i1) / (i2 - i1));
  const abs   = Math.abs;
  const min   = Math.min;
  const max   = Math.max;
  const sq    = (x) => x * x;
  const sqrt  = Math.sqrt;
  const sin   = Math.sin;
  const cos   = Math.cos;
  const PI    = Math.PI;
  const Serial = { println: (m) => console.log('[FC]', m), print: (m) => console.log('[FC]', m) };
  const millis = () => performance.now();
`;

// ── Code transpiler: Arduino C++ → runnable JS ───────────────────────────────
// Converts `void setup()`, `void loop()`, C++ type declarations → valid JS
function transpileArduino(code) {
  return code
    // Remove C++ type qualifiers before function names and variables
    .replace(/\bvoid\s+(setup|loop)\s*\(/g, 'function $1(')
    // float/int/long/bool/const float/const int etc → let
    .replace(/\b(?:const\s+)?(?:float|int|long|bool|byte|unsigned\s+int|unsigned\s+long)\s+([a-zA-Z_]\w*\s*(?:=|\{|;|\())/g, 'let $1')
    // Handle inline return type before function definitions (float funcName(...))
    .replace(/\b(?:float|int|long|bool|byte)\s+([a-zA-Z_]\w*\s*\()/g, 'function $1')
    // Remove any remaining leading type-word on its own line (safety)
    .replace(/^\s*(?:float|int|long|bool|byte)\s+/gm, 'let ');
}

export class CodeEditor {
  /**
   * @param {HTMLElement} container
   * @param {Function}    onCodeChange  called with (tabIndex|'auto', value)
   */
  constructor(container, onCodeChange) {
    this.container    = container;
    this.onCodeChange = onCodeChange;
    this.editors      = [null, null];
    this.activeTab    = 0;
    this.autoMode     = false;

    // Per-sketch state for Arduino runtime
    this._motorPWM    = [0, 0, 0, 0];
    this._startTime   = performance.now();
    this._setupDone   = false;
    this._setupFn     = null;
    this._loopFn      = null;

    this._loadStoredCodes();
    this._buildUI();
    this._loadMonaco();
  }

  _loadStoredCodes() {
    this.codes = [
      localStorage.getItem(STORAGE_KEY_FLIGHT) ?? DEFAULT_FLIGHT_CODE,
      localStorage.getItem(STORAGE_KEY_RC)     ?? DEFAULT_RC_CODE,
    ];
  }

  _buildUI() {
    this.container.innerHTML = `
      <div class="editor-header">
        <div class="editor-tabs">
          <button class="editor-tab active" data-tab="0" id="tab-flight">
            ⚙ Flight Controller
          </button>
          <button class="editor-tab" data-tab="1" id="tab-rc">
            📡 Remote Control
          </button>
        </div>
        <div class="editor-actions">
          <button class="btn-auto-mode" id="btn-auto" title="Use built-in PID flight controller">
            <span class="auto-icon">🤖</span> Auto Mode
          </button>
          <button class="btn-run-code" id="btn-run" title="Compile & apply code (Ctrl+Enter)">
            ▶ Apply
          </button>
        </div>
      </div>
      <div class="editor-status-bar" id="editor-status">
        <span class="status-dot"></span>
        <span id="status-text">Ready — press ▶ Apply to run your sketch</span>
      </div>
      <div class="monaco-container" id="monaco-host"></div>
    `;

    this.container.querySelectorAll('.editor-tab').forEach(btn => {
      btn.addEventListener('click', () => this._switchTab(parseInt(btn.dataset.tab)));
    });

    document.getElementById('btn-run').addEventListener('click', () => this._applyCode());
    document.getElementById('btn-auto').addEventListener('click', () => this._toggleAutoMode());
  }

  _loadMonaco() {
    if (window.monaco) { this._initMonaco(); return; }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js';
    script.onload = () => {
      window.require.config({
        paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' }
      });
      window.require(['vs/editor/editor.main'], () => this._initMonaco());
    };
    document.head.appendChild(script);
  }

  _initMonaco() {
    const host = document.getElementById('monaco-host');
    if (!host) return;

    monaco.editor.defineTheme('droneTheme', {
      base: 'vs-dark', inherit: true,
      rules: [
        { token: 'comment',  foreground: '4a6fa5' },
        { token: 'keyword',  foreground: 'e94560' },
        { token: 'string',   foreground: '2ec4b6' },
        { token: 'number',   foreground: 'f5a623' },
        { token: 'function', foreground: '7ec8e3' },
      ],
      colors: {
        'editor.background':               '#0a0e1a',
        'editor.foreground':               '#c8d6e5',
        'editorLineNumber.foreground':     '#2a3a5c',
        'editor.lineHighlightBackground':  '#0f1e35',
        'editorCursor.foreground':         '#e94560',
        'editor.selectionBackground':      '#1a3a6c',
      }
    });

    this.editors[0] = monaco.editor.create(host, {
      value:              this.codes[0],
      language:           'cpp',          // C++ syntax highlighting for Arduino
      theme:              'droneTheme',
      fontSize:           13,
      fontFamily:         'JetBrains Mono, Fira Code, Consolas, monospace',
      minimap:            { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap:           'on',
      lineNumbers:        'on',
      renderLineHighlight:'line',
      folding:            true,
      automaticLayout:    true,
      tabSize:            2,
    });

    this._models = [
      this.editors[0].getModel(),
      monaco.editor.createModel(this.codes[1], 'cpp'),
    ];

    // Auto-save on change (debounced 500ms)
    let saveTimer = null;
    this.editors[0].onDidChangeModelContent(() => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => this._saveCurrentCode(), 500);
    });

    // Ctrl+Enter → Apply
    this.editors[0].addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      () => this._applyCode()
    );

    // Apply defaults on first load
    this._applyCode();
  }

  _switchTab(idx) {
    if (idx === this.activeTab) return;
    this._saveCurrentCode();
    this.activeTab = idx;
    this.container.querySelectorAll('.editor-tab').forEach((btn, i) => {
      btn.classList.toggle('active', i === idx);
    });
    if (this.editors[0] && this._models[idx]) {
      this.editors[0].setModel(this._models[idx]);
    }
  }

  _saveCurrentCode() {
    if (!this.editors[0]) return;
    const code = this.editors[0].getValue();
    this.codes[this.activeTab] = code;
    const keys = [STORAGE_KEY_FLIGHT, STORAGE_KEY_RC];
    localStorage.setItem(keys[this.activeTab], code);
  }

  // ── Arduino code compiler & runner ────────────────────────────────────────
  _applyCode() {
    if (this.autoMode) return;
    this._saveCurrentCode();
    const rawCode = this.codes[0];

    try {
      // 1. Transpile Arduino C++ syntax → valid JS
      const jsCode = transpileArduino(rawCode);

      // 2. Extract setup() and loop() from the transpiled code
      //    The wrapper injects Arduino stdlib + state + motor output buffer
      const motorBuf = [0, 0, 0, 0];
      const analogWriteFn = (motor, val) => {
        const idx = motor - 1;
        if (idx >= 0 && idx < 4) motorBuf[idx] = Math.max(0, Math.min(255, val));
      };

      const wrapper = new Function(
        'analogWrite',        // injected functions
        `
        ${ARDUINO_STDLIB}
        ${jsCode}

        // Expose setup and loop to the host
        const __setup = (typeof setup === 'function') ? setup : () => {};
        const __loop  = (typeof loop  === 'function') ? loop  : () => {};
        return { __setup, __loop };
        `
      );

      const { __setup, __loop } = wrapper(analogWriteFn);

      if (typeof __loop !== 'function') {
        throw new Error('loop() function not found in sketch');
      }

      // 3. Call setup() once now
      this._setupFn    = __setup;
      this._loopFn     = __loop;
      this._motorPWM   = motorBuf;
      this._analogWrite = analogWriteFn;
      this._setupDone  = false;
      this._startTime  = performance.now();

      // Run setup once
      __setup();
      this._setupDone = true;

      // 4. Build the per-tick function that the simulator calls
      const self = this;
      const tickFn = (state) => {
        // Reset motor buffer each tick
        motorBuf.fill(0);
        // Inject state and call loop()
        // We use globalThis.state to make it available to the loop() closure
        try {
          globalThis.state = state;
          __loop();
          // Return PWM [0..1] for simulator
          return motorBuf.map(v => v / 255);
        } catch (e) {
          console.error('[FC loop]', e.message);
          return [0, 0, 0, 0];
        }
      };

      this._setStatus('success', '✓ Sketch compiled and running (setup() called)');
      this.onCodeChange(0, tickFn);

    } catch (e) {
      this._setStatus('error', `✗ Compile error: ${e.message}`);
      this.onCodeChange(0, null);
    }
  }

  _toggleAutoMode() {
    this.autoMode = !this.autoMode;
    const btn    = document.getElementById('btn-auto');
    const runBtn = document.getElementById('btn-run');

    btn.classList.toggle('active', this.autoMode);
    btn.innerHTML = this.autoMode
      ? '<span class="auto-icon">🤖</span> Auto ON'
      : '<span class="auto-icon">🤖</span> Auto Mode';
    runBtn.disabled = this.autoMode;

    if (this.editors[0]) {
      this.editors[0].updateOptions({ readOnly: this.autoMode });
    }

    if (this.autoMode) {
      this._setStatus('info', '🤖 Auto PID active — editor disabled');
      this.onCodeChange('auto', true);
    } else {
      this._setStatus('ready', 'Manual mode — press ▶ Apply to run sketch');
      this.onCodeChange('auto', false);
      this._applyCode();
    }
  }

  _setStatus(type, msg) {
    const bar  = document.getElementById('editor-status');
    const text = document.getElementById('status-text');
    if (bar)  bar.className = `editor-status-bar status-${type}`;
    if (text) text.textContent = msg;
  }
}
