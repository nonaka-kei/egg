/**
 * Egg Game - Core Logic & UI Controller
 * Updated for Online Multiplayer
 */

/* --- CONSTANTS & CONFIG --- */
const CONFIG = {
    MAX_HP: 5,
    EGG_TIMER: 2, // Explodes after 2 turns (end of N+2)
    SAUSAGE_LIMIT: 2
};

const MOVES = {
    ATTACK: 'attack',
    EGG: 'egg',
    SAUSAGE: 'sausage',
    BARRIER: 'barrier'
};

/* --- STATE MANAGEMENT --- */
class PlayerState {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.hp = CONFIG.MAX_HP;
        this.eggs = []; // Array of { turnsRemaining: number, isReflected: boolean }
        this.history = []; // History of moves
        this.isDead = false;
    }

    addEgg(isReflected = false) {
        // Rule: If already has egg, instant death
        if (this.eggs.length > 0) {
            this.hp = 0;
            this.isDead = true;
            return true; // Exploded
        }
        this.eggs.push({ turnsRemaining: CONFIG.EGG_TIMER, isReflected });
        return false;
    }

    removeEgg(onlyCurable = true) {
        if (this.eggs.length === 0) return false;

        // Filter out uncurable eggs if specified
        // FIX: Also filter out "New" eggs (those just applied this turn, i.e., turnsRemaining == CONFIG.EGG_TIMER)
        // Sausage only cures "Existing" status.
        const curableEggs = this.eggs.filter(e => {
            if (onlyCurable && e.isReflected) return false;
            // Note: In resolveTurn, we decrement turns AFTER interaction. 
            // So a new egg has turnsRemaining == 2. Old eggs have < 2.
            if (e.turnsRemaining === CONFIG.EGG_TIMER) return false;
            return true;
        });

        if (curableEggs.length === 0) return false;

        // Remove ALL curable old eggs (usually just 1)
        this.eggs = this.eggs.filter(e => !curableEggs.includes(e));
        return true;
    }

    updateEggs() {
        // Decrease timer
        this.eggs.forEach(egg => egg.turnsRemaining--);

        // Check explosion
        const exploded = this.eggs.some(egg => egg.turnsRemaining < 0);
        if (exploded) {
            this.hp = 0;
            this.isDead = true;
        }
        return exploded;
    }

    canUseSausage() {
        if (this.history.length < CONFIG.SAUSAGE_LIMIT) return true;
        // Check last N moves
        const lastMoves = this.history.slice(-CONFIG.SAUSAGE_LIMIT);
        return !lastMoves.every(m => m === MOVES.SAUSAGE);
    }
}

class GameEngine {
    constructor() {
        this.reset();
        this.onStateChange = null; // Callback for UI
    }

    reset() {
        this.player = new PlayerState('player', 'You');
        this.opponent = new PlayerState('opponent', 'CPU');
        this.turn = 1;
        this.isGameOver = false;
        this.logs = [];
        this.isOnline = false;
        this.myMove = null;
        this.oppMove = null;
    }

    log(message) {
        this.logs.push(message);
        if (this.onStateChange) this.onStateChange('log', message);
    }

    // Call this when ANY move is decided (Local or Network)
    // For Online: 
    // - P1 selects move -> stored in `myMove`
    // - P2 sends move -> stored in `oppMove`
    // - When both exist -> `resolveRound()`
    registerMove(isPlayer, move) {
        if (isPlayer) this.myMove = move;
        else this.oppMove = move;

        if (this.myMove && this.oppMove) {
            this.resolveRound();
        }
    }

    resolveRound() {
        if (this.isGameOver) return;

        const playerMove = this.myMove;
        const opponentMove = this.oppMove;

        this.log(`--- Turn ${this.turn} ---`);
        this.log(`You: [${playerMove.toUpperCase()}] vs ${this.opponent.name}: [${opponentMove.toUpperCase()}]`);

        // Record history
        this.player.history.push(playerMove);
        this.opponent.history.push(opponentMove);

        // Resolve Interactions
        this.resolveInteraction(this.player, playerMove, this.opponent, opponentMove);
        this.resolveInteraction(this.opponent, opponentMove, this.player, playerMove);

        // Process End of Turn
        this.processEndOfTurn();

        // Cleanup
        this.myMove = null;
        this.oppMove = null;
        this.turn++;

        // Update UI
        if (this.onStateChange) this.onStateChange('update');
        if (this.onStateChange) this.onStateChange('round_end');
    }

