const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public')); 

const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('joinRoom', (roomId) => {
        if (!rooms[roomId]) {
            rooms[roomId] = { 
                players: [], 
                host: socket.id, 
                status: 'waiting',
                colors: ['blue', 'green', 'red', 'yellow'],
                activeColors: [],
                rollStats: {} // For the "Forced 6" logic
            };
        }
        
        let room = rooms[roomId];
        if (room.status === 'playing') {
            return socket.emit('errorMsg', 'Game already started!');
        }
        if (room.players.length >= 4) {
            return socket.emit('errorMsg', 'Room is full!');
        }

        let assignedColor = room.colors[room.players.length];
        room.players.push({ id: socket.id, color: assignedColor });
        
        socket.join(roomId);
        socket.emit('joined', { color: assignedColor, roomId: roomId, isHost: room.host === socket.id });
        
        io.to(roomId).emit('updatePlayers', room.players.map(p => p.color));
    });

    socket.on('startGame', (roomId) => {
        let room = rooms[roomId];
        if(room && room.host === socket.id) {
            room.status = 'playing';
            room.activeColors = room.players.map(p => p.color);
            room.turnIdx = 0;
            
            // Initialize roll stats for forced 6
            room.activeColors.forEach(c => {
                room.rollStats[c] = {
                    count: 0,
                    target: Math.floor(Math.random() * 3) + 4 // Random target between 4 and 6
                };
            });

            io.to(roomId).emit('gameStarted', room.activeColors);
        }
    });

    socket.on('restartGame', (roomId) => {
        let room = rooms[roomId];
        if(room && room.host === socket.id) {
            room.turnIdx = 0;
            room.activeColors.forEach(c => {
                room.rollStats[c] = { count: 0, target: Math.floor(Math.random() * 3) + 4 };
            });
            io.to(roomId).emit('gameRestarted', room.activeColors);
        }
    });

    socket.on('rollDice', (data) => {
        let room = rooms[data.roomId];
        if(!room) return;

        let stats = room.rollStats[data.color];
        stats.count++; // Increase turn count for this player

        let roll = Math.floor(Math.random() * 6) + 1; // Normal random roll

        // IF forced turn reached, give them a 6!
        if (stats.count >= stats.target) {
            roll = 6;
        }

        // If they get a 6 (naturally or forced), reset their counter
        if (roll === 6) {
            stats.count = 0;
            stats.target = Math.floor(Math.random() * 3) + 4; // Set next target to 4, 5, or 6
        }

        io.to(data.roomId).emit('diceRolled', { color: data.color, roll: roll });
    });

    socket.on('moveToken', (data) => {
        io.to(data.roomId).emit('tokenMoved', { color: data.color, idx: data.idx });
    });

    socket.on('passTurn', (data) => {
        io.to(data.roomId).emit('turnChanged');
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
