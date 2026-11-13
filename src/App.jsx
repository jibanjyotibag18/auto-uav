import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity, Bell, Camera, ChartNoAxesCombined, ChevronDown, CircleDot, Cpu, Gamepad2,
  LayoutDashboard, LogOut, Menu, Radio, Route, ScanLine, ScrollText, Settings2,
  Shield, Wifi, WifiOff, X,
} from 'lucide-react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { update, ref } from 'firebase/database'
import { auth, database, firebaseConfigured } from './firebase/client.js'
import { sendCommand, watchCommandResponses } from './firebase/commands.js'
import { navigation, formatAge, isFresh } from './lib/data.js'
import { useDroneData } from './hooks/useDroneData.js'
import {
  CameraView, Dashboard, LidarView, LogsView, MissionControl, PlanningView,
  SensorsView, SettingsView, TelemetryView,
} from './components/Views.jsx'

const iconMap = {
  LayoutDashboard, Gamepad2, Camera, ScanLine, Route, Radio,
  ChartNoAxesCombined, ScrollText, Settings2,
}

function addLog(setLogs, type, event, detail, source = 'SYSTEM') {
  const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, time: Date.now(), type, event, detail, source }
  setLogs((current) => [entry, ...current].slice(0, 120))
}

export default function App() {
  const [mode, setMode] = useState(() => localStorage.getItem('northstar-mode') || 'demo')
  const [page, setPage] = useState('dashboard')
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [logs, setLogs] = useState([])
  const [pending, setPending] = useState({})
  const [toast, setToast] = useState(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const responseIds = useRef(new Map())
  const lastTelemetryLog = useRef(0)
  const lastSensorLog = useRef(0)
  const { data, connection, isDemo, firebaseError } = useDroneData(mode, user)
  const hardwareHeartbeat = (data.status?.companion?.connected === true && isFresh(data.status?.updatedAt)) ||
    (data.status?.esp32SensorHub?.connected === true && isFresh(data.status?.esp32SensorHub?.updatedAt)) ||
    (isFresh(data.sensors?.updatedAt))

  const notify = useCallback((message, tone = 'info') => {
    setToast({ message, tone })
    window.setTimeout(() => setToast(null), 4200)
  }, [])

  useEffect(() => {
    if (!auth) {
      setAuthReady(true)
      return undefined
    }
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      setAuthReady(true)
    })
  }, [])

  useEffect(() => {
    localStorage.setItem('northstar-mode', mode)
    if (mode === 'demo') addLog(setLogs, 'MODE', 'Demo mode active', 'Local sample data only; no hardware commands are sent.', 'DEMO')
    else addLog(setLogs, 'MODE', 'Live Firebase mode selected', 'Waiting for authenticated database connection.', 'SYSTEM')
  }, [mode])

  useEffect(() => {
    if (mode !== 'live' || !user) return undefined
    return watchCommandResponses(user, (response) => {
      if (!response.id) return
      const signature = response.status || response.acknowledgedAt || response.message || JSON.stringify(response)
      if (responseIds.current.get(response.id) === signature) return
      responseIds.current.set(response.id, signature)
      const accepted = response.status === 'acknowledged' || response.status === 'accepted'
      const rejected = response.status === 'rejected' || response.status === 'failed' || response.status === 'expired'
      if (!accepted && !rejected) return
      const type = accepted ? 'ACK' : 'ERROR'
      addLog(setLogs, type, `${response.command || 'Command'} ${response.status}`, response.message || `Request ${response.id}`, 'FLIGHT CONTROLLER')
      setPending((current) => ({ ...current, [response.command]: false }))
      notify(`${response.command || 'Command'} ${response.status}.`, accepted ? 'success' : 'error')
    }, (error) => {
      addLog(setLogs, 'ERROR', 'Command acknowledgement listener failed', error.message, 'FIREBASE')
      notify(`Cannot read command acknowledgements: ${error.message}`, 'error')
    })
  }, [mode, user, notify])

  useEffect(() => {
    if (!firebaseError) return
    addLog(setLogs, 'ERROR', 'Firebase listener error', firebaseError, 'FIREBASE')
    notify(firebaseError, 'error')
  }, [firebaseError, notify])

  useEffect(() => {
    if (!authReady) return
    if (connection === 'online') addLog(setLogs, 'LINK', 'Firebase connection online', 'Realtime Database listener is connected.', 'FIREBASE')
    else if (!isDemo) addLog(setLogs, 'LINK', 'Hardware data offline', user ? 'No active Firebase Realtime Database connection.' : 'Sign in to begin authenticated database monitoring.', 'FIREBASE')
  }, [connection, isDemo, user, authReady])

  useEffect(() => {
    if (!data.telemetry?.updatedAt) return
    const updatedAt = Number(data.telemetry.updatedAt)
    if (Number.isFinite(updatedAt) && updatedAt - lastTelemetryLog.current < 5_000) return
    lastTelemetryLog.current = Number.isFinite(updatedAt) ? updatedAt : Date.now()
    addLog(setLogs, 'DATA', 'Telemetry update', `Heading ${Number.isFinite(Number(data.telemetry.heading)) ? `${data.telemetry.heading}°` : '--'} · battery ${Number.isFinite(Number(data.telemetry.batteryVoltage)) ? `${data.telemetry.batteryVoltage} V` : '--'}`, isDemo ? 'DEMO' : 'FLIGHT CONTROLLER')
  }, [data.telemetry?.updatedAt, isDemo])

  useEffect(() => {
    const updatedAt = Math.max(
      data.sensors?.tfLuna?.updatedAt || 0,
      data.sensors?.gy53?.updatedAt || 0,
      data.sensors?.hmc5883l?.updatedAt || 0,
    )
    if (!updatedAt) return
    if (updatedAt - lastSensorLog.current < 5_000) return
    lastSensorLog.current = updatedAt
    addLog(setLogs, 'DATA', 'Sensor update', 'New sensor measurements received.', isDemo ? 'DEMO' : 'ESP32 #1')
  }, [data.sensors?.tfLuna?.updatedAt, data.sensors?.gy53?.updatedAt, data.sensors?.hmc5883l?.updatedAt, isDemo])

  useEffect(() => {
    const fc = data.status?.flightController
    if (!fc) return
    addLog(setLogs, 'FC', 'Flight-controller status', `Connection ${fc.connected ? 'online' : 'offline'} · mode ${fc.mode || '--'} · ${fc.armed ? 'armed' : 'disarmed'}`, isDemo ? 'DEMO' : 'FLIGHT CONTROLLER')
  }, [data.status?.flightController?.connected, data.status?.flightController?.mode, data.status?.flightController?.armed, isDemo])

  const handleCommand = async (action) => {
    if (action.critical && !window.confirm(`Confirm ${action.label}? The request expires after 15 seconds and the flight controller must acknowledge it.`)) return
    if (isDemo) {
      addLog(setLogs, 'DEMO', `${action.command} preview`, 'Not transmitted to hardware (demo mode).', 'DEMO')
      notify('DEMO: command was not sent to hardware.')
      return
    }
    if (!user || connection !== 'online' || data.status?.companion?.connected !== true || !isFresh(data.status?.updatedAt)) {
      notify('Sign in and connect to Firebase before sending a request.', 'error')
      return
    }
    if (['ARM', 'DISARM', 'HOLD', 'LAND', 'RETURN'].includes(action.command) && (
      data.status?.flightController?.connected !== true ||
      !isFresh(data.status?.updatedAt) ||
      data.status?.flightController?.protocolVerified !== true
    )) {
      notify('Flight command blocked: CrossFlight protocol is not marked verified by the companion.', 'error')
      return
    }
    setPending((current) => ({ ...current, [action.command]: true }))
    try {
      const command = await sendCommand(action.command, user)
      addLog(setLogs, 'SENT', `${action.command} request sent`, `ID ${command.id} · expires ${new Date(command.expiresAt).toLocaleTimeString()}`, 'GROUND STATION')
      notify(`${action.command} request sent. Waiting for flight-controller feedback.`, 'success')
      window.setTimeout(() => setPending((current) => ({ ...current, [action.command]: false })), 15_000)
    } catch (error) {
      setPending((current) => ({ ...current, [action.command]: false }))
      addLog(setLogs, 'ERROR', `${action.command} request failed`, error.message, 'FIREBASE')
      notify(error.message || 'Command request failed.', 'error')
    }
  }

  const saveCameraUrl = async (url) => {
    if (isDemo) throw new Error('Switch to live mode to save a camera stream URL.')
    if (!database || !user || connection !== 'online') throw new Error('Authenticated Firebase connection required.')
    if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('Camera stream URL must use HTTP or HTTPS.')
    await update(ref(database, 'drone/camera'), { streamUrl: url, configuredAt: Date.now(), configuredBy: user.uid })
    addLog(setLogs, 'SENT', 'Camera URL updated', url, 'GROUND STATION')
  }

  const savePlanningData = async (plan) => {
    if (isDemo) return
    if (!database || !user || connection !== 'online') throw new Error('Authenticated Firebase connection required to sync the route plan.')
    const payload = {
      target: plan.target,
      obstacles: plan.obstacles,
      route: plan.route,
      recalculated: Boolean(plan.recalculated),
      routeRevision: Number(plan.routeRevision || 0),
      updatedAt: Date.now(),
      updatedBy: user.uid,
    }
    await update(ref(database, 'drone/planning'), payload)
    addLog(setLogs, 'SENT', 'Route plan synced', `Target (${Number(plan.target?.x).toFixed(1)}, ${Number(plan.target?.z).toFixed(1)}) m`, 'GROUND STATION')
  }

  const sendMissionToHardware = async (mission) => {
    if (isDemo) throw new Error('Live Firebase mode is required to send a mission to the hardware gateway.')
    if (!database || !user || connection !== 'online') throw new Error('Authenticated Firebase connection required before mission transfer.')
    if (!Array.isArray(mission?.waypoints) || mission.waypoints.length === 0) {
      throw new Error('Add at least one waypoint before sending the mission.')
    }

    const missionId = mission.missionId || `mission-${Date.now()}`
    const payload = {
      missionId,
      createdBy: user.uid,
      createdAt: Date.now(),
      vehicle: 'CrossFlight · 01',
      status: 'queued',
      state: 'pending-gateway',
      waypoints: mission.waypoints.map((waypoint, index) => ({
        id: waypoint.id || `wp-${index + 1}`,
        label: waypoint.label || `WP${index + 1}`,
        x: Number(waypoint.x),
        z: Number(waypoint.z),
        altitude: Number(waypoint.altitude ?? 2),
        speed: Number(waypoint.speed ?? 1.5),
        holdSeconds: Number(waypoint.holdSeconds ?? 0),
      })),
      route: mission.route || mission.waypoints.map((waypoint) => ({ x: Number(waypoint.x), z: Number(waypoint.z) })),
      metadata: {
        generator: 'northstar-ground-station',
        mode: 'mission-transfer',
        updatedAt: Date.now(),
      },
    }

    await update(ref(database, `drone/mission/outgoing/${missionId}`), payload)
    await update(ref(database, `drone/mission/status/${missionId}`), {
      missionId,
      status: 'queued',
      state: 'pending-gateway',
      updatedAt: Date.now(),
      message: 'Mission queued to gateway.',
      delivery: 'queued',
      ack: 'pending',
      gateway: 'pending',
      hardware: 'pending',
    })

    addLog(setLogs, 'SENT', 'Mission queued to hardware', `Mission ID ${missionId} is pending gateway forwarding.`, 'GROUND STATION')
    notify(`Mission ${missionId} queued for hardware delivery.`, 'success')
    return { missionId, ...payload }
  }

  const signIn = async (email, password) => {
    if (!auth) throw new Error('Firebase is not configured. Set the VITE_FIREBASE_* values in .env.local.')
    await signInWithEmailAndPassword(auth, email, password)
    setMode('live')
    notify('Signed in to Firebase.', 'success')
  }

  const currentPage = navigation.find((item) => item.id === page)
  const selectPage = (id) => {
    setPage(id)
    setMobileNavOpen(false)
  }

  return <div className="app-shell">
    {mobileNavOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
    <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Cpu size={21} /></div><div><strong>NORTHSTAR</strong><span>UAV GROUND CONTROL</span></div><button className="mobile-close" onClick={() => setMobileNavOpen(false)} aria-label="Close menu"><X size={17} /></button></div>
      <div className="vehicle-card"><div className="vehicle-avatar"><Activity size={18} /></div><div><strong>CrossFlight · 01</strong><span><i className={`status-dot ${isDemo || connection === 'online' ? '' : 'dot-offline'}`} /> {isDemo ? 'Demo vehicle' : connection === 'online' ? 'Connected to Firebase' : 'Hardware offline'}</span></div><ChevronDown size={14} /></div>
      <nav className="side-nav">{navigation.map((item, index) => {
        const Icon = iconMap[item.icon] || Activity
        return <div key={item.id}>
          {item.group && <div className="nav-group">{item.group}</div>}
          <button className={`nav-item ${page === item.id ? 'nav-active' : ''}`} onClick={() => selectPage(item.id)}><Icon size={17} /><span>{item.label}</span>{item.id === 'mission' && !isDemo && data.status?.flightController?.armed && <i className="nav-alert" />}</button>
        </div>
      })}</nav>
      <div className="sidebar-bottom">
        <div className={`mode-card ${isDemo ? 'mode-card-demo' : ''}`}><div className="mode-card-top"><span className="mode-indicator" />{isDemo ? 'DEMO MODE' : 'LIVE MODE'}<span className="mode-card-state">{isDemo ? 'SAFE' : connection === 'online' ? 'ONLINE' : 'OFFLINE'}</span></div><p>{isDemo ? 'Simulated data · no hardware link' : user ? 'Authenticated Firebase session' : 'Sign in required for live access'}</p><button onClick={() => selectPage('settings')}>{isDemo ? 'Configure live connection' : user ? 'Session settings' : 'Sign in to Firebase'} <ArrowRightIcon /></button></div>
        <div className="sidebar-user">{user ? <><div className="user-initial">{user.email?.slice(0, 1).toUpperCase()}</div><div><strong>{user.email}</strong><span>{isDemo ? 'Signed in · demo mode' : 'Authenticated'}</span></div><button title="Sign out" onClick={() => signOut(auth)}><LogOut size={15} /></button></> : <><div className="user-initial">NS</div><div><strong>{authReady ? 'Local session' : 'Connecting…'}</strong><span>{firebaseConfigured ? 'Authentication available' : 'Firebase not configured'}</span></div></>}</div>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="topbar-left"><button className="menu-toggle" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={19} /></button><div className="breadcrumb">NORTHSTAR <span>/</span> {currentPage?.label?.toUpperCase()}</div></div><div className="topbar-right">
        <div className={`connection-indicator ${isDemo ? 'connection-demo' : connection === 'online' ? 'connection-online' : 'connection-offline'}`}><span className="status-dot" />{isDemo ? 'DEMO' : connection === 'online' ? 'LINK ONLINE' : 'OFFLINE'}</div>
        <button className={`top-mode-button ${isDemo ? 'top-demo' : ''}`} onClick={() => setMode(isDemo ? 'live' : 'demo')}>{isDemo ? 'SWITCH TO LIVE' : 'SWITCH TO DEMO'}</button>
        <button className="icon-button notification-button" title="System logs" onClick={() => selectPage('logs')}><Bell size={17} />{logs.some((log) => log.type === 'ERROR') && <i />}</button>
      </div></header>
      {!isDemo && (connection === 'offline' || !hardwareHeartbeat) && <div className="offline-strip"><WifiOff size={15} /> {connection === 'offline' ? 'Firebase connection offline.' : 'Hardware heartbeat is missing or stale.'} Displaying unavailable fields as “--”; no demo data is used. {!user && <button onClick={() => selectPage('settings')}>Sign in to connect</button>}</div>}
      <div className="content-area">
        {page === 'dashboard' && <Dashboard data={data} connection={connection} isDemo={isDemo} onNavigate={selectPage} />}
        {page === 'mission' && <MissionControl data={data} connection={connection} isDemo={isDemo} user={user} onCommand={handleCommand} pending={pending} />}
        {page === 'camera' && <CameraView camera={data.camera} isDemo={isDemo} connection={connection} user={user} onCameraUrl={saveCameraUrl} />}
        {page === 'lidar' && <LidarView data={data} isDemo={isDemo} commandReady={Boolean(user && connection === 'online' && data.status?.companion?.connected === true && isFresh(data.status?.updatedAt))} onStartScan={() => handleCommand({ command: 'START_SCAN', label: 'Start scan' })} onStopScan={() => handleCommand({ command: 'STOP_SCAN', label: 'Stop scan' })} onClear={() => !isDemo && addLog(setLogs, 'DATA', 'Map view cleared', 'Cleared local view only; sensor data was not modified.', 'GROUND STATION')} />}
        {page === 'planning' && <PlanningView isDemo={isDemo} data={data} connection={connection} user={user} onSavePlan={savePlanningData} onSendMission={sendMissionToHardware} />}
        {page === 'sensors' && <SensorsView data={data} isDemo={isDemo} />}
        {page === 'telemetry' && <TelemetryView data={data} isDemo={isDemo} />}
        {page === 'logs' && <LogsView logs={logs} isDemo={isDemo} onClear={() => setLogs([])} />}
        {page === 'settings' && <SettingsView isDemo={isDemo} user={user} firebaseConfigured={firebaseConfigured} onModeChange={setMode} onSignIn={signIn} onSignOut={() => signOut(auth)} connection={connection} />}
      </div>
      <footer className="app-footer"><span><Shield size={13} /> RC OVERRIDE AND FLIGHT-CONTROLLER FAILSAFES REMAIN ACTIVE</span><span>{data.system?.firmware || 'FIRMWARE UNKNOWN'} <i /> DATA AGE {formatAge(data.telemetry?.updatedAt)}</span></footer>
    </main>
    {toast && <div className={`toast toast-${toast.tone}`}><span className="toast-icon">{toast.tone === 'error' ? <WifiOff size={16} /> : <CircleDot size={16} />}</span>{toast.message}<button onClick={() => setToast(null)} aria-label="Dismiss"><X size={15} /></button></div>}
  </div>
}

function ArrowRightIcon() {
  return <span aria-hidden="true">→</span>
}
