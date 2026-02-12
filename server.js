/**
 * Battleship V2+ — Server
 * - Iteration 1: Server-controlled state; New Game vs Restart
 * - Iteration 2: Explicit game state machine (SETUP, PLAYER_TURN, COMPUTER_TURN, GAME_OVER)
 * - Advanced: Persistent storage (JSON); game survives server restart
 * - Advanced AI: Hunt/target behavior; memory of hits (target queue of adjacent cells)
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const GRID_SIZE = 10;
const SHIP_SPECS = [
  { name: '1×4', length: 4 },
  { name: '1×3', length: 3 },
  { name: '1×2', length: 2 },
];

const STATE = {
  SETUP: 'SETUP',
  PLAYER_TURN: 'PLAYER_TURN',
  COMPUTER_TURN: 'COMPUTER_TURN',
  GAME_OVER: 'GAME_OVER',
};

const STATE_FILE = path.join(__dirname, 'game-state.json');

function key(r, c) {
  return `${r},${c}`;
}

function placeShipRandom(grid, spec) {
  const vertical = Math.random() < 0.5;
  const maxRow = vertical ? GRID_SIZE - spec.length : GRID_SIZE - 1;
  const maxCol = vertical ? GRID_SIZE - 1 : GRID_SIZE - spec.length;
  if (maxRow < 0 || maxCol < 0) return null;
  for (let attempt = 0; attempt < 200; attempt++) {
    const r = Math.floor(Math.random() * (maxRow + 1));
    const c = Math.floor(Math.random() * (maxCol + 1));
    const cells = [];
    for (let i = 0; i < spec.length; i++) {
      cells.push({ row: vertical ? r + i : r, col: vertical ? c : c + i });
    }
    const occupied = new Set(grid.flatMap(s => s.cells.map(c => key(c.row, c.col))));
    if (cells.every(cell => !occupied.has(key(cell.row, cell.col)))) {
      return { name: spec.name, length: spec.length, cells };
    }
  }
  return null;
}

function placeEnemyShips() {
  const enemy = [];
  for (const spec of SHIP_SPECS) {
    let s;
    while (!(s = placeShipRandom(enemy, spec))) {}
    enemy.push(s);
  }
  return enemy;
}

function countShipsLeft(ships, hitsSet) {
  return ships.filter(ship =>
    ship.cells.some(c => !hitsSet.has(key(c.row, c.col)))
  ).length;
}

function validatePlacement(ships) {
  if (!Array.isArray(ships) || ships.length !== 3) return { ok: false, message: 'Must place exactly 3 ships' };
  const lengths = ships.map(s => s.length).sort((a, b) => b - a);
  if (lengths[0] !== 4 || lengths[1] !== 3 || lengths[2] !== 2) return { ok: false, message: 'Ships must be length 4, 3, and 2' };
  const occupied = new Set();
  for (const ship of ships) {
    if (!ship.cells || !Array.isArray(ship.cells)) return { ok: false, message: 'Invalid ship cells' };
    for (const cell of ship.cells) {
      const r = cell.row, c = cell.col;
      if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) return { ok: false, message: 'Ship out of bounds' };
      const k = key(r, c);
      if (occupied.has(k)) return { ok: false, message: 'Ships overlap' };
      occupied.add(k);
    }
  }
  return { ok: true };
}

// In-memory game state (also persisted to JSON)
let game = {
  state: STATE.SETUP,
  winner: null,
  yourShips: [],
  enemyShips: [],
  yourHits: [],
  yourMisses: [],
  enemyHits: [],
  enemyMisses: [],
  aiTargetQueue: [], // hunt/target: cells adjacent to hits, not yet fired (strings "r,c")
};

function yourHitsSet() {
  return new Set(game.yourHits);
}

function yourMissesSet() {
  return new Set(game.yourMisses);
}

function enemyHitsSet() {
  return new Set(game.enemyHits);
}

function enemyMissesSet() {
  return new Set(game.enemyMisses);
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(game, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save state:', err.message);
  }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      game = data;
      if (!Array.isArray(game.aiTargetQueue)) game.aiTargetQueue = [];
      return true;
    }
  } catch (err) {
    console.error('Failed to load state:', err.message);
  }
  return false;
}

function clientState() {
  return {
    state: game.state,
    winner: game.winner,
    yourShips: game.yourShips,
    yourHits: game.yourHits,
    yourMisses: game.yourMisses,
    enemyHits: game.enemyHits,
    enemyMisses: game.enemyMisses,
    yourShipsLeft: countShipsLeft(game.yourShips, yourHitsSet()),
    enemyShipsLeft: countShipsLeft(game.enemyShips, enemyHitsSet()),
  };
}

// Add adjacent cells (in bounds, not yet fired) to AI target queue
function addNeighborsToTargetQueue(r, c) {
  const fired = new Set([...game.yourHits, ...game.yourMisses]);
  const inQueue = new Set(game.aiTargetQueue);
  const neighbors = [
    [r - 1, c],
    [r + 1, c],
    [r, c - 1],
    [r, c + 1],
  ];
  for (const [nr, nc] of neighbors) {
    if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) continue;
    const k = key(nr, nc);
    if (fired.has(k) || inQueue.has(k)) continue;
    game.aiTargetQueue.push(k);
    inQueue.add(k);
  }
}

// Check if any ship was just sunk (all its cells are in yourHits)
function anyShipSunk() {
  const hitsSet = yourHitsSet();
  return game.yourShips.some(ship =>
    ship.cells.every(cell => hitsSet.has(key(cell.row, cell.col)))
  );
}

function runComputerTurn() {
  const firedSet = new Set([...game.yourHits, ...game.yourMisses]);
  let r, c, k;

  // Target mode: prefer queue (cells adjacent to previous hits)
  while (game.aiTargetQueue.length > 0) {
    k = game.aiTargetQueue.shift();
    if (firedSet.has(k)) continue; // already shot there
    const [rr, cc] = k.split(',').map(Number);
    r = rr;
    c = cc;
    break;
  }

  // Hunt mode: no pending target, pick random unfired cell
  if (r === undefined) {
    const possible = [];
    for (let ri = 0; ri < GRID_SIZE; ri++) {
      for (let ci = 0; ci < GRID_SIZE; ci++) {
        const ki = key(ri, ci);
        if (!firedSet.has(ki)) possible.push({ r: ri, c: ci });
      }
    }
    if (possible.length === 0) return;
    const cell = possible[Math.floor(Math.random() * possible.length)];
    r = cell.r;
    c = cell.c;
  }

  k = key(r, c);
  const hit = game.yourShips.some(ship =>
    ship.cells.some(cell => cell.row === r && cell.col === c)
  );

  if (hit) {
    game.yourHits.push(k);
    if (countShipsLeft(game.yourShips, yourHitsSet()) === 0) {
      game.state = STATE.GAME_OVER;
      game.winner = 'computer';
      game.aiTargetQueue = [];
    } else {
      addNeighborsToTargetQueue(r, c);
      // If we just sunk a ship, clear queue so we go back to hunt for the next ship
      if (anyShipSunk()) game.aiTargetQueue = [];
      game.state = STATE.COMPUTER_TURN;
    }
  } else {
    game.yourMisses.push(k);
    game.state = STATE.PLAYER_TURN;
  }
}

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// GET /api/game — current state (client never sees enemyShips)
app.get('/api/game', (req, res) => {
  res.json(clientState());
});

// POST /api/game/new — new game: new enemy placement, clear player ships and shots, SETUP
app.post('/api/game/new', (req, res) => {
  game.state = STATE.SETUP;
  game.winner = null;
  game.yourShips = [];
  game.enemyShips = placeEnemyShips();
  game.yourHits = [];
  game.yourMisses = [];
  game.enemyHits = [];
  game.enemyMisses = [];
  game.aiTargetQueue = [];
  saveState();
  res.json(clientState());
});

// POST /api/game/restart — same boards, clear shots, back to PLAYER_TURN (only if already placed)
app.post('/api/game/restart', (req, res) => {
  if (game.yourShips.length !== 3 || !game.enemyShips.length) {
    return res.status(400).json({ error: 'Cannot restart: place ships and start a game first' });
  }
  game.state = STATE.PLAYER_TURN;
  game.winner = null;
  game.yourHits = [];
  game.yourMisses = [];
  game.enemyHits = [];
  game.enemyMisses = [];
  game.aiTargetQueue = [];
  saveState();
  res.json(clientState());
});

// POST /api/game/place — submit placement (valid only in SETUP)
app.post('/api/game/place', (req, res) => {
  if (game.state !== STATE.SETUP) {
    return res.status(400).json({ error: 'Placement only allowed in SETUP' });
  }
  const { ships } = req.body || {};
  const validation = validatePlacement(ships);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.message });
  }
  game.yourShips = ships;
  game.state = STATE.PLAYER_TURN;
  saveState();
  res.json(clientState());
});

// POST /api/game/fire — player shot (valid only in PLAYER_TURN)
app.post('/api/game/fire', (req, res) => {
  if (game.state !== STATE.PLAYER_TURN) {
    return res.status(400).json({ error: 'Fire only allowed on your turn' });
  }
  const { row, col } = req.body || {};
  const r = parseInt(row, 10);
  const c = parseInt(col, 10);
  if (isNaN(r) || isNaN(c) || r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) {
    return res.status(400).json({ error: 'Invalid cell' });
  }
  const k = key(r, c);
  if (game.enemyHits.includes(k) || game.enemyMisses.includes(k)) {
    return res.status(400).json({ error: 'Already fired at this cell' });
  }

  const hit = game.enemyShips.some(ship =>
    ship.cells.some(cell => cell.row === r && cell.col === c)
  );
  if (hit) {
    game.enemyHits.push(k);
    if (countShipsLeft(game.enemyShips, enemyHitsSet()) === 0) {
      game.state = STATE.GAME_OVER;
      game.winner = 'player';
      saveState();
      return res.json(clientState());
    }
    game.state = STATE.PLAYER_TURN;
    saveState();
    return res.json(clientState());
  } else {
    game.enemyMisses.push(k);
    game.state = STATE.COMPUTER_TURN;
  }

  // Run computer turn(s) until miss or game over
  while (game.state === STATE.COMPUTER_TURN) {
    runComputerTurn();
    saveState();
  }

  res.json(clientState());
});

// Load persisted state on startup
loadState();
if (game.state === STATE.SETUP && !game.enemyShips.length) {
  game.enemyShips = placeEnemyShips();
  saveState();
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Battleship server at http://localhost:${PORT}`);
});
