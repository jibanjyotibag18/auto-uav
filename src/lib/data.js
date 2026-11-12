export const navigation = [
  { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard', group: 'FLIGHT DECK' },
  { id: 'mission', label: 'Mission control', icon: 'Gamepad2' },
  { id: 'camera', label: 'Live camera', icon: 'Camera' },
  { id: 'lidar', label: '3D LiDAR', icon: 'ScanLine', group: 'PERCEPTION' },
  { id: 'planning', label: 'Path planning', icon: 'Route' },
  { id: 'sensors', label: 'Sensors', icon: 'Radio' },
  { id: 'telemetry', label: 'Telemetry', icon: 'ChartNoAxesCombined', group: 'SYSTEM' },
  { id: 'logs', label: 'System logs', icon: 'ScrollText' },
  { id: 'settings', label: 'Settings', icon: 'Settings2' },
]

const demoPoints = Array.from({ length: 240 }, (_, index) => {
  const angle = (index / 240) * Math.PI * 2
  const radius = 3.4 + Math.sin(index * 1.71) * 0.8
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle * 2.7) * 1.1 + 0.6,
    z: Math.sin(angle) * radius,
    distance: Number(radius.toFixed(2)),
    obstacle: index % 17 === 0,
  }
})

export function makeDemoData() {
  return {
    status: {
      connected: true,
      flightController: { connected: true, mode: 'ALT HOLD', armed: false, protocolVerified: false },
      companion: { connected: true },
      systemHealth: 'NOMINAL',
    },
    telemetry: {
      batteryVoltage: 15.8,
      heading: 287.4,
      altitude: 2.4,
      roll: -1.2,
      pitch: 3.6,
      updatedAt: Date.now(),
    },
    sensors: {
      tfLuna: { distance: 3.42, healthy: true, updatedAt: Date.now() },
      gy53: { distance: 3.38, healthy: true, updatedAt: Date.now() },
      hmc5883l: { heading: 287.4, healthy: true, updatedAt: Date.now() },
    },
    mapping: { points: demoPoints, horizontalAngle: 360, verticalAngle: 42, updatedAt: Date.now() },
    camera: { url: 'http://192.168.4.1:81/stream', connected: false },
    system: { firmware: 'DEMO SIMULATOR', lastHeartbeat: Date.now() },
  }
}

export function formatAge(timestamp) {
  if (!timestamp) return 'No data'
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 2) return 'Just now'
  if (seconds < 60) return `${seconds}s ago`
  return `${Math.floor(seconds / 60)}m ago`
}

export function isFresh(timestamp, maxAgeMs = 15_000) {
  const value = Number(timestamp)
  return Number.isFinite(value) && value > 0 && value <= Date.now() + 5_000 && Date.now() - value <= maxAgeMs
}

export const demoHistory = Array.from({ length: 24 }, (_, index) => ({
  time: `${String(index).padStart(2, '0')}:00`,
  voltage: Number((16.6 - index * 0.035 - Math.sin(index) * 0.08).toFixed(2)),
  altitude: Number((2.1 + Math.sin(index / 3) * 0.4).toFixed(2)),
}))
