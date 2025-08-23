# Overview

This is a full-stack Minecraft bot management application that allows users to create, connect, and control Minecraft bots through a web interface. The application provides real-time chat monitoring, bot connection management, and WebSocket-based communication between the frontend and backend. Users can configure bot settings like username, server IP, and Minecraft version, then monitor the bot's activities through a live chat interface.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React 18 with TypeScript using Vite as the build tool
- **UI Framework**: shadcn/ui components built on Radix UI primitives with Tailwind CSS for styling
- **State Management**: TanStack Query (React Query) for server state management and caching
- **Routing**: Wouter for client-side routing with a simple home page and 404 fallback
- **Real-time Communication**: Custom WebSocket hook for live bot communication and chat monitoring
- **Forms**: React Hook Form with Zod validation for type-safe form handling

## Backend Architecture
- **Runtime**: Node.js with Express.js server framework
- **Language**: TypeScript with ES modules
- **Database**: PostgreSQL with Drizzle ORM for type-safe database operations
- **Real-time Communication**: WebSocket server using 'ws' library for bot communication
- **Bot Management**: Mineflayer integration for Minecraft bot functionality
- **Development**: Hot reloading with Vite integration and custom error overlay

## Data Storage Solutions
- **Database**: PostgreSQL as the primary database
- **ORM**: Drizzle ORM with Zod schema validation for type safety
- **Schema Design**: 
  - Bot connections table storing connection metadata and status
  - Chat messages table linking to bot connections
  - Users table for future authentication
- **Fallback Storage**: In-memory storage implementation for development/testing

## Authentication and Authorization
- **Current State**: Basic user schema defined but authentication not fully implemented
- **Future Ready**: User table and schema prepared for authentication integration
- **Session Management**: Express session configuration present with PostgreSQL session store

## External Dependencies
- **Database Provider**: Neon Database (serverless PostgreSQL)
- **UI Components**: Radix UI primitives for accessible component foundation
- **Styling**: Tailwind CSS with custom design system and CSS variables
- **Development Tools**: Replit-specific plugins for development environment integration
- **Bot Framework**: Mineflayer for Minecraft protocol implementation