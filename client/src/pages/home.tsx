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

const MINECRAFT_VERSIONS = [
  '1.21.5', '1.21.4', '1.21.3', '1.21.2', '1.21.1', '1.21.0',
  '1.20.6', '1.20.4', '1.20.2', '1.20.1',
  '1.19.4', '1.19.2', '1.18.2'
];

const QUICK_COMMANDS = ['/help', '/list', '/spawn', '/home'];

export default function Home() {
  const [username, setUsername] = useState("Player123");
  const [serverIP, setServerIP] = useState("");
  const [version, setVersion] = useState("1.21.5");
  const [chatInput, setChatInput] = useState("");
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [botLogs, setBotLogs] = useState<BotLog[]>([]);
  const [activeTab, setActiveTab] = useState<'chat' | 'logs'>('chat');
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
            serverInfo: { ...prev.serverInfo, motd: "Connected" }
          }));
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
          toast({
            title: "Bot Disconnected",
            description: "Bot has been disconnected from the server",
          });
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

      if (wsConnected && sendMessage) {
        sendMessage({
          type: 'connect_bot',
          data: {
            connectionId: connection.id,
            username: username.trim(),
            serverIp: serverIP.trim(),
            version
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
                <p className="text-sm text-gray-400">Made by doggo, for doggo v1.0</p>
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
                          {v} {v === '1.21.5' ? '(Latest)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

                <Card className="bg-gray-700">
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
                  
                  <Button
                    data-testid="button-jump"
                    onClick={() => handleMovement('jump', 'start')}
                    disabled={!connectionStatus.isConnected}
                    className="w-16 h-10 bg-minecraft-gold hover:bg-yellow-600 text-gray-900 font-bold"
                  >
                    SPACE
                  </Button>
                </div>
                
                {!connectionStatus.isConnected && (
                  <div className="mt-4 text-xs text-gray-400 text-center">
                    Connect to server to enable controls
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
                    className="flex-1"
                  >
                    Chat
                  </Button>
                  <Button
                    data-testid="tab-logs"
                    onClick={() => setActiveTab('logs')}
                    variant={activeTab === 'logs' ? 'default' : 'outline'}
                    className="flex-1"
                  >
                    Logs
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
                  ) : (
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
    </div>
  );
}
