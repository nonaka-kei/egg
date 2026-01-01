/**
 * Network Manager using PeerJS
 * Handles Peer-to-Peer connection for Egg Game.
 */
class NetworkManager {
    constructor() {
        this.peer = null;
        this.conn = null;
        this.isHost = false;
        this.isConnected = false;
        this.onData = null; // Callback for receiving data
        this.onConnected = null; // Callback when connection established
        this.onError = null;
        this.myId = null;
    }

    // Initialize Peer (Try to host first, if taken, try to join?)
    // Actually, for "Secret Word", we can deterministically generate ID.
    // e.g. "egg-game-secretword"
    // BUT PeerJS doesn't let us "check if taken" easily without erroring.
    // Approach: Try to OPEN with the ID. If error "unavailable", then CONNECT to it.

    // BETTER APPROACH for fairness/simplicity:
    // User enters ID. 
    // We try to `new Peer(ID)`.
    // If it succeeds -> We are HOST. Wait for connection.
    // If it fails (ID taken) -> We assume Host exists. We `new Peer()` (random ID) and CONNECT to ID.

    async connect(secretWord) {
        const roomId = `egg-game-${secretWord.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        console.log(`Attempting to join/create room: ${roomId}`);

        // 1. Try to BECOME HOST
        try {
            this.peer = new Peer(roomId, {
                debug: 2
            });

            this.peer.on('open', (id) => {
                console.log('Created Room as Host:', id);
                this.isHost = true;
                this.myId = id;
                this.setupHostListeners();
            });

            this.peer.on('error', (err) => {
                if (err.type === 'unavailable-id') {
                    console.log('Room exists. Joining as Guest...');
                    this.joinRoom(roomId);
                } else {
                    console.error('Peer Error:', err);
                    if (this.onError) this.onError(err.type);
                }
            });

        } catch (e) {
            console.error(e);
        }
    }

    joinRoom(hostId) {
        this.peer = new Peer(); // Random ID for guest

        this.peer.on('open', (id) => {
            console.log('My Guest ID:', id);
            this.myId = id;
            // Connect to Host
            const conn = this.peer.connect(hostId, {
                reliable: true
            });
            this.setupConnection(conn);
        });

        this.peer.on('error', (err) => {
            console.error('Guest Peer Error:', err);
            if (this.onError) this.onError(err.type);
        });
    }

    setupHostListeners() {
        this.peer.on('connection', (conn) => {
            console.log('Incoming connection...');
            // Only accept one player
            if (this.isConnected) {
                conn.close();
                return;
            }
            this.setupConnection(conn);
        });
    }

    setupConnection(conn) {
        this.conn = conn;

        this.conn.on('open', () => {
            console.log('Connection Established!');
            this.isConnected = true;
            if (this.onConnected) this.onConnected(this.isHost);
        });

        this.conn.on('data', (data) => {
            console.log('Received:', data);
            if (this.onData) this.onData(data);
        });

        this.conn.on('close', () => {
            console.log('Connection Closed');
            this.isConnected = false;
            if (this.onError) this.onError('disconnected');
        });

        this.conn.on('error', (err) => {
            console.error('Conn Error:', err);
        });
    }

    send(data) {
        if (this.conn && this.conn.open) {
            this.conn.send(data);
        } else {
            console.warn('Cannot send, connection not open.');
        }
    }
}
