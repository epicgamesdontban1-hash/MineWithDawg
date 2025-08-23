import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { insertBotConnectionSchema, insertChatMessageSchema, insertBotLogSchema } from "@shared/schema";
import { ZodError } from "zod";

// Import mineflayer for Minecraft bot functionality
import mineflayer from 'mineflayer';

interface BotInstance {
  bot: any;
  connectionId: string;
  ws: WebSocket;
}

const activeBots = new Map<string, BotInstance>();

export async function registerRoutes(app: Express): Promise<Server> {
  console.log('Mineflayer loaded successfully');
  // API Routes
  app.post("/api/connections", async (req, res) => {
    try {
      const connectionData = insertBotConnectionSchema.parse(req.body);
      const connection = await storage.createBotConnection(connectionData);
      res.json(connection);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: "Invalid connection data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to create connection" });
      }
    }
  });

  app.get("/api/connections/:id", async (req, res) => {
    try {
      const connection = await storage.getBotConnection(req.params.id);
      if (!connection) {
        return res.status(404).json({ message: "Connection not found" });
      }
      res.json(connection);
    } catch (error) {
      res.status(500).json({ message: "Failed to get connection" });
    }
  });

  app.get("/api/connections/:id/messages", async (req, res) => {
    try {
      const messages = await storage.getChatMessages(req.params.id);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ message: "Failed to get messages" });
    }
  });

  app.get("/api/connections/:id/logs", async (req, res) => {
    try {
      const logs = await storage.getBotLogs(req.params.id);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ message: "Failed to get logs" });
    }
  });

  app.get("/api/admin/connections", async (req, res) => {
    try {
      const connections = await storage.getAllBotConnections();
      const connectionsWithStatus = connections.map(conn => ({
        ...conn,
        isActive: activeBots.has(conn.id)
      }));
      res.json(connectionsWithStatus);
    } catch (error) {
      res.status(500).json({ message: "Failed to get connections" });
    }
  });

  app.delete("/api/admin/connections/:id", async (req, res) => {
    try {
      const connectionId = req.params.id;
      const botInstance = activeBots.get(connectionId);
      
      if (botInstance) {
        if (botInstance.bot) {
          botInstance.bot.quit();
        }
        activeBots.delete(connectionId);
        await storage.updateBotConnection(connectionId, { isConnected: false });
        
        // Notify the WebSocket client
        if (botInstance.ws && botInstance.ws.readyState === WebSocket.OPEN) {
          botInstance.ws.send(JSON.stringify({ 
            type: 'bot_disconnected', 
            data: { connectionId } 
          }));
        }
      }
      
      res.json({ success: true, message: "Bot terminated successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to terminate bot" });
    }
  });

  const httpServer = createServer(app);

  // WebSocket Server
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    console.log('WebSocket client connected');

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        await handleWebSocketMessage(ws, message);
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
      // Cleanup any bots associated with this connection
      for (const [connectionId, botInstance] of activeBots.entries()) {
        if (botInstance.ws === ws) {
          if (botInstance.bot) {
            botInstance.bot.quit();
          }
          activeBots.delete(connectionId);
          break;
        }
      }
    });
  });

  async function handleWebSocketMessage(ws: WebSocket, message: any) {
    const { type, data } = message;

    switch (type) {
      case 'connect_bot':
        await handleBotConnect(ws, data);
        break;
      case 'disconnect_bot':
        await handleBotDisconnect(ws, data);
        break;
      case 'send_chat':
        await handleSendChat(ws, data);
        break;
      case 'send_command':
        await handleSendCommand(ws, data);
        break;
      case 'move_bot':
        await handleBotMovement(ws, data);
        break;
      default:
        ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
    }
  }

  async function handleBotConnect(ws: WebSocket, data: any) {
    if (!mineflayer) {
      ws.send(JSON.stringify({ 
        type: 'connection_error', 
        message: 'Mineflayer not available. Please install the mineflayer package.' 
      }));
      return;
    }

    try {
      const { connectionId, username, serverIp, version } = data;
      const [host, port] = serverIp.split(':');
      
      const bot = mineflayer.createBot({
        host: host,
        port: port ? parseInt(port) : 25565,
        username: username,
        version: version,
        auth: 'offline'
      });

      activeBots.set(connectionId, { bot, connectionId, ws });

      bot.on('login', async () => {
        await storage.updateBotConnection(connectionId, { isConnected: true });
        await storage.createBotLog({
          connectionId,
          logLevel: 'info',
          message: `Bot ${username} successfully logged into server`
        });
        ws.send(JSON.stringify({ 
          type: 'bot_connected', 
          data: { connectionId, username } 
        }));
        
        // Send initial position
        if (bot.entity) {
          ws.send(JSON.stringify({
            type: 'position_update',
            data: {
              x: bot.entity.position.x.toFixed(2),
              y: bot.entity.position.y.toFixed(2),
              z: bot.entity.position.z.toFixed(2)
            }
          }));
        }
      });

      // Handle all chat messages (from players)
      bot.on('chat', async (username: string, message: string) => {
        const chatMessage = await storage.createChatMessage({
          connectionId,
          username,
          message,
          messageType: 'chat',
          isCommand: false
        });
        
        ws.send(JSON.stringify({ 
          type: 'chat_message', 
          data: chatMessage 
        }));
      });

      // Handle system messages (server messages, join/leave, etc.)
      bot.on('message', async (jsonMsg: any) => {
        const message = jsonMsg.toString();
        
        // Filter out regular chat messages and empty messages
        // Skip messages that:
        // - Start with '<' (regular chat format)
        // - Contain '»' (formatted chat messages) 
        // - Contain '[Player]' (player chat indicators)
        // - Are empty
        if (message && 
            !message.startsWith('<') && 
            !message.includes('»') && 
            !message.includes('[Player]') &&
            !message.match(/\[\d{2}:\d{2}:\d{2}\]\[Server\]\[Player\]/) &&
            message.trim() !== '') {
          
          const systemMessage = await storage.createChatMessage({
            connectionId,
            username: 'Server',
            message,
            messageType: 'system',
            isCommand: false
          });
          
          ws.send(JSON.stringify({ 
            type: 'chat_message', 
            data: systemMessage 
          }));
        }
      });

      // Handle player join/leave
      bot.on('playerJoined', async (player: any) => {
        const joinMessage = await storage.createChatMessage({
          connectionId,
          username: 'Server',
          message: `${player.username} joined the game`,
          messageType: 'join',
          isCommand: false
        });
        
        ws.send(JSON.stringify({ 
          type: 'chat_message', 
          data: joinMessage 
        }));
      });

      bot.on('playerLeft', async (player: any) => {
        const leaveMessage = await storage.createChatMessage({
          connectionId,
          username: 'Server',
          message: `${player.username} left the game`,
          messageType: 'leave',
          isCommand: false
        });
        
        ws.send(JSON.stringify({ 
          type: 'chat_message', 
          data: leaveMessage 
        }));
      });

      // Handle deaths
      bot.on('death', async () => {
        const deathMessage = await storage.createChatMessage({
          connectionId,
          username: 'Server',
          message: `${bot.username} died`,
          messageType: 'death',
          isCommand: false
        });
        
        ws.send(JSON.stringify({ 
          type: 'chat_message', 
          data: deathMessage 
        }));
      });

      bot.on('error', async (err: Error) => {
        console.error('Bot error:', err);
        await storage.createBotLog({
          connectionId,
          logLevel: 'error',
          message: `Bot error: ${err.message}`
        });
        ws.send(JSON.stringify({ 
          type: 'bot_error', 
          message: err.message 
        }));
      });

      bot.on('end', async () => {
        await storage.updateBotConnection(connectionId, { isConnected: false });
        await storage.createBotLog({
          connectionId,
          logLevel: 'warning',
          message: `Bot ${username} disconnected from server`
        });
        activeBots.delete(connectionId);
        ws.send(JSON.stringify({ 
          type: 'bot_disconnected', 
          data: { connectionId } 
        }));
      });

      // Send ping and position updates
      const updateInterval = setInterval(() => {
        if (bot.player && ws.readyState === WebSocket.OPEN) {
          const ping = bot.player.ping || 0;
          storage.updateBotConnection(connectionId, { lastPing: ping });
          ws.send(JSON.stringify({ 
            type: 'ping_update', 
            data: { ping } 
          }));
          
          // Send position update
          if (bot.entity) {
            ws.send(JSON.stringify({
              type: 'position_update',
              data: {
                x: bot.entity.position.x.toFixed(2),
                y: bot.entity.position.y.toFixed(2),
                z: bot.entity.position.z.toFixed(2)
              }
            }));
          }
        }
      }, 2000);
      
      // Cleanup interval on bot end
      bot.on('end', () => {
        clearInterval(updateInterval);
      });

    } catch (error) {
      console.error('Failed to connect bot:', error);
      await storage.createBotLog({
        connectionId: data.connectionId,
        logLevel: 'error',
        message: `Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
      ws.send(JSON.stringify({ 
        type: 'connection_error', 
        message: error instanceof Error ? error.message : 'Failed to connect to server' 
      }));
    }
  }

  async function handleBotDisconnect(ws: WebSocket, data: any) {
    const { connectionId } = data;
    const botInstance = activeBots.get(connectionId);
    
    if (botInstance) {
      if (botInstance.bot) {
        botInstance.bot.quit();
      }
      activeBots.delete(connectionId);
      await storage.updateBotConnection(connectionId, { isConnected: false });
    }
  }

  async function handleSendChat(ws: WebSocket, data: any) {
    const { connectionId, message } = data;
    const botInstance = activeBots.get(connectionId);
    
    if (botInstance && botInstance.bot) {
      botInstance.bot.chat(message);
      
      // Store the message
      await storage.createChatMessage({
        connectionId,
        username: botInstance.bot.username,
        message,
        messageType: 'chat',
        isCommand: false
      });
      
      await storage.createBotLog({
        connectionId,
        logLevel: 'info',
        message: `Sent chat: ${message}`
      });
    }
  }

  async function handleSendCommand(ws: WebSocket, data: any) {
    const { connectionId, command } = data;
    const botInstance = activeBots.get(connectionId);
    
    if (botInstance && botInstance.bot) {
      botInstance.bot.chat(command);
      
      // Store the command
      await storage.createChatMessage({
        connectionId,
        username: botInstance.bot.username,
        message: command,
        messageType: 'console',
        isCommand: true
      });
      
      await storage.createBotLog({
        connectionId,
        logLevel: 'info',
        message: `Executed command: ${command}`
      });
    }
  }

  async function handleBotMovement(ws: WebSocket, data: any) {
    const { connectionId, direction, action } = data;
    const botInstance = activeBots.get(connectionId);
    
    if (botInstance && botInstance.bot) {
      const bot = botInstance.bot;
      
      switch (direction) {
        case 'forward':
          bot.setControlState('forward', action === 'start');
          break;
        case 'back':
          bot.setControlState('back', action === 'start');
          break;
        case 'left':
          bot.setControlState('left', action === 'start');
          break;
        case 'right':
          bot.setControlState('right', action === 'start');
          break;
        case 'jump':
          if (action === 'start') {
            bot.setControlState('jump', true);
            setTimeout(() => bot.setControlState('jump', false), 100);
          }
          break;
      }
    }
  }

  return httpServer;
}
