const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Data structures
const rooms = new Map(); // roomCode -> { hostId, players: Map, gameState, createdAt }
const playerConnections = new Map(); // playerId -> { ws, roomCode, playerName }

// Generate unique room code
function generateRoomCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 8).toUpperCase();
  } while (rooms.has(code));
  return code;
}

// Generate unique player ID
function generatePlayerId() {
  return 'p_' + Math.random().toString(36).substring(2, 12);
}

// Broadcast to room
function broadcastToRoom(roomCode, message) {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  const data = JSON.stringify(message);
  room.players.forEach((player) => {
    if (player.ws && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  });
}

// Get room info
function getRoomInfo(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return null;
  
  const playersList = Array.from(room.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    isHost: p.id === room.hostId
  }));
  
  return {
    roomCode,
    hostId: room.hostId,
    players: playersList,
    playerCount: playersList.length,
    gameState: room.gameState
  };
}

// Handle WebSocket connections
wss.on('connection', (ws) => {
  let playerId = null;
  let playerName = null;
  let roomCode = null;
  let isHost = false;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const action = data.action;

      // CREATE ROOM
      if (action === 'createRoom') {
        if (playerId) {
          ws.close(1008, 'Player already in a room');
          return;
        }

        playerId = generatePlayerId();
        playerName = data.playerName || 'Player';
        roomCode = generateRoomCode();
        isHost = true;

        const room = {
          hostId: playerId,
          players: new Map(),
          gameState: 'LOBBY',
          selectedGame: null,
          createdAt: Date.now()
        };

        room.players.set(playerId, {
          id: playerId,
          name: playerName,
          ws: ws
        });

        rooms.set(roomCode, room);
        playerConnections.set(playerId, { ws, roomCode, playerName });

        ws.send(JSON.stringify({
          type: 'roomCreated',
          roomCode,
          playerId,
          playerName
        }));

        console.log(`Room ${roomCode} created by ${playerName}`);
      }

      // JOIN ROOM
      else if (action === 'joinRoom') {
        if (playerId) {
          ws.close(1008, 'Player already in a room');
          return;
        }

        roomCode = data.roomCode;
        playerName = data.playerName || 'Player';
        playerId = generatePlayerId();

        const room = rooms.get(roomCode);
        if (!room) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Room not found'
          }));
          return;
        }

        if (room.players.size >= 12) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Room is full'
          }));
          return;
        }

        room.players.set(playerId, {
          id: playerId,
          name: playerName,
          ws: ws
        });

        playerConnections.set(playerId, { ws, roomCode, playerName });

        ws.send(JSON.stringify({
          type: 'roomJoined',
          roomCode,
          playerId,
          playerName,
          ...getRoomInfo(roomCode)
        }));

        broadcastToRoom(roomCode, {
          type: 'playerListUpdated',
          ...getRoomInfo(roomCode)
        });

        console.log(`${playerName} joined room ${roomCode}`);
      }

      // SELECT GAME (HOST ONLY)
      else if (action === 'selectGame') {
        if (!isHost) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Only host can select games'
          }));
          return;
        }

        const room = rooms.get(roomCode);
        if (!room) return;

        const game = data.game;
        room.selectedGame = game;

        broadcastToRoom(roomCode, {
          type: 'gameSelected',
          game: game
        });

        console.log(`Game ${game} selected in room ${roomCode}`);
      }

      // START GAME (HOST ONLY)
      else if (action === 'startGame') {
        if (!isHost) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Only host can start games'
          }));
          return;
        }

        const room = rooms.get(roomCode);
        if (!room || !room.selectedGame) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'No game selected'
          }));
          return;
        }

        room.gameState = 'GAME';

        broadcastToRoom(roomCode, {
          type: 'gameStarted',
          game: room.selectedGame,
          gameState: 'GAME'
        });

        console.log(`Game started in room ${roomCode}`);
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    if (!playerId || !roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    room.players.delete(playerId);
    playerConnections.delete(playerId);

    // If host disconnects, transfer host to another player
    if (isHost && room.players.size > 0) {
      const newHostId = room.players.keys().next().value;
      room.hostId = newHostId;
      console.log(`Host transferred in room ${roomCode}`);
    }

    // Delete empty rooms
    if (room.players.size === 0) {
      rooms.delete(roomCode);
      console.log(`Room ${roomCode} deleted (empty)`);
      return;
    }

    // Notify remaining players
    broadcastToRoom(roomCode, {
      type: 'playerListUpdated',
      ...getRoomInfo(roomCode)
    });

    console.log(`${playerName} left room ${roomCode}`);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Legacy Party server running on port ${PORT}`);
});
