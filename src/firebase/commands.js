import { onValue, push, ref, set } from 'firebase/database'
import { database } from './client'

const allowedCommands = new Set([
  'ARM', 'DISARM', 'HOLD', 'LAND', 'RETURN', 'START_SCAN', 'STOP_SCAN', 'CAMERA_ON', 'CAMERA_OFF',
])

export function watchCommandResponses(user, onResponse, onError) {
  if (!database || !user) return () => {}
  return onValue(ref(database, 'drone/commands/response'), (snapshot) => {
    const responses = snapshot.val() || {}
    Object.entries(responses).forEach(([id, response]) => onResponse({ id, ...response }))
  }, (error) => onError?.(error))
}

export async function sendCommand(command, user) {
  if (!database || !user) throw new Error('Sign in to an authenticated Firebase project before sending commands.')
  if (!allowedCommands.has(command)) throw new Error('This command is not enabled for real-hardware execution.')

  const commandRef = push(ref(database, 'drone/commands/request'))
  const payload = {
    id: commandRef.key,
    command,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 15_000,
    issuedBy: user.uid,
    source: 'ground-station',
    status: 'pending',
  }
  await set(commandRef, payload)
  return payload
}
