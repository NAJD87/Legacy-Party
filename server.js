const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Load game data
const bombTopics = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/bomb-topics.json'), 'utf8')).topics;
const mysteries = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/mysteries.json'), 'utf8'));

// Data structures
const rooms = new Map(); // roomCode -> { hostId, players: Map, gameState, selectedGame, createdAt, usedTopics, currentRound }
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

// Send private message to specific player
function sendToPlayer(playerId, message) {
  const connection = playerConnections.get(playerId);
  if (connection && connection.ws && connection.ws.readyState === WebSocket.OPEN) {
    connection.ws.send(JSON.stringify(message));
  }
}

// Get room info (with scores)
function getRoomInfo(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return null;
  
  const playersList = Array.from(room.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    isHost: p.id === room.hostId,
    score: p.score
  }));
  
  return {
    roomCode,
    hostId: room.hostId,
    players: playersList,
    playerCount: playersList.length,
    gameState: room.gameState,
    selectedGame: room.selectedGame,
    currentRound: room.currentRound || 0
  };
}

// Get random topic
function getRandomTopic(usedTopics = []) {
  const available = bombTopics.filter(t => !usedTopics.includes(t.id));
  if (available.length === 0) return bombTopics[Math.floor(Math.random() * bombTopics.length)];
  return available[Math.floor(Math.random() * available.length)];
}

// Get random bomb for a topic
function getRandomBomb(topic) {
  return topic.bombs[Math.floor(Math.random() * topic.bombs.length)];
}

// Get random mystery
function getRandomMystery(usedMysteries = []) {
  const available = mysteries.filter(m => !usedMysteries.includes(m.id));
  if (available.length === 0) return mysteries[Math.floor(Math.random() * mysteries.length)];
  return available[Math.floor(Math.random() * available.length)];
}

// Get random clue from mystery
function getRandomClueFromMystery(mystery) {
  return mystery.clues[Math.floor(Math.random() * mystery.clues.length)];
}

