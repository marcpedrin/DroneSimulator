/**
 * main.js — Application bootstrap & panel wiring
 * Connects: simulator ↔ editor ↔ controls ↔ comms
 */

'use strict';

import { DroneSimulator }    from './simulator.js';
import { CodeEditor }        from './editor.js';
import { ControlInterface }  from './controls.js';
import { SimulatorComms, generateSessionId } from './comms.js';
import { DEFAULT_PARAMS }    from './physics.js';

// ─── Physics Settings Panel ───────────────────────────────────────────────────

function buildSettingsPanel(simContainer, onUpdate) {
  const panel = document.getElementById('settings-bar');
  if (!panel) return;

  panel.innerHTML = `
    <div class="settings-row main-settings">
      <label class="setting-item">
        <span class="setting-label">Mass</span>
        <input type="number" id="s-mass" value="${DEFAULT_PARAMS.mass}" 
               min="0.1" max="5" step="0.05" class="setting-input">
        <span class="setting-unit">kg</span>
      </label>
      <label class="setting-item">
        <span class="setting-label">Max Thrust/Motor</span>
        <input type="number" id="s-thrust" value="${DEFAULT_PARAMS.maxThrust}" 
               min="0.5" max="30" step="0.1" class="setting-input">
        <span class="setting-unit">N</span>
      </label>
      <button class="settings-toggle-btn" id="settings-expand" title="Advanced parameters">
        ⚙ Advanced
      </button>
    </div>
    <div class="settings-advanced hidden" id="settings-advanced">
      <div class="settings-row">
        <label class="setting-item">
          <span class="setting-label">Air Density (ρ)</span>
          <input type="number" id="s-density" value="${DEFAULT_PARAMS.airDensity}" 
                 min="0.5" max="1.5" step="0.01" class="setting-input">
          <span class="setting-unit">kg/m³</span>
        </label>
        <label class="setting-item">
          <span class="setting-label">Drag Coeff</span>
          <input type="number" id="s-drag" value="${DEFAULT_PARAMS.dragCoeff}" 
                 min="0.1" max="2" step="0.01" class="setting-input">
        </label>
        <label class="setting-item">
          <span class="setting-label">Turbulence</span>
          <input type="number" id="s-turb" value="${DEFAULT_PARAMS.turbulenceScale}" 
                 min="0" max="3" step="0.05" class="setting-input">
        </label>
        <label class="setting-item">
          <span class="setting-label">Ground Friction</span>
          <input type="number" id="s-fric" value="${DEFAULT_PARAMS.groundFriction}" 
                 min="0" max="1" step="0.05" class="setting-input">
        </label>
        <label class="setting-item">
          <span class="setting-label">Gravity</span>
          <input type="number" id="s-gravity" value="${DEFAULT_PARAMS.gravity}" 
                 min="0.1" max="20" step="0.01" class="setting-input">
          <span class="setting-unit">m/s²</span>
        </label>
        <label class="setting-item">
          <span class="setting-label">Arm Length</span>
          <input type="number" id="s-arm" value="${DEFAULT_PARAMS.armLength}" 
                 min="0.05" max="0.5" step="0.005" class="setting-input">
          <span class="setting-unit">m</span>
        </label>
      </div>
    </div>
  `;

  document.getElementById('settings-expand').addEventListener('click', () => {
    const adv = document.getElementById('settings-advanced');
    const btn = document.getElementById('settings-expand');
    adv.classList.toggle('hidden');
    btn.classList.toggle('active');
    btn.textContent = adv.classList.contains('hidden') ? '⚙ Advanced' : '✕ Advanced';
  });

  const fields = {
    's-mass':    'mass',
    's-thrust':  'maxThrust',
    's-density': 'airDensity',
    's-drag':    'dragCoeff',
    's-turb':    'turbulenceScale',
    's-fric':    'groundFriction',
    's-gravity': 'gravity',
    's-arm':     'armLength',
  };

  Object.entries(fields).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        onUpdate({ [key]: parseFloat(el.value) });
      });
    }
  });
}

// ─── Telemetry HUD (on simulator panel) ──────────────────────────────────────

