import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowUpRight, Battery, Check, CircleDot,
  Compass, Crosshair, ExternalLink, Gauge, LockKeyhole, MapPin, Maximize, Radio, RefreshCw, Shield,
  Signal, Wifi, WifiOff,
} from 'lucide-react'
import { demoHistory, formatAge, isFresh } from '../lib/data.js'

const LidarScene = lazy(() => import('./LidarScene.jsx'))
const valueOrDash = (value, digits = 1) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '--'

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
  const telemetryFresh = isDemo || isFresh(telemetry?.updatedAt)
  const fcFresh = isDemo || (connection === 'online' && Boolean(status?.flightController?.connected) && isFresh(status?.updatedAt))
  const compassHeading = isDemo || (sensors?.hmc5883l?.healthy === true && isFresh(sensors?.hmc5883l?.updatedAt))
    ? sensors?.hmc5883l?.heading
    : telemetryFresh ? telemetry?.heading : null
  const fcOnline = connection === 'online' && status?.flightController?.connected && isFresh(status?.updatedAt)
  const companionOnline = connection === 'online' && status?.companion?.connected && isFresh(status?.updatedAt)
  return <>
    <div className="page-title-row">
      <div><div className="eyebrow">FLIGHT DECK / OVERVIEW</div><h1>Mission dashboard</h1><p>Live vehicle health and sensor overview.</p></div>
      <StatusPill online={isDemo || connection === 'online'}>{isDemo ? 'DEMO SIMULATOR' : connection === 'online' ? 'FIREBASE ONLINE' : 'HARDWARE OFFLINE'}</StatusPill>
    </div>
    <div className="metrics-grid">
      <Metric label="BATTERY" value={valueOrDash(telemetryFresh ? telemetry?.batteryVoltage : null, 2)} unit="V" icon={Battery} tone="green" note="4S pack · FC reported" />
      <Metric label="HEADING" value={valueOrDash(compassHeading)} unit="°" icon={Compass} tone="blue" note="HMC5883L compass" />
      <Metric label="ALTITUDE" value={valueOrDash(telemetryFresh ? telemetry?.altitude : null, 1)} unit="m" icon={ArrowUpRight} tone="blue" note="When reported by FC" />
      <Metric label="FRONT RANGE" value={valueOrDash(isDemo || (sensors?.tfLuna?.healthy === true && isFresh(sensors?.tfLuna?.updatedAt)) ? sensors?.tfLuna?.distance : null, 2)} unit="m" icon={Crosshair} tone="yellow" note="TF-Luna LiDAR" />
    </div>
    <div className="dashboard-grid">
      <Panel title="Vehicle status" action={<button className="text-button" onClick={() => onNavigate('mission')}>Open controls <ArrowUpRight size={14} /></button>}>
        <div className="status-list">
          <div className="status-row"><span><Radio size={16} /> Flight controller</span><StatusPill online={isDemo || Boolean(fcOnline)}>{isDemo ? 'SIMULATED' : fcOnline ? 'CONNECTED' : 'OFFLINE'}</StatusPill></div>
          <div className="status-row"><span><Wifi size={16} /> Companion ESP32</span><StatusPill online={isDemo || Boolean(companionOnline)}>{isDemo ? 'SIMULATED' : companionOnline ? 'CONNECTED' : 'OFFLINE'}</StatusPill></div>
          <div className="status-row"><span><Wifi size={16} /> Mapping ESP32</span><StatusPill online={isDemo || Boolean(connection === 'online' && status?.mappingController?.connected && isFresh(status?.updatedAt))}>{isDemo ? 'SIMULATED' : connection === 'online' && status?.mappingController?.connected && isFresh(status?.updatedAt) ? 'CONNECTED' : 'OFFLINE'}</StatusPill></div>
          <div className="status-row"><span><Shield size={16} /> System health</span><strong className={isDemo || (isFresh(status?.updatedAt) && status?.systemHealth === 'NOMINAL') ? 'tone-green' : 'tone-yellow'}>{isDemo ? 'DEMO NOMINAL' : isFresh(status?.updatedAt) ? status?.systemHealth || 'UNKNOWN' : 'UNKNOWN'}</strong></div>
          <div className="status-row"><span><Gauge size={16} /> Flight mode</span><strong>{fcFresh ? status?.flightController?.mode || '--' : '--'}</strong></div>
          <div className="status-row"><span><Shield size={16} /> Armed state</span><strong className={!fcFresh ? 'tone-yellow' : status?.flightController?.armed ? 'tone-red' : 'tone-green'}>{!fcFresh ? 'UNKNOWN' : status?.flightController?.armed ? 'ARMED' : 'DISARMED'}</strong></div>
        </div>
      </Panel>
      <Panel title="Battery trend" action={<span className="panel-meta"><span className="legend-dot green" />Voltage</span>}>
        {isDemo
          ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={demoHistory}>
            <defs><linearGradient id="batteryFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#52d9a1" stopOpacity={0.22} /><stop offset="100%" stopColor="#52d9a1" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid stroke="#1b2838" vertical={false} /><XAxis dataKey="time" tick={{ fill: '#69798e', fontSize: 10 }} axisLine={false} tickLine={false} interval={5} /><YAxis domain={['dataMin - 0.2', 'dataMax + 0.1']} tickFormatter={(value) => Number(value).toFixed(1)} tick={{ fill: '#69798e', fontSize: 10 }} axisLine={false} tickLine={false} width={34} /><Tooltip contentStyle={{ background: '#101a28', border: '1px solid #29384a', borderRadius: 8 }} />
            <Area type="monotone" dataKey="voltage" stroke="#52d9a1" fill="url(#batteryFill)" strokeWidth={2} />
          </AreaChart></ResponsiveContainer></div>
          : <div className="empty-chart"><Activity size={21} /><span>Live chart populates as telemetry arrives</span></div>}
      </Panel>
      <Panel title="Perception health" action={<button className="text-button" onClick={() => onNavigate('sensors')}>Sensor details <ArrowUpRight size={14} /></button>}>
        <div className="sensor-health-list">
          <SensorHealth name="TF-Luna" value={sensors?.tfLuna?.distance} unit="m" healthy={sensors?.tfLuna?.healthy} updatedAt={sensors?.tfLuna?.updatedAt} isDemo={isDemo} />
          <SensorHealth name="GY-53 / VL53L0X" value={sensors?.gy53?.distance} unit="m" healthy={sensors?.gy53?.healthy} updatedAt={sensors?.gy53?.updatedAt} isDemo={isDemo} />
          <SensorHealth name="HMC5883L compass" value={sensors?.hmc5883l?.heading} unit="°" healthy={sensors?.hmc5883l?.healthy} updatedAt={sensors?.hmc5883l?.updatedAt} isDemo={isDemo} />
        </div>
      </Panel>
      <Panel title="Environment scan" action={<button className="text-button" onClick={() => onNavigate('lidar')}>Open 3D view <ArrowUpRight size={14} /></button>}>
        <div className="scan-preview">
          <div className="scan-radar"><div className="radar-sweep" /><span className="radar-center" /><span className="radar-point point-a" /><span className="radar-point point-b" /><span className="radar-point point-c" /></div>
          <div className="scan-stats"><div><strong>{data.mapping?.points?.length ?? 0}</strong><span>POINTS</span></div><div><strong>{valueOrDash(data.mapping?.horizontalAngle)}°</strong><span>H-SCAN</span></div><div><strong>{valueOrDash(data.mapping?.verticalAngle)}°</strong><span>V-SCAN</span></div></div>
        </div>
      </Panel>
    </div>
  </>
}

