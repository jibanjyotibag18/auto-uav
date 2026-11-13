import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowUpRight, Battery, Check, CircleDot,
  Compass, Crosshair, ExternalLink, Gauge, LockKeyhole, MapPin, Maximize, Radio, RefreshCw, Shield,
  Signal, Wifi, WifiOff, Zap, Thermometer, Target, Cpu, Navigation, Eye,
} from 'lucide-react'
import { demoHistory, formatAge, isFresh } from '../lib/data.js'

const LidarScene = lazy(() => import('./LidarScene.jsx'))
const valueOrDash = (value, digits = 1) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '--'

function getCardinalDirection(angle) {
  if (angle === null || angle === undefined || !Number.isFinite(Number(angle))) return '--'
  const val = ((Number(angle) % 360) + 360) % 360
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  const index = Math.round(val / 22.5) % 16
  return directions[index]
}

function formatUptime(ms) {
  if (!ms || !Number.isFinite(Number(ms))) return '--'
  const seconds = Math.floor(Number(ms) / 1000)
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m ${s}s`
  return `${m}m ${String(s).padStart(2, '0')}s`
}

function findRoute(target, obstacles) {
  const cells = 40
  const step = 10 / cells
  const indexOf = (x, z) => z * (cells + 1) + x
  const pointOf = (index) => ({ x: (index % (cells + 1)) * step, z: Math.floor(index / (cells + 1)) * step })
  const start = indexOf(0, 0)
  const goal = indexOf(Math.round(target.x / step), Math.round(target.z / step))
  const blocked = new Uint8Array((cells + 1) * (cells + 1))
  for (let z = 0; z <= cells; z += 1) {
    for (let x = 0; x <= cells; x += 1) {
      const point = { x: x * step, z: z * step }
      if (obstacles.some((obstacle) => Math.hypot(point.x - obstacle.x, point.z - obstacle.z) <= obstacle.r + 0.45)) blocked[indexOf(x, z)] = 1
    }
  }
  if (blocked[goal]) return { path: [], blocked: true }

  const total = blocked.length
  const costs = new Float64Array(total).fill(Infinity)
  const previous = new Int32Array(total).fill(-1)
  const visited = new Uint8Array(total)
  costs[start] = 0
  const open = [start]
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
  while (open.length) {
    let bestIndex = 0
    let bestScore = Infinity
    for (let index = 0; index < open.length; index += 1) {
      const point = pointOf(open[index])
      const score = costs[open[index]] + Math.hypot(point.x - target.x, point.z - target.z)
      if (score < bestScore) { bestScore = score; bestIndex = index }
    }
    const current = open.splice(bestIndex, 1)[0]
    if (current === goal) break
    if (visited[current]) continue
    visited[current] = 1
    const x = current % (cells + 1)
    const z = Math.floor(current / (cells + 1))
    for (const [dx, dz] of directions) {
      const nextX = x + dx
      const nextZ = z + dz
      if (nextX < 0 || nextX > cells || nextZ < 0 || nextZ > cells) continue
      const next = indexOf(nextX, nextZ)
      if (blocked[next] || visited[next]) continue
      if (dx && dz && (blocked[indexOf(x + dx, z)] || blocked[indexOf(x, z + dz)])) continue
      const cost = costs[current] + (dx && dz ? Math.SQRT2 : 1) * step
      if (cost < costs[next]) {
        costs[next] = cost
        previous[next] = current
        open.push(next)
      }
    }
  }
  if (start !== goal && previous[goal] < 0) return { path: [], blocked: true }
  const reversed = []
  for (let node = goal; node >= 0; node = previous[node]) {
    reversed.push(pointOf(node))
    if (node === start) break
  }
  const densePath = reversed.reverse()
  const path = [densePath[0]]
  for (let index = 1; index < densePath.length - 1; index += 1) {
    const before = densePath[index - 1]
    const point = densePath[index]
    const after = densePath[index + 1]
    const cross = (point.x - before.x) * (after.z - point.z) - (point.z - before.z) * (after.x - point.x)
    if (Math.abs(cross) > 0.001) path.push(point)
  }
  if (densePath.length > 1) path.push(densePath[densePath.length - 1])
  path[path.length - 1] = { x: Number(target.x.toFixed(1)), z: Number(target.z.toFixed(1)) }
  return { path, blocked: false }
}

function Panel({ title, action, children, className = '' }) {
  return <section className={`panel ${className}`}>
    <div className="panel-heading"><h2>{title}</h2>{action}</div>
    {children}
  </section>
}

function Metric({ label, value, unit, icon: Icon, tone = 'blue', note }) {
  return <div className="metric-card">
    <div className="metric-top"><span>{label}</span><Icon size={16} className={`tone-${tone}`} /></div>
    <div className="metric-value">{value}<small>{unit}</small></div>
    {note && <div className="metric-note">{note}</div>}
  </div>
}

function StatusPill({ online, children }) {
  return <span className={`status-pill ${online ? 'is-online' : 'is-offline'}`}>
    <span className="status-dot" />{children}
  </span>
}

export function Dashboard({ data, connection, isDemo, onNavigate }) {
  const status = data.status
  const telemetry = data.telemetry
  const sensors = data.sensors
  const mapping = data.mapping
  const telemetryFresh = isDemo || isFresh(telemetry?.updatedAt, 3500)
  const fcFresh = isDemo || (connection === 'online' && Boolean(status?.flightController?.connected) && isFresh(status?.updatedAt, 3500))
  const compassFresh = isDemo || (sensors?.hmc5883l?.healthy === true && isFresh(sensors?.hmc5883l?.updatedAt, 3500))
  const compassHeading = compassFresh
    ? sensors?.hmc5883l?.heading
    : telemetryFresh ? telemetry?.heading : (isDemo ? 225 : null)

  const fcOnline = connection === 'online' && status?.flightController?.connected && isFresh(status?.updatedAt, 3500)
  const companionOnline = connection === 'online' && status?.companion?.connected && isFresh(status?.updatedAt, 3500)
  const esp32Online = isDemo || (connection === 'online' && (isFresh(sensors?.updatedAt, 3500) || isFresh(status?.esp32SensorHub?.updatedAt, 3500)))
  const hardwareOnline = isDemo || esp32Online || companionOnline || fcOnline

  const [selectedMetric, setSelectedMetric] = useState('lidar')
  const [liveHistory, setLiveHistory] = useState(() => {
    return Array.from({ length: 16 }, (_, i) => ({
      time: new Date(Date.now() - (16 - i) * 2000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      lidar: Number((1.70 + Math.sin(i * 0.4) * 0.06).toFixed(2)),
      tofMm: Math.round(52 + Math.sin(i * 0.7) * 4),
      heading: Number(((225 + i * 0.3) % 360).toFixed(1)),
      voltage: Number((15.8 - i * 0.002).toFixed(2)),
    }))
  })

  const lastUpdateRef = useRef(0)
  useEffect(() => {
    const ts = sensors?.updatedAt || telemetry?.updatedAt
    if (ts && ts !== lastUpdateRef.current) {
      lastUpdateRef.current = ts
      const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      const lidarVal = Number.isFinite(Number(sensors?.tfLuna?.distance)) ? Number(Number(sensors.tfLuna.distance).toFixed(2)) : 1.70
      const tofVal = Number.isFinite(Number(sensors?.gy53?.distanceMm)) ? Number(sensors.gy53.distanceMm) : 52
      const headingVal = Number.isFinite(Number(compassHeading)) ? Number(Number(compassHeading).toFixed(1)) : 225
      const voltVal = Number.isFinite(Number(telemetry?.batteryVoltage)) ? Number(Number(telemetry.batteryVoltage).toFixed(2)) : 15.80

      setLiveHistory((prev) => {
        const next = [...prev, { time: nowStr, lidar: lidarVal, tofMm: tofVal, heading: headingVal, voltage: voltVal }]
        return next.slice(-25)
      })
    }
  }, [sensors?.updatedAt, telemetry?.updatedAt, sensors?.tfLuna?.distance, sensors?.gy53?.distanceMm, compassHeading, telemetry?.batteryVoltage])

  const lidarDist = sensors?.tfLuna?.distance ?? 1.70
  const lidarStrength = sensors?.tfLuna?.strength ?? 3346
  const lidarTemp = sensors?.tfLuna?.temperature ?? 50
  const tofDistMm = sensors?.gy53?.distanceMm ?? 52
  const batteryVolt = telemetry?.batteryVoltage ?? 15.80
  const cellVolt = (batteryVolt / 4).toFixed(2)

  return <>
    <div className="page-title-row">
      <div>
        <div className="eyebrow">TACTICAL COMMAND / REALTIME TELEMETRY</div>
        <h1>Mission Dashboard</h1>
        <p>Live UAV perception, sensor telemetry stream, and obstacle detection.</p>
      </div>
      <div className="dashboard-title-right">
          <StatusPill online={hardwareOnline}>
            {isDemo ? 'DEMO SIMULATOR' : hardwareOnline ? 'HARDWARE ONLINE' : connection === 'online' ? 'HARDWARE OFFLINE' : 'DISCONNECTED'}
          </StatusPill>
      </div>
    </div>

    {/* Realtime Stream Ticker Bar */}
    <div className="realtime-ticker-bar">
      <div className="ticker-chip">
        <span className="ticker-icon">
          {hardwareOnline ? <span className="live-blink-dot" /> : <span className="offline-dot" />}
        </span>
        <span className="ticker-label">STREAM:</span>
        <b className={`ticker-value ${hardwareOnline ? 'tone-green' : 'tone-red'}`}>
          {hardwareOnline ? 'LIVE' : 'OFFLINE'}
        </b>
      </div>

      <div className="ticker-chip">
        <span className="ticker-icon"><Cpu size={13} className={hardwareOnline ? 'tone-blue' : 'tone-muted'} /></span>
        <span className="ticker-label">NODE:</span>
        <b className={`ticker-value ${hardwareOnline ? '' : 'tone-red'}`}>
          {hardwareOnline ? 'ESP32 HUB' : 'OFFLINE'}
        </b>
      </div>

      <div className="ticker-chip">
        <span className="ticker-icon"><Activity size={13} className={hardwareOnline ? 'tone-green' : 'tone-muted'} /></span>
        <span className="ticker-label">RATE:</span>
        <b className={`ticker-value ${hardwareOnline ? '' : 'tone-muted'}`}>
          {hardwareOnline ? '~5 Hz' : '0 Hz'}
        </b>
      </div>

      <div className="ticker-chip">
        <span className="ticker-icon"><Signal size={13} className={hardwareOnline ? 'tone-yellow' : 'tone-muted'} /></span>
        <span className="ticker-label">UPTIME:</span>
        <b className={`ticker-value ${hardwareOnline ? '' : 'tone-muted'}`}>
          {hardwareOnline ? formatUptime(sensors?.uptime || 488283) : '--'}
        </b>
      </div>

      <div className="ticker-chip">
        <span className="ticker-icon"><Navigation size={13} className={hardwareOnline ? 'tone-blue' : 'tone-muted'} /></span>
        <span className="ticker-label">BEARING:</span>
        <b className={`ticker-value ${hardwareOnline ? '' : 'tone-muted'}`}>
          {hardwareOnline && compassHeading !== null ? `${valueOrDash(compassHeading, 1)}° ${getCardinalDirection(compassHeading)}` : '--'}
        </b>
      </div>

      <div className="ticker-chip">
        <span className="ticker-icon"><Radio size={13} className={hardwareOnline ? 'tone-cyan' : 'tone-red'} /></span>
        <span className="ticker-label">PACKET:</span>
        <b className={`ticker-value ${hardwareOnline ? 'tone-cyan' : 'tone-red'}`}>
          {hardwareOnline ? 'Just now' : (sensors?.updatedAt ? formatAge(sensors.updatedAt) : 'No packets')}
        </b>
      </div>
    </div>

    {/* 4 Primary Telemetry Metrics Cards */}
    <div className="metrics-grid">
      {/* 1. TF-Luna LiDAR */}
      <div className="metric-card metric-card-elevated">
        <div className="metric-top">
          <span className="metric-tag">TF-LUNA LIDAR</span>
          <span className={`metric-badge-${esp32Online ? 'ok' : 'warn'}`}>
            {esp32Online ? 'ACTIVE' : 'OFFLINE'}
          </span>
        </div>
        <div className="metric-value">
          {valueOrDash(esp32Online ? lidarDist : null, 2)}
          <small>m</small>
        </div>
        <div className="metric-sub-bar">
          <div className="metric-sub-item">
            <span>Signal:</span>
            <b>{esp32Online ? `${lidarStrength} pts` : '--'}</b>
          </div>
          <div className="metric-sub-item">
            <span>Optics:</span>
            <b>{esp32Online ? `${lidarTemp} °C` : '--'}</b>
          </div>
        </div>
        <div className="metric-progress-track">
          <div className="metric-progress-fill fill-blue" style={{ width: esp32Online ? `${Math.min(100, (lidarStrength / 4000) * 100)}%` : '0%' }} />
        </div>
      </div>

      {/* 2. VL53L0X ToF */}
      <div className="metric-card metric-card-elevated">
        <div className="metric-top">
          <span className="metric-tag">VL53L0X TOF</span>
            <span className={`metric-badge-${esp32Online ? (tofDistMm < 100 ? 'warn' : 'ok') : 'warn'}`}>
              {esp32Online ? (tofDistMm < 100 ? 'PROXIMITY' : 'CLEAR') : 'OFFLINE'}
            </span>
        </div>
        <div className="metric-value">
          {valueOrDash(esp32Online ? tofDistMm : null, 0)}
          <small>mm</small>
        </div>
        <div className="metric-sub-bar">
          <div className="metric-sub-item">
            <span>Range:</span>
            <b>{esp32Online ? `${(tofDistMm / 10).toFixed(1)} cm` : '--'}</b>
          </div>
          <div className="metric-sub-item">
            <span>Health:</span>
            <b className={esp32Online ? 'tone-green' : 'tone-red'}>{esp32Online ? 'HEALTHY' : 'OFFLINE'}</b>
          </div>
        </div>
        <div className="metric-progress-track">
          <div className="metric-progress-fill fill-green" style={{ width: esp32Online ? `${Math.min(100, (tofDistMm / 1200) * 100)}%` : '0%' }} />
        </div>
      </div>

      {/* 3. Compass Heading */}
      <div className="metric-card metric-card-elevated">
        <div className="metric-top">
          <span className="metric-tag">HMC5883L COMPASS</span>
          <span className={`metric-badge-${esp32Online && compassHeading !== null ? 'ok' : 'warn'}`}>
            {esp32Online && compassHeading !== null ? getCardinalDirection(compassHeading) : 'NO SIGNAL'}
          </span>
        </div>
        <div className="metric-value">
          {valueOrDash(esp32Online ? compassHeading : null, 1)}
          <small>°</small>
        </div>
        <div className="metric-sub-bar">
          <div className="metric-sub-item">
            <span>Sector:</span>
            <b>{esp32Online && compassHeading !== null ? `${getCardinalDirection(compassHeading)} Bearing` : '--'}</b>
          </div>
          <div className="metric-sub-item">
            <span>Status:</span>
            <b className={esp32Online && compassHeading !== null ? 'tone-green' : 'tone-red'}>
              {esp32Online && compassHeading !== null ? 'CALIBRATED' : 'OFFLINE'}
            </b>
          </div>
        </div>
        <div className="metric-progress-track">
          <div className="metric-progress-fill fill-cyan" style={{ width: esp32Online && compassHeading !== null ? `${((Number(compassHeading) || 0) / 360) * 100}%` : '0%' }} />
        </div>
      </div>

      {/* 4. Power & Voltage */}
      <div className="metric-card metric-card-elevated">
        <div className="metric-top">
          <span className="metric-tag">POWER PACK</span>
          <span className={`metric-badge-${telemetryFresh ? 'ok' : 'warn'}`}>
            {telemetryFresh ? '4S NOMINAL' : 'NO DATA'}
          </span>
        </div>
        <div className="metric-value">
          {valueOrDash(telemetryFresh ? batteryVolt : null, 2)}
          <small>V</small>
        </div>
        <div className="metric-sub-bar">
          <div className="metric-sub-item">
            <span>Cell Avg:</span>
            <b>{telemetryFresh ? `${cellVolt} V/cell` : '--'}</b>
          </div>
          <div className="metric-sub-item">
            <span>Est:</span>
            <b className={telemetryFresh ? 'tone-green' : 'tone-muted'}>{telemetryFresh ? '~85%' : '--'}</b>
          </div>
        </div>
        <div className="metric-progress-track">
          <div className="metric-progress-fill fill-emerald" style={{ width: telemetryFresh ? '85%' : '0%' }} />
        </div>
      </div>
    </div>

    {/* Primary Realtime Dashboard Grid */}
    <div className="dashboard-grid">
      {/* 1. Tactical Obstacle Radar */}
      <Panel
        title="Tactical Proximity Radar"
        action={<button className="text-button" onClick={() => onNavigate('lidar')}>Open 3D Pointcloud <ArrowUpRight size={14} /></button>}
      >
        <TacticalRadarWidget mapping={mapping} tfLuna={sensors?.tfLuna} gy53={sensors?.gy53} isOnline={esp32Online} />
      </Panel>

      {/* 2. Compass & Attitude HUD */}
      <Panel
        title="Aerospace Heading & Attitude HUD"
        action={<span className="panel-meta">HMC5883L + IMU</span>}
      >
        <CompassHudWidget heading={compassHeading} telemetry={telemetry} isOnline={esp32Online} />
      </Panel>

      {/* 3. Rolling Realtime Telemetry Chart */}
      <Panel
        title="Live Rolling Telemetry Stream"
        action={
          <div className="chart-metric-selector">
            <button className={`chart-tab ${selectedMetric === 'lidar' ? 'active' : ''}`} onClick={() => setSelectedMetric('lidar')}>LiDAR (m)</button>
            <button className={`chart-tab ${selectedMetric === 'tof' ? 'active' : ''}`} onClick={() => setSelectedMetric('tof')}>ToF (mm)</button>
            <button className={`chart-tab ${selectedMetric === 'heading' ? 'active' : ''}`} onClick={() => setSelectedMetric('heading')}>Heading (°)</button>
            <button className={`chart-tab ${selectedMetric === 'voltage' ? 'active' : ''}`} onClick={() => setSelectedMetric('voltage')}>Voltage (V)</button>
          </div>
        }
      >
        <RollingStreamChart history={liveHistory} metric={selectedMetric} isOnline={hardwareOnline} />
      </Panel>

      {/* 4. Subsystem Hardware & Bus Diagnostics */}
      <Panel
        title="Hardware Link & Subsystem Bus"
        action={<button className="text-button" onClick={() => onNavigate('mission')}>Flight Controls <ArrowUpRight size={14} /></button>}
      >
        <div className="subsystems-grid">
          <div className="subsystem-row">
            <div className="subsystem-info">
              <Cpu size={15} className={esp32Online ? 'tone-blue' : 'tone-muted'} />
              <div>
                <strong>ESP32 Sensor Gateway</strong>
                <span>UAV_SENSOR feed · {esp32Online ? `${formatUptime(sensors?.uptime || 488283)} uptime` : 'No incoming packets'}</span>
              </div>
            </div>
              <StatusPill online={esp32Online}>
                {isDemo ? 'SIMULATED' : esp32Online ? 'BROADCASTING' : 'OFFLINE'}
              </StatusPill>
          </div>

          <div className="subsystem-row">
            <div className="subsystem-info">
              <Crosshair size={15} className={esp32Online ? 'tone-yellow' : 'tone-muted'} />
              <div>
                <strong>TF-Luna LiDAR (Forward Range)</strong>
                <span>{esp32Online ? `170 cm · Signal: ${lidarStrength} pts` : 'Hardware stream paused'}</span>
              </div>
            </div>
            <span className={`health-tag ${esp32Online ? 'tag-green' : 'tag-red'}`}>
              {esp32Online ? 'HEALTHY' : 'OFFLINE'}
            </span>
          </div>

          <div className="subsystem-row">
            <div className="subsystem-info">
              <Eye size={15} className={esp32Online ? 'tone-green' : 'tone-muted'} />
              <div>
                <strong>VL53L0X Laser ToF (Proximity)</strong>
                <span>{esp32Online ? `${tofDistMm} mm · Short range laser` : 'Hardware stream paused'}</span>
              </div>
            </div>
            <span className={`health-tag ${esp32Online ? 'tag-green' : 'tag-red'}`}>
              {esp32Online ? 'OPERATIONAL' : 'OFFLINE'}
            </span>
          </div>

          <div className="subsystem-row">
            <div className="subsystem-info">
              <Compass size={15} className={esp32Online ? 'tone-cyan' : 'tone-muted'} />
              <div>
                <strong>HMC5883L 3-Axis Compass</strong>
                <span>{esp32Online && compassHeading !== null ? `${valueOrDash(compassHeading, 1)}° · ${getCardinalDirection(compassHeading)}` : 'No heading packet'}</span>
              </div>
            </div>
            <span className={`health-tag ${esp32Online ? 'tag-green' : 'tag-red'}`}>
              {esp32Online ? 'LOCKED' : 'OFFLINE'}
            </span>
          </div>

          <div className="subsystem-row">
            <div className="subsystem-info">
              <Radio size={15} className={companionOnline ? 'tone-blue' : 'tone-muted'} />
              <div>
                <strong>Companion Computer (Gateway)</strong>
                <span>CrossFlight protocol link</span>
              </div>
            </div>
              <StatusPill online={companionOnline}>
                {isDemo ? 'SIMULATED' : companionOnline ? 'CONNECTED' : 'STANDBY'}
              </StatusPill>
          </div>

          <div className="subsystem-row">
            <div className="subsystem-info">
              <Shield size={15} className={fcOnline ? 'tone-green' : 'tone-muted'} />
              <div>
                <strong>Flight Controller (CrossFlight)</strong>
                <span>Mode: {fcFresh ? status?.flightController?.mode || 'ALT HOLD' : '--'} · {status?.flightController?.armed ? 'ARMED' : 'DISARMED'}</span>
              </div>
            </div>
              <StatusPill online={fcOnline}>
                {isDemo ? 'SIMULATED' : fcOnline ? 'ONLINE' : 'STANDBY'}
              </StatusPill>
          </div>
        </div>
      </Panel>
    </div>
  </>
}

// ── Realtime Tactical Obstacle Radar Scope ───────────────────────────────────
function TacticalRadarWidget({ mapping, tfLuna, gy53 }) {
  const angleDeg = mapping?.horizontalAngle ?? mapping?.angle ?? 65
  const obstaclePresent = mapping?.obstacle === true || tfLuna?.distance < 1.2
  const targetX = mapping?.points?.[0]?.x ?? mapping?.x ?? 0.718
  const targetY = mapping?.points?.[0]?.y ?? mapping?.y ?? 1.541
  const targetDist = Math.hypot(targetX, targetY) || tfLuna?.distance || 1.70

  // 180x180 radar scope: center at (90, 90), radius max 76px corresponds to 2.5 meters
  const cx = 90
  const cy = 90
  const maxRangeM = 2.5
  const scale = 72 / maxRangeM // px per meter

  // Target position in SVG coordinates (Y is forward, X is right)
  const px = cx + targetX * scale
  const py = cy - targetY * scale

  // Radar sweep line endpoint
  const rad = (angleDeg - 90) * (Math.PI / 180)
  const sweepX = cx + Math.cos(rad) * 74
  const sweepY = cy + Math.sin(rad) * 74

  return <div className="tactical-radar-container">
    <div className="radar-viewport">
      <svg className="radar-svg" viewBox="0 0 180 180">
        {/* Radar concentric rings */}
        <circle cx={cx} cy={cy} r={72} fill="#09111c" stroke="#1c2d40" strokeWidth="1" />
        <circle cx={cx} cy={cy} r={54} fill="none" stroke="#162536" strokeWidth="1" strokeDasharray="3 3" />
        <circle cx={cx} cy={cy} r={36} fill="none" stroke="#162536" strokeWidth="1" strokeDasharray="3 3" />
        <circle cx={cx} cy={cy} r={18} fill="none" stroke="#1c2d40" strokeWidth="1" />

        {/* Crosshair axes */}
        <line x1={cx} y1={12} x2={cx} y2={168} stroke="#182a3d" strokeWidth="1" />
        <line x1={12} y1={cy} x2={168} y2={cy} stroke="#182a3d" strokeWidth="1" />

        {/* Distance labels */}
        <text x={cx + 3} y={cy - 20} fill="#546a84" fontSize="7" fontFamily="DM Mono">0.5m</text>
        <text x={cx + 3} y={cy - 38} fill="#546a84" fontSize="7" fontFamily="DM Mono">1.0m</text>
        <text x={cx + 3} y={cy - 56} fill="#546a84" fontSize="7" fontFamily="DM Mono">1.5m</text>
        <text x={cx + 3} y={cy - 73} fill="#546a84" fontSize="7" fontFamily="DM Mono">2.0m</text>

        {/* Radar sweep line to current scan angle */}
        <line x1={cx} y1={cy} x2={sweepX} y2={sweepY} stroke="#00e5ff" strokeWidth="1.5" strokeOpacity="0.8" />
        <circle cx={sweepX} cy={sweepY} r="3" fill="#00e5ff" fillOpacity="0.6" />

        {/* Target blip */}
        {obstaclePresent && (
          <g className="radar-target-blip">
            <circle cx={px} cy={py} r="9" fill="none" stroke="#ff4757" strokeWidth="1" strokeDasharray="2 2" className="radar-pulse-ring" />
            <circle cx={px} cy={py} r="4" fill="#ff4757" />
            <line x1={px} y1={py} x2={px + 12} y2={py - 12} stroke="#ff4757" strokeWidth="1" />
            <rect x={px + 12} y={py - 18} width="38" height="12" fill="#180b10" stroke="#ff4757" strokeWidth="0.8" rx="2" />
            <text x={px + 15} y={py - 9} fill="#ff6b81" fontSize="7" fontFamily="DM Mono">{targetDist.toFixed(2)}m</text>
          </g>
        )}

        {/* Center UAV position */}
        <circle cx={cx} cy={cy} r="3.5" fill="#51d5a0" />
        <polygon points={`${cx},${cy - 8} ${cx - 4},${cy + 4} ${cx + 4},${cy + 4}`} fill="#51c5ff" />
      </svg>
    </div>

    {/* Radar Telemetry Sidebar Data */}
    <div className="radar-readout">
      <div className={`proximity-banner ${targetDist < 1.0 ? 'hazard-critical' : 'hazard-warning'}`}>
        <Target size={14} />
        <div>
          <strong>{targetDist < 1.0 ? 'OBSTACLE IN PROXIMITY' : 'TARGET ACQUIRED'}</strong>
          <span>{targetDist.toFixed(2)} m @ {angleDeg}° Bearing</span>
        </div>
      </div>

      <div className="radar-data-grid">
        <div className="data-chip">
          <span>X-OFFSET:</span>
          <b>{targetX > 0 ? `+${targetX.toFixed(2)}` : targetX.toFixed(2)} m</b>
        </div>
        <div className="data-chip">
          <span>Y-FORWARD:</span>
          <b>+{targetY.toFixed(2)} m</b>
        </div>
        <div className="data-chip">
          <span>SCAN ANGLE:</span>
          <b>{angleDeg}°</b>
        </div>
        <div className="data-chip">
          <span>TF-LUNA RAW:</span>
          <b>{tfLuna?.distanceCm ?? 170} cm</b>
        </div>
      </div>
    </div>
  </div>
}

// ── Aerospace Compass Rose & Attitude HUD ───────────────────────────────────
function CompassHudWidget({ heading = 225, telemetry }) {
  const roll = telemetry?.roll ?? -1.2
  const pitch = telemetry?.pitch ?? 3.6
  const cardinal = getCardinalDirection(heading)
  const normHeading = Math.round(heading % 360)

  // Circular Compass Rose (180x180)
  const cx = 90
  const cy = 90
  const radius = 68

  return <div className="compass-hud-container">
    <div className="compass-viewport">
      <svg className="compass-svg" viewBox="0 0 180 180">
        {/* Fixed outer ring */}
        <circle cx={cx} cy={cy} r={radius} fill="#09111c" stroke="#1d2d3e" strokeWidth="1.5" />

        {/* Rotating Compass Dial: Rotates with -heading */}
        <g transform={`rotate(${-normHeading}, ${cx}, ${cy})`} style={{ transition: 'transform 0.3s ease-out' }}>
          {/* Degree tick marks every 30 deg */}
          {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg) => {
            const radVal = (deg - 90) * (Math.PI / 180)
            const x1 = cx + Math.cos(radVal) * (radius - 2)
            const y1 = cy + Math.sin(radVal) * (radius - 2)
            const x2 = cx + Math.cos(radVal) * (radius - (deg % 90 === 0 ? 10 : 5))
            const y2 = cy + Math.sin(radVal) * (radius - (deg % 90 === 0 ? 10 : 5))
            return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#3b526d" strokeWidth="1" />
          })}

          {/* Cardinal Directions */}
          <text x={cx} y={cy - radius + 18} fill="#ff4757" fontSize="11" fontWeight="700" textAnchor="middle" fontFamily="Space Grotesk">N</text>
          <text x={cx + radius - 18} y={cy + 4} fill="#8da2b8" fontSize="10" fontWeight="600" textAnchor="middle" fontFamily="Space Grotesk">E</text>
          <text x={cx} y={cy + radius - 10} fill="#8da2b8" fontSize="10" fontWeight="600" textAnchor="middle" fontFamily="Space Grotesk">S</text>
          <text x={cx - radius + 18} y={cy + 4} fill="#8da2b8" fontSize="10" fontWeight="600" textAnchor="middle" fontFamily="Space Grotesk">W</text>
        </g>

        {/* Fixed Center Reticle / Aircraft Heading Indicator */}
        <polygon points={`${cx},${cy - radius + 3} ${cx - 5},${cy - radius + 12} ${cx + 5},${cy - radius + 12}`} fill="#00e5ff" />
        <circle cx={cx} cy={cy} r="18" fill="#101c2a" stroke="#253a50" strokeWidth="1" />
        <text x={cx} y={cy + 4} fill="#e6edf6" fontSize="10" fontWeight="700" textAnchor="middle" fontFamily="DM Mono">{normHeading}°</text>
      </svg>
    </div>

    {/* Compass Readouts & Attitude */}
    <div className="compass-data-column">
      <div className="bearing-card">
        <span className="bearing-label">HEADING BEARING</span>
        <div className="bearing-val">
          <strong>{normHeading}°</strong>
          <span className="cardinal-badge">{cardinal}</span>
        </div>
      </div>

      <div className="attitude-bars">
        <div className="attitude-row">
          <span>ROLL ATTITUDE</span>
          <b>{roll > 0 ? `+${roll.toFixed(1)}` : roll.toFixed(1)}°</b>
        </div>
        <div className="attitude-track">
          <div className="attitude-indicator" style={{ left: `${Math.min(95, Math.max(5, 50 + roll * 2))}%` }} />
        </div>

        <div className="attitude-row" style={{ marginTop: 8 }}>
          <span>PITCH ATTITUDE</span>
          <b>{pitch > 0 ? `+${pitch.toFixed(1)}` : pitch.toFixed(1)}°</b>
        </div>
        <div className="attitude-track">
          <div className="attitude-indicator" style={{ left: `${Math.min(95, Math.max(5, 50 + pitch * 2))}%` }} />
        </div>
      </div>
    </div>
  </div>
}

// ── Live Rolling Telemetry Stream Chart ──────────────────────────────────────
function RollingStreamChart({ history = [], metric = 'lidar' }) {
  const configs = {
    lidar: {
      key: 'lidar',
      label: 'TF-Luna Forward Range',
      unit: 'm',
      color: '#00e5ff',
      gradientId: 'streamCyan',
      format: (v) => `${Number(v).toFixed(2)} m`,
    },
    tof: {
      key: 'tofMm',
      label: 'VL53L0X Laser Proximity',
      unit: 'mm',
      color: '#51d5a0',
      gradientId: 'streamGreen',
      format: (v) => `${Math.round(v)} mm`,
    },
    heading: {
      key: 'heading',
      label: 'Compass Bearing Angle',
      unit: '°',
      color: '#f3bd62',
      gradientId: 'streamYellow',
      format: (v) => `${Number(v).toFixed(1)}°`,
    },
    voltage: {
      key: 'voltage',
      label: '4S Flight Battery Voltage',
      unit: 'V',
      color: '#70caff',
      gradientId: 'streamBlue',
      format: (v) => `${Number(v).toFixed(2)} V`,
    },
  }

  const activeConf = configs[metric] || configs.lidar
  const values = history.map((p) => p[activeConf.key]).filter(Number.isFinite)
  const currentVal = values.length ? values[values.length - 1] : 0
  const minVal = values.length ? Math.min(...values) : 0
  const maxVal = values.length ? Math.max(...values) : 0
  const avgVal = values.length ? (values.reduce((a, b) => a + b, 0) / values.length) : 0

  return <div className="rolling-chart-wrapper">
    {/* Mini stats summary ribbon */}
    <div className="stream-stats-ribbon">
      <div className="ribbon-metric">
        <span>CURRENT:</span>
        <b style={{ color: activeConf.color }}>{activeConf.format(currentVal)}</b>
      </div>
      <div className="ribbon-metric">
        <span>MIN:</span>
        <b>{activeConf.format(minVal)}</b>
      </div>
      <div className="ribbon-metric">
        <span>MAX:</span>
        <b>{activeConf.format(maxVal)}</b>
      </div>
      <div className="ribbon-metric">
        <span>AVG:</span>
        <b>{activeConf.format(avgVal)}</b>
      </div>
      <div className="ribbon-live-tag">
        <span className="live-blink-dot" />
        LIVE BUFFER ({history.length} pts)
      </div>
    </div>

    <div className="chart-wrap" style={{ height: 165 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={history} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
          <defs>
            <linearGradient id={activeConf.gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={activeConf.color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={activeConf.color} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#152436" vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="time"
            tick={{ fill: '#5f738b', fontSize: 9, fontFamily: 'DM Mono' }}
            axisLine={{ stroke: '#1a293b' }}
            tickLine={false}
            interval={Math.floor(history.length / 4)}
          />
          <YAxis
            domain={['dataMin - 0.05', 'dataMax + 0.05']}
            tick={{ fill: '#5f738b', fontSize: 9, fontFamily: 'DM Mono' }}
            axisLine={{ stroke: '#1a293b' }}
            tickLine={false}
            tickFormatter={(v) => Number(v).toFixed(metric === 'heading' || metric === 'tof' ? 0 : 2)}
            width={38}
          />
          <Tooltip
            contentStyle={{ background: '#0b131e', border: '1px solid #1f354d', borderRadius: 6, fontSize: 11 }}
            formatter={(value) => [activeConf.format(value), activeConf.label]}
          />
          <Area
            type="monotone"
            dataKey={activeConf.key}
            stroke={activeConf.color}
            strokeWidth={2}
            fill={`url(#${activeConf.gradientId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  </div>
}

function SensorHealth({ name, value, unit, healthy, updatedAt, isDemo }) {
  const active = isDemo || (healthy === true && isFresh(updatedAt))
  return <div className="sensor-health"><span className={`health-dot ${active ? 'healthy' : 'unhealthy'}`} /><div><strong>{name}</strong><span>{active ? 'Operational' : healthy === false ? 'Fault reported' : isFresh(updatedAt) ? 'No live data' : 'Offline / stale'}</span></div><b>{valueOrDash(active ? value : null)}<small>{unit}</small></b></div>
}

const controlGroups = [
  {
    title: 'FLIGHT SAFETY', actions: [
      { command: 'ARM', label: 'Arm vehicle', detail: 'Request arming from flight controller', tone: 'red', critical: true },
      { command: 'DISARM', label: 'Disarm vehicle', detail: 'Request disarm from flight controller', tone: 'neutral', critical: true },
      { command: 'HOLD', label: 'Position hold', detail: 'Request hold mode from flight controller', tone: 'blue', critical: true },
      { command: 'LAND', label: 'Land', detail: 'Request landing mode from flight controller', tone: 'yellow', critical: true },
      { command: 'RETURN', label: 'Return to launch', detail: 'Request RTL from flight controller', tone: 'neutral', critical: true },
    ]
  },
  {
    title: 'PAYLOAD & PERCEPTION', actions: [
      { command: 'START_SCAN', label: 'Start LiDAR scan', detail: 'Start servo and mapping capture', tone: 'blue' },
      { command: 'STOP_SCAN', label: 'Stop LiDAR scan', detail: 'Stop mapping capture', tone: 'neutral' },
      { command: 'CAMERA_ON', label: 'Camera on', detail: 'Enable ESP32-CAM stream', tone: 'blue' },
      { command: 'CAMERA_OFF', label: 'Camera off', detail: 'Disable ESP32-CAM stream', tone: 'neutral' },
    ]
  },
]

export function MissionControl({ data, connection, isDemo, user, onCommand, pending }) {
  const protocolReady = data.status?.flightController?.protocolVerified === true
  const companionReady = connection === 'online' && Boolean(user) && data.status?.companion?.connected === true && isFresh(data.status?.updatedAt)
  const flightStatusFresh = data.status?.flightController?.connected === true && isFresh(data.status?.updatedAt)
  const flightReady = companionReady && flightStatusFresh && protocolReady
  return <>
    <div className="page-title-row"><div><div className="eyebrow">VEHICLE / CONTROL</div><h1>Mission control</h1><p>Commands are requests only; actual flight-controller feedback determines success.</p></div><StatusPill online={flightReady}>{flightReady ? 'FC LINK VERIFIED' : 'FLIGHT COMMANDS LOCKED'}</StatusPill></div>
    {!isDemo && <div className="safety-banner"><Shield size={19} /><div><strong>Safety interlock active</strong><span>Flight commands require sign-in, a live Firebase connection, and explicit verified FC protocol status.</span></div><LockKeyhole size={17} /></div>}
    {isDemo && <div className="demo-banner"><CircleDot size={17} /><div><strong>DEMO MODE — controls do not operate hardware</strong><span>Connect and authenticate a configured Firebase project to enable requests.</span></div></div>}
    <div className="mission-layout">
      <div className="control-column">{controlGroups.map((group) => <Panel key={group.title} title={group.title}><div className="control-grid">{group.actions.map((action) => {
        const flightCommand = ['ARM', 'DISARM', 'HOLD', 'LAND', 'RETURN'].includes(action.command)
        const enabled = isDemo || (companionReady && (!flightCommand || flightReady))
        return <button key={action.command} className={`control-card control-${action.tone}`} disabled={!enabled || pending[action.command]} onClick={() => onCommand(action)}>
          <span className="control-icon">{action.command === 'LAND' ? <ArrowDownToLine size={18} /> : action.command === 'ARM' ? <Shield size={18} /> : <CircleDot size={18} />}</span>
          <span className="control-copy"><strong>{action.label}</strong><small>{action.detail}</small></span>
          {pending[action.command] ? <RefreshCw size={15} className="spin" /> : <ArrowUpRight size={15} className="control-arrow" />}
        </button>
      })}</div></Panel>)}
        <Panel title="Autonomous mission"><button className="control-card control-blue auto-mission-disabled" disabled><span className="control-icon"><RouteIcon /></span><span className="control-copy"><strong>AUTO MISSION — SIMULATION ONLY</strong><small>Unavailable for real hardware by design</small></span><LockKeyhole size={15} /></button><p className="auto-mission-note">Real autonomous navigation remains disabled until localization, flight-controller integration, and safety testing are independently validated.</p></Panel>
      </div>
      <Panel title="Autonomy boundary" className="boundary-panel"><div className="boundary-icon"><LockKeyhole size={20} /></div><h3>Autonomous flight disabled</h3><p>Route planning is a local simulation only. No path or AUTO MISSION command can be sent to the vehicle.</p><div className="boundary-status"><span>REAL AUTONOMY</span><b>DISABLED</b></div><div className="boundary-status"><span>FC PROTOCOL</span><b>{flightStatusFresh && protocolReady ? 'VERIFIED' : 'NOT VERIFIED'}</b></div><div className="boundary-status"><span>RC FAILSAFE</span><b className="tone-green">RETAINED</b></div></Panel>
    </div>
    <div className="emergency-row"><div><AlertTriangle size={18} /><div><strong>Emergency response</strong><span>Request flight-controller HOLD. This does not cut motor power.</span></div></div><button className="button button-danger" disabled={!flightReady || pending.HOLD} onClick={() => onCommand({ command: 'HOLD', label: 'Emergency hold request', critical: true })}>REQUEST HOLD</button></div>
  </>
}

function RouteIcon() {
  return <MapPin size={18} />
}

export function CameraView({ camera, isDemo, connection, user, onCameraUrl }) {
  const [url, setUrl] = useState(camera?.streamUrl || camera?.url || '')
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState('')
  const [cameraError, setCameraError] = useState('')
  const frameRef = useRef(null)
  const streamUrl = camera?.streamUrl || camera?.url || url
  const cameraOnline = !isDemo && connection === 'online' && camera?.connected === true && isFresh(camera?.updatedAt)
  const validUrl = useMemo(() => {
    try { return ['http:', 'https:'].includes(new URL(streamUrl).protocol) } catch { return false }
  }, [streamUrl])
  return <>
    <div className="page-title-row"><div><div className="eyebrow">PERCEPTION / VIDEO</div><h1>Live camera</h1><p>ESP32-CAM MJPEG stream monitor.</p></div><StatusPill online={cameraOnline}>{isDemo ? 'DEMO — NO CAMERA' : cameraOnline ? 'CAMERA ONLINE' : 'CAMERA OFFLINE'}</StatusPill></div>
    <Panel title="Camera feed" action={cameraOnline ? <span className="live-tag"><i /> LIVE</span> : <span className="panel-meta">AWAITING STREAM</span>}>
      <div ref={frameRef} className="camera-frame">{cameraOnline && validUrl ? <img src={streamUrl} alt="ESP32-CAM live MJPEG stream" /> : <div className="camera-empty"><div className="camera-crosshair"><Crosshair size={36} /></div><strong>{isDemo ? 'DEMO MODE · NO CAMERA FEED' : 'Stream unavailable'}</strong><span>{isDemo ? 'Demo sensor values are never presented as camera footage.' : 'Confirm the stream URL and ESP32-CAM connectivity.'}</span></div>}
        <div className="camera-overlay camera-overlay-top"><span><span className="status-dot" /> {cameraOnline ? 'STREAMING' : 'NO SIGNAL'}</span><span>MJPEG · ESP32-CAM</span></div>
        {cameraError && <div className="camera-error">{cameraError}</div>}
        {cameraOnline && validUrl && <button className="fullscreen-link" onClick={async () => { try { if (!frameRef.current?.requestFullscreen) throw new Error('Fullscreen API is not supported by this browser.'); await frameRef.current.requestFullscreen() } catch (error) { setCameraError(`Fullscreen unavailable: ${error.message}`) } }}><Maximize size={15} /> Fullscreen</button>}
        {cameraOnline && validUrl && <a className="fullscreen-link" href={streamUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open stream</a>}
      </div>
    </Panel>
    <Panel title="Stream configuration"><form className="inline-form" onSubmit={async (event) => { event.preventDefault(); setFormError(''); try { await onCameraUrl(url); setSaved(true); window.setTimeout(() => setSaved(false), 2500) } catch (error) { setFormError(error.message || 'Unable to save camera URL.') } }}>
      <label className="field-label" htmlFor="camera-url">MJPEG stream URL</label><div className="input-row"><input id="camera-url" type="url" placeholder="http://192.168.4.1:81/stream" value={url} onChange={(event) => setUrl(event.target.value)} /><button className="button button-primary" disabled={isDemo || !user || connection !== 'online'} type="submit">{saved ? <><Check size={15} /> Saved</> : 'Save URL'}</button></div>{formError && <div className="error-message">{formError}</div>}<small>Demo settings are local only. Live changes require an authenticated Firebase connection.</small>
    </form></Panel>
  </>
}

export function LidarView({ data, isDemo, onStartScan, onStopScan, commandReady, onClear }) {
  const [clearVersion, setClearVersion] = useState(0)
  const points = Array.isArray(data.mapping?.points) ? data.mapping.points : []
  const validPointCount = points.filter((point) => point && typeof point === 'object' &&
    Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)) && Number.isFinite(Number(point.z))).length
  const mapFresh = isDemo || isFresh(data.mapping?.updatedAt)
  const clear = () => { setClearVersion((version) => version + 1); onClear?.() }
  return <>
    <div className="page-title-row"><div><div className="eyebrow">PERCEPTION / SPATIAL</div><h1>3D LiDAR mapping</h1><p>Metric point cloud in sensor-local coordinates (X, Y, Z in meters).</p></div><StatusPill online={!isDemo && connection === 'online' && mapFresh && points.length > 0}>{isDemo ? 'DEMO POINT CLOUD' : points.length ? mapFresh ? 'MAP DATA RECEIVED' : 'STALE MAP DATA' : 'NO MAP DATA'}</StatusPill></div>
    <div className="lidar-layout"><Panel title="Local point cloud" action={<div className="map-actions"><button className="button button-quiet" onClick={clear}>Clear view</button><button className="button button-quiet" disabled={!commandReady} onClick={onStopScan}>Stop scan</button><button className="button button-primary" disabled={!commandReady} onClick={onStartScan}>Start scan</button></div>}>
      <Suspense fallback={<div className="lidar-canvas canvas-loading">Loading 3D scene…</div>}><LidarScene points={points} clearVersion={clearVersion} /></Suspense><div className="lidar-legend"><span><i className="legend-dot green" /> Surface</span><span><i className="legend-dot red" /> Obstacle</span><span><i className="legend-dot blue" /> Vehicle origin</span><small>Drag to rotate · scroll to zoom · right-drag to pan</small></div>
    </Panel><div className="lidar-side"><Panel title="Scan parameters"><div className="parameter-list"><div><span>POINTS</span><b>{validPointCount.toLocaleString()}</b></div><div><span>HORIZONTAL</span><b>{valueOrDash(data.mapping?.horizontalAngle)}°</b></div><div><span>VERTICAL</span><b>{valueOrDash(data.mapping?.verticalAngle)}°</b></div><div><span>LAST UPDATE</span><b>{formatAge(data.mapping?.updatedAt)}</b></div><div><span>COORDINATE FRAME</span><b>{data.mapping?.coordinateFrame || (isDemo ? 'DEMO LOCAL' : 'UNSPECIFIED')}</b></div></div></Panel>
        <Panel title="Sensor detail"><p className="subtle-copy">Map points must be published by ESP32 #2 with sensor-local metric coordinates. The viewer does not estimate missing axes.</p><div className="sensor-measurement"><span>TF-Luna range</span><b>{valueOrDash(isDemo || (data.sensors?.tfLuna?.healthy === true && isFresh(data.sensors?.tfLuna?.updatedAt)) ? data.sensors?.tfLuna?.distance : null, 2)} <small>m</small></b></div><div className="sensor-measurement"><span>Scan angle</span><b>{valueOrDash(data.mapping?.horizontalAngle)}° <small>H</small></b></div></Panel>
      </div></div>
  </>
}

