const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

// Configure middleware
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database setup
const db = new sqlite3.Database('clue.db', (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Conectado ao banco de dados SQLite.');
});

// Create users table
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// After the existing users table creation
// In the database initialization section
db.run(`CREATE TABLE IF NOT EXISTS game_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    suspect TEXT,
    weapon TEXT,
    location TEXT,
    solved INTEGER DEFAULT 0,
    user_name TEXT DEFAULT 'Detetive',
    game_number TEXT,
    user_id INTEGER,
    game_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
)`);

// Create games table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_number TEXT NOT NULL,
    user_id INTEGER,
    suspects TEXT NOT NULL,
    weapons TEXT NOT NULL,
    locations TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
)`);

// Add the history route
app.get('/historico', (req, res) => {
    // Get all saved games
    db.all(`SELECT * FROM games ORDER BY updated_at DESC`, [], (err, savedGames) => {
        if (err) {
            console.error('Error fetching saved games:', err);
            return res.render('historico', { 
                cases: [], 
                savedGames: [],
                error: 'Erro ao carregar histórico' 
            });
        }
        
        // Get solved cases history
        db.all(`SELECT game_history.*, users.username 
                FROM game_history 
                LEFT JOIN users ON game_history.user_id = users.id 
                ORDER BY game_date DESC`, [], (err, cases) => {
            if (err) {
                console.error('Error fetching game history:', err);
                return res.render('historico', { 
                    cases: [], 
                    savedGames: savedGames,
                    error: 'Erro ao carregar histórico de casos' 
                });
            }
            
            // Parse the JSON strings for each saved game
            const processedGames = savedGames.map(game => {
                try {
                    return {
                        ...game,
                        suspects: JSON.parse(game.suspects),
                        weapons: JSON.parse(game.weapons),
                        locations: JSON.parse(game.locations),
                        formattedDate: new Date(game.updated_at).toLocaleDateString('pt-BR')
                    };
                } catch (e) {
                    console.error('Error parsing game data:', e);
                    return game;
                }
            });
            
            res.render('historico', { 
                cases: cases, 
                savedGames: processedGames,
                error: null 
            });
        });
    });
});

// Routes
app.get('/', (req, res) => {
    res.render('index');
});

// Login routes
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, 
        [username, password], 
        (err, user) => {
            if (err) {
                return res.render('login', { error: 'Ocorreu um erro ao fazer login' });
            }
            
            if (!user) {
                return res.render('login', { error: 'Usuário ou senha inválidos' });
            }
            
            res.redirect('/welcome');
        });
});

app.get('/welcome', (req, res) => {
    res.render('welcome');
});

// New Game routes
app.get('/nova-investigacao', (req, res) => {
    res.render('nova-investigacao');
});

// Add this after your nova-investigacao route
app.get('/partida', (req, res) => {
    const gameNumber = req.query.game;
    
    if (gameNumber) {
        // Load existing game
        db.get(`SELECT * FROM games WHERE game_number = ?`, [gameNumber], (err, game) => {
            if (err || !game) {
                console.error('Error loading game:', err);
                return res.render('partida', { gameData: null });
            }
            
            try {
                const gameData = {
                    gameNumber: game.game_number,
                    suspects: JSON.parse(game.suspects),
                    weapons: JSON.parse(game.weapons),
                    locations: JSON.parse(game.locations)
                };
                
                return res.render('partida', { gameData: gameData });
            } catch (e) {
                console.error('Error parsing game data:', e);
                return res.render('partida', { gameData: null });
            }
        });
    } else {
        // New game - get the highest game number and add 1
        db.get(`SELECT MAX(CAST(game_number AS INTEGER)) as maxGameNumber FROM games`, [], (err, result) => {
            let nextGameNumber = 1;
            
            if (!err && result && result.maxGameNumber) {
                nextGameNumber = parseInt(result.maxGameNumber) + 1;
            }
            
            // Create a new empty game data object with the next game number
            const gameData = {
                gameNumber: nextGameNumber.toString(),
                suspects: [],
                weapons: [],
                locations: []
            };
            
            res.render('partida', { gameData: gameData });
        });
    }
});

// Add this route to handle saving game state
app.post('/save-game', (req, res) => {
    try {
        const gameData = req.body;
        
        // Validate the data
        if (!gameData.gameNumber || !gameData.suspects || !gameData.weapons || !gameData.locations) {
            return res.status(400).json({ success: false, message: 'Dados incompletos' });
        }
        
        // Create games table if it doesn't exist
        db.run(`CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_number TEXT NOT NULL,
            suspects TEXT NOT NULL,
            weapons TEXT NOT NULL,
            locations TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, function(err) {
            if (err) {
                console.error('Error creating games table:', err);
                return res.status(500).json({ success: false, message: 'Erro ao criar tabela de jogos' });
            }
            
            // Check if a game with this number already exists
            db.get(`SELECT * FROM games WHERE game_number = ?`, [gameData.gameNumber], function(err, existingGame) {
                if (err) {
                    console.error('Error checking for existing game:', err);
                    return res.status(500).json({ success: false, message: 'Erro ao verificar jogo existente' });
                }
                
                const now = new Date().toISOString();
                
                if (existingGame) {
                    // Update existing game
                    db.run(`UPDATE games SET 
                        suspects = ?, 
                        weapons = ?, 
                        locations = ?, 
                        updated_at = ?
                        WHERE game_number = ?`, 
                        [
                            JSON.stringify(gameData.suspects), 
                            JSON.stringify(gameData.weapons), 
                            JSON.stringify(gameData.locations), 
                            now,
                            gameData.gameNumber
                        ], 
                        function(err) {
                            if (err) {
                                console.error('Error updating game:', err);
                                return res.status(500).json({ success: false, message: 'Erro ao atualizar jogo' });
                            }
                            
                            res.json({ success: true, message: 'Investigação atualizada com sucesso' });
                        }
                    );
                } else {
                    // Create new game
                    db.run(`INSERT INTO games (game_number, suspects, weapons, locations, created_at, updated_at) 
                        VALUES (?, ?, ?, ?, ?, ?)`, 
                        [
                            gameData.gameNumber,
                            JSON.stringify(gameData.suspects), 
                            JSON.stringify(gameData.weapons), 
                            JSON.stringify(gameData.locations), 
                            now, 
                            now
                        ], 
                        function(err) {
                            if (err) {
                                console.error('Error creating new game:', err);
                                return res.status(500).json({ success: false, message: 'Erro ao criar novo jogo' });
                            }
                            
                            res.json({ success: true, message: 'Investigação salva com sucesso' });
                        }
                    );
                }
            });
        });
    } catch (error) {
        console.error('Error saving game:', error);
        res.status(500).json({ success: false, message: 'Erro ao salvar a investigação' });
    }
});

