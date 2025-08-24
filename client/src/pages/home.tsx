import { useState, useEffect, useRef } from "react";
import { useWebSocket } from "@/lib/websocket";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Box, Server, Gamepad2, MessageSquare, Play, Pause, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ChatMessage {
  id: string;
  username: string;
  message: string;
  messageType: string;
  timestamp: Date;
  isCommand: boolean;
}

interface BotLog {
  id: string;
  connectionId: string;
  logLevel: string;
  message: string;
  timestamp: Date;
}

interface ConnectionStatus {
  isConnected: boolean;
  ping: number;
  username: string;
  position: {
    x: string;
    y: string;
    z: string;
  };
  serverInfo: {
    players: string;
    version: string;
    motd: string;
  };
}

interface OnlinePlayer {
  uuid: string;
  username: string;
  ping?: number;
}

interface AdminConnection {
  id: string;
  username: string;
  serverIp: string;
  version: string;
  isConnected: boolean;
  isActive: boolean;
  lastPing?: number;
  createdAt: string;
}

const MINECRAFT_VERSIONS = [
  '1.21.4', '1.21.3', '1.21.2', '1.21.1', '1.21.0',
  '1.20.6', '1.20.4', '1.20.2', '1.20.1',
  '1.19.4', '1.19.2', '1.18.2'
];

const QUICK_COMMANDS = ['/help', '/list', '/spawn', '/home'];

