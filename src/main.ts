import './style.css'

// Cell size in px: at most 50, shrunk so the grid is always at least 10x10 cells
const MAX_CELL = 50
const MIN_GRID = 10
let CELL = MAX_CELL

const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0

// On-screen d-pad geometry (touch devices in portrait reserve this space below the board)
const DPAD_BTN = 56
const DPAD_GAP = 8
const DPAD_MARGIN = 20
const CONTROLS_H = 3 * DPAD_BTN + 2 * DPAD_GAP + DPAD_MARGIN + 12
const controlsReserved = () => isTouch && window.innerHeight > window.innerWidth

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

let lives = 5
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

// Collectible light blue block (one per level) and total collected
let lightBlue: { x: number; y: number } | null = null
let gems = 0

// Shield of blue blocks around the player (tap space with 3 gems)
const SHIELD_COST = 3
const SHIELD_MS = 5000
let shieldUntil = 0
const shieldActive = () => performance.now() < shieldUntil
const inShieldRing = (x: number, y: number) =>
  shieldActive() && Math.abs(x - player.x) <= 1 && Math.abs(y - player.y) <= 1

// Freeze power: from level 7, press T to stop the purple blocks for 5 seconds
const FREEZE_LEVEL = 7
const FREEZE_MS = 5000
let freezeUntil = 0
const freezeActive = () => performance.now() < freezeUntil

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

function placeLightBlue(): void {
  lightBlue = null
  let guard = 0
  while (!lightBlue && guard++ < 10000) {
    const x = 1 + Math.floor(Math.random() * (cols - 2))
    const y = 1 + Math.floor(Math.random() * (rows - 2))
    if (blocks.has(key(x, y))) continue
    if (x === player.x && y === player.y) continue
    if (enemies.some((e) => e.x === x && e.y === y)) continue
    if (yellows.some((b) => b.x === x && b.y === y)) continue
    lightBlue = { x, y }
  }
}

function resize(): void {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  // In portrait on touch devices, keep the board clear of the bottom control area
  const availH = canvas.height - (controlsReserved() ? CONTROLS_H : 0)
  CELL = Math.max(
    1,
    Math.min(MAX_CELL, Math.floor(canvas.width / MIN_GRID), Math.floor(availH / MIN_GRID)),
  )
  cols = Math.floor(canvas.width / CELL)
  rows = Math.floor(availH / CELL)
  offsetX = Math.floor((canvas.width - cols * CELL) / 2)
  offsetY = Math.floor((availH - rows * CELL) / 2)
  player.x = Math.floor(cols / 2)
  player.y = Math.floor(rows / 2)
  placeBlocks()
  placeEnemies()
  placeYellows()
  placeLightBlue()
  draw()
}

