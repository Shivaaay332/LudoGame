const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public')); // public folder serve karega

const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('joinRoom', (roomId) => {
        if (!rooms[roomId]) {
            rooms[roomId] = { players: [], turnIdx: 0, colors: ['blue', 'red', 'green', 'yellow'] };
        }
        
        let room = rooms[roomId];
        if (room.players.length >= 4) {
            socket.emit('errorMsg', 'Room is full!');
            return;
        }

        // Assign color based on joining order
        let assignedColor = room.colors[room.players.length];
        room.players.push({ id: socket.id, color: assignedColor });
        
        socket.join(roomId);
        socket.emit('joined', { color: assignedColor, roomId: roomId });
        
        // Notify everyone in room about players
        io.to(roomId).emit('updatePlayers', room.players.map(p => p.color));
    });

    // Handle Dice Roll
    socket.on('rollDice', (data) => {
        // Generate random roll on server to prevent cheating
        let roll = Math.floor(Math.random() * 6) + 1;
        io.to(data.roomId).emit('diceRolled', { color: data.color, roll: roll });
    });

    // Handle Token Move
    socket.on('moveToken', (data) => {
        io.to(data.roomId).emit('tokenMoved', { color: data.color, idx: data.idx });
    });

    // Handle Turn Change
    socket.on('passTurn', (data) => {
        io.to(data.roomId).emit('turnChanged');
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
        // Handle player leaving (Complex logic skipped for brevity)
    });
});

server.listen(3000, '0.0.0.0', () => {
    console.log('Ludo Server running on http://localhost:3000');
});