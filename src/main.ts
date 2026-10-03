import './style.css'

const CELL = 50

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const ctx = canvas.getContext('2d')!

// Grid dimensions in cells (recomputed on resize)
let cols = 0
let rows = 0
// Pixel offsets to center the grid on screen
let offsetX = 0
let offsetY = 0

// Player position in grid cells
const player = { x: 0, y: 0 }

// Purple chasers that slowly move towards the player
const enemies: { x: number; y: number }[] = []
const ENEMY_STEP_MS = 600

let lives = 3
let level = 1
// intro: waiting to start the level | playing | cleared: level won | over: all lives spent
let state: 'intro' | 'playing' | 'cleared' | 'over' = 'intro'

const enemyCountFor = (lvl: number) => 2 + lvl // level 1 = 3 chasers, +1 per level
const yellowCountFor = (lvl: number) => 2 + lvl // level 1 = 3 bombs, +1 per level

// Confetti particles for the win celebration
interface Confetto {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  rot: number
  vrot: number
}
const confetti: Confetto[] = []
const CONFETTI_COLORS = ['#e02424', '#f5c518', '#9b3bd6', '#4a7aa5', '#2ecc71', '#ff9f1c', '#ffffff']

// Yellow blocks scattered around the map
const yellows: { x: number; y: number }[] = []

// Active explosion effects
const explosions: { x: number; y: number; start: number }[] = []
const EXPLOSION_MS = 450

// Other blocks on the grid, keyed by "x,y"
const blocks = new Set<string>()

const key = (x: number, y: number) => `${x},${y}`

function placeBlocks(): void {
  blocks.clear()
  // Border ring around the grid edge
  for (let x = 0; x < cols; x++) {
    blocks.add(key(x, 0))
    blocks.add(key(x, rows - 1))
  }
  for (let y = 0; y < rows; y++) {
    blocks.add(key(0, y))
    blocks.add(key(cols - 1, y))
  }
  // Random scattering of obstacle blocks inside the border (new layout each level)
  const cx = Math.floor(cols / 2)
  const cy = Math.floor(rows / 2)
  const target = Math.floor((cols - 2) * (rows - 2) * 0.06)
  let placed = 0
  let guard = 0
  while (placed < target && guard++ < 10000) {
    const x = 1 + Math.floor(Math.random() * (cols - 2))
    const y = 1 + Math.floor(Math.random() * (rows - 2))
    // Keep the player's starting cell and its neighbours clear
    if (Math.abs(x - cx) <= 1 && Math.abs(y - cy) <= 1) continue
    if (blocks.has(key(x, y))) continue
    blocks.add(key(x, y))
    placed++
  }
}

function placeEnemies(): void {
  enemies.length = 0
  const count = enemyCountFor(level)
  // Candidate cells on the ring just inside the border, evenly spread
  const ring: { x: number; y: number }[] = []
  for (let x = 1; x < cols - 1; x++) {
    ring.push({ x, y: 1 }, { x, y: rows - 2 })
  }
  for (let y = 2; y < rows - 2; y++) {
    ring.push({ x: 1, y }, { x: cols - 2, y })
  }
  const free = ring.filter((c) => !blocks.has(key(c.x, c.y)))
  const step = Math.max(1, Math.floor(free.length / count))
  for (let i = 0; i < count && free.length > 0; i++) {
    enemies.push(free[(i * step) % free.length])
  }
}

function placeYellows(): void {
  yellows.length = 0
  const count = yellowCountFor(level)
  let guard = 0
  while (yellows.length < count && guard++ < 10000) {
    const x = 1 + Math.floor(Math.random() * (cols - 2))
    const y = 1 + Math.floor(Math.random() * (rows - 2))
    if (blocks.has(key(x, y))) continue
    if (x === player.x && y === player.y) continue
    if (enemies.some((e) => e.x === x && e.y === y)) continue
    if (yellows.some((b) => b.x === x && b.y === y)) continue
    yellows.push({ x, y })
  }
}

function resize(): void {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  cols = Math.floor(canvas.width / CELL)
  rows = Math.floor(canvas.height / CELL)
  offsetX = Math.floor((canvas.width - cols * CELL) / 2)
  offsetY = Math.floor((canvas.height - rows * CELL) / 2)
  player.x = Math.floor(cols / 2)
  player.y = Math.floor(rows / 2)
  placeBlocks()
  placeEnemies()
  placeYellows()
  draw()
}

// New blue-block layout and fresh pieces for the current level
function setupLevel(): void {
  placeBlocks()
  resetPositions()
}

function resetPositions(): void {
  player.x = Math.floor(cols / 2)
  player.y = Math.floor(rows / 2)
  placeEnemies()
  placeYellows()
}

function loseLife(): void {
  lives--
  if (lives <= 0) {
    state = 'over'
  } else {
    resetPositions()
  }
}

function checkCollision(): void {
  if (!enemies.some((e) => e.x === player.x && e.y === player.y)) return
  loseLife()
}

