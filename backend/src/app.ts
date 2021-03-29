/* eslint-disable linebreak-style */
// .env
import 'dotenv/config';
import 'reflect-metadata';
import express from 'express';
import * as fs from 'fs';
import * as https from 'https';
import cors from 'cors';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { ApolloServer } from 'apollo-server-express';
import { buildSchema } from 'type-graphql';
import { createConnection } from 'typeorm';
import { UserResolver } from './resolvers/userResolver';

// require('dotenv').config();

const { PORT, FRONT_END_ORIGIN, PORT_SOCKET } = process.env;

const boot = async () => {
  const app = express();

  app.get('/', (_, res) => {
    res.send('hello world!');
  });

  await createConnection();

  const corsOptions = {
    origin: FRONT_END_ORIGIN,
    credentials: true,
  };
  app.use(cors(corsOptions));
  // app.use(cookieParser());

  // establish socket.io server
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: FRONT_END_ORIGIN,
    } });
  const roomUsers:{ [roomId:string] : { [socketId:string] : string } } = {};

  httpServer.listen(PORT_SOCKET || 5001);

  function isAuth(token:string) {
    if (token) return true;
    return false;
  }

  io.use((socket, next) => {
    if (!isAuth(socket.handshake.auth.token)) return next(new Error('Permission denied!'));
    return next();
  }).on('connection', (socket:Socket) => {
    console.log('socket.io connected');
    const roomId = socket.handshake.query.roomId as string;
    console.log('join room:', roomId);
    if (roomId) socket.join(roomId);
    else return console.error('roomId is undefined');
    if (!roomUsers[roomId]) roomUsers[roomId] = {};
    if (!roomUsers[roomId][socket.id]) roomUsers[roomId][socket.id] = socket.id;

    console.log(roomUsers);

    // update all users
    socket.to(roomId).emit('allUserIds', Object.values(roomUsers[roomId]));
    // update self
    socket.emit('init', { selfId: socket.id, allUserIds: Object.values(roomUsers[roomId]) });

    socket.on('notifyPeers', (data) => {
      // console.log(data.from, ' sending hello to ', data.to);
      socket.to(data.to).emit('hello', { signalData: data.signalData, initiatorId: data.from });
    });

    socket.on('acceptConn', (data) => {
      // console.log('sending acceptance message from ', socket.id);
      socket.to(data.to).emit('accepted', { targetId: socket.id, signalData: data.signalData });
    });

    socket.on('disconnect', () => {
      delete roomUsers[roomId][socket.id];
      socket.leave(roomId);
      socket.to(roomId).emit('allUserIds', Object.values(roomUsers[roomId]));
    });
  });
  const port = PORT || 5000;
  const configurations = {
    // Note: You may need sudo to run on port 443
    production: { ssl: true, port, hostname: 'ggnbwhiteboard.ninja' },
    development: { ssl: false, port, hostname: 'localhost' },
  };

  const config = (process.env.NODE_ENV === 'development') ? configurations.development : configurations.production;

  const apolloServer = new ApolloServer({
    schema: await buildSchema({
      resolvers: [UserResolver],
      validate: false,
    }),
    context: ({ req, res }) => ({ req, res }),
  });

  apolloServer.applyMiddleware({ app, cors: corsOptions });
  if (!config.ssl) {
    // app.listen(port, () => {
    //   console.log(`HTTP server started on localhost: ${port}`);
    // });
    const httpServer2 = createServer(app);
    httpServer2.listen(config.port, () => {
      console.log(`HTTP server started on ${config.hostname}: ${port}`);
    });
  } else {
    const key = fs.readFileSync('server.key');
    const cert = fs.readFileSync('server.cert');
    // const ca = fs.readFileSync('/etc/letsencrypt/live/anime-sales.com/chain.pem', 'utf8');

    const httpsServer = https.createServer({ key, cert }, app);
    httpsServer.listen(config.port, () => {
      console.log(`HTTPS server started on ${config.hostname}:${port}`);
    });
  }
};

boot().catch((err) => {
  console.error(err);
});
