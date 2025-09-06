const API_VERSION = "15.17.1";
const DDRAGON_BASE_URL = `https://ddragon.leagueoflegends.com/cdn/${API_VERSION}`;

// 服务端连接
const socket = io();
const API_BASE = window.location.origin;

// 全局变量
let currentRoomId = null;
let isRoomCreator = false;
let isReady = false;
let matchUuid = null;
let currentTeam = null;
let isAdminLoggedIn = false;
let reconnectAttempts = 0;
let maxReconnectAttempts = 5;
let reconnectInterval = null;
let currentPage = 1;
let totalPages = 1;

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
});

// 初始化应用
function initializeApp() {
  // 绑定事件
  document.getElementById("createRoomBtn").addEventListener("click", createRoom);
  document.getElementById("joinRoomBtn").addEventListener("click", joinRoom);
  document.getElementById("readyBtn").addEventListener("click", toggleReady);
  document.getElementById("adminLoginBtn").addEventListener("click", adminLogin);
  document.getElementById("leaveRoomBtn").addEventListener("click", leaveRoom);
  document.getElementById("restartBtn").addEventListener("click", restartMatch);
  document.getElementById("prevPage").addEventListener("click", () => loadHistoryPage(currentPage - 1));
  document.getElementById("nextPage").addEventListener("click", () => loadHistoryPage(currentPage + 1));
  document.getElementById("helpIcon").addEventListener("click", showHelpModal);
  document.getElementById("closeHelpModal").addEventListener("click", hideHelpModal);
  
  // 输入框事件
  document.getElementById("roomIdInput").addEventListener("keypress", (e) => {
    if (e.key === 'Enter') {
      joinRoom();
    }
  });
  
  document.getElementById("adminPassword").addEventListener("keypress", (e) => {
    if (e.key === 'Enter') {
      adminLogin();
    }
  });

  // Socket.IO 事件监听
  setupSocketListeners();
  
  // 检查是否有保存的房间状态
  checkSavedRoomState();
}

// 设置Socket监听器
function setupSocketListeners() {
  // 玩家加入房间
  socket.on('player-joined', (data) => {
    console.log('玩家加入事件:', data);
    updatePlayersList(data);
    updateReadyButtonState(data);
    showNotification(`${data.isCreator ? '房主' : '房间成员'} 加入了房间`, 'info');
  });
  
  // 玩家离开房间
  socket.on('player-left', (data) => {
    console.log('玩家离开事件:', data);
    updatePlayersList(data);
    updateReadyButtonState(data);
    showNotification(`${data.isCreator ? '房主' : '房间成员'} 离开了房间`, 'info');
  });
  
  // 玩家重连
  socket.on('player-reconnected', (data) => {
    console.log('玩家重连事件:', data);
    updatePlayersList(data);
    updateReadyButtonState(data);
    showNotification(`${data.isCreator ? '房主' : '房间成员'} 重新连接`, 'success');
  });
  
  // 房主断开连接
  socket.on('creator-disconnected', (data) => {
    console.log('房主断开连接事件:', data);
    showNotification(data.message, 'warning');
  });
  
  // 玩家准备状态更新
  socket.on('player-ready-updated', (data) => {
    updateReadyStatus(data);
  });
  
  // 比赛生成完成
  socket.on('match-generated', (data) => {
    matchUuid = data.matchUuid;
    currentTeam = data.team;
    displayMatchResults(data);
    showNotification('阵容生成完成！', 'success');
  });
  
  // 历史记录现在直接从数据库读取，不需要Socket事件
  
  // 重新开始比赛
  socket.on('match-restarted', (data) => {
    resetMatchState();
    // 更新玩家列表和准备按钮状态
    if (data.players) {
      updatePlayersList(data);
    }
    showNotification(data.message || '比赛已重新开始，请双方重新准备', 'info');
  });
  
  // 房间解散
  socket.on('room-disbanded', (data) => {
    showNotification(data.message, 'error');
    resetUI();
    localStorage.removeItem('roomState');
  });
  
  // 房间不存在
  socket.on('room-not-found', (data) => {
    showNotification(data.message, 'error');
    resetUI();
    localStorage.removeItem('roomState');
  });
  
  // 房间状态同步
  socket.on('room-state', (data) => {
    syncRoomState(data);
  });
  
  // 错误处理
  socket.on('error', (data) => {
    showNotification(data.message, 'error');
  });
  
  // 连接状态
  socket.on('connect', () => {
    console.log('已连接到服务器');
    reconnectAttempts = 0;
    clearInterval(reconnectInterval);
    
    // 如果之前有房间状态，尝试重连
    if (currentRoomId) {
      // 延迟一下确保连接完全建立
      setTimeout(() => {
        reconnectToRoom();
      }, 100);
    }
  });
  
  socket.on('disconnect', () => {
    showNotification('与服务器连接断开，正在尝试重连...', 'error');
    startReconnect();
  });
  
  socket.on('connect_error', () => {
    showNotification('连接失败，正在尝试重连...', 'error');
    startReconnect();
  });
}

