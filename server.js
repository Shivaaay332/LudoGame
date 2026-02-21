const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public')); 

const rooms = {};

const assignmentOrder = ['blue', 'green', 'red', 'yellow'];
const turnOrder = ['blue', 'red', 'green', 'yellow'];

io.on('connection', (socket) => {

    socket.on('joinRoom', (data) => {
        let roomId = data.id;
        let playerName = data.name || 'Player';

        if (!roomId || typeof roomId !== 'string') return;
        
        if (!rooms[roomId]) {
            rooms[roomId] = { 
                players: [], host: socket.id, status: 'waiting',
                activeColors: [], rollStats: {}, turnColor: ''
            };
        }
        
        let room = rooms[roomId];

        if (room.players.some(p => p.id === socket.id)) {
            let pIndex = room.players.findIndex(p => p.id === socket.id);
            socket.emit('joined', { color: room.players[pIndex].color, roomId: roomId, isHost: room.host === socket.id, name: room.players[pIndex].name });
            io.to(roomId).emit('updatePlayers', room.players);
            return;
        }

        let availableColors = assignmentOrder.filter(c => !room.players.some(p => p.color === c));
        if (availableColors.length === 0) return socket.emit('errorMsg', 'Room is full!');

        if (room.status === 'playing') {
            socket.emit('waitingForHostApproval');
            io.to(room.host).emit('joinRequest', { requesterId: socket.id, requesterName: playerName });
            return;
        }

        let assignedColor = availableColors[0];
        room.players.push({ id: socket.id, color: assignedColor, online: true, name: playerName });
        
        socket.join(roomId);
        socket.emit('joined', { color: assignedColor, roomId: roomId, isHost: room.host === socket.id, name: playerName });
        io.to(roomId).emit('updatePlayers', room.players);
    });

    socket.on('handleJoinRequest', (data) => {
        let room = rooms[data.roomId];
        if(!room || room.host !== socket.id) return;
        
        let reqSocket = io.sockets.sockets.get(data.requesterId);
        if(!reqSocket) return;

        if (data.accepted && room.players.length < 4) {
            let availableColors = assignmentOrder.filter(c => !room.players.some(p => p.color === c));
            let assignedColor = availableColors[0];
            
            room.players.push({ id: data.requesterId, color: assignedColor, online: true, name: data.requesterName });
            
            room.activeColors = room.players.map(p => p.color);
            room.activeColors.sort((a, b) => turnOrder.indexOf(a) - turnOrder.indexOf(b));
            
            room.rollStats[assignedColor] = { count: 0, target: Math.floor(Math.random()*3)+4 };
            
            reqSocket.join(data.roomId);
            reqSocket.emit('joined', { color: assignedColor, roomId: data.roomId, isHost: false, name: data.requesterName });
            
            io.to(data.roomId).emit('updatePlayers', room.players);
            io.to(data.roomId).emit('midGameJoin', { 
                activeColors: room.activeColors, 
                newColor: assignedColor, 
                turnColor: room.turnColor,
                gameState: data.currentGameState 
            });
        } else {
            reqSocket.emit('errorMsg', 'Host rejected your request or room is full.');
        }
    });

    socket.on('kickPlayer', (data) => {
        let room = rooms[data.roomId];
        if(room && room.host === socket.id) {
            let pIndex = room.players.findIndex(p => p.id === data.targetId);
            if(pIndex !== -1) {
                let kickedColor = room.players[pIndex].color;
                
                if (room.status === 'playing' && room.turnColor === kickedColor && room.activeColors.length > 1) {
                    let currentTurnIdx = room.activeColors.indexOf(kickedColor);
                    let nextTurnIdx = (currentTurnIdx + 1) % room.activeColors.length;
                    room.turnColor = room.activeColors[nextTurnIdx];
                    io.to(data.roomId).emit('turnChanged', { color: room.turnColor });
                }

                room.players.splice(pIndex, 1);
                room.activeColors = room.players.map(p => p.color);
                room.activeColors.sort((a, b) => turnOrder.indexOf(a) - turnOrder.indexOf(b));
                
                let targetSocket = io.sockets.sockets.get(data.targetId);
                if(targetSocket) {
                    targetSocket.emit('kickedOut');
                    targetSocket.leave(data.roomId);
                }
                
                io.to(data.roomId).emit('updatePlayers', room.players);
                io.to(data.roomId).emit('playerKicked', { color: kickedColor, activeColors: room.activeColors });

                if (room.players.length === 0) delete rooms[data.roomId];
            }
        }
    });

    socket.on('startGame', (roomId) => {
        let room = rooms[roomId];
        if(room && room.host === socket.id && room.players.length > 0) {
            room.status = 'playing';
            room.activeColors = room.players.map(p => p.color);
            room.activeColors.sort((a, b) => turnOrder.indexOf(a) - turnOrder.indexOf(b));
            
            room.turnColor = room.activeColors[0]; 
            room.activeColors.forEach(c => {
                room.rollStats[c] = { count: 0, target: Math.floor(Math.random() * 3) + 4 };
            });
            io.to(roomId).emit('gameStarted', { activeColors: room.activeColors, turnColor: room.turnColor });
        }
    });

    socket.on('restartGame', (roomId) => {
        let room = rooms[roomId];
        if(room && room.host === socket.id) {
            room.turnColor = room.activeColors[0];
            room.activeColors.forEach(c => {
                room.rollStats[c] = { count: 0, target: Math.floor(Math.random() * 3) + 4 };
            });
            io.to(roomId).emit('gameRestarted', { activeColors: room.activeColors, turnColor: room.turnColor });
        }
    });

    socket.on('rollDice', (data) => {
        let room = rooms[data.roomId];
        if(!room || room.turnColor !== data.color) return;

        // ANTI-FREEZE BACKEND FIX: Agar stats null ho toh turant naya bana do
        if (!room.rollStats[data.color]) {
            room.rollStats[data.color] = { count: 0, target: Math.floor(Math.random() * 3) + 4 };
        }

        let stats = room.rollStats[data.color];
        stats.count++;
        let roll = Math.floor(Math.random() * 6) + 1;
        
        if (stats.count >= stats.target) roll = 6;
        
        if (roll === 6) {
            stats.count = 0;
            stats.target = Math.floor(Math.random() * 3) + 4;
        }
        
        io.to(data.roomId).emit('diceRolled', { color: data.color, roll: roll });
    });

    socket.on('moveToken', (data) => {
        io.to(data.roomId).emit('tokenMoved', { color: data.color, idx: data.idx });
    });

    socket.on('passTurn', (data) => {
        let room = rooms[data.roomId];
        if(room && room.status === 'playing' && room.activeColors.length > 0) {
            let idx = room.activeColors.indexOf(room.turnColor);
            room.turnColor = room.activeColors[(idx + 1) % room.activeColors.length];
            io.to(data.roomId).emit('turnChanged', { color: room.turnColor });
        }
    });

    socket.on('sendInteraction', (data) => {
        io.to(data.roomId).emit('showInteraction', { color: data.color, type: data.type, content: data.content });
    });

    socket.on('disconnect', () => {
        for (let roomId in rooms) {
            let room = rooms[roomId];
            let pIndex = room.players.findIndex(p => p.id === socket.id);
            
            if (pIndex !== -1) {
                room.players[pIndex].online = false;
                io.to(roomId).emit('playerStatus', { color: room.players[pIndex].color, status: 'offline' });
                
                if (room.players.every(p => !p.online)) {
                    delete rooms[roomId];
                } else if (room.host === socket.id) {
                    let newHost = room.players.find(p => p.online);
                    if(newHost) {
                        room.host = newHost.id;
                        io.to(roomId).emit('updatePlayers', room.players);
                    }
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
