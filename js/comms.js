/**
 * comms.js — Socket.io client for desktop simulator
 * Handles: host registration, controller relay, telemetry push
 */

'use strict';

export class SimulatorComms {
  /**
   * @param {string}   sessionId        — unique session ID (generated on page load)
   * @param {Function} onControlInput   — called with { throttle, yaw, pitch, roll }
   * @param {Function} onControllerConn — called with (connected: boolean)
   */
  constructor(sessionId, onControlInput, onControllerConn) {
    this.sessionId        = sessionId;
    this.onControlInput   = onControlInput;
    this.onControllerConn = onControllerConn;
    this.socket           = null;
    this.connected        = false;
  }

  connect() {
    if (!window.io) {
      console.warn('[Comms] Socket.io not loaded');
      return;
    }

    this.socket = window.io({
      transports: ['websocket'],
      reconnectionAttempts: 10,
    });

    this.socket.on('connect', () => {
      console.log('[Comms] Connected, registering as host');
      this.socket.emit('host-register', this.sessionId);
      this.connected = true;
    });

    this.socket.on('controller-connected', () => {
      console.log('[Comms] Mobile controller connected');
      this.onControllerConn(true);
    });

    this.socket.on('peer-disconnected', () => {
      console.log('[Comms] Controller disconnected');
      this.onControllerConn(false);
    });

    this.socket.on('control-input', (data) => {
      this.onControlInput(data);
    });

    this.socket.on('disconnect', () => {
      this.connected = false;
    });
  }

  /** Push telemetry to connected mobile controller (optional HUD) */
  sendTelemetry(data) {
    if (this.socket && this.connected) {
      this.socket.volatile.emit('telemetry', data); // volatile = drop if busy
    }
  }

  /** Build the controller URL pointing to this session */
  getControllerURL(baseUrl) {
    return `${baseUrl}/controller?session=${this.sessionId}`;
  }

  disconnect() {
    this.socket?.disconnect();
  }
}

/** Generate a random session ID */
export function generateSessionId() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}
