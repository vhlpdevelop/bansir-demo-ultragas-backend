import { z } from 'zod';

export const createSupplierSchema = z.object({
  name: z.string({ required_error: 'Nome do fornecedor é obrigatório' }).trim().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  tradeName: z.string().trim().optional(),
  document: z.string().trim().optional(),
  stateRegistration: z.string().trim().optional(),
  email: z.string().trim().email('Formato de e-mail inválido').optional().or(z.literal('')),
  phone: z.string().trim().optional(),
  contactPerson: z.string().trim().optional(),
  category: z.string().trim().optional(),
  notes: z.string().optional(),
  address: z.object({
    street: z.string().optional(),
    number: z.string().optional(),
    complement: z.string().optional(),
    neighborhood: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional()
  }).optional()
});

export const updateSupplierSchema = createSupplierSchema.partial();