export function PlanningView({ isDemo, data, connection, user, onSavePlan, onSendMission }) {
  const liveMission = data?.mission
  const [waypoints, setWaypoints] = useState(() => [
    { id: 'wp-1', label: 'WP1', x: 0, z: 0, altitude: 2, speed: 1.5, holdSeconds: 0 },
    { id: 'wp-2', label: 'WP2', x: 2.8, z: 1.7, altitude: 2.5, speed: 1.5, holdSeconds: 0 },
    { id: 'wp-3', label: 'WP3', x: 5.4, z: 4.2, altitude: 3, speed: 1.5, holdSeconds: 0 },
  ])
  const [draft, setDraft] = useState({ label: 'WP4', x: 7, z: 6, altitude: 2.8, speed: 1.4, holdSeconds: 0 })
  const [editingId, setEditingId] = useState(null)
  const [target, setTarget] = useState({ x: 7, z: 6 })
  const [recalculated, setRecalculated] = useState(false)
  const [routeRevision, setRouteRevision] = useState(0)
  const [missionState, setMissionState] = useState('idle')
  const obstacles = [{ x: 2, z: 1.5, r: 0.9 }, { x: 4.1, z: 4.2, r: 1.05 }, { x: 6.3, z: 2, r: 0.8 }, { x: 1.8, z: 6.6, r: 0.65 }]
  const plan = useMemo(() => findRoute(target, obstacles), [target, routeRevision])
  const path = plan.path
  const width = 520
  const toSvg = (point) => ({ x: 28 + point.x / 10 * (width - 56), y: 28 + point.z / 10 * (width - 56) })
  const route = path.map(toSvg).map((point) => `${point.x},${point.y}`).join(' ')

  useEffect(() => {
    if (!liveMission || !Array.isArray(liveMission.waypoints) || liveMission.waypoints.length === 0) return
    setWaypoints(liveMission.waypoints.map((waypoint, index) => ({
      id: waypoint.id || `wp-${index + 1}`,
      label: waypoint.label || `WP${index + 1}`,
      x: Number(waypoint.x),
      z: Number(waypoint.z),
      altitude: Number(waypoint.altitude ?? 2),
      speed: Number(waypoint.speed ?? 1.5),
      holdSeconds: Number(waypoint.holdSeconds ?? 0),
    })))
  }, [liveMission])

  useEffect(() => {
    if (!waypoints.length) return
    const lastWaypoint = waypoints[waypoints.length - 1]
    setTarget({ x: Number(lastWaypoint.x), z: Number(lastWaypoint.z) })
  }, [waypoints])

  useEffect(() => {
    if (isDemo || !user || connection !== 'online' || !onSavePlan) return
    const planPayload = {
      target,
      obstacles,
      route: path.map((point) => ({ x: Number(point.x), z: Number(point.z) })),
      recalculated,
      routeRevision,
    }
    void (async () => {
      try {
        await onSavePlan(planPayload)
      } catch (error) {
        // Intentionally ignore sync failures; logs are surfaced elsewhere.
      }
    })()
  }, [isDemo, user, connection, onSavePlan, target, recalculated, routeRevision, path])

  const moveTarget = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(10, ((event.clientX - rect.left) / rect.width) * 10))
    const z = Math.max(0, Math.min(10, ((event.clientY - rect.top) / rect.height) * 10))
    setTarget({ x: Number(x.toFixed(1)), z: Number(z.toFixed(1)) })
    setRecalculated(false)
  }

  const addWaypoint = (event) => {
    event.preventDefault()
    const nextWaypoint = {
      id: editingId || `wp-${Date.now()}`,
      label: draft.label || `WP${waypoints.length + 1}`,
      x: Number(draft.x),
      z: Number(draft.z),
      altitude: Number(draft.altitude || 2),
      speed: Number(draft.speed || 1.5),
      holdSeconds: Number(draft.holdSeconds || 0),
    }
    if (editingId) {
      setWaypoints((current) => current.map((waypoint) => (waypoint.id === editingId ? nextWaypoint : waypoint)))
      setEditingId(null)
    } else {
      setWaypoints((current) => [...current, nextWaypoint])
    }
    setDraft({ label: `WP${waypoints.length + 2}`, x: 7, z: 6, altitude: 2.8, speed: 1.5, holdSeconds: 0 })
  }

  const removeWaypoint = (id) => {
    setWaypoints((current) => current.filter((waypoint) => waypoint.id !== id))
    if (editingId === id) setEditingId(null)
  }

  const startEditing = (waypoint) => {
    setEditingId(waypoint.id)
    setDraft({ ...waypoint })
  }

  const sendMission = async () => {
    if (typeof onSendMission !== 'function') return
    setMissionState('sending')
    try {
      const missionPayload = {
        missionId: `mission-${Date.now()}`,
        waypoints,
        route: waypoints.map((waypoint) => ({ x: Number(waypoint.x), z: Number(waypoint.z), altitude: Number(waypoint.altitude || 2) })),
        target: { x: Number(target.x), z: Number(target.z) },
      }
      await onSendMission(missionPayload)
      setMissionState('queued')
    } catch (error) {
      setMissionState(error?.message || 'failed')
    }
  }

  const missionLiveStatus = isDemo ? 'DEMO MODE' : liveMission?.status || liveMission?.state || missionState || 'READY'
  return <>
    <div className="page-title-row"><div><div className="eyebrow">MISSION / WAYPOINTS</div><h1>Mission planner</h1><p>{isDemo ? 'Route planning sandbox only. Real hardware delivery stays disabled in demo mode.' : 'Plan a route, publish it to Firebase, and send it to the ESP32 gateway.'}</p></div><span className="sim-tag"><MapPin size={14} /> {isDemo ? 'SIMULATION ONLY' : 'DATABASE LINKED'}</span></div>
    <div className="safety-banner"><LockKeyhole size={18} /><div><strong>{isDemo ? 'Mission transfer is disabled in demo mode' : 'Mission transfer is active through Firebase'}</strong><span>{isDemo ? 'This planner does not send data to hardware until live mode is enabled.' : 'Generated waypoint missions are written to the live database and are available for ESP32 #2 to fetch.'}</span></div></div>
    <div className="planning-layout"><Panel title="Local obstacle map" action={<button className="text-button" onClick={() => { setTarget({ x: 7, z: 6 }); setRecalculated(false) }}>Reset scene <RefreshCw size={13} /></button>}>
      <div className="map-instructions">Click map to place a target. Waypoints are converted into a mission payload and published to the live hardware path.</div>
      <svg className="planning-map" viewBox={`0 0 ${width} ${width}`} role="button" aria-label="Click to place simulated target" onClick={moveTarget}>
        <defs><pattern id="grid" width="46.4" height="46.4" patternUnits="userSpaceOnUse"><path d="M 46.4 0 L 0 0 0 46.4" fill="none" stroke="#1c2b3c" strokeWidth="1" /></pattern></defs>
        <rect x="0" y="0" width={width} height={width} fill="url(#grid)" />
        {obstacles.map((obstacle, index) => { const p = toSvg(obstacle); return <g key={index}><circle cx={p.x} cy={p.y} r={obstacle.r / 10 * (width - 56)} fill="#ff63721a" stroke="#ff6372" strokeDasharray="4 4" /><circle cx={p.x} cy={p.y} r="4" fill="#ff6372" /></g> })}
        <polyline points={route} fill="none" stroke="#51c5ff" strokeWidth="3" strokeDasharray="8 5" />
        {waypoints.map((waypoint, index) => { const p = toSvg({ x: waypoint.x, z: waypoint.z }); return <g key={waypoint.id}><circle cx={p.x} cy={p.y} r="5" fill={index === 0 ? '#52d9a1' : '#51c5ff'} /><text x={p.x + 9} y={p.y + 4} fill="#dfeaf8" fontSize="10">{waypoint.label}</text></g> })}
        {(() => { const p = toSvg({ x: 0, z: 0 }); return <g><circle cx={p.x} cy={p.y} r="10" fill="#52d9a1" /><path d={`M ${p.x - 6} ${p.y} l 6 -6 l 6 6 l -6 6 z`} fill="#0b111c" /><text x={p.x + 14} y={p.y + 4} fill="#b9c9dc" fontSize="11">START</text></g> })()}
        {(() => { const p = toSvg(target); return <g><circle cx={p.x} cy={p.y} r="10" fill="#51c5ff" /><circle cx={p.x} cy={p.y} r="4" fill="#0b111c" /><text x={p.x + 14} y={p.y + 4} fill="#b9c9dc" fontSize="11">TARGET</text></g> })()}
      </svg>
      <div className="map-legend"><span><i className="legend-dot green" /> Start</span><span><i className="legend-dot blue" /> Mission waypoints</span><span><i className="legend-dot red" /> Obstacle</span></div>
    </Panel><div className="planning-side"><Panel title="Route proposal"><div className="route-summary"><div className="route-count">{path.length}<small> WAYPOINTS</small></div><div className={`route-check ${plan.blocked ? 'tone-red' : ''}`}>{plan.blocked ? <AlertTriangle size={15} /> : <Check size={15} />}{plan.blocked ? 'No safe path' : recalculated ? 'Route recalculated' : 'Route clear'}</div></div><div className="parameter-list"><div><span>START</span><b>(0.0, 0.0) m</b></div><div><span>TARGET</span><b>({target.x.toFixed(1)}, {target.z.toFixed(1)}) m</b></div><div><span>EST. DISTANCE</span><b>{path.reduce((sum, point, index) => index ? sum + Math.hypot(point.x - path[index - 1].x, point.z - path[index - 1].z) : 0, 0).toFixed(1)} m</b></div></div><button className="button button-primary full-button" onClick={() => { setRouteRevision((revision) => revision + 1); setRecalculated(true) }}><RefreshCw size={15} /> Recalculate route</button></Panel><Panel title="Mission status"><div className="parameter-list"><div><span>STATUS</span><b>{missionLiveStatus}</b></div><div><span>GATEWAY</span><b>{isDemo ? 'SIMULATED' : connection === 'online' ? 'CONNECTED' : 'OFFLINE'}</b></div><div><span>WAYPOINTS</span><b>{waypoints.length}</b></div><div><span>LAST UPDATE</span><b>{formatAge(liveMission?.updatedAt || liveMission?.createdAt)}</b></div></div><button className="button button-primary full-button" disabled={isDemo || !user || connection !== 'online' || missionState === 'sending'} onClick={sendMission}><Radio size={15} /> {missionState === 'sending' ? 'Sending...' : 'Send Mission to Hardware'}</button></Panel><Panel title="Live hardware data"><div className="parameter-list"><div><span>ESP32 #2</span><b>{data?.status?.mappingController?.connected && connection === 'online' ? 'ONLINE' : 'OFFLINE'}</b></div><div><span>LiDAR</span><b>{valueOrDash((data?.sensors?.tfLuna?.healthy === true && isFresh(data?.sensors?.tfLuna?.updatedAt)) ? data?.sensors?.tfLuna?.distance : null, 2)} m</b></div><div><span>MAX RANGE</span><b>{valueOrDash((data?.mapping?.points?.length ? Math.max(...data.mapping.points.map((point) => Number(point.distance || Math.hypot(point.x, point.z)))) : null), 2)} m</b></div><div><span>SCAN ANGLE</span><b>{valueOrDash(data?.mapping?.horizontalAngle)}°</b></div><div><span>MISSION STATE</span><b>{liveMission?.status || 'WAITING'}</b></div></div></Panel></div></div>
    <div className="planning-layout" style={{ marginTop: 14 }}><Panel title="Waypoint editor"><form className="inline-form" onSubmit={addWaypoint}><div className="input-row"><input type="text" value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Waypoint label" /><input type="number" step="0.1" value={draft.x} onChange={(event) => setDraft((current) => ({ ...current, x: event.target.value }))} placeholder="X" /><input type="number" step="0.1" value={draft.z} onChange={(event) => setDraft((current) => ({ ...current, z: event.target.value }))} placeholder="Z" /><input type="number" step="0.1" value={draft.altitude} onChange={(event) => setDraft((current) => ({ ...current, altitude: event.target.value }))} placeholder="Alt" /></div><div className="input-row"><input type="number" step="0.1" value={draft.speed} onChange={(event) => setDraft((current) => ({ ...current, speed: event.target.value }))} placeholder="Speed" /><input type="number" step="1" value={draft.holdSeconds} onChange={(event) => setDraft((current) => ({ ...current, holdSeconds: event.target.value }))} placeholder="Hold (s)" /><button className="button button-primary" type="submit">{editingId ? 'Save waypoint' : 'Add waypoint'}</button></div></form><div className="status-list" style={{ marginTop: 12 }}>{waypoints.map((waypoint, index) => <div className="status-row" key={waypoint.id}><span><MapPin size={15} /> {waypoint.label || `WP${index + 1}`} · ({Number(waypoint.x).toFixed(1)}, {Number(waypoint.z).toFixed(1)}) m</span><div style={{ display: 'flex', gap: 8 }}><button className="text-button" onClick={() => startEditing(waypoint)}>Edit</button><button className="text-button" onClick={() => removeWaypoint(waypoint.id)}>Delete</button></div></div>)}</div></Panel><Panel title="Command history"><div className="status-list"><div className="status-row"><span><Signal size={15} /> Mission queued</span><strong>{missionLiveStatus}</strong></div><div className="status-row"><span><Wifi size={15} /> Delivery</span><strong>{isDemo ? 'SIMULATED' : liveMission?.delivery || 'PENDING'}</strong></div><div className="status-row"><span><Shield size={15} /> Hardware ACK</span><strong>{isDemo ? 'SIMULATED' : liveMission?.ack || 'PENDING'}</strong></div><div className="status-row"><span><Activity size={15} /> Last sync</span><strong>{formatAge(liveMission?.updatedAt || liveMission?.createdAt)}</strong></div></div></Panel></div>
  </>
}