function SensorHealth({ name, value, unit, healthy, updatedAt, isDemo }) {
  const active = isDemo || (healthy === true && isFresh(updatedAt))
  return <div className="sensor-health"><span className={`health-dot ${active ? 'healthy' : 'unhealthy'}`} /><div><strong>{name}</strong><span>{active ? 'Operational' : healthy === false ? 'Fault reported' : isFresh(updatedAt) ? 'No live data' : 'Offline / stale'}</span></div><b>{valueOrDash(active ? value : null)}<small>{unit}</small></b></div>
}

const controlGroups = [
  { title: 'FLIGHT SAFETY', actions: [
    { command: 'ARM', label: 'Arm vehicle', detail: 'Request arming from flight controller', tone: 'red', critical: true },
    { command: 'DISARM', label: 'Disarm vehicle', detail: 'Request disarm from flight controller', tone: 'neutral', critical: true },
    { command: 'HOLD', label: 'Position hold', detail: 'Request hold mode from flight controller', tone: 'blue', critical: true },
    { command: 'LAND', label: 'Land', detail: 'Request landing mode from flight controller', tone: 'yellow', critical: true },
    { command: 'RETURN', label: 'Return to launch', detail: 'Request RTL from flight controller', tone: 'neutral', critical: true },
  ] },
  { title: 'PAYLOAD & PERCEPTION', actions: [
    { command: 'START_SCAN', label: 'Start LiDAR scan', detail: 'Start servo and mapping capture', tone: 'blue' },
    { command: 'STOP_SCAN', label: 'Stop LiDAR scan', detail: 'Stop mapping capture', tone: 'neutral' },
    { command: 'CAMERA_ON', label: 'Camera on', detail: 'Enable ESP32-CAM stream', tone: 'blue' },
    { command: 'CAMERA_OFF', label: 'Camera off', detail: 'Disable ESP32-CAM stream', tone: 'neutral' },
  ] },
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

export function PlanningView({ isDemo }) {
  const [target, setTarget] = useState({ x: 7, z: 6 })
  const [recalculated, setRecalculated] = useState(false)
  const [routeRevision, setRouteRevision] = useState(0)
  const obstacles = [{ x: 2, z: 1.5, r: 0.9 }, { x: 4.1, z: 4.2, r: 1.05 }, { x: 6.3, z: 2, r: 0.8 }, { x: 1.8, z: 6.6, r: 0.65 }]
  const plan = useMemo(() => findRoute(target, obstacles), [target, routeRevision])
  const path = plan.path
  const width = 520
  const toSvg = (point) => ({ x: 28 + point.x / 10 * (width - 56), y: 28 + point.z / 10 * (width - 56) })
  const route = path.map(toSvg).map((point) => `${point.x},${point.y}`).join(' ')
  const moveTarget = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(10, ((event.clientX - rect.left) / rect.width) * 10))
    const z = Math.max(0, Math.min(10, ((event.clientY - rect.top) / rect.height) * 10))
    setTarget({ x: Number(x.toFixed(1)), z: Number(z.toFixed(1)) })
    setRecalculated(false)
  }
  return <>
    <div className="page-title-row"><div><div className="eyebrow">LOCALIZATION / SIMULATION</div><h1>GPS-free path planning</h1><p>Sandbox route planning on a local obstacle map. No vehicle commands are sent.</p></div><span className="sim-tag"><MapPin size={14} /> SIMULATION ONLY</span></div>
    <div className="safety-banner"><LockKeyhole size={18} /><div><strong>Real autonomous navigation is disabled</strong><span>This planner is a 2D local simulation and is not connected to the flight controller.</span></div></div>
    <div className="planning-layout"><Panel title="Local obstacle map" action={<button className="text-button" onClick={() => { setTarget({ x: 7, z: 6 }); setRecalculated(false) }}>Reset scene <RefreshCw size={13} /></button>}>
      <div className="map-instructions">Click map to place a target. Route automatically skirts obstacles.</div>
      <svg className="planning-map" viewBox={`0 0 ${width} ${width}`} role="button" aria-label="Click to place simulated target" onClick={moveTarget}>
        <defs><pattern id="grid" width="46.4" height="46.4" patternUnits="userSpaceOnUse"><path d="M 46.4 0 L 0 0 0 46.4" fill="none" stroke="#1c2b3c" strokeWidth="1" /></pattern></defs>
        <rect x="0" y="0" width={width} height={width} fill="url(#grid)" />
        {obstacles.map((obstacle, index) => { const p = toSvg(obstacle); return <g key={index}><circle cx={p.x} cy={p.y} r={obstacle.r / 10 * (width - 56)} fill="#ff63721a" stroke="#ff6372" strokeDasharray="4 4" /><circle cx={p.x} cy={p.y} r="4" fill="#ff6372" /></g> })}
        <polyline points={route} fill="none" stroke="#51c5ff" strokeWidth="3" strokeDasharray="8 5" />
        {path.slice(1, -1).map((point, index) => { const p = toSvg(point); return <circle key={index} cx={p.x} cy={p.y} r="3" fill="#51c5ff" /> })}
        {(() => { const p = toSvg({ x: 0, z: 0 }); return <g><circle cx={p.x} cy={p.y} r="10" fill="#52d9a1" /><path d={`M ${p.x - 6} ${p.y} l 6 -6 l 6 6 l -6 6 z`} fill="#0b111c" /><text x={p.x + 14} y={p.y + 4} fill="#b9c9dc" fontSize="11">START</text></g> })()}
        {(() => { const p = toSvg(target); return <g><circle cx={p.x} cy={p.y} r="10" fill="#51c5ff" /><circle cx={p.x} cy={p.y} r="4" fill="#0b111c" /><text x={p.x + 14} y={p.y + 4} fill="#b9c9dc" fontSize="11">TARGET</text></g> })()}
        </svg>
      <div className="map-legend"><span><i className="legend-dot green" /> Start</span><span><i className="legend-dot blue" /> Proposed route</span><span><i className="legend-dot red" /> Obstacle</span></div>
      </Panel><div className="planning-side"><Panel title="Route proposal"><div className="route-summary"><div className="route-count">{path.length}<small> WAYPOINTS</small></div><div className={`route-check ${plan.blocked ? 'tone-red' : ''}`}>{plan.blocked ? <AlertTriangle size={15} /> : <Check size={15} />}{plan.blocked ? 'No safe path' : recalculated ? 'Route recalculated' : 'Route clear'}</div></div><div className="parameter-list"><div><span>START</span><b>(0.0, 0.0) m</b></div><div><span>TARGET</span><b>({target.x.toFixed(1)}, {target.z.toFixed(1)}) m</b></div><div><span>EST. DISTANCE</span><b>{path.reduce((sum, point, index) => index ? sum + Math.hypot(point.x - path[index - 1].x, point.z - path[index - 1].z) : 0, 0).toFixed(1)} m</b></div></div><button className="button button-primary full-button" onClick={() => { setRouteRevision((revision) => revision + 1); setRecalculated(true) }}><RefreshCw size={15} /> Recalculate route</button></Panel><Panel title="Simulation limits"><p className="subtle-copy">This example planner uses a local 2D grid and illustrative obstacle avoidance. It does not consume live sensor data or send AUTO MISSION commands.</p><div className="boundary-status"><span>REAL DRONE LINK</span><b>NONE</b></div></Panel></div></div>
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