// Returns true if a yellow block was at (x, y): it explodes and is removed
function detonateYellowAt(x: number, y: number): boolean {
  const i = yellows.findIndex((b) => b.x === x && b.y === y)
  if (i === -1) return false
  yellows.splice(i, 1)
  explosions.push({ x, y, start: performance.now() })
  animateExplosions()
  return true
}

let explosionAnim = 0
function animateExplosions(): void {
  if (explosionAnim) return
  const tick = () => {
    const now = performance.now()
    for (let i = explosions.length - 1; i >= 0; i--) {
      if (now - explosions[i].start > EXPLOSION_MS) explosions.splice(i, 1)
    }
    draw()
    explosionAnim = explosions.length ? requestAnimationFrame(tick) : 0
  }
  explosionAnim = requestAnimationFrame(tick)
}

let confettiAnim = 0
function startLevelClear(): void {
  state = 'cleared'
  confetti.length = 0
  for (let i = 0; i < 200; i++) {
    confetti.push({
      x: Math.random() * canvas.width,
      y: -Math.random() * canvas.height * 0.5,
      vx: (Math.random() - 0.5) * 2,
      vy: 2 + Math.random() * 3,
      size: 6 + Math.random() * 8,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.2,
    })
  }
  if (confettiAnim) cancelAnimationFrame(confettiAnim)
  const tick = () => {
    for (const c of confetti) {
      c.x += c.vx + Math.sin(c.y * 0.02)
      c.y += c.vy
      c.rot += c.vrot
      if (c.y > canvas.height + 20) {
        c.y = -20
        c.x = Math.random() * canvas.width
      }
    }
    draw()
    confettiAnim = state === 'cleared' ? requestAnimationFrame(tick) : 0
  }
  confettiAnim = requestAnimationFrame(tick)
}

function moveEnemies(): void {
  if (state !== 'playing') return
  for (const e of enemies) {
    const dx = Math.sign(player.x - e.x)
    const dy = Math.sign(player.y - e.y)
    // Prefer the axis with the larger distance to the player
    const steps =
      Math.abs(player.x - e.x) >= Math.abs(player.y - e.y)
        ? [
            { x: e.x + dx, y: e.y },
            { x: e.x, y: e.y + dy },
          ]
        : [
            { x: e.x, y: e.y + dy },
            { x: e.x + dx, y: e.y },
          ]
    for (const s of steps) {
      if (s.x === e.x && s.y === e.y) continue
      if (blocks.has(key(s.x, s.y))) continue
      if (enemies.some((o) => o !== e && o.x === s.x && o.y === s.y)) continue
      e.x = s.x
      e.y = s.y
      break
    }
  }
  // Chasers stepping onto a yellow block blow up with it
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (detonateYellowAt(enemies[i].x, enemies[i].y)) {
      enemies.splice(i, 1)
    }
  }
  if (enemies.length === 0) {
    startLevelClear()
    return
  }
  checkCollision()
  draw()
}

setInterval(moveEnemies, ENEMY_STEP_MS)

const isBorder = (x: number, y: number) => x === 0 || y === 0 || x === cols - 1 || y === rows - 1

function tryMove(dx: number, dy: number): void {
  if (state !== 'playing') return
  const nx = player.x + dx
  const ny = player.y + dy
  if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return
  if (blocks.has(key(nx, ny))) {
    // Push the blue block, unless it's the border wall or the cell behind it
    // is blocked by a wall, another blue block, a purple chaser or a yellow bomb
    if (isBorder(nx, ny)) return
    const bx = nx + dx
    const by = ny + dy
    if (bx < 0 || by < 0 || bx >= cols || by >= rows) return
    if (blocks.has(key(bx, by))) return
    if (enemies.some((e) => e.x === bx && e.y === by)) return
    if (yellows.some((b) => b.x === bx && b.y === by)) return
    blocks.delete(key(nx, ny))
    blocks.add(key(bx, by))
  }
  player.x = nx
  player.y = ny
  // Stepping onto a yellow block blows up the player: lose a life
  if (detonateYellowAt(nx, ny)) {
    loseLife()
    draw()
    return
  }
  checkCollision()
  draw()
}