// Start a new round while preserving the room's selected game and scores.
function startRoomRound(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.players.size === 0) return;

  room.currentRound = (room.currentRound || 0) + 1;
  room.gameState = 'GAME';
  room.roundData = {};

  let gameToPlay = room.selectedGame;
  if (gameToPlay === 'random') {
    gameToPlay = Math.random() < 0.5 ? 'bomb' : 'thief';
  }

  if (gameToPlay === 'bomb') {
    const topic = getRandomTopic(room.usedTopics);
    room.usedTopics.push(topic.id);
    room.roundData = {
      gameType: 'bomb',
      topic: topic,
      generalWord: topic.general,
      bombWord: getRandomBomb(topic),
      submissions: new Map(),
      submitted: new Set(),
      roundStartTime: Date.now(),
      roundDuration: 30000,
      ended: false
    };

    broadcastToRoom(roomCode, {
      type: 'gameStarted',
      gameType: 'bomb',
      gameState: 'GAME',
      generalWord: topic.general,
      roundDuration: 30000,
      currentRound: room.currentRound
    });

    // Automatically finish the round when the timer expires.
    const roundRef = room.roundData;
    setTimeout(() => {
      const currentRoom = rooms.get(roomCode);
      if (currentRoom && currentRoom.roundData === roundRef && currentRoom.gameState === 'GAME') {
        endBombRound(roomCode);
      }
    }, 30000);
  } else {
    startThiefGame(roomCode, room.currentRound);
  }

  console.log(`Round ${room.currentRound} started in room ${roomCode}, game: ${gameToPlay}`);
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
          createdAt: Date.now(),
          usedTopics: [],
          usedMysteries: [],
          currentRound: 0,
          roundData: {}
        };

        room.players.set(playerId, {
          id: playerId,
          name: playerName,
          ws: ws,
          score: 0
        });

        rooms.set(roomCode, room);
        playerConnections.set(playerId, { ws, roomCode, playerName });

        ws.send(JSON.stringify({
          type: 'roomCreated',
          roomCode,
          playerId,
          playerName,
          ...getRoomInfo(roomCode)
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

        isHost = false;
        room.players.set(playerId, {
          id: playerId,
          name: playerName,
          ws: ws,
          score: 0
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

      // SELECT GAME (HOST ONLY - SERVER VERIFIED)
      else if (action === 'selectGame') {
        const room = rooms.get(roomCode);
        if (!room) return;

        // SERVER-SIDE HOST VERIFICATION
        if (room.hostId !== playerId) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Only host can select games'
          }));
          return;
        }

        const game = data.game;
        room.selectedGame = game;

        broadcastToRoom(roomCode, {
          type: 'gameSelected',
          game: game
        });

        console.log(`Game ${game} selected in room ${roomCode}`);
      }

      // START GAME (HOST ONLY - SERVER VERIFIED)
      else if (action === 'startGame') {
        const room = rooms.get(roomCode);
        if (!room) return;

        if (room.hostId !== playerId) {
          ws.send(JSON.stringify({ type: 'error', message: 'Only host can start games' }));
          return;
        }

        if (!room.selectedGame) {
          ws.send(JSON.stringify({ type: 'error', message: 'No game selected' }));
          return;
        }

        startRoomRound(roomCode);
      }

      // SUBMIT BOMB WORD ANSWER (BOMB GAME)
      else if (action === 'submitBombAnswer') {
        const room = rooms.get(roomCode);
        if (!room || room.gameState !== 'GAME') return;

        const roundData = room.roundData;
        if (roundData.gameType !== 'bomb' || roundData.ended) return;

        const answer = data.answer.trim();
        if (!answer) return;

        // Prevent duplicate submissions
        if (roundData.submitted.has(playerId)) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'You already submitted an answer'
          }));
          return;
        }

        // Check if round time has expired
        const elapsedTime = Date.now() - roundData.roundStartTime;
        if (elapsedTime > roundData.roundDuration) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Round ended. No more submissions allowed.'
          }));
          return;
        }

        roundData.submitted.add(playerId);
        roundData.submissions.set(playerId, answer);

        // Send confirmation to player
        ws.send(JSON.stringify({
          type: 'answerSubmitted',
          message: 'Your answer has been submitted'
        }));

        // Check if all players have submitted
        if (roundData.submitted.size === room.players.size) {
          endBombRound(roomCode);
        }
      }

      // END BOMB ROUND (HOST ONLY)
      else if (action === 'endBombRound') {
        const room = rooms.get(roomCode);
        if (!room) return;

        // SERVER-SIDE HOST VERIFICATION
        if (room.hostId !== playerId) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Only host can end rounds'
          }));
          return;
        }

        endBombRound(roomCode);
      }

      // SUBMIT THIEF VOTE
      else if (action === 'submitThiefVote') {
        const room = rooms.get(roomCode);
        if (!room || room.gameState !== 'VOTING') return;

        const roundData = room.roundData;
        if (roundData.gameType !== 'thief' || roundData.ended) return;

        const accusedPlayerId = data.accusedPlayerId;
        if (!accusedPlayerId || !room.players.has(accusedPlayerId)) return;
        if (accusedPlayerId === playerId) {
          ws.send(JSON.stringify({ type: 'error', message: 'لا يمكنك التصويت لنفسك' }));
          return;
        }

        // Prevent duplicate votes
        if (roundData.votes && roundData.votes.has(playerId)) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'You already voted'
          }));
          return;
        }

        // Check if voting time has expired
        const elapsedTime = Date.now() - roundData.votingStartTime;
        if (elapsedTime > roundData.votingDuration) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Voting ended. No more votes allowed.'
          }));
          return;
        }

        // Record vote
        if (!roundData.votes) roundData.votes = new Map();
        roundData.votes.set(playerId, accusedPlayerId);

        // Send confirmation to player
        ws.send(JSON.stringify({
          type: 'voteSubmitted',
          message: 'Your vote has been submitted'
        }));

        // Check if all players have voted
        if (roundData.votes.size === room.players.size) {
          endThiefVoting(roomCode);
        }
      }

      // START NEW ROUND (HOST ONLY)
      else if (action === 'startNewRound') {
        const room = rooms.get(roomCode);
        if (!room) return;

        if (room.hostId !== playerId) {
          ws.send(JSON.stringify({ type: 'error', message: 'Only host can start new rounds' }));
          return;
        }

        if (!room.selectedGame) {
          ws.send(JSON.stringify({ type: 'error', message: 'No game selected' }));
          return;
        }

        startRoomRound(roomCode);
      }

      // RETURN TO ROOM/LOBBY (HOST ONLY)
      else if (action === 'returnToLobby') {
        const room = rooms.get(roomCode);
        if (!room) return;

        // SERVER-SIDE HOST VERIFICATION
        if (room.hostId !== playerId) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Only host can return to lobby'
          }));
          return;
        }

        // Return to lobby
        room.gameState = 'LOBBY';
        room.selectedGame = null;
        room.roundData = {};

        broadcastToRoom(roomCode, {
          type: 'returnToLobby',
          ...getRoomInfo(roomCode)
        });

        console.log(`Room ${roomCode} returned to lobby`);
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

    // Finish an active vote early when every remaining player has voted.
    if (room.gameState === 'VOTING' && room.roundData && room.roundData.votes) {
      if (room.roundData.votes.size >= room.players.size) {
        endThiefVoting(roomCode);
      }
    }

    console.log(`${playerName} left room ${roomCode}`);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// END BOMB ROUND LOGIC
