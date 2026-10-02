import { Customer } from './customer.model.js';

export async function searchCustomers(req, res) {
  try {
    const { q } = req.query;
    if (!q) {
      const customers = await Customer.find().limit(50).sort({ updatedAt: -1 });
      return res.json({ success: true, data: customers });
    }

    const regex = new RegExp(q, 'i');
    const customers = await Customer.find({
      $or: [
        { name: regex },
        { phone: regex }
      ]
    }).limit(20);

    return res.json({ success: true, data: customers });
  } catch (error) {
    console.error('Error searching customers:', error);
    return res.status(500).json({ success: false, message: 'Erro ao buscar clientes.' });
  }
}

export async function getCustomers(req, res) {
  try {
    const customers = await Customer.find().sort({ name: 1 });
    return res.json({ success: true, data: customers });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao listar clientes.' });
  }
}

export async function createCustomer(req, res) {
  try {
    const { name, phone, cpf, address } = req.body;
    const cleanPhone = phone.replace(/\D/g, '');
    const exists = await Customer.findOne({ phone: cleanPhone });
    if (exists) return res.status(400).json({ success: false, message: 'Telefone já cadastrado.' });
    
    const customer = await Customer.create({ name, phone: cleanPhone, cpf, address });
    return res.json({ success: true, data: customer });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao criar cliente.' });
  }
}

export async function updateCustomer(req, res) {
  try {
    const { id } = req.params;
    const { name, phone, cpf, address } = req.body;
    const cleanPhone = phone ? phone.replace(/\D/g, '') : undefined;
    
    const customer = await Customer.findById(id);
    if (!customer) return res.status(404).json({ success: false, message: 'Cliente não encontrado.' });

    if (name) customer.name = name;
    if (cleanPhone) customer.phone = cleanPhone;
    if (cpf !== undefined) customer.cpf = cpf;
    if (address !== undefined) customer.address = address;

    await customer.save();
    return res.json({ success: true, data: customer });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao atualizar cliente.' });
  }
}

export async function deleteCustomer(req, res) {
  try {
    const { id } = req.params;
    await Customer.findByIdAndDelete(id);
    return res.json({ success: true, message: 'Cliente removido.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao remover cliente.' });
  }
}