    decideCpuMove() {
        // AI Logic:
        // Priority Cure
        if (this.opponent.eggs.length > 0 && this.opponent.canUseSausage()) {
            const hasCurable = this.opponent.eggs.some(e => !e.isReflected);
            if (hasCurable) return MOVES.SAUSAGE;
        }

        const availableMoves = Object.values(MOVES);
        if (!this.opponent.canUseSausage()) {
            const idx = availableMoves.indexOf(MOVES.SAUSAGE);
            if (idx > -1) availableMoves.splice(idx, 1);
        }
        return availableMoves[Math.floor(Math.random() * availableMoves.length)];
    }

    resolveInteraction(p1, m1, p2, m2) {
        // -- P1 USES ATTACK --
        if (m1 === MOVES.ATTACK) {
            if (m2 === MOVES.SAUSAGE) {
                // P2 Reflects Attack?
                if (p2.eggs.length > 0) {
                    this.log(`${p2.name} uses Sausage! It cures their Egg, but they take damage!`);
                    p2.removeEgg();
                    p2.hp -= 1;
                } else {
                    this.log(`${p2.name} Reflects the Attack with Sausage! ${p1.name} takes damage!`);
                    p1.hp -= 1;
                }
            } else if (m2 === MOVES.BARRIER) {
                this.log(`${p2.name}'s Barrier failed! Hit by Attack.`);
                p2.hp -= 1;
            } else {
                this.log(`${p1.name} Attacks! ${p2.name} takes damage.`);
                p2.hp -= 1;
            }
        }

        // -- P1 USES EGG --
        else if (m1 === MOVES.EGG) {
            if (m2 === MOVES.BARRIER) {
                this.log(`${p2.name}'s Barrier reflects the Egg! ${p1.name} receives an Uncurable Egg!`);
                const instantDeath = p1.addEgg(true);
                if (instantDeath) this.log(`${p1.name} already had an Egg! DOUBLE EGG!`);
            } else if (m2 === MOVES.SAUSAGE) {
                // Sausage vs New Egg
                // FIX: Check cure OLD egg first.
                const cured = p2.removeEgg(true);
                if (cured) this.log(`${p2.name} ate a Sausage and cured their Old Egg!`);

                this.log(`${p1.name} plants an Egg on ${p2.name}!`);
                const instant = p2.addEgg();
                if (instant) this.log(`${p2.name} already had an Egg! DOUBLE EGG!`);
            } else {
                this.log(`${p1.name} plants an Egg on ${p2.name}!`);
                const instant = p2.addEgg();
                if (instant) this.log(`${p2.name} already had an Egg! DOUBLE EGG!`);
            }
        }

        // -- P1 USES SAUSAGE (Self-Cure part) --
        if (m1 === MOVES.SAUSAGE) {
            // FIX: If cured, no reflect (handled implicitly by order/logic above).
            const cured = p1.removeEgg(true);
            if (cured) {
                this.log(`${p1.name} ate a Sausage and cured their Egg!`);
            }
        }
    }

    processEndOfTurn() {
        // Phase 1: Action Resolution Death (Instant)
        let instantWin = false;
        if (this.player.hp <= 0 && this.opponent.hp <= 0) {
            this.log("DOUBLE KO (Instant)! Sudden Death! HP -> 1.");
            this.player.hp = 1; this.opponent.hp = 1;
            this.player.eggs = []; this.opponent.eggs = [];
        } else if (this.player.hp <= 0) {
            this.isGameOver = true;
            this.log("You Lost (Instant)!");
            if (this.onStateChange) this.onStateChange('gameover', 'lose');
            instantWin = true;
        } else if (this.opponent.hp <= 0) {
            this.isGameOver = true;
            this.log("You Won (Instant)!");
            if (this.onStateChange) this.onStateChange('gameover', 'win');
            instantWin = true;
        }

        if (instantWin) return;

        // Phase 2: Timer Death
        const p1Exploded = this.player.updateEggs();
        const p2Exploded = this.opponent.updateEggs();

        if (p1Exploded) this.log(`${this.player.name}'s Egg EXPLODED!`);
        if (p2Exploded) this.log(`${this.opponent.name}'s Egg EXPLODED!`);

        if (this.player.hp <= 0 && this.opponent.hp <= 0) {
            this.log("DOUBLE KO (Timer)! Sudden Death! HP -> 1.");
            this.player.hp = 1; this.opponent.hp = 1;
            this.player.eggs = []; this.opponent.eggs = [];
        } else if (this.player.hp <= 0) {
            this.isGameOver = true;
            this.log("You Lost (Time limit)!");
            if (this.onStateChange) this.onStateChange('gameover', 'lose');
        } else if (this.opponent.hp <= 0) {
            this.isGameOver = true;
            this.log("You Won (Time limit)!");
            if (this.onStateChange) this.onStateChange('gameover', 'win');
        }
    }
}

