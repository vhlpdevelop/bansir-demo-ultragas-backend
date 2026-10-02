import { z } from 'zod';

export const createProductSchema = z.object({
  name: z.string({ required_error: 'Nome do produto é obrigatório' }).trim().min(1, 'Nome do produto é obrigatório'),
  barcode: z.string().trim().optional(),
  price: z.number({ required_error: 'Preço é obrigatório' }).min(0, 'Preço deve ser maior ou igual a zero'),
  costPrice: z.number().min(0, 'Preço de custo deve ser maior ou igual a zero').optional(),
  stock: z.number().int().min(0, 'Estoque deve ser maior ou igual a zero').optional(),
  minStock: z.number().int().min(0).optional(),
  category: z.string().optional(),
  artisan: z.string().optional(),
  description: z.string().optional()
});

export const updateProductSchema = z.object({
  name: z.string().trim().min(1).optional(),
  barcode: z.string().trim().optional(),
  price: z.number().min(0).optional(),
  costPrice: z.number().min(0).optional(),
  stock: z.number().int().min(0).optional(),
  minStock: z.number().int().min(0).optional(),
  category: z.string().optional(),
  artisan: z.string().optional(),
  description: z.string().optional()
});

export const stockMovementSchema = z.object({
  productId: z.string({ required_error: 'ID do produto é obrigatório' }).min(1),
  quantity: z.number({ required_error: 'Quantidade é obrigatória' }).int().positive('Quantidade deve ser maior que zero'),
  type: z.enum(['in', 'out'], { errorMap: () => ({ message: 'Tipo deve ser "in" (entrada) ou "out" (saída)' }) }),
  reason: z.string().optional()
});

export const addCategorySchema = z.object({
  name: z.string({ required_error: 'Nome da categoria é obrigatório' }).trim().min(1)
});

export const previewNFeSchema = z.union([
  z.object({
    xmlContent: z.string({ required_error: 'O conteúdo XML da NF-e é obrigatório' }).min(1)
  }),
  z.string().min(1, 'O conteúdo XML da NF-e é obrigatório')
]);

export const confirmNFeSchema = z.object({
  items: z.array(z.any()).min(1, 'A lista de itens da NF-e é obrigatória'),
  supplier: z.any().optional(),
  invoice: z.any().optional()
});