function endBombRound(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const roundData = room.roundData;
  if (roundData.gameType !== 'bomb' || roundData.ended) return;
  roundData.ended = true;

  const bombWord = roundData.bombWord;
  const results = {
    generalWord: roundData.generalWord,
    bombWord: bombWord,
    playerResults: []
  };

  // Determine who hit the bomb and who survived
  room.players.forEach((player) => {
    const answer = roundData.submissions.get(player.id) || '';
    const hitBomb = answer.toLowerCase() === bombWord.toLowerCase();

    if (hitBomb) {
      // Bomb word hit - 0 points
      results.playerResults.push({
        playerId: player.id,
        playerName: player.name,
        answer: answer,
        hitBomb: true,
        pointsGained: 0
      });
    } else {
      // Survived - 1 point
      player.score += 1;
      results.playerResults.push({
        playerId: player.id,
        playerName: player.name,
        answer: answer,
        hitBomb: false,
        pointsGained: 1
      });
    }
  });

  room.gameState = 'RESULTS';
  results.scores = Array.from(room.players.values()).map(p => ({
    playerId: p.id,
    playerName: p.name,
    totalScore: p.score
  }));
  results.currentRound = room.currentRound;

  // Send results to all players
  broadcastToRoom(roomCode, {
    type: 'roundResults',
    ...results,
    gameType: 'bomb'
  });

  console.log(`Round ${room.currentRound} ended in room ${roomCode}`);
}

// START THIEF GAME LOGIC
function startThiefGame(roomCode, roundNumber) {
  const room = rooms.get(roomCode);
  if (!room) return;

  // Get random mystery
  const mystery = getRandomMystery(room.usedMysteries || []);
  if (!room.usedMysteries) room.usedMysteries = [];
  room.usedMysteries.push(mystery.id);
  
  // Randomly select a thief from players
  const playersArray = Array.from(room.players.values());
  const thiefPlayer = playersArray[Math.floor(Math.random() * playersArray.length)];
  const thiefId = thiefPlayer.id;

  // Store round data
  room.roundData = {
    gameType: 'thief',
    mystery: mystery,
    thiefId: thiefId,
    cluesSent: new Set(),
    discussionStartTime: Date.now(),
    discussionDuration: 45000, // 45 seconds
    votes: new Map(),
    votingStartTime: null,
    votingDuration: 30000, // 30 seconds
    ended: false
  };

  room.gameState = 'DISCUSSION';

  // Send mystery and discussion phase to all players
  broadcastToRoom(roomCode, {
    type: 'thiefGameStarted',
    event: mystery.event,
    discussionDuration: 45000,
    currentRound: roundNumber
  });

  // Send private message to thief
  sendToPlayer(thiefId, {
    type: 'thiefPrivateMessage',
    message: 'أنت السارق 🕵️'
  });

  // Send private clues to all non-thief players
  playersArray.forEach((player) => {
    if (player.id !== thiefId) {
      const clue = getRandomClueFromMystery(mystery);
      sendToPlayer(player.id, {
        type: 'playerPrivateClue',
        clue: clue
      });
      room.roundData.cluesSent.add(player.id);
    }
  });

  // Schedule voting phase start after discussion time
  setTimeout(() => {
    startThiefVoting(roomCode);
  }, 45000);

  console.log(`Thief game started in room ${roomCode}, round ${roundNumber}, thief is ${thiefPlayer.name}`);
}

