const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// 数据库初始化
const db = new sqlite3.Database('./matches.db');

// 创建比赛记录表
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    room_id TEXT NOT NULL,
    room_name TEXT DEFAULT '未命名房间',
    blue_team TEXT NOT NULL,
    red_team TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now', '+8 hours'))
  )`);
  
  // 检查并添加room_name列（如果表已存在但没有该列）
  db.all("PRAGMA table_info(matches)", (err, rows) => {
    if (err) {
      console.error('检查表结构失败:', err);
      return;
    }
    
    const hasRoomName = rows.some(row => row.name === 'room_name');
    if (!hasRoomName) {
      db.run("ALTER TABLE matches ADD COLUMN room_name TEXT DEFAULT '未命名房间'", (err) => {
        if (err) {
          console.error('添加room_name列失败:', err);
        } else {
          console.log('已成功添加room_name列到matches表');
        }
      });
    }
  });
});

// 存储房间和玩家信息
const rooms = new Map();
const players = new Map();

// 英雄数据缓存
let championsData = null;
let LATEST_VERSION = '15.17.1'; // 默认版本

// 获取最新版本
async function fetchLatestVersion() {
  try {
    const response = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    const versions = await response.json();
    LATEST_VERSION = versions[0]; // 第一个就是最新版本
    console.log(`✓ 当前使用的英雄联盟数据版本: ${LATEST_VERSION}`);
    return LATEST_VERSION;
  } catch (error) {
    console.error('⚠ 获取最新版本失败，使用默认版本:', LATEST_VERSION, error);
    return LATEST_VERSION;
  }
}

// 获取英雄数据
async function getChampions() {
  if (championsData) return championsData;
  
  try {
    const response = await fetch(`https://ddragon.leagueoflegends.com/cdn/${LATEST_VERSION}/data/zh_CN/champion.json`);
    const data = await response.json();
    championsData = Object.values(data.data);
    console.log(`✓ 成功加载 ${championsData.length} 个英雄数据`);
    return championsData;
  } catch (error) {
    console.error('获取英雄数据失败:', error);
    return [];
  }
}

// 生成随机英雄
function getRandomChampions(champions, count) {
  const shuffled = [...champions].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

// 创建房间
app.post('/api/create-room', (req, res) => {
  const { roomName } = req.body;
  const roomId = generateRoomId();
  const room = {
    id: roomId,
    name: roomName || '未命名房间',
    creator: null,
    players: new Map(),
    status: 'waiting', // waiting, ready, generated
    matchUuid: null,
    blueTeam: [],
    redTeam: []
  };
  
  rooms.set(roomId, room);
  
  res.json({
    success: true,
    roomId: roomId,
    roomName: room.name,
    message: '房间创建成功'
  });
});

// 加入房间
app.post('/api/join-room', (req, res) => {
  const { roomId } = req.body;
  
  if (!rooms.has(roomId)) {
    return res.json({
      success: false,
      message: '房间不存在'
    });
  }
  
  const room = rooms.get(roomId);
  
  if (room.status !== 'waiting') {
    return res.json({
      success: false,
      message: '房间已开始或已结束'
    });
  }
  
  if (room.players.size >= 2) {
    return res.json({
      success: false,
      message: '房间已满'
    });
  }
  
  res.json({
    success: true,
    message: '成功加入房间',
    roomName: room.name || '未命名房间',
    roomStatus: room.status,
    playerCount: room.players.size + 1
  });
});

// 查询比赛记录
app.get('/api/match/:uuid', (req, res) => {
  const { uuid } = req.params;
  
  db.get('SELECT * FROM matches WHERE uuid = ?', [uuid], (err, row) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: '查询失败'
      });
    }
    
    if (!row) {
      return res.json({
        success: false,
        message: '比赛记录不存在'
      });
    }
    
    res.json({
      success: true,
      match: {
        uuid: row.uuid,
        roomId: row.room_id,
        roomName: row.room_name || '未命名房间',
        blueTeam: JSON.parse(row.blue_team),
        redTeam: JSON.parse(row.red_team),
        createdAt: row.created_at
      }
    });
  });
});

// 获取历史记录列表
app.get('/api/history', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  
  // 获取总数
  db.get('SELECT COUNT(*) as total FROM matches', (err, countRow) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: '查询失败'
      });
    }
    
    const total = countRow.total;
    
    // 获取分页数据
    db.all(
      'SELECT * FROM matches ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset],
      (err, rows) => {
        if (err) {
          return res.status(500).json({
            success: false,
            message: '查询失败'
          });
        }
        
        const matches = rows.map(row => ({
          uuid: row.uuid,
          roomId: row.room_id,
          roomName: row.room_name || '未命名房间',
          blueTeam: JSON.parse(row.blue_team),
          redTeam: JSON.parse(row.red_team),
          createdAt: row.created_at
        }));
        
        res.json({
          success: true,
          data: {
            matches: matches,
            pagination: {
              page: page,
              limit: limit,
              total: total,
              totalPages: Math.ceil(total / limit)
            }
          }
        });
      }
    );
  });
});