// 创建房间
async function createRoom() {
  try {
    const response = await fetch(`${API_BASE}/api/create-room`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    
    if (data.success) {
      currentRoomId = data.roomId;
      isRoomCreator = true;
      currentTeam = 'blue';
      
      // 加入Socket房间
      socket.emit('join-room', {
        roomId: currentRoomId,
        isCreator: true
      });
      
      updateRoomUI();
      saveRoomState();
      showNotification('房间创建成功！你是房主', 'success');
    } else {
      showNotification(data.message, 'error');
      // 创建房间失败时清空状态
      resetUI();
      localStorage.removeItem('roomState');
    }
  } catch (error) {
    console.error('创建房间失败:', error);
    showNotification('创建房间失败', 'error');
    // 创建房间失败时清空状态
    resetUI();
    localStorage.removeItem('roomState');
  }
}

// 加入房间
async function joinRoom() {
  const roomId = document.getElementById('roomIdInput').value.trim().toUpperCase();
  
  if (!roomId || roomId.length !== 6) {
    showNotification('请输入6位房间号', 'error');
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/api/join-room`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        roomId: roomId
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      currentRoomId = roomId;
      isRoomCreator = false;
      currentTeam = 'red';
      
      // 加入Socket房间
      socket.emit('join-room', {
        roomId: currentRoomId,
        isCreator: false
      });
      
      updateRoomUI();
      saveRoomState();
      showNotification('成功加入房间！你是成员', 'success');
    } else {
      showNotification(data.message, 'error');
      // 加入房间失败时清空状态
      resetUI();
      localStorage.removeItem('roomState');
    }
  } catch (error) {
    console.error('加入房间失败:', error);
    showNotification('加入房间失败', 'error');
    // 加入房间失败时清空状态
    resetUI();
    localStorage.removeItem('roomState');
  }
}

// 更新房间UI
function updateRoomUI() {
  const roomInfo = document.getElementById('roomInfo');
  const playersInfo = document.getElementById('playersInfo');
  const currentRoomIdSpan = document.getElementById('currentRoomId');
  const roomStatus = document.querySelector('.room-status');
  const readyBtn = document.getElementById('readyBtn');
  
  currentRoomIdSpan.textContent = currentRoomId;
  roomInfo.style.display = 'flex';
  playersInfo.style.display = 'block';
  
  if (isRoomCreator) {
    roomStatus.textContent = `你是房主，等待房间成员加入...`;
  } else {
    roomStatus.textContent = `你是房间成员，已加入房间`;
  }
  
  // 如果有比赛结果，更新状态显示
  if (matchUuid) {
    roomStatus.innerHTML = `比赛已生成！<br>UUID: <strong>${matchUuid}</strong>`;
    if (readyBtn) {
      readyBtn.disabled = true;
      readyBtn.textContent = '比赛已生成';
    }
  } else {
    // 更新准备按钮状态（需要检查房间人数）
    updateReadyButtonState();
  }
  }
  
  // 更新玩家列表
  function updatePlayersList(data) {
    // 更新准备状态显示
    const readyCount = data.players.filter(p => p.ready).length;
    const totalCount = data.players.length;
    updateReadyStatus({
      allReady: readyCount === totalCount && totalCount === 2,
      readyCount: readyCount,
      totalCount: totalCount
    });
    
    // 更新准备按钮状态
    updateReadyButtonState(data);
  }
  
  // 更新准备按钮状态（检查房间人数）
function updateReadyButtonState(playersData = null) {
  const readyBtn = document.getElementById('readyBtn');
  
  if (!readyBtn) return;
  
  // 如果有比赛结果，禁用准备按钮
  if (matchUuid) {
    readyBtn.disabled = true;
    readyBtn.textContent = '比赛已生成';
    readyBtn.style.background = 'linear-gradient(135deg, #9e9e9e 0%, #757575 100%)';
    return;
  }
  
  let hasCreator = false;
  let hasMember = false;
  
  if (playersData && playersData.players) {
    // 使用传入的玩家数据
    hasCreator = playersData.players.some(p => p.isCreator);
    hasMember = playersData.players.some(p => !p.isCreator);
  }
  
  // 只有当房主和成员都在时才能准备
  console.log('准备按钮状态检查:', { hasCreator, hasMember, isReady, matchUuid });
  
  if (hasCreator && hasMember) {
    readyBtn.disabled = false;
    readyBtn.textContent = isReady ? '取消准备' : '准备';
    readyBtn.style.background = isReady ? 
      'linear-gradient(135deg, #f44336 0%, #d32f2f 100%)' : 
      'linear-gradient(135deg, #4caf50 0%, #45a049 100%)';
    console.log('准备按钮已启用');
  } else {
    readyBtn.disabled = true;
    readyBtn.textContent = '等待房主和成员加入';
    readyBtn.style.background = 'linear-gradient(135deg, #9e9e9e 0%, #757575 100%)';
    console.log('准备按钮已禁用，等待房主和成员加入');
  }
}

// 更新准备状态
function updateReadyStatus(data) {
  const readyStatus = document.getElementById('readyStatus');
  const readyBtn = document.getElementById('readyBtn');
  
  if (data.allReady) {
    readyStatus.textContent = '所有玩家已准备，正在随机生成阵容...';
    readyBtn.disabled = true;
  } else {
    readyStatus.textContent = `已准备: ${data.readyCount}/${data.totalCount}`;
    readyBtn.disabled = false;
  }
}

// 切换准备状态
function toggleReady() {
  if (!currentRoomId) return;
  
  // 检查是否已经有比赛结果，如果有则不允许重新准备
  if (matchUuid) {
    showNotification('比赛已生成，无法重新准备', 'error');
    return;
  }
  
  isReady = !isReady;
  
  socket.emit('player-ready', {
    roomId: currentRoomId
  });
  
  const readyBtn = document.getElementById('readyBtn');
  readyBtn.textContent = isReady ? '取消准备' : '准备';
  readyBtn.style.background = isReady ? 
    'linear-gradient(135deg, #f44336 0%, #d32f2f 100%)' : 
    'linear-gradient(135deg, #4caf50 0%, #45a049 100%)';
  
  // 保存状态
  saveRoomState();
}

// 显示比赛结果
function displayMatchResults(data) {
  const blueTeamContainer = document.getElementById("blueTeam");
  const redTeamContainer = document.getElementById("redTeam");
  const teamsContainer = document.getElementById("teamsContainer");
  
  // 清空现有内容
  blueTeamContainer.innerHTML = "";
  redTeamContainer.innerHTML = "";
  teamsContainer.style.display = 'flex';
  
  // 根据当前队伍显示对应的英雄
  if (data.team === 'blue') {
    // 房主只显示房主英雄
    data.champions.forEach((championData) => {
      const champion = {
        id: championData.id,
        name: championData.name,
        image: { full: championData.image }
      };
      blueTeamContainer.appendChild(createChampionElement(champion));
    });
    
    // 隐藏成员区域
    redTeamContainer.parentElement.style.display = 'none';
  } else {
    // 成员只显示成员英雄
    data.champions.forEach((championData) => {
      const champion = {
        id: championData.id,
        name: championData.name,
        image: { full: championData.image }
      };
      redTeamContainer.appendChild(createChampionElement(champion));
    });
    
    // 隐藏房主区域
    blueTeamContainer.parentElement.style.display = 'none';
  }
  
  // 显示比赛UUID
  const roomStatus = document.querySelector('.room-status');
  roomStatus.innerHTML = `比赛已生成！<br>UUID: <strong>${data.matchUuid}</strong>`;
  
  // 只有房主可以显示重新开始按钮
  if (isRoomCreator && document.getElementById('restartBtn').style.display !== 'block') {
    document.getElementById('restartBtn').style.display = 'block';
  }
  
  // 历史记录现在直接从数据库读取，不需要本地保存
  
  // 保存状态
  saveRoomState();
}

// 保存房间状态到本地存储
function saveRoomState() {
  if (currentRoomId) {
    const roomState = {
      roomId: currentRoomId,
      isCreator: isRoomCreator,
      team: currentTeam,
      isReady: isReady,
      matchUuid: matchUuid
    };
    localStorage.setItem('roomState', JSON.stringify(roomState));
  }
}

// 检查保存的房间状态
function checkSavedRoomState() {
  const savedState = localStorage.getItem('roomState');
  console.log('检查保存的房间状态:', savedState);
  
  if (savedState) {
    try {
      const roomState = JSON.parse(savedState);
      console.log('解析的房间状态:', roomState);
      
      if (roomState.roomId) {
        currentRoomId = roomState.roomId;
        isRoomCreator = roomState.isCreator;
        currentTeam = roomState.team;
        isReady = roomState.isReady;
        matchUuid = roomState.matchUuid;
        
        console.log('恢复的状态:', {
          currentRoomId,
          isRoomCreator,
          currentTeam,
          isReady,
          matchUuid
        });
        
        // 更新UI
        updateRoomUI();
        
        // 如果已有比赛结果，先显示占位符
        if (matchUuid) {
          showTemporaryPlaceholder();
          // 只有房主可以显示重新开始按钮
          if (isRoomCreator) {
            document.getElementById('restartBtn').style.display = 'block';
          }
        }
        
        // 更新准备按钮状态
        updateReadyButtonState();
        
        showNotification('检测到未完成的房间，正在重连...', 'info');
      }
    } catch (error) {
      console.error('解析房间状态失败:', error);
      localStorage.removeItem('roomState');
    }
  }
}

// 显示临时占位符
function showTemporaryPlaceholder() {
  const blueTeamContainer = document.getElementById("blueTeam");
  const redTeamContainer = document.getElementById("redTeam");
  const teamsContainer = document.getElementById("teamsContainer");
  
  if (currentTeam === 'blue') {
    blueTeamContainer.innerHTML = '<div class="team-placeholder">正在加载房主阵容...</div>';
    teamsContainer.style.display = 'flex';
    // 隐藏成员区域
    redTeamContainer.parentElement.style.display = 'none';
  } else {
    redTeamContainer.innerHTML = '<div class="team-placeholder">正在加载房间成员阵容...</div>';
    teamsContainer.style.display = 'flex';
    // 隐藏房主区域
    blueTeamContainer.parentElement.style.display = 'none';
  }
}

// 重连到房间
function reconnectToRoom() {
  if (currentRoomId) {
    socket.emit('join-room', {
      roomId: currentRoomId,
      isCreator: isRoomCreator
    });
    showNotification('正在重连到房间...', 'info');
    
    // 设置重连超时，如果5秒内没有收到房间状态，认为房间不存在
    const reconnectTimeout = setTimeout(() => {
      showNotification('重连超时，房间可能不存在', 'error');
      resetUI();
      localStorage.removeItem('roomState');
    }, 5000);
    
    // 监听房间状态同步，成功后清除超时
    const handleRoomState = () => {
      clearTimeout(reconnectTimeout);
      socket.off('room-state', handleRoomState);
    };
    
    socket.on('room-state', handleRoomState);
  }
}

// 同步房间状态
function syncRoomState(data) {
  console.log('同步房间状态:', data);
  
  // 更新本地状态
  currentTeam = data.players.find(p => p.isCreator === isRoomCreator)?.team || currentTeam;
  
  // 根据房间状态更新UI
  if (data.status === 'generated') {
    // 比赛已生成，显示结果
    if (data.matchUuid) {
      matchUuid = data.matchUuid;
      
      // 显示比赛结果
      if (currentTeam === 'blue' && data.blueTeam.length > 0) {
        displayMatchResults({
          matchUuid: data.matchUuid,
          team: 'blue',
          champions: data.blueTeam
        });
      } else if (currentTeam === 'red' && data.redTeam.length > 0) {
        displayMatchResults({
          matchUuid: data.matchUuid,
          team: 'red',
          champions: data.redTeam
        });
      }
      
      // 只有房主可以显示重新开始按钮
      if (isRoomCreator) {
        document.getElementById('restartBtn').style.display = 'block';
      }
      
      // 禁用准备按钮
      const readyBtn = document.getElementById('readyBtn');
      readyBtn.disabled = true;
      readyBtn.textContent = '比赛已生成';
      
      // 更新房间状态显示
      const roomStatus = document.querySelector('.room-status');
      roomStatus.innerHTML = `比赛已生成！<br>UUID: <strong>${data.matchUuid}</strong>`;
    }
  } else if (data.status === 'waiting') {
    // 等待状态，检查准备状态
    const myPlayer = data.players.find(p => p.isCreator === isRoomCreator);
    if (myPlayer) {
      isReady = myPlayer.ready;
    }
    
    // 更新准备按钮状态，传递玩家数据
    updateReadyButtonState(data);
    
    // 更新准备状态显示
    const readyCount = data.players.filter(p => p.ready).length;
    const totalCount = data.players.length;
    updateReadyStatus({
      allReady: readyCount === totalCount && totalCount === 2,
      readyCount: readyCount,
      totalCount: totalCount
    });
    
    // 隐藏重新开始按钮
    document.getElementById('restartBtn').style.display = 'none';
    
    // 更新房间状态显示
    const roomStatus = document.querySelector('.room-status');
    if (isRoomCreator) {
      roomStatus.textContent = `你是房主，等待房间成员加入...`;
    } else {
      roomStatus.textContent = `你是房间成员，已加入房间`;
    }
  }
  
  // 保存更新后的状态
  saveRoomState();
  
  // 显示重连成功消息
  showNotification('重连成功，状态已恢复', 'success');
}

// 更新准备按钮状态
function updateReadyButton() {
  const readyBtn = document.getElementById('readyBtn');
  if (readyBtn) {
    readyBtn.textContent = isReady ? '取消准备' : '准备';
    readyBtn.style.background = isReady ? 
      'linear-gradient(135deg, #f44336 0%, #d32f2f 100%)' : 
      'linear-gradient(135deg, #4caf50 0%, #45a049 100%)';
  }
}

// 开始重连
function startReconnect() {
  if (reconnectAttempts >= maxReconnectAttempts) {
    showNotification('重连失败，请刷新页面重试', 'error');
    // 重连失败时清空状态
    resetUI();
    localStorage.removeItem('roomState');
    return;
  }
  
  reconnectAttempts++;
  reconnectInterval = setInterval(() => {
    if (socket.connected) {
      clearInterval(reconnectInterval);
      return;
    }
    
    if (reconnectAttempts >= maxReconnectAttempts) {
      clearInterval(reconnectInterval);
      showNotification('重连失败，请刷新页面重试', 'error');
      // 重连失败时清空状态
      resetUI();
      localStorage.removeItem('roomState');
      return;
    }
    
    socket.connect();
    reconnectAttempts++;
  }, 4000);
}

// 退出房间
function leaveRoom() {
  if (!currentRoomId) {
    showNotification('你不在任何房间中', 'error');
    return;
  }
  
  // 发送退出房间事件
  socket.emit('leave-room', { roomId: currentRoomId });
  
  // 清理状态
  currentRoomId = null;
  isRoomCreator = false;
  isReady = false;
  matchUuid = null;
  currentTeam = null;
  
  // 清理本地存储
  localStorage.removeItem('roomState');
  
  // 重置UI
  resetUI();
  
  showNotification('已退出房间', 'info');
}

// 重新开始比赛
function restartMatch() {
  if (!currentRoomId) {
    showNotification('你不在任何房间中', 'error');
    return;
  }
  
  if (!isRoomCreator) {
    showNotification('只有房主可以重新开始比赛', 'error');
    return;
  }
  
  // 发送重新开始事件
  socket.emit('restart-match', { roomId: currentRoomId });
}

// 重置比赛状态
function resetMatchState() {
  // 重置准备状态
  isReady = false;
  matchUuid = null; // 重置比赛UUID
  
  // 更新准备按钮状态（需要检查房间人数）
  updateReadyButtonState();
  
  // 清空英雄显示并显示所有区域
  document.getElementById('blueTeam').innerHTML = '';
  document.getElementById('redTeam').innerHTML = '';
  document.getElementById('teamsContainer').style.display = 'none';
  
  // 隐藏重新开始按钮
  document.getElementById('restartBtn').style.display = 'none';
  
  // 更新房间状态
  const roomStatus = document.querySelector('.room-status');
  if (isRoomCreator) {
    roomStatus.textContent = '你是房主，等待成员加入...';
  } else {
    roomStatus.textContent = '你是成员，已加入房间';
  }
  
  // 更新准备状态显示
  document.getElementById('readyStatus').textContent = '等待其他玩家...';
  
  // 保存状态
  saveRoomState();
}

// 重置UI
function resetUI() {
  // 隐藏房间相关UI
  document.getElementById('roomInfo').style.display = 'none';
  document.getElementById('playersInfo').style.display = 'none';
  
  // 清空英雄显示并显示所有区域
  document.getElementById('blueTeam').innerHTML = '';
  document.getElementById('redTeam').innerHTML = '';
  document.getElementById('teamsContainer').style.display = 'none';
  
  // 清空输入框
  document.getElementById('roomIdInput').value = '';
  
  // 重置准备按钮
  document.getElementById('readyBtn').disabled = true;
  document.getElementById('readyBtn').textContent = '准备';
  document.getElementById('readyBtn').style.background = 'linear-gradient(135deg, #4caf50 0%, #45a049 100%)';
  
  // 隐藏重新开始按钮
  document.getElementById('restartBtn').style.display = 'none';
  
  // 重置准备状态显示
  const readyStatus = document.getElementById('readyStatus');
  if (readyStatus) {
    readyStatus.textContent = '等待玩家准备...';
  }
  
  // 清空全局状态变量
  currentRoomId = null;
  isRoomCreator = false;
  isReady = false;
  matchUuid = null;
  currentTeam = null;
  
  console.log('UI已重置，所有状态已清空');
}

// 管理员登录
function adminLogin() {
  const password = document.getElementById('adminPassword').value.trim();
  
  if (!password) {
    showNotification('请输入管理员密码', 'error');
    return;
  }
  
  // 简单的密码验证（实际项目中应该使用更安全的方式）
  if (password === 'fanruanlol') {
    isAdminLoggedIn = true;
    document.getElementById('historyRecords').style.display = 'block';
    document.getElementById('adminPassword').style.display = 'none';
    document.getElementById('adminLoginBtn').style.display = 'none';
    showNotification('管理员验证成功', 'success');
    loadHistoryPage(1);
  } else {
    showNotification('密码错误', 'error');
  }
}


// 显示帮助弹窗
function showHelpModal() {
  const modal = document.getElementById('helpModal');
  const content = document.getElementById('helpContent');
  
  // 设置规则说明内容
  content.innerHTML = `
    <h3>使用说明</h3>
    <ul>
      <li>A同学创建房间后，将房间号发给B同学，B同学加入房间后，双方可点击"准备"按钮</li>
      <li>双方都准备后，系统自动为每方随机生成15个不同的英雄，进游戏后，双方需要自己选择其中的5个英雄</li>
      <li>打完一局后点重新开始按钮即可</li>
    </ul>
    
    <h3>注意事项</h3>
    <ul>
      <li>为了模拟大乱斗真实场景，双方看不到对方的可选列表。避免针对性选英雄</li>
      <li>为了避免纠纷，最好打完后就双方互发图片验证下对面是否按照可选英雄选择了</li>
      <li>每场比赛会生成一个UUID，用于记录和查询，请妥善保存。遇到英雄池纠纷可以向主办方查询</li>
      <li>为了避免意料之外的bug，尽量按上面正常流程走。加入房间后尽量不再刷新页面之类</li>
      <li>若出现bug，可以跟对手商量，退出房间重新创建</li>
    </ul>
  `;
  
  modal.style.display = 'block';
  document.body.style.overflow = 'hidden'; // 防止背景滚动
}

// 隐藏帮助弹窗
function hideHelpModal() {
  const modal = document.getElementById('helpModal');
  modal.style.display = 'none';
  document.body.style.overflow = 'auto'; // 恢复背景滚动
}

// 点击弹窗外部关闭
window.addEventListener('click', (event) => {
  const modal = document.getElementById('helpModal');
  if (event.target === modal) {
    hideHelpModal();
  }
});

// 获取英雄数据（保留原有函数）
async function getChampions() {
  try {
    const response = await fetch(
      `${DDRAGON_BASE_URL}/data/zh_CN/champion.json`
    );
    const data = await response.json();
    return Object.values(data.data);
  } catch (error) {
    console.error("获取英雄数据失败:", error);
    return [];
  }
}

// 创建英雄元素
function createChampionElement(champion) {
  const div = document.createElement("div");
  div.className = "champion";

  const img = document.createElement("img");
  img.src = `${DDRAGON_BASE_URL}/img/champion/${champion.image.full}`;
  img.alt = champion.name;

  const name = document.createElement("div");
  name.textContent = champion.name;

  div.appendChild(img);
  div.appendChild(name);
  return div;
}

// 历史记录现在直接从数据库读取，不再需要本地存储

// 从服务端加载历史记录
async function loadHistoryPage(page) {
  try {
    const response = await fetch(`${API_BASE}/api/history?page=${page}&limit=10`);
    const data = await response.json();
    
    if (data.success) {
      currentPage = data.data.pagination.page;
      totalPages = data.data.pagination.totalPages;
      
      displayHistoryFromServer(data.data.matches);
      updatePagination();
    } else {
      showNotification('加载历史记录失败', 'error');
    }
  } catch (error) {
    console.error('加载历史记录失败:', error);
    showNotification('加载历史记录失败', 'error');
  }
}

// 显示从服务端获取的历史记录
function displayHistoryFromServer(matches) {
  const historyList = document.getElementById("historyList");
  
  if (matches.length === 0) {
    historyList.innerHTML = '<div class="no-data" style="text-align: center; padding: 40px; color: #999;">暂无历史记录</div>';
    return;
  }
  
  historyList.innerHTML = matches
    .map(
      (record, index) => {
        // 检查是否有完整的红蓝双方数据
        const hasBlueTeam = record.blueTeam && record.blueTeam.length > 0;
        const hasRedTeam = record.redTeam && record.redTeam.length > 0;
        const isComplete = hasBlueTeam && hasRedTeam;
        
        // 格式化时间（显示 UTC-8 时区）
        const createdAt = new Date(record.createdAt).toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
        
        return `
        <div class="history-record" style="animation-delay: ${index * 0.1}s">
            <div class="record-header">
                <div class="header-left">
                    <span class="timestamp">${createdAt}</span>
                    <span class="match-uuid">UUID: ${record.uuid}</span>
                    <span class="complete-badge">完整数据</span>
                    <button class="toggle-record-btn">
                        <span class="toggle-text">展开/收起</span>
                        <span class="arrow">▼</span>
                    </button>
                </div>
            </div>
            <div class="record-content">
                <div class="teams">
                    <div class="team-list">
                        <h3>房主 (${record.blueTeam.length}个英雄)</h3>
                        <ul>
                            ${record.blueTeam.map((champion) => `<li>${champion.name}</li>`).join("")}
                        </ul>
                    </div>
                    <div class="team-list">
                        <h3>房间成员 (${record.redTeam.length}个英雄)</h3>
                        <ul>
                            ${record.redTeam.map((champion) => `<li>${champion.name}</li>`).join("")}
                        </ul>
                    </div>
                </div>
            </div>
        </div>
        `;
      }
    )
    .join("");

  // 为每个记录添加折叠功能
  document.querySelectorAll(".toggle-record-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const record = e.target.closest(".history-record");
      const content = record.querySelector(".record-content");
      const arrow = record.querySelector(".arrow");
      const toggleText = record.querySelector(".toggle-text");

      content.classList.toggle("collapsed");
      if (content.classList.contains("collapsed")) {
        arrow.style.transform = "rotate(-90deg)";
        toggleText.textContent = "展开";
      } else {
        arrow.style.transform = "";
        toggleText.textContent = "收起";
      }
    });
  });
}

// 更新分页控件
function updatePagination() {
  const pagination = document.getElementById("pagination");
  const prevBtn = document.getElementById("prevPage");
  const nextBtn = document.getElementById("nextPage");
  const pageInfo = document.getElementById("pageInfo");
  
  if (totalPages <= 1) {
    pagination.style.display = 'none';
    return;
  }
  
  pagination.style.display = 'flex';
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
  pageInfo.textContent = `第 ${currentPage} 页，共 ${totalPages} 页`;
}

// 显示通知
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 20px;
    border-radius: 8px;
    color: white;
    font-weight: bold;
    z-index: 1000;
    animation: slideIn 0.3s ease;
  `;
  
  if (type === 'success') {
    notification.style.background = 'linear-gradient(135deg, #4caf50 0%, #45a049 100%)';
  } else if (type === 'error') {
    notification.style.background = 'linear-gradient(135deg, #f44336 0%, #d32f2f 100%)';
  } else {
    notification.style.background = 'linear-gradient(135deg, #2196f3 0%, #1976d2 100%)';
  }
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    }, 300);
  }, 4000);
}