/**
 * Egg Game - Core Logic & UI Controller
 * Updated for N-Player Battle Royale + Online Network
 */

/* --- CONSTANTS & CONFIG --- */
const CONFIG = {
    MAX_HP: 5,
    EGG_TIMER: 2,
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
    constructor(id, name, isCpu = false) {
        this.id = id;
        this.name = name;
        this.isCpu = isCpu;
        this.hp = CONFIG.MAX_HP;
        this.eggs = []; // Array of { turnsRemaining: number, isReflected: boolean }
        this.history = [];
        this.isDead = false;
        // Turn-specific flags
        this.currentMove = null;
        this.targetId = null;
        this.hasEggSnapshot = false;
    }

    addEgg(isReflected = false) {
        this.eggs.push({ turnsRemaining: CONFIG.EGG_TIMER, isReflected });
    }

    removeEgg(onlyCurable = true) {
        if (this.eggs.length === 0) return false;
        const curableEggs = this.eggs.filter(e => {
            if (onlyCurable && e.isReflected) return false;
            return true;
        });

        if (curableEggs.length === 0) return false;
        this.eggs = this.eggs.filter(e => !curableEggs.includes(e));
        return true;
    }

    updateEggs() {
        this.eggs.forEach(egg => egg.turnsRemaining--);
        const exploded = this.eggs.some(egg => egg.turnsRemaining < 0);
        if (exploded) {
            this.hp = 0;
            this.isDead = true;
        }
        return exploded;
    }

    canUseSausage() {
        if (this.history.length < CONFIG.SAUSAGE_LIMIT) return true;
        const lastMoves = this.history.slice(-CONFIG.SAUSAGE_LIMIT);
        return !lastMoves.every(m => m === MOVES.SAUSAGE);
    }
}

class GameEngine {
    constructor() {
        this.players = new Map(); // id -> PlayerState
        this.myId = null;
        this.turn = 1;
        this.isGameOver = false;
        this.logs = [];
        this.onStateChange = null;
        this.isHost = false; // Flag for Network Role
    }

    initGame(myId, myName, others = []) {
        this.players.clear();
        this.myId = myId;

        // Add Self
        this.players.set(myId, new PlayerState(myId, myName));

        // Add Others
        others.forEach(p => {
            this.players.set(p.id, new PlayerState(p.id, p.name, p.isCpu));
        });

        this.turn = 1;
        this.isGameOver = false;
        this.logs = [];
        this.log("Game Start! Battle Royale Mode.");

        // Host Broadcast Initial State
        if (this.isHost) this.broadcastState();
    }

    log(message) {
        this.logs.push(message);
        if (this.onStateChange) this.onStateChange('log', message);
    }