// 获取当前使用的版本
app.get('/api/version', (req, res) => {
  res.json({
    success: true,
    version: LATEST_VERSION
  });
});

// 生成房间号
function generateRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Socket.IO 连接处理
io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);
  
  // 加入房间
  socket.on('join-room', (data) => {
    const { roomId, isCreator } = data;
    
    if (!rooms.has(roomId)) {
      socket.emit('room-not-found', { message: '房间不存在' });
      return;
    }
    
    const room = rooms.get(roomId);
    
    if (room.players.size >= 2 && !room.players.has(socket.id)) {
      socket.emit('error', { message: '房间已满' });
      return;
    }
    
    // 加入房间
    socket.join(roomId);
    
    // 检查是否是重连（通过isCreator和房间中是否已有相同角色的玩家）
    let isReconnect = false;
    console.log(`玩家加入房间 ${roomId}, isCreator: ${isCreator}, 当前房间玩家:`, Array.from(room.players.values()).map(p => ({ isCreator: p.isCreator, ready: p.ready })));
    
    if (isCreator) {
      // 如果是房主，检查房间中是否已经有房主
      const existingCreator = Array.from(room.players.values()).find(p => p.isCreator);
      if (existingCreator) {
        // 房间中已有房主，这是重连
        isReconnect = true;
        console.log('检测到房主重连');
        // 移除旧的房主记录
        const oldSocketId = Array.from(room.players.keys()).find(id => room.players.get(id).isCreator);
        if (oldSocketId) {
          room.players.delete(oldSocketId);
          console.log(`移除旧房主记录: ${oldSocketId}`);
        }
      }
    } else {
      // 如果是成员，检查房间中是否已经有成员
      const existingMember = Array.from(room.players.values()).find(p => !p.isCreator);
      if (existingMember) {
        // 房间中已有成员，这是重连
        isReconnect = true;
        console.log('检测到成员重连');
        // 移除旧的成员记录
        const oldSocketId = Array.from(room.players.keys()).find(id => !room.players.get(id).isCreator);
        if (oldSocketId) {
          room.players.delete(oldSocketId);
          console.log(`移除旧成员记录: ${oldSocketId}`);
        }
      }
    }
    
    // 添加玩家到房间
    room.players.set(socket.id, {
      isCreator: isCreator,
      ready: false, // 重连时重置准备状态
      team: isCreator ? 'blue' : 'red'
    });
    
    players.set(socket.id, { roomId, isCreator });
    
    // 设置房主
    if (isCreator) {
      room.creator = socket.id;
    }
    
    // 通知房间内所有玩家
    if (isReconnect) {
      // 玩家重连
      io.to(roomId).emit('player-reconnected', {
        players: Array.from(room.players.values()).map(p => ({
          team: p.team,
          ready: p.ready,
          isCreator: p.isCreator
        })),
        playerCount: room.players.size,
        isCreator,
        team: isCreator ? 'blue' : 'red'
      });
    } else {
      // 新玩家加入
      io.to(roomId).emit('player-joined', {
        players: Array.from(room.players.values()).map(p => ({
          team: p.team,
          ready: p.ready,
          isCreator: p.isCreator
        })),
        playerCount: room.players.size,
        isCreator,
        team: isCreator ? 'blue' : 'red'
      });
    }
    
    // 发送当前房间状态给新加入的玩家
    setTimeout(() => {
      socket.emit('room-state', {
        roomId: roomId,
        status: room.status,
        players: Array.from(room.players.values()).map(p => ({
          team: p.team,
          ready: p.ready,
          isCreator: p.isCreator
        })),
        matchUuid: room.matchUuid,
        blueTeam: room.blueTeam,
        redTeam: room.redTeam
      });
    }, 50);
    
    console.log(`${isCreator ? '房主' : '房间成员'} 加入房间 ${roomId}`);
  });
  
  // 玩家准备
  socket.on('player-ready', (data) => {
    const { roomId } = data;
    const player = players.get(socket.id);
    
    if (!player || !rooms.has(roomId)) {
      socket.emit('error', { message: '房间不存在' });
      return;
    }
    
    const room = rooms.get(roomId);
    const playerInfo = room.players.get(socket.id);
    
    if (!playerInfo) {
      socket.emit('error', { message: '玩家信息不存在' });
      return;
    }
    
    // 检查房间状态，如果已经生成比赛则不允许重新准备
    if (room.status === 'generated') {
      socket.emit('error', { message: '比赛已生成，无法重新准备' });
      return;
    }
    
    // 检查房间是否有房主和成员，且都处于连接状态
    if (room.players.size < 2) {
      socket.emit('error', { message: '需要房主和成员都加入房间才能准备' });
      return;
    }
    
    // 检查是否有房主和成员
    const hasCreator = Array.from(room.players.values()).some(p => p.isCreator);
    const hasMember = Array.from(room.players.values()).some(p => !p.isCreator);
    
    if (!hasCreator || !hasMember) {
      socket.emit('error', { message: '需要房主和成员都加入房间才能准备' });
      return;
    }
    
    playerInfo.ready = true;
    
    // 检查是否所有玩家都准备好了
    const allReady = Array.from(room.players.values()).every(p => p.ready);
    
    io.to(roomId).emit('player-ready-updated', {
      team: playerInfo.team,
      allReady: allReady,
      readyCount: Array.from(room.players.values()).filter(p => p.ready).length,
      totalCount: room.players.size
    });
    
    // 如果所有玩家都准备好了，生成阵容
    if (allReady && room.players.size === 2 && room.status === 'waiting') {
      generateMatch(roomId);
    }
  });
  
  // 玩家退出房间
  socket.on('leave-room', (data) => {
    const { roomId } = data;
    const player = players.get(socket.id);
    
    if (player && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      const playerInfo = room.players.get(socket.id);
      
      if (playerInfo) {
        room.players.delete(socket.id);
        socket.leave(roomId);
        
        // 通知房间内其他玩家
        io.to(roomId).emit('player-left', {
          players: Array.from(room.players.values()).map(p => ({
            team: p.team,
            ready: p.ready,
            isCreator: p.isCreator
          })),
          team: playerInfo.team,
          isCreator: playerInfo.isCreator,
          playerCount: room.players.size
        });
        
        // 如果房主退出，解散房间
        if (playerInfo.isCreator) {
          // 通知房间成员房间已解散
          io.to(roomId).emit('room-disbanded', { message: '房主已退出，房间解散' });
          rooms.delete(roomId);
        } else if (room.players.size === 0) {
          // 如果房间空了，删除房间
          rooms.delete(roomId);
        }
        
        console.log(`${playerInfo.isCreator ? '房主' : '房间成员'} 退出房间 ${roomId}`);
      }
    }
    
    players.delete(socket.id);
  });
  
  // 重新开始比赛
  socket.on('restart-match', (data) => {
    const { roomId } = data;
    const player = players.get(socket.id);
    
    if (!player || !rooms.has(roomId)) {
      socket.emit('error', { message: '房间不存在' });
      return;
    }
    
    const room = rooms.get(roomId);
    const playerInfo = room.players.get(socket.id);
    
    if (!playerInfo || !playerInfo.isCreator) {
      socket.emit('error', { message: '只有房主可以重新开始比赛' });
      return;
    }
    
    // 重置房间状态
    room.status = 'waiting';
    room.blueTeam = [];
    room.redTeam = [];
    room.matchUuid = null;
    
    // 重置所有玩家的准备状态
    room.players.forEach((playerInfo) => {
      playerInfo.ready = false;
    });
    
    // 通知所有玩家重新开始
    io.to(roomId).emit('match-restarted', {
      message: '比赛已重新开始，请双方重新准备',
      players: Array.from(room.players.values()).map(p => ({
        team: p.team,
        ready: p.ready,
        isCreator: p.isCreator
      })),
      playerCount: room.players.size
    });
    
    console.log(`房间 ${roomId} 重新开始比赛`);
  });
  
  // 断开连接
  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player) {
      const room = rooms.get(player.roomId);
      if (room) {
        const playerInfo = room.players.get(socket.id);
        room.players.delete(socket.id);
        
        // 通知房间内其他玩家
        io.to(player.roomId).emit('player-left', {
          players: Array.from(room.players.values()).map(p => ({
            team: p.team,
            ready: p.ready,
            isCreator: p.isCreator
          })),
          team: playerInfo ? playerInfo.team : 'unknown',
          isCreator: playerInfo ? playerInfo.isCreator : false,
          playerCount: room.players.size
        });
        
        // 如果房主断开连接，给一个短暂的重连机会
        if (playerInfo && playerInfo.isCreator) {
          const roomId = player.roomId;
          
          // 设置房主重连超时，5秒后如果房主没有重连则解散房间
          setTimeout(() => {
            const currentRoom = rooms.get(roomId);
            if (currentRoom) {
              // 检查房间中是否还有房主（通过isCreator标识）
              const hasCreator = Array.from(currentRoom.players.values()).some(p => p.isCreator);
              if (!hasCreator) {
                // 房主没有重连，解散房间
                io.to(roomId).emit('room-disbanded', { message: '房主长时间未重连，房间解散' });
                rooms.delete(roomId);
                console.log(`房主长时间未重连，房间 ${roomId} 已解散`);
              }
            }
          }, 5000);
          
          // 通知房间成员房主暂时断开连接
          io.to(roomId).emit('creator-disconnected', { message: '房主暂时断开连接，等待重连...' });
        } else if (room.players.size === 0) {
          // 如果房间空了，删除房间
          rooms.delete(player.roomId);
        }
      }
      
      players.delete(socket.id);
    }
    
    console.log('用户断开连接:', socket.id);
  });
});

