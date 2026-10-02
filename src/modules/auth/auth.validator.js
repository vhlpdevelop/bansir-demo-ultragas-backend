import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string({ required_error: 'E-mail é obrigatório' }).trim().min(1, 'E-mail é obrigatório'),
  password: z.string({ required_error: 'Senha é obrigatória' }).min(1, 'Senha é obrigatória')
});

export const registerSchema = z.object({
  name: z.string({ required_error: 'Nome é obrigatório' }).trim().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  email: z.string({ required_error: 'E-mail é obrigatório' }).trim().email('Formato de e-mail inválido'),
  password: z.string({ required_error: 'Senha é obrigatória' }).min(6, 'Senha deve ter pelo menos 6 caracteres'),
  role: z.enum(['superadmin', 'admin', 'gerente_artesao', 'operador']).optional(),
  artisanSpecialty: z.string().optional(),
  phone: z.string().optional()
});

export const updateMeSchema = z.object({
  name: z.string().trim().min(1).optional(),
  artisanSpecialty: z.string().optional(),
  phone: z.string().optional(),
  notificationPreferences: z.object({
    sales: z.boolean().optional(),
    system: z.boolean().optional(),
    stock: z.boolean().optional(),
    financial: z.boolean().optional()
  }).optional()
});