    // --- NETWORK HELPERS ---
    serializeState() {
        return {
            turn: this.turn,
            isGameOver: this.isGameOver,
            logs: this.logs,
            players: Array.from(this.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                hp: p.hp,
                eggs: p.eggs,
                history: p.history,
                isDead: p.isDead,
                isCpu: p.isCpu
            }))
        };
    }

    applyState(data) {
        this.turn = data.turn;
        this.isGameOver = data.isGameOver;
        this.logs = data.logs; // Host logs are authoritative

        data.players.forEach(pData => {
            let p = this.players.get(pData.id);
            if (!p) {
                p = new PlayerState(pData.id, pData.name, pData.isCpu);
                this.players.set(pData.id, p);
            }
            // Sync mutable state
            p.hp = pData.hp;
            p.eggs = pData.eggs;
            p.history = pData.history;
            p.isDead = pData.isDead;
        });

        if (this.onStateChange) {
            this.onStateChange('log', null); // Refresh logs
            this.onStateChange('update');
        }
    }

    broadcastState() {
        if (!this.isHost) return;
        const state = this.serializeState();
        net.broadcast({ type: 'state', state: state });
    }

    // --- MOVE LOGIC ---
    registerMove(playerId, action, targetId) {
        // CLIENT: Send to Host
        if (!this.isHost && playerId === this.myId) {
            net.sendToHost({ type: 'move', action, targetId });
            this.log("Waiting for others...");
            return;
        }

        const p = this.players.get(playerId);
        if (!p || p.isDead) return;

        p.currentMove = action;
        p.targetId = targetId;

        // Check readiness
        const livingPlayers = Array.from(this.players.values()).filter(p => !p.isDead);
        const allReady = livingPlayers.every(p => p.currentMove !== null);

        if (allReady) {
            this.resolveTurn();
            if (this.isHost) this.broadcastState(); // Sync after turn
        }
    }

    // CPU Logic (Host/Local only)
    queueCpuMoves() {
        if (!this.isHost && this.players.size > 0 && !this.players.get(this.myId).isCpu) return; // Only Host manages CPUs logic essentially (or Local)
        // Actually, if Local Only, isHost is false? No, we treat Local as Host=false usually but Engine checks are lax.
        // Let's assume Local mode sets isHost=false but calls queueCpuMoves explicitly.

        const cpus = Array.from(this.players.values()).filter(p => p.isCpu && !p.isDead);
        if (cpus.length === 0) return;

        setTimeout(() => {
            cpus.forEach(cpu => {
                const move = this.decideCpuMove(cpu);
                const potentialTargets = Array.from(this.players.values())
                    .filter(p => !p.isDead && p.id !== cpu.id);

                let targetId = null;
                if (potentialTargets.length > 0) {
                    targetId = potentialTargets[Math.floor(Math.random() * potentialTargets.length)].id;
                }

                this.registerMove(cpu.id, move, targetId);
            });
        }, 500);
    }

    decideCpuMove(cpuState) {
        if (cpuState.eggs.some(e => !e.isReflected) && cpuState.canUseSausage()) {
            return MOVES.SAUSAGE;
        }
        const moves = Object.values(MOVES);
        if (!cpuState.canUseSausage()) {
            const idx = moves.indexOf(MOVES.SAUSAGE);
            if (idx > -1) moves.splice(idx, 1);
        }
        return moves[Math.floor(Math.random() * moves.length)];
    }

    resolveTurn() {
        this.log(`--- Turn ${this.turn} ---`);
        const livingPlayers = Array.from(this.players.values()).filter(p => !p.isDead);

        // 1. SNAPSHOT
        livingPlayers.forEach(p => {
            p.hasEggSnapshot = p.eggs.length > 0;
            p.history.push(p.currentMove);

            let targetName = "";
            if (p.targetId) {
                const t = this.players.get(p.targetId);
                targetName = t ? ` -> ${t.name}` : "";
            }
            this.log(`${p.name}: [${p.currentMove.toUpperCase()}]${targetName}`);
        });

        // 2. INTERACTION
        const damageMap = new Map();
        const eggMap = new Map();
        const refEggMap = new Map();
        livingPlayers.forEach(p => { damageMap.set(p.id, 0); eggMap.set(p.id, 0); refEggMap.set(p.id, 0); });

        livingPlayers.forEach(defender => {
            const defAction = defender.currentMove;
            const defHasEgg = defender.hasEggSnapshot;

            if (defAction === MOVES.SAUSAGE && defHasEgg) {
                if (defender.removeEgg(true)) this.log(`${defender.name} cured their Egg!`);
            }

            const attackers = livingPlayers.filter(p => p.targetId === defender.id && p.id !== defender.id);
            attackers.forEach(attacker => {
                const atkAction = attacker.currentMove;

                if (atkAction === MOVES.ATTACK) {
                    if (defAction === MOVES.SAUSAGE && !defHasEgg) {
                        this.log(`${defender.name} Reflects ${attacker.name}'s Attack!`);
                        damageMap.set(attacker.id, (damageMap.get(attacker.id) || 0) + 1);
                    } else if (defAction === MOVES.BARRIER) {
                        this.log(`${defender.name}'s Barrier fails vs Attack!`);
                        damageMap.set(defender.id, (damageMap.get(defender.id) || 0) + 1);
                    } else {
                        this.log(`${attacker.name} Attacks ${defender.name}!`);
                        damageMap.set(defender.id, (damageMap.get(defender.id) || 0) + 1);
                    }
                }
                else if (atkAction === MOVES.EGG) {
                    if (defAction === MOVES.BARRIER) {
                        this.log(`${defender.name} Reflects ${attacker.name}'s Egg! (Uncurable)`);
                        refEggMap.set(attacker.id, (refEggMap.get(attacker.id) || 0) + 1);
                    } else if (defAction === MOVES.SAUSAGE && !defHasEgg) {
                        this.log(`${attacker.name} plants Egg on ${defender.name}!`);
                        eggMap.set(defender.id, (eggMap.get(defender.id) || 0) + 1);
                    } else {
                        this.log(`${attacker.name} plants Egg on ${defender.name}!`);
                        eggMap.set(defender.id, (eggMap.get(defender.id) || 0) + 1);
                    }
                }
            });
        });

        // 3. APPLY
        livingPlayers.forEach(p => {
            p.hp -= (damageMap.get(p.id) || 0);

            const newEggs = (eggMap.get(p.id) || 0);
            const refEggs = (refEggMap.get(p.id) || 0);
            const totalIncoming = newEggs + refEggs;

            if (totalIncoming >= 2) {
                this.log(`${p.name} HIT BY MULTIPLE EGGS! INSTANT DEATH!`);
                p.hp = 0;
            } else if (totalIncoming > 0 && p.hasEggSnapshot && p.eggs.length > 0) {
                this.log(`${p.name} DOUBLE EGG! INSTANT DEATH!`);
                p.hp = 0;
            } else {
                for (let i = 0; i < newEggs; i++) p.addEgg(false);
                for (let i = 0; i < refEggs; i++) p.addEgg(true);
            }
        });

        // 4. DEATHS
        this.checkDeaths("Instant");

        // 5. TIMERS
        Array.from(this.players.values()).filter(p => !p.isDead).forEach(p => {
            if (p.updateEggs()) this.log(`${p.name}'s Egg EXPLODED!`);
        });

        this.checkDeaths("Timer");

        // Cleanup
        livingPlayers.forEach(p => { p.currentMove = null; p.targetId = null; });
        this.turn++;
        if (this.onStateChange) this.onStateChange('update');

        // CPU trigger for Host
        if (this.isHost) this.queueCpuMoves();
    }

    checkDeaths(reason) {
        const living = Array.from(this.players.values()).filter(p => !p.isDead);
        living.forEach(p => {
            if (p.hp <= 0) {
                this.log(`${p.name} Defeated! (${reason})`);
                p.isDead = true;
            }
        });

        const survivors = Array.from(this.players.values()).filter(p => !p.isDead);
        if (survivors.length <= 1) {
            this.isGameOver = true;
            const winner = survivors.length === 1 ? survivors[0].name : "No One (Draw)";
            this.log(`GAME SET! Winner: ${winner}`);
            if (this.onStateChange) this.onStateChange('gameover', winner);
        }
    }
}