// 生成比赛阵容
async function generateMatch(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  try {
    const champions = await getChampions();
    if (champions.length === 0) {
      io.to(roomId).emit('error', { message: '获取英雄数据失败' });
      return;
    }
    
    // 生成蓝队阵容
    const blueTeamChampions = getRandomChampions(champions, 15);
    const remainingChampions = champions.filter(c => !blueTeamChampions.includes(c));
    const redTeamChampions = getRandomChampions(remainingChampions, 15);
    
    // 生成比赛UUID
    const matchUuid = uuidv4();
    
    // 更新房间状态
    room.status = 'generated';
    room.matchUuid = matchUuid;
    room.blueTeam = blueTeamChampions.map(c => ({
      id: c.id,
      name: c.name,
      image: c.image.full
    }));
    room.redTeam = redTeamChampions.map(c => ({
      id: c.id,
      name: c.name,
      image: c.image.full
    }));
    
    // 保存到数据库（使用 UTC+8 时区）
    db.run(
      'INSERT INTO matches (uuid, room_id, room_name, blue_team, red_team, created_at) VALUES (?, ?, ?, ?, ?, datetime("now", "+8 hours"))',
      [matchUuid, roomId, room.name || '未命名房间', JSON.stringify(room.blueTeam), JSON.stringify(room.redTeam)],
      function(err) {
        if (err) {
          console.error('保存比赛记录失败:', err);
        } else {
          console.log(`比赛记录已保存: ${matchUuid}`);
        }
      }
    );
    
    // 历史记录已保存到数据库，不需要通知前端
    
    // 分别通知房主和成员
    const bluePlayer = Array.from(room.players.entries()).find(([_, player]) => player.team === 'blue');
    const redPlayer = Array.from(room.players.entries()).find(([_, player]) => player.team === 'red');
    
    if (bluePlayer) {
      io.to(bluePlayer[0]).emit('match-generated', {
        matchUuid: matchUuid,
        team: 'blue',
        champions: room.blueTeam,
        roomId: roomId
      });
    }
    
    if (redPlayer) {
      io.to(redPlayer[0]).emit('match-generated', {
        matchUuid: matchUuid,
        team: 'red',
        champions: room.redTeam,
        roomId: roomId
      });
    }
    
    console.log(`房间 ${roomId} 生成比赛: ${matchUuid}`);
    
  } catch (error) {
    console.error('生成比赛失败:', error);
    io.to(roomId).emit('error', { message: '生成比赛失败' });
  }
}

// 初始化服务器
async function initializeServer() {
  console.log('正在初始化服务器...');
  
  // 获取最新版本
  await fetchLatestVersion();
  
  // 预加载英雄数据
  console.log('正在加载英雄数据...');
  const champions = await getChampions();
  if (champions.length === 0) {
    console.error('⚠ 警告：英雄数据加载失败，服务可能无法正常工作');
  }
  
  // 启动服务器
  const PORT = process.env.PORT || 4000;
  server.listen(PORT, () => {
    console.log(`========================================`);
    console.log(`✓ 服务器运行在端口 ${PORT}`);
    console.log(`✓ 访问地址: http://localhost:${PORT}`);
    console.log(`✓ 英雄联盟数据版本: ${LATEST_VERSION}`);
    console.log(`✓ 已加载英雄数量: ${championsData ? championsData.length : 0}`);
    console.log(`========================================`);
  });
}

// 启动服务器
initializeServer().catch(error => {
  console.error('服务器初始化失败:', error);
  process.exit(1);
});
