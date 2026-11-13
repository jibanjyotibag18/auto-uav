import { useEffect, useMemo, useState } from 'react'
import { onValue, ref } from 'firebase/database'
import { database } from '../firebase/client'
import { makeDemoData } from '../lib/data'

const emptyLiveData = {
  status: null,
  telemetry: null,
  sensors: null,
  mapping: null,
  planning: null,
  mission: null,
  camera: null,
  system: null,
}

/**
 * Normalise the UAV_SENSOR document published by the ESP32 into the shape
 * the rest of the app already understands under `data.sensors` and
 * `data.mapping`.
 *
 * Raw shape:
 *   UAV_SENSOR.compass      { heading, valid }
 *   UAV_SENSOR.tf_luna      { distance_cm, strength, temperature, valid }
 *   UAV_SENSOR.vl53l0x      { distance_mm, valid }
 *   UAV_SENSOR.mapping      { angle, obstacle, x, y, z }
 *   UAV_SENSOR.timestamp_ms (number)
 *   UAV_SENSOR.uptime       (number)
 */
function normaliseUavSensor(raw) {
  if (!raw) return { sensors: null, mapping: null }

  const now = Date.now()

  const sensors = {
    // TF-Luna long-range LiDAR → replaces the tfLuna slot
    tfLuna: {
      distance: raw.tf_luna?.distance_cm != null ? raw.tf_luna.distance_cm / 100 : null, // metres
      distanceCm: raw.tf_luna?.distance_cm ?? null,
      strength: raw.tf_luna?.strength ?? null,
      temperature: raw.tf_luna?.temperature ?? null,
      healthy: raw.tf_luna?.valid === true,
      updatedAt: now,
    },
    // VL53L0X short-range ToF → replaces the gy53 slot
    gy53: {
      distance: raw.vl53l0x?.distance_mm != null ? raw.vl53l0x.distance_mm / 1000 : null, // metres
      distanceMm: raw.vl53l0x?.distance_mm ?? null,
      healthy: raw.vl53l0x?.valid === true,
      updatedAt: now,
    },
    // HMC5883L compass
    hmc5883l: {
      heading: raw.compass?.heading ?? null,
      healthy: raw.compass?.valid === true,
      updatedAt: now,
    },
    // Raw ESP32 timestamps
    timestampMs: raw.timestamp_ms ?? null,
    uptime: raw.uptime ?? null,
  }

  // Map the ESP32 obstacle-angle point into a single-point mapping array so
  // the LiDAR / 3-D view still receives something meaningful.
  const mapRaw = raw.mapping
  const mapping = mapRaw
    ? {
        points: [
          {
            x: mapRaw.x ?? 0,
            y: mapRaw.y ?? 0,
            z: mapRaw.z ?? 0,
            distance: Math.sqrt((mapRaw.x ?? 0) ** 2 + (mapRaw.y ?? 0) ** 2),
            obstacle: mapRaw.obstacle === true,
          },
        ],
        horizontalAngle: mapRaw.angle ?? null,
        verticalAngle: null,
        updatedAt: now,
      }
    : null

  return { sensors, mapping }
}

export function useDroneData(mode, user) {
  const [demoData, setDemoData] = useState(makeDemoData)
  const [liveData, setLiveData] = useState(emptyLiveData)
  const [connection, setConnection] = useState('offline')
  const [firebaseError, setFirebaseError] = useState('')
  const demo = mode === 'demo'

  useEffect(() => {
    if (demo) {
      setConnection('demo')
      setFirebaseError('')
      return undefined
    }
    if (!database || !user) {
      setLiveData(emptyLiveData)
      setConnection('offline')
      setFirebaseError('')
      return undefined
    }

    let active = true
    setFirebaseError('')
    const unsubscribers = []
    const paths = ['status', 'telemetry', 'sensors', 'mapping', 'planning', 'mission', 'camera', 'system']

    unsubscribers.push(onValue(ref(database, '.info/connected'), (snapshot) => {
      if (active) setConnection(snapshot.val() === true ? 'online' : 'offline')
    }, (error) => {
      if (active) {
        setConnection('offline')
        setFirebaseError(`Firebase connection listener failed: ${error.message}`)
      }
    }))

    paths.forEach((path) => {
      unsubscribers.push(onValue(ref(database, `drone/${path}`), (snapshot) => {
        if (active) {
          setLiveData((current) => ({ ...current, [path]: snapshot.val() }))
          setFirebaseError('')
        }
      }, (error) => {
        if (active) setFirebaseError(`Cannot read /drone/${path}: ${error.message}`)
      }))
    })

    // ── UAV_SENSOR (ESP32 direct publish) ──────────────────────────────────
    // This path is written by the ESP32 firmware and is separate from the
    // `drone/*` paths that the companion computer writes. We merge it into
    // the same liveData shape so the UI can display ESP32 data even without
    // the companion online.
    unsubscribers.push(onValue(ref(database, 'UAV_SENSOR'), (snapshot) => {
      if (!active) return
      const rawVal = snapshot.val()
      const { sensors, mapping } = normaliseUavSensor(rawVal)
      setLiveData((current) => ({
        ...current,
        // Mark ESP32 sensor hub status
        status: {
          ...current.status,
          connected: true,
          esp32SensorHub: {
            connected: Boolean(rawVal),
            uptime: rawVal?.uptime ?? null,
            timestampMs: rawVal?.timestamp_ms ?? null,
            updatedAt: Date.now(),
          },
          updatedAt: current.status?.updatedAt || Date.now(),
        },
        // Update sensors & mapping
        sensors: sensors ?? current.sensors,
        mapping: mapping ?? current.mapping,
      }))
      setFirebaseError('')
    }, (error) => {
      if (active) setFirebaseError(`Cannot read /UAV_SENSOR: ${error.message}`)
    }))

    return () => {
      active = false
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [demo, user])

  useEffect(() => {
    if (!demo) return undefined
    const timer = window.setInterval(() => {
      setDemoData((current) => ({
        ...current,
        telemetry: {
          ...current.telemetry,
          heading: (current.telemetry.heading + 0.3) % 360,
          batteryVoltage: Math.max(14.2, current.telemetry.batteryVoltage - 0.001),
          updatedAt: Date.now(),
        },
        sensors: {
          ...current.sensors,
          tfLuna: { ...current.sensors.tfLuna, updatedAt: Date.now() },
          gy53: { ...current.sensors.gy53, updatedAt: Date.now() },
          hmc5883l: { ...current.sensors.hmc5883l, heading: (current.sensors.hmc5883l.heading + 0.3) % 360, updatedAt: Date.now() },
        },
        mapping: { ...current.mapping, updatedAt: Date.now() },
      }))
    }, 1800)
    return () => window.clearInterval(timer)
  }, [demo])

  const data = demo ? demoData : liveData
  const value = useMemo(() => ({ data, connection, isDemo: demo, firebaseError }), [data, connection, demo, firebaseError])
  return value
}
