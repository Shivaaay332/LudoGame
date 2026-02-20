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

    socket.on('rollDice', (data) => {
        let roll = Math.floor(Math.random() * 6) + 1;
        io.to(data.roomId).emit('diceRolled', { color: data.color, roll: roll });
    });

    socket.on('moveToken', (data) => {
        io.to(data.roomId).emit('tokenMoved', { color: data.color, idx: data.idx });
    });

    socket.on('passTurn', (data) => {
        io.to(data.roomId).emit('turnChanged');
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// ✨ YAHAN MAIN CHANGE KIYA HAI ✨
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
