export const seedCategories = [
  {
    _id: 'cat_01',
    id: 'cat_01',
    name: 'Cerâmica & Barro',
    description: 'Peças moldadas em torno manual, barro terracota e queima artesanal em alta temperatura.',
    color: '#c85a32'
  },
  {
    _id: 'cat_02',
    id: 'cat_02',
    name: 'Marcenaria Sustentável',
    description: 'Entalhes em madeiras nobres de reaproveitamento, peroba rosa e acabamento atóxico.',
    color: '#8f4f22'
  },
  {
    _id: 'cat_03',
    id: 'cat_03',
    name: 'Tecelagem & Fios',
    description: 'Macramê e teares em algodão cru brasileiro, fibras vegetais e tingimento natural.',
    color: '#58795c'
  },
  {
    _id: 'cat_04',
    id: 'cat_04',
    name: 'Biojoias & Acessórios',
    description: 'Colares e brincos com sementes do Pantanal, pedras regionais e prata 925.',
    color: '#d48227'
  },
  {
    _id: 'cat_05',
    id: 'cat_05',
    name: 'Aromas & Saboaria de Bonito',
    description: 'Velas aromáticas e sabonetes vegetais artesanais com essências da serra da Bodoquena.',
    color: '#3b533e'
  }
];
export const seedProducts = [
  {
    _id: 'prod_01',
    id: 'prod_01',
    name: 'Vaso Bojudo Barro Terracota Queimado 35cm',
    barcode: '7891234567890',
    category: 'Cerâmica & Barro',
    price: 180.00,
    costPrice: 65.00,
    stock: 14,
    sku: 'VAS-TER-35',
    unit: 'UN',
    artisan: 'Helena Barro Alto',
    specs: 'Argila Tabatinga • Altura: 35cm • Queima em forno a lenha',
    active: true
  },
  {
    _id: 'prod_02',
    id: 'prod_02',
    name: 'Vaso de Cerâmica Esmaltada Verde Sálvia 25cm',
    barcode: '7891234567891',
    category: 'Cerâmica & Barro',
    price: 145.00,
    costPrice: 50.00,
    stock: 8,
    sku: 'VAS-SAL-25',
    unit: 'UN',
    artisan: 'Helena Barro Alto',
    specs: 'Esmalte atóxico verde sálvia • Altura: 25cm',
    active: true
  },
  {
    _id: 'prod_03',
    id: 'prod_03',
    name: 'Conjunto Xícaras Café Artesanal Rústica (6 un)',
    barcode: '7891234567892',
    category: 'Cerâmica & Barro',
    price: 240.00,
    costPrice: 85.00,
    stock: 22,
    sku: 'CJ-XIC-06',
    unit: 'CJ',
    artisan: 'Helena Barro Alto',
    specs: 'Queima alta temperatura 1240°C • Capacidade: 80ml',
    active: true
  },
  {
    _id: 'prod_04',
    id: 'prod_04',
    name: 'Tábua de Frios Peroba Rosa Maciça com Resina 40cm',
    barcode: '7891234567893',
    category: 'Marcenaria Sustentável',
    price: 320.00,
    costPrice: 110.00,
    stock: 6,
    sku: 'TAB-PER-40',
    unit: 'UN',
    artisan: 'Lucas Madeira Fina',
    specs: 'Madeira de demolição peroba rosa • Óleo mineral e cera de abelha',
    active: true
  },
  {
    _id: 'prod_05',
    id: 'prod_05',
    name: 'Painel Decorativo Macramê Algodão Cru 120cm',
    barcode: '7891234567894',
    category: 'Tecelagem & Fios',
    price: 290.00,
    costPrice: 90.00,
    stock: 5,
    sku: 'PAN-MAC-120',
    unit: 'UN',
    artisan: 'Mariana Nós & Tramas',
    specs: 'Algodão cru orgânico • Galho de canela natural tratado',
    active: true
  },
  {
    _id: 'prod_06',
    id: 'prod_06',
    name: 'Prato Decorativo Barro Queimado Esmaltado 28cm',
    barcode: '7891234567895',
    category: 'Cerâmica & Barro',
    price: 110.00,
    costPrice: 38.00,
    stock: 19,
    sku: 'PRT-DEC-28',
    unit: 'UN',
    artisan: 'Helena Barro Alto',
    specs: 'Diâmetro 28cm • Pintura mineral manual ancestral',
    active: true
  },
  {
    _id: 'prod_07',
    id: 'prod_07',
    name: 'Luminária Pendente Cerâmica Argila Torneada',
    barcode: '7891234567896',
    category: 'Cerâmica & Barro',
    price: 450.00,
    costPrice: 160.00,
    stock: 4,
    sku: 'LUM-ARG-01',
    unit: 'UN',
    artisan: 'Mestre Bansir',
    specs: 'Bocal E27 em latão envelhecido • Fiação revestida em tecido',
    active: true
  },
  {
    _id: 'prod_08',
    id: 'prod_08',
    name: 'Colar Gargantilha Sementes de Jarina e Prata',
    barcode: '7891234567897',
    category: 'Biojoias & Acessórios',
    price: 185.00,
    costPrice: 55.00,
    stock: 11,
    sku: 'BIO-JAR-01',
    unit: 'UN',
    artisan: 'Clara Bioarte Bonito',
    specs: 'Marfim vegetal (Jarina) polido natural e fecho em prata',
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
    roleTitle: 'Mestre Ceramista & Vendedora Sênior',
    laborType: 'MOD', // Mão de Obra Direta (Produtivo)
    baseSalary: 2400.00,
    commissionType: 'percentage',
    commissionValue: 5.0, // 5% por venda
    totalSalesCount: 42,
    totalSalesAmount: 7650.00,
    totalCommissionsEarned: 1350.00,
    gamificationPoints: 780,
    gamificationLevel: 'Mestre Artesão Ouro 👑',
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
    roleTitle: 'Operador de Acabamento & Balcão',
    laborType: 'MOD', // Mão de Obra Direta (Produtivo)
    baseSalary: 1950.00,
    commissionType: 'percentage',
    commissionValue: 4.0, // 4% por venda
    totalSalesCount: 28,
    totalSalesAmount: 3840.00,
    totalCommissionsEarned: 336.00,
    gamificationPoints: 410,
    gamificationLevel: 'Especialista em Vendas 🏆',
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
    roleTitle: 'Artesã Têxtil / Macramê & Atendimento',
    laborType: 'MOD', // Mão de Obra Direta (Produtivo)
    baseSalary: 2100.00,
    commissionType: 'percentage',
    commissionValue: 4.5, // 4.5%
    totalSalesCount: 31,
    totalSalesAmount: 4950.00,
    totalCommissionsEarned: 890.00,
    gamificationPoints: 520,
    gamificationLevel: 'Mestre Artesão Ouro 👑',
    badges: ['Primeira Venda', 'Meta do Dia', 'Clube dos 1K'],
    active: true,
    hiredAt: new Date(2025, 8, 1)
  },
  {
    _id: 'emp_04',
    id: 'emp_04',
    name: 'Lucas Madeira Fina',
    email: 'lucas@bansir.com',
    phone: '(21) 97654-3344',
    roleTitle: 'Operador de Caixa & Marcenaria',
    laborType: 'MOD',
    baseSalary: 2000.00,
    commissionType: 'percentage',
    commissionValue: 5.0,
    totalSalesCount: 16,
    totalSalesAmount: 2280.00,
    totalCommissionsEarned: 114.00,
    gamificationPoints: 240,
    gamificationLevel: 'Vendedor Destaque 🌟',
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
    gamificationLevel: 'Artesão Ativo 🎯',
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
