class LegacyParty {
  constructor() {
    this.ws = null;
    this.playerId = null;
    this.playerName = null;
    this.roomCode = null;
    this.isHost = false;
    this.currentRoom = null;
    this.selectedGame = null;
    this.currentGameType = null;
    this.roundData = null;
    this.roundEndTimer = null;
    this.submittedAnswer = false;
    this.votedThief = false;

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
      this.currentGameType = message.gameType;
      this.roundData = message;
      this.showGamePage(message);
    }

    if (type === 'thiefGameStarted') {
      this.currentGameType = 'thief';
      this.roundData = message;
      this.showThiefDiscussionPage(message);
    }

    if (type === 'thiefPrivateMessage') {
      this.showError(message.message);
    }

    if (type === 'playerPrivateClue') {
      this.showError('🔍 ' + message.clue);
    }

    if (type === 'thiefVotingStarted') {
      this.roundData = message;
      this.showThiefVotingPage(message);
    }

    if (type === 'answerSubmitted') {
      this.submittedAnswer = true;
      this.showError(message.message);
      this.disableAnswerSubmission();
    }

    if (type === 'voteSubmitted') {
      this.votedThief = true;
      this.showError(message.message);
      this.disableVoteSubmission();
    }

    if (type === 'roundResults') {
      this.showRoundResults(message);
    }