export default function Home() {
  const [username, setUsername] = useState("Player123");
  const [serverIP, setServerIP] = useState("");
  const [version, setVersion] = useState("1.21.4");
  const [chatInput, setChatInput] = useState("");
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [botLogs, setBotLogs] = useState<BotLog[]>([]);
  const [adminConnections, setAdminConnections] = useState<AdminConnection[]>([]);
  const [isLoadingAdmin, setIsLoadingAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'logs' | 'admin' | 'players' | 'inventory'>('chat');
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayer[]>([]);
  const [kickReason, setKickReason] = useState<string | null>(null);
  const [autoReconnect, setAutoReconnect] = useState(false);
  const [lastConnectionData, setLastConnectionData] = useState<{
    username: string;
    serverIp: string;
    version: string;
  } | null>(null);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [messageOnLoad, setMessageOnLoad] = useState("");
  const [messageOnLoadDelay, setMessageOnLoadDelay] = useState(2000);
  const [spammerEnabled, setSpammerEnabled] = useState(false);
  const [spammerMessage, setSpammerMessage] = useState("");
  const [spammerDelay, setSpammerDelay] = useState(1000);
  const [antiKickEnabled, setAntiKickEnabled] = useState(false);
  const [botInventory, setBotInventory] = useState<any[]>([]);
  const [alwaysOnlineEnabled, setAlwaysOnlineEnabled] = useState(false);
  const [showAlwaysOnlineModal, setShowAlwaysOnlineModal] = useState(false);
  const [alwaysOnlinePassword, setAlwaysOnlinePassword] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [showCheckmark, setShowCheckmark] = useState(false);
  const [showHelpChat, setShowHelpChat] = useState(false);
  const [helpSessionId, setHelpSessionId] = useState<string | null>(null);
  const [helpMessages, setHelpMessages] = useState<any[]>([]);
  const [helpInput, setHelpInput] = useState("");
  const autoReconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const spammerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const helpMessagesRef = useRef<HTMLDivElement>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    isConnected: false,
    ping: 0,
    username: "",
    position: {
      x: "--",
      y: "--",
      z: "--"
    },
    serverInfo: {
      players: "0/0",
      version: "--",
      motd: "Offline"
    }
  });

  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const logsRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const { isConnected: wsConnected, sendMessage } = useWebSocket({
    onMessage: (message) => {
      const { type, data } = message;

      switch (type) {
        case 'bot_connected':
          setConnectionStatus(prev => ({
            ...prev,
            isConnected: true,
            username: data.username,
            serverInfo: {
              ...prev.serverInfo,
              motd: "Connected",
              version: data.version || prev.serverInfo.version,
              players: data.players || prev.serverInfo.players
            }
          }));
          setKickReason(null);

          // Send message on load if configured
          if (messageOnLoad.trim()) {
            setTimeout(() => {
              if (sendMessage && connectionStatus.isConnected) {
                const messageToSend = messageOnLoad.trim();
                const isCommand = messageToSend.startsWith('/');
                const messageType = isCommand ? 'send_command' : 'send_chat';
                sendMessage({
                  type: messageType,
                  data: {
                    connectionId: data.connectionId,
                    [isCommand ? 'command' : 'message']: messageToSend
                  }
                });
              }
            }, messageOnLoadDelay);
          }

          toast({
            title: "Bot Connected",
            description: `Successfully connected as ${data.username}`,
          });
          break;

        case 'bot_disconnected':
          setConnectionStatus(prev => ({
            ...prev,
            isConnected: false,
            serverInfo: { ...prev.serverInfo, motd: "Disconnected" }
          }));
          setOnlinePlayers([]);

          // Set kick reason if provided
          if (data.reason) {
            setKickReason(data.reason);
          }

          const disconnectMessage = data.reason
            ? `Bot disconnected: ${data.reason}`
            : autoReconnect ? "Auto-reconnecting in 5 seconds..." : "Disconnected";

          if (autoReconnect && lastConnectionData) {
            toast({
              title: "Bot Disconnected",
              description: data.reason ? `${data.reason} - Auto-reconnecting in 5 seconds...` : "Auto-reconnecting in 5 seconds...",
            });

            // Clear any existing timeout
            if (autoReconnectTimeoutRef.current) {
              clearTimeout(autoReconnectTimeoutRef.current);
            }

            autoReconnectTimeoutRef.current = setTimeout(() => {
              if (lastConnectionData && wsConnected && sendMessage && autoReconnect) {
                console.log('Auto-reconnecting bot...');
                handleReconnect();
              }
            }, 5000);
          } else {
            toast({
              title: "Bot Disconnected",
              description: disconnectMessage,
              variant: data.reason ? "destructive" : "default",
            });
          }
          break;

        case 'chat_message':
          setChatMessages(prev => [...prev, data]);
          break;

        case 'ping_update':
          setConnectionStatus(prev => ({ ...prev, ping: data.ping }));
          break;

        case 'position_update':
          setConnectionStatus(prev => ({
            ...prev,
            position: {
              x: data.x,
              y: data.y,
              z: data.z
            }
          }));
          break;

        case 'server_info_update':
          setConnectionStatus(prev => ({
            ...prev,
            serverInfo: {
              players: data.players || prev.serverInfo.players,
              version: data.version || prev.serverInfo.version,
              motd: data.motd || prev.serverInfo.motd
            }
          }));
          break;

        case 'players_update':
          setOnlinePlayers(data.players || []);
          setConnectionStatus(prev => ({
            ...prev,
            serverInfo: {
              ...prev.serverInfo,
              players: `${data.players?.length || 0}/${data.maxPlayers || 20}`
            }
          }));
          break;

        case 'inventory_update':
          setBotInventory(data.inventory || []);
          break;

        case 'help_session_started':
          setHelpSessionId(data.sessionId);
          setHelpMessages([{
            id: '1',
            message: data.initialMessage,
            author: 'System',
            timestamp: new Date().toISOString(),
            isAgent: true
          }]);
          toast({
            title: "Help Session Started",
            description: "You are now connected to our support team",
          });
          break;

        case 'help_message':
          setHelpMessages(prev => [...prev, {
            id: Date.now().toString(),
            message: data.message,
            author: data.author,
            timestamp: data.timestamp,
            isAgent: data.isAgent
          }]);
          break;

        case 'help_session_ended':
          setHelpSessionId(null);
          setShowHelpChat(false);
          setHelpMessages([]);
          toast({
            title: "Help Session Ended",
            description: "Thank you for using our support system",
          });
          break;

        case 'help_error':
          toast({
            title: "Help System Error",
            description: data.error || "Something went wrong with the help system",
            variant: "destructive",
          });
          break;

        case 'help_session_exists':
          setHelpSessionId(data.sessionId);
          toast({
            title: "Help Session Active",
            description: "You already have an active help session",
          });
          break;

        case 'connection_error':
        case 'bot_error':
          toast({
            title: "Connection Error",
            description: message.message || "Failed to connect to server",
            variant: "destructive",
          });
          break;
      }
    }
  });

  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [chatMessages]);

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [botLogs]);

  useEffect(() => {
    if (helpMessagesRef.current) {
      helpMessagesRef.current.scrollTop = helpMessagesRef.current.scrollHeight;
    }
  }, [helpMessages]);

  // Fetch logs when connected
  useEffect(() => {
    if (connectionId) {
      const fetchLogs = async () => {
        try {
          const response = await fetch(`/api/connections/${connectionId}/logs`);
          if (response.ok) {
            const logs = await response.json();
            setBotLogs(logs);
          }
        } catch (error) {
          console.error('Failed to fetch logs:', error);
        }
      };

      fetchLogs();
      const interval = setInterval(fetchLogs, 5000);
      return () => clearInterval(interval);
    }
  }, [connectionId]);

  // Fetch admin connections on mount and when activeTab is 'admin'
  useEffect(() => {
    if (activeTab === 'admin') {
      const fetchAdminConnections = async () => {
        setIsLoadingAdmin(true);
        try {
          const response = await fetch('/api/admin/connections');
          if (response.ok) {
            const connections = await response.json();
            setAdminConnections(connections);
          }
        } catch (error) {
          console.error('Failed to fetch admin connections:', error);
          toast({
            title: "Error",
            description: "Failed to load bot connections.",
            variant: "destructive",
          });
        } finally {
          setIsLoadingAdmin(false);
        }
      };
      fetchAdminConnections();
    }
  }, [activeTab]);

  const handleConnect = async () => {
    if (!username.trim() || !serverIP.trim()) {
      toast({
        title: "Invalid Input",
        description: "Please enter both username and server IP",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          serverIp: serverIP.trim(),
          version
        })
      });

      if (!response.ok) {
        throw new Error('Failed to create connection');
      }

      const connection = await response.json();
      setConnectionId(connection.id);

      // Store connection data for auto-reconnect
      setLastConnectionData({
        username: username.trim(),
        serverIp: serverIP.trim(),
        version
      });

      if (wsConnected && sendMessage) {
        sendMessage({
          type: 'connect_bot',
          data: {
            connectionId: connection.id,
            username: connection.username,
            serverIp: connection.serverIp,
            version: connection.version,
            messageOnLoad: messageOnLoad,
            messageOnLoadDelay: messageOnLoadDelay
          }
        });
      }
    } catch (error) {
      toast({
        title: "Connection Failed",
        description: error instanceof Error ? error.message : "Failed to connect",
        variant: "destructive",
      });
    }
  };

  const handleDisconnect = () => {
    if (connectionId && sendMessage) {
      sendMessage({
        type: 'disconnect_bot',
        data: { connectionId }
      });
      setConnectionId(null);
      setChatMessages([]);
      setBotLogs([]);
      setAutoReconnect(false);
      setLastConnectionData(null);

      // Clear auto-reconnect timeout
      if (autoReconnectTimeoutRef.current) {
        clearTimeout(autoReconnectTimeoutRef.current);
        autoReconnectTimeoutRef.current = null;
      }

      // Stop spammer
      setSpammerEnabled(false);
      if (spammerIntervalRef.current) {
        clearInterval(spammerIntervalRef.current);
        spammerIntervalRef.current = null;
      }
    }
  };

  const handleReconnect = async () => {
    if (!lastConnectionData) return;

    try {
      const response = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: lastConnectionData.username,
          serverIp: lastConnectionData.serverIp,
          version: lastConnectionData.version
        })
      });

      if (!response.ok) {
        throw new Error('Failed to create connection');
      }

      const connection = await response.json();
      setConnectionId(connection.id);

      if (wsConnected && sendMessage) {
        sendMessage({
          type: 'connect_bot',
          data: {
            connectionId: connection.id,
            username: lastConnectionData.username,
            serverIp: lastConnectionData.serverIp,
            version: lastConnectionData.version
          }
        });
      }
    } catch (error) {
      toast({
        title: "Auto-Reconnect Failed",
        description: error instanceof Error ? error.message : "Failed to reconnect",
        variant: "destructive",
      });
    }
  };

  const handleSendMessage = () => {
    if (!chatInput.trim() || !connectionId || !sendMessage) return;

    const isCommand = chatInput.startsWith('/');
    const messageType = isCommand ? 'send_command' : 'send_chat';
    const content = isCommand ? chatInput : chatInput;

    sendMessage({
      type: messageType,
      data: {
        connectionId,
        [isCommand ? 'command' : 'message']: content
      }
    });

    setChatInput("");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleMovement = (direction: string, action: 'start' | 'stop') => {
    if (connectionId && sendMessage) {
      sendMessage({
        type: 'move_bot',
        data: { connectionId, direction, action }
      });
    }
  };

  const handleQuickCommand = (command: string) => {
    if (connectionId && sendMessage) {
      sendMessage({
        type: 'send_command',
        data: { connectionId, command }
      });
    }
  };

  const handleShowInventory = () => {
    if (connectionId && sendMessage) {
      sendMessage({
        type: 'get_inventory',
        data: { connectionId }
      });
    }
  };

  const handleDropItem = (slot: number) => {
    if (connectionId && sendMessage) {
      sendMessage({
        type: 'drop_item',
        data: { connectionId, slot }
      });
      
      // Refresh inventory after dropping
      setTimeout(() => {
        handleShowInventory();
      }, 500);
    }
  };

  const toggleSpammer = () => {
    if (!spammerEnabled) {
      if (!spammerMessage.trim()) {
        toast({
          title: "Spammer Error",
          description: "Please enter a message to spam",
          variant: "destructive",
        });
        return;
      }

      setSpammerEnabled(true);
      spammerIntervalRef.current = setInterval(() => {
        if (connectionId && sendMessage && spammerMessage.trim()) {
          let messageToSend = spammerMessage.trim();

          // Add random numbers and symbols for anti-kick if enabled
          if (antiKickEnabled) {
            const randomNum = Math.floor(Math.random() * 1000000);
            const symbols = ['!', '@', '#', '$', '%', '^', '&', '*', '~', '?', '+', '-', '=', '|', '\\', '/', ':', ';', '.', ',', '<', '>', '[', ']', '{', '}', '(', ')'];
            const randomSymbol1 = symbols[Math.floor(Math.random() * symbols.length)];
            const randomSymbol2 = symbols[Math.floor(Math.random() * symbols.length)];
            messageToSend = `${messageToSend} ${randomSymbol1}${randomNum}${randomSymbol2}`;
          }

          const isCommand = messageToSend.startsWith('/');
          const messageType = isCommand ? 'send_command' : 'send_chat';
          sendMessage({
            type: messageType,
            data: {
              connectionId,
              [isCommand ? 'command' : 'message']: messageToSend
            }
          });
        }
      }, spammerDelay);
    } else {
      setSpammerEnabled(false);
      if (spammerIntervalRef.current) {
        clearInterval(spammerIntervalRef.current);
        spammerIntervalRef.current = null;
      }
    }
  };

  const handleAdminLogin = () => {
    if (adminPassword === "Operator") {
      setIsAdminAuthenticated(true);
      setShowAdminLogin(false);
      setAdminPassword("");
      toast({
        title: "Access Granted",
        description: "Welcome to Admin Panel",
      });
    } else {
      toast({
        title: "Access Denied",
        description: "Incorrect password",
        variant: "destructive",
      });
      setAdminPassword("");
    }
  };

  const handleAlwaysOnlineToggle = () => {
    if (!alwaysOnlineEnabled) {
      setShowAlwaysOnlineModal(true);
    } else {
      setAlwaysOnlineEnabled(false);
      if (connectionId && sendMessage) {
        sendMessage({
          type: 'disable_always_online',
          data: { connectionId }
        });
      }
      toast({
        title: "Always Online Disabled",
        description: "Bot will disconnect when website is closed",
      });
    }
  };

  const handleAlwaysOnlineAuth = async () => {
    if (alwaysOnlinePassword === "doggomc") {
      setIsAuthenticating(true);

      // Show checkmark animation
      setTimeout(() => {
        setShowCheckmark(true);
        setIsAuthenticating(false);

        setTimeout(() => {
          setAlwaysOnlineEnabled(true);
          setShowAlwaysOnlineModal(false);
          setAlwaysOnlinePassword("");
          setShowCheckmark(false);

          if (connectionId && sendMessage) {
            sendMessage({
              type: 'enable_always_online',
              data: { connectionId }
            });
          }

          toast({
            title: "Always Online Enabled",
            description: "Bot will stay connected even when website is closed",
          });
        }, 1500);
      }, 500);
    } else {
      toast({
        title: "Access Denied",
        description: "Incorrect password",
        variant: "destructive",
      });
      setAlwaysOnlinePassword("");
    }
  };

  const handleAlwaysOnlineCancel = () => {
    setShowAlwaysOnlineModal(false);
    setAlwaysOnlinePassword("");
    setShowCheckmark(false);
    setIsAuthenticating(false);
  };

  const handleStartHelpSession = () => {
    if (wsConnected && sendMessage) {
      sendMessage({
        type: 'start_help_session',
        data: {}
      });
      setShowHelpChat(true);
    } else {
      toast({
        title: "Connection Error",
        description: "Please wait for the connection to establish",
        variant: "destructive",
      });
    }
  };

  const handleSendHelpMessage = () => {
    if (!helpInput.trim() || !helpSessionId || !sendMessage) return;

    sendMessage({
      type: 'send_help_message',
      data: {
        sessionId: helpSessionId,
        message: helpInput.trim()
      }
    });

    setHelpInput("");
  };

  const handleEndHelpSession = () => {
    if (helpSessionId && sendMessage) {
      sendMessage({
        type: 'end_help_session',
        data: { sessionId: helpSessionId }
      });
    }
    setShowHelpChat(false);
    setHelpSessionId(null);
    setHelpMessages([]);
  };

  const handleHelpKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendHelpMessage();
    }
  };

  const handleAdminTabClick = () => {
    if (!isAdminAuthenticated) {
      setShowAdminLogin(true);
    }
    setActiveTab('admin');
  };

  const handleTerminateBot = async (connectionId: string) => {
    try {
      const response = await fetch(`/api/admin/connections/${connectionId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        toast({
          title: "Bot Terminated",
          description: "Bot has been successfully terminated",
        });
        // Refresh the connections list
        const connectionsResponse = await fetch('/api/admin/connections');
        if (connectionsResponse.ok) {
          const connections = await connectionsResponse.json();
          setAdminConnections(connections);
        }
      } else {
        throw new Error('Failed to terminate bot');
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to terminate bot",
        variant: "destructive",
      });
    }
  };

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getMessageStyle = (messageType: string) => {
    switch (messageType) {
      case 'system':
        return 'text-yellow-400';
      case 'join':
        return 'text-green-400';
      case 'leave':
        return 'text-red-400';
      case 'death':
        return 'text-red-500';
      case 'console':
        return 'text-minecraft-gold';
      default:
        return 'text-gray-200';
    }
  };

  const getLogLevelStyle = (level: string) => {
    switch (level) {
      case 'error':
        return 'text-red-400 border-red-400';
      case 'warning':
        return 'text-yellow-400 border-yellow-400';
      case 'info':
        return 'text-blue-400 border-blue-400';
      default:
        return 'text-gray-400 border-gray-400';
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      {/* Header */}
      <header className="bg-gray-800 border-b border-minecraft-dark-stone">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-minecraft-green rounded-lg flex items-center justify-center">
                <Box className="text-white text-xl" />
              </div>
              <div>
                <h1 className="text-2xl font-gaming font-bold text-minecraft-green">MineWithDawg</h1>
                <p className="text-sm text-gray-400">Made by doggo, for doggo V1.51</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full animate-pulse ${
                  connectionStatus.isConnected ? 'bg-status-online' : 'bg-status-offline'
                }`} />
                <span className="text-sm font-medium">
                  {connectionStatus.isConnected ? 'Connected' : 'Offline'}
                </span>
              </div>
              <Button
                onClick={handleStartHelpSession}
                variant="outline"
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 border-blue-600 text-white"
              >
                Get Help
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Connection Panel */}
          <div className="lg:col-span-1">
            <Card className="bg-gray-800 border-minecraft-dark-stone">
              <CardHeader>
                <CardTitle className="text-xl font-gaming font-bold text-minecraft-green flex items-center">
                  <Server className="mr-2" />
                  Server Connection
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="username" className="text-gray-300">Username (Offline)</Label>
                  <Input
                    id="username"
                    data-testid="input-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter your username"
                    className="bg-gray-700 border-gray-600 text-white focus:border-minecraft-green"
                    disabled={connectionStatus.isConnected}
                  />
                </div>

                <div>
                  <Label htmlFor="serverIP" className="text-gray-300">Server IP</Label>
                  <Input
                    id="serverIP"
                    data-testid="input-server-ip"
                    value={serverIP}
                    onChange={(e) => setServerIP(e.target.value)}
                    placeholder="127.0.0.1:25565"
                    className="bg-gray-700 border-gray-600 text-white focus:border-minecraft-green"
                    disabled={connectionStatus.isConnected}
                  />
                </div>

                <div>
                  <Label htmlFor="version" className="text-gray-300">Minecraft Version</Label>
                  <Select value={version} onValueChange={setVersion} disabled={connectionStatus.isConnected}>
                    <SelectTrigger data-testid="select-version" className="bg-gray-700 border-gray-600 text-white focus:border-minecraft-green">
                      <SelectValue placeholder="Select version" />
                    </SelectTrigger>
                    <SelectContent>
                      {MINECRAFT_VERSIONS.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v} {v === '1.21.4' ? '(Latest Supported)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="messageOnLoad" className="text-gray-300">Message on Load (Optional)</Label>
                  <Input
                    id="messageOnLoad"
                    data-testid="input-message-on-load"
                    value={messageOnLoad}
                    onChange={(e) => setMessageOnLoad(e.target.value)}
                    placeholder="Message to send when joining (e.g., 'Hello!' or '/gamemode creative')"
                    className="bg-gray-700 border-gray-600 text-white focus:border-minecraft-green"
                    disabled={connectionStatus.isConnected}
                  />
                  <div className="mt-2">
                    <Label htmlFor="messageOnLoadDelay" className="text-gray-300">Delay (ms)</Label>
                    <Input
                      id="messageOnLoadDelay"
                      data-testid="input-message-on-load-delay"
                      type="number"
                      min="500"
                      max="30000"
                      value={messageOnLoadDelay}
                      onChange={(e) => setMessageOnLoadDelay(Math.max(500, parseInt(e.target.value) || 2000))}
                      className="bg-gray-700 border-gray-600 text-white focus:border-minecraft-green"
                      disabled={connectionStatus.isConnected}
                    />
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    This message will be sent automatically after the specified delay
                  </div>
                </div>

                <div className="flex space-x-3">
                  <Button
                    data-testid="button-connect"
                    onClick={handleConnect}
                    disabled={connectionStatus.isConnected || !wsConnected}
                    className="flex-1 bg-minecraft-green hover:bg-minecraft-dark-green"
                  >
                    <Play className="mr-2 h-4 w-4" />
                    Connect
                  </Button>
                  <Button
                    data-testid="button-disconnect"
                    onClick={handleDisconnect}
                    disabled={!connectionStatus.isConnected}
                    variant="destructive"
                    className="flex-1"
                  >
                    <Pause className="mr-2 h-4 w-4" />
                    Disconnect
                  </Button>
                </div>

                {lastConnectionData && (
                  <div className="flex items-center space-x-3 p-3 bg-gray-700 rounded-lg border border-gray-600 hover:border-minecraft-green/50 transition-all duration-200">
                    <div className="flex items-center space-x-2">
                      <div className="relative">
                        <input
                          type="checkbox"
                          id="auto-reconnect"
                          checked={autoReconnect}
                          onChange={(e) => setAutoReconnect(e.target.checked)}
                          className="w-4 h-4 text-minecraft-green bg-gray-600 border-gray-500 rounded focus:ring-minecraft-green transition-all duration-200"
                        />
                        {autoReconnect && (
                          <div className="absolute -top-1 -right-1 w-2 h-2 bg-minecraft-green rounded-full animate-pulse" />
                        )}
                      </div>
                      <label htmlFor="auto-reconnect" className="text-sm text-gray-300">
                        Auto-reconnect
                      </label>
                    </div>
                    <Button
                      data-testid="button-reconnect"
                      onClick={handleReconnect}
                      disabled={connectionStatus.isConnected || !wsConnected}
                      size="sm"
                      className="bg-minecraft-gold hover:bg-yellow-600 text-gray-900 transition-all duration-200 hover:scale-105"
                    >
                      Reconnect Now
                    </Button>
                  </div>
                )}

                <div className="flex items-center space-x-3 p-3 bg-gray-700 rounded-lg border border-gray-600 hover:border-minecraft-green/50 transition-all duration-200">
                  <div className="flex items-center space-x-2">
                    <div className="relative">
                      <input
                        type="checkbox"
                        id="always-online"
                        checked={alwaysOnlineEnabled}
                        onChange={handleAlwaysOnlineToggle}
                        className="w-4 h-4 text-minecraft-green bg-gray-600 border-gray-500 rounded focus:ring-minecraft-green transition-all duration-200"
                      />
                      {alwaysOnlineEnabled && (
                        <div className="absolute -top-1 -right-1 w-2 h-2 bg-minecraft-green rounded-full animate-pulse" />
                      )}
                    </div>
                    <label htmlFor="always-online" className="text-sm text-gray-300">
                      Always Online
                    </label>
                  </div>
                  {alwaysOnlineEnabled && (
                    <div className="text-xs text-green-400 bg-green-400/10 px-2 py-1 rounded">
                      Bot stays connected when website closes
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gray-700 mt-4">
              <CardContent className="pt-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-300">Status:</span>
                  <Badge variant={connectionStatus.isConnected ? "default" : "destructive"}>
                    {connectionStatus.isConnected ? 'Connected' : 'Disconnected'}
                  </Badge>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-gray-300">Ping:</span>
                  <span className="text-gray-400" data-testid="text-ping">
                    {connectionStatus.ping > 0 ? `${connectionStatus.ping} ms` : '-- ms'}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Movement Controls */}
            <Card className="bg-gray-800 border-minecraft-dark-stone mt-6">
              <CardHeader>
                <CardTitle className="text-lg font-gaming font-bold text-minecraft-green flex items-center">
                  <Gamepad2 className="mr-2" />
                  Movement Controls
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center space-y-2">
                  <Button
                    data-testid="button-move-forward"
                    onMouseDown={() => handleMovement('forward', 'start')}
                    onMouseUp={() => handleMovement('forward', 'stop')}
                    onMouseLeave={() => handleMovement('forward', 'stop')}
                    disabled={!connectionStatus.isConnected}
                    className="w-12 h-12 bg-minecraft-stone hover:bg-minecraft-green text-white font-bold text-lg"
                  >
                    W
                  </Button>

                  <div className="flex space-x-2">
                    <Button
                      data-testid="button-move-left"
                      onMouseDown={() => handleMovement('left', 'start')}
                      onMouseUp={() => handleMovement('left', 'stop')}
                      onMouseLeave={() => handleMovement('left', 'stop')}
                      disabled={!connectionStatus.isConnected}
                      className="w-12 h-12 bg-minecraft-stone hover:bg-minecraft-green text-white font-bold text-lg"
                    >
                      A
                    </Button>
                    <Button
                      data-testid="button-move-back"
                      onMouseDown={() => handleMovement('back', 'start')}
                      onMouseUp={() => handleMovement('back', 'stop')}
                      onMouseLeave={() => handleMovement('back', 'stop')}
                      disabled={!connectionStatus.isConnected}
                      className="w-12 h-12 bg-minecraft-stone hover:bg-minecraft-green text-white font-bold text-lg"
                    >
                      S
                    </Button>
                    <Button
                      data-testid="button-move-right"
                      onMouseDown={() => handleMovement('right', 'start')}
                      onMouseUp={() => handleMovement('right', 'stop')}
                      onMouseLeave={() => handleMovement('right', 'stop')}
                      disabled={!connectionStatus.isConnected}
                      className="w-12 h-12 bg-minecraft-stone hover:bg-minecraft-green text-white font-bold text-lg"
                    >
                      D
                    </Button>
                  </div>

                  <div className="flex space-x-2">
                    <Button
                      data-testid="button-jump"
                      onClick={() => handleMovement('jump', 'start')}
                      disabled={!connectionStatus.isConnected}
                      className="w-16 h-10 bg-minecraft-gold hover:bg-yellow-600 text-gray-900 font-bold"
                    >
                      SPACE
                    </Button>
                    <Button
                      data-testid="button-crouch"
                      onMouseDown={() => handleMovement('crouch', 'start')}
                      onMouseUp={() => handleMovement('crouch', 'stop')}
                      onMouseLeave={() => handleMovement('crouch', 'stop')}
                      disabled={!connectionStatus.isConnected}
                      className="w-16 h-10 bg-red-600 hover:bg-red-700 text-white font-bold"
                    >
                      SHIFT
                    </Button>
                  </div>
                </div>

                {!connectionStatus.isConnected && (
                  <div className="mt-4 text-xs text-gray-400 text-center">
                    Connect to server to enable controls
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Spammer Controls */}
            <Card className="bg-gray-800 border-minecraft-dark-stone mt-6">
              <CardHeader>
                <CardTitle className="text-lg font-gaming font-bold text-minecraft-green flex items-center">
                  <MessageSquare className="mr-2" />
                  Auto Spammer
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="spammerMessage" className="text-gray-300">Spam Message</Label>
                  <Textarea
                    id="spammerMessage"
                    data-testid="textarea-spammer-message"
                    value={spammerMessage}
                    onChange={(e) => setSpammerMessage(e.target.value)}
                    placeholder="Enter message or command to spam..."
                    className="bg-gray-700 border-gray-600 text-white focus:border-minecraft-green min-h-[60px]"
                    disabled={spammerEnabled}
                  />
                </div>

                <div>
                  <Label htmlFor="spammerDelay" className="text-gray-300">Delay (ms)</Label>
                  <Input
                    id="spammerDelay"
                    data-testid="input-spammer-delay"
                    type="number"
                    min="100"
                    max="10000"
                    value={spammerDelay}
                    onChange={(e) => setSpammerDelay(Math.max(100, parseInt(e.target.value) || 1000))}
                    className="bg-gray-700 border-gray-600 text-white focus:border-minecraft-green"
                    disabled={spammerEnabled}
                  />
                  <div className="text-xs text-gray-400 mt-1">
                    Minimum: 100ms (0.1 seconds)
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="anti-kick"
                      checked={antiKickEnabled}
                      onChange={(e) => setAntiKickEnabled(e.target.checked)}
                      className="w-4 h-4 text-minecraft-green bg-gray-600 border-gray-500 rounded focus:ring-minecraft-green"
                      disabled={spammerEnabled}
                    />
                    <label htmlFor="anti-kick" className="text-sm text-gray-300">
                      Anti-Kick Mode
                    </label>
                  </div>
                </div>
                {antiKickEnabled && (
                  <div className="text-xs text-gray-400 bg-gray-700 p-2 rounded">
                    Anti-kick adds random numbers and symbols to the end of each message to avoid spam detection
                  </div>
                )}

                <Button
                  data-testid="button-toggle-spammer"
                  onClick={toggleSpammer}
                  disabled={spammerEnabled && !connectionStatus.isConnected}
                  className={`w-full font-bold ${
                    spammerEnabled
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'bg-minecraft-gold hover:bg-yellow-600 text-gray-900'
                  }`}
                >
                  {spammerEnabled ? 'Stop Spammer' : 'Start Spammer'}
                </Button>

                {spammerEnabled && (
                  <div className="text-center">
                    <Badge className="bg-red-600 text-white animate-pulse">
                      {connectionStatus.isConnected ? `Spamming every ${spammerDelay}ms` : 'Waiting for connection...'}
                    </Badge>
                  </div>
                )}

                {!connectionStatus.isConnected && (
                  <div className="mt-4 text-xs text-gray-400 text-center">
                    Spammer can be configured offline, will start when connected
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Chat Panel */}
          <div className="lg:col-span-2">
            <Card className="bg-gray-800 border-minecraft-dark-stone h-full flex flex-col">
              <CardHeader>
                <CardTitle className="text-xl font-gaming font-bold text-minecraft-green flex items-center">
                  <MessageSquare className="mr-2" />
                  Chat & Commands
                </CardTitle>
                <div className="flex space-x-2 mt-4">
                  <Button
                    data-testid="tab-chat"
                    onClick={() => setActiveTab('chat')}
                    variant={activeTab === 'chat' ? 'default' : 'outline'}
                    className="flex-1 text-sm"
                  >
                    Chat
                  </Button>
                  <Button
                    data-testid="tab-logs"
                    onClick={() => setActiveTab('logs')}
                    variant={activeTab === 'logs' ? 'default' : 'outline'}
                    className="flex-1 text-sm"
                  >
                    Logs
                  </Button>
                  <Button
                    data-testid="tab-players"
                    onClick={() => setActiveTab('players')}
                    variant={activeTab === 'players' ? 'default' : 'outline'}
                    className="flex-1 text-sm"
                  >
                    Players ({onlinePlayers.length})
                  </Button>
                  <Button
                    data-testid="tab-inventory"
                    onClick={() => setActiveTab('inventory')}
                    variant={activeTab === 'inventory' ? 'default' : 'outline'}
                    className="flex-1 text-sm"
                  >
                    📦 Inventory
                  </Button>
                  <Button
                    data-testid="tab-admin"
                    onClick={handleAdminTabClick}
                    variant={activeTab === 'admin' ? 'default' : 'outline'}
                    className="flex-1 text-sm"
                  >
                    Admin {isAdminAuthenticated ? '🔓' : '🔒'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <div className="flex-1 bg-chat-bg rounded-lg border border-gray-700 mb-4 overflow-hidden flex flex-col">
                  {activeTab === 'chat' ? (
                    <div
                      ref={chatMessagesRef}
                      className="flex-1 p-4 overflow-y-auto max-h-96 space-y-2"
                      data-testid="chat-messages"
                    >
                      {chatMessages.length === 0 ? (
                        <div className="text-gray-400 text-center py-8">
                          No messages yet. Connect to a server to start chatting!
                        </div>
                      ) : (
                        chatMessages.map((msg) => (
                          <div key={msg.id} className="text-sm">
                            <span className="text-gray-400 font-mono text-xs">
                              [{formatTime(new Date(msg.timestamp))}]
                            </span>
                            {msg.isCommand ? (
                              <span className="text-minecraft-gold font-medium ml-1">
                                &gt; {msg.message}
                              </span>
                            ) : (
                              <>
                                <span className={`font-medium ml-1 ${
                                  msg.messageType === 'system' || msg.messageType === 'join' || msg.messageType === 'leave' || msg.messageType === 'death'
                                    ? 'text-yellow-300'
                                    : 'text-minecraft-green'
                                }`}>
                                  {msg.messageType === 'system' || msg.messageType === 'join' || msg.messageType === 'leave' || msg.messageType === 'death'
                                    ? '[Server]'
                                    : `<${msg.username}>`
                                  }
                                </span>
                                <span className={`ml-1 ${getMessageStyle(msg.messageType)}`}>
                                  {msg.message}
                                </span>
                              </>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  ) : activeTab === 'logs' ? (
                    <div
                      ref={logsRef}
                      className="flex-1 p-4 overflow-y-auto max-h-96 space-y-1"
                      data-testid="bot-logs"
                    >
                      {botLogs.length === 0 ? (
                        <div className="text-gray-400 text-center py-8">
                          No logs yet. Connect to a server to see activity logs!
                        </div>
                      ) : (
                        botLogs.map((log) => (
                          <div key={log.id} className={`text-xs p-2 rounded border-l-2 ${getLogLevelStyle(log.logLevel)}`}>
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-gray-400">
                                [{formatTime(new Date(log.timestamp))}]
                              </span>
                              <span className={`uppercase text-xs font-bold ${
                                log.logLevel === 'error' ? 'text-red-400' :
                                log.logLevel === 'warning' ? 'text-yellow-400' :
                                'text-blue-400'
                              }`}>
                                {log.logLevel}
                              </span>
                            </div>
                            <div className="text-gray-300 mt-1">
                              {log.message}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  ) : activeTab === 'players' ? (
                    <div
                      className="flex-1 p-4 overflow-y-auto max-h-96 space-y-2"
                      data-testid="players-list"
                    >
                      {!connectionStatus.isConnected ? (
                        <div className="text-gray-400 text-center py-8">
                          Connect to a server to see online players!
                        </div>
                      ) : onlinePlayers.length === 0 ? (
                        <div className="text-gray-400 text-center py-8">
                          No players online or data not available
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between border-b border-gray-700 pb-2">
                            <h3 className="text-lg font-semibold text-minecraft-green">
                              Online Players ({onlinePlayers.length})
                            </h3>
                          </div>
                          {onlinePlayers.map((player) => (
                            <div key={player.uuid} className="bg-gray-700 rounded-lg p-3 border border-gray-600">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-3">
                                  <div className="w-8 h-8 bg-minecraft-green rounded flex items-center justify-center">
                                    <span className="text-white text-sm font-bold">
                                      {player.username.charAt(0).toUpperCase()}
                                    </span>
                                  </div>
                                  <div>
                                    <div className="font-medium text-white">
                                      {player.username}
                                    </div>
                                    <div className="text-xs text-gray-400">
                                      UUID: {player.uuid.substring(0, 8)}...
                                    </div>
                                  </div>
                                </div>
                                <div className="text-right">
                                  {player.ping !== undefined && (
                                    <div className="text-sm text-gray-400">
                                      {player.ping}ms
                                    </div>
                                  )}
                                  <div className="w-3 h-3 bg-status-online rounded-full animate-pulse" />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {kickReason && (
                        <div className="mt-4 p-3 bg-red-900/20 border border-red-600 rounded-lg">
                          <div className="flex items-center space-x-2">
                            <div className="w-4 h-4 bg-red-500 rounded-full" />
                            <span className="text-red-400 font-medium">Last Disconnect Reason:</span>
                          </div>
                          <div className="text-red-300 mt-1">
                            {kickReason}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : activeTab === 'inventory' ? (
                    <div
                      className="flex-1 p-4 overflow-y-auto max-h-96 space-y-2"
                      data-testid="inventory-display"
                    >
                      {!connectionStatus.isConnected ? (
                        <div className="text-gray-400 text-center py-8">
                          Connect to a server to view bot inventory!
                        </div>
                      ) : botInventory.length === 0 ? (
                        <div className="text-gray-400 text-center py-8">
                          <div className="text-4xl mb-2">📦</div>
                          <div>Inventory is empty or not loaded</div>
                          <div className="text-sm mt-2">Click the "📦 Inventory" button to refresh</div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between border-b border-gray-700 pb-2">
                            <h3 className="text-lg font-semibold text-minecraft-green">
                              Bot Inventory ({botInventory.length} items)
                            </h3>
                            <Button
                              onClick={handleShowInventory}
                              size="sm"
                              className="bg-minecraft-gold hover:bg-yellow-600 text-gray-900"
                            >
                              Refresh
                            </Button>
                          </div>
                          <div className="space-y-2 max-h-64 overflow-y-auto">
                            {botInventory.map((item, index) => (
                              <div key={index} className="bg-gray-700 rounded border border-gray-600 p-3 flex items-center justify-between">
                                <div className="flex items-center space-x-3">
                                  <div className="text-xl">📦</div>
                                  <div>
                                    <div className="text-white font-medium">
                                      {item.displayName || item.name || 'Unknown Item'}
                                    </div>
                                    <div className="text-xs text-gray-400">
                                      Slot {item.slot}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <div className="text-minecraft-green font-bold">
                                    x{item.count}
                                  </div>
                                  <Button
                                    onClick={() => handleDropItem(item.slot)}
                                    size="sm"
                                    variant="destructive"
                                    className="text-xs px-2 py-1 h-6"
                                  >
                                    Drop
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      className="flex-1 p-4 overflow-y-auto max-h-96"
                      data-testid="admin-panel"
                    >
                      {showAdminLogin && !isAdminAuthenticated ? (
                        <div className="flex flex-col items-center justify-center space-y-4 py-12">
                          <div className="text-center">
                            <h3 className="text-xl font-semibold text-minecraft-green mb-2">Admin Access Required</h3>
                            <p className="text-gray-400 mb-6">Enter password to access admin panel</p>
                          </div>
                          <div className="w-full max-w-sm space-y-3">
                            <Input
                              type="password"
                              placeholder="Enter admin password"
                              value={adminPassword}
                              onChange={(e) => setAdminPassword(e.target.value)}
                              onKeyPress={(e) => e.key === 'Enter' && handleAdminLogin()}
                              className="bg-gray-700 border-gray-600 text-white focus:border-minecraft-green"
                            />
                            <div className="flex space-x-2">
                              <Button
                                onClick={handleAdminLogin}
                                className="flex-1 bg-minecraft-green hover:bg-minecraft-dark-green"
                              >
                                Login
                              </Button>
                              <Button
                                onClick={() => {
                                  setShowAdminLogin(false);
                                  setActiveTab('chat');
                                  setAdminPassword("");
                                }}
                                variant="outline"
                                className="flex-1"
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : !isAdminAuthenticated ? (
                        <div className="text-center py-12">
                          <div className="text-gray-400">
                            <div className="text-6xl mb-4">🔒</div>
                            <h3 className="text-lg font-semibold mb-2">Admin Panel Locked</h3>
                            <p>Click the Admin tab again to authenticate</p>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <h3 className="text-lg font-semibold text-minecraft-green">Bot Management</h3>
                            <div className="flex items-center space-x-3">
                              <Badge variant="outline" className="text-xs">
                                {adminConnections.filter(conn => conn.isActive).length} Active
                              </Badge>
                              <Button
                                onClick={() => {
                                  setIsAdminAuthenticated(false);
                                  setActiveTab('chat');
                                }}
                                variant="outline"
                                size="sm"
                                className="text-xs"
                              >
                                Logout
                              </Button>
                            </div>
                          </div>

                          {isLoadingAdmin ? (
                            <div className="text-center py-8 text-gray-400">Loading bots...</div>
                          ) : adminConnections.length === 0 ? (
                            <div className="text-gray-400 text-center py-8">
                              No bot connections found
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {adminConnections.map((conn) => (
                                <div key={conn.id} className="bg-gray-700 rounded-lg p-4 border border-gray-600">
                                  <div className="flex items-center justify-between">
                                    <div className="flex-1">
                                      <div className="flex items-center space-x-3">
                                        <div className={`w-3 h-3 rounded-full ${
                                          conn.isActive ? 'bg-status-online animate-pulse' : 'bg-status-offline'
                                        }`} />
                                        <div>
                                          <div className="font-medium text-white">
                                            {conn.username}
                                          </div>
                                          <div className="text-sm text-gray-400">
                                            {conn.serverIp} • {conn.version}
                                          </div>
                                        </div>
                                      </div>
                                      <div className="mt-2 flex items-center space-x-4 text-xs text-gray-400">
                                        <span>
                                          Status: <span className={conn.isActive ? 'text-green-400' : 'text-red-400'}>
                                            {conn.isActive ? 'Online' : 'Offline'}
                                          </span>
                                        </span>
                                        {conn.lastPing !== undefined && (
                                          <span>Ping: {conn.lastPing}ms</span>
                                        )}
                                        <span>
                                          Created: {formatTime(new Date(conn.createdAt))}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex space-x-2">
                                      {conn.isActive && (
                                        <Button
                                          onClick={() => handleTerminateBot(conn.id)}
                                          variant="destructive"
                                          size="sm"
                                          className="text-xs"
                                          data-testid={`terminate-bot-${conn.id}`}
                                        >
                                          Terminate
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === 'chat' && (
                    <div className="border-t border-gray-700 p-3">
                      <div className="flex space-x-2">
                        <Input
                          data-testid="input-chat"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyPress={handleKeyPress}
                          placeholder="Type a message or command (prefix with /)..."
                          className="flex-1 bg-gray-700 border-gray-600 text-white focus:border-minecraft-green"
                          disabled={!connectionStatus.isConnected}
                        />
                        <Button
                          data-testid="button-send-message"
                          onClick={handleSendMessage}
                          disabled={!connectionStatus.isConnected || !chatInput.trim()}
                          className="bg-minecraft-green hover:bg-minecraft-dark-green"
                        >
                          <Send className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="mt-2 text-xs text-gray-400">
                        Tip: Use "/" prefix for commands (e.g., /help, /tp, /gamemode)
                      </div>
                    </div>
                  )}
                </div>

                <div className="border-t border-gray-700 pt-4">
                  <h3 className="text-sm font-medium text-gray-300 mb-3">Quick Commands</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {QUICK_COMMANDS.map((command) => (
                      <Button
                        key={command}
                        data-testid={`button-quick-command-${command.slice(1)}`}
                        onClick={() => handleQuickCommand(command)}
                        disabled={!connectionStatus.isConnected}
                        variant="outline"
                        className="bg-gray-700 hover:bg-gray-600 border-gray-600 text-white"
                      >
                        {command}
                      </Button>
                    ))}
                    <Button
                      data-testid="button-show-inventory"
                      onClick={handleShowInventory}
                      disabled={!connectionStatus.isConnected}
                      variant="outline"
                      className="bg-minecraft-gold hover:bg-yellow-600 border-yellow-600 text-gray-900 font-bold"
                    >
                      📦 Inventory
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Status Bar */}
        <Card className="mt-6 bg-gray-800 border-minecraft-dark-stone">
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-minecraft-green" data-testid="text-players">
                  {connectionStatus.serverInfo.players}
                </div>
                <div className="text-xs text-gray-400">Players Online</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-minecraft-gold" data-testid="text-latency">
                  {connectionStatus.ping > 0 ? `${connectionStatus.ping} ms` : '-- ms'}
                </div>
                <div className="text-xs text-gray-400">Latency</div>
              </div>
              <div>
                <div className="text-lg font-bold text-green-400" data-testid="text-coordinates">
                  {connectionStatus.position.x}, {connectionStatus.position.y}, {connectionStatus.position.z}
                </div>
                <div className="text-xs text-gray-400">Coordinates (X, Y, Z)</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-blue-400" data-testid="text-server-version">
                  {connectionStatus.serverInfo.version}
                </div>
                <div className="text-xs text-gray-400">Server Version</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-purple-400" data-testid="text-server-status">
                  {connectionStatus.serverInfo.motd}
                </div>
                <div className="text-xs text-gray-400">Server Status</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Always Online Authentication Modal */}
      {showAlwaysOnlineModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-minecraft-dark-stone rounded-lg p-6 max-w-md w-full mx-4">
            <div className="text-center mb-6">
              <div className="w-16 h-16 mx-auto mb-4 bg-minecraft-green/10 rounded-full flex items-center justify-center">
                {showCheckmark ? (
                  <div className="text-green-400 text-2xl animate-bounce">✓</div>
                ) : (
                  <div className="text-minecraft-green text-2xl">🔒</div>
                )}
              </div>
              <h3 className="text-xl font-semibold text-minecraft-green mb-2">Enable Always Online</h3>
              <p className="text-gray-400 text-sm">
                This feature keeps your bot connected to the server even when the website is closed.
                Enter the password to continue.
              </p>
            </div>

            {!showCheckmark ? (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="always-online-password" className="text-gray-300">Password</Label>
                  <Input
                    id="always-online-password"
                    type="password"
                    placeholder="Enter password"
                    value={alwaysOnlinePassword}
                    onChange={(e) => setAlwaysOnlinePassword(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAlwaysOnlineAuth()}
                    className="bg-gray-700 border-gray-600 text-white focus:border-minecraft-green"
                    disabled={isAuthenticating}
                  />
                </div>

                <div className="flex space-x-3">
                  <Button
                    onClick={handleAlwaysOnlineAuth}
                    disabled={!alwaysOnlinePassword.trim() || isAuthenticating}
                    className="flex-1 bg-minecraft-green hover:bg-minecraft-dark-green"
                  >
                    {isAuthenticating ? (
                      <div className="flex items-center space-x-2">
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Authenticating...</span>
                      </div>
                    ) : (
                      'Enable Always Online'
                    )}
                  </Button>
                  <Button
                    onClick={handleAlwaysOnlineCancel}
                    variant="outline"
                    className="flex-1"
                    disabled={isAuthenticating}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center space-y-4">
                <div className="text-green-400 text-lg font-medium">Authentication Successful!</div>
                <div className="text-gray-400 text-sm">Always Online mode is now enabled.</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Help Chat Modal */}
      {showHelpChat && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-minecraft-dark-stone rounded-lg w-full max-w-md h-96 mx-4 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                <h3 className="text-lg font-semibold text-minecraft-green">Get Help</h3>
              </div>
              <Button
                onClick={handleEndHelpSession}
                variant="ghost"
                size="sm"
                className="text-gray-400 hover:text-white"
              >
                ✕
              </Button>
            </div>

            <div
              ref={helpMessagesRef}
              className="flex-1 p-4 overflow-y-auto space-y-3 bg-gray-900"
            >
              {helpMessages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.isAgent ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-xs px-3 py-2 rounded-lg ${
                    msg.isAgent 
                      ? 'bg-gray-700 text-white' 
                      : 'bg-minecraft-green text-gray-900'
                  }`}>
                    <div className="text-sm font-medium mb-1">
                      {msg.author}
                    </div>
                    <div className="text-sm">
                      {msg.message}
                    </div>
                    <div className={`text-xs mt-1 ${
                      msg.isAgent ? 'text-gray-400' : 'text-gray-700'
                    }`}>
                      {formatTime(new Date(msg.timestamp))}
                    </div>
                  </div>
                </div>
              ))}

              {helpMessages.length === 0 && (
                <div className="text-center text-gray-400 py-8">
                  Starting help session...
                </div>
              )}
            </div>

            <div className="border-t border-gray-700 p-3">
              <div className="flex space-x-2">
                <Input
                  value={helpInput}
                  onChange={(e) => setHelpInput(e.target.value)}
                  onKeyPress={handleHelpKeyPress}
                  placeholder="Type your message..."
                  className="flex-1 bg-gray-700 border-gray-600 text-white focus:border-minecraft-green"
                  disabled={!helpSessionId}
                />
                <Button
                  onClick={handleSendHelpMessage}
                  disabled={!helpInput.trim() || !helpSessionId}
                  className="bg-minecraft-green hover:bg-minecraft-dark-green"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              {!helpSessionId && (
                <div className="text-xs text-gray-400 mt-1">
                  Connecting to support team...
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}