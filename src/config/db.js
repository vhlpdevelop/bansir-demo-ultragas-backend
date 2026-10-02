import mongoose from 'mongoose';
import { config } from './env.js';
mongoose.set('strictQuery', false);
mongoose.set('bufferCommands', false);
mongoose.set('bufferTimeoutMS', 0);
export function isDbConnected() { return mongoose.connection.readyState === 1; }
export function requireDatabase() {
  if (!isDbConnected()) throw Object.assign(new Error('MongoDB indisponível. Tente novamente após restabelecer a conexão.'), { statusCode: 503 });
}
export async function connectDB() {
  if (isDbConnected()) return mongoose;
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI é obrigatória. Configure o .env do backend.');
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000 });
    console.log(`[Bansir DB] MongoDB conectado. Banco: ${mongoose.connection.name}`);
    return mongoose;
  } catch (error) {
    throw new Error(/auth/i.test(error.message) ? 'Atlas rejeitou as credenciais de MONGODB_URI.' : 'Não foi possível conectar ao MongoDB. Confira a URI e o acesso de rede ao Atlas.');
  }
}
