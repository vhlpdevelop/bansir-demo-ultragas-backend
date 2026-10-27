export const seedCategories = [
  {
    _id: 'cat_01',
    id: 'cat_01',
    name: 'Gás de Cozinha',
    description: 'Botijões P13, P45, P20 e cilindros para uso residencial e comercial.',
    color: '#000FFF'
  },
  {
    _id: 'cat_02',
    id: 'cat_02',
    name: 'Água Mineral',
    description: 'Galões de 20L e 10L, fardos de água sem gás e com gás.',
    color: '#3b82f6'
  },
  {
    _id: 'cat_03',
    id: 'cat_03',
    name: 'Acessórios e Peças',
    description: 'Válvulas, mangueiras, reguladores de pressão e suportes.',
    color: '#64748b'
  }
];
export const seedProducts = [
  {
    _id: 'prod_01',
    id: 'prod_01',
    name: 'Botijão de Gás P13 (Recarga)',
    barcode: '7890000000013',
    category: 'Gás de Cozinha',
    price: 110.00,
    costPrice: 85.00,
    stock: 45,
    sku: 'GAS-P13-REC',
    unit: 'UN',
    brand: 'Ultragas',
    specs: '13kg • Uso residencial • Apenas recarga',
    active: true
  },
  {
    _id: 'prod_02',
    id: 'prod_02',
    name: 'Botijão de Gás P13 (Vasilhame + Recarga)',
    barcode: '7890000000014',
    category: 'Gás de Cozinha',
    price: 280.00,
    costPrice: 200.00,
    stock: 12,
    sku: 'GAS-P13-COM',
    unit: 'UN',
    brand: 'Ultragas',
    specs: '13kg • Vasilhame novo + carga completa',
    active: true
  },
  {
    _id: 'prod_03',
    id: 'prod_03',
    name: 'Cilindro P45 (Recarga)',
    barcode: '7890000000045',
    category: 'Gás de Cozinha',
    price: 420.00,
    costPrice: 350.00,
    stock: 8,
    sku: 'GAS-P45-REC',
    unit: 'UN',
    brand: 'Ultragas',
    specs: '45kg • Uso comercial e condomínios',
    active: true
  },
  {
    _id: 'prod_04',
    id: 'prod_04',
    name: 'Água Mineral Galão 20L (Recarga)',
    barcode: '7890000000020',
    category: 'Água Mineral',
    price: 15.00,
    costPrice: 6.50,
    stock: 120,
    sku: 'AGU-GAL-20',
    unit: 'UN',
    brand: 'Aquarela',
    specs: '20 Litros • Fonte Aquarela',
    active: true
  },
  {
    _id: 'prod_05',
    id: 'prod_05',
    name: 'Água Mineral Galão 20L (Vasilhame + Recarga)',
    barcode: '7890000000021',
    category: 'Água Mineral',
    price: 45.00,
    costPrice: 25.00,
    stock: 30,
    sku: 'AGU-GAL-VAS',
    unit: 'UN',
    brand: 'Aquarela',
    specs: 'Vasilhame de 20L + Água Mineral',
    active: true
  },
  {
    _id: 'prod_06',
    id: 'prod_06',
    name: 'Mangueira de Gás com Regulador',
    barcode: '7890000000100',
    category: 'Acessórios e Peças',
    price: 45.00,
    costPrice: 20.00,
    stock: 25,
    sku: 'ACE-MNG-REG',
    unit: 'UN',
    brand: 'Aliança',
    specs: 'Mangueira 1.25m trançada + Regulador Aliança',
    active: true
  }
];
export const seedEmployees = [
  {
    _id: 'emp_01',
    id: 'emp_01',
    name: 'Carolina Santos',
    email: 'carolina.vendas@bansir.com',
    phone: '(11) 98112-3344',
    roleTitle: 'Supervisora de Vendas & Balcão',
    laborType: 'MOD', // Mão de Obra Direta (Produtivo)
    baseSalary: 2400.00,
    commissionType: 'percentage',
    commissionValue: 5.0, // 5% por venda
    totalSalesCount: 42,
    totalSalesAmount: 7650.00,
    totalCommissionsEarned: 1350.00,
    gamificationPoints: 780,
    gamificationLevel: 'Mestre do Gás Diamante 💎',
    badges: ['Primeira Venda', 'Meta Batida', 'Clube dos 1K', 'Craque do Caixa'],
    active: true,
    hiredAt: new Date(2025, 2, 10)
  },
  {
    _id: 'emp_02',
    id: 'emp_02',
    name: 'Matheus Figueira',
    email: 'matheus.caixa@bansir.com',
    phone: '(11) 97223-5566',
    roleTitle: 'Entregador Rápido & Operador de Pátio',
    laborType: 'MOD', // Mão de Obra Direta (Produtivo)
    baseSalary: 1950.00,
    commissionType: 'percentage',
    commissionValue: 4.0, // 4% por venda
    totalSalesCount: 28,
    totalSalesAmount: 3840.00,
    totalCommissionsEarned: 336.00,
    gamificationPoints: 410,
    gamificationLevel: 'Mestre das Entregas Ouro 🥇',
    badges: ['Primeira Venda', 'Clube dos 1K', 'Agilidade no Caixa'],
    active: true,
    hiredAt: new Date(2025, 5, 18)
  },
  {
    _id: 'emp_03',
    id: 'emp_03',
    name: 'Juliana Prado',
    email: 'juliana.atendimento@bansir.com',
    phone: '(11) 99445-7788',
    roleTitle: 'Atendente de Tele-Gás & Atendimento',
    laborType: 'MOD', // Mão de Obra Direta (Produtivo)
    baseSalary: 2100.00,
    commissionType: 'percentage',
    commissionValue: 4.5, // 4.5%
    totalSalesCount: 31,
    totalSalesAmount: 4950.00,
    totalCommissionsEarned: 890.00,
    gamificationPoints: 520,
    gamificationLevel: 'Especialista Bansir Ouro 🏆',
    badges: ['Primeira Venda', 'Meta do Dia', 'Clube dos 1K'],
    active: true,
    hiredAt: new Date(2025, 8, 1)
  },
  {
    _id: 'emp_04',
    id: 'emp_04',
    name: 'Lucas Silva (Entregador)',
    email: 'lucas@bansir.com',
    phone: '(21) 97654-3344',
    roleTitle: 'Entregador de Gás & Motorista',
    laborType: 'MOD',
    baseSalary: 2000.00,
    commissionType: 'percentage',
    commissionValue: 5.0,
    totalSalesCount: 16,
    totalSalesAmount: 2280.00,
    totalCommissionsEarned: 114.00,
    gamificationPoints: 240,
    gamificationLevel: 'Entregador Ágil Prata 🥈',
    badges: ['Primeira Venda', 'Clube dos 1K'],
    active: true,
    hiredAt: new Date(2025, 9, 1)
  },
  {
    _id: 'emp_05',
    id: 'emp_05',
    name: 'Vanessa Alencar',
    email: 'vanessa.adm@bansir.com',
    phone: '(11) 96554-1122',
    roleTitle: 'Assistente Administrativa & Suporte',
    laborType: 'MOI', // Mão de Obra Indireta (Não Produtivo - Apoio)
    baseSalary: 2300.00,
    commissionType: 'fixed',
    commissionValue: 0.0, // Não recebe comissão variável sobre vendas
    totalSalesCount: 0,
    totalSalesAmount: 0.0,
    totalCommissionsEarned: 0.0,
    gamificationPoints: 50,
    gamificationLevel: 'Novato do Gás Bronze 🎯',
    badges: ['Guardiã das Contas'],
    active: true,
    hiredAt: new Date(2025, 1, 15)
  }
];
export const seedPricing = {
  businessHours: {
    daysPerWeek: 6, // Dias que o comércio abre por semana (Seg a Sáb)
    openingTime: '08:00',
    closingTime: '18:00',
    dailyStoreHours: 10, // Horas que a loja física fica de portas abertas
    dailyHoursPerPerson: 8, // HP: Horas diárias trabalhadas por colaborador
    workedDaysPerMonth: 26, // DTN: Dias trabalhados no mês
    efficiencyFactor: 0.85 // Aproveitamento efetivo do tempo produtivo (85%)
  },
  fixedExpenses: [
    { id: 'fe_1', name: 'Aluguel do Ponto Comercial & Ateliê em Bonito', amount: 3500.00, category: 'Imóvel' },
    { id: 'fe_2', name: 'Energia Elétrica & Iluminação de Vitrine', amount: 780.00, category: 'Utilidades' },
    { id: 'fe_3', name: 'Água e Saneamento', amount: 160.00, category: 'Utilidades' },
    { id: 'fe_4', name: 'Internet Fibra Óptica Comercial & Telefonia', amount: 220.00, category: 'Comunicação' },
    { id: 'fe_5', name: 'Assessoria Contábil & Contador Mensal', amount: 850.00, category: 'Serviços' },
    { id: 'fe_6', name: 'Software Bansir ERP / PDV & Nuvem', amount: 290.00, category: 'Tecnologia' },
    { id: 'fe_7', name: 'Manutenção Predial, Segurança & Limpeza', amount: 480.00, category: 'Operação' }
  ],
  variableExpenses: [
    { id: 've_1', name: 'Taxa Média de Maquininha (Débito/Crédito 1x/Pix)', percentage: 3.2 },
    { id: 've_2', name: 'Embalagens Ecológicas Kraft, Fitas & Sacolas', percentage: 2.5 },
    { id: 've_3', name: 'Reserva para Perdas e Quebras de Peças Frágeis', percentage: 1.5 }
  ],
  pricingRules: {
    taxRate: 6.0, // Impostos (Simples Nacional comércio de artesanato)
    desiredProfitMargin: 18.0, // Margem de lucro líquida desejada
    commissionMode: 'auto', // 'auto' (calcula média da equipe MOD) ou 'manual'
    manualCommissionRate: 5.0,
    creditCardTermRate: 4.8, // Taxa média de parcelamento no cartão a prazo (3x a 6x)
    expectedMonthlyRevenue: 52000,
    fixedExpenseRate: 16.5 // Rateio de custos fixos da loja sobre a venda (Aluguel, Luz, Água, Salários fixos)
  }
};

export const seedPlan = { users: 3, categories: seedCategories.length, products: seedProducts.length, employees: seedEmployees.length, pricingConfigurations: 1 };
