const room = new WebsimSocket();

function TicTacToe() {
  const [gameState, setGameState] = React.useState(null);
  const [scores, setScores] = React.useState({});
  const peers = React.useSyncExternalStore(
    room.party.subscribe,
    () => room.party.peers
  );

  // Get and sync scores from database
  const scoreRecords = React.useSyncExternalStore(
    room.collection('scores').subscribe,
    room.collection('scores').getList
  );

  React.useEffect(() => {
    const newScores = {};
    scoreRecords.forEach(record => {
      newScores[record.username] = record.score;
    });
    setScores(newScores);
  }, [scoreRecords]);

  // Initialize score for new player if needed
  React.useEffect(() => {
    const initializeScore = async () => {
      const existingScore = scoreRecords.find(
        record => record.username === room.party.client.username
      );
      if (!existingScore) {
        await room.collection('scores').create({
          username: room.party.client.username,
          score: 100
        });
      }
    };
    initializeScore();
  }, []);

  // Handle game events
  React.useEffect(() => {
    room.onmessage = (event) => {
      const { type, ...data } = event.data;
      
      switch (type) {
        case 'gameState':
          setGameState(data.state);
          break;
        case 'gameOver':
          handleGameOver(data);
          break;
      }
    };
  }, []);

  const handleGameOver = async (data) => {
    const { winner, loser } = data;
    if (!winner || !loser) return; // Handle tie case
    
    const winnerScore = scores[winner];
    const loserScore = scores[loser];
    
    // Only update scores if the difference isn't too large
    const scoreDiff = winnerScore - loserScore;
    if (scoreDiff < 50) {
      const winnerRecord = scoreRecords.find(r => r.username === winner);
      if (winnerRecord) {
        await room.collection('scores').update(winnerRecord.id, {
          score: winnerScore + 2
        });
      }
    }
    
    const loserRecord = scoreRecords.find(r => r.username === loser);
    if (loserRecord) {
      await room.collection('scores').update(loserRecord.id, {
        score: loserScore - 1
      });
    }
    
    // Clear game state after a short delay
    setTimeout(() => {
      setGameState(null);
    }, 2000);
  };

  const makeMove = (index) => {
    if (!gameState || gameState.board[index] || gameState.winner) return;
    if (gameState.currentPlayer !== room.party.client.username) return;
    
    room.send({
      type: 'move',
      index,
      gameState // Include current game state with the move
    });
  };

  // Auto-match players
  React.useEffect(() => {
    if (gameState) return; // Don't match if already in a game

    const peerList = Object.values(peers);
    if (peerList.length < 2) return; // Need at least 2 players

    // Get current games to check who's already playing
    const activePlayers = new Set();
    peerList.forEach(peer => {
      if (peer.gameState) {
        activePlayers.add(peer.username);
      }
    });

    // Find available players (not in a game)
    const availablePlayers = peerList
      .filter(peer => !activePlayers.has(peer.username))
      .map(peer => peer.username)
      .sort(); // Sort for consistent matching

    if (availablePlayers.length >= 2) {
      // Match first two available players
      const player1 = availablePlayers[0];
      const player2 = availablePlayers[1];

      // Only the first player initiates the game
      if (room.party.client.username === player1) {
        const initialState = {
          board: Array(9).fill(null),
          players: [player1, player2],
          currentPlayer: player1,
          winner: null,
          tie: false
        };

        room.send({
          type: 'gameState',
          state: initialState
        });
      }
    }
  }, [peers, gameState]);

  if (!gameState) {
    return (
      <div className="container">
        <div className="lobby">
          <h2>Waiting for opponent...</h2>
          <div className="scores">
            <h3>Current Scores:</h3>
            {Object.entries(scores)
              .sort(([,a], [,b]) => b - a)
              .map(([username, score]) => (
                <div key={username} className="player">
                  <img 
                    className="avatar" 
                    src={`https://images.websim.ai/avatar/${username}`}
                    alt={username}
                  />
                  <span>{username}: {score}</span>
                </div>
              ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="scores">
        {gameState.players.map(player => (
          <div key={player} className="player">
            <img 
              className="avatar" 
              src={`https://images.websim.ai/avatar/${player}`}
              alt={player}
            />
            <span>
              {player} ({scores[player] || 0})
              {gameState.currentPlayer === player ? " (Current Turn)" : ""}
            </span>
          </div>
        ))}
      </div>
      
      <div className="game-board">
        {gameState.board.map((cell, index) => (
          <button
            key={index}
            className="cell"
            onClick={() => makeMove(index)}
            disabled={gameState.currentPlayer !== room.party.client.username}
          >
            {cell}
          </button>
        ))}
      </div>

      {gameState.winner && (
        <div className="status">
          Winner: {gameState.winner}!
        </div>
      )}
      
      {gameState.tie && (
        <div className="status">
          Game ended in a tie!
        </div>
      )}
    </div>
  );
}

// Game logic
room.onmessage = (event) => {
  const { type, ...data } = event.data;
  
  switch (type) {
    case 'move':
      if (!data.gameState) break;
      
      const newBoard = [...data.gameState.board];
      newBoard[data.index] = data.gameState.currentPlayer === data.gameState.players[0] ? 'X' : 'O';
      
      const winner = calculateWinner(newBoard, data.gameState);
      const tie = !winner && newBoard.every(cell => cell);
      
      const newState = {
        ...data.gameState,
        board: newBoard,
        currentPlayer: data.gameState.currentPlayer === data.gameState.players[0] 
          ? data.gameState.players[1] 
          : data.gameState.players[0],
        winner: winner,
        tie: tie
      };
      
      room.send({
        type: 'gameState',
        state: newState
      });
      
      if (winner || tie) {
        room.send({
          type: 'gameOver',
          winner: winner,
          loser: winner ? data.gameState.players.find(p => p !== winner) : null
        });
      }
      break;
  }
};

function calculateWinner(board, gameState) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a] === 'X' ? gameState.players[0] : gameState.players[1];
    }
  }
  
  return null;
}

ReactDOM.render(<TicTacToe />, document.getElementById('root'));