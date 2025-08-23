import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const botConnections = pgTable("bot_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull(),
  serverIp: text("server_ip").notNull(),
  version: text("version").notNull(),
  isConnected: boolean("is_connected").default(false),
  lastPing: integer("last_ping"),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  connectionId: varchar("connection_id").references(() => botConnections.id),
  username: text("username").notNull(),
  message: text("message").notNull(),
  messageType: text("message_type").notNull().default("chat"), // chat, system, join, leave, death, console
  timestamp: timestamp("timestamp").default(sql`now()`),
  isCommand: boolean("is_command").default(false),
});

export const botLogs = pgTable("bot_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  connectionId: varchar("connection_id").references(() => botConnections.id),
  logLevel: text("log_level").notNull(), // info, warning, error
  message: text("message").notNull(),
  timestamp: timestamp("timestamp").default(sql`now()`),
});

export const insertBotConnectionSchema = createInsertSchema(botConnections).pick({
  username: true,
  serverIp: true,
  version: true,
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).pick({
  connectionId: true,
  username: true,
  message: true,
  messageType: true,
  isCommand: true,
});

export const insertBotLogSchema = createInsertSchema(botLogs).pick({
  connectionId: true,
  logLevel: true,
  message: true,
});

export type InsertBotConnection = z.infer<typeof insertBotConnectionSchema>;
export type BotConnection = typeof botConnections.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertBotLog = z.infer<typeof insertBotLogSchema>;
export type BotLog = typeof botLogs.$inferSelect;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