/* --- UI CONTROLLER & NETWORK --- */
const engine = new GameEngine();
const net = new NetworkManager();

const UI = {
    els: {
        playerHpBar: document.getElementById('player-hp-bar'),
        playerHpText: document.getElementById('player-hp-text'),
        opponentHpBar: document.getElementById('opponent-hp-bar'),
        opponentHpText: document.getElementById('opponent-hp-text'),
        playerStatus: document.getElementById('player-status'),
        opponentStatus: document.getElementById('opponent-status'),
        gameLog: document.getElementById('game-log'),
        buttons: document.querySelectorAll('.action-btn'),
        turnIndicator: document.getElementById('turn-indicator'),
        playerMove: document.getElementById('player-move'),
        opponentMove: document.getElementById('opponent-move'),
        stateMessage: document.getElementById('state-message'),
        // Lobby
        lobbyScreen: document.getElementById('lobby-screen'),
        gameBoardMain: document.getElementById('game-board-main'),
        btnVsCpu: document.getElementById('btn-vs-cpu'),
        btnJoinRoom: document.getElementById('btn-join-room'),
        roomCodeInput: document.getElementById('room-code-input'),
        lobbyStatus: document.getElementById('lobby-status')
    },

    init() {
        // Game Buttons
        UI.els.buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                if (engine.isGameOver) {
                    location.reload();
                    return;
                }
                const action = btn.dataset.action;
                if (action === MOVES.SAUSAGE && !engine.player.canUseSausage()) {
                    UI.logSystem("Overate sausages! Cannot use more than 2 in a row.");
                    return;
                }

                UI.handlePlayerInput(action);
            });
        });

        // Lobby Buttons
        UI.els.btnVsCpu.onclick = () => UI.startGame(false);
        UI.els.btnJoinRoom.onclick = () => {
            const code = UI.els.roomCodeInput.value.trim();
            if (!code) {
                UI.updateLobbyStatus("Please enter a Secret Word.", true);
                return;
            }
            UI.startOnline(code);
        };

        // Engine Hooks
        engine.onStateChange = (type, data) => {
            if (type === 'log') UI.logSystem(data);
            if (type === 'update') UI.render();
            if (type === 'gameover') UI.handleGameOver(data);
            if (type === 'round_end') UI.showMoveReveal();
        };

        UI.render();
    },

    updateLobbyStatus(msg, isError = false) {
        UI.els.lobbyStatus.textContent = msg;
        UI.els.lobbyStatus.style.color = isError ? '#ff7b72' : 'var(--accent-secondary)';
    },

    startGame(isOnline) {
        engine.reset();
        engine.isOnline = isOnline;
        if (isOnline) {
            engine.opponent.name = "Opponent";
            UI.updateLobbyStatus("Connected! Starting game...");
        }

        setTimeout(() => {
            UI.els.lobbyScreen.style.display = 'none';
            UI.els.gameBoardMain.style.display = 'flex';
            UI.render();
        }, 500);
    },

    async startOnline(secretWord) {
        UI.updateLobbyStatus("Connecting to Neural Network...", false);
        UI.els.lobbyScreen.classList.add('connecting');

        net.onConnected = (isHost) => {
            UI.updateLobbyStatus(isHost ? "Waiting for Opponent..." : "Found Room! Joining...");
            // If guest, we just wait. If Host, we wait for connection.
            // Actually onConnected fires when Peer connection is fully established (P2P).
            // So if this fires, we are ready.
            UI.startGame(true);
        };

        net.onData = (data) => {
            if (data.type === 'move') {
                engine.registerMove(false, data.move);
                UI.logSystem("Opponent selected a move!");
                // If we also moved, engine resolves round automatically.
            }
        };

        net.onError = (type) => {
            UI.els.lobbyScreen.classList.remove('connecting');
            UI.updateLobbyStatus(`Connection Failed: ${type}`, true);
        };

        await net.connect(secretWord);
    },

    handlePlayerInput(action) {
        // Disable buttons
        UI.els.buttons.forEach(b => b.disabled = true);

        // Visual feedback
        UI.els.playerMove.textContent = "?";
        UI.els.playerMove.classList.add('anim-pop');
        UI.els.turnIndicator.textContent = "Waiting...";

        if (engine.isOnline) {
            net.send({ type: 'move', move: action });
            engine.registerMove(true, action);
        } else {
            // CPU Mode
            // Fake delay for tension
            setTimeout(() => {
                const cpuMove = engine.decideCpuMove();
                engine.registerMove(false, cpuMove); // Opponent Register
                engine.registerMove(true, action);   // Player Register -> Triggers Resolve
            }, 500);
        }
    },

    showMoveReveal() {
        const lastP = engine.player.history[engine.player.history.length - 1];
        const lastO = engine.opponent.history[engine.opponent.history.length - 1];

        UI.els.playerMove.innerHTML = UI.getIcon(lastP);
        UI.els.opponentMove.innerHTML = UI.getIcon(lastO);

        // Re-enable buttons if game not over
        if (!engine.isGameOver) {
            UI.updateButtonStates();
        }
    },

    getIcon(move) {
        switch (move) {
            case MOVES.ATTACK: return '⚔️';
            case MOVES.EGG: return '🥚';
            case MOVES.SAUSAGE: return '🌭';
            case MOVES.BARRIER: return '🛡️';
            default: return '?';
        }
    },

    logSystem(msg) {
        const div = document.createElement('div');
        div.className = 'log-entry';
        div.textContent = msg;
        UI.els.gameLog.prepend(div);
    },

    render() {
        UI.updateHp(UI.els.playerHpBar, UI.els.playerHpText, engine.player.hp);
        UI.updateHp(UI.els.opponentHpBar, UI.els.opponentHpText, engine.opponent.hp);
        UI.renderStatus(UI.els.playerStatus, engine.player);
        UI.renderStatus(UI.els.opponentStatus, engine.opponent);
        UI.els.turnIndicator.textContent = engine.isGameOver ? "Game Over" :
            (engine.myMove ? "Waiting for Opponent..." : `Turn ${engine.turn}`);
    },

    updateHp(bar, text, hp) {
        const pct = (hp / CONFIG.MAX_HP) * 100;
        bar.style.width = `${pct}%`;
        text.textContent = `${hp}/${CONFIG.MAX_HP}`;
        bar.className = 'health-fill';
        void bar.offsetWidth; // Reflow
        if (hp <= 2) bar.classList.add('low');
        if (hp <= 1) bar.classList.add('critical');
    },

    renderStatus(container, player) {
        container.innerHTML = '';
        player.eggs.forEach(egg => {
            const div = document.createElement('div');
            div.className = 'status-icon';
            div.innerHTML = '🥚';

            const badge = document.createElement('div');
            badge.className = 'status-badge';
            badge.textContent = egg.turnsRemaining + 1;

            div.appendChild(badge);
            container.appendChild(div);
        });
    },

    updateButtonStates() {
        UI.els.buttons.forEach(btn => {
            btn.disabled = false;
            if (btn.dataset.action === MOVES.SAUSAGE && !engine.player.canUseSausage()) {
                btn.disabled = true;
            }
        });
    },

    handleGameOver(result) {
        UI.els.stateMessage.textContent = result === 'win' ? "VICTORY!" : "DEFEAT";
        const restartBtn = document.createElement('button');
        restartBtn.className = 'action-btn';
        restartBtn.textContent = "Back to Lobby";
        restartBtn.style.gridColumn = "span 2";
        restartBtn.onclick = () => location.reload();

        const controls = document.querySelector('.action-buttons');
        controls.innerHTML = '';
        controls.appendChild(restartBtn);
    }
};

document.addEventListener('DOMContentLoaded', UI.init);