function draw(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // Background
  ctx.fillStyle = '#111'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Grid lines
  ctx.strokeStyle = '#333'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0; x <= cols; x++) {
    ctx.moveTo(offsetX + x * CELL + 0.5, offsetY)
    ctx.lineTo(offsetX + x * CELL + 0.5, offsetY + rows * CELL)
  }
  for (let y = 0; y <= rows; y++) {
    ctx.moveTo(offsetX, offsetY + y * CELL + 0.5)
    ctx.lineTo(offsetX + cols * CELL, offsetY + y * CELL + 0.5)
  }
  ctx.stroke()

  // Obstacle blocks
  ctx.fillStyle = '#4a7aa5'
  for (const b of blocks) {
    const [x, y] = b.split(',').map(Number)
    ctx.fillRect(offsetX + x * CELL + 2, offsetY + y * CELL + 2, CELL - 4, CELL - 4)
  }

  // Yellow blocks
  ctx.fillStyle = '#f5c518'
  for (const b of yellows) {
    ctx.fillRect(offsetX + b.x * CELL + 2, offsetY + b.y * CELL + 2, CELL - 4, CELL - 4)
  }

  // Purple chasers
  ctx.fillStyle = '#9b3bd6'
  for (const e of enemies) {
    ctx.fillRect(offsetX + e.x * CELL + 2, offsetY + e.y * CELL + 2, CELL - 4, CELL - 4)
  }

  // Player (red block)
  ctx.fillStyle = '#e02424'
  ctx.fillRect(offsetX + player.x * CELL + 2, offsetY + player.y * CELL + 2, CELL - 4, CELL - 4)

  // Smiley face on the player
  {
    const cx = offsetX + player.x * CELL + CELL / 2
    const cy = offsetY + player.y * CELL + CELL / 2
    ctx.fillStyle = '#111'
    ctx.beginPath()
    ctx.arc(cx - 8, cy - 7, 3.5, 0, Math.PI * 2) // left eye
    ctx.arc(cx + 8, cy - 7, 3.5, 0, Math.PI * 2) // right eye
    ctx.fill()
    ctx.strokeStyle = '#111'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.arc(cx, cy + 3, 10, 0.15 * Math.PI, 0.85 * Math.PI) // smile
    ctx.stroke()
  }

  // Explosions
  const now = performance.now()
  for (const ex of explosions) {
    const t = Math.min((now - ex.start) / EXPLOSION_MS, 1)
    const cx = offsetX + ex.x * CELL + CELL / 2
    const cy = offsetY + ex.y * CELL + CELL / 2
    ctx.globalAlpha = 1 - t
    ctx.fillStyle = '#ff9f1c'
    ctx.beginPath()
    ctx.arc(cx, cy, (CELL / 2) * (0.5 + t), 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff3b0'
    ctx.beginPath()
    ctx.arc(cx, cy, (CELL / 4) * (0.5 + t), 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  // Lives + level HUD
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 24px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(
    `Level ${level}   Lives: ${'\u2764'.repeat(Math.max(lives, 0))}`,
    offsetX + CELL + 10,
    offsetY + CELL / 2,
  )

  const centerOverlay = (dim: boolean) => {
    if (dim) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
  }

  if (state === 'intro') {
    centerOverlay(true)
    ctx.fillStyle = '#f5c518'
    ctx.font = 'bold 64px system-ui, sans-serif'
    ctx.fillText(`LEVEL ${level}`, canvas.width / 2, canvas.height / 2 - 30)
    ctx.fillStyle = '#fff'
    ctx.font = '28px system-ui, sans-serif'
    ctx.fillText('Press Enter to start', canvas.width / 2, canvas.height / 2 + 30)
  }

  if (state === 'over') {
    centerOverlay(true)
    ctx.fillStyle = '#e02424'
    ctx.font = 'bold 64px system-ui, sans-serif'
    ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 50)
    ctx.fillStyle = '#f5c518'
    ctx.font = 'bold 36px system-ui, sans-serif'
    ctx.fillText(
      `You reached level ${level}`,
      canvas.width / 2,
      canvas.height / 2 + 10,
    )
    ctx.fillStyle = '#fff'
    ctx.font = '28px system-ui, sans-serif'
    ctx.fillText('Press Enter to play again', canvas.width / 2, canvas.height / 2 + 70)
  }

  if (state === 'cleared') {
    // Confetti
    for (const c of confetti) {
      ctx.save()
      ctx.translate(c.x, c.y)
      ctx.rotate(c.rot)
      ctx.fillStyle = c.color
      ctx.fillRect(-c.size / 2, -c.size / 4, c.size, c.size / 2)
      ctx.restore()
    }
    centerOverlay(false)
    ctx.fillStyle = '#2ecc71'
    ctx.font = 'bold 64px system-ui, sans-serif'
    ctx.fillText(`LEVEL ${level} CLEARED!`, canvas.width / 2, canvas.height / 2 - 30)
    ctx.fillStyle = '#fff'
    ctx.font = '28px system-ui, sans-serif'
    ctx.fillText(`Press Enter for level ${level + 1}`, canvas.width / 2, canvas.height / 2 + 30)
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (state === 'intro') {
      // Start the current level
      state = 'playing'
      draw()
      return
    }
    if (state === 'cleared') {
      // Advance to the next level: new blue layout, +1 chaser, +1 bomb
      level++
      confetti.length = 0
      setupLevel()
      state = 'playing'
      draw()
      return
    }
    if (state === 'over') {
      // Fresh game from level 1
      lives = 3
      level = 1
      confetti.length = 0
      setupLevel()
      state = 'intro'
      draw()
      return
    }
  }
  switch (e.key) {
    case 'ArrowUp':
      tryMove(0, -1)
      break
    case 'ArrowDown':
      tryMove(0, 1)
      break
    case 'ArrowLeft':
      tryMove(-1, 0)
      break
    case 'ArrowRight':
      tryMove(1, 0)
      break
    default:
      return
  }
  e.preventDefault()
})

window.addEventListener('resize', resize)
resize()
