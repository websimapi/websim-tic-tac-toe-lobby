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
  };

  const makeMove = (index) => {
    if (!gameState || gameState.board[index] || gameState.winner) return;
    if (gameState.currentPlayer !== room.party.client.username) return;
    
    room.send({
      type: 'move',
      index
    });
  };

  // Auto-match players
  React.useEffect(() => {
    // Convert peers object to array and filter out already matched players
    const availablePeers = Object.values(peers).filter(peer => {
      // Check if peer is not already in a game
      return !gameState?.players.includes(peer.username);
    });
    
    if (availablePeers.length >= 2 && !gameState) {
      // Sort peers by username to ensure consistent matching across all clients
      const sortedPeers = availablePeers.sort((a, b) => 
        a.username.localeCompare(b.username)
      );
      
      // Match pairs of players
      for (let i = 0; i < sortedPeers.length - 1; i += 2) {
        const player1 = sortedPeers[i].username;
        const player2 = sortedPeers[i + 1].username;
        
        // Only the first player initiates the game to avoid duplicate games
        if (room.party.client.username === player1) {
          room.send({
            type: 'startGame',
            players: [player1, player2]
          });
        }
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
              .sort(([,a], [,b]) => b - a) // Sort by score descending
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
    case 'startGame':
      const initialState = {
        board: Array(9).fill(null),
        players: data.players,
        currentPlayer: data.players[0],
        winner: null,
        tie: false
      };
      
      room.send({
        type: 'gameState',
        state: initialState
      });
      break;
      
    case 'move':
      const gameState = event.gameState;
      if (!gameState) break;
      
      const newBoard = [...gameState.board];
      newBoard[data.index] = gameState.currentPlayer === gameState.players[0] ? 'X' : 'O';
      
      const winner = calculateWinner(newBoard, gameState);
      const tie = !winner && newBoard.every(cell => cell);
      
      const newState = {
        ...gameState,
        board: newBoard,
        currentPlayer: gameState.currentPlayer === gameState.players[0] 
          ? gameState.players[1] 
          : gameState.players[0],
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
          loser: winner ? gameState.players.find(p => p !== winner) : null
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