import mongoose from 'mongoose';
import { config } from '../src/config/env.js';

try {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI ausente');
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000,
    autoIndex: false, autoCreate: false
  });
  await mongoose.connection.db.command({ ping: 1 });
  console.log(`MongoDB conectado. Banco: ${mongoose.connection.name}. Ping confirmado.`);
} catch (error) {
  if (/auth/i.test(error.message)) {
    console.error('Atlas rejeitou a autenticação. Confira o usuário e a senha em Database Access e atualize MONGODB_URI.');
  } else {
    console.error(`Conexão não confirmada (${error.name}). Confira MONGODB_URI, disponibilidade do cluster e Network Access no Atlas.`);
  }
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
