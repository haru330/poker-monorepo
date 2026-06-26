import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { Lobby } from './lobby'

const PORT = Number(process.env.PORT ?? 9000)
const lobby = new Lobby()

const http = createServer((req, res) => {
  // Health check
  if (req.url === '/health') {
    res.writeHead(200).end('ok')
    return
  }
  res.writeHead(404).end()
})

const wss = new WebSocketServer({ noServer: true })

http.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

  // POST-style upgrade: /create — host opens this to start a new room
  if (url.pathname === '/create') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      lobby.createRoom(ws)
    })
    return
  }

  // /join/:code — guest opens this to join an existing room
  const joinMatch = url.pathname.match(/^\/join\/([A-Z]{4})$/i)
  if (joinMatch) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      lobby.joinRoom(ws, joinMatch[1].toUpperCase())
    })
    return
  }

  socket.destroy()
})

http.listen(PORT, () => {
  console.log(`poker-server listening on ws://localhost:${PORT}`)
})