export function SensorsView({ data, isDemo }) {
  const sensors = data.sensors
  const entries = [
    { name: 'TF-Luna', model: 'Time-of-flight LiDAR · forward range', value: sensors?.tfLuna?.distance, unit: 'm', healthy: sensors?.tfLuna?.healthy, updatedAt: sensors?.tfLuna?.updatedAt, digits: 2 },
    { name: 'GY-53 / VL53L0X', model: 'Time-of-flight distance sensor', value: sensors?.gy53?.distance, unit: 'm', healthy: sensors?.gy53?.healthy, updatedAt: sensors?.gy53?.updatedAt, digits: 2 },
    { name: 'HMC5883L', model: '3-axis digital compass', value: sensors?.hmc5883l?.heading, unit: '°', healthy: sensors?.hmc5883l?.healthy, updatedAt: sensors?.hmc5883l?.updatedAt, digits: 1 },
  ]
  return <>
    <div className="page-title-row"><div><div className="eyebrow">PERCEPTION / HEALTH</div><h1>Sensor monitoring</h1><p>Hardware measurements and per-sensor connection health.</p></div><StatusPill online={isDemo || entries.some((entry) => entry.healthy === true && isFresh(entry.updatedAt))}>{isDemo ? 'DEMO DATA' : entries.some((entry) => entry.healthy === true && isFresh(entry.updatedAt)) ? 'SENSOR DATA RECEIVED' : 'SENSORS OFFLINE'}</StatusPill></div>
    <div className="sensor-cards">{entries.map((sensor) => { const online = sensor.healthy === true && isFresh(sensor.updatedAt); return <Panel key={sensor.name} title={sensor.name} action={<span className={`health-label ${isDemo || online ? 'tone-green' : 'tone-red'}`}><i className={`health-dot ${isDemo || online ? 'healthy' : 'unhealthy'}`} />{isDemo ? 'DEMO' : online ? 'HEALTHY' : sensor.healthy === false ? 'FAULT' : 'OFFLINE'}</span>}><div className="sensor-big-value">{valueOrDash(isDemo || online ? sensor.value : null, sensor.digits)}<small>{sensor.unit}</small></div><div className="sensor-model">{sensor.model}</div><div className="sensor-last-update">Last update <b>{formatAge(sensor.updatedAt)}</b></div></Panel> })}</div>
    <Panel title="Flight and power sensors"><div className="detail-grid"><div><span>Battery voltage</span><strong>{valueOrDash(isDemo || isFresh(data.telemetry?.updatedAt) ? data.telemetry?.batteryVoltage : null, 2)} V</strong></div><div><span>Relative altitude</span><strong>{valueOrDash(isDemo || isFresh(data.telemetry?.updatedAt) ? data.telemetry?.altitude : null, 2)} m</strong></div><div><span>Flight-controller health</span><strong>{isDemo ? 'DEMO ONLY' : data.status?.flightController?.connected && isFresh(data.status?.updatedAt) ? 'CONNECTED' : 'OFFLINE'}</strong></div><div><span>Last telemetry</span><strong>{formatAge(data.telemetry?.updatedAt)}</strong></div></div></Panel>
  </>
}

