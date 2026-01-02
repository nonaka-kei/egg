/**
 * Network Manager using PeerJS
 * Topology: Host-Client (Star) using "Secret Word" Rooms
 */
class NetworkManager {
    constructor() {
        this.peer = null;
        this.connections = new Map(); // id -> Conn (Host Only)
        this.hostConn = null;         // Conn to Host (Client Only)
        this.isHost = false;
        this.myId = null;

        // Callbacks
        this.onConnected = null; // (isHost, peerId)
        this.onPeerJoin = null;  // (peerId, metadata) -> Host only
        this.onData = null;      // (data, sourceId)
        this.onError = null;
    }

    async connect(secretWord, playerName) {
        const roomId = `egg-game-${secretWord.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        console.log(`Attempting channel: ${roomId}`);

        // 1. Try to BECOME HOST
        try {
            this.peer = new Peer(roomId, { debug: 2 });

            this.peer.on('open', (id) => {
                console.log('Created Room as Host:', id);
                this.isHost = true;
                this.myId = id;
                this.setupHostListeners();
                if (this.onConnected) this.onConnected(true, id);
            });

            this.peer.on('error', (err) => {
                if (err.type === 'unavailable-id') {
                    console.log('Room exists. Joining as Guest...');
                    this.joinRoom(roomId, playerName);
                } else {
                    console.error('Peer Error:', err);
                    if (this.onError) this.onError(err.type);
                }
            });

        } catch (e) { console.error(e); }
    }

    joinRoom(hostId, playerName) {
        this.peer = new Peer(); // Random ID

        this.peer.on('open', (id) => {
            console.log('My ID:', id);
            this.myId = id;
            this.isHost = false;

            // Connect to Host
            const conn = this.peer.connect(hostId, {
                reliable: true,
                metadata: { name: playerName }
            });

            conn.on('open', () => {
                console.log("Connected to Host");
                this.hostConn = conn;
                this.setupConnListeners(conn);
                if (this.onConnected) this.onConnected(false, id);
            });

            conn.on('error', e => console.error("Conn Error:", e));
        });

        this.peer.on('error', err => {
            console.error('Guest Error:', err);
            if (this.onError) this.onError(err.type);
        });
    }

    setupHostListeners() {
        this.peer.on('connection', (conn) => {
            console.log('Incoming connection from:', conn.peer);

            conn.on('open', () => {
                console.log("Connection Established with:", conn.peer);
                this.connections.set(conn.peer, conn);

                // Notify Game
                if (this.onPeerJoin) this.onPeerJoin(conn.peer, conn.metadata);

                this.setupConnListeners(conn);
            });
        });
    }

    setupConnListeners(conn) {
        conn.on('data', (data) => {
            // If Host, we receive from Client. Source = conn.peer
            // If Client, we receive from Host. Source = Host
            const source = conn.peer;
            if (this.onData) this.onData(data, source);
        });

        conn.on('close', () => {
            console.log("Closed:", conn.peer);
            this.connections.delete(conn.peer);
            // Handle Drop?
        });
    }

    // Send to specific (Host -> Client)
    sendTo(peerId, data) {
        if (!this.isHost) return;
        const conn = this.connections.get(peerId);
        if (conn && conn.open) conn.send(data);
    }

    // Broadcast (Host -> All Clients)
    broadcast(data) {
        if (!this.isHost) return;
        this.connections.forEach(conn => {
            if (conn.open) conn.send(data);
        });
    }

    // Send to Host (Client -> Host)
    sendToHost(data) {
        if (this.isHost) return; // Host loops back locally usually
        if (this.hostConn && this.hostConn.open) {
            this.hostConn.send(data);
        }
    }
}