    if (type === 'thiefRoundResults') {
      this.showThiefRoundResults(message);
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
      this.showError('الرجاء إدخال اسمك');
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
                <button class="game-option ${this.selectedGame === 'thief' ? 'selected' : ''}" onclick="game.selectGame('thief')">🕵️ من سرقها؟</button>
                <button class="game-option ${this.selectedGame === 'random' ? 'selected' : ''}" onclick="game.selectGame('random')">🎲 عشوائي</button>
              </div>
            </div>
            <button class="btn-primary" onclick="game.startGame()" ${!this.selectedGame ? 'disabled' : ''}>ابدأ اللعبة</button>
          ` : '<p style="color: var(--text-muted); text-align: center; margin-top: 20px;">في انتظار اختيار المضيف للعبة...</p>'}
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

  showGamePage(message) {
    if (message.gameType === 'bomb') {
      this.showBombGamePage(message);
    }
  }

  showBombGamePage(message) {
    const roundDuration = message.roundDuration / 1000;
    let timeRemaining = roundDuration;

    document.getElementById('app').innerHTML = `
      <div class="game-page">
        <div class="game-header">
          <div class="game-title">🧨 الكلمة المفخخة</div>
          <div class="timer" id="timer">${Math.ceil(timeRemaining)}s</div>
        </div>

        <div class="game-content">
          <div class="general-word-container">
            <div class="general-word-label">الكلمة العامة</div>
            <div class="general-word">${message.generalWord}</div>
          </div>

          <div class="submit-section">
            <div class="form-group">
              <label for="answerInput">كلمتك</label>
              <input type="text" id="answerInput" placeholder="أدخل كلمة" ${this.submittedAnswer ? 'disabled' : ''}>
            </div>
            <button class="btn-primary" onclick="game.submitBombAnswer()" ${this.submittedAnswer ? 'disabled' : ''}>إرسال</button>
          </div>

          <div class="waiting-text" id="waitingText" style="display: none;">في انتظار اللاعبين الآخرين...</div>
        </div>
      </div>
    `;

    // Timer countdown
    const timerInterval = setInterval(() => {
      timeRemaining--;
      const timerEl = document.getElementById('timer');
      if (timerEl) {
        timerEl.textContent = `${Math.ceil(timeRemaining)}s`;
      }
      
      if (timeRemaining <= 0) {
        clearInterval(timerInterval);
        this.disableAnswerSubmission();
      }
    }, 1000);

    this.roundEndTimer = setTimeout(() => {
      this.disableAnswerSubmission();
    }, message.roundDuration);
  }

  submitBombAnswer() {
    const answerInput = document.getElementById('answerInput');
    const answer = answerInput.value.trim();

    if (!answer) {
      this.showError('الرجاء إدخال كلمة');
      return;
    }

    this.ws.send(JSON.stringify({
      action: 'submitBombAnswer',
      answer: answer
    }));
  }

  disableAnswerSubmission() {
    const answerInput = document.getElementById('answerInput');
    const submitBtn = document.querySelector('button[onclick*="submitBombAnswer"]');
    const waitingText = document.getElementById('waitingText');

    if (answerInput) answerInput.disabled = true;
    if (submitBtn) submitBtn.disabled = true;
    if (waitingText) waitingText.style.display = 'block';
  }

  showThiefDiscussionPage(message) {
    const discussionDuration = message.discussionDuration / 1000;
    let timeRemaining = discussionDuration;

    document.getElementById('app').innerHTML = `
      <div class="game-page">
        <div class="game-header">
          <div class="game-title">🕵️ من سرقها؟</div>
          <div class="timer" id="timer">${Math.ceil(timeRemaining)}s</div>
        </div>

        <div class="game-content">
          <div class="discussion-container">
            <div class="discussion-label">مرحلة النقاش</div>
            <div class="discussion-message">تحدثوا واكتشفوا من السارق! 💬</div>
          </div>

          <div class="waiting-text" id="waitingText">جاري إحصاء الوقت...</div>
        </div>
      </div>
    `;

    // Timer countdown
    const timerInterval = setInterval(() => {
      timeRemaining--;
      const timerEl = document.getElementById('timer');
      if (timerEl) {
        timerEl.textContent = `${Math.ceil(timeRemaining)}s`;
      }
      
      if (timeRemaining <= 0) {
        clearInterval(timerInterval);
      }
    }, 1000);
  }

  showThiefVotingPage(message) {
    const votingDuration = message.votingDuration / 1000;
    let timeRemaining = votingDuration;
    const players = message.players || [];

    const votingOptionsHtml = players.map(player => `
      <button class="vote-option" onclick="game.submitThiefVote('${player.id}')">
        ${player.name}
      </button>
    `).join('');

    document.getElementById('app').innerHTML = `
      <div class="game-page">
        <div class="game-header">
          <div class="game-title">🗳️ من السارق؟</div>
          <div class="timer" id="timer">${Math.ceil(timeRemaining)}s</div>
        </div>

        <div class="game-content">
          <div class="voting-container">
            <div class="voting-label">صوت لمن تعتقد أنه السارق</div>
            <div class="voting-options" id="votingOptions">
              ${votingOptionsHtml}
            </div>
          </div>

          <div class="waiting-text" id="waitingText" style="display: none;">في انتظار الآخرين...</div>
        </div>
      </div>
    `;

    // Timer countdown
    const timerInterval = setInterval(() => {
      timeRemaining--;
      const timerEl = document.getElementById('timer');
      if (timerEl) {
        timerEl.textContent = `${Math.ceil(timeRemaining)}s`;
      }
      
      if (timeRemaining <= 0) {
        clearInterval(timerInterval);
        this.disableVoteSubmission();
      }
    }, 1000);
  }

  submitThiefVote(accusedPlayerId) {
    if (this.votedThief) return;

    this.ws.send(JSON.stringify({
      action: 'submitThiefVote',
      accusedPlayerId: accusedPlayerId
    }));
  }

  disableVoteSubmission() {
    const voteOptions = document.querySelectorAll('.vote-option');
    const waitingText = document.getElementById('waitingText');

    voteOptions.forEach(option => {
      option.disabled = true;
    });
    if (waitingText) waitingText.style.display = 'block';
  }

  showRoundResults(message) {
    const resultsHtml = message.playerResults.map(result => `
      <div class="result-item ${result.hitBomb ? 'bomb' : 'survived'}">
        <div class="result-player-name">${result.playerName}</div>
        <div class="result-answer">${result.answer}</div>
        <div class="result-status">${result.hitBomb ? '💥 اصابت الكلمة' : '✅ نجت'}</div>
        <div class="result-points">+${result.pointsGained}</div>
      </div>
    `).join('');

    const scoresHtml = message.scores.map(score => `
      <div class="score-item">
        <span class="score-name">${score.playerName}</span>
        <span class="score-value">${score.totalScore}</span>
      </div>
    `).join('');

    document.getElementById('app').innerHTML = `
      <div class="results-page">
        <div class="results-header">
          <h2>النتائج</h2>
        </div>

        <div class="results-content">
          <div class="reveal-section">
            <div class="reveal-label">الكلمة المفخخة:</div>
            <div class="reveal-word">${message.bombWord}</div>
          </div>

          <div class="results-list">
            <div class="section-title">تفاصيل اللعبة</div>
            ${resultsHtml}
          </div>

          <div class="scores-section">
            <div class="section-title">الرتب</div>
            ${scoresHtml}
          </div>

          ${this.isHost ? `
            <button class="btn-primary" onclick="game.startNewRound()">جولة جديدة 🔄</button>
          ` : '<p style="color: var(--text-muted); text-align: center; margin-top: 20px;">في انتظار اختيار المضيف للجولة القادمة...</p>'}
        </div>
      </div>
    `;
  }

  showThiefRoundResults(message) {
    const {
      accusedPlayerName,
      thiefName,
      thiefCaught,
      mystery,
      votes,
      scores,
      correctVoters
    } = message;

    const resultStatus = thiefCaught 
      ? `✅ تم اكتشاف السارق! "${thiefName}" كان السارق`
      : `❌ نجا السارق! "${thiefName}" كان السارق`;

    const votesHtml = votes.map(vote => {
      const isCorrect = correctVoters.includes(vote.voterId);
      return `
        <div class="vote-result ${isCorrect ? 'correct' : 'incorrect'}">
          <span class="voter-name">${vote.voterName}</span>
          <span class="arrow">→</span>
          <span class="accused-name">${vote.accusedName}</span>
          <span class="status">${isCorrect ? '✅' : '❌'}</span>
        </div>
      `;
    }).join('');

    const scoresHtml = scores.map(score => `
      <div class="score-item">
        <span class="score-name">${score.playerName}</span>
        <span class="score-value">${score.totalScore}</span>
      </div>
    `).join('');

    document.getElementById('app').innerHTML = `
      <div class="results-page">
        <div class="results-header">
          <h2>النتائج - جولة من سرقها؟</h2>
        </div>

        <div class="results-content">
          <div class="reveal-section">
            <div class="reveal-label">الحدث:</div>
            <div class="reveal-event">${mystery.event}</div>
          </div>

          <div class="thief-result">
            <div class="thief-status">${resultStatus}</div>
            <div class="accused-info">اتهم اللاعبون: <strong>${accusedPlayerName}</strong></div>
          </div>

          <div class="results-list">
            <div class="section-title">الأصوات</div>
            ${votesHtml}
          </div>

          <div class="scores-section">
            <div class="section-title">الرتب</div>
            ${scoresHtml}
          </div>

          ${this.isHost ? `
            <button class="btn-primary" onclick="game.startNewThiefRound()">جولة جديدة 🔄</button>
          ` : '<p style="color: var(--text-muted); text-align: center; margin-top: 20px;">في انتظار اختيار المضيف للجولة القادمة...</p>'}
        </div>
      </div>
    `;
  }

  startNewRound() {
    if (!this.isHost) return;
    this.submittedAnswer = false;
    this.votedThief = false;
    this.selectedGame = null;
    this.showRoomPage();
  }

  startNewThiefRound() {
    if (!this.isHost) return;
    this.votedThief = false;

    this.ws.send(JSON.stringify({
      action: 'startNewThiefRound'
    }));
  }

  showError(message) {
    alert(message);
  }
}

const game = new LegacyParty();
