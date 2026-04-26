# 🚁 DroneOS — Quadcopter Simulator Setup Guide

## Step 1: Install Node.js (Required)

Node.js is **not installed** on this machine yet.

👉 Download and install from: **https://nodejs.org/en/download**
- Choose the **LTS version** (e.g. v22 LTS)
- Run the installer — check "Add to PATH" when prompted
- **Restart your computer** after installation

Verify it worked by opening PowerShell and typing:
```
node -v
npm -v
```
Both should print version numbers.

---

## Step 2: Install Dependencies

Open PowerShell, navigate to the project folder, and run:

```powershell
cd "C:\Users\marcp\Downloads\DroneSimulator"
npm install
```

This installs `express` and `socket.io` (takes ~30 seconds).

---

## Step 3: Start the Server

```powershell
node server.js
```

You'll see:
```
🚁 Drone Simulator Server
   Local:    http://localhost:3000
   Network:  http://192.168.x.x:3000
```

---

## Step 4: Open the Simulator

Open your browser and go to: **http://localhost:3000**

---

## Step 5: Mobile Controller (Optional)

1. Make sure your phone is on the **same Wi-Fi** as your PC
2. In the simulator, the QR code is in the **bottom-right panel**
3. Scan it with your phone's camera
4. The DJI-style controller opens on your phone

---

## Controls (Keyboard Mode)

| Key | Action |
|-----|--------|
| `W / S` | Throttle Up / Down |
| `A / D` | Yaw Left / Right |
| `↑ / ↓` | Pitch Forward / Back |
| `← / →` | Roll Left / Right |
| `Space` | Arm / Disarm |
| `R` | Reset Drone |
| `G` | Wind Gust |
| `C` | Toggle Camera Mode |
| Middle Mouse + Drag | Orbit camera |
| Right Mouse + Drag | Pan camera |
| Scroll | Zoom |

---

## Project Structure

```
DroneSimulator/
├── index.html        ← Main simulator UI
├── controller.html   ← Mobile phone controller
├── style.css         ← Dark aerospace UI styles
├── server.js         ← Node.js + Socket.io server
├── package.json      ← Dependencies
└── js/
    ├── main.js       ← App bootstrap & wiring
    ├── simulator.js  ← Three.js 3D scene
    ├── drone.js      ← Quadcopter mesh + Cannon-es body
    ├── physics.js    ← Real aerodynamics + PID controller
    ├── editor.js     ← Monaco code editor
    ├── controls.js   ← Keyboard + joystick UI
    └── comms.js      ← Socket.io client
```

---

## Writing Your Own Flight Code

In the **Flight Controller** tab of the editor, write a JavaScript function:

```javascript
function flightController(state) {
  // state = { altitude, roll, pitch, yaw, rollRate, pitchRate, yawRate, vx, vy, vz, dt }
  // Return 4 motor values [0..255] — like Arduino analogWrite()
  
  const throttle = 128; // hover
  return [throttle, throttle, throttle, throttle];
}
```

Press **▶ Apply** (or `Ctrl+Enter`) to run your code.

Use **🤖 Auto Mode** to test with the built-in PID controller without writing code.

---

## Physics Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| Drone Mass | 0.8 kg | Total aircraft weight |
| Max Thrust/Motor | 5 N | Maximum force per rotor |
| Air Density | 1.225 kg/m³ | Sea level atmosphere |
| Drag Coefficient | 0.47 | Aerodynamic drag |
| Turbulence | 0.3 | Atmospheric turbulence intensity |
| Ground Friction | 0.6 | Landing friction |
| Gravity | 9.81 m/s² | Gravitational acceleration |