// New blue-block layout and fresh pieces for the current level
function setupLevel(): void {
  placeBlocks()
  resetPositions()
  placeLightBlue()
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
  if (shieldActive()) return
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
  if (freezeActive()) return
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
      if (inShieldRing(s.x, s.y)) continue
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

// Hold space to pull an adjacent blue block along behind you;
// tap space (no movement) with 3+ gems to raise the shield
let pulling = false
let spaceDownAt = 0
let movedWhileSpace = false

function activateShield(): void {
  if (state !== 'playing' || shieldActive() || gems < SHIELD_COST) return
  // Gems are not consumed — the shield is reusable once you have 3
  shieldUntil = performance.now() + SHIELD_MS
  const tick = () => {
    draw()
    if (shieldActive()) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

function activateFreeze(): void {
  if (state !== 'playing' || level < FREEZE_LEVEL || freezeActive()) return
  freezeUntil = performance.now() + FREEZE_MS
  const tick = () => {
    draw()
    if (freezeActive()) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

function tryMove(dx: number, dy: number): void {
  if (state !== 'playing') return
  const nx = player.x + dx
  const ny = player.y + dy
  if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return
  if (blocks.has(key(nx, ny))) {
    // Push the blue block, unless it's the border wall or the cell behind it
    // is blocked by a wall, another blue block, a purple chaser or a yellow bomb.
    // With 5+ gems: super-push — the push always succeeds and whatever is
    // behind gets crushed (blocks merge, chasers die, bombs detonate the block)
    if (isBorder(nx, ny)) return
    const bx = nx + dx
    const by = ny + dy
    const superPush = gems >= 5
    if (!superPush) {
      if (bx < 0 || by < 0 || bx >= cols || by >= rows) return
      if (blocks.has(key(bx, by))) return
      if (enemies.some((e) => e.x === bx && e.y === by)) return
      if (yellows.some((b) => b.x === bx && b.y === by)) return
      if (lightBlue && lightBlue.x === bx && lightBlue.y === by) return
      blocks.delete(key(nx, ny))
      blocks.add(key(bx, by))
    } else {
      blocks.delete(key(nx, ny))
      if (bx >= 0 && by >= 0 && bx < cols && by < rows && !isBorder(bx, by)) {
        // Crush any chasers behind the block
        for (let i = enemies.length - 1; i >= 0; i--) {
          if (enemies[i].x === bx && enemies[i].y === by) enemies.splice(i, 1)
        }
        // A bomb behind detonates and destroys the pushed block too
        if (!detonateYellowAt(bx, by)) {
          blocks.add(key(bx, by))
        }
      }
      // Pushed against the wall or off-grid: the block is crushed and gone
      if (enemies.length === 0) {
        player.x = nx
        player.y = ny
        startLevelClear()
        return
      }
    }
  }
  const ox = player.x
  const oy = player.y
  player.x = nx
  player.y = ny
  if (pulling) movedWhileSpace = true
  // While holding space, drag the blue block that was behind the move along
  if (pulling) {
    const px = ox - dx
    const py = oy - dy
    if (blocks.has(key(px, py)) && !isBorder(px, py)) {
      blocks.delete(key(px, py))
      blocks.add(key(ox, oy))
    }
  }
  // Collect the light blue block
  if (lightBlue && lightBlue.x === nx && lightBlue.y === ny) {
    lightBlue = null
    gems++
  }
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

  // Light blue collectible
  if (lightBlue) {
    ctx.fillStyle = '#7fd4ff'
    ctx.fillRect(offsetX + lightBlue.x * CELL + 2, offsetY + lightBlue.y * CELL + 2, CELL - 4, CELL - 4)
    // Sparkle
    ctx.fillStyle = '#ffffff'
    ctx.save()
    ctx.translate(offsetX + lightBlue.x * CELL + CELL / 2, offsetY + lightBlue.y * CELL + CELL / 2)
    ctx.scale(CELL / MAX_CELL, CELL / MAX_CELL)
    ctx.beginPath()
    ctx.moveTo(0, -8)
    ctx.lineTo(3, -3)
    ctx.lineTo(8, 0)
    ctx.lineTo(3, 3)
    ctx.lineTo(0, 8)
    ctx.lineTo(-3, 3)
    ctx.lineTo(-8, 0)
    ctx.lineTo(-3, -3)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  // Purple chasers
  ctx.fillStyle = '#9b3bd6'
  for (const e of enemies) {
    ctx.fillRect(offsetX + e.x * CELL + 2, offsetY + e.y * CELL + 2, CELL - 4, CELL - 4)
  }
  // ...each with an angry face
  for (const e of enemies) {
    ctx.save()
    ctx.translate(offsetX + e.x * CELL + CELL / 2, offsetY + e.y * CELL + CELL / 2)
    ctx.scale(CELL / MAX_CELL, CELL / MAX_CELL)
    // Angry eyebrows
    ctx.strokeStyle = '#111'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(-13, -13)
    ctx.lineTo(-4, -8)
    ctx.moveTo(13, -13)
    ctx.lineTo(4, -8)
    ctx.stroke()
    // Eyes
    ctx.fillStyle = '#111'
    ctx.beginPath()
    ctx.arc(-8, -4, 3, 0, Math.PI * 2)
    ctx.arc(8, -4, 3, 0, Math.PI * 2)
    ctx.fill()
    // Frown
    ctx.beginPath()
    ctx.arc(0, 14, 9, 1.2 * Math.PI, 1.8 * Math.PI)
    ctx.stroke()
    ctx.restore()
  }

  // Player (red block)
  ctx.fillStyle = '#e02424'
  ctx.fillRect(offsetX + player.x * CELL + 2, offsetY + player.y * CELL + 2, CELL - 4, CELL - 4)

  // Shield ring of blue blocks around the player
  if (shieldActive()) {
    const remaining = (shieldUntil - performance.now()) / SHIELD_MS
    ctx.globalAlpha = 0.5 + 0.5 * remaining
    ctx.fillStyle = '#4a7aa5'
    ctx.strokeStyle = '#7fd4ff'
    ctx.lineWidth = 2
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const sx = player.x + dx
        const sy = player.y + dy
        if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) continue
        ctx.fillRect(offsetX + sx * CELL + 4, offsetY + sy * CELL + 4, CELL - 8, CELL - 8)
        ctx.strokeRect(offsetX + sx * CELL + 4, offsetY + sy * CELL + 4, CELL - 8, CELL - 8)
      }
    }
    ctx.globalAlpha = 1
  }

  // Smiley face on the player
  {
    ctx.save()
    ctx.translate(offsetX + player.x * CELL + CELL / 2, offsetY + player.y * CELL + CELL / 2)
    ctx.scale(CELL / MAX_CELL, CELL / MAX_CELL)
    ctx.fillStyle = '#111'
    ctx.beginPath()
    ctx.arc(-8, -7, 3.5, 0, Math.PI * 2) // left eye
    ctx.arc(8, -7, 3.5, 0, Math.PI * 2) // right eye
    ctx.fill()
    ctx.strokeStyle = '#111'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.arc(0, 3, 10, 0.15 * Math.PI, 0.85 * Math.PI) // smile
    ctx.stroke()
    ctx.restore()
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

  // Lives + level HUD (scaled with the cell size)
  const hud = CELL / MAX_CELL
  ctx.fillStyle = '#fff'
  ctx.font = `bold ${Math.round(24 * hud)}px system-ui, sans-serif`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(
    `Level ${level}   Lives: ${'\u2764'.repeat(Math.max(lives, 0))}`,
    offsetX + CELL + 10 * hud,
    offsetY + CELL / 2,
  )
  ctx.fillStyle = '#7fd4ff'
  const gemText =
    shieldActive()
      ? `\u25C6 ${gems}   SHIELD ${Math.ceil((shieldUntil - performance.now()) / 1000)}s`
      : gems >= SHIELD_COST
        ? `\u25C6 ${gems}   tap space for shield`
        : `\u25C6 ${gems}`
  ctx.fillText(gemText, offsetX + CELL + 310 * hud, offsetY + CELL / 2)
  if (freezeActive()) {
    ctx.fillStyle = '#9fe8ff'
    ctx.fillText(
      `FROZEN ${Math.ceil((freezeUntil - performance.now()) / 1000)}s`,
      offsetX + CELL + 520 * hud,
      offsetY + CELL / 2,
    )
  } else if (level >= FREEZE_LEVEL && state === 'playing') {
    ctx.fillStyle = '#9fe8ff'
    ctx.fillText(`T to freeze`, offsetX + CELL + 520 * hud, offsetY + CELL / 2)
  }

  // On-screen d-pad (touch devices, portrait orientation)
  if (dpadVisible()) {
    for (const b of dpadButtons()) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'
      ctx.lineWidth = 2
      ctx.fillRect(b.x, b.y, b.w, b.h)
      ctx.strokeRect(b.x, b.y, b.w, b.h)
      // Arrow pointing in the button's direction
      const cx = b.x + b.w / 2
      const cy = b.y + b.h / 2
      const a = b.w * 0.22
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
      ctx.beginPath()
      ctx.moveTo(cx + b.dx * a, cy + b.dy * a)
      ctx.lineTo(cx - b.dx * a + b.dy * a, cy - b.dy * a + b.dx * a)
      ctx.lineTo(cx - b.dx * a - b.dy * a, cy - b.dy * a - b.dx * a)
      ctx.closePath()
      ctx.fill()
    }
  }

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

// Advance from intro/cleared/over screens (Enter key or screen tap)
function advance(): void {
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
    lives = 5
    level = 1
    gems = 0
    confetti.length = 0
    setupLevel()
    state = 'intro'
    draw()
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key === ' ') {
    if (!e.repeat) {
      pulling = true
      spaceDownAt = performance.now()
      movedWhileSpace = false
    }
    e.preventDefault()
    return
  }
  if ((e.key === 'e' || e.key === 'E') && state === 'playing') {
    // Reset the current level: new layout and fresh pieces, but no gem
    placeBlocks()
    resetPositions()
    lightBlue = null
    draw()
    return
  }
  if (e.key === 't' || e.key === 'T') {
    activateFreeze()
    return
  }
  if (e.key === 'Enter') {
    advance()
    if (state !== 'playing') return
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

window.addEventListener('keyup', (e) => {
  if (e.key === ' ') {
    pulling = false
    // A quick tap without moving raises the shield
    if (!movedWhileSpace && performance.now() - spaceDownAt < 300) {
      activateShield()
    }
  }
})

// Touch: swipe to move, tap to start/advance screens
const SWIPE_MIN = 30
let touchStart: { x: number; y: number } | null = null

// Go full screen on mobile when starting the game (best effort; iPhone Safari lacks support)
function enterFullscreen(): void {
  if (!isTouch || document.fullscreenElement) return
  document.documentElement.requestFullscreen?.().catch(() => {})
}

// On-screen d-pad shown on touch devices in portrait orientation
interface DpadButton {
  dx: number
  dy: number
  x: number
  y: number
  w: number
  h: number
}

function dpadVisible(): boolean {
  return controlsReserved() && state === 'playing'
}

function dpadButtons(): DpadButton[] {
  const bs = DPAD_BTN
  const gap = DPAD_GAP
  const cx = canvas.width / 2
  const bottom = canvas.height - DPAD_MARGIN
  return [
    { dx: 0, dy: -1, x: cx - bs / 2, y: bottom - 3 * bs - 2 * gap, w: bs, h: bs },
    { dx: -1, dy: 0, x: cx - bs / 2 - gap - bs, y: bottom - 2 * bs - gap, w: bs, h: bs },
    { dx: 1, dy: 0, x: cx + bs / 2 + gap, y: bottom - 2 * bs - gap, w: bs, h: bs },
    { dx: 0, dy: 1, x: cx - bs / 2, y: bottom - bs, w: bs, h: bs },
  ]
}

canvas.addEventListener(
  'touchstart',
  (e) => {
    const t = e.changedTouches[0]
    touchStart = { x: t.clientX, y: t.clientY }
    e.preventDefault()
  },
  { passive: false },
)

canvas.addEventListener(
  'touchend',
  (e) => {
    if (!touchStart) return
    const t = e.changedTouches[0]
    const dx = t.clientX - touchStart.x
    const dy = t.clientY - touchStart.y
    touchStart = null
    e.preventDefault()
    if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) {
      // Tap: advance non-playing screens
      if (state !== 'playing') {
        enterFullscreen()
        advance()
        return
      }
      // Tap on a d-pad button moves in that direction
      if (dpadVisible()) {
        for (const b of dpadButtons()) {
          if (t.clientX >= b.x && t.clientX <= b.x + b.w && t.clientY >= b.y && t.clientY <= b.y + b.h) {
            tryMove(b.dx, b.dy)
            return
          }
        }
      }
      // Otherwise move towards the tap: dominant axis relative to the player
      const px = offsetX + player.x * CELL + CELL / 2
      const py = offsetY + player.y * CELL + CELL / 2
      const tx = t.clientX - px
      const ty = t.clientY - py
      if (Math.abs(tx) < CELL / 2 && Math.abs(ty) < CELL / 2) return // tapped the player itself
      if (Math.abs(tx) > Math.abs(ty)) {
        tryMove(tx > 0 ? 1 : -1, 0)
      } else {
        tryMove(0, ty > 0 ? 1 : -1)
      }
      return
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      tryMove(dx > 0 ? 1 : -1, 0)
    } else {
      tryMove(0, dy > 0 ? 1 : -1)
    }
  },
  { passive: false },
)

window.addEventListener('resize', resize)
resize()