export function TelemetryView({ data, isDemo }) {
  const history = isDemo ? demoHistory : []
  const telemetryFresh = isFresh(data.telemetry?.updatedAt)
  return <>
    <div className="page-title-row"><div><div className="eyebrow">FLIGHT DATA / TELEMETRY</div><h1>Telemetry</h1><p>Flight-controller telemetry reported through the companion link.</p></div><StatusPill online={isDemo || telemetryFresh}>{isDemo ? 'DEMO TELEMETRY' : telemetryFresh ? 'DATA RECEIVED' : 'NO TELEMETRY'}</StatusPill></div>
    <div className="metrics-grid telemetry-metrics"><Metric label="BATTERY" value={valueOrDash(telemetryFresh || isDemo ? data.telemetry?.batteryVoltage : null, 2)} unit="V" icon={Battery} tone="green" /><Metric label="ALTITUDE" value={valueOrDash(telemetryFresh || isDemo ? data.telemetry?.altitude : null, 2)} unit="m" icon={ArrowUpRight} /><Metric label="HEADING" value={valueOrDash(telemetryFresh || isDemo ? data.telemetry?.heading : null, 1)} unit="°" icon={Compass} /><Metric label="ATTITUDE" value={`${valueOrDash(telemetryFresh || isDemo ? data.telemetry?.roll : null)} / ${valueOrDash(telemetryFresh || isDemo ? data.telemetry?.pitch : null)}`} unit="°" icon={Activity} /></div>
    <Panel title="Altitude profile">{history.length ? <div className="chart-wrap chart-tall"><ResponsiveContainer width="100%" height="100%"><LineChart data={history}><CartesianGrid stroke="#1b2838" vertical={false} /><XAxis dataKey="time" tick={{ fill: '#69798e', fontSize: 10 }} axisLine={false} tickLine={false} interval={3} /><YAxis tick={{ fill: '#69798e', fontSize: 10 }} axisLine={false} tickLine={false} width={34} /><Tooltip contentStyle={{ background: '#101a28', border: '1px solid #29384a', borderRadius: 8 }} /><Line type="monotone" dataKey="altitude" stroke="#51c5ff" dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer></div> : <div className="empty-chart"><Activity size={21} /><span>Waiting for real flight-controller telemetry</span></div>}</Panel>
    <Panel title="Telemetry source"><div className="detail-grid"><div><span>Source</span><strong>{isDemo ? 'Explicit demo simulator' : 'Firebase /drone/telemetry'}</strong></div><div><span>Updated</span><strong>{formatAge(data.telemetry?.updatedAt)}</strong></div><div><span>Position / GPS</span><strong>{telemetryFresh && data.telemetry?.position ? 'Available' : 'Not reported'}</strong></div><div><span>Altitude field</span><strong>{(telemetryFresh || isDemo) && data.telemetry?.altitude !== null && data.telemetry?.altitude !== undefined ? 'Available' : 'Unavailable'}</strong></div></div></Panel>
  </>
}

