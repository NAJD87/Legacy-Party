class LegacyParty {
  constructor() {
    this.ws = null;
    this.playerId = null;
    this.playerName = null;
    this.roomCode = null;
    this.isHost = false;
    this.currentRoom = null;
    this.selectedGame = null;

    this.init();
  }

  init() {
    this.connectWebSocket();
    this.showHomepage();
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}`;
    
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.showError('Connection error');
    };

    this.ws.onclose = () => {
      console.log('WebSocket closed');
      setTimeout(() => this.connectWebSocket(), 3000);
    };
  }

  handleMessage(message) {
    const type = message.type;

    if (type === 'roomCreated') {
      this.playerId = message.playerId;
      this.playerName = message.playerName;
      this.roomCode = message.roomCode;
      this.isHost = true;
      this.showRoomPage();
    }

    if (type === 'roomJoined') {
      this.playerId = message.playerId;
      this.playerName = message.playerName;
      this.roomCode = message.roomCode;
      this.isHost = message.hostId === this.playerId;
      this.currentRoom = message;
      this.showRoomPage();
    }

    if (type === 'playerListUpdated') {
      this.currentRoom = message;
      this.isHost = message.hostId === this.playerId;
      this.updatePlayerList();
    }

    if (type === 'gameSelected') {
      this.selectedGame = message.game;
      this.updateGameSelection();
    }

    if (type === 'gameStarted') {
      this.showGamePage(message.game);
    }

    if (type === 'error') {
      this.showError(message.message);
    }
  }

  showHomepage() {
    document.getElementById('app').innerHTML = `
      <div class="homepage">
        <div class="logo-container">
          <img src="assets/legacy-logo.jpeg" alt="Legacy Party" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
          <div class="logo-fallback" style="display:none;">LEGACY</div>
        </div>
        <h1 class="app-title">LEGACY PARTY</h1>
        <p class="app-subtitle">لعبة جماعية من الجوال — بدون تحميل</p>
        
        <div class="action-section">
          <div class="form-group">
            <label for="playerNameCreate">اسمك</label>
            <input type="text" id="playerNameCreate" placeholder="أدخل اسمك" maxlength="20">
          </div>
          <button class="btn-primary" onclick="game.createRoom()">إنشاء غرفة</button>
        </div>

        <div class="action-section">
          <div class="form-group">
            <label for="playerNameJoin">اسمك</label>
            <input type="text" id="playerNameJoin" placeholder="أدخل اسمك" maxlength="20">
          </div>
          <div class="form-group">
            <label for="roomCodeInput">كود الغرفة</label>
            <input type="text" id="roomCodeInput" placeholder="مثال: ABC123" maxlength="6" style="text-transform: uppercase;">
          </div>
          <button class="btn-primary" onclick="game.joinRoom()">الانضمام للغرفة</button>
        </div>
      </div>
    `;
  }

  createRoom() {
    const playerName = document.getElementById('playerNameCreate').value.trim();
    if (!playerName) {
      this.showError('��لرجاء إدخال اسمك');
      return;
    }

    this.ws.send(JSON.stringify({
      action: 'createRoom',
      playerName
    }));
  }

  joinRoom() {
    const playerName = document.getElementById('playerNameJoin').value.trim();
    const roomCode = document.getElementById('roomCodeInput').value.trim().toUpperCase();

    if (!playerName) {
      this.showError('الرجاء إدخال اسمك');
      return;
    }

    if (!roomCode) {
      this.showError('الرجاء إدخال كود الغرفة');
      return;
    }

    this.ws.send(JSON.stringify({
      action: 'joinRoom',
      roomCode,
      playerName
    }));
  }

  showRoomPage() {
    document.getElementById('app').innerHTML = `
      <div class="room-page">
        <div class="room-header">
          <div class="room-logo-small">
            <img src="assets/legacy-logo.jpeg" alt="Logo" onerror="this.style.display='none';">
          </div>
          <div class="room-code-display">
            <div class="room-code-label">كود الغرفة</div>
            <div class="room-code">${this.roomCode}</div>
          </div>
          <div></div>
        </div>

        <div class="room-content">
          <div class="players-section">
            <div class="section-title">اللاعبون (${this.currentRoom.playerCount}/12)</div>
            <div class="player-list" id="playerList">
              <!-- Players will be rendered here -->
            </div>
          </div>

          ${this.isHost ? `
            <div class="game-selection">
              <div class="section-title">اختر اللعبة</div>
              <div class="game-options">
                <button class="game-option ${this.selectedGame === 'bomb' ? 'selected' : ''}" onclick="game.selectGame('bomb')">🧨 الكلمة المفخخة</button>
                <button class="game-option ${this.selectedGame === 'thief' ? 'selected' : ''}" onclick="game.selectGame('thief')">🕵️ مين سرقها؟</button>
                <button class="game-option ${this.selectedGame === 'random' ? 'selected' : ''}" onclick="game.selectGame('random')">🎲 عشوائي</button>
              </div>
            </div>
            <button class="btn-primary" onclick="game.startGame()" ${!this.selectedGame ? 'disabled' : ''}>ابدأ اللعبة</button>
          ` : ''}
        </div>
      </div>
    `;

    this.updatePlayerList();
  }

  updatePlayerList() {
    const playerList = document.getElementById('playerList');
    if (!playerList || !this.currentRoom) return;

    playerList.innerHTML = this.currentRoom.players.map(player => `
      <div class="player-item">
        <span class="player-name">${player.name}</span>
        <span class="player-badge">${player.isHost ? '👑' : ''}</span>
      </div>
    `).join('');
  }

  selectGame(game) {
    if (!this.isHost) return;
    
    this.selectedGame = this.selectedGame === game ? null : game;
    
    this.ws.send(JSON.stringify({
      action: 'selectGame',
      game: this.selectedGame
    }));
  }

  updateGameSelection() {
    const gameOptions = document.querySelectorAll('.game-option');
    gameOptions.forEach(option => {
      const game = option.textContent.includes('الكلمة') ? 'bomb' : 
                   option.textContent.includes('سرقها') ? 'thief' : 'random';
      
      if (game === this.selectedGame) {
        option.classList.add('selected');
      } else {
        option.classList.remove('selected');
      }
    });

    const startBtn = document.querySelector('button[onclick*="startGame"]');
    if (startBtn) {
      startBtn.disabled = !this.selectedGame;
    }
  }

  startGame() {
    if (!this.isHost || !this.selectedGame) return;

    this.ws.send(JSON.stringify({
      action: 'startGame'
    }));
  }

  showGamePage(game) {
    document.getElementById('app').innerHTML = `
      <div style="padding: 20px; text-align: center;">
        <h2>لعبة: ${game === 'bomb' ? '🧨 الكلمة المفخخة' : game === 'thief' ? '🕵️ مين سرقها؟' : '🎲 عشوائي'}</h2>
        <p>قريبا...</p>
      </div>
    `;
  }

  showError(message) {
    alert(message);
  }
}

const game = new LegacyParty();
