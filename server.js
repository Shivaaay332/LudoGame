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

function getOppositeColor(c) {
    if(c === 'blue') return 'green';
    if(c === 'green') return 'blue';
    if(c === 'red') return 'yellow';
    if(c === 'yellow') return 'red';
    return 'green';
}

io.on('connection', (socket) => {

    socket.on('joinRoom', (data) => {
        let roomId = data.id;
        let playerName = data.name || 'Player';

        if (!roomId || typeof roomId !== 'string') return;
        
        if (!rooms[roomId]) {
            rooms[roomId] = { 
                players: [], host: socket.id, status: 'waiting',
                activeColors: [], rollStats: {}, turnColor: '', pendingRequests: {} 
            };
        }
        
        let room = rooms[roomId];

        if (room.players.some(p => p.id === socket.id)) {
            let pIndex = room.players.findIndex(p => p.id === socket.id);
            socket.emit('joined', { color: room.players[pIndex].color, roomId: roomId, isHost: room.host === socket.id, name: room.players[pIndex].name });
            // ✨ FIX: Now sending hostId to keep everyone perfectly synced
            io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.host });
            return;
        }

        let availableColors = assignmentOrder.filter(c => !room.players.some(p => p.color === c));
        if (availableColors.length === 0) return socket.emit('errorMsg', 'Room is full!');

        if (room.status === 'playing') {
            socket.emit('waitingForHostApproval');
            room.pendingRequests[socket.id] = playerName;
            io.to(room.host).emit('joinRequest', { requesterId: socket.id, requesterName: playerName });
            return;
        }

        let assignedColor = availableColors[0];
        room.players.push({ id: socket.id, color: assignedColor, online: true, name: playerName });
        
        socket.join(roomId);
        socket.emit('joined', { color: assignedColor, roomId: roomId, isHost: room.host === socket.id, name: playerName });
        io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.host });
    });

    socket.on('handleJoinRequest', (data) => {
        let room = rooms[data.roomId];
        if(!room || room.host !== socket.id) return;
        
        let reqSocket = io.sockets.sockets.get(data.requesterId);
        if(!reqSocket) return;

        if (data.accepted && room.players.length < 4) {
            let availableColors = assignmentOrder.filter(c => !room.players.some(p => p.color === c));
            let assignedColor = availableColors[0];
            let reqName = room.pendingRequests[data.requesterId] || 'Player';
            
            room.players.push({ id: data.requesterId, color: assignedColor, online: true, name: reqName });
            delete room.pendingRequests[data.requesterId];
            
            room.activeColors = room.players.map(p => p.color);
            room.activeColors.sort((a, b) => turnOrder.indexOf(a) - turnOrder.indexOf(b));
            
            room.rollStats[assignedColor] = { count: 0, target: Math.floor(Math.random()*3)+4 };
            
            reqSocket.join(data.roomId);
            reqSocket.emit('joined', { color: assignedColor, roomId: data.roomId, isHost: false, name: reqName });
            
            io.to(data.roomId).emit('updatePlayers', { players: room.players, hostId: room.host });
            io.to(data.roomId).emit('midGameJoin', { 
                activeColors: room.activeColors, 
                newColor: assignedColor, 
                turnColor: room.turnColor,
                gameState: data.currentGameState 
            });
        } else {
            reqSocket.emit('errorMsg', 'Host rejected your request or room is full.');
            if(room.pendingRequests[data.requesterId]) delete room.pendingRequests[data.requesterId];
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
                
                if (room.players.length === 2 && room.status === 'playing') {
                    let hostP = room.players.find(p => p.id === room.host);
                    let oppP = room.players.find(p => p.id !== room.host);
                    
                    if (hostP && oppP) {
                        let targetOppositeColor = getOppositeColor(hostP.color);
                        if (oppP.color !== targetOppositeColor) {
                            let oldColor = oppP.color;
                            oppP.color = targetOppositeColor;
                            
                            room.rollStats[targetOppositeColor] = room.rollStats[oldColor];
                            delete room.rollStats[oldColor];
                            if(room.turnColor === oldColor) room.turnColor = targetOppositeColor;
                            
                            io.to(data.roomId).emit('migrateColor', { oldColor: oldColor, newColor: targetOppositeColor });
                        }
                    }
                }

                room.activeColors = room.players.map(p => p.color);
                room.activeColors.sort((a, b) => turnOrder.indexOf(a) - turnOrder.indexOf(b));
                
                let targetSocket = io.sockets.sockets.get(data.targetId);
                if(targetSocket) {
                    targetSocket.emit('kickedOut');
                    targetSocket.leave(data.roomId);
                }
                
                io.to(data.roomId).emit('updatePlayers', { players: room.players, hostId: room.host });
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
            room.activeColors.forEach(c => { room.rollStats[c] = { count: 0, target: Math.floor(Math.random() * 3) + 4 }; });
            io.to(roomId).emit('gameStarted', { activeColors: room.activeColors, turnColor: room.turnColor });
        }
    });

    socket.on('restartGame', (roomId) => {
        let room = rooms[roomId];
        if(room && room.host === socket.id) {
            room.turnColor = room.activeColors[0];
            room.activeColors.forEach(c => { room.rollStats[c] = { count: 0, target: Math.floor(Math.random() * 3) + 4 }; });
            io.to(roomId).emit('gameRestarted', { activeColors: room.activeColors, turnColor: room.turnColor });
        }
    });

    socket.on('rollDice', (data) => {
        let room = rooms[data.roomId];
        if(!room || room.turnColor !== data.color) return;

        if (!room.rollStats[data.color]) room.rollStats[data.color] = { count: 0, target: 4 };

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

    socket.on('moveToken', (data) => { io.to(data.roomId).emit('tokenMoved', { color: data.color, idx: data.idx, roll: data.roll }); });

    socket.on('passTurn', (data) => {
        let room = rooms[data.roomId];
        if(room && room.status === 'playing' && room.activeColors.length > 0) {
            let idx = room.activeColors.indexOf(room.turnColor);
            room.turnColor = room.activeColors[(idx + 1) % room.activeColors.length];
            io.to(data.roomId).emit('turnChanged', { color: room.turnColor });
        }
    });

    socket.on('sendInteraction', (data) => { io.to(data.roomId).emit('showInteraction', { color: data.color, type: data.type, content: data.content }); });

    socket.on('disconnect', () => {
        for (let roomId in rooms) {
            let room = rooms[roomId];
            if(room.pendingRequests && room.pendingRequests[socket.id]) delete room.pendingRequests[socket.id];

            let pIndex = room.players.findIndex(p => p.id === socket.id);
            if (pIndex !== -1) {
                room.players[pIndex].online = false;
                io.to(roomId).emit('playerStatus', { color: room.players[pIndex].color, status: 'offline' });
                
                // ✨ HOST MIGRATION LOGIC ✨
                if (room.players.every(p => !p.online)) {
                    delete rooms[roomId]; // Room totally empty, destroy it
                } else if (room.host === socket.id) {
                    // Find the oldest player who is still online
                    let newHost = room.players.find(p => p.online);
                    if(newHost) {
                        room.host = newHost.id; // Assign new host
                        // Broadcast the update so the new host gets their powers instantly!
                        io.to(roomId).emit('updatePlayers', { players: room.players, hostId: room.host });
                    }
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => { console.log(`Server running on port ${PORT}`); });
