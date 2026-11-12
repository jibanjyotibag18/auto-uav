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
  camera: null,
  system: null,
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
    const paths = ['status', 'telemetry', 'sensors', 'mapping', 'planning', 'camera', 'system']

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