// START THIEF VOTING PHASE
function startThiefVoting(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.roundData.gameType !== 'thief' || room.roundData.ended) return;

  room.gameState = 'VOTING';
  room.roundData.votingStartTime = Date.now();
  room.roundData.votes = new Map();

  const playersList = Array.from(room.players.values()).map(p => ({
    id: p.id,
    name: p.name
  }));

  // Notify all players to start voting
  broadcastToRoom(roomCode, {
    type: 'thiefVotingStarted',
    players: playersList,
    votingDuration: 30000
  });

  // Schedule result reveal after voting time
  setTimeout(() => {
    endThiefVoting(roomCode);
  }, 30000);
}

// END THIEF VOTING AND REVEAL RESULTS
function endThiefVoting(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.roundData.gameType !== 'thief') return;

  const roundData = room.roundData;
  if (roundData.ended) return;
  roundData.ended = true;
  const thiefId = roundData.thiefId;
  const thiefPlayer = room.players.get(thiefId);
  if (!thiefPlayer) {
    room.gameState = 'LOBBY';
    room.selectedGame = null;
    room.roundData = {};
    broadcastToRoom(roomCode, { type: 'returnToLobby', ...getRoomInfo(roomCode) });
    return;
  }
  const thiefName = thiefPlayer.name;
  const mystery = roundData.mystery;

  // Count votes for each player
  const voteCounts = new Map();
  room.players.forEach((player) => {
    voteCounts.set(player.id, 0);
  });

  roundData.votes.forEach((accusedId) => {
    voteCounts.set(accusedId, (voteCounts.get(accusedId) || 0) + 1);
  });

  // Find the player with highest votes (server-side determination)
  let accusedId = null;
  let maxVotes = 0;

  voteCounts.forEach((votes, playerId) => {
    if (votes > maxVotes) {
      maxVotes = votes;
      accusedId = playerId;
    }
  });

  // If no votes, no one accused
  const accusedName = accusedId ? room.players.get(accusedId).name : 'No one';
  const thiefCaught = accusedId === thiefId;

  // Calculate points for correct voters and thief
  const correctVoters = [];
  if (thiefCaught) {
    // Thief was caught - give points to those who voted for the thief
    roundData.votes.forEach((accusedIdVote, voterId) => {
      if (accusedIdVote === thiefId) {
        room.players.get(voterId).score += 1;
        correctVoters.push(voterId);
      }
    });
  } else {
    // Thief survived - give point to thief
    room.players.get(thiefId).score += 1;
    correctVoters.push(thiefId);
  }

  room.gameState = 'RESULTS';

  const results = {
    accusedPlayerId: accusedId,
    accusedPlayerName: accusedName,
    thiefId: thiefId,
    thiefName: thiefName,
    mystery: mystery,
    thiefCaught: thiefCaught,
    correctVoters: correctVoters,
    votes: Array.from(roundData.votes.entries()).map(([voterId, accusedId]) => ({
      voterId,
      voterName: room.players.get(voterId)?.name || 'لاعب غادر',
      accusedId,
      accusedName: room.players.get(accusedId)?.name || 'لاعب غادر'
    })),
    scores: Array.from(room.players.values()).map(p => ({
      playerId: p.id,
      playerName: p.name,
      totalScore: p.score
    })),
    currentRound: room.currentRound
  };

  // Send results to all players
  broadcastToRoom(roomCode, {
    type: 'thiefRoundResults',
    ...results
  });

  console.log(`Thief voting ended in room ${roomCode}, round ${room.currentRound}, thief was ${thiefName}, accused was ${accusedName}`);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Legacy Party server running on port ${PORT}`);
});