function buildTelemetryHUD() {
  const hud = document.getElementById('sim-hud');
  if (!hud) return;

  hud.innerHTML = `
    <div class="hud-row">
      <div class="hud-item"><div class="hud-key">ALT</div><div class="hud-val" id="h-alt">0.0 m</div></div>
      <div class="hud-item"><div class="hud-key">VY</div><div class="hud-val" id="h-vy">0.0 m/s</div></div>
      <div class="hud-item"><div class="hud-key">ROLL</div><div class="hud-val" id="h-roll">0.0°</div></div>
      <div class="hud-item"><div class="hud-key">PITCH</div><div class="hud-val" id="h-pitch">0.0°</div></div>
      <div class="hud-item"><div class="hud-key">YAW</div><div class="hud-val" id="h-yaw">0.0°</div></div>
    </div>
    <div class="hud-row">
      <div class="hud-item"><div class="hud-key">M1</div><div class="hud-val motor-val" id="h-m1">0%</div></div>
      <div class="hud-item"><div class="hud-key">M2</div><div class="hud-val motor-val" id="h-m2">0%</div></div>
      <div class="hud-item"><div class="hud-key">M3</div><div class="hud-val motor-val" id="h-m3">0%</div></div>
      <div class="hud-item"><div class="hud-key">M4</div><div class="hud-val motor-val" id="h-m4">0%</div></div>
      <div class="hud-item armed-indicator" id="h-arm">DISARMED</div>
    </div>
  `;
}

function updateHUD(t) {
  const s = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  s('h-alt',   t.altitude?.toFixed(2)   + ' m');
  s('h-vy',    t.vy?.toFixed(2)         + ' m/s');
  s('h-roll',  t.roll?.toFixed(1)       + '°');
  s('h-pitch', t.pitch?.toFixed(1)      + '°');
  s('h-yaw',   t.yaw?.toFixed(1)        + '°');
  s('h-m1',    (t.motorPWM?.[0] * 100)?.toFixed(0) + '%');
  s('h-m2',    (t.motorPWM?.[1] * 100)?.toFixed(0) + '%');
  s('h-m3',    (t.motorPWM?.[2] * 100)?.toFixed(0) + '%');
  s('h-m4',    (t.motorPWM?.[3] * 100)?.toFixed(0) + '%');
  const armEl = document.getElementById('h-arm');
  if (armEl) {
    armEl.textContent = t.armed ? 'ARMED' : 'DISARMED';
    armEl.className   = `hud-item armed-indicator ${t.armed ? 'armed' : ''}`;
  }
}

// ─── App Bootstrap ────────────────────────────────────────────────────────────

let simulator, editor, controls, comms;
let armedState = false;

