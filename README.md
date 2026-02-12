# Battleship V2+ 

---

## How to run

```bash
cd battleship
npm install
npm start
```
Then open **http://localhost:3000** in your browser.

## Architecture Snapshot

### Diagram

```
  [Browser Client]                         [Node.js Server]
  - UI, placement UI, buttons              - Game state (single game)
  - Fetches state; sends place/fire/new/restart
         │                                          │
         └────────── GET/POST /api/game ────────────┘
                              │
                    Persisted to game-state.json
```

### Client responsibilities

- **UI:** Render both grids (your fleet, enemy waters), placement controls (H/V, place ship, Start Battle, Rearrange), status bar, ship counts, New Game and Restart Battle.
- **Placement (SETUP):** Collect three ship placements locally; on “Start Battle” send `POST /api/game/place` with `{ ships }`. “Rearrange” clears local placement only (no server call).
- **Display state:** After every API response, re-render from server state. Client does not hold authoritative game state; it only displays the latest response.
- **Actions:** New Game → `POST /api/game/new`. Restart Battle → `POST /api/game/restart`. Fire → `POST /api/game/fire` with `{ row, col }`.
- **Audio:** Hit sound (Web Audio API) when a fire response indicates a new hit.

### Server responsibilities

- **Game state:** Single in-memory game object (`state`, `winner`, `yourShips`, `enemyShips`, `yourHits`, `yourMisses`, `enemyHits`, `enemyMisses`, `aiTargetQueue`). Client never receives `enemyShips`.
- **State machine:** Four states — `SETUP`, `PLAYER_TURN`, `COMPUTER_TURN`, `GAME_OVER`. Every endpoint checks current state and rejects invalid transitions (e.g. fire only in `PLAYER_TURN`).
- **Validation:** Placement (3 ships, lengths 4/3/2, no overlap, in bounds). Fire (in bounds, not already fired). Restart only when ships already placed.
- **AI:** Hunt/target with memory; runs computer shot(s) when state is `COMPUTER_TURN` until a miss or game over.
- **Persistence:** After every state change, write game to `game-state.json`; load on startup so the game survives server restart.
- **Static files:** Serves the app from the same origin so the client can call `/api`.

### Where game state lives

- **Authoritative:** On the server, in memory and in `game-state.json`. One game per server process.
- **Client:** Only the latest snapshot from the last API response, used for rendering. No browser refresh is used to fix state.

### How state transitions occur

| Trigger                | Allowed state(s) | New state / effect |
|------------------------|-----------------|--------------------|
| POST /api/game/new     | any             | SETUP; new enemy ships; ships and shots cleared |
| POST /api/game/place   | SETUP           | PLAYER_TURN (ships saved, validated) |
| POST /api/game/fire    | PLAYER_TURN     | Hit → stay PLAYER_TURN; Miss → COMPUTER_TURN (server runs AI until miss or GAME_OVER) |
| Server (AI)            | COMPUTER_TURN   | Hit → stay COMPUTER_TURN; Miss → PLAYER_TURN; all ships sunk → GAME_OVER |
| POST /api/game/restart | (ships placed)  | PLAYER_TURN; same boards; shots cleared |
| GET /api/game          | any             | No transition; returns current state |

All transitions are enforced on the server; invalid requests return 400 and do not change state.

---

## Major iterations added

Two major iterations were added beyond the baseline (client-only game). Each changes behavior, rules, or architecture.

### Iteration 1 — Server-controlled state; New Game vs Restart

- **What was added:** A Node.js + Express server that holds the only copy of game state. The client no longer owns state; it sends actions (place, fire, new game, restart) and re-renders from the server’s response.
- **Examples:**  
  - **New Game:** `POST /api/game/new` — server generates new enemy ships, clears your ships and all shots, sets state to SETUP so you place again.  
  - **Restart Battle:** `POST /api/game/restart` — server keeps the same your ships and enemy ships, clears all shots, sets state to PLAYER_TURN so you go first again.  
