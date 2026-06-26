const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function generateRoomCode(): string {
  let code = ''
  for (let i = 0; i < 4; i++) code += LETTERS[Math.floor(Math.random() * LETTERS.length)]
  return code
}

export function generateSessionToken(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}
