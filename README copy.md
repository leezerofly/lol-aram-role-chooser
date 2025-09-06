# 英雄联盟大乱斗选角器

一个支持多人在线的英雄联盟大乱斗选角器，使用Node.js + Socket.IO实现实时同步。

## 功能特点

- 🎮 **多人在线** - 支持两人同时在线选角
- 🏠 **房间系统** - 创建房间，分享给朋友
- ⚡ **实时同步** - 使用Socket.IO实现实时数据同步
- 🎯 **准备系统** - 双方准备后自动生成阵容
- 🆔 **UUID记录** - 每场比赛都有唯一标识符
- 💾 **数据持久化** - 使用SQLite数据库存储比赛记录
- 📱 **响应式设计** - 支持桌面端和移动端

## 安装和运行

### 方法1：使用启动脚本（推荐）
1. 双击运行 `start.bat`
2. 等待依赖安装完成
3. 服务器启动后访问 `http://localhost:4000`

### 方法2：手动安装
```bash
# 安装依赖
npm install

# 启动服务器
npm start
```

## 使用说明

### 房主操作
1. 输入你的昵称
2. 点击"创建房间"
3. 获得房间号后，点击"分享房间"发送给朋友
4. 等待朋友加入后，点击"准备"
5. 双方都准备后，系统自动生成阵容

### 朋友操作
1. 输入你的昵称
2. 输入房主分享的房间号
3. 点击"加入房间"
4. 点击"准备"
5. 等待房主也准备后，系统自动生成阵容

## 技术栈

- **前端**: HTML5, CSS3, JavaScript (ES6+)
- **后端**: Node.js, Express
- **实时通信**: Socket.IO
- **数据库**: SQLite3
- **API**: 英雄联盟官方API

## 项目结构

```
├── server.js          # 服务端主文件
├── package.json       # 项目配置
├── index.html         # 前端页面
├── script.js          # 前端逻辑
├── style.css          # 样式文件
├── start.bat          # Windows启动脚本
└── matches.db         # SQLite数据库（运行后生成）
```

## API接口

### 创建房间
```
POST /api/create-room
Response: { success: true, roomId: "ABC123" }
```

### 加入房间
```
POST /api/join-room
Body: { roomId: "ABC123", playerName: "玩家名" }
Response: { success: true, message: "成功加入房间" }
```

### 查询比赛记录
```
GET /api/match/:uuid
Response: { success: true, match: {...} }
```

## 注意事项

- 确保网络连接正常，需要访问英雄联盟官方API
- 建议使用现代浏览器（Chrome, Firefox, Safari, Edge）
- 服务器默认运行在4000端口，可在server.js中修改

## 开发说明

如需修改代码，建议使用开发模式：
```bash
npm run dev
```

这将使用nodemon自动重启服务器，方便开发调试。
