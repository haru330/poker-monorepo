import type { WebSocket } from 'ws'
import { Room } from './room'
import { generateRoomCode } from './utils'
import type { ServerMessage } from './messages'

const ROOM_TTL_MS = 1000 * 60 * 60 * 4 // 4 hours — clean up abandoned rooms

export class Lobby {
  private rooms = new Map<string, Room>()
  private roomCreatedAt = new Map<string, number>()

  createRoom(ws: WebSocket): Room {
    this.evictStaleRooms()
    const code = this.freshCode()
    const room = new Room(code)
    this.rooms.set(code, room)
    this.roomCreatedAt.set(code, Date.now())
    room.add(ws)
    const msg: ServerMessage = { type: 'ROOM_CREATED', roomCode: code }
    ws.send(JSON.stringify(msg))
    return room
  }

  joinRoom(ws: WebSocket, code: string): boolean {
    const room = this.rooms.get(code.toUpperCase())
    if (!room) {
      const msg: ServerMessage = { type: 'JOIN_REJECTED', reason: 'room not found' }
      ws.send(JSON.stringify(msg))
      return false
    }
    room.add(ws)
    return true
  }

  private freshCode(): string {
    let code: string
    do { code = generateRoomCode() } while (this.rooms.has(code))
    return code
  }

  private evictStaleRooms(): void {
    const now = Date.now()
    for (const [code, createdAt] of this.roomCreatedAt) {
      const room = this.rooms.get(code)
      if (!room || room.isEmpty || now - createdAt > ROOM_TTL_MS) {
        this.rooms.delete(code)
        this.roomCreatedAt.delete(code)
      }
    }
  }
}