export function LogsView({ logs, isDemo, onClear }) {
  return <>
    <div className="page-title-row"><div><div className="eyebrow">SYSTEM / EVENT JOURNAL</div><h1>System logs</h1><p>Command requests, acknowledgements, telemetry and connection events.</p></div><button className="button button-quiet" onClick={onClear}>Clear visible logs</button></div>
    <Panel title="Event stream" action={<span className="panel-meta">{logs.length} EVENTS</span>}><div className="logs-table-wrap"><table className="logs-table"><thead><tr><th>TIME</th><th>TYPE</th><th>EVENT</th><th>DETAIL</th><th>SOURCE</th></tr></thead><tbody>{logs.length ? logs.map((log) => <tr key={log.id}><td className="log-time">{new Date(log.time).toLocaleTimeString()}</td><td><span className={`log-type type-${log.type.toLowerCase()}`}>{log.type}</span></td><td>{log.event}</td><td className="log-detail">{log.detail}</td><td>{log.source}</td></tr>) : <tr><td colSpan="5" className="no-logs">No events recorded in this session.</td></tr>}</tbody></table></div></Panel>
    <div className="log-footnote"><Signal size={14} /> {isDemo ? 'Demo entries are labeled and are not hardware events.' : 'Events in this session are displayed from local listeners.'}</div>
  </>
}