async function init() {
  // ── Session ID ────────────────────────────────────────────────────────────
  const sessionId = generateSessionId();

  // ── Get server info (LAN IP) ──────────────────────────────────────────────
  let controllerURL = `${window.location.origin}/controller?session=${sessionId}`;
  try {
    const info = await fetch('/api/server-info').then(r => r.json());
    controllerURL = `http://${info.lanIp}:${info.port}/controller?session=${sessionId}`;
  } catch (e) { /* use origin fallback */ }

  // ── Simulator ─────────────────────────────────────────────────────────────
  const simContainer = document.getElementById('sim-panel');
  simulator = new DroneSimulator(simContainer, (telemetry) => {
    updateHUD(telemetry);
    controls?.updateHUD(telemetry);
    comms?.sendTelemetry({
      altitude: telemetry.altitude,
      roll:     telemetry.roll,
      pitch:    telemetry.pitch,
      yaw:      telemetry.yaw,
      motorPWM: telemetry.motorPWM,  // for phone motor bars
    });
  });

  // ── Settings Panel ────────────────────────────────────────────────────────
  buildSettingsPanel(simContainer, (updates) => simulator.updateParams(updates));
  buildTelemetryHUD();

  // ── Code Editor ───────────────────────────────────────────────────────────
  const editorContainer = document.getElementById('editor-panel');
  editor = new CodeEditor(editorContainer, (type, value) => {
    if (type === 'auto') {
      simulator.setAutoMode(value);
    } else if (type === 0) {
      simulator.setUserMotorFn(value);
    }
  });

  // ── Controls ──────────────────────────────────────────────────────────────
  const ctrlContainer = document.getElementById('ctrl-panel');
  controls = new ControlInterface(ctrlContainer, {
    onInput: (input) => {
      if (simulator.autoMode) {
        // Throttle stick adjusts target altitude at a fixed rate
        const throttleDelta = (input.throttle - 0.5) * 0.2; // m/s per tick
        simulator.setpoint.targetAlt = Math.max(0.1,
          (simulator.setpoint.targetAlt || 1.0) + throttleDelta
        );
        // When pitch/roll sticks are near center, update holdX/Z to current position
        // (so the drone holds wherever it drifted to when you release)
        if (Math.abs(input.pitch) < 0.05 && Math.abs(input.roll) < 0.05) {
          const pos = simulator.drone.body.position;
          // Only update if there was prior stick movement (avoids overwriting on first frame)
          if (simulator._hadStickInput) {
            simulator.setpoint.holdX = pos.x;
            simulator.setpoint.holdZ = pos.z;
            simulator._hadStickInput = false;
          }
        } else {
          simulator._hadStickInput = true;
        }
        simulator.setControlInput(null, input.yaw, input.pitch, input.roll);
      } else {
        simulator.setControlInput(input.throttle, input.yaw, input.pitch, input.roll);
      }
    },
    onArm: () => {
      armedState = !armedState;
      simulator.setArmState(armedState);
      return armedState;
    },
    onReset: () => {
      armedState = false;
      simulator.setArmState(false);
      simulator.reset();
      const armBtn = document.getElementById('ctrl-arm');
      if (armBtn) {
        armBtn.classList.remove('armed');
        armBtn.querySelector('span').textContent = 'ARM';
      }
    },
    onGust:   () => simulator.triggerWindGust(),
    onCamera: () => simulator.toggleCameraMode(),
  });

  // Expose for debugging if needed
  window.simulator = simulator;
  window.controls = controls;

  // Show QR code
  controls.showQR(controllerURL);

  // ── Comms (Socket.io) ─────────────────────────────────────────────────────
  comms = new SimulatorComms(
    sessionId,
    (input) => {
      // Remote input arrives — apply to simulator
      controls.applyRemoteInput(input);
    },
    (connected) => {
      controls.setConnectedStatus(connected);
    }
  );
  comms.connect();

  // ── Overlay sim-action events (from non-module script in index.html) ────────
  window.addEventListener('sim-action', (e) => {
    switch (e.detail) {
      case 'reset':
        armedState = false;
        simulator.setArmState(false);
        simulator.reset();
        document.getElementById('ctrl-arm')?.classList.remove('armed');
        const armSpan = document.querySelector('#ctrl-arm span');
        if (armSpan) armSpan.textContent = 'ARM';
        break;
      case 'gust':
        simulator.triggerWindGust();
        // Show wind badge briefly
        const windBadge = document.getElementById('wind-badge');
        if (windBadge) {
          windBadge.style.display = 'block';
          clearTimeout(windBadge._timer);
          windBadge._timer = setTimeout(() => { windBadge.style.display = 'none'; }, 1800);
        }
        break;
      case 'camera':
        const mode = simulator.toggleCameraMode();
        const camText = document.getElementById('cam-mode-text');
        const modeEl  = document.getElementById('hud-mode');
        if (camText) camText.textContent = mode === 'drone-lock' ? 'LOCK' : 'FREE';
        if (modeEl)  modeEl.textContent  = mode === 'drone-lock' ? 'LOCK' : 'FREE';
        break;
    }
  });

  // Also wire gust badge from controls.onGust
  const origGust = controls.cb.onGust;
  controls.cb.onGust = () => {
    origGust?.();
    const windBadge = document.getElementById('wind-badge');
    if (windBadge) {
      windBadge.style.display = 'block';
      clearTimeout(windBadge._timer);
      windBadge._timer = setTimeout(() => { windBadge.style.display = 'none'; }, 1800);
    }
  };

  console.log(`🚁 Drone Simulator ready. Session: ${sessionId}`);
  console.log(`📱 Controller URL: ${controllerURL}`);
}

// Start when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
