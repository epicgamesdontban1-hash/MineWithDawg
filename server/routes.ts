import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { insertBotConnectionSchema, insertChatMessageSchema, insertBotLogSchema } from "@shared/schema";
import { ZodError } from "zod";
import { Client, GatewayIntentBits, TextChannel, ChannelType } from 'discord.js';

// Import mineflayer for Minecraft bot functionality
import mineflayer from 'mineflayer';

interface BotInstance {
  bot: any;
  connectionId: string;
  ws: WebSocket;
  alwaysOnline?: boolean;
}

const activeBots = new Map<string, BotInstance>();

// Discord bot setup
const discordClient = new Client({ 
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent
  ] 
});

interface HelpSession {
  sessionId: string;
  clientWs: WebSocket;
  discordChannelId: string;
  isActive: boolean;
  createdAt: Date;
}

const activeHelpSessions = new Map<string, HelpSession>();

// Discord bot configuration - you'll need to set these as environment variables
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

// Initialize Discord bot
if (DISCORD_TOKEN && DISCORD_GUILD_ID) {
  discordClient.login(DISCORD_TOKEN);
  
  discordClient.on('ready', () => {
    console.log(`Discord bot logged in as ${discordClient.user?.tag}`);
  });

  discordClient.on('messageCreate', async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    // Find help session for this channel
    const helpSession = Array.from(activeHelpSessions.values()).find(
      session => session.discordChannelId === message.channel.id
    );

    if (helpSession && helpSession.clientWs.readyState === WebSocket.OPEN) {
      // Send Discord message to client
      helpSession.clientWs.send(JSON.stringify({
        type: 'help_message',
        data: {
          sessionId: helpSession.sessionId,
          message: message.content,
          author: message.author.username,
          timestamp: message.createdAt.toISOString(),
          isAgent: true
        }
      }));
    }
  });
} else {
  console.warn('Discord bot token or guild ID not provided. Help system will be disabled.');
}

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
      
      // Cleanup help sessions
      for (const [sessionId, helpSession] of activeHelpSessions.entries()) {
        if (helpSession.clientWs === ws) {
          handleEndHelpSession(ws, { sessionId }, true);
          break;
        }
      }
      
      // Cleanup any bots associated with this connection, unless Always Online is enabled
      for (const [connectionId, botInstance] of activeBots.entries()) {
        if (botInstance.ws === ws) {
          if (botInstance.alwaysOnline) {
            // Keep bot running but remove WebSocket reference
            botInstance.ws = null as any;
            storage.createBotLog({
              connectionId,
              logLevel: 'info',
              message: 'WebSocket disconnected but bot remains online (Always Online mode)'
            });
            console.log(`Bot ${connectionId} staying online due to Always Online mode`);
          } else {
            // Normal cleanup - disconnect bot
            if (botInstance.bot) {
              botInstance.bot.quit();
            }
            activeBots.delete(connectionId);
          }
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
      case 'get_inventory':
        await handleGetInventory(ws, data);
        break;
      case 'enable_always_online':
        await handleEnableAlwaysOnline(ws, data);
        break;
      case 'disable_always_online':
        await handleDisableAlwaysOnline(ws, data);
        break;
      case 'drop_item':
        await handleDropItem(ws, data);
        break;
      case 'start_help_session':
        await handleStartHelpSession(ws, data);
        break;
      case 'send_help_message':
        await handleSendHelpMessage(ws, data);
        break;
      case 'end_help_session':
        await handleEndHelpSession(ws, data);
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
      const { connectionId, username, serverIp, version, messageOnLoad, messageOnLoadDelay } = data;
      const [host, port] = serverIp.split(':');
      
      const bot = mineflayer.createBot({
        host: host,
        port: port ? parseInt(port) : 25565,
        username: username,
        version: version,
        auth: 'offline'
      });

      // Add comprehensive error handling for bot events
      const originalEmit = bot.emit;
      bot.emit = function(event: any, ...args: any[]) {
        try {
          return originalEmit.apply(this, [event, ...args]);
        } catch (error: any) {
          console.log('Caught bot event error:', error);
          
          // Handle various known error types gracefully
          if (error.message && (
            error.message.includes('unknown chat format code') ||
            error.message.includes('Cannot read properties of undefined') ||
            error.message.includes('Vec3') ||
            error.message.includes('physics') ||
            error.message.includes('explosion') ||
            error.message.includes('partial packet')
          )) {
            // Handle parsing/physics errors gracefully
            ws.send(JSON.stringify({
              type: 'bot_error',
              message: 'Packet parsing error - bot continuing to run'
            }));
            
            storage.createBotLog({
              connectionId,
              logLevel: 'warning',
              message: `Packet error handled: ${error.message}`
            });
            
            return false;
          }
          throw error;
        }
      };

      activeBots.set(connectionId, { bot, connectionId, ws });

      // Handle general bot errors
      bot.on('error', (error: any) => {
        console.log('Bot error:', error);
        
        // Don't crash on various known error types
        if (error.message && (
          error.message.includes('unknown chat format code') ||
          error.message.includes('Cannot read properties of undefined') ||
          error.message.includes('Vec3') ||
          error.message.includes('physics') ||
          error.message.includes('explosion') ||
          error.message.includes('partial packet') ||
          error.message.includes('client timed out')
        )) {
          ws.send(JSON.stringify({
            type: 'bot_error',
            message: 'Server compatibility error - bot continuing to run'
          }));
          
          storage.createBotLog({
            connectionId,
            logLevel: 'warning',
            message: `Error handled: ${error.message}`
          });
          return;
        }
        
        ws.send(JSON.stringify({
          type: 'bot_error',
          message: `Bot error: ${error.message || 'Unknown error'}`
        }));
      });

      // Add uncaught exception handler specifically for this bot
      const handleUncaughtException = (error: any) => {
        console.log('Uncaught exception in bot process:', error);
        
        if (error.message && (
          error.message.includes('unknown chat format code') ||
          error.message.includes('Cannot read properties of undefined') ||
          error.message.includes('Vec3') ||
          error.message.includes('physics') ||
          error.message.includes('explosion') ||
          error.message.includes('partial packet') ||
          error.message.includes('client timed out')
        )) {
          ws.send(JSON.stringify({
            type: 'bot_error',
            message: 'Server compatibility error - bot continuing to run'
          }));
          
          storage.createBotLog({
            connectionId,
            logLevel: 'warning',
            message: `Uncaught error handled: ${error.message}`
          });
          return;
        }
        
        // For other uncaught exceptions, still try to keep the bot running
        ws.send(JSON.stringify({
          type: 'bot_error',
          message: `Uncaught error: ${error.message || 'Unknown error'}`
        }));
      };

      process.on('uncaughtException', handleUncaughtException);
      
      // Clean up the handler when bot disconnects
      bot.on('end', () => {
        process.removeListener('uncaughtException', handleUncaughtException);
      });

      bot.on('login', async () => {
        await storage.updateBotConnection(connectionId, { isConnected: true });
        await storage.createBotLog({
          connectionId,
          logLevel: 'info',
          message: `Bot ${username} successfully logged into server`
        });
        
        // Get server info
        const serverInfo = {
          version: bot.version,
          players: `${Object.keys(bot.players).length}/${bot.game?.maxPlayers || 20}`,
          maxPlayers: bot.game?.maxPlayers || 20
        };
        
        ws.send(JSON.stringify({ 
          type: 'bot_connected', 
          data: { 
            connectionId, 
            username,
            version: serverInfo.version,
            players: serverInfo.players,
            messageOnLoad: data.messageOnLoad,
            messageOnLoadDelay: data.messageOnLoadDelay
          } 
        }));
        
        // Send server info update
        ws.send(JSON.stringify({
          type: 'server_info_update',
          data: {
            version: serverInfo.version,
            players: serverInfo.players,
            motd: "Connected"
          }
        }));
        
        // Send initial players list
        const playersList = Object.values(bot.players).map((player: any) => ({
          uuid: player.uuid,
          username: player.username,
          ping: player.ping
        }));
        
        ws.send(JSON.stringify({
          type: 'players_update',
          data: {
            players: playersList,
            maxPlayers: serverInfo.maxPlayers
          }
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

        // Handle message on load
        if (data.messageOnLoad && data.messageOnLoad.trim()) {
          setTimeout(() => {
            try {
              const messageToSend = data.messageOnLoad.trim();
              bot.chat(messageToSend);
              
              const isCommand = messageToSend.startsWith('/');
              storage.createChatMessage({
                connectionId,
                username: bot.username,
                message: messageToSend,
                messageType: isCommand ? 'console' : 'chat',
                isCommand: isCommand
              });
              
              storage.createBotLog({
                connectionId,
                logLevel: 'info',
                message: `Message on load sent: ${messageToSend}`
              });
            } catch (error) {
              console.error('Error sending message on load:', error);
              storage.createBotLog({
                connectionId,
                logLevel: 'error',
                message: `Failed to send message on load: ${error instanceof Error ? error.message : 'Unknown error'}`
              });
            }
          }, data.messageOnLoadDelay || 2000);
        }
      });

      // Handle all chat messages (from players)
      bot.on('chat', async (username: string, message: string) => {
        try {
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
        } catch (error) {
          console.log('Chat message error:', error);
        }
      });

      // Handle system messages (server messages, join/leave, etc.)
      bot.on('message', async (jsonMsg: any) => {
        try {
          let message: string;
          
          // Handle different message formats safely
          if (typeof jsonMsg === 'string') {
            message = jsonMsg;
          } else if (jsonMsg && typeof jsonMsg.toString === 'function') {
            message = jsonMsg.toString();
          } else if (jsonMsg && jsonMsg.text) {
            message = jsonMsg.text;
          } else {
            message = '[Unable to parse message]';
          }
          
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
        } catch (error) {
          console.log('Message parsing error:', error);
          
          // Still try to log something for debugging
          const fallbackMessage = await storage.createChatMessage({
            connectionId,
            username: 'Server',
            message: '[Message parsing failed]',
            messageType: 'system',
            isCommand: false
          });
          
          ws.send(JSON.stringify({ 
            type: 'chat_message', 
            data: fallbackMessage 
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
        
        // Update players list
        const playersList = Object.values(bot.players).map((p: any) => ({
          uuid: p.uuid,
          username: p.username,
          ping: p.ping
        }));
        
        ws.send(JSON.stringify({
          type: 'players_update',
          data: {
            players: playersList,
            maxPlayers: bot.game?.maxPlayers || 20
          }
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
        
        // Update players list
        const playersList = Object.values(bot.players).map((p: any) => ({
          uuid: p.uuid,
          username: p.username,
          ping: p.ping
        }));
        
        ws.send(JSON.stringify({
          type: 'players_update',
          data: {
            players: playersList,
            maxPlayers: bot.game?.maxPlayers || 20
          }
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

      bot.on('end', async (reason?: string) => {
        const botInstance = activeBots.get(connectionId);
        
        await storage.updateBotConnection(connectionId, { isConnected: false });
        
        let disconnectReason = reason || 'Connection ended';
        let logMessage = `Bot ${username} disconnected from server`;
        
        if (reason) {
          logMessage += ` - Reason: ${reason}`;
        }
        
        await storage.createBotLog({
          connectionId,
          logLevel: 'warning',
          message: logMessage
        });
        
        // Check if Always Online is enabled and attempt reconnection
        if (botInstance?.alwaysOnline && !reason?.includes('kicked')) {
          await storage.createBotLog({
            connectionId,
            logLevel: 'info',
            message: 'Always Online mode active - attempting auto-reconnection in 3 seconds'
          });
          
          setTimeout(async () => {
            try {
              await handleBotReconnect(connectionId, { username, serverIp, version, host, port });
            } catch (error) {
              await storage.createBotLog({
                connectionId,
                logLevel: 'error',
                message: `Always Online reconnection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
              });
              
              // Try again in 10 seconds
              setTimeout(async () => {
                try {
                  await handleBotReconnect(connectionId, { username, serverIp, version, host, port });
                } catch (retryError) {
                  await storage.createBotLog({
                    connectionId,
                    logLevel: 'error',
                    message: `Always Online retry failed: ${retryError instanceof Error ? retryError.message : 'Unknown error'}`
                  });
                }
              }, 10000);
            }
          }, 3000);
        } else {
          activeBots.delete(connectionId);
        }
        
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ 
            type: 'bot_disconnected', 
            data: { 
              connectionId,
              reason: disconnectReason
            } 
          }));
        }
      });

      // Handle kick events specifically
      bot.on('kicked', async (reason: string) => {
        const kickReason = reason || 'Kicked from server';
        await storage.createBotLog({
          connectionId,
          logLevel: 'warning',
          message: `Bot ${username} was kicked: ${kickReason}`
        });
        
        ws.send(JSON.stringify({ 
          type: 'bot_disconnected', 
          data: { 
            connectionId,
            reason: kickReason
          } 
        }));
      });

      // Send ping, position, and server info updates
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
          
          // Send updated server info and players list
          const playersList = Object.values(bot.players).map((player: any) => ({
            uuid: player.uuid,
            username: player.username,
            ping: player.ping
          }));
          
          ws.send(JSON.stringify({
            type: 'server_info_update',
            data: {
              version: bot.version,
              players: `${playersList.length}/${bot.game?.maxPlayers || 20}`,
              motd: "Connected"
            }
          }));
          
          ws.send(JSON.stringify({
            type: 'players_update',
            data: {
              players: playersList,
              maxPlayers: bot.game?.maxPlayers || 20
            }
          }));
        }
      }, 3000);
      
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
      
      try {
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
          case 'sneak':
          case 'crouch':
            bot.setControlState('sneak', action === 'start');
            break;
        }
      } catch (error) {
        console.error('Movement error:', error);
      }
    }
  }

  async function handleGetInventory(ws: WebSocket, data: any) {
    const { connectionId } = data;
    const botInstance = activeBots.get(connectionId);
    
    if (botInstance && botInstance.bot) {
      const bot = botInstance.bot;
      
      try {
        // Get the bot's inventory as a simple list
        const inventoryItems = [];
        
        // Check all inventory slots
        if (bot.inventory && bot.inventory.slots) {
          for (let i = 0; i < bot.inventory.slots.length; i++) {
            const item = bot.inventory.slots[i];
            if (item && item.name) {
              inventoryItems.push({
                slot: i,
                name: item.name.replace('minecraft:', ''),
                count: item.count || 1,
                displayName: item.displayName || item.name.replace('minecraft:', '')
              });
            }
          }
        }
        
        ws.send(JSON.stringify({
          type: 'inventory_update',
          data: { 
            inventory: inventoryItems,
            totalItems: inventoryItems.length
          }
        }));
        
        await storage.createBotLog({
          connectionId,
          logLevel: 'info',
          message: `Retrieved inventory: ${inventoryItems.length} items`
        });
        
      } catch (error) {
        console.error('Inventory error:', error);
        await storage.createBotLog({
          connectionId,
          logLevel: 'error',
          message: `Failed to retrieve inventory: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
        
        // Send empty inventory on error
        ws.send(JSON.stringify({
          type: 'inventory_update',
          data: { inventory: [], totalItems: 0 }
        }));
      }
    }
  }

  async function handleEnableAlwaysOnline(ws: WebSocket, data: any) {
    const { connectionId } = data;
    const botInstance = activeBots.get(connectionId);
    
    if (botInstance) {
      botInstance.alwaysOnline = true;
      
      await storage.createBotLog({
        connectionId,
        logLevel: 'info',
        message: 'Always Online mode enabled - bot will persist connections'
      });
      
      ws.send(JSON.stringify({
        type: 'always_online_enabled',
        data: { connectionId }
      }));
    }
  }

  async function handleDisableAlwaysOnline(ws: WebSocket, data: any) {
    const { connectionId } = data;
    const botInstance = activeBots.get(connectionId);
    
    if (botInstance) {
      botInstance.alwaysOnline = false;
      
      await storage.createBotLog({
        connectionId,
        logLevel: 'info',
        message: 'Always Online mode disabled'
      });
      
      ws.send(JSON.stringify({
        type: 'always_online_disabled',
        data: { connectionId }
      }));
    }
  }

  async function handleDropItem(ws: WebSocket, data: any) {
    const { connectionId, slot } = data;
    const botInstance = activeBots.get(connectionId);
    
    if (botInstance && botInstance.bot) {
      const bot = botInstance.bot;
      
      try {
        // Check if slot has an item
        if (bot.inventory && bot.inventory.slots[slot]) {
          const item = bot.inventory.slots[slot];
          
          // Drop the item
          await bot.toss(slot, item.count);
          
          await storage.createBotLog({
            connectionId,
            logLevel: 'info',
            message: `Dropped item from slot ${slot}: ${item.name} x${item.count}`
          });
          
          ws.send(JSON.stringify({
            type: 'item_dropped',
            data: { 
              slot,
              itemName: item.name,
              count: item.count
            }
          }));
          
        } else {
          await storage.createBotLog({
            connectionId,
            logLevel: 'warning',
            message: `No item found in slot ${slot} to drop`
          });
        }
        
      } catch (error) {
        console.error('Drop item error:', error);
        await storage.createBotLog({
          connectionId,
          logLevel: 'error',
          message: `Failed to drop item from slot ${slot}: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
        
        ws.send(JSON.stringify({
          type: 'drop_item_error',
          data: { 
            slot,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        }));
      }
    }
  }

  async function handleBotReconnect(connectionId: string, connectionData: any) {
    const { username, serverIp, version, host, port } = connectionData;
    const botInstance = activeBots.get(connectionId);
    
    if (!botInstance) return;
    
    const newBot = mineflayer.createBot({
      host: host,
      port: port ? parseInt(port) : 25565,
      username: username,
      version: version,
      auth: 'offline'
    });

    // Update bot instance
    botInstance.bot = newBot;
    
    // Setup all event handlers for the new bot
    setupAllBotEventHandlers(newBot, connectionId, username, botInstance.ws);
    
    await storage.createBotLog({
      connectionId,
      logLevel: 'info',
      message: 'Always Online reconnection successful'
    });
  }

  function setupAllBotEventHandlers(bot: any, connectionId: string, username: string, ws: WebSocket) {
    // Handle general bot errors
    bot.on('error', (error: any) => {
      console.log('Bot error:', error);
      
      if (error.message && (
        error.message.includes('unknown chat format code') ||
        error.message.includes('Cannot read properties of undefined') ||
        error.message.includes('Vec3') ||
        error.message.includes('physics') ||
        error.message.includes('explosion') ||
        error.message.includes('partial packet') ||
        error.message.includes('client timed out')
      )) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'bot_error',
            message: 'Server compatibility error - bot continuing to run'
          }));
        }
        
        storage.createBotLog({
          connectionId,
          logLevel: 'warning',
          message: `Error handled: ${error.message}`
        });
        return;
      }
      
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'bot_error',
          message: `Bot error: ${error.message || 'Unknown error'}`
        }));
      }
    });

    bot.on('login', async () => {
      await storage.updateBotConnection(connectionId, { isConnected: true });
      await storage.createBotLog({
        connectionId,
        logLevel: 'info',
        message: `Bot ${username} successfully reconnected to server`
      });
      
      const serverInfo = {
        version: bot.version,
        players: `${Object.keys(bot.players).length}/${bot.game?.maxPlayers || 20}`,
        maxPlayers: bot.game?.maxPlayers || 20
      };
      
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ 
          type: 'bot_connected', 
          data: { 
            connectionId, 
            username,
            version: serverInfo.version,
            players: serverInfo.players
          } 
        }));
        
        ws.send(JSON.stringify({
          type: 'server_info_update',
          data: {
            version: serverInfo.version,
            players: serverInfo.players,
            motd: "Reconnected"
          }
        }));
      }
    });

    // Setup all other event handlers (chat, players, etc.)
    bot.on('chat', async (username: string, message: string) => {
      try {
        const chatMessage = await storage.createChatMessage({
          connectionId,
          username,
          message,
          messageType: 'chat',
          isCommand: false
        });
        
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ 
            type: 'chat_message', 
            data: chatMessage 
          }));
        }
      } catch (error) {
        console.log('Chat message error:', error);
      }
    });

    bot.on('message', async (jsonMsg: any) => {
      try {
        let message: string;
        
        if (typeof jsonMsg === 'string') {
          message = jsonMsg;
        } else if (jsonMsg && typeof jsonMsg.toString === 'function') {
          message = jsonMsg.toString();
        } else if (jsonMsg && jsonMsg.text) {
          message = jsonMsg.text;
        } else {
          message = '[Unable to parse message]';
        }
        
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
          
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ 
              type: 'chat_message', 
              data: systemMessage 
            }));
          }
        }
      } catch (error) {
        console.log('Message parsing error:', error);
      }
    });

    // Setup update interval
    const updateInterval = setInterval(() => {
      if (bot.player && ws && ws.readyState === WebSocket.OPEN) {
        const ping = bot.player.ping || 0;
        storage.updateBotConnection(connectionId, { lastPing: ping });
        ws.send(JSON.stringify({ 
          type: 'ping_update', 
          data: { ping } 
        }));
        
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
        
        const playersList = Object.values(bot.players).map((player: any) => ({
          uuid: player.uuid,
          username: player.username,
          ping: player.ping
        }));
        
        ws.send(JSON.stringify({
          type: 'server_info_update',
          data: {
            version: bot.version,
            players: `${playersList.length}/${bot.game?.maxPlayers || 20}`,
            motd: "Connected"
          }
        }));
        
        ws.send(JSON.stringify({
          type: 'players_update',
          data: {
            players: playersList,
            maxPlayers: bot.game?.maxPlayers || 20
          }
        }));
      }
    }, 3000);
    
    bot.on('end', () => {
      clearInterval(updateInterval);
    });
  }

  async function handleStartHelpSession(ws: WebSocket, data: any) {
    if (!discordClient.isReady() || !DISCORD_GUILD_ID) {
      ws.send(JSON.stringify({
        type: 'help_error',
        data: { error: 'Help system is currently unavailable' }
      }));
      return;
    }

    // Check if client already has an active session
    const existingSession = Array.from(activeHelpSessions.values()).find(
      session => session.clientWs === ws && session.isActive
    );

    if (existingSession) {
      ws.send(JSON.stringify({
        type: 'help_session_exists',
        data: { sessionId: existingSession.sessionId }
      }));
      return;
    }

    try {
      const guild = discordClient.guilds.cache.get(DISCORD_GUILD_ID);
      if (!guild) {
        throw new Error('Guild not found');
      }

      const sessionId = `help-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      
      // Create Discord channel
      const channel = await guild.channels.create({
        name: `help-${sessionId.split('-')[1]}`,
        type: ChannelType.GuildText,
        topic: `Help session started at ${new Date().toISOString()}`
      });

      // Send initial message and ping everyone
      await channel.send('🆘 **New Help Request** 🆘\nA user has requested assistance. Please respond here to help them.\n@everyone');

      const helpSession: HelpSession = {
        sessionId,
        clientWs: ws,
        discordChannelId: channel.id,
        isActive: true,
        createdAt: new Date()
      };

      activeHelpSessions.set(sessionId, helpSession);

      ws.send(JSON.stringify({
        type: 'help_session_started',
        data: {
          sessionId,
          initialMessage: 'A human agent will be with you shortly'
        }
      }));

    } catch (error) {
      console.error('Error starting help session:', error);
      ws.send(JSON.stringify({
        type: 'help_error',
        data: { error: 'Failed to start help session' }
      }));
    }
  }

  async function handleSendHelpMessage(ws: WebSocket, data: any) {
    const { sessionId, message } = data;
    const helpSession = activeHelpSessions.get(sessionId);

    if (!helpSession || helpSession.clientWs !== ws) {
      ws.send(JSON.stringify({
        type: 'help_error',
        data: { error: 'Invalid help session' }
      }));
      return;
    }

    try {
      const channel = await discordClient.channels.fetch(helpSession.discordChannelId) as TextChannel;
      if (channel) {
        await channel.send(`**User:** ${message}`);
        
        // Echo message back to client
        ws.send(JSON.stringify({
          type: 'help_message',
          data: {
            sessionId,
            message,
            author: 'You',
            timestamp: new Date().toISOString(),
            isAgent: false
          }
        }));
      }
    } catch (error) {
      console.error('Error sending help message:', error);
      ws.send(JSON.stringify({
        type: 'help_error',
        data: { error: 'Failed to send message' }
      }));
    }
  }

  async function handleEndHelpSession(ws: WebSocket, data: any, isCleanup: boolean = false) {
    const { sessionId } = data;
    const helpSession = activeHelpSessions.get(sessionId);

    if (!helpSession) {
      if (!isCleanup) {
        ws.send(JSON.stringify({
          type: 'help_error',
          data: { error: 'Help session not found' }
        }));
      }
      return;
    }

    try {
      // Archive/delete the Discord channel
      const channel = await discordClient.channels.fetch(helpSession.discordChannelId) as TextChannel;
      if (channel) {
        await channel.send('🔒 **Help session ended** 🔒\nThis channel will be archived.');
        // You can choose to delete the channel or just archive it
        // await channel.delete();
      }

      activeHelpSessions.delete(sessionId);

      if (!isCleanup && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'help_session_ended',
          data: { sessionId }
        }));
      }

    } catch (error) {
      console.error('Error ending help session:', error);
      if (!isCleanup) {
        ws.send(JSON.stringify({
          type: 'help_error',
          data: { error: 'Failed to end help session properly' }
        }));
      }
    }
  }

  return httpServer;
}