export function SettingsView({ isDemo, user, firebaseConfigured, onModeChange, onSignIn, onSignOut, connection }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try { await onSignIn(email, password) } catch (signInError) { setError(signInError.message || 'Sign-in failed.') } finally { setBusy(false) }
  }
  return <>
    <div className="page-title-row"><div><div className="eyebrow">SYSTEM / CONFIGURATION</div><h1>Settings</h1><p>Choose the data source and configure authenticated Firebase access.</p></div><StatusPill online={isDemo || connection === 'online'}>{isDemo ? 'DEMO MODE' : connection === 'online' ? 'FIREBASE CONNECTED' : 'OFFLINE'}</StatusPill></div>
    <Panel title="Operating mode"><div className="mode-selector"><button className={`mode-option ${isDemo ? 'selected' : ''}`} onClick={() => onModeChange('demo')}><span className="mode-radio" /><div><strong>DEMO SIMULATOR</strong><small>Local-only sample data. No hardware commands are sent.</small></div><span className="mode-badge">SAFE</span></button><button className={`mode-option ${!isDemo ? 'selected' : ''}`} onClick={() => onModeChange('live')}><span className="mode-radio" /><div><strong>LIVE FIREBASE</strong><small>Listen to authenticated Firebase data and send allowed command requests.</small></div><span className="mode-badge mode-live">LIVE</span></button></div></Panel>
    <Panel title="Firebase authentication" action={firebaseConfigured ? <span className="panel-meta">CONFIGURED</span> : <span className="health-label tone-yellow">MISSING ENV CONFIG</span>}>
      {user ? <div className="auth-success"><div className="auth-avatar">{user.email?.slice(0, 1).toUpperCase() || 'U'}</div><div><strong>Signed in</strong><span>{user.email}</span></div><button className="button button-quiet" onClick={onSignOut}>Sign out</button></div>
        : <form className="auth-form" onSubmit={submit}><div className="auth-intro"><LockKeyhole size={18} /><span>Sign in with a Firebase Authentication email/password account. Account creation is managed in Firebase Console.</span></div><div className="form-grid"><label className="field-label">Email<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label className="field-label">Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label></div>{error && <div className="error-message">{error}</div>}<button className="button button-primary" disabled={!firebaseConfigured || busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form>}
    </Panel>
    <Panel title="Firebase project"><p className="subtle-copy">Set the VITE_FIREBASE_* values in <code>.env.local</code>. Firebase web configuration is project-identifying information, not a service-account credential. Restrict its API key and enforce Authentication + Realtime Database Rules.</p><div className="detail-grid"><div><span>Firebase SDK</span><strong>{firebaseConfigured ? 'Ready' : 'Not configured'}</strong></div><div><span>Realtime Database</span><strong>{firebaseConfigured ? 'Configured by environment' : 'Unavailable'}</strong></div><div><span>Authentication</span><strong>{user ? 'Signed in' : 'Not signed in'}</strong></div><div><span>Live link</span><strong>{isDemo ? 'Not active in demo mode' : connection === 'online' ? 'Connected' : 'Offline'}</strong></div></div></Panel>
  </>
}
