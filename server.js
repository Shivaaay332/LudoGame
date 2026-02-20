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
        if (!roomId || typeof roomId !== 'string') return;
        
        if (!rooms[roomId]) {
            // ORDER: Blue, Green, Red, Yellow
            rooms[roomId] = { 
                players: [], host: socket.id, status: 'waiting',
                colors: ['blue', 'green', 'red', 'yellow'],
                activeColors: [], rollStats: {} 
            };
        }
        
        let room = rooms[roomId];

        // Agar user already room me hai to dobara status bhej do (Freeze fix)
        let pIndex = room.players.findIndex(p => p.id === socket.id);
        if (pIndex !== -1) {
            socket.emit('joined', { color: room.players[pIndex].color, roomId: roomId, isHost: room.host === socket.id });
            io.to(roomId).emit('updatePlayers', room.players);
            return;
        }

        if (room.status === 'playing') return socket.emit('errorMsg', 'Game already started!');
        
        let availableColors = room.colors.filter(c => !room.players.some(p => p.color === c));
        if (availableColors.length === 0) return socket.emit('errorMsg', 'Room is full!');

        let assignedColor = availableColors[0];
        room.players.push({ id: socket.id, color: assignedColor, online: true });
        
        socket.join(roomId);
        socket.emit('joined', { color: assignedColor, roomId: roomId, isHost: room.host === socket.id });
        io.to(roomId).emit('updatePlayers', room.players);
    });

    socket.on('startGame', (roomId) => {
        let room = rooms[roomId];
        if(room && room.host === socket.id && room.players.length > 0) {
            room.status = 'playing';
            room.activeColors = room.players.map(p => p.color);
            room.turnIdx = 0;
            room.activeColors.forEach(c => {
                room.rollStats[c] = { count: 0, target: Math.floor(Math.random() * 3) + 4 };
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
        if(stats) {
            stats.count++;
            let roll = Math.floor(Math.random() * 6) + 1;
            if (stats.count >= stats.target) roll = 6;
            if (roll === 6) {
                stats.count = 0;
                stats.target = Math.floor(Math.random() * 3) + 4;
            }
            io.to(data.roomId).emit('diceRolled', { color: data.color, roll: roll });
        }
    });

    socket.on('moveToken', (data) => {
        io.to(data.roomId).emit('tokenMoved', { color: data.color, idx: data.idx });
    });

    socket.on('passTurn', (data) => {
        io.to(data.roomId).emit('turnChanged');
    });

    socket.on('disconnect', () => {
        for (let roomId in rooms) {
            let room = rooms[roomId];
            let pIndex = room.players.findIndex(p => p.id === socket.id);
            
            if (pIndex !== -1) {
                if (room.status === 'waiting') {
                    room.players.splice(pIndex, 1); // Remove player
                    
                    if (room.players.length === 0) {
                        delete rooms[roomId]; // Room free for reuse!
                    } else {
                        if (room.host === socket.id) room.host = room.players[0].id; // Assign new host
                        io.to(roomId).emit('updatePlayers', room.players);
                    }
                } else {
                    room.players[pIndex].online = false; // Mark offline
                    io.to(roomId).emit('playerStatus', { color: room.players[pIndex].color, status: 'offline' });
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