/* --- UI CONTROLLER --- */
const engine = new GameEngine();
const net = new NetworkManager();

const UI = {
    els: {
        grid: document.getElementById('opponents-grid'),
        playerHpBar: document.getElementById('player-hp-bar'),
        playerHpText: document.getElementById('player-hp-text'),
        playerStatus: document.getElementById('player-status'),
        gameLog: document.getElementById('game-log'),
        buttons: document.querySelectorAll('.action-btn'),
        turnIndicator: document.getElementById('turn-indicator'),
        playerMove: document.getElementById('player-move'),
        lobbyScreen: document.getElementById('lobby-screen'),
        gameBoardMain: document.getElementById('game-board-main'),
        btnVsCpu: document.getElementById('btn-vs-cpu'),
        btnJoinRoom: document.getElementById('btn-join-room'),
        roomCodeInput: document.getElementById('room-code-input'),
        playerNameInput: document.getElementById('player-name-input'),
        cpuCountInput: document.getElementById('cpu-count-input'),
        lobbyStatus: document.getElementById('lobby-status')
    },

    pendingAction: null,

    init() {
        UI.els.buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                if (engine.isGameOver) {
                    location.reload(); // Rematch via reload needed for Online to reset Peer? Or implement soft reset.
                    return;
                }
                const action = btn.dataset.action;
                if (action === MOVES.SAUSAGE && !engine.players.get(engine.myId).canUseSausage()) {
                    UI.logSystem("Sausage Limit Reached!"); return;
                }

                UI.handleActionClick(action);
            });
        });

        UI.els.btnVsCpu.onclick = () => {
            const name = UI.els.playerNameInput.value.trim() || "Player";
            const cpuCount = parseInt(UI.els.cpuCountInput.value) || 2;
            UI.startLocalGame(name, cpuCount);
        };

        UI.els.btnJoinRoom.onclick = () => {
            const name = UI.els.playerNameInput.value.trim() || "Player";
            const code = UI.els.roomCodeInput.value.trim();
            if (!code) { UI.updateLobbyStatus("Enter a room word!", true); return; }
            UI.startOnlineGame(name, code);
        };
    },

    startLocalGame(myName, cpuCount = 2) {
        engine.isHost = true; // Local acts as Host for CPUs
        const others = [];
        for (let i = 1; i <= cpuCount; i++) {
            others.push({ id: `cpu${i}`, name: `CPU ${i}`, isCpu: true });
        }

        engine.initGame('p1', myName, others);
        UI.startGameUI();
        engine.queueCpuMoves();
    },

    async startOnlineGame(myName, secretWord) {
        UI.updateLobbyStatus("Connecting to Neural Space...", false);
        UI.els.lobbyScreen.classList.add('connecting');

        // Wire up Network callbacks
        net.onConnected = (isHost, myId) => {
            engine.isHost = isHost;
            if (isHost) {
                UI.updateLobbyStatus("You are Host! Waiting for players...");
                // HOST INIT
                engine.initGame(myId, myName, []); // No others yet
                // Auto-start? Or wait button?
                // For simplicity, let's start and let people join mid-way? 
                // Or better: Host stays in Lobby until X players?
                // User request didn't specify Lobby Waiting Room.
                // Let's jump to game, but maybe add "Waiting..." overlay?
                // For now, jump to game.
                UI.startGameUI();
                UI.logSystem("Waiting for opponents to join...");
            } else {
                UI.updateLobbyStatus("Connected! Waiting for Host...");
                // Client just waits for State Update to Init
            }
        };

        net.onPeerJoin = (peerId, meta) => {
            if (engine.isHost) {
                const name = meta ? meta.name : "Guest";
                UI.logSystem(`${name} joined!`);
                // Add to Engine
                engine.players.set(peerId, new PlayerState(peerId, name));
                engine.broadcastState(); // Send them current state
                UI.render();
            }
        };

        net.onData = (data, source) => {
            if (engine.isHost) {
                if (data.type === 'move') {
                    // Register their move
                    engine.registerMove(source, data.action, data.targetId);
                }
            } else {
                if (data.type === 'state') {
                    // Init if not yet
                    if (engine.players.size === 0) {
                        engine.myId = net.myId;
                        UI.startGameUI();
                    }
                    engine.applyState(data.state);
                }
            }
        };

        net.onError = (type) => {
            UI.els.lobbyScreen.classList.remove('connecting');
            UI.updateLobbyStatus(`Connection Error: ${type}`, true);
        };

        await net.connect(secretWord, myName);
    },

    startGameUI() {
        UI.els.lobbyScreen.style.display = 'none';
        UI.els.gameBoardMain.style.display = 'flex';

        engine.onStateChange = (type, data) => {
            if (type === 'log') UI.logSystem(data);
            if (type === 'update') UI.render();
            if (type === 'gameover') UI.handleGameOver(data);
        };

        UI.render();
    },

    updateLobbyStatus(msg, isError) {
        UI.els.lobbyStatus.textContent = msg;
        UI.els.lobbyStatus.style.color = isError ? '#ff7b72' : 'var(--accent-secondary)';
    },

    handleActionClick(action) {
        if (action === MOVES.ATTACK || action === MOVES.EGG) {
            UI.enterTargetingMode(action);
        } else {
            UI.submitMove(action, null);
        }
    },

    enterTargetingMode(action) {
        UI.pendingAction = action;
        document.body.classList.add('targeting-mode');
        UI.logSystem(`Select target for ${action.toUpperCase()}...`);
    },

    selectTarget(targetId) {
        if (!UI.pendingAction) return;
        document.body.classList.remove('targeting-mode');
        UI.submitMove(UI.pendingAction, targetId);
        UI.pendingAction = null;
    },

    submitMove(action, targetId) {
        UI.els.buttons.forEach(b => b.disabled = true);
        // engine.registerMove checks isHost and sends if needed
        engine.registerMove(engine.myId, action, targetId);
    },

    render() {
        const me = engine.players.get(engine.myId);
        if (!me) return;

        UI.updateHp(UI.els.playerHpBar, UI.els.playerHpText, me.hp);
        UI.renderStatus(UI.els.playerStatus, me);
        UI.els.turnIndicator.textContent = `Turn ${engine.turn}`;

        UI.els.grid.innerHTML = '';
        engine.players.forEach(p => {
            if (p.id === engine.myId) return;

            const card = document.createElement('div');
            card.className = `opponent-card ${p.isDead ? 'dead' : ''}`;
            card.onclick = () => {
                if (document.body.classList.contains('targeting-mode') && !p.isDead) {
                    UI.selectTarget(p.id);
                }
            };

            const nameEl = document.createElement('div');
            nameEl.className = "avatar";
            nameEl.textContent = p.name + (p.isCpu ? "" : " (Net)");
            card.appendChild(nameEl);

            const hpContainer = document.createElement('div');
            hpContainer.className = "health-bar-container";
            hpContainer.style.width = "100%";
            hpContainer.innerHTML = `
                <div class="health-bar"><div class="health-fill" style="width:${(p.hp / CONFIG.MAX_HP) * 100}%"></div></div>
                <div class="health-text">${p.hp}/${CONFIG.MAX_HP}</div>
            `;
            card.appendChild(hpContainer);

            const statusDiv = document.createElement('div');
            statusDiv.className = "status-effects";
            UI.renderStatus(statusDiv, p);
            card.appendChild(statusDiv);

            const moveDiv = document.createElement('div');
            moveDiv.className = "move-reveal";
            // Show history or "?"
            if (p.history.length === engine.turn - 1) {
                // Previous turn move
                // Wait, p.history length matches turn if we pushed it.
                // If engine.turn is 2, and p.history has 1 item, that's turn 1 move.
                moveDiv.innerHTML = UI.getIcon(p.history[p.history.length - 1]);
            } else if (p.history.length === engine.turn) {
                // Current turn move (Wait, resolved?)
                // If resolved, turn increments?
                // Engine logic: resolve -> push history -> turn++.
                // So history.length == turn - 1.
                moveDiv.innerHTML = UI.getIcon(p.history[p.history.length - 1]);
            } else {
                moveDiv.textContent = "?";
            }
            card.appendChild(moveDiv);

            UI.els.grid.appendChild(card);
        });

        if (me.currentMove === null && !me.isDead && !engine.isGameOver) {
            UI.els.buttons.forEach(b => b.disabled = false);
            const sausageBtn = document.querySelector('[data-action="sausage"]');
            if (sausageBtn && !me.canUseSausage()) sausageBtn.disabled = true;
        }
    },

    updateHp(bar, text, hp) {
        bar.style.width = `${(hp / CONFIG.MAX_HP) * 100}%`;
        text.textContent = `${hp}/${CONFIG.MAX_HP}`;
        bar.className = 'health-fill';
        if (hp <= 2) bar.classList.add('low');
        if (hp <= 1) bar.classList.add('critical');
    },

    renderStatus(container, player) {
        container.innerHTML = '';
        player.eggs.forEach(egg => {
            const div = document.createElement('div');
            div.className = 'status-icon';
            div.innerHTML = '🥚';
            if (egg.isReflected) div.style.filter = "hue-rotate(90deg)";
            container.appendChild(div);
        });
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

    handleGameOver(winner) {
        const controls = document.querySelector('.action-buttons');
        controls.innerHTML = '';

        const restartBtn = document.createElement('button');
        restartBtn.className = 'action-btn';
        restartBtn.textContent = "Rematch / Lobby";
        restartBtn.style.gridColumn = "span 2";
        restartBtn.onclick = () => location.reload();
        controls.appendChild(restartBtn);
    }
};

document.addEventListener('DOMContentLoaded', UI.init);
