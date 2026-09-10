// Peer-to-peer transport over PeerJS.
//
// One player hosts and owns a short room code; the other joins with it. The
// host is authoritative for anything random (map seed, wind, shell weight,
// whose turn it is). Shot simulation itself is run identically on both sides
// from the velocity vector the shooter sends, so trajectories stay in lockstep
// without streaming positions.

export const PROTOCOL_VERSION = 3;
const ID_PREFIX = 'mortars-away-v3-';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ],
  },
  debug: 0,
};

export function makeRoomCode() {
  let s = '';
  for (let i = 0; i < 5; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

export class Net extends EventTarget {
  constructor() {
    super();
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.roomCode = null;
    this.connected = false;
    this.latency = 0;
    this._pingTimer = null;
    this._pendingPings = new Map();
    this._seq = 0;
    this._closedByUs = false;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // --------------------------------------------------------- lifecycle

  host() {
    return new Promise((resolve, reject) => {
      if (typeof window.Peer !== 'function') {
        reject(new Error('PeerJS failed to load. Check your connection and reload.'));
        return;
      }
      this.isHost = true;
      let attempts = 0;

      const tryOnce = () => {
        const code = makeRoomCode();
        const peer = new window.Peer(ID_PREFIX + code, PEER_CONFIG);
        let settled = false;

        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          try { peer.destroy(); } catch (e) { /* nothing to clean up */ }
          reject(new Error('Timed out reaching the matchmaking server.'));
        }, 15000);

        peer.on('open', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          this.peer = peer;
          this.roomCode = code;
          this._wireHost(peer);
          resolve(code);
        });

        peer.on('error', (err) => {
          if (settled) return;
          // A taken room code just means we roll another one.
          if (err && err.type === 'unavailable-id' && attempts < 6) {
            attempts++;
            try { peer.destroy(); } catch (e) { /* nothing to clean up */ }
            clearTimeout(timeout);
            tryOnce();
            return;
          }
          settled = true;
          clearTimeout(timeout);
          reject(new Error(describeError(err)));
        });
      };

      tryOnce();
    });
  }

  _wireHost(peer) {
    peer.on('connection', (conn) => {
      if (this.conn && this.conn.open) {
        // Only one opponent per room.
        try { conn.close(); } catch (e) { /* already gone */ }
        return;
      }
      this.conn = conn;
      this._wireConn(conn);
    });
    peer.on('error', (err) => this.emit('neterror', { message: describeError(err) }));
    peer.on('disconnected', () => {
      if (!this._closedByUs) {
        try { peer.reconnect(); } catch (e) { /* broker gone */ }
      }
    });
  }

  join(code) {
    return new Promise((resolve, reject) => {
      if (typeof window.Peer !== 'function') {
        reject(new Error('PeerJS failed to load. Check your connection and reload.'));
        return;
      }
      const clean = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (clean.length !== 5) {
        reject(new Error('Room codes are five characters.'));
        return;
      }
      this.isHost = false;
      this.roomCode = clean;
      const peer = new window.Peer(PEER_CONFIG);
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { peer.destroy(); } catch (e) { /* nothing to clean up */ }
        reject(new Error('No answer from room ' + clean + '. Check the code.'));
      }, 20000);

      peer.on('open', () => {
        this.peer = peer;
        const conn = peer.connect(ID_PREFIX + clean, {
          reliable: true,
          serialization: 'json',
          metadata: { v: PROTOCOL_VERSION },
        });
        this.conn = conn;
        conn.on('open', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          this._wireConn(conn);
          this._onOpen();
          resolve(clean);
        });
        conn.on('error', (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(new Error(describeError(err)));
        });
      });

      peer.on('error', (err) => {
        if (settled) {
          this.emit('neterror', { message: describeError(err) });
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(new Error(describeError(err)));
      });
    });
  }

  _wireConn(conn) {
    conn.on('data', (raw) => this._onData(raw));
    conn.on('close', () => {
      this.connected = false;
      this._stopPing();
      this.emit('peerleft', {});
    });
    conn.on('error', (err) => this.emit('neterror', { message: describeError(err) }));
    if (conn.open) this._onOpen();
    else conn.on('open', () => this._onOpen());
  }

  _onOpen() {
    if (this.connected) return;
    this.connected = true;
    this._startPing();
    this.emit('peerjoined', { isHost: this.isHost });
  }

  _onData(raw) {
    let msg = raw;
    if (typeof raw === 'string') {
      try { msg = JSON.parse(raw); } catch (e) { return; }
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;

    if (msg.t === 'ping') {
      this.send({ t: 'pong', id: msg.id });
      return;
    }
    if (msg.t === 'pong') {
      const sent = this._pendingPings.get(msg.id);
      if (sent !== undefined) {
        this._pendingPings.delete(msg.id);
        // Round trip halved, smoothed so the readout does not jitter.
        const rtt = performance.now() - sent;
        this.latency = this.latency ? this.latency * 0.7 + rtt * 0.3 : rtt;
        this.emit('latency', { ms: Math.round(this.latency) });
      }
      return;
    }
    this.emit('message', msg);
  }

  send(msg) {
    if (!this.conn || !this.conn.open) return false;
    try {
      this.conn.send(msg);
      return true;
    } catch (e) {
      this.emit('neterror', { message: 'Send failed: ' + e.message });
      return false;
    }
  }

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (!this.conn || !this.conn.open) return;
      const id = ++this._seq;
      this._pendingPings.set(id, performance.now());
      // Drop stale entries so the map cannot grow without bound.
      if (this._pendingPings.size > 12) {
        const oldest = this._pendingPings.keys().next().value;
        this._pendingPings.delete(oldest);
      }
      this.send({ t: 'ping', id });
    }, 2000);
  }

  _stopPing() {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
    this._pendingPings.clear();
  }

  close() {
    this._closedByUs = true;
    this._stopPing();
    try { if (this.conn) this.conn.close(); } catch (e) { /* already closed */ }
    try { if (this.peer) this.peer.destroy(); } catch (e) { /* already destroyed */ }
    this.conn = null;
    this.peer = null;
    this.connected = false;
  }
}

function describeError(err) {
  if (!err) return 'Unknown network error.';
  const t = err.type || '';
  switch (t) {
    case 'peer-unavailable':
      return 'That room is not open. Check the code, or the host may have left.';
    case 'network':
      return 'Lost contact with the matchmaking server.';
    case 'browser-incompatible':
      return 'This browser cannot do WebRTC. Try Chrome, Edge or Firefox.';
    case 'unavailable-id':
      return 'Room code collision. Try hosting again.';
    case 'webrtc':
      return 'WebRTC failed to establish a direct link. A restrictive network or VPN is the usual cause.';
    case 'server-error':
      return 'The matchmaking server is unavailable right now.';
    case 'ssl-unavailable':
      return 'Secure connection to the matchmaking server failed.';
    default:
      return (err.message || String(err) || 'Network error') + (t ? ' (' + t + ')' : '');
  }
}

// A no-op transport used by the local hot-seat and practice modes so the game
// loop does not need to care whether an opponent is real.
export class LocalNet extends EventTarget {
  constructor() {
    super();
    this.isHost = true;
    this.connected = true;
    this.latency = 0;
    this.roomCode = 'LOCAL';
    this.local = true;
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  send() { return true; }
  close() {}
}
