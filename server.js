import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { supabase } from "./supabase/supabase.mjs";

import { createClient } from "redis";

const app = express();
console.log(
  process.env.REDIS_PASSWORD,
  process.env.REDIS_HOST,
  process.env.REDIS_PORT,
);
const redis = createClient({
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    connectTimeout: 10000,
    // Add retry strategy for Redis
    reconnectStrategy: (retries) => Math.min(retries * 50, 500),
  },
});
const httpServer = createServer(app);
const allowedOrigins = ["https://tomatera.netlify.app"];
const roomTTL = 60 * 60 * 12; // half a one day

// Add Redis error handling
redis.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

redis.on('connect', () => {
  console.log('Redis Client Connected');
});

redis.on('reconnecting', () => {
  console.log('Redis Client Reconnecting');
});

await redis.connect();

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      const msg =
        "The CORS policy for this site does not allow access from the specified Origin.";
      return callback(new Error(msg), false);
    },
  }),
);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
  // Add connection reliability options
  upgradeTimeout: 30000,
  allowUpgrades: true,
  transports: ['websocket', 'polling'],
  // Enable compression for better performance
  compression: true,
  // Set max HTTP buffer size
  maxHttpBufferSize: 1e6,
});

// Add connection tracking
const connectionTracker = new Map();

io.on("connection", (socket) => {
  connectionTracker.set(socket.id, {
    connectedAt: Date.now(),
    rooms: new Set(),
  });

  socket.on('error', (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });

  socket.on("disconnect", (reason) => {
    connectionTracker.delete(socket.id);
  });

  socket.on("disconnecting", async () => {
    var socketRooms = socket.rooms;
    const tracker = connectionTracker.get(socket.id);

    for (const room of socketRooms) {
      if (room === socket.id) continue; // Skip the socket's own room

      try {
        const participantDetails = await redis.hGet(room, socket.id);

        if (participantDetails) {
          const parsedDetails = JSON.parse(participantDetails);

          socket.in(room).emit("removeParticipant", parsedDetails.uid);
          socket
            .in(room)
            .emit(
              "showToast",
              `${parsedDetails.displayName ?? "user"} left room`,
            );
        }

        await redis.hDel(room, socket.id);
      } catch (error) {
        console.error(`Error handling disconnect for room ${room}:`, error);
      }
    }
  });





    socket.on("timer:broadcast", async (payload) => {
    try {
    if (
      !payload ||
      typeof payload !== 'object' ||
      !payload.context ||
      typeof payload.context !== 'object' ||
      typeof payload.timestamp !== 'number'
    ) {
      socket.emit('error', `Invalid timer broadcast payload - ${JSON.stringify(payload)}`);
      return;
    }

    const {
      userId,
      roomId,
      currentSessionState,
      currentTimerState,
      remainingTime,
      duration
    } = payload.context;

    const { timestamp } = payload;

    if (
      typeof userId !== 'string' ||
      typeof roomId !== 'string' ||
      typeof currentSessionState !== 'string' ||
      typeof currentTimerState !== 'string' ||
      typeof remainingTime !== 'number' ||
      typeof duration !== 'number'
    ) {
      socket.emit('error', `Invalid timer context - ${JSON.stringify(payload.context)}`);
      return;
    }

    const validSessionStates = ['work', 'break'];
    const validTimerStates = ['idle', 'running', 'paused'];

    const event = payload.event;
    if (
      !validSessionStates.includes(currentSessionState) ||
      !validTimerStates.includes(currentTimerState)
    ) {
      socket.emit('error', 'Invalid timer state values in broadcast');
      return;
    }

    if (!socket.rooms.has(roomId)) {
      try {
        const participantDetails = await redis.hGet(roomId, socket.id);
        if (!participantDetails) {
          socket.emit('error', 'Socket not in specified room');
          return;
        }
      } catch (redisError) {
        socket.emit('error', 'Socket not in specified room');
        return;
      }
    }

    try {
      const participantDetails = await redis.hGet(roomId, socket.id);
      if (participantDetails) {
        const parsedDetails = JSON.parse(participantDetails);
        if (parsedDetails.uid !== userId) {
          socket.emit('error', 'User ID mismatch for room');
          return;
        }
      }
    } catch (redisError) {
      console.warn(`Redis check failed for timer broadcast: ${redisError.message}`);
    }

    const broadcastData = {
      userId,
      state: {
        sessionState: currentSessionState,
        timerState: currentTimerState,
        remainingTime,
        duration,
      },
      timestamp: timestamp || Date.now(),
    };

    socket.to(roomId).emit('timerStateUpdate', broadcastData);
  } catch (error) {
    console.error(`Error in timer:broadcast for socket ${socket.id}:`, error);
    socket.emit('error', 'Failed to broadcast timer state');
  }

  });

  socket.on("joinRoom", async (room, displayName, avatar, id) => {
    try {
      if (!room || !id || typeof room !== 'string' || typeof id !== 'string' ||
          room.length > 50 || id.length > 100) {
        socket.emit('error', 'Invalid join room parameters');
        return;
      }

      const sanitizedDisplayName = displayName ?
        displayName.toString().substring(0, 50).trim() : 'user';

      socket.join(room);

      const tracker = connectionTracker.get(socket.id);
      if (tracker) {
        tracker.rooms.add(room);
      }

      const participantDetails = JSON.stringify({
        uid: id,
        displayName: sanitizedDisplayName,
        socketId: socket.id,
        avatar: avatar || '',
      });

      await redis.hSet(room, socket.id, participantDetails);
      await redis.expire(room, roomTTL);

      const existingParticipants = await redis.hVals(room);

      io.to(room).emit("addExistingParticipants", existingParticipants);
      socket.in(room).emit("showToast", `${sanitizedDisplayName} joined room`);

      await supabase.from("session").insert({
        id: room,
        user_id: id,
      });

      socket.emit('joinedRoom', { room, participantId: id });
    } catch (error) {
      console.error(`Error in joinRoom for socket ${socket.id}:`, error);
      socket.emit('error', 'Failed to join room');
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  try {
    const connectionCount = connectionTracker.size;
    const redisConnected = redis.isReady;

    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      connections: connectionCount,
      redis: redisConnected ? 'connected' : 'disconnected',
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };

    res.status(200).json(health);
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Graceful shutdown handling
const gracefulShutdown = async (signal) => {
  console.log(`Received ${signal}. Starting graceful shutdown...`);

  try {
    // Stop accepting new connections
    httpServer.close(() => {
      console.log('HTTP server closed');
    });

    // Disconnect all socket connections
    io.close(() => {
      console.log('Socket.IO server closed');
    });

    // Close Redis connection
    await redis.quit();
    console.log('Redis connection closed');

    console.log('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

app.get("/:user_sub/total_sessions", async (req, res) => {
  const { user_sub } = req.params;

  try {
    const { data, error } = await supabase.rpc("get_total_sessions", {
      user_sub: user_sub,
    });

    if (!error) {
      res.status(200).send(data);
    } else {
      console.error('Supabase error:', error);
      res.status(422).json({ error: 'Failed to fetch total sessions' });
    }
  } catch (error) {
    console.error('Error fetching total sessions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
