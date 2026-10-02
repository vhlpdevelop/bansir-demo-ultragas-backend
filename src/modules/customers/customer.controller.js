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