// Add this route to handle deleting a game
app.delete('/delete-game/:gameNumber', (req, res) => {
    const gameNumber = req.params.gameNumber;
    
    // Validate the game number
    if (!gameNumber) {
        return res.status(400).json({ success: false, message: 'Número de jogo inválido' });
    }
    
    // Delete the game from the database
    db.run(`DELETE FROM games WHERE game_number = ?`, [gameNumber], function(err) {
        if (err) {
            console.error('Error deleting game:', err);
            return res.status(500).json({ success: false, message: 'Erro ao excluir jogo' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ success: false, message: 'Jogo não encontrado' });
        }
        
        res.json({ success: true, message: 'Investigação excluída com sucesso' });
    });
});
// Add this route to handle solving a case
app.post('/solve-case', (req, res) => {
    try {
        const { gameNumber, suspect, weapon, location, userName } = req.body;
        
        // Validate the data
        if (!gameNumber || !suspect || !weapon || !location) {
            return res.status(400).json({ success: false, message: 'Dados incompletos' });
        }
        
        // First, add the case to game_history
        db.run(`INSERT INTO game_history (suspect, weapon, location, solved, user_name) 
                VALUES (?, ?, ?, 1, ?)`, 
                [suspect, weapon, location, userName || 'Detetive'], 
                function(err) {
                    if (err) {
                        console.error('Error adding to game history:', err);
                        return res.status(500).json({ success: false, message: 'Erro ao registrar caso resolvido' });
                    }
                    
                    // Then, delete the game from ongoing investigations
                    db.run(`DELETE FROM games WHERE game_number = ?`, [gameNumber], function(err) {
                        if (err) {
                            console.error('Error deleting solved game:', err);
                            return res.status(500).json({ success: false, message: 'Erro ao finalizar investigação' });
                        }
                        
                        res.json({ success: true, message: 'Caso resolvido com sucesso!' });
                    });
                });
    } catch (error) {
        console.error('Error solving case:', error);
        res.status(500).json({ success: false, message: 'Erro ao resolver o caso' });
    }
});
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});