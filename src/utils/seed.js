import '../config/env.js';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { seedPlan } from './seed-data.js';
const args = process.argv.slice(2);
try {
  if (args.some(a => !['--demo', '--dry-run'].includes(a))) throw new Error('Opções disponíveis: --dry-run e --demo.');
  if (args.includes('--dry-run')) {
    console.log('Plano da seed (sem conexão ou gravação):', seedPlan);
    console.log(args.includes('--demo') ? 'Inclui 2 vendas e 1 despesa de exemplo.' : 'Sem vendas ou lançamentos financeiros de exemplo.');
  } else {
    await connectDB();
    // With buffering disabled, compile models only after the connection is ready.
    const { seedDatabase } = await import('./seed.service.js');
    const inserted = await seedDatabase({ demo: args.includes('--demo') });
    console.log('Seed concluída. Novos registros:', inserted);
    console.log('Cadastros, senhas e estoque existentes foram preservados.');
  }
} catch (error) {
  console.error('Seed não concluída:', error.code === 11000 ? 'Cadastro duplicado. Confira os registros existentes.' : error.message);
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