- **Why it counts:** Ownership of state moves from client to server; behavior (two distinct actions: new vs restart) and architecture (client/server split) change.

### Iteration 2 — Explicit game state machine

- **What was added:** A formal state machine on the server with four states: `SETUP`, `PLAYER_TURN`, `COMPUTER_TURN`, `GAME_OVER`. Every API request checks the current state; only valid transitions are allowed.
- **Examples:**  
  - **Placement:** `POST /api/game/place` is only accepted when state is `SETUP`; after success, state becomes `PLAYER_TURN`.  
  - **Fire:** `POST /api/game/fire` is only accepted when state is `PLAYER_TURN`; on miss, state becomes `COMPUTER_TURN` and the server runs the AI until a miss or game over.  
  - Invalid requests (e.g. fire during SETUP) return 400 and do not change state.  
- **Why it counts:** All transitions are explicit and enforced in one place on the server; game state handling is clear and predictable.

### Optional / advanced (also implemented)

- **Persistent storage:** Game state is written to `game-state.json` after every change and loaded on server startup so the game survives a restart.  
- **Advanced AI:** Hunt/target with memory — after a hit, the computer queues adjacent cells and prefers shooting from that queue until a miss or ship is sunk.

---

## AI Prompt Log (6 prompts)

**1. Initial game request**

- **Prompt:** Create a Battleship game with radar-themed UI, an opponent, show hits and misses, show ships being hit, green = hit / red = miss, run on localhost.
- **Why:** To get a working baseline game with a clear theme and core rules in one shot.
- **Accepted:** Full implementation (HTML, CSS, JS), radar theme, two grids, AI opponent, hit/miss styling, local server instructions. **Rejected:** Nothing.

---

**2. Rule and ship set changes**

- **Prompt:** Use only 1×2, 1×3, 1×4 ships; let me move/place my ships wherever I want before the round; and when someone hits a correct spot they go again until they miss.
- **Why:** Match desired rules and add a placement phase.
- **Accepted:** New ship set (three ships only), placement phase with H/V and grid clicks, Start Battle and Rearrange, hit = extra turn for both player and AI. **Rejected:** Nothing.

---

**3. Hide opponent’s ships**

- **Prompt:** Don’t let me see my opponent’s ships or where they are placed; fix that.
- **Why:** Classic Battleship: enemy positions should be hidden until hit.
- **Accepted:** Enemy grid no longer shows ship positions; only hits (green) and misses (red) after firing. **Rejected:** The previous “show enemy ships” behavior.

---

**4. Hit sound effect**

- **Prompt:** Add a sound effect when a ship is hit.
- **Why:** Wanted clearer feedback on hits.
- **Accepted:** Web Audio API hit sound on any ship hit, with context resume on Start Battle so it works after user interaction. **Rejected:** Nothing.

---

**5. Two iterations + advanced (server, state machine, persistence)**

- **Prompt:** Implement whatever is needed for the two required major iterations and the optional advanced iteration: server-controlled state with New Game vs Restart, explicit game state machine (SETUP, PLAYER_TURN, COMPUTER_TURN, GAME_OVER) enforced on the server, and persistent storage (JSON) so the game survives server restart.
- **Why:** To satisfy the V2+ assignment (two iterations) and the advanced option (persistence).
- **Accepted:** Node.js + Express server with GET/POST /api/game, new, restart, place, fire; four-state machine with validation; save/load to game-state.json; client refactored to use API only, with New Game and Restart Battle buttons. **Rejected:** Nothing.

---

**6. Advanced AI (hunt/target + memory)**

- **Prompt:** Add the Advanced AI with hunt/target behavior and memory of hits.
- **Why:** To implement the optional advanced iteration for a stronger opponent.
- **Accepted:** Server maintains `aiTargetQueue` of cells adjacent to hits; on hit, adds four neighbors (in bounds, not yet fired) to the queue and prefers shooting from the queue; when a ship is sunk the queue is cleared; queue persisted and reset on new game/restart. **Rejected:** Nothing.
